"use client";

import { LucideIcon } from "lucide-react";
import SaveButton from "./SaveButton";

interface SettingsCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  children: React.ReactNode;
  lastUpdated?: string;
  updatedBy?: string;
  onSave?: () => void;
  saveLabel?: string;
}

export default function SettingsCard({
  icon: Icon,
  title,
  description,
  children,
  lastUpdated,
  updatedBy,
  onSave,
  saveLabel,
}: SettingsCardProps) {
  return (
    <div className="bg-white rounded-[18px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] border border-[#E5E7EB] p-6">
      {/* Header */}
      <div className="flex items-start gap-4 mb-6 pb-6 border-b border-[#E5E7EB]">
        <div className="w-12 h-12 rounded-xl bg-[#DCFCE7] flex items-center justify-center flex-shrink-0">
          <Icon className="w-6 h-6 text-[#166534]" strokeWidth={2} />
        </div>
        <div className="flex-1">
          <h3 className="text-[18px] font-semibold text-[#111827]">{title}</h3>
          <p className="text-[14px] text-[#6B7280] mt-1">{description}</p>
        </div>
      </div>

      {/* Content */}
      <div className="space-y-6">{children}</div>

      {/* Footer */}
      {(lastUpdated || updatedBy || onSave) && (
        <div className="flex items-center justify-between mt-6 pt-6 border-t border-[#E5E7EB]">
          <div className="text-[13px] text-[#6B7280]">
            {lastUpdated && <p>Last Updated: {lastUpdated}</p>}
            {updatedBy && <p>Updated By: {updatedBy}</p>}
          </div>
          {onSave && <SaveButton onClick={onSave} label={saveLabel} />}
        </div>
      )}
    </div>
  );
}
