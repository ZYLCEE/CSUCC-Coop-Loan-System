"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, LockKeyhole } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import { getAdminDashboardPath, getAdminRole } from "@/lib/auth/roles";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");
    setLoading(true);

    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error || !data.user) {
        setErrorMessage(
          error?.message === "Invalid login credentials"
            ? "Email or password is incorrect. If you just created this user, reset its password in Supabase Auth and try again."
            : error?.message ?? "Unable to sign in right now."
        );
        return;
      }

      const role = getAdminRole(data.user);
      if (!role) {
        await supabase.auth.signOut();
        setErrorMessage("This account is not authorized for the admin portal.");
        return;
      }

      const metadataStatus = data.user.app_metadata.account_status;
      if (metadataStatus && metadataStatus !== "active") {
        await supabase.auth.signOut();
        setErrorMessage("This account is blocked or inactive. Please contact your system administrator.");
        return;
      }

      setPassword("");
      router.replace(getAdminDashboardPath(role));
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to sign in right now."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F5F6F8] px-4 py-8">
      <form
        onSubmit={submit}
        className="w-full max-w-[440px] rounded-[14px] border border-[#E1E7EF] bg-white p-7 shadow-[0_20px_50px_rgba(15,23,42,0.12)]"
      >
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#155D3B]/10 text-[#155D3B]">
            <LockKeyhole className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[#0F172A]">CSUCC MPC Admin Portal</h1>
            <p className="mt-1 text-sm text-[#64748B]">
              Sign in to access your administrative dashboard.
            </p>
          </div>
        </div>

        <label className="mb-4 block space-y-1.5">
          <span className="text-sm font-semibold text-[#334155]">Email Address</span>
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="h-11 w-full rounded-lg border border-[#D1D5DB] px-3 text-sm text-[#1F2937] outline-none focus:border-[#155D3B] focus:ring-2 focus:ring-[#155D3B]/15"
          />
        </label>

        <label className="mb-4 block space-y-1.5">
          <span className="text-sm font-semibold text-[#334155]">Password</span>
          <span className="relative block">
            <input
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-11 w-full rounded-lg border border-[#D1D5DB] px-3 pr-11 text-sm text-[#1F2937] outline-none focus:border-[#155D3B] focus:ring-2 focus:ring-[#155D3B]/15"
            />
            <button
              type="button"
              onClick={() => setShowPassword((shown) => !shown)}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-[#64748B]"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </span>
        </label>

        {errorMessage && (
          <p role="alert" className="mb-4 text-sm font-medium text-[#B91C1C]">
            {errorMessage}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !email.trim() || !password}
          className="h-11 w-full rounded-lg bg-[#155D3B] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#134A30] disabled:cursor-not-allowed disabled:bg-[#9CA3AF]"
        >
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </form>
    </main>
  );
}
