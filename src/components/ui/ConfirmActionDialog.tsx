"use client";

import { useRef, useState, type ReactNode } from "react";
import { CircleHelp, TriangleAlert } from "lucide-react";
import { ActionDialog, type ActionDialogProps } from "./ActionDialog";
import { Button } from "./Button";

export function ActionSummary({ details }: { details: Array<{ label: string; value: ReactNode }> }) {
  return <dl className="ui-action-summary">{details.map(({ label, value }) => <div key={label}>
    <dt>{label}</dt><dd>{value}</dd>
  </div>)}</dl>;
}

export function ConfirmActionDialog({ title, question, details, children, confirmLabel, cancelLabel = "Cancel",
  onConfirm, onClose, busy = false, disabled = false, error, tone = "primary", ...props
}: Omit<ActionDialogProps, "children" | "footer"> & {
  question: ReactNode;
  details?: Array<{ label: string; value: ReactNode }>;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
  disabled?: boolean;
  error?: string;
}) {
  const pending = useRef(false);
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState("");
  const locked = busy || working;
  const confirm = async () => {
    if (pending.current || busy || disabled) return;
    pending.current = true; setWorking(true); setFailure("");
    try { await onConfirm(); }
    catch (error) { setFailure(error instanceof Error ? error.message : "The action could not be completed. Please retry."); }
    finally { pending.current = false; setWorking(false); }
  };
  return <ActionDialog {...props} title={title} tone={tone} className={props.className ?? "max-w-[480px]"}
    icon={props.icon ?? (tone === "destructive" || tone === "warning" ? TriangleAlert : CircleHelp)} busy={locked} onClose={onClose}
    footer={<><Button disabled={locked} onClick={onClose}>{cancelLabel}</Button>
      <Button variant={tone === "destructive" ? "destructive" : tone === "warning" ? "warning" : "primary"}
        loading={locked} disabled={disabled} onClick={() => void confirm()}>{locked ? "Please wait…" : confirmLabel}</Button></>}>
    <div className="space-y-4"><div className="text-body leading-relaxed text-portal-muted">{question}</div>
      {(error || failure) && <p role="alert" className="ui-action-feedback ui-action-feedback--error">{error || failure}</p>}
      {details?.length ? <ActionSummary details={details} /> : null}{children}
    </div>
  </ActionDialog>;
}
