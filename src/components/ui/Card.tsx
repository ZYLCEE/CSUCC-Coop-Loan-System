import type { ComponentPropsWithoutRef } from "react";

export function Card({
  as: Element = "section", padded = true, className = "", ...props
}: ComponentPropsWithoutRef<"section"> & { as?: "section" | "article" | "div"; padded?: boolean }) {
  return <Element {...props} className={`ui-card ${padded ? "ui-card-padding" : ""} ${className}`} />;
}
