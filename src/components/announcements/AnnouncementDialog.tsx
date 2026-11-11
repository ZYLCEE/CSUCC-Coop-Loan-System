"use client";

import type { ReactNode } from "react";
import { DetailDialog } from "@/components/ui/DetailDialog";
import { Megaphone } from "lucide-react";

export default function AnnouncementDialog({ title, children, footer, onClose, busy = false, wide = false }: {
  title: string; children: ReactNode; footer?: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean;
}) {
  return (
    <DetailDialog icon={Megaphone} title={title} onClose={onClose} busy={busy} footer={footer}
      closeLabel="Close announcement panel" className={wide ? "max-w-[1080px]" : "max-w-[720px]"}>
      {children}
    </DetailDialog>
  );
}
