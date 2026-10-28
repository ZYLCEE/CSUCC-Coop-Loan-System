"use client";

interface ToggleSwitchProps {
  isOn: boolean;
  onToggle: () => void;
  label?: string;
  description?: string;
}

export default function ToggleSwitch({ isOn, onToggle, label, description }: ToggleSwitchProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        {label && <p className="text-[15px] font-medium text-[#111827]">{label}</p>}
        {description && <p className="text-[13px] text-[#6B7280] mt-0.5">{description}</p>}
      </div>
      <button
        onClick={onToggle}
        className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${
          isOn ? "bg-[#166534]" : "bg-gray-300"
        }`}
      >
        <span
          className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform duration-200 ${
            isOn ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}
