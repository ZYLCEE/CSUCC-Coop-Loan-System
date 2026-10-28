"use client";

const notificationTypes = [
  "Information",
  "Reminder",
  "Approval",
  "Rejection",
  "Maintenance",
  "Emergency",
];

interface NotificationTypePillsProps {
  selectedType: string;
  onTypeChange: (type: string) => void;
}

export default function NotificationTypePills({ selectedType, onTypeChange }: NotificationTypePillsProps) {
  return (
    <div className="flex flex-wrap gap-1">
      {notificationTypes.map((type) => (
        <button
          type="button"
          key={type}
          onClick={() => onTypeChange(type)}
          className={`inline-flex h-7 items-center rounded-full px-3 text-[12px] font-semibold transition-colors ${
            selectedType === type
              ? "bg-[#166534] text-white"
              : "bg-white border border-[#E5E7EB] text-[#1F2937] hover:bg-[#F9FAFB]"
          }`}
        >
          {type}
        </button>
      ))}
    </div>
  );
}
