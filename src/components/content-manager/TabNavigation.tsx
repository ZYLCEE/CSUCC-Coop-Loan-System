"use client";

import { useState } from "react";

const tabs = [
  "Loan Types",
  "Homepage Banners",
  "Mobile Home",
  "FAQ Manager",
  "Contact Info",
  "Mobile Branding",
];

interface TabNavigationProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export default function TabNavigation({ activeTab, onTabChange }: TabNavigationProps) {
  return (
    <div className="bg-white rounded-[14px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-1 h-[38px] flex items-center gap-2">
      {tabs.map((tab) => (
        <button
          key={tab}
          onClick={() => onTabChange(tab)}
          className={`px-2.5 py-1.5 rounded-[999px] text-[12px] font-medium transition-colors ${
            activeTab === tab
              ? "bg-[#166534] text-white"
              : "text-[#475569] hover:bg-[#F1F5F9]"
          }`}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}
