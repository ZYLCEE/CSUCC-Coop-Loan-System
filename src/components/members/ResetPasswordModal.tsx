"use client";

import { FormEvent, useState } from "react";
import { Eye, EyeOff, KeyRound, X } from "lucide-react";
import { Member } from "./MembersData";

interface ResetPasswordModalProps {
  member: Member;
  onClose: () => void;
  onSubmit: (temporaryPassword: string) => void;
}

const passwordPolicy = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

export default function ResetPasswordModal({
  member,
  onClose,
  onSubmit,
}: ResetPasswordModalProps) {
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const passwordsMatch =
    confirmPassword.length === 0 || temporaryPassword === confirmPassword;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!passwordPolicy.test(temporaryPassword) || temporaryPassword !== confirmPassword) {
      return;
    }
    onSubmit(temporaryPassword);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#111827]/50 p-4">
      <section
        className="w-full max-w-[480px] rounded-[14px] border border-[#E5E7EB] bg-white shadow-[0_24px_60px_rgba(15,23,42,0.24)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-password-title"
      >
        <header className="flex items-center justify-between border-b border-[#E5E7EB] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <KeyRound className="h-5 w-5 text-[#155D3B]" aria-hidden="true" />
            <h2 id="reset-password-title" className="text-[17px] font-bold text-[#1F2937]">
              Reset Member Password
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[#6B7280] hover:bg-[#F1F5F9]"
            aria-label="Close reset password form"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <form onSubmit={submit} className="space-y-4 px-5 py-5">
          <p className="text-[13px] leading-5 text-[#64748B]">
            Set a temporary password for {member.fullName}. Share it privately with the
            member.
          </p>

          <label className="block space-y-1.5">
            <span className="text-[12px] font-semibold text-[#374151]">
              Temporary Password
            </span>
            <span className="relative block">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
                value={temporaryPassword}
                onChange={(event) => setTemporaryPassword(event.target.value)}
                className="h-11 w-full rounded-[8px] border border-[#D1D5DB] bg-white px-3 pr-11 text-[13px] text-[#111827] outline-none focus:border-[#155D3B] focus:ring-2 focus:ring-[#155D3B]/15"
                aria-describedby="reset-password-policy"
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-[#64748B]"
                aria-label={showPassword ? "Hide temporary password" : "Show temporary password"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </span>
          </label>

          <label className="block space-y-1.5">
            <span className="text-[12px] font-semibold text-[#374151]">
              Confirm Temporary Password
            </span>
            <span className="relative block">
              <input
                type={showConfirmPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="h-11 w-full rounded-[8px] border border-[#D1D5DB] bg-white px-3 pr-11 text-[13px] text-[#111827] outline-none focus:border-[#155D3B] focus:ring-2 focus:ring-[#155D3B]/15"
                aria-invalid={!passwordsMatch}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((visible) => !visible)}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-[#64748B]"
                aria-label={
                  showConfirmPassword
                    ? "Hide password confirmation"
                    : "Show password confirmation"
                }
              >
                {showConfirmPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </span>
            {!passwordsMatch && (
              <span className="block text-[11px] text-[#B91C1C]" role="alert">
                Passwords do not match.
              </span>
            )}
          </label>

          <p id="reset-password-policy" className="text-[11px] leading-4 text-[#64748B]">
            Use at least 8 characters, including an uppercase letter, a lowercase letter,
            and a number.
          </p>

          <footer className="flex justify-end gap-2 border-t border-[#E5E7EB] pt-4">
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-[8px] border border-[#D1D5DB] bg-white px-4 text-[13px] font-semibold text-[#374151] hover:bg-[#F8FAFC]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!passwordPolicy.test(temporaryPassword) || !passwordsMatch}
              className="h-10 rounded-[8px] bg-[#155D3B] px-4 text-[13px] font-semibold text-white hover:bg-[#104B30] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continue to Verify
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
