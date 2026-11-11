import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const publishableKey =
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  Deno.env.get("SUPABASE_ANON_KEY");
const allowedOrigins = new Set(
  (Deno.env.get("COOP_ADMIN_ALLOWED_ORIGINS") ??
    Deno.env.get("SUPABASE_FUNCTION_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const allowedRequestHeaders = new Set([
  "authorization",
  "apikey",
  "content-type",
  "x-client-info",
  "x-retry-count",
  "traceparent",
  "tracestate",
  "baggage",
]);
const allowedActions = new Set([
  "create-account",
  "edit-account",
  "delete-account",
  "block-account",
  "unblock-account",
  "reset-account-password",
  "review-loan",
  "approve-loan",
  "reject-loan",
  "release-loan",
  "update-loan-status",
  "update-loan-policy",
]);
type JsonObject = Record<string, unknown>;

function respond(
  body: JsonObject,
  status: number,
  origin: string | null,
  originAllowed: boolean,
) {
  const headers = new Headers({
    "Content-Type": "application/json",
    "Vary": "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
  });
  if (origin && originAllowed) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set(
      "Access-Control-Allow-Headers",
      [...allowedRequestHeaders].join(", "),
    );
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Max-Age", "86400");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as JsonObject;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256(value: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function hmacSha256(value: string, key: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsSensitiveField(value: JsonObject): boolean {
  return Object.keys(value).some((key) =>
    /password|token|secret|credential/i.test(key)
  );
}

function validateActionSecret(action: string, value: unknown): JsonObject | null {
  const secretActions = new Set(["create-account", "reset-account-password"]);
  if (!secretActions.has(action)) {
    if (value !== undefined && value !== null) {
      throw new Error("This action does not accept secret values.");
    }
    return null;
  }
  if (
    !isJsonObject(value) ||
    Object.keys(value).some((key) => key !== "temporaryPassword")
  ) {
    throw new Error("Temporary password is required.");
  }
  const temporaryPassword = requireString(
    value.temporaryPassword,
    "Temporary password is required.",
    128,
  );
  if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(temporaryPassword)) {
    throw new Error("Temporary password does not meet the password policy.");
  }
  return { temporaryPassword };
}

function getRoleMetadata(role: unknown): { role: string; label: string } | null {
  if (role === "Member") return { role: "member", label: role };
  if (role === "Admin" || role === "Administrator") {
    return { role: "coop_admin", label: "Administrator" };
  }
  if (role === "Super Admin" || role === "Super Administrator") {
    return { role: "super_admin", label: "Super Administrator" };
  }
  return null;
}

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0];
  const lastName = parts.length > 1 ? parts[parts.length - 1] : "";
  if (firstName.length > 100 || lastName.length > 100) {
    throw new Error("Full Name is too long.");
  }
  return { firstName, lastName };
}

function requireString(value: unknown, message: string, maximum = 500): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum) {
    throw new Error(message);
  }
  return value.trim();
}

function hasCompletedCalendarMonths(joinedDate: unknown, minimumMonths: number): boolean {
  if (typeof joinedDate !== "string" || !Number.isInteger(minimumMonths) || minimumMonths < 0) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(joinedDate);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const targetMonthIndex = year * 12 + month + minimumMonths;
  const targetYear = Math.floor(targetMonthIndex / 12);
  const targetMonth = targetMonthIndex % 12;
  const targetDay = Math.min(day, new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate());
  const eligibilityDate = Date.UTC(targetYear, targetMonth, targetDay);
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) >= eligibilityDate;
}

async function rollbackCreatedUser(
  admin: ReturnType<typeof createClient>,
  userId: string,
  failureMessage: string,
): Promise<never> {
  const { error: authError } = await admin.auth.admin.deleteUser(userId);
  const { error: profileError } = await admin
    .from("members")
    .delete()
    .eq("user_id", userId);
  if (authError || profileError) {
    throw new Error(
      "Account creation could not be completed, and automatic cleanup failed. Contact the system administrator.",
    );
  }
  throw new Error(failureMessage);
}

async function insertAudit(
  admin: ReturnType<typeof createClient>,
  actorId: string,
  action: string,
  target: string,
  result: "success" | "failure",
  details: JsonObject = {},
) {
  const { error } = await admin.from("admin_activity_logs").insert({
    actor_id: actorId,
    action_name: action,
    target_id: target,
    result,
    details,
  });
  if (error) {
    throw new Error("The action could not be recorded in the activity log.");
  }
}

async function executeAccountAction(
  admin: ReturnType<typeof createClient>,
  actorId: string,
  action: string,
  target: string,
  payload: JsonObject,
  secret: unknown,
) {
  if (action === "create-account") {
    if (target !== "new-account" || "idNumber" in payload || "member_id" in payload) {
      throw new Error("Account IDs are generated automatically and cannot be supplied.");
    }
    const allowedFields = new Set([
      "fullName",
      "email",
      "phone",
      "address",
      "role",
      "membershipType",
      "department",
      "identityVerified",
    ]);
    if (Object.keys(payload).some((key) => !allowedFields.has(key))) {
      throw new Error("The account details contain unsupported fields.");
    }
    const fullName = requireString(payload.fullName, "Full Name is required.", 200);
    const email = requireString(payload.email, "A valid email address is required.", 100)
      .toLowerCase();
    const phone = requireString(payload.phone, "A valid contact number is required.", 20);
    const address = requireString(payload.address, "Address is required.", 500);
    const role =
      payload.role === "Member"
        ? { role: "member", label: "Member" }
        : payload.role === "Admin"
          ? { role: "coop_admin", label: "Administrator" }
          : null;
    const membershipType =
      role?.role === "member" &&
        (payload.membershipType === "regular" ||
          payload.membershipType === "associate")
        ? payload.membershipType
        : null;
    const department =
      membershipType === "regular"
        ? requireString(payload.department, "Department is required.", 200)
        : null;
    const confirmation = payload.identityVerified === true;
    const secretFields = isJsonObject(secret) ? secret : {};
    const temporaryPassword = requireString(
      secretFields.temporaryPassword,
      "Temporary password is required.",
      128,
    );

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("A valid email address is required.");
    }
    const phoneDigits = phone.replace(/\D/g, "");
    if (!/^\+?[0-9() .-]+$/.test(phone) || phoneDigits.length < 7 || phoneDigits.length > 15) {
      throw new Error("Enter a valid contact number with 7–15 digits.");
    }
    if (!role) throw new Error("Invalid account role.");
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(temporaryPassword)) {
      throw new Error("Temporary password does not meet the password policy.");
    }
    if (role.role === "member" && membershipType === null) {
      throw new Error("Invalid membership type.");
    }
    if (!confirmation) {
      throw new Error("Identity verification is required.");
    }

    const names = splitName(fullName);
    const escapedEmail = email.replace(/[\\%_]/g, "\\$&");
    const { data: existingProfiles, error: profileCheckError } = await admin
      .from("members")
      .select("id")
      .ilike("email", escapedEmail)
      .limit(1);
    if (profileCheckError) {
      throw new Error("Unable to verify that the email address is available.");
    }
    if (existingProfiles?.length) {
      throw new Error("An account profile with this email already exists.");
    }

    const { data: createdUser, error: authError } = await admin.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      app_metadata: { role: role.role, account_status: "active" },
      user_metadata: { full_name: fullName },
    });
    if (authError || !createdUser.user) {
      throw new Error(
        "Unable to create the authentication account. The email may already be registered; verify it and retry.",
      );
    }

    const { data: linkedProfile, error: linkedProfileError } = await admin
      .from("members")
      .select("id")
      .eq("user_id", createdUser.user.id)
      .maybeSingle();
    if (linkedProfileError) {
      return await rollbackCreatedUser(
        admin,
        createdUser.user.id,
        "Unable to check for a profile created by an authentication trigger. The authentication account was removed.",
      );
    }

    const profileValues = {
      first_name: names.firstName,
      last_name: names.lastName,
      email,
      phone,
      address,
      department,
      role: role.label,
      membership_type:
        membershipType === "regular"
          ? "Regular"
          : membershipType === "associate"
            ? "Associate"
            : null,
      status: "active",
      must_change_password: true,
      in_person_identity_verified: true,
      created_by: actorId,
    };
    // An Auth trigger may already have created the profile for this new user.
    const profileQuery = linkedProfile
      ? admin.from("members").update(profileValues).eq("id", linkedProfile.id)
      : admin.from("members").insert({
          user_id: createdUser.user.id,
          ...profileValues,
        });
    const { data: member, error: memberError } = await profileQuery
      .select("member_id, first_name, last_name, email, department, role, membership_type, status, created_at")
      .single();

    if (memberError) {
      return await rollbackCreatedUser(
        admin,
        createdUser.user.id,
        "Unable to save the account profile. The authentication account was removed.",
      );
    }
    if (typeof member.member_id !== "string" || !member.member_id.trim()) {
      return await rollbackCreatedUser(
        admin,
        createdUser.user.id,
        "The database did not generate an Account ID. The authentication account was removed.",
      );
    }

    try {
      await insertAudit(admin, actorId, action, member.member_id, "success", {
        fullName,
        email,
        phone,
        role: role.label,
        membershipType,
        department,
        identityVerified: true,
      });
    } catch {
      return await rollbackCreatedUser(
        admin,
        createdUser.user.id,
        "The account could not be recorded in the activity log and was rolled back.",
      );
    }
    return {
      member_id: member.member_id,
      message: `${role.label} account created successfully. Account ID: ${member.member_id}.`,
    };
  }

  const { data: member, error: lookupError } = await admin
    .from("members")
    .select("id, user_id, member_id, role, email, status, must_change_password")
    .eq("member_id", target)
    .maybeSingle();

  if (lookupError || !member) {
    throw new Error("Account not found.");
  }
  if (!member.user_id) {
    throw new Error("This profile is not linked to an authentication account.");
  }
  const { data: targetAuthUser, error: targetAuthError } =
    await admin.auth.admin.getUserById(member.user_id);
  if (targetAuthError || !targetAuthUser.user) {
    throw new Error("Unable to validate the target account's authorization.");
  }
  const targetAppMetadata = isJsonObject(targetAuthUser.user.app_metadata)
    ? targetAuthUser.user.app_metadata
    : {};
  if (
    member.role === "Super Administrator" ||
    member.role === "Super Admin" ||
    targetAppMetadata.role === "super_admin"
  ) {
    throw new Error("Super Administrator accounts cannot be changed by this action.");
  }
  if (
    member.user_id === actorId &&
    (action === "block-account" || action === "delete-account")
  ) {
    throw new Error("You cannot block or delete your own administrator account.");
  }

  if (action === "reset-account-password") {
    const secretFields = isJsonObject(secret) ? secret : {};
    const temporaryPassword = requireString(
      secretFields.temporaryPassword,
      "Temporary password is required.",
      128,
    );
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(temporaryPassword)) {
      throw new Error("Temporary password does not meet the password policy.");
    }

    const { data: updatedMember, error: flagError } = await admin
      .from("members")
      .update({ must_change_password: true })
      .eq("member_id", target)
      .select("member_id")
      .maybeSingle();
    if (flagError || !updatedMember) {
      throw new Error("Unable to prepare the account for a password reset.");
    }

    const restorePasswordChangeFlag = async () => {
      const { data, error } = await admin
        .from("members")
        .update({ must_change_password: member.must_change_password })
        .eq("member_id", target)
        .select("member_id")
        .maybeSingle();
      if (error || !data) {
        throw new Error("Unable to restore the member profile after the password reset failed.");
      }
    };

    const { data: authUser, error: authLookupError } =
      await admin.auth.admin.getUserById(member.user_id);
    if (authLookupError || !authUser.user) {
      await restorePasswordChangeFlag();
      throw new Error("Unable to load the member authentication account.");
    }

    const previousMetadata = isJsonObject(authUser.user.user_metadata)
      ? authUser.user.user_metadata
      : {};
    const { error: passwordError } = await admin.auth.admin.updateUserById(
      member.user_id,
      {
        password: temporaryPassword,
        user_metadata: { ...previousMetadata, must_change_password: true },
      },
    );
    if (passwordError) {
      await restorePasswordChangeFlag();
      throw new Error("Unable to reset the authentication password.");
    }

    await insertAudit(admin, actorId, action, target, "success", {
      mustChangePassword: true,
    });
    return { member_id: target, must_change_password: true };
  }

  if (action === "edit-account") {
    const fullName = requireString(payload.fullName, "Full Name is required.", 200);
    const email = requireString(payload.email, "A valid email address is required.", 100);
    const phone = requireString(payload.phone, "A valid contact number is required.", 20);
    const address = requireString(payload.address, "Address is required.", 500);
    const role = getRoleMetadata(payload.role);
    const membershipType =
      role?.role === "member" &&
        (payload.membershipType === "regular" ||
          payload.membershipType === "associate")
        ? payload.membershipType
        : null;
    const department =
      membershipType === "regular"
        ? requireString(payload.department, "Department is required.", 200)
        : null;
    if (!role) throw new Error("Invalid account role.");
    if (role.role === "super_admin") {
      throw new Error("An existing account cannot be promoted to Super Admin here.");
    }
    if (role.role === "member" && membershipType === null) {
      throw new Error("Invalid membership type.");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("A valid email address is required.");
    }
    const phoneDigits = phone.replace(/\D/g, "");
    if (!/^\+?[0-9() .-]+$/.test(phone) || phoneDigits.length < 7 || phoneDigits.length > 15) {
      throw new Error("Enter a valid contact number with 7–15 digits.");
    }

    const names = splitName(fullName);
    const { data: existingAuthUser, error: authLookupError } =
      await admin.auth.admin.getUserById(member.user_id);
    if (authLookupError || !existingAuthUser.user) {
      throw new Error("Unable to load account authentication details.");
    }
    const existingAppMetadata = isJsonObject(existingAuthUser.user.app_metadata)
      ? existingAuthUser.user.app_metadata
      : {};
    const { error: updateAuthError } = await admin.auth.admin.updateUserById(
      member.user_id,
      {
        email,
        email_confirm: true,
        app_metadata: { ...existingAppMetadata, role: role.role },
        user_metadata: { full_name: fullName },
      },
    );
    if (updateAuthError) throw new Error("Unable to update account authentication details.");

    const { data: updated, error: updateError } = await admin
      .from("members")
      .update({
        first_name: names.firstName,
        last_name: names.lastName,
        email,
        phone,
        address,
        department,
        role: role.label,
        membership_type:
          membershipType === "regular"
            ? "Regular"
            : membershipType === "associate"
              ? "Associate"
              : null,
      })
      .eq("member_id", target)
      .select("member_id, first_name, last_name, email, phone, address, department, role, membership_type, status, created_at")
      .single();
    if (updateError) throw new Error("Unable to update the member profile.");

    await insertAudit(admin, actorId, action, target, "success", {
      fullName,
      email,
      role: role.label,
      membershipType,
      department,
    });
    return updated;
  }

  if (action === "block-account" || action === "unblock-account") {
    const status = action === "block-account" ? "blocked" : "active";
    const { data: authUser, error: authLookupError } =
      await admin.auth.admin.getUserById(member.user_id);
    if (authLookupError || !authUser.user) {
      throw new Error("Unable to load account authentication details.");
    }
    const appMetadata = isJsonObject(authUser.user.app_metadata)
      ? authUser.user.app_metadata
      : {};
    const { data: updated, error: updateError } = await admin
      .from("members")
      .update({ status })
      .eq("member_id", target)
      .select("member_id, status")
      .single();
    if (updateError) throw new Error("Unable to update the account status.");

    const { error: metadataError } = await admin.auth.admin.updateUserById(
      member.user_id,
      { app_metadata: { ...appMetadata, account_status: status } },
    );
    if (metadataError) {
      const { error: rollbackError } = await admin
        .from("members")
        .update({ status: member.status })
        .eq("member_id", target);
      if (rollbackError) {
        throw new Error(
          "Unable to synchronize or restore the account's blocked status.",
        );
      }
      throw new Error("Unable to update the account's authorization status.");
    }

    await insertAudit(admin, actorId, action, target, "success", { status });
    return updated;
  }

  if (action === "delete-account") {
    const { error: deleteError } = await admin.auth.admin.deleteUser(member.user_id);
    if (deleteError) throw new Error("Unable to delete the account.");
    await insertAudit(admin, actorId, action, target, "success");
    return { member_id: target };
  }

  throw new Error("Unsupported account action.");
}

async function executeLoanAction(
  admin: ReturnType<typeof createClient>,
  actorId: string,
  action: string,
  target: string,
  payload: JsonObject,
) {
  let result: unknown;
  if (action === "review-loan") {
    const { data, error } = await admin
      .from("loan_applications")
      .update({ status: "under review" })
      .eq("application_id", target)
      .in("status", ["pending", "under review"])
      .select("application_id, status")
      .single();
    if (error) throw new Error("Unable to put the loan application under review.");
    result = data;
  } else if (action === "approve-loan") {
    const { data: application, error: applicationError } = await admin
      .from("loan_applications")
      .select("id,member_id,amount,status,loan_type,members!inner(status,date_joined)")
      .eq("application_id", target)
      .single();
    if (applicationError || !application) throw new Error("Unable to load the loan application for approval.");
    if (!["pending", "under review"].includes(application.status)) {
      throw new Error("Only Pending or Under Review applications can be approved.");
    }

    const member = Array.isArray(application.members) ? application.members[0] : application.members;
    if (!member || member.status !== "active") throw new Error("Only active members can have an application approved.");
    const { data: duplicateApplications, error: duplicateCheckError } = await admin
      .from("loan_applications")
      .select("application_id")
      .eq("member_id", application.member_id)
      .eq("loan_type", application.loan_type)
      .in("status", ["pending", "under review", "approved", "released", "overdue"])
      .neq("id", application.id)
      .limit(1);
    if (duplicateCheckError) throw new Error("Unable to check for another in-progress loan of this type.");
    if (duplicateApplications?.length) {
      throw new Error("This member already has an in-progress application or loan of this type. Resolve it before approval.");
    }
    const { data: otherActiveApplications, error: duplicateError } = await admin
      .from("loan_applications")
      .select("application_id")
      .eq("member_id", application.member_id)
      .eq("loan_type", application.loan_type)
      .in("status", ["pending", "under review", "approved", "released", "overdue"])
      .neq("id", application.id)
      .limit(1);
    if (duplicateError) throw new Error("Unable to check for another in-progress loan of this type.");
    if (otherActiveApplications?.length) {
      throw new Error("This member already has an in-progress loan or application of this type. Resolve it before approving another.");
    }
    const { data: policy, error: policyError } = await admin.from("loan_policy_settings")
      .select("min_member_tenure_months,min_loan_amount,max_loan_amount,collateral_required_above")
      .eq("singleton", true).single();
    if (policyError || !policy) throw new Error("Unable to load the current loan policy.");
    const amount = Number(application.amount);
    if (!Number.isFinite(amount) || amount < Number(policy.min_loan_amount) || amount > Number(policy.max_loan_amount)) {
      throw new Error("Application amount is outside the current loan policy limits.");
    }
    if (!hasCompletedCalendarMonths(member.date_joined, Number(policy.min_member_tenure_months))) {
      throw new Error(`Member has not met the minimum ${policy.min_member_tenure_months}-month tenure policy.`);
    }
    const { data: documents, error: documentsError } = await admin.from("loan_documents")
      .select("kind").eq("loan_application_id", application.id);
    if (documentsError) throw new Error("Unable to verify the loan documents.");
    const documentKinds = new Set((documents ?? []).map((document) => document.kind));
    if (!documentKinds.has("payslip") || !documentKinds.has("validId")) {
      throw new Error("Payslip and valid identification documents are required before approval.");
    }
    if (amount > Number(policy.collateral_required_above) && !documentKinds.has("collateral")) {
      throw new Error("A collateral document is required by the current loan policy.");
    }
    const { data, error } = await admin.from("loan_applications")
      .update({ status: "approved", date_approved: new Date().toISOString().slice(0, 10) })
      .eq("id", application.id)
      .in("status", ["pending", "under review"])
      .select("application_id,status,date_approved")
      .single();
    if (error || !data) throw new Error("Unable to approve this application. It may have changed; refresh and retry.");
    result = { ...data, message: "Loan application approved successfully." };
  } else if (action === "reject-loan") {
    const { data, error } = await admin
      .from("loan_applications")
      .update({ status: "rejected" })
      .eq("application_id", target)
      .in("status", ["pending", "under review"])
      .select("application_id, status")
      .single();
    if (error) throw new Error("Unable to reject the loan application.");
    result = data;
  } else if (action === "release-loan") {
    const { data, error } = await admin.rpc("release_loan", {
      p_application_id: target,
    });
    if (error || !data?.[0]?.success) {
      throw new Error(data?.[0]?.message ?? "Unable to release the loan.");
    }
    result = data[0];
  } else if (action === "update-loan-status") {
    const allowedStatuses = new Set([
      "under review",
      "approved",
      "rejected",
      "released",
      "completed",
      "overdue",
    ]);
    if (typeof payload.status !== "string" || !allowedStatuses.has(payload.status)) {
      throw new Error("Invalid loan status.");
    }
    const { data, error } = await admin
      .from("loan_applications")
      .update({ status: payload.status })
      .eq("application_id", target)
      .select("application_id, status")
      .single();
    if (error) throw new Error("Unable to update the loan status.");
    result = data;
  } else {
    throw new Error("Unsupported loan action.");
  }

  await insertAudit(admin, actorId, action, target, "success", {
    status:
      isJsonObject(result) && typeof result.status === "string"
        ? result.status
        : action,
  });
  return result;
}

async function executeLoanPolicyAction(
  admin: ReturnType<typeof createClient>,
  actorId: string,
  target: string,
  payload: JsonObject,
) {
  if (target !== "loan-policy") throw new Error("Invalid loan policy target.");
  const allowed = new Set([
    "base_interest_rate", "processing_fee_percent", "max_loan_multiplier",
    "min_member_tenure_months", "penalty_rate_percent", "service_fee_percent",
    "co_maker_required_above", "collateral_required_above", "loan_processing_time",
    "min_loan_amount", "max_loan_amount",
  ]);
  if (Object.keys(payload).length !== allowed.size || Object.keys(payload).some((key) => !allowed.has(key))) {
    throw new Error("Loan policy is incomplete or contains unsupported fields.");
  }
  const numericRanges: Record<string, [number, number]> = {
    base_interest_rate: [0, 100],
    processing_fee_percent: [0, 100],
    max_loan_multiplier: [0.0001, 1000],
    min_member_tenure_months: [0, 600],
    penalty_rate_percent: [0, 100],
    service_fee_percent: [0, 100],
    co_maker_required_above: [0, 1_000_000_000_000],
    collateral_required_above: [0, 1_000_000_000_000],
    min_loan_amount: [0.01, 1_000_000_000_000],
    max_loan_amount: [0.01, 1_000_000_000_000],
  };
  const values: JsonObject = {};
  for (const [field, [minimum, maximum]] of Object.entries(numericRanges)) {
    const value = payload[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
      throw new Error(`Invalid loan policy value: ${field}.`);
    }
    values[field] = value;
  }
  if (values.max_loan_amount < values.min_loan_amount) {
    throw new Error("Maximum loan amount must be at least the minimum loan amount.");
  }
  const processingTime = requireString(payload.loan_processing_time, "Processing time is required.", 100);
  values.loan_processing_time = processingTime;
  values.updated_by = actorId;

  const { data, error } = await admin.from("loan_policy_settings")
    .update(values).eq("singleton", true)
    .select("base_interest_rate,processing_fee_percent,max_loan_multiplier,min_member_tenure_months,penalty_rate_percent,service_fee_percent,co_maker_required_above,collateral_required_above,loan_processing_time,min_loan_amount,max_loan_amount,updated_at,updated_by")
    .single();
  if (error || !data || data.updated_by !== actorId) {
    throw new Error("Unable to save loan policy. Confirm the policy migration is applied and try again.");
  }
  await insertAudit(admin, actorId, "update-loan-policy", "loan-policy", "success", {
    fields: Object.keys(numericRanges).concat("loan_processing_time"),
  });
  return { ...data, message: "Loan policy saved successfully." };
}

serve(async (request) => {
  const origin = request.headers.get("Origin");
  const originAllowed = origin === null || allowedOrigins.has(origin);
  const send = (body: JsonObject, status = 200) =>
    respond(body, status, origin, originAllowed);

  try {
  if (request.method === "OPTIONS") {
    const requestedMethod = request.headers
      .get("Access-Control-Request-Method")
      ?.toUpperCase();
    const requestedHeaders = (
      request.headers.get("Access-Control-Request-Headers") ?? ""
    )
      .split(",")
      .map((header) => header.trim().toLowerCase())
      .filter(Boolean);
    if (
      !origin ||
      !originAllowed ||
      requestedMethod !== "POST" ||
      requestedHeaders.some((header) => !allowedRequestHeaders.has(header))
    ) {
      return send({ error: "CORS preflight request is not allowed." }, 403);
    }
    return send({ success: true });
  }
  if (!originAllowed) return send({ error: "Origin is not allowed." }, 403);
  if (request.method !== "POST") return send({ error: "Method not allowed." }, 405);
  if (!supabaseUrl || !serviceRoleKey || !publishableKey) {
    return send({ error: "Secure admin actions are not configured." }, 503);
  }

  const bearer = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) return send({ error: "Authentication required." }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: userError,
  } = await admin.auth.getUser(bearer);
  if (userError || !user) return send({ error: "Authentication required." }, 401);
  if (
    user.app_metadata?.role !== "super_admin" ||
    (user.app_metadata?.account_status !== undefined &&
      user.app_metadata.account_status !== "active") ||
    (typeof user.banned_until === "string" &&
      Date.parse(user.banned_until) > Date.now())
  ) {
    return send({ error: "Super Admin access required." }, 403);
  }
  const { data: actorProfile, error: actorProfileError } = await admin
    .from("members")
    .select("status")
    .eq("user_id", user.id)
    .maybeSingle();
  if (actorProfileError) {
    return send({ error: "Unable to verify the Super Admin account status." }, 503);
  }
  if (
    (actorProfile && actorProfile.status !== "active") ||
    (!actorProfile && user.app_metadata?.account_status !== "active")
  ) {
    return send({ error: "An active Super Admin account is required." }, 403);
  }

  let body: JsonObject;
  try {
    const parsed: unknown = await request.json();
    if (!isJsonObject(parsed)) return send({ error: "Invalid request." }, 400);
    body = parsed;
  } catch {
    return send({ error: "Invalid request." }, 400);
  }

  if (body.mode === "preview-account-id") {
    if (Object.keys(body).length !== 1) {
      return send({ error: "Invalid account ID preview request." }, 400);
    }
    const { data: previewId, error: previewError } = await admin.rpc(
      "preview_next_member_id",
    );
    if (previewError || typeof previewId !== "string" || !/^CSUCC-\d{4}-\d{4,}$/.test(previewId)) {
      return send({ error: "Unable to load the Account ID preview. Retry or contact the system administrator." }, 503);
    }
    return send({ previewId });
  }

  const action = typeof body.action === "string" ? body.action : "";
  const target = typeof body.target === "string" ? body.target : "";
  const payload = isJsonObject(body.payload) ? body.payload : null;
  if (!allowedActions.has(action) || !target || !payload || containsSensitiveField(payload)) {
    return send({ error: "Invalid protected action request." }, 400);
  }

  let actionSecret: JsonObject | null;
  try {
    actionSecret = validateActionSecret(action, body.secret);
  } catch (error) {
    return send({
      error: error instanceof Error ? error.message : "Invalid action secret.",
    }, 400);
  }
  const secretFingerprint = actionSecret
    ? await hmacSha256(canonicalJson(actionSecret), serviceRoleKey)
    : null;
  const fingerprint = await sha256(canonicalJson({
    payload,
    secretFingerprint,
  }));
  if (body.mode === "verify") {
    const { data: limited, error: limitError } = await admin.rpc(
      "is_admin_security_rate_limited",
      { p_user_id: user.id },
    );
    if (limitError) return send({ error: "Password verification is unavailable." }, 503);
    if (limited) return send({ error: "Too many attempts. Please try again later." }, 429);
    if (typeof body.password !== "string" || !body.password || !user.email) {
      return send({ error: "Enter your account password." }, 400);
    }

    const verifier = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: passwordError } = await verifier.auth.signInWithPassword({
      email: user.email,
      password: body.password,
    });
    if (passwordError) {
      const { error: recordError } = await admin.rpc(
        "record_admin_security_failure",
        { p_user_id: user.id },
      );
      if (recordError) {
        return send({ error: "Unable to record the verification attempt." }, 503);
      }
      try {
        await insertAudit(
          admin,
          user.id,
          `security-verify:${action}`,
          target,
          "failure",
          { reason: "password_verification_failed" },
        );
      } catch {
        return send({ error: "Unable to record the verification attempt." }, 503);
      }
      return send({ error: "Incorrect password. Please try again." }, 401);
    }

    const { error: clearAttemptsError } = await admin.rpc(
      "clear_admin_security_failures",
      { p_user_id: user.id },
    );
    if (clearAttemptsError) {
      return send({ error: "Unable to reset verification limits." }, 503);
    }
    const randomBytes = crypto.getRandomValues(new Uint8Array(32));
    const grant = btoa(String.fromCharCode(...randomBytes))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    const { error: grantError } = await admin.rpc("issue_admin_action_grant", {
      p_user_id: user.id,
      p_action_name: action,
      p_target_id: target,
      p_request_fingerprint: fingerprint,
      p_grant_token_hash: await sha256(grant),
    });
    if (grantError) return send({ error: "Unable to authorize this action." }, 503);
    return send({ grant });
  }

  if (body.mode !== "execute" || typeof body.grant !== "string" || !body.grant) {
    return send({ error: "Invalid protected action request." }, 400);
  }

  const { data: consumed, error: consumeError } = await admin.rpc(
    "consume_admin_action_grant",
    {
      p_user_id: user.id,
      p_action_name: action,
      p_target_id: target,
      p_request_fingerprint: fingerprint,
      p_grant_token_hash: await sha256(body.grant),
    },
  );
  if (consumeError) return send({ error: "Unable to validate action authorization." }, 503);
  if (!consumed) return send({ error: "Authorization expired or does not match this action." }, 403);

  try {
    const result = action === "update-loan-policy"
      ? await executeLoanPolicyAction(admin, user.id, target, payload)
      : action.includes("-account")
        ? await executeAccountAction(admin, user.id, action, target, payload, actionSecret)
        : await executeLoanAction(admin, user.id, action, target, payload);
    return send({ success: true, result });
  } catch (error) {
    await insertAudit(
      admin,
      user.id,
      action,
      target,
      "failure",
      { reason: error instanceof Error ? error.message : "Operation failed." },
    );
    return send(
      {
        error: error instanceof Error ? error.message : "The action could not be completed.",
      },
      400,
    );
  }
  } catch {
    console.error("Secure admin action request failed unexpectedly.");
    return send({ error: "The secure admin action could not be completed." }, 500);
  }
});
