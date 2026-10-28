"use client";

import SendNotificationCard from "@/components/notifications/SendNotificationCard";
import NotificationHistoryCard from "@/components/notifications/NotificationHistoryCard";
import { useState } from "react";

export default function NotificationsPage() {
  const [historyVersion, setHistoryVersion] = useState(0);
  return (
    <div className="min-w-0 space-y-5 text-[#17212F]">
      <SendNotificationCard onRequestCompleted={() => setHistoryVersion((value) => value + 1)} />
      <NotificationHistoryCard key={historyVersion} />
    </div>
  );
}
