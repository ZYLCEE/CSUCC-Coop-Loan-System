import type { ComponentPropsWithRef, ReactNode } from "react";

type FieldSize = "default" | "compact";
const fieldClass = (size: FieldSize, className: string) =>
  `ui-field ${size === "compact" ? "ui-field--compact" : ""} ${className}`;

type InputProps = Omit<ComponentPropsWithRef<"input">, "size"> & {
  size?: FieldSize;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  wrapperClassName?: string;
};

export function Input({
  size = "default", className = "", leadingIcon, trailingIcon, wrapperClassName = "", ...props
}: InputProps) {
  if (!leadingIcon && !trailingIcon) {
    return <input {...props} className={fieldClass(size, className)} />;
  }
  return (
    <span className={`ui-field-group ${wrapperClassName}`}>
      {leadingIcon && <span className="ui-field-icon" aria-hidden="true">{leadingIcon}</span>}
      <input {...props} className={fieldClass(size, `w-full ${leadingIcon ? "ps-10" : ""} ${trailingIcon ? "pe-10" : ""} ${className}`)} />
      {trailingIcon && <span className="ui-field-icon ui-field-icon--trailing" aria-hidden="true">{trailingIcon}</span>}
    </span>
  );
}

export function Select({
  size = "default", className = "", ...props
}: Omit<ComponentPropsWithRef<"select">, "size"> & { size?: FieldSize }) {
  return <select {...props} className={fieldClass(size, className)} />;
}

export function Textarea({ className = "", ...props }: ComponentPropsWithRef<"textarea">) {
  return <textarea {...props} className={`ui-field ${className}`} />;
}
