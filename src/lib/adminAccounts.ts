import {
  Member,
  MemberRole,
  MemberStatus,
  normalizedMemberRoles,
} from "@/components/members/MembersData";
import { getSupabaseClient } from "@/lib/supabase";

export class AdminAccountLoadError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "AdminAccountLoadError";
  }
}

interface AccountListResponse {
  success: true;
  accounts: unknown[];
  dataIntegrityIssues: number;
}

const roles = normalizedMemberRoles;
const statuses = new Set<MemberStatus>([
  "Active",
  "Pending",
  "Suspended",
  "Inactive",
  "Blocked",
  "Unknown",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAccount(value: unknown): Member {
  if (
    !isRecord(value) ||
    typeof value.accountKey !== "string" ||
    typeof value.profileLinked !== "boolean" ||
    typeof value.idNumber !== "string" ||
    typeof value.fullName !== "string" ||
    typeof value.email !== "string" ||
    !roles.has(value.role as MemberRole) ||
    !statuses.has(value.status as MemberStatus) ||
    (value.membershipType !== null &&
      value.membershipType !== "regular" &&
      value.membershipType !== "associate") ||
    typeof value.department !== "string" ||
    typeof value.createdAt !== "string" ||
    (value.authUserId !== null && typeof value.authUserId !== "string") ||
    (value.integrityIssue !== null && typeof value.integrityIssue !== "string")
  ) {
    throw new AdminAccountLoadError(
      "The account service returned data in an unsupported format.",
      "invalid_response",
    );
  }

  return {
    accountKey: value.accountKey,
    authUserId: value.authUserId,
    profileLinked: value.profileLinked,
    integrityIssue: value.integrityIssue,
    idNumber: value.idNumber,
    fullName: value.fullName,
    email: value.email,
    role: value.role as MemberRole,
    membershipType: value.membershipType,
    department: value.department,
    status: value.status as MemberStatus,
    createdAt: value.createdAt,
  };
}

async function getInvokeFailure(invokeError: unknown): Promise<AdminAccountLoadError> {
  const response =
    isRecord(invokeError) &&
    "context" in invokeError &&
    invokeError.context instanceof Response
      ? invokeError.context
      : null;
  if (response) {
    let body: unknown;
    try {
      body = await response.clone().json();
    } catch {
      body = null;
    }
    const errorObject =
      isRecord(body) && isRecord(body.error) ? body.error : isRecord(body) ? body : null;
    const code =
      errorObject && typeof errorObject.code === "string"
        ? errorObject.code
        : "";
    const safeMessage =
      errorObject && typeof errorObject.message === "string"
        ? errorObject.message
        : "";

    if (response.status === 401 || code === "session_expired") {
      return new AdminAccountLoadError(
        "Your session expired or is no longer valid. Sign in again to load accounts.",
        "session_expired",
      );
    }
    if (response.status === 403 || code === "forbidden") {
      return new AdminAccountLoadError(
        "Your account is not authorized to view all accounts.",
        "unauthorized",
      );
    }
    if (code === "schema_not_migrated") {
      return new AdminAccountLoadError(safeMessage, code);
    }
    if (code === "database_permission") {
      return new AdminAccountLoadError(
        "The secure account service lacks database permissions. Contact the system administrator.",
        code,
      );
    }
    if (response.status === 404 || code === "NOT_FOUND") {
      return new AdminAccountLoadError(
        "The secure account listing service is not deployed. Deploy list-admin-accounts and retry.",
        "function_not_deployed",
      );
    }
    return new AdminAccountLoadError(
      safeMessage || "The secure account service could not load accounts. Retry or contact the system administrator.",
      code || (response.status >= 500 ? "backend_failure" : "request_failure"),
    );
  }

  const message =
    invokeError instanceof Error ? invokeError.message.toLowerCase() : "";
  if (/fetch|network|connection|failed to send a request/.test(message)) {
    return new AdminAccountLoadError(
      "Unable to reach the account service. Check your connection and retry.",
      "network_failure",
    );
  }
  return new AdminAccountLoadError(
    "The secure account service could not be reached. Retry or contact the system administrator.",
    "backend_failure",
  );
}

// Share in-flight loads (including React's development effect replay) so a
// rejected token triggers only one refresh/retry sequence.
let pendingAccounts: ReturnType<typeof loadAdminAccounts> | null = null;

export function fetchAdminAccounts() {
  if (!pendingAccounts) {
    pendingAccounts = loadAdminAccounts().finally(() => { pendingAccounts = null; });
  }
  return pendingAccounts;
}

async function loadAdminAccounts(): Promise<{
  accounts: Member[];
  dataIntegrityIssues: number;
}> {
  const client = getSupabaseClient();
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError || !sessionData.session) {
    throw new AdminAccountLoadError(
      "Your session expired or is no longer valid. Sign in again to load accounts.",
      "session_expired",
    );
  }

  const invoke = (accessToken: string) =>
    client.functions.invoke(
      "list-admin-accounts",
      { body: {}, headers: { Authorization: `Bearer ${accessToken}` } },
    );

  let { data, error } = await invoke(sessionData.session.access_token);
  if (error) {
    const failure = await getInvokeFailure(error);
    if (failure.code !== "session_expired") throw failure;

    const { data: refreshed, error: refreshError } = await client.auth.refreshSession();
    if (refreshError && refreshError.status !== 400 && refreshError.status !== 401 && refreshError.status !== 403) {
      throw new AdminAccountLoadError(
        "Unable to refresh your session. Check your connection and retry.",
        "network_failure",
      );
    }
    if (refreshError || !refreshed.session) throw failure;
    ({ data, error } = await invoke(refreshed.session.access_token));
    if (error) {
      const retryFailure = await getInvokeFailure(error);
      if (retryFailure.code === "session_expired") {
        const validation = await client.auth.getUser(refreshed.session.access_token);
        if (!validation.error && validation.data.user) {
          throw new AdminAccountLoadError(
            "Your session is valid, but the account service rejected it. Retry or contact the system administrator.",
            "service_auth_failure",
          );
        }
      }
      throw retryFailure;
    }
  }

  if (
    !isRecord(data) ||
    data.success !== true ||
    !Array.isArray(data.accounts) ||
    typeof data.dataIntegrityIssues !== "number" ||
    data.dataIntegrityIssues < 0
  ) {
    throw new AdminAccountLoadError(
      "The secure account service returned an invalid response.",
      "invalid_response",
    );
  }

  const response = data as unknown as AccountListResponse;
  return {
    accounts: response.accounts.map(parseAccount),
    dataIntegrityIssues: response.dataIntegrityIssues,
  };
}
