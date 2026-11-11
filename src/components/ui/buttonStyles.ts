export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "destructive" | "warning";
export type ButtonSize = "default" | "compact" | "dense";

const variants: Record<ButtonVariant, string> = {
  primary: "ui-button--primary",
  secondary: "",
  outline: "ui-button--outline",
  ghost: "ui-button--ghost",
  destructive: "ui-button--destructive",
  warning: "ui-button--warning",
};

const sizes: Record<ButtonSize, string> = {
  default: "",
  compact: "ui-button--compact",
  dense: "ui-button--dense",
};

export function buttonStyles(variant: ButtonVariant = "secondary", size: ButtonSize = "default") {
  return `ui-button ${variants[variant]} ${sizes[size]}`;
}
