"use client";

import { CircleCheck, CircleAlert } from "lucide-react";
import { ActionDialog, type ActionDialogProps } from "./ActionDialog";
import { Button } from "./Button";

export function ActionResultDialog({ success, message, title, children, onClose, ...props }:
  Omit<ActionDialogProps, "title" | "children"> & { children?: ActionDialogProps["children"]; success: boolean; message: string; title?: string }) {
  return <ActionDialog {...props} title={title ?? (success ? "Action completed" : "Action could not be completed")}
    icon={success ? CircleCheck : CircleAlert} tone={success ? "success" : "destructive"}
    className={props.className ?? "max-w-[480px]"} onClose={onClose}
    footer={props.footer ?? <Button variant="primary" onClick={onClose}>OK</Button>}>
    <p role={success ? "status" : "alert"} className={`ui-action-feedback ui-action-feedback--${success ? "success" : "error"}`}>{message}</p>
    {children && <div className="mt-4">{children}</div>}
  </ActionDialog>;
}
