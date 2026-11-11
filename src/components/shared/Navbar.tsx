"use client";

import {usePathname} from "next/navigation";
import {CalendarDays} from "lucide-react";
import {useEffect,useRef} from "react";
import {useAdminAuth} from "@/components/auth/AdminAuthProvider";
import NotificationPopover from "./notifications/NotificationPopover";
import CooperativeLetterhead from "./CooperativeLetterhead";

export default function Navbar() {
  const pathname=usePathname();
  const {user,role}=useAdminAuth();
  const header=useRef<HTMLElement>(null);
  useEffect(()=>{
    const element=header.current;
    if(!element)return;
    const shell=element.closest<HTMLElement>(".admin-portal-shell");
    const resize=()=>shell?.style.setProperty("--portal-navbar-height",element.getBoundingClientRect().height+"px");
    const observer=new ResizeObserver(resize);observer.observe(element);resize();
    return()=>observer.disconnect();
  },[]);
  const routePrefix=pathname.startsWith("/admin/")?"/admin":pathname.startsWith("/super-admin/")?"/super-admin":"";
  const currentDate=new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric",timeZone:"Asia/Manila"});
  return <header ref={header} aria-label="Cooperative header and portal utilities" className="portal-navbar coop-portal-header z-10 bg-surface-card">
    <CooperativeLetterhead>
    <div className="coop-portal-utilities">
    <div className="coop-date-pill flex h-control-compact min-w-0 items-center gap-1.5 rounded-full border border-portal-border-control px-3 text-caption font-semibold text-portal-muted sm:text-support">
      <CalendarDays className="size-icon-compact shrink-0 text-coop-dashboard-green" aria-hidden="true" /><span className="truncate">{currentDate}</span>
    </div>
    {user&&role&&<NotificationPopover key={user.id+":"+pathname} userId={user.id} routePrefix={routePrefix} />}
    {role==="super_admin"&&<div id="portal-live-status" className="portal-live-status-slot" />}
    </div>
    </CooperativeLetterhead>
  </header>;
}
