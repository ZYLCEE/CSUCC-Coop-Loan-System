"use client";

import {
  createContext,
  FormEvent,
  ReactNode,
  useContext,
  useRef,
  useState,
} from "react";
import { Eye, EyeOff, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import { useAdminAuth } from "@/components/auth/AdminAuthProvider";

export interface SecureActionRequest {
  action: string;
  target: string;
  title: string;
  question: string;
  confirmLabel: string;
  successMessage: string;
  payload: Record<string, unknown>;
  secret?: Record<string, unknown>;
  details?: Array<{ label: string; value: string }>;
  onSuccess?: (result: Record<string, unknown>) => void;
  onFailure?: (message: string) => void;
  onCancel?: () => void;
}

interface SecureAdminActionContextValue {
  beginSecureAction: (request: SecureActionRequest) => void;
}

type WorkflowStage = "security" | "confirmation" | "result";

const SecureAdminActionContext =
  createContext<SecureAdminActionContextValue | null>(null);

export function SecureAdminActionProvider({
  children,
  enabled = true,
}: {
  children: ReactNode;
  enabled?: boolean;
}) {
  const { role } = useAdminAuth();
  const [request, setRequest] = useState<SecureActionRequest | null>(null);
  const [stage, setStage] = useState<WorkflowStage>("security");
  const [grant, setGrant] = useState<string | null>(null);
  const [securityPassword, setSecurityPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [error, setError] = useState("");
  const busyRef = useRef(false);

  const beginSecureAction = (nextRequest: SecureActionRequest) => {
    if (!enabled || role !== "super_admin") {
      return;
    }
    if (busyRef.current || request) {
      return;
    }
    setRequest(nextRequest);
    setStage("security");
    setGrant(null);
    setSecurityPassword("");
    setError("");
    setResult(null);
  };

  const finish = () => {
    setRequest(null);
    setGrant(null);
    setSecurityPassword("");
    setShowPassword(false);
    setError("");
    setResult(null);
    busyRef.current = false;
  };

  const cancel = () => {
    if (busyRef.current) {
      return;
    }
    request?.onCancel?.();
    setRequest(null);
    setGrant(null);
    setSecurityPassword("");
    setShowPassword(false);
    setError("");
    setResult(null);
  };

  const getActionError = (data: unknown, fallback: string) => {
    if (
      typeof data === "object" &&
      data !== null &&
      "error" in data &&
      typeof data.error === "string"
    ) {
      return data.error;
    }
    return fallback;
  };

  const getInvokeError = async (
    invokeError: unknown,
    data: unknown,
    fallback: string
  ) => {
    const response =
      typeof invokeError === "object" &&
      invokeError !== null &&
      "context" in invokeError &&
      invokeError.context instanceof Response
        ? invokeError.context
        : null;
    if (response) {
      try {
        return getActionError(await response.clone().json(), fallback);
      } catch {
        return fallback;
      }
    }
    return getActionError(data, fallback);
  };

  const verifyIdentity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!request || !securityPassword || busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");

    try {
      const { data, error: invokeError } = await getSupabaseClient().functions.invoke(
        "secure-admin-action",
        {
          body: {
            mode: "verify",
            action: request.action,
            target: request.target,
            payload: request.payload,
            secret: request.secret,
            password: securityPassword,
          },
        }
      );

      if (invokeError || !data?.grant) {
        setError(
          await getInvokeError(
            invokeError,
            data,
            "Unable to verify your password. Please try again."
          )
        );
        return;
      }

      setGrant(data.grant as string);
      setSecurityPassword("");
      setStage("confirmation");
    } catch (invokeError) {
      setError(
        invokeError instanceof Error
          ? invokeError.message
          : "Unable to verify your password. Please try again."
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const executeAction = async () => {
    if (!request || !grant || busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");

    try {
      const { data, error: invokeError } = await getSupabaseClient().functions.invoke(
        "secure-admin-action",
        {
          body: {
            mode: "execute",
            action: request.action,
            target: request.target,
            payload: request.payload,
            secret: request.secret,
            grant,
          },
        }
      );

      if (invokeError || data?.success !== true) {
        const failureMessage = await getInvokeError(
          invokeError,
          data,
          "The action could not be completed."
        );
        request.onFailure?.(failureMessage);
        setResult({
          success: false,
          message: failureMessage,
        });
      } else {
        const actionResult =
          typeof data.result === "object" && data.result !== null
            ? (data.result as Record<string, unknown>)
            : {};
        request.onSuccess?.(actionResult);
        setResult({
          success: true,
          message:
            typeof actionResult.message === "string"
              ? actionResult.message
              : request.successMessage,
        });
      }
      setSecurityPassword("");
      setStage("result");
    } catch (invokeError) {
      setSecurityPassword("");
      setResult({
        success: false,
        message:
          invokeError instanceof Error
            ? invokeError.message
            : "The action could not be completed.",
      });
      request.onFailure?.(
        invokeError instanceof Error ? invokeError.message : "The action could not be completed."
      );
      setStage("result");
    } finally {
      setRequest((current) =>
        current ? { ...current, secret: undefined } : null
      );
      setGrant(null);
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <SecureAdminActionContext.Provider value={{ beginSecureAction }}>
      {children}
      {enabled && role === "super_admin" && request && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-[#111827]/50 p-4"
          role="presentation"
        >
          <section
            className="w-full max-w-[440px] rounded-[14px] border border-[#E5E7EB] bg-white shadow-[0_24px_60px_rgba(15,23,42,0.28)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="secure-action-title"
          >
            <header className="flex items-center justify-between border-b border-[#E5E7EB] px-5 py-4">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="h-5 w-5 text-[#155D3B]" aria-hidden="true" />
                <h2
                  id="secure-action-title"
                  className="text-[17px] font-bold text-[#1F2937]"
                >
                  {stage === "security"
                    ? `Verify to ${request.action.replaceAll("-", " ")}`
                    : stage === "confirmation"
                      ? request.title
                      : result?.success
                        ? "Success"
                        : "Action Failed"}
                </h2>
              </div>
              {!busy && stage !== "result" && (
                <button
                  type="button"
                  onClick={cancel}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-[#6B7280] hover:bg-[#F1F5F9]"
                  aria-label="Cancel action"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </header>

            {stage === "security" && (
              <form onSubmit={verifyIdentity} className="space-y-4 px-5 py-5">
                <p className="text-[13px] text-[#64748B]">
                  Enter your account password to confirm this action.
                </p>
                <label className="block space-y-1.5">
                  <span className="text-[12px] font-semibold text-[#374151]">
                    Password <span className="text-[#DC2626]">*</span>
                  </span>
                  <span className="relative block">
                    <input
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      value={securityPassword}
                      onChange={(event) => setSecurityPassword(event.target.value)}
                      className="h-11 w-full rounded-[9px] border border-[#D1D5DB] px-3 pr-11 text-[14px] text-[#1F2937] outline-none focus:border-[#155D3B] focus:ring-2 focus:ring-[#155D3B]/15"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((visible) => !visible)}
                      className="absolute inset-y-0 right-3 flex items-center text-[#64748B]"
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
                {error && (
                  <p role="alert" className="text-[12px] font-medium text-[#B91C1C]">
                    {error}
                  </p>
                )}
                <footer className="flex justify-end gap-2 border-t border-[#E5E7EB] pt-4">
                  <button
                    type="button"
                    onClick={cancel}
                    disabled={busy}
                    className="h-10 rounded-lg border border-[#D1D5DB] px-4 text-[13px] font-semibold text-[#374151] hover:bg-[#F8FAFC]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy || !securityPassword}
                    className="flex h-10 min-w-[112px] items-center justify-center gap-2 rounded-lg bg-[#155D3B] px-4 text-[13px] font-semibold text-white hover:bg-[#134A30] disabled:cursor-not-allowed disabled:bg-[#9CA3AF]"
                  >
                    {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
                    Confirm
                  </button>
                </footer>
              </form>
            )}

            {stage === "confirmation" && (
              <div className="space-y-4 px-5 py-5">
                <p className="text-[14px] text-[#374151]">{request.question}</p>
                {request.details && request.details.length > 0 && (
                  <dl className="space-y-2 rounded-lg bg-[#F8FAFC] p-3 text-[13px]">
                    {request.details.map((detail) => (
                      <div key={detail.label} className="flex gap-2">
                        <dt className="font-semibold text-[#1F2937]">
                          {detail.label}:
                        </dt>
                        <dd className="break-all text-[#475569]">{detail.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <footer className="flex justify-end gap-2 border-t border-[#E5E7EB] pt-4">
                  <button
                    type="button"
                    onClick={cancel}
                    disabled={busy}
                    className="h-10 rounded-lg border border-[#D1D5DB] px-4 text-[13px] font-semibold text-[#374151] hover:bg-[#F8FAFC]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void executeAction()}
                    disabled={busy || !grant}
                    className="flex h-10 min-w-[130px] items-center justify-center gap-2 rounded-lg bg-[#155D3B] px-4 text-[13px] font-semibold text-white hover:bg-[#134A30] disabled:cursor-not-allowed disabled:bg-[#9CA3AF]"
                  >
                    {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
                    {request.confirmLabel}
                  </button>
                </footer>
              </div>
            )}

            {stage === "result" && result && (
              <div className="space-y-5 px-5 py-5">
                <p
                  role={result.success ? "status" : "alert"}
                  className={`text-[14px] ${
                    result.success ? "text-[#374151]" : "font-medium text-[#B91C1C]"
                  }`}
                >
                  {result.message}
                </p>
                <footer className="flex justify-end border-t border-[#E5E7EB] pt-4">
                  <button
                    type="button"
                    onClick={finish}
                    className="h-10 min-w-[92px] rounded-lg bg-[#155D3B] px-4 text-[13px] font-semibold text-white hover:bg-[#134A30]"
                  >
                    OK
                  </button>
                </footer>
              </div>
            )}
          </section>
        </div>
      )}
    </SecureAdminActionContext.Provider>
  );
}

export function useSecureAdminAction() {
  const context = useContext(SecureAdminActionContext);
  if (!context) {
    throw new Error(
      "useSecureAdminAction must be used inside SecureAdminActionProvider."
    );
  }
  return context;
}
