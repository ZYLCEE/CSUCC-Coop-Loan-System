"use client";

interface FormFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  helperText?: string;
  required?: boolean;
  type?: "text" | "email" | "number" | "password";
}

export default function FormField({
  label,
  value,
  onChange,
  placeholder,
  helperText,
  required = false,
  type = "text",
}: FormFieldProps) {
  return (
    <div>
      <label className="block text-[12px] font-medium text-[#111827] mb-1.5">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-[40px] px-3 bg-white border border-[#D9DEE8] rounded-[12px] text-[14px] text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#166534]/20 focus:border-[#166534] transition-all"
      />
      {helperText && <p className="text-[11px] text-[#6B7280] mt-0.5">{helperText}</p>}
    </div>
  );
}
