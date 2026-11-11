import type { CSSProperties } from "react";

export const chartAxisText = {
  fill: "var(--text-muted)",
  fontSize: "var(--font-size-caption)",
};

export const chartTooltipStyle: CSSProperties = {
  background: "var(--surface-card)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-control)",
  boxShadow: "var(--shadow-dropdown)",
  color: "var(--text-primary)",
  fontSize: "var(--font-size-caption)",
  padding: "var(--space-2) var(--space-3)",
  whiteSpace: "normal",
  overflowWrap: "anywhere",
};
