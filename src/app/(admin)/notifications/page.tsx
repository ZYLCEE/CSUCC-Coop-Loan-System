"use client";

import SendNotificationCard from "@/components/notifications/SendNotificationCard";
import NotificationHistoryCard from "@/components/notifications/NotificationHistoryCard";
import { useState } from "react";
import {useAdminAuth} from "@/components/auth/AdminAuthProvider";
import IncomingActivityCard,{DemonstrationActivityCard} from "@/components/notifications/IncomingActivityCard";
import PortalPageHeading from "@/components/shared/PortalPageHeading";
import {Card} from "@/components/ui/Card";

export default function NotificationsPage() {
  const [historyVersion, setHistoryVersion] = useState(0);
  const [tab,setTab]=useState("activity"),{can}=useAdminAuth();
  return (
    <Card padded={false} className="min-w-0 overflow-hidden text-[#17212F]">
      <PortalPageHeading section="notifications" />
      <div className="flex flex-wrap gap-2 border-b border-portal-border p-3" role="group" aria-label="Notification views">{[{id:"activity",label:"Activity inbox"},{id:"demo",label:"Demonstration"},...(can("notifications.send")?[{id:"send",label:"Send to members"},{id:"sent",label:"Sent messages"}]:[])].map(item=><button key={item.id} className={"ui-button ui-button--compact "+(tab===item.id?"ui-button--primary":"ui-button--ghost")} aria-pressed={tab===item.id} onClick={()=>setTab(item.id)}>{item.label}</button>)}</div>
      <div className="ui-card-padding">
      {tab==="activity"?<IncomingActivityCard />:tab==="demo"?<DemonstrationActivityCard />:tab==="send"?<SendNotificationCard onRequestCompleted={() => {setHistoryVersion((value) => value + 1);setTab("sent");}} />:<NotificationHistoryCard key={historyVersion} />}
      </div>
    </Card>
  );
}
