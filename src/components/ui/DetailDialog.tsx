"use client";
import { FileText } from "lucide-react";
import { ActionDialog, type ActionDialogProps } from "./ActionDialog";
export function DetailDialog(props: ActionDialogProps) {
  return <ActionDialog icon={FileText} {...props} />;
}
