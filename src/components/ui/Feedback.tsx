import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Inbox, LoaderCircle, type LucideIcon } from "lucide-react";

export function ActionFeedback({ children, error = false, className = "" }: { children: ReactNode; error?: boolean; className?: string }) {
  const Icon = error ? CircleAlert : CircleCheck;
  return <div role={error ? "alert" : "status"} className={`ui-action-feedback ui-action-feedback--${error ? "error" : "success"} flex items-start gap-2 ${className}`}>
    <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><div className="min-w-0">{children}</div>
  </div>;
}

export function EmptyState({ title, description, action, icon: Icon = Inbox }: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="grid justify-items-center gap-2 px-4 py-6 text-center">
      <Icon className="size-icon text-portal-secondary" aria-hidden="true" />
      <p className="text-body font-semibold text-portal-primary">{title}</p>
      {description && <p className="text-support text-portal-secondary">{description}</p>}
      {action}
    </div>
  );
}

export function LoadingState({ label, children }: { label: string; children?: ReactNode }) {
  return children ? (
    <div role="status"><span className="sr-only">{label}</span>{children}</div>
  ) : (
    <div role="status" className="flex items-center justify-center gap-2 p-4 text-support text-portal-muted">
      <LoaderCircle className="size-icon animate-spin motion-reduce:animate-none" aria-hidden="true" />
      {label}
    </div>
  );
}
