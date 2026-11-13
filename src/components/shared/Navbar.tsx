"use client";
import {usePathname} from "next/navigation";
import {useAdminAuth} from "@/components/auth/AdminAuthProvider";
import NotificationPopover from "./notifications/NotificationPopover";
import PortalHeader from "./PortalHeader";
export default function Navbar(){
 const pathname=usePathname(),{user,role}=useAdminAuth();
 const routePrefix=pathname.startsWith("/admin/")?"/admin":pathname.startsWith("/super-admin/")?"/super-admin":"";
 return <PortalHeader>{user&&role&&<NotificationPopover key={user.id+":"+pathname} userId={user.id} routePrefix={routePrefix}/>} {role==="super_admin"&&<div id="portal-live-status" className="portal-live-status-slot"/>}</PortalHeader>;
}
