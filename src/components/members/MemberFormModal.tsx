"use client";

import { Input, Select } from "@/components/ui/Fields";
import { FormDialog } from "@/components/ui/FormDialog";
import { actionButtonStyles } from "@/components/shared/actionButtonStyles";
import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Eye,
  EyeOff,
  FileText,
  Info,
  UserRoundPlus,
  UserRoundPen,
} from "lucide-react";
import { Member, creatableMemberRoles, memberRoles } from "./MembersData";
import { membershipTypeOptions } from "@/lib/membership";
import { getSupabaseClient } from "@/lib/supabase";

interface MemberFormModalProps {
  mode: "add" | "edit";
  member: Member | null;
  onClose: () => void;
  onSubmit: (member: Member, temporaryPassword?: string) => void;
  busy?: boolean;
}

interface AccountFieldProps {
  id: string;
  label: string;
  className?: string;
  required?: boolean;
  error?: string;
  errorAction?: ReactNode;
  labelFeedback?: ReactNode;
  children: ReactNode;
}

const accountControlClass = "block w-full";
const passwordControlClass = `${accountControlClass} pr-10 [&::-ms-reveal]:hidden [&::-ms-clear]:hidden`;

function AccountField({
  id,
  label,
  className = "",
  required = true,
  error,
  errorAction,
  labelFeedback,
  children,
}: AccountFieldProps) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="mb-0.5 flex flex-wrap items-baseline justify-between gap-x-2">
        <label htmlFor={id} className="block text-[13px] leading-5 font-medium">
          {label}{required && <span aria-hidden="true" className="ml-1 text-status-danger">*</span>}
        </label>
        {labelFeedback}
      </div>
      {children}
      <div className={error ? "mt-1 flex flex-wrap items-start gap-x-2 gap-y-1" : "hidden"}>
        <p id={`${id}-message`} className="text-caption leading-4 text-status-danger" aria-live="polite" aria-atomic="true">{error}</p>
        {error && errorAction}
      </div>
    </div>
  );
}

type MemberFormErrors = Partial<
  Record<
    | "fullName"
    | "email"
    | "phone"
    | "address"
    | "role"
    | "membershipType"
    | "department"
    | "temporaryPassword"
    | "confirmPassword"
    | "identityVerified",
    string
  >
>;

const fullNamePattern = new RegExp("^[\\p{L}\\p{M} .'-]+$", "u");
const nameLetterPattern = new RegExp("\\p{L}", "gu");
const capitalNameStartPattern = new RegExp("^[\\p{Lu}\\p{Lt}]", "u");
const emailPattern = /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
const passwordPolicyPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

const emptyMember: Member = {
  accountKey: "",
  authUserId: null,
  profileLinked: false,
  integrityIssue: null,
  idNumber: "",
  fullName: "",
  email: "",
  phone: "",
  address: "",
  department: "",
  role: "Member",
  status: "Active",
  membershipType: null,
  createdAt: "",
};

export default function MemberFormModal({
  mode,
  member,
  onClose,
  onSubmit,
  busy = false,
}: MemberFormModalProps) {
  const [formData, setFormData] = useState<Member>(member ?? emptyMember);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [confirmTemporaryPassword, setConfirmTemporaryPassword] = useState("");
  const [showTemporaryPassword, setShowTemporaryPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [identityVerified, setIdentityVerified] = useState(false);
  const [touchedFields, setTouchedFields] = useState<Partial<Record<keyof MemberFormErrors, boolean>>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [accountIdPreview, setAccountIdPreview] = useState("");
  const [accountIdPreviewError, setAccountIdPreviewError] = useState("");
  const [accountIdPreviewLoading, setAccountIdPreviewLoading] = useState(
    mode === "add",
  );

  const loadAccountIdPreview = useCallback(async () => {
    try {
      const { data, error } = await getSupabaseClient().functions.invoke(
        "secure-admin-action",
        { body: { mode: "preview-account-id" } },
      );
      if (error) {
        throw error;
      }
      if (
        typeof data !== "object" ||
        data === null ||
        !("previewId" in data) ||
        typeof data.previewId !== "string" ||
        !/^CSUCC-\d{4}-\d{4,}$/.test(data.previewId)
      ) {
        throw new Error("The account service returned an invalid preview.");
      }
      setAccountIdPreview(data.previewId);
      setAccountIdPreviewError("");
    } catch {
      setAccountIdPreviewError(
        "Unable to load the Account ID preview.",
      );
    } finally {
      setAccountIdPreviewLoading(false);
    }
  }, []);

  const retryAccountIdPreview = () => {
    setAccountIdPreview("");
    setAccountIdPreviewError("");
    setAccountIdPreviewLoading(true);
    void loadAccountIdPreview();
  };

  useEffect(() => {
    if (mode === "add") {
      void Promise.resolve().then(loadAccountIdPreview);
    }
  }, [loadAccountIdPreview, mode]);

  const availableRoles = mode === "add" ? creatableMemberRoles : memberRoles;
  const isMemberAccount = formData.role === "Member";
  const isRegularMembership =
    isMemberAccount && formData.membershipType === "regular";

  const validationErrors = useMemo(() => {
    const errors: MemberFormErrors = {};
    const normalizedFullName = formData.fullName.trim();
    const normalizedEmail = formData.email.trim();
    const normalizedDepartment = formData.department.trim();
    if (!normalizedFullName) errors.fullName = "Full Name is required.";
    else if (!fullNamePattern.test(normalizedFullName)) {
      errors.fullName = "Use letters, spaces, hyphens, apostrophes, or periods. Numbers and other symbols are not allowed.";
    } else if ((normalizedFullName.match(nameLetterPattern)?.length ?? 0) < 2) {
      errors.fullName = "Enter a name with at least 2 letters.";
    } else if (normalizedFullName.split(/\s+/).some((word) => !capitalNameStartPattern.test(word))) {
      errors.fullName = "Each word in Full Name must start with a capital letter (e.g. Juan Dela Cruz).";
    } else if (normalizedFullName.length > 200) {
      errors.fullName = "Full Name must be 200 characters or fewer.";
    }
    if (!normalizedEmail) errors.email = "Email Address is required.";
    else if (normalizedEmail.length > 100) {
      errors.email = "Email Address must be 100 characters or fewer.";
    } else if (!emailPattern.test(normalizedEmail)) {
      errors.email = "Enter a valid email address, such as name@example.com.";
    } else {
      const [localPart, domain] = normalizedEmail.split("@");
      if (localPart.startsWith(".") || localPart.endsWith(".") || localPart.includes("..") || localPart.length > 64) {
        errors.email = "The part before @ cannot start or end with a dot, contain consecutive dots, or exceed 64 characters.";
      } else if (domain.split(".").some((label) => label.length > 63)) {
        errors.email = "Enter a valid email domain.";
      }
    }
    const phone = formData.phone?.trim() ?? "";
    const address = formData.address?.trim() ?? "";
    const phoneDigits = phone.replace(/\D/g, "").length;
    if (!phone) errors.phone = "Contact Number is required.";
    else if (phone.length > 20 || !/^\+?[0-9() .-]+$/.test(phone) || phoneDigits < 7 || phoneDigits > 15) {
      errors.phone = "Enter a valid contact number with 7–15 digits and at most 20 characters.";
    }
    if (!address) errors.address = "Address is required.";
    else if (address.length > 500) errors.address = "Address must be 500 characters or fewer.";
    if (!availableRoles.includes(formData.role)) errors.role = "Select a valid account role.";
    if (isMemberAccount && !formData.membershipType) errors.membershipType = "Membership Type is required.";
    if (isRegularMembership && !normalizedDepartment) errors.department = "Department is required for Regular Members.";
    else if (isRegularMembership && normalizedDepartment.length > 200) errors.department = "Department must be 200 characters or fewer.";
    if (mode === "add") {
      if (!temporaryPassword) errors.temporaryPassword = "Temporary Password is required.";
      else if (temporaryPassword.length > 128) errors.temporaryPassword = "Temporary Password must be 128 characters or fewer.";
      else if (temporaryPassword.length < 8) errors.temporaryPassword = "Use at least 8 characters.";
      else if (!/[A-Z]/.test(temporaryPassword)) errors.temporaryPassword = "Add at least 1 uppercase letter.";
      else if (!/[a-z]/.test(temporaryPassword)) errors.temporaryPassword = "Add at least 1 lowercase letter.";
      else if (!/\d/.test(temporaryPassword)) errors.temporaryPassword = "Add at least 1 number.";
      else if (!passwordPolicyPattern.test(temporaryPassword)) errors.temporaryPassword = "Password cannot contain line breaks.";
      if (!confirmTemporaryPassword) errors.confirmPassword = "Please confirm the temporary password.";
      else if (temporaryPassword !== confirmTemporaryPassword) errors.confirmPassword = "Temporary passwords do not match.";
      if (!identityVerified) errors.identityVerified = "Confirm that this person's identity has been verified.";
    }
    return errors;
  }, [
    availableRoles,
    confirmTemporaryPassword,
    formData,
    identityVerified,
    isMemberAccount,
    isRegularMembership,
    mode,
    temporaryPassword,
  ]);

  const canSubmit = Object.keys(validationErrors).length === 0;
  const formErrors: MemberFormErrors = {};
  for (const field of Object.keys(validationErrors) as (keyof MemberFormErrors)[]) {
    if (submitAttempted || touchedFields[field]) formErrors[field] = validationErrors[field];
  }
  // Advisory presentation only: submission still uses the existing COOP policy.
  const passwordStrength = !temporaryPassword ? null
    : validationErrors.temporaryPassword || /password|qwerty|123456|abcdef|admin/i.test(temporaryPassword) || /(.)\1{3}/.test(temporaryPassword)
      ? { label: "Weak", color: "text-status-danger" }
      : temporaryPassword.length >= 12 && /[^A-Za-z0-9\s]/.test(temporaryPassword) && new Set(temporaryPassword).size >= 8
        ? { label: "Strong", color: "text-status-success" }
        : { label: "Medium", color: "text-yellow-600" };

  const updateField = (field: keyof Member, value: string) => {
    if (field === "idNumber") return;
    setFormData((current) => {
      if (field === "role") {
        const nextRole = availableRoles.find((role) => role === value);
        if (!nextRole) return current;

        return {
          ...current,
          role: nextRole,
          membershipType: nextRole === "Member" ? current.membershipType : null,
          department: nextRole === "Member" ? current.department : "",
        };
      }

      if (field === "membershipType") {
        const nextMembershipType =
          value === "regular" || value === "associate" ? value : null;

        return {
          ...current,
          membershipType: nextMembershipType,
          department:
            nextMembershipType === "associate" ? "" : current.department,
        };
      }

      return { ...current, [field]: value } as Member;
    });

    setTouchedFields((current) => ({ ...current, [field]: true }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setSubmitAttempted(true);
    const normalizedFullName = formData.fullName.trim();
    const normalizedEmail = formData.email.trim();
    const normalizedDepartment = formData.department.trim();

    if (busy) return;
    if (!canSubmit) {
      document.getElementById(Object.keys(validationErrors)[0])?.focus();
      return;
    }

    const submittedPassword = mode === "add" ? temporaryPassword : undefined;
    onSubmit({
      ...formData,
      idNumber: mode === "add" ? "" : formData.idNumber,
      fullName: normalizedFullName,
      email: normalizedEmail,
      phone: formData.phone?.trim() ?? "",
      address: formData.address?.trim() ?? "",
      department: isRegularMembership ? normalizedDepartment : "",
      status: "Active",
      membershipType: isMemberAccount ? formData.membershipType ?? "regular" : null,
      createdAt: new Date().toISOString(),
    }, submittedPassword);
  };

  const dirty = JSON.stringify(formData) !== JSON.stringify(member ?? emptyMember) || !!temporaryPassword || !!confirmTemporaryPassword || identityVerified;
  return (
    <FormDialog title={mode === "add" ? "Create Account" : "Edit Member"} icon={mode === "add" ? UserRoundPlus : UserRoundPen}
      subtitle={mode === "edit" ? formData.idNumber : undefined} dirty={dirty} busy={busy} onClose={onClose}
      className="ui-account-form max-w-[760px]" footer={<>
        <button type="button" data-dialog-close disabled={busy} className="ui-button">Cancel</button>
        <button type="submit" form="member-account-form" disabled={!canSubmit || busy} className="ui-button ui-button--primary">{mode === "add" ? "Create Account" : "Save Changes"}</button>
      </>} closeLabel="Close member form">
      <form id="member-account-form" onSubmit={handleSubmit} autoComplete="off" noValidate
        onBlurCapture={(event) => {
          const name = event.target.getAttribute("name");
          if (name) setTouchedFields((current) => ({ ...current, [name]: true }));
        }}
      >
        <fieldset disabled={busy} className="grid min-w-0 grid-cols-1 content-start gap-x-3 gap-y-1.5 sm:grid-cols-2 md:grid-cols-3">
          <h3 className="col-span-full flex items-center gap-2 border-b border-portal-border pb-1 text-[13px] leading-[18px] font-bold text-coop-primary">
            <FileText className="h-4 w-4 text-coop-dashboard-green" aria-hidden="true" />
            <span>Account Information</span>
          </h3>

          <div>
            <AccountField
              id="idNumber"
              label={mode === "add" ? "ID Number (Auto-generated)" : "ID Number"}
              required={false}
              error={mode === "add" ? accountIdPreviewError : undefined}
              errorAction={
                mode === "add" && accountIdPreviewError ? (
                  <button
                    type="button"
                    onClick={retryAccountIdPreview}
                    disabled={accountIdPreviewLoading}
                    className={actionButtonStyles("secondary", "xs")}
                  >
                    Retry
                  </button>
                ) : undefined
              }
            >
              <Input
                id="idNumber"
                name="idNumber"
                type="text"
                value={mode === "add" ? accountIdPreview : formData.idNumber}
                placeholder={
                  mode === "add"
                    ? accountIdPreviewLoading
                      ? "Loading preview..."
                      : accountIdPreviewError
                        ? "Preview unavailable"
                        : ""
                    : ""
                }
                readOnly
                aria-readonly="true"
                title="Account IDs are generated automatically and cannot be edited."
                tabIndex={-1}
                aria-describedby="idNumber-message"
                aria-invalid={mode === "add" && !!accountIdPreviewError}
                autoComplete="off"
                className={`${accountControlClass} cursor-not-allowed read-only:text-portal-muted`}
              />
            </AccountField>
          </div>

          <AccountField
            id="fullName"
            label="Full Name"
            className="md:col-span-2"
            error={formErrors.fullName}
          >
            <Input
              id="fullName"
              required
              name="fullName"
              type="text"
              value={formData.fullName}
              aria-invalid={Boolean(formErrors.fullName)}
              aria-describedby="fullName-message"
              maxLength={200}
              autoComplete="off"
              autoCapitalize="words"
              onChange={(event) => updateField("fullName", event.target.value)}
              className={accountControlClass}
            />
          </AccountField>

          <AccountField
            id="email"
            label="Email Address"
            error={formErrors.email}
          >
            <Input
              id="email"
              required
              name="email"
              type="email"
              value={formData.email}
              aria-invalid={Boolean(formErrors.email)}
              aria-describedby="email-message"
              maxLength={100}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              onChange={(event) => updateField("email", event.target.value)}
              className={accountControlClass}
            />
          </AccountField>

          <AccountField id="phone" label="Contact Number" error={formErrors.phone}>
            <Input
              id="phone"
              required
              name="phone"
              type="tel"
              autoComplete="off"
              maxLength={20}
              value={formData.phone ?? ""}
              aria-invalid={Boolean(formErrors.phone)}
              aria-describedby="phone-message"
              onChange={(event) => updateField("phone", event.target.value)}
              className={accountControlClass}
            />
          </AccountField>

          <AccountField id="address" label="Address" error={formErrors.address}>
            <Input
              id="address"
              required
              name="address"
              autoComplete="off"
              maxLength={500}
              value={formData.address ?? ""}
              aria-invalid={Boolean(formErrors.address)}
              aria-describedby="address-message"
              onChange={(event) => updateField("address", event.target.value)}
              className={accountControlClass}
            />
          </AccountField>

          <AccountField id="role" label="Role" error={formErrors.role}>
            <Select
              id="role"
              required
              name="role"
              value={formData.role}
              aria-invalid={Boolean(formErrors.role)}
              aria-describedby="role-message"
              onChange={(event) => updateField("role", event.target.value)}
              className={accountControlClass}
            >
              {availableRoles.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </Select>
          </AccountField>

          {isMemberAccount && (
            <AccountField
              id="membershipType"
              label="Membership Type"
              error={formErrors.membershipType}
            >
              <Select
                id="membershipType"
                required
                name="membershipType"
                value={formData.membershipType ?? ""}
                aria-invalid={Boolean(formErrors.membershipType)}
                aria-describedby="membershipType-message"
                onChange={(event) => updateField("membershipType", event.target.value)}
                className={accountControlClass}
              >
                <option value="">Select membership type</option>
                {membershipTypeOptions.map((membershipType) => (
                  <option key={membershipType.value} value={membershipType.value}>
                    {membershipType.label}
                  </option>
                ))}
              </Select>
            </AccountField>
          )}

          {isRegularMembership && (
            <AccountField
              id="department"
              label="Department"
              error={formErrors.department}
            >
              <Input
                id="department"
                required
                name="department"
                type="text"
                value={formData.department}
                aria-invalid={Boolean(formErrors.department)}
                aria-describedby="department-message"
                maxLength={200}
                onChange={(event) => updateField("department", event.target.value)}
                className={accountControlClass}
              />
            </AccountField>
          )}

          {mode === "add" && (
            <>
              <div className="col-span-full grid grid-cols-1 items-start gap-x-3 gap-y-1.5 sm:grid-cols-2">
              <AccountField
                id="temporaryPassword"
                label="Temporary Password"
                error={formErrors.temporaryPassword}
                labelFeedback={passwordStrength && <span id="temporaryPassword-strength" role="status" className={`text-caption font-semibold ${passwordStrength.color}`}>Strength: {passwordStrength.label}</span>}
              >
                <div className="relative">
                  <Input
                    id="temporaryPassword"
                    required
                    name="temporaryPassword"
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={128}
                    type={showTemporaryPassword ? "text" : "password"}
                    value={temporaryPassword}
                    aria-invalid={Boolean(formErrors.temporaryPassword)}
                    aria-describedby={`temporaryPassword-message${passwordStrength ? " temporaryPassword-strength" : ""}`}
                    onChange={(event) => {
                      setTemporaryPassword(event.target.value);
                      setTouchedFields((current) => ({
                        ...current,
                        temporaryPassword: true,
                      }));
                    }}
                    className={passwordControlClass}
                  />
                  <button
                    type="button"
                    onClick={() => setShowTemporaryPassword((current) => !current)}
                    className="ui-icon-button ui-button--ghost absolute inset-y-0 end-0 border-transparent"
                    aria-label={
                      showTemporaryPassword
                        ? "Hide temporary password"
                        : "Show temporary password"
                    }
                  >
                    {showTemporaryPassword ? (
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </AccountField>

              <AccountField
                id="confirmPassword"
                label="Confirm Temporary Password"
                error={formErrors.confirmPassword}
              >
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    required
                    name="confirmPassword"
                    autoComplete="new-password"
                    maxLength={128}
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmTemporaryPassword}
                    aria-invalid={Boolean(formErrors.confirmPassword)}
                    aria-describedby="confirmPassword-message"
                    onChange={(event) => {
                      setConfirmTemporaryPassword(event.target.value);
                      setTouchedFields((current) => ({
                        ...current,
                        confirmPassword: true,
                      }));
                    }}
                    className={passwordControlClass}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((current) => !current)}
                    className="ui-icon-button ui-button--ghost absolute inset-y-0 end-0 border-transparent"
                    aria-label={
                      showConfirmPassword
                        ? "Hide confirmed password"
                        : "Show confirmed password"
                    }
                  >
                    {showConfirmPassword ? (
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </AccountField>
              </div>

              <div className="col-span-full">
              <label className="flex items-start gap-2.5">
                <input
                  id="identityVerified"
                  name="identityVerified"
                  type="checkbox"
                  required
                  checked={identityVerified}
                  aria-required="true"
                  aria-invalid={Boolean(formErrors.identityVerified)}
                  aria-describedby="identityVerified-message"
                  onChange={(event) => {
                    setIdentityVerified(event.target.checked);
                    setTouchedFields((current) => ({ ...current, identityVerified: true }));
                  }}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-portal-border-control text-coop-dashboard-green focus:ring-[#155D3B]/20"
                />
                <span className="text-caption font-medium text-[#374151]">
                  I confirm this person&apos;s identity has been verified.
                </span>
              </label>
                <p id="identityVerified-message" hidden={!formErrors.identityVerified} className="mt-1 text-caption leading-5 text-status-danger" aria-live="polite">
                  {formErrors.identityVerified}
                </p>
              </div>
            </>
          )}
          <p className="col-span-full flex items-start gap-2 text-caption leading-4 text-portal-secondary">
            <Info className="h-4 w-4 shrink-0 text-coop-dashboard-green" aria-hidden="true" />
            <span>{mode === "add" && "Share temporary credentials privately. "}Your Super Admin password is required to confirm.</span>
          </p>
        </fieldset>

      </form>
    </FormDialog>
  );
}
