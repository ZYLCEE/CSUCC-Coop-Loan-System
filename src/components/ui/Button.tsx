import type { ComponentPropsWithRef } from "react";
import { LoaderCircle } from "lucide-react";
import { buttonStyles, type ButtonSize, type ButtonVariant } from "./buttonStyles";

type ButtonProps = ComponentPropsWithRef<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
};

export function Button({
  variant, size, loading = false, disabled, className = "", type = "button", children, ...props
}: ButtonProps) {
  return (
    <button {...props} type={type} disabled={disabled || loading} aria-busy={loading || props["aria-busy"]}
      className={`${buttonStyles(variant, size)} ${className}`}>
      {loading && <LoaderCircle className="size-icon-compact animate-spin motion-reduce:animate-none" aria-hidden="true" />}
      {children}
    </button>
  );
}
