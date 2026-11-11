import type { ComponentPropsWithoutRef } from "react";

export function DataTable({
  label, className = "", scrollClassName = "", density = "default", ...props
}: ComponentPropsWithoutRef<"table"> & { label: string; scrollClassName?: string; density?: "default" | "compact" }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className={`ui-table-scroll ${scrollClassName}`}>
      <table {...props} className={`ui-table ${density === "compact" ? "ui-table--compact" : ""} ${className}`} />
    </div>
  );
}
