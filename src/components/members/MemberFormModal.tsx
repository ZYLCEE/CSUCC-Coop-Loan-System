"use client";

import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  CheckCircle2,
  Circle,
  Eye,
  EyeOff,
  FileText,
  Info,
  UserRoundPlus,
  X,
} from "lucide-react";
import { Member, memberRoles } from "./MembersData";
import { membershipTypeOptions } from "@/lib/membership";
import { getSupabaseClient } from "@/lib/supabase";

interface MemberFormModalProps {
  mode: "add" | "edit";
  member: Member | null;
  onClose: () => void;
  onSubmit: (member: Member, temporaryPassword?: string) => void;
}

interface FloatingFieldProps {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  errorAction?: ReactNode;
  children: ReactNode;
}

const floatingControlClass =
  "h-full w-full rounded-[9px] bg-transparent px-3 pt-[17px] pb-1 text-[14px] text-[#1F2937] focus:outline-none";

function FloatingField({
  id,
  label,
  required = true,
  hint,
  error,
  errorAction,
  children,
}: FloatingFieldProps) {
  return (
    <div>
      <div className={`relative h-[50px] rounded-[9px] border bg-[#F8FAFC] transition-colors focus-within:bg-white focus-within:ring-2 ${error ? "border-[#DC2626] focus-within:border-[#DC2626] focus-within:ring-[#DC2626]/15" : "border-[#D1D5DB] focus-within:border-[#155D3B] focus-within:ring-[#155D3B]/15"}`}>
        <label
          htmlFor={id}
          className="absolute left-3 top-[5px] z-10 cursor-text text-[11px] font-semibold leading-3 text-[#4B5563]"
        >
          {label} {required && <span className="text-[#DC2626]">*</span>}
        </label>
        {children}
      </div>
      {error && (
        <div className="mt-1 flex items-center justify-between gap-2">
          <p id={`${id}-error`} className="text-[11px] font-medium text-[#DC2626]" role="alert">
            {error}
          </p>
          {errorAction}
        </div>
      )}
      {hint && <p id={`${id}-hint`} className="mt-1 text-[11px] text-[#64748B]">{hint}</p>}
    </div>
  );
}

type MemberFormErrors = Partial<
  Record<
    | "fullName"
    | "email"
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
    if (formData.role !== "Member" && formData.role !== "Admin") errors.role = "Select a valid account role.";
    if (isMemberAccount && !formData.membershipType) errors.membershipType = "Membership Type is required.";
    if (isRegularMembership && !normalizedDepartment) errors.department = "Department is required for Regular Members.";
    if (mode === "add") {
      if (!temporaryPassword) errors.temporaryPassword = "Temporary Password is required.";
      else if (!passwordPolicyPattern.test(temporaryPassword)) {
        errors.temporaryPassword = "Use 8 or more characters with at least 1 uppercase, 1 lowercase, and 1 number.";
      }
      if (!confirmTemporaryPassword) errors.confirmPassword = "Please confirm the temporary password.";
      else if (temporaryPassword !== confirmTemporaryPassword) errors.confirmPassword = "Temporary passwords do not match.";
      if (!identityVerified) errors.identityVerified = "Confirm that this person's identity has been verified.";
    }
    return errors;
  }, [
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
  const passwordRequirements = [
    { label: "At least 8 characters", met: temporaryPassword.length >= 8 },
    { label: "One uppercase letter (A–Z)", met: /[A-Z]/.test(temporaryPassword) },
    { label: "One lowercase letter (a–z)", met: /[a-z]/.test(temporaryPassword) },
    { label: "One number (0–9)", met: /\d/.test(temporaryPassword) },
    { label: "Both passwords match", met: temporaryPassword.length > 0 && temporaryPassword === confirmTemporaryPassword },
  ];

  const updateField = (field: keyof Member, value: string) => {
    if (field === "idNumber") return;
    setFormData((current) => {
      if (field === "role") {
        const nextRole = value === "Admin" ? "Admin" : "Member";

        return {
          ...current,
          role: nextRole,
          membershipType: nextRole === "Admin" ? null : current.membershipType,
          department: nextRole === "Admin" ? "" : current.department,
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

    if (!canSubmit) return;

    const submittedPassword = mode === "add" ? temporaryPassword : undefined;
    onSubmit({
      ...formData,
      idNumber: mode === "add" ? "" : formData.idNumber,
      fullName: normalizedFullName,
      email: normalizedEmail,
      department: isRegularMembership ? normalizedDepartment : "",
      status: "Active",
      membershipType: isMemberAccount ? formData.membershipType ?? "regular" : null,
      createdAt: new Date().toISOString(),
    }, submittedPassword);
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[#111827]/50 p-4"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="member-form-title"
    >
      <form
        onSubmit={handleSubmit}
        noValidate
        onBlurCapture={(event) => {
          const name = event.target.getAttribute("name");
          if (name) setTouchedFields((current) => ({ ...current, [name]: true }));
        }}
        className="flex max-h-[calc(100dvh-2rem)] w-[min(760px,95vw)] flex-col overflow-hidden rounded-[12px] border border-[#E5E7EB] bg-white shadow-[0_24px_60px_rgba(15,23,42,0.28)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[#E5E7EB] px-5 py-4">
          <div className="flex items-center gap-2.5">
            {mode === "add" && (
              <UserRoundPlus className="h-5 w-5 text-[#155D3B]" aria-hidden="true" />
            )}
            <div>
              <h2 id="member-form-title" className="text-[20px] font-bold leading-6 text-[#172B45]">
              {mode === "add" ? "Create Account" : "Edit Member"}
              </h2>
              {mode === "edit" && (
                <p className="mt-0.5 text-[12px] text-[#6B7280]">{formData.idNumber}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[#6B7280] transition-colors hover:bg-[#F1F5F9] hover:text-[#155D3B]"
            aria-label="Close member form"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 content-start gap-x-3.5 gap-y-2 overflow-y-auto px-5 py-3 sm:grid-cols-2">
          <div className="col-span-full mb-0 flex items-center gap-2 text-[16px] font-bold text-[#273444]">
            <FileText className="h-4 w-4 text-[#155D3B]" aria-hidden="true" />
            <span>Account Information</span>
          </div>

          <div>
            <FloatingField
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
                    className="shrink-0 text-[11px] font-semibold text-[#155D3B] underline disabled:cursor-wait disabled:opacity-60"
                  >
                    Retry
                  </button>
                ) : undefined
              }
            >
              <input
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
                aria-describedby={mode === "edit" ? "idNumber-help" : undefined}
                autoComplete="off"
                className={`${floatingControlClass} read-only:cursor-not-allowed read-only:text-[#64748B]`}
              />
            </FloatingField>
            {mode === "edit" && (
              <p id="idNumber-help" className="mt-1 text-[11px] text-[#64748B]">
                Account IDs are generated automatically and cannot be edited.
              </p>
            )}
          </div>

          <FloatingField
            id="fullName"
            label="Full Name"
            error={formErrors.fullName}
          >
            <input
              id="fullName"
              name="fullName"
              type="text"
              value={formData.fullName}
              aria-invalid={Boolean(formErrors.fullName)}
              aria-describedby={formErrors.fullName ? "fullName-error" : undefined}
              autoComplete="name"
              autoCapitalize="words"
              onChange={(event) => updateField("fullName", event.target.value)}
              className={floatingControlClass}
            />
          </FloatingField>

          <FloatingField
            id="email"
            label="Email Address"
            error={formErrors.email}
          >
            <input
              id="email"
              name="email"
              type="email"
              value={formData.email}
              aria-invalid={Boolean(formErrors.email)}
              aria-describedby={formErrors.email ? "email-error" : undefined}
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              onChange={(event) => updateField("email", event.target.value)}
              className={floatingControlClass}
            />
          </FloatingField>

          <FloatingField id="role" label="Role" error={formErrors.role}>
            <select
              id="role"
              name="role"
              value={formData.role}
              onChange={(event) => updateField("role", event.target.value)}
              className={floatingControlClass}
            >
              {memberRoles.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </FloatingField>

          {isMemberAccount && (
            <FloatingField
              id="membershipType"
              label="Membership Type"
              error={formErrors.membershipType}
            >
              <select
                id="membershipType"
                name="membershipType"
                value={formData.membershipType ?? ""}
                aria-invalid={Boolean(formErrors.membershipType)}
                aria-describedby={formErrors.membershipType ? "membershipType-error" : undefined}
                onChange={(event) => updateField("membershipType", event.target.value)}
                className={floatingControlClass}
              >
                <option value="">Select membership type</option>
                {membershipTypeOptions.map((membershipType) => (
                  <option key={membershipType.value} value={membershipType.value}>
                    {membershipType.label}
                  </option>
                ))}
              </select>
            </FloatingField>
          )}

          {isRegularMembership && (
            <FloatingField
              id="department"
              label="Department"
              error={formErrors.department}
            >
              <input
                id="department"
                name="department"
                type="text"
                value={formData.department}
                aria-invalid={Boolean(formErrors.department)}
                aria-describedby={formErrors.department ? "department-error" : undefined}
                onChange={(event) => updateField("department", event.target.value)}
                className={floatingControlClass}
              />
            </FloatingField>
          )}
          {isMemberAccount && !isRegularMembership && (
            <div className="hidden sm:block" aria-hidden="true" />
          )}

          {mode === "add" && (
            <>
              <FloatingField
                id="temporaryPassword"
                label="Temporary Password"
                error={formErrors.temporaryPassword}
              >
                <div className="relative">
                  <input
                    id="temporaryPassword"
                    name="temporaryPassword"
                    type={showTemporaryPassword ? "text" : "password"}
                    value={temporaryPassword}
                    aria-invalid={Boolean(formErrors.temporaryPassword)}
                    aria-describedby={`password-requirements${formErrors.temporaryPassword ? " temporaryPassword-error" : ""}`}
                    onChange={(event) => {
                      setTemporaryPassword(event.target.value);
                      setTouchedFields((current) => ({
                        ...current,
                        temporaryPassword: true,
                      }));
                    }}
                    className={`${floatingControlClass} pr-10`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowTemporaryPassword((current) => !current)}
                    className="absolute inset-y-0 right-3 flex items-center text-[#6B7280]"
                    aria-label={
                      showTemporaryPassword
                        ? "Hide temporary password"
                        : "Show temporary password"
                    }
                  >
                    {showTemporaryPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </FloatingField>

              <FloatingField
                id="confirmPassword"
                label="Confirm Temporary Password"
                error={formErrors.confirmPassword}
              >
                <div className="relative">
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmTemporaryPassword}
                    aria-invalid={Boolean(formErrors.confirmPassword)}
                    aria-describedby={`password-requirements${formErrors.confirmPassword ? " confirmPassword-error" : ""}`}
                    onChange={(event) => {
                      setConfirmTemporaryPassword(event.target.value);
                      setTouchedFields((current) => ({
                        ...current,
                        confirmPassword: true,
                      }));
                    }}
                    className={`${floatingControlClass} pr-10`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((current) => !current)}
                    className="absolute inset-y-0 right-3 flex items-center text-[#6B7280]"
                    aria-label={
                      showConfirmPassword
                        ? "Hide confirmed password"
                        : "Show confirmed password"
                    }
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </FloatingField>

              <div className="col-span-full rounded-[9px] border border-[#E1E7EF] bg-[#F8FAFC] p-3">
                <p id="password-requirements-label" className="mb-2 text-[12px] font-semibold text-[#374151]">Temporary password requirements</p>
                <ul id="password-requirements" aria-labelledby="password-requirements-label" className="grid gap-1.5 text-[11px] sm:grid-cols-2">
                  {passwordRequirements.map(({ label, met }) => (
                    <li key={label} className={`flex items-center gap-2 ${met ? "text-[#155D3B]" : temporaryPassword || confirmTemporaryPassword ? "text-[#B91C1C]" : "text-[#64748B]"}`}>
                      {met ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <Circle className="h-3.5 w-3.5" aria-hidden="true" />}
                      <span>{met ? "Met: " : "Required: "}{label}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="col-span-full flex items-center gap-2">
                <Info className="h-4 w-4 shrink-0 text-[#155D3B]" aria-hidden="true" />
                <p className="text-[11px] leading-4 font-medium text-[#647084]">
                  Provide the temporary login credentials privately to the account holder.
                </p>
              </div>

              <label className="col-span-full flex items-center gap-2.5 rounded-[9px] border border-[#E5D9C2] bg-[#F8F9FB] px-3 py-2">
                <input
                  type="checkbox"
                  checked={identityVerified}
                  onChange={(event) => {
                    setIdentityVerified(event.target.checked);
                    setTouchedFields((current) => ({ ...current, identityVerified: true }));
                  }}
                  className="h-4 w-4 shrink-0 rounded border-[#D1D5DB] text-[#155D3B] focus:ring-[#155D3B]/20"
                />
                <span className="text-[12px] font-medium text-[#374151]">
                  I confirm this person&apos;s identity has been verified.
                </span>
              </label>
              {formErrors.identityVerified && (
                <p className="col-span-full text-[11px] font-medium text-[#DC2626]">
                  {formErrors.identityVerified}
                </p>
              )}
            </>
          )}
          {!canSubmit && (Object.keys(touchedFields).length > 0 || submitAttempted) && (
            <div className="col-span-full rounded-[9px] border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[11px] text-[#B91C1C]" aria-live="polite">
              <p className="font-semibold">Complete these requirements to enable {mode === "add" ? "Create Account" : "Save Changes"}:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {Object.entries(validationErrors).map(([field, message]) => <li key={field}>{message}</li>)}
              </ul>
            </div>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-[#E5E7EB] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="h-[44px] min-w-[140px] rounded-[9px] border border-[#D9DFE8] bg-white px-5 text-[14px] font-semibold text-[#344154] transition-colors hover:bg-[#F9FAFB]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="h-[44px] min-w-[140px] rounded-[9px] bg-gradient-to-r from-[#0E2E43] to-[#155D3B] px-5 text-[14px] font-semibold text-white transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:from-[#9CA3AF] disabled:to-[#9CA3AF]"
          >
            {mode === "add" ? "Create Account" : "Save Changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
