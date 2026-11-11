export interface EditableProfile {
  first_name: string;
  last_name: string;
  phone: string;
  department: string;
  position: string;
}

export interface ProfileResponse {
  profile: EditableProfile;
  account: { id: string; email: string; pendingEmail: string | null; role: string; status: string; createdAt: string; lastSignInAt: string | null; emailConfirmed: boolean };
  memberLinked: boolean;
}

export function validateProfile(value: unknown): EditableProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Enter valid profile details.");
  const input = value as Record<string, unknown>;
  const keys = ["first_name", "last_name", "phone", "department", "position"] as const;
  if (Object.keys(input).some(key => !keys.includes(key as typeof keys[number]))) throw new Error("Only personal profile fields can be changed here.");
  const result = {} as EditableProfile;
  for (const key of keys) {
    if (typeof input[key] !== "string") throw new Error("Enter valid profile details.");
    const text = input[key].trim();
    const limit = key === "phone" ? 30 : 100;
    if (text.length > limit || /[\u0000-\u001f\u007f]/.test(text)) throw new Error(`${key.replaceAll("_", " ")} must be at most ${limit} characters without control characters.`);
    result[key] = text;
  }
  if (!result.first_name || !result.last_name) throw new Error("First and last name are required.");
  if (result.phone && (!/^[+\d\s().-]+$/.test(result.phone) || result.phone.replace(/\D/g, "").length < 7 || result.phone.replace(/\D/g, "").length > 15)) throw new Error("Enter a valid contact number with 7–15 digits.");
  return result;
}

export function validatePasswordChange(value: unknown): { current: string; next: string; confirm: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Enter your current and new passwords.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["current", "next", "confirm"].includes(key)) ||
    typeof input.current !== "string" || !input.current || input.current.length > 1024 ||
    typeof input.next !== "string" || typeof input.confirm !== "string") throw new Error("Enter your current and new passwords.");
  if (input.next !== input.confirm) throw new Error("New passwords do not match.");
  if (input.next === input.current) throw new Error("Choose a new password different from your current password.");
  if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,128}$/.test(input.next)) throw new Error("Use 8–128 characters, including uppercase, lowercase, a number and a symbol.");
  return { current: input.current, next: input.next, confirm: input.confirm };
}

export function validateEmailChange(value: unknown): { email: string; current: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Enter your new email and current password.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["email", "current"].includes(key)) || typeof input.email !== "string" ||
    typeof input.current !== "string" || !input.current || input.current.length > 1024) throw new Error("Enter your new email and current password.");
  const email = input.email.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /[\u0000-\u001f\u007f]/.test(email)) throw new Error("Enter a valid email address.");
  return { email, current: input.current };
}

export function emailChangeFailure(error: { code?: string; status?: number; message?: string } | null) {
  const code = error?.code ?? "email_change_failed";
  if (["email_exists", "user_already_exists"].includes(code)) return { error: "This email is already registered to another account. Use a different address.", code, status: 409 };
  if (code === "email_address_not_authorized") return { error: "The account service is blocking confirmation emails to this address. Configure custom SMTP in Supabase Authentication → Email → SMTP settings, then retry.", code, status: 503 };
  if (code === "email_address_invalid") return { error: "The account service rejected this email address. Check the address and retry.", code, status: 400 };
  if (error?.status === 429 || ["over_email_send_rate_limit", "over_request_rate_limit"].includes(code)) return { error: "The account service's email or request limit has been reached. Wait before retrying. Custom SMTP may be needed for confirmation email delivery.", code, status: 429 };
  if (code === "insufficient_aal") return { error: "This account requires multi-factor verification before changing its email. Complete MFA verification before retrying.", code, status: 403 };
  if (["reauthentication_needed", "reauthentication_not_valid", "session_not_found"].includes(code)) return { error: "The account service requires a fresh verification. Sign in again and retry the email change.", code, status: 401 };
  if (/sending.*(?:email|mail)|smtp|mailer/i.test(error?.message ?? "")) return { error: "The account service could not send the confirmation email. Check the project's SMTP configuration, sender verification and email delivery limits, then retry.", code, status: 503 };
  return { error: `The account service rejected the email change (${code}). ${error?.message?.slice(0, 300) || "Reload your profile and retry."}`, code, status: error?.status && error.status >= 400 && error.status <= 599 ? error.status : 502 };
}
