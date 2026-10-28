"use client";

import { Save } from "lucide-react";

interface SaveButtonProps {
  onClick: () => void;
  label?: string;
}

export default function SaveButton({ onClick, label = "Save Settings" }: SaveButtonProps) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-6 h-[44px] bg-[#166534] rounded-[12px] text-[15px] font-semibold text-white hover:bg-[#14532D] transition-colors"
    >
      <Save className="w-4 h-4" />
      {label}
    </button>
  );
}
