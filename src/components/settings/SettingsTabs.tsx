"use client";

const tabs = [
  "General",
  "Loan Policy",
  "Feature Toggles",
  "Security",
  "Roles & Permissions",
  "Backup",
];

interface SettingsTabsProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export default function SettingsTabs({ activeTab, onTabChange }: SettingsTabsProps) {
  return (
    <div className="bg-white rounded-[14px] shadow-[0_2px_10px_rgba(0,0,0,0.05)] border border-[#E5E7EB] p-2 mb-4">
      <div className="flex items-center gap-2 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            className={`px-3 py-1.5 rounded-full text-[12px] font-medium whitespace-nowrap transition-colors ${
              activeTab === tab
                ? "bg-[#1F6B3A] text-white"
                : "bg-transparent text-[#6B7280]"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>
    </div>
  );
}
