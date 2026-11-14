"use client";

import { FormEvent, useState } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { FormDialog } from "@/components/ui/FormDialog";
import { Member } from "./MembersData";

interface ResetPasswordModalProps {
  member: Member;
  onClose: () => void;
  onSubmit: (temporaryPassword: string) => void;
  busy?: boolean;
}

const passwordPolicy = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

export default function ResetPasswordModal({
  member,
  onClose,
  onSubmit,
  busy = false,
}: ResetPasswordModalProps) {
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const passwordsMatch =
    confirmPassword.length === 0 || temporaryPassword === confirmPassword;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !passwordPolicy.test(temporaryPassword) || temporaryPassword !== confirmPassword) {
      return;
    }
    onSubmit(temporaryPassword);
  };

  return (
    <FormDialog title="Reset Account Password" icon={KeyRound} subtitle={`${member.idNumber} · ${member.fullName}`}
      className="max-w-[480px]" busy={busy} dirty={!!temporaryPassword || !!confirmPassword} onClose={onClose}
      footer={<><button type="button" data-dialog-close disabled={busy} className="ui-button">Cancel</button>
        <button type="submit" form="reset-member-password" disabled={busy || !passwordPolicy.test(temporaryPassword) || temporaryPassword !== confirmPassword} className="ui-button ui-button--primary">Continue to Verify</button></>}>
        <form id="reset-member-password" onSubmit={submit} className="space-y-4">
          <p className="text-support text-portal-muted">
            Set a temporary password for {member.fullName}. Share it privately with the
            account holder.
          </p>

          <label className="block space-y-1.5">
            <span className="text-label">
              Temporary Password
            </span>
            <span className="relative block">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                disabled={busy}
                minLength={8}
                maxLength={128}
                value={temporaryPassword}
                onChange={(event) => setTemporaryPassword(event.target.value)}
                className="ui-field w-full pr-11"
                aria-describedby="reset-password-policy"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => setShowPassword((visible) => !visible)}
                className="ui-icon-button ui-button--ghost absolute inset-y-0 right-0 h-full"
                aria-label={showPassword ? "Hide temporary password" : "Show temporary password"}
              >
                {showPassword ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </button>
            </span>
          </label>

          <label className="block space-y-1.5">
            <span className="text-label">
              Confirm Temporary Password
            </span>
            <span className="relative block">
              <input
                type={showConfirmPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                disabled={busy}
                minLength={8}
                maxLength={128}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="ui-field w-full pr-11"
                aria-invalid={!passwordsMatch}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => setShowConfirmPassword((visible) => !visible)}
                className="ui-icon-button ui-button--ghost absolute inset-y-0 right-0 h-full"
                aria-label={
                  showConfirmPassword
                    ? "Hide password confirmation"
                    : "Show password confirmation"
                }
              >
                {showConfirmPassword ? (
                  <Eye className="h-4 w-4" />
                ) : (
                  <EyeOff className="h-4 w-4" />
                )}
              </button>
            </span>
            {!passwordsMatch && (
              <span className="block text-caption text-status-danger" role="alert">
                Passwords do not match.
              </span>
            )}
          </label>

          <p id="reset-password-policy" className="text-caption text-portal-secondary">
            Use at least 8 characters, including an uppercase letter, a lowercase letter,
            and a number.
          </p>

        </form>
    </FormDialog>
  );
}
