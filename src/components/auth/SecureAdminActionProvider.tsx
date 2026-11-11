"use client";

import {
  createContext,
  FormEvent,
  ReactNode,
  useContext,
  useRef,
  useState,
} from "react";
import { Eye, EyeOff, FileCheck2, ShieldCheck, XCircle, type LucideIcon } from "lucide-react";
import { invokeProtectedAction } from "@/lib/protectedAction";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Fields";
import { ActionDialog } from "@/components/ui/ActionDialog";
import { ActionSummary, ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import { ActionResultDialog } from "@/components/ui/ActionResultDialog";
import { useAdminAuth } from "@/components/auth/AdminAuthProvider";

export interface SecureActionRequest {
  action: string;
  target: string;
  title: string;
  question: string;
  confirmLabel: string;
  successMessage: string;
  successTitle?: string;
  securityTitle?: string;
  securityDescription?: string;
  securityDetails?: Array<{ label: string; value: string }>;
  icon?: LucideIcon;
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
  const { role, can } = useAdminAuth();
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
  const actionTrigger = useRef<HTMLElement | null>(null);

  const beginSecureAction = (nextRequest: SecureActionRequest) => {
    if (!enabled || (role !== "super_admin" && !(nextRequest.action === "send-notification" && can("notifications.send")))) {
      return;
    }
    if (busyRef.current || request) {
      return;
    }
    actionTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
      const { data, error: invokeError } = await invokeProtectedAction({
        mode: "verify",
        action: request.action,
        target: request.target,
        payload: request.payload,
        secret: request.secret,
        password: securityPassword,
      });

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
      const { data, error: invokeError } = await invokeProtectedAction({
        mode: "execute",
        action: request.action,
        target: request.target,
        payload: request.payload,
        secret: request.secret,
        grant,
      });

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
          message:(typeof actionResult.message === "string"?actionResult.message:request.successMessage)+(typeof data.warning==="string"?" "+data.warning:""),
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

  const visible = enabled && !!request && (role === "super_admin" || (request.action === "send-notification" && can("notifications.send")));
  const passwordInput = useRef<HTMLInputElement>(null);
  const tone = request?.action === "delete-account" || request?.action === "block-account" || request?.action === "reject-loan" ? "destructive" : "primary";

  return (
    <SecureAdminActionContext.Provider value={{ beginSecureAction }}>
      {children}
      {visible && request && stage === "security" && (
        <ActionDialog title={request.securityTitle ?? `Verify to ${request.action.replaceAll("-", " ")}`} subtitle={request.securityTitle ? request.title : undefined} icon={ShieldCheck}
          className="max-w-[480px]" busy={busy} onClose={cancel} closeLabel="Cancel action" returnFocusRef={actionTrigger}
          footer={<><Button disabled={busy} onClick={cancel}>Cancel</Button>
            <Button variant="primary" loading={busy} type="submit" form="secure-action-password" disabled={!securityPassword}>Verify password</Button></>}>
          <form id="secure-action-password" onSubmit={verifyIdentity} className="space-y-4">
            <p className="text-support text-portal-muted">{request.securityDescription ?? "Enter your account password to confirm this action."}</p>
            {!!request.securityDetails?.length && <ActionSummary details={request.securityDetails} />}
            <label className="block space-y-1.5">
              <span className="text-label">{request.securityTitle ? "Your Super Admin Password" : "Password"} <span className="text-status-danger">*</span></span>
              <span className="relative block">
                <Input ref={passwordInput} data-dialog-autofocus required disabled={busy} aria-invalid={!!error}
                  aria-describedby={error ? "secure-action-password-error" : undefined}
                  type={showPassword ? "text" : "password"} autoComplete="current-password"
                  value={securityPassword} onChange={event => setSecurityPassword(event.target.value)} className="w-full pr-11" />
                <button type="button" disabled={busy} onClick={() => setShowPassword(visible => !visible)}
                  className="ui-icon-button ui-button--ghost absolute inset-y-0 end-0 border-transparent"
                  aria-label={showPassword ? "Hide password" : "Show password"}>
                  {showPassword ? <EyeOff className="size-icon-compact" aria-hidden="true" /> : <Eye className="size-icon-compact" aria-hidden="true" />}
                </button>
              </span>
            </label>
            {error && <p id="secure-action-password-error" role="alert" className="ui-action-feedback ui-action-feedback--error">{error}</p>}
          </form>
        </ActionDialog>
      )}
      {visible && request && stage === "confirmation" && (
        <ConfirmActionDialog icon={request.icon ?? (request.action === "reject-loan" ? XCircle : request.action === "approve-loan" || request.action === "review-loan" ? FileCheck2 : undefined)} title={request.title} question={request.question} details={request.details}
          confirmLabel={request.confirmLabel} tone={tone} busy={busy} disabled={!grant}
          onClose={cancel} onConfirm={executeAction} returnFocusRef={actionTrigger} />
      )}
      {visible && stage === "result" && result && (
        <ActionResultDialog title={result.success ? request?.successTitle ?? "Success" : "Action Failed"} success={result.success}
          message={result.message} showClose={false} closeOnEscape={false} onClose={finish} returnFocusRef={actionTrigger} />
      )}
    </SecureAdminActionContext.Provider>
  );
}

export function useSecureAdminAction() {
  const context = useContext(SecureAdminActionContext);
  if (!context) throw new Error("useSecureAdminAction must be used inside SecureAdminActionProvider.");
  return context;
}
