"use client";

import { useEffect, useState } from "react";
import { FilePenLine } from "lucide-react";
import { ActionDialog, type ActionDialogProps } from "./ActionDialog";
import { ConfirmActionDialog } from "./ConfirmActionDialog";

export function FormDialog({ dirty = false, onClose, busy, ...props }: ActionDialogProps & { dirty?: boolean }) {
  const [discard, setDiscard] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const preventUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [dirty]);
  const close = () => { if (!busy) { if (dirty) setDiscard(true); else onClose(); } };
  return <>
    <ActionDialog icon={FilePenLine} {...props} busy={busy} onClose={close} dismissOnBackdrop={false} />
    {discard && <ConfirmActionDialog title="Discard unsaved changes?" tone="destructive"
      question="Your changes have not been saved. Discard them and close this form?" confirmLabel="Discard changes"
      cancelLabel="Keep editing" busy={busy} onClose={() => setDiscard(false)} onConfirm={onClose} />}
  </>;
}
