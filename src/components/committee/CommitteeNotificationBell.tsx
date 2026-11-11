"use client";
import Link from "next/link";
import {Bell} from "lucide-react";
import {useCallback,useEffect,useState} from "react";
import {useCommitteeAuth} from "./CommitteeAuthProvider";
import {useCommitteeServices} from "./CommitteeServices";
import {getPortalPrefix,type CommitteeNotification} from "@/lib/committee";
import {watchAdminNotifications} from "@/lib/adminNotifications";
export default function CommitteeNotificationBell(){
 const {user,role,portalPrefix,prototype}=useCommitteeAuth(),{committeeRequest}=useCommitteeServices(),[unread,setUnread]=useState(0);
 const load=useCallback(async()=>{const rows=await committeeRequest<CommitteeNotification[]>("operation=inbox");setUnread(rows.filter(row=>!row.read).length);},[committeeRequest]);
 useEffect(()=>{let active=true;const update=()=>{if(active)void load().catch(()=>{});};update();const unwatch=prototype?()=>{}:watchAdminNotifications(user.id,update);const timer=window.setInterval(update,prototype?5000:30000);return()=>{active=false;unwatch();window.clearInterval(timer);};},[user.id,prototype,load]);
 return <Link href={(portalPrefix??getPortalPrefix(role))+"/notifications"} className="ui-icon-button relative" aria-label={"My notifications"+(unread?", "+unread+" unread":"")}><Bell className="h-5 w-5" />{unread>0&&<span className="absolute -right-1 -top-1 rounded-full bg-coop-dashboard-green px-1 text-[10px] leading-4 text-white">{unread>99?"99+":unread}</span>}</Link>;
}
