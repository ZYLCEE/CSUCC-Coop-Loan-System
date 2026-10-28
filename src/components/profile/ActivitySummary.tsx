"use client";

import { LogIn, User, Lock, CheckCircle } from "lucide-react";
import { activities } from "./ProfileData";

export default function ActivitySummary() {
  const getIcon = (action: string) => {
    switch (action) {
      case "Logged in":
        return LogIn;
      case "Updated Profile":
        return User;
      case "Changed Password":
        return Lock;
      case "Approved Loan":
        return CheckCircle;
      default:
        return LogIn;
    }
  };

  return (
    <div className="bg-white rounded-[18px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] border border-[#E5E7EB] p-6">
      <h2 className="text-[20px] font-semibold text-[#111827] mb-6">Recent Account Activity</h2>

      <div className="space-y-4">
        {activities.map((activity) => {
          const Icon = getIcon(activity.action);
          return (
            <div key={activity.id} className="flex items-start gap-4 p-4 rounded-lg bg-[#F8FAFC] hover:bg-[#F1F5F9] transition-colors">
              <div className="w-10 h-10 rounded-full bg-[#DCFCE7] flex items-center justify-center flex-shrink-0">
                <Icon className="w-5 h-5 text-[#166534]" strokeWidth={2} />
              </div>
              <div className="flex-1">
                <p className="text-[15px] font-medium text-[#111827] mb-1">{activity.action}</p>
                <p className="text-[13px] text-[#6B7280]">{activity.description}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-[13px] text-[#6B7280]">{activity.date}</p>
                <p className="text-[12px] text-[#9CA3AF]">{activity.time}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
