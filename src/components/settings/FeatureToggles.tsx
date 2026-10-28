"use client";

import { useState } from "react";

interface Feature {
  name: string;
  enabled: boolean;
}

export default function FeatureToggles() {
  const [features, setFeatures] = useState<Feature[]>([
    { name: "Educational Loan", enabled: true },
    { name: "Medical Loan", enabled: true },
    { name: "Emergency Loan", enabled: true },
    { name: "Housing Loan", enabled: false },
    { name: "Homepage Carousel", enabled: true },
    { name: "Promotional Banners", enabled: true },
    { name: "OTP Verification", enabled: true },
    { name: "Push Notifications", enabled: true },
    { name: "Document Downloads", enabled: true },
    { name: "FAQ Section", enabled: true },
    { name: "Contact Page", enabled: true },
    { name: "Announcements", enabled: true },
    { name: "Loan Calculator", enabled: true },
    { name: "New Member Registration", enabled: false },
  ]);

  const handleToggle = (index: number) => {
    setFeatures((prev) =>
      prev.map((feature, i) =>
        i === index ? { ...feature, enabled: !feature.enabled } : feature
      )
    );
  };

  return (
    <div className="bg-white rounded-[18px] shadow-[0_2px_10px_rgba(0,0,0,0.05)] border border-[#E5E7EB] p-4">
      <h2 className="text-[16px] font-bold text-[#1F2937] mb-4">Feature Toggles</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
        {features.map((feature, index) => (
          <div
            key={feature.name}
            className="h-[44px] bg-[#F8FAFC] rounded-[12px] px-3 flex items-center justify-between"
          >
            <span className="text-[14px] font-semibold text-[#1F2937]">
              {feature.name}
            </span>
            <button
              onClick={() => handleToggle(index)}
              className={`w-[32px] h-[18px] rounded-full transition-all duration-200 ${
                feature.enabled ? "bg-[#166534]" : "bg-[#D1D5DB]"
              }`}
            >
              <div
                className={`w-3.5 h-3.5 bg-white rounded-full transition-transform duration-200 ${
                  feature.enabled ? "translate-x-[12px]" : "translate-x-[2px]"
                }`}
              />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
