"use client";

interface NotificationBadgeProps {
  type: "Maintenance" | "Reminder" | "Promotion" | "Information" | "Emergency" | "Approval" | "Reject";
}

export default function NotificationBadge({ type }: NotificationBadgeProps) {
  const styles = {
    Maintenance: "bg-gray-100 text-gray-700 border-gray-300",
    Reminder: "bg-yellow-50 text-yellow-700 border-yellow-200",
    Promotion: "bg-purple-50 text-purple-700 border-purple-200",
    Information: "bg-blue-50 text-blue-700 border-blue-200",
    Emergency: "bg-red-50 text-red-700 border-red-200",
    Approval: "bg-green-50 text-green-700 border-green-200",
    Reject: "bg-white text-red-600 border-red-300 border",
  };

  return (
    <span className={`inline-flex items-center h-[20px] px-[8px] py-0 rounded-full text-[11px] font-medium border ${styles[type]}`}>
      {type}
    </span>
  );
}
