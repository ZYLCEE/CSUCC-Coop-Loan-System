import { buttonStyles } from "@/components/ui/buttonStyles";

export function actionButtonStyles(variant: "primary" | "secondary" | "danger" = "secondary", size: "sm" | "xs" = "sm") {
  return buttonStyles(variant === "danger" ? "destructive" : variant, size === "xs" ? "dense" : "compact");
}
