"use client";
import {usePathname} from "next/navigation";
import {FileText,ClipboardList,History,LayoutDashboard,User} from "lucide-react";
import CommitteeNotificationBell from "./CommitteeNotificationBell";
import {SidebarProvider} from "@/contexts/SidebarContext";
import {useCommitteeAuth} from "./CommitteeAuthProvider";
import CommitteePortalEntry from "./CommitteePortalEntry";
import {getPortalPrefix,committeePositionLabel,type CommitteeRole} from "@/lib/committee";
import PortalSidebar,{type PortalNavigationGroup} from "@/components/shared/PortalSidebar";
import PortalHeader from "@/components/shared/PortalHeader";
import PortalFrame from "@/components/shared/PortalFrame";
import {Card} from "@/components/ui/Card";
export function CommitteePortalShell({children,banner}:{children:React.ReactNode;banner?:React.ReactNode}){
 const {role,access,signOut,portalPrefix,banner:sessionBanner}=useCommitteeAuth(),path=usePathname(),prefix=portalPrefix??getPortalPrefix(role);
 const items=[{path:"dashboard",label:"Dashboard",icon:LayoutDashboard},{path:"assignments",label:"Loan Applications",icon:FileText},{path:"history",label:"Review History",icon:History},{path:"active-logs",label:"Active Logs",icon:ClipboardList},{path:"profile",label:"My Profile",icon:User}];
 const selected=items.find(item=>path===prefix+"/"+item.path),title=path===prefix+"/notifications"?"Notifications":selected?.label??"Loan Applications";
 const groups:PortalNavigationGroup[]=[{label:"MAIN",items:items.slice(0,1).map(item=>({...item,href:prefix+"/"+item.path}))},{label:"LOAN MANAGEMENT",items:items.slice(1,3).map(item=>({...item,href:prefix+"/"+item.path}))},{label:"SYSTEM MANAGEMENT",items:items.slice(3,4).map(item=>({...item,href:prefix+"/"+item.path}))},{label:"ACCOUNT",items:items.slice(4).map(item=>({...item,href:prefix+"/"+item.path}))}];
 return <PortalFrame sidebar={<PortalSidebar name={access.name} role={committeePositionLabel(role,access.committeeSeat,access.committeeMemberNumber)} groups={groups} onSignOut={signOut}/>} header={<PortalHeader><CommitteeNotificationBell/></PortalHeader>}>
  {banner??sessionBanner}
  {role==="bod_member"&&access.reviewEnabled===false&&<p role="status" className="mb-4 rounded-lg border border-portal-border bg-surface-card p-4 text-support text-portal-secondary">Your BOD account is ready. Loan reviews are waiting for an approved and activated workflow policy.</p>}
  <Card padded={false}><div className="border-b border-portal-border px-4 py-3 sm:px-6"><h1 className="text-section-title font-semibold">{title}</h1><p className="mt-1 text-support text-portal-secondary">{committeePositionLabel(role,access.committeeSeat,access.committeeMemberNumber)} · {selected?.path==="dashboard"?"Overview of your assigned loan reviews":"Your assigned applications and recorded activity"}</p></div><div className="ui-card-padding">{children}</div></Card>
 </PortalFrame>;
}
export default function CommitteePortalLayout({role,children}:{role:CommitteeRole;children:React.ReactNode}){
 return <CommitteePortalEntry role={role}><SidebarProvider><CommitteePortalShell>{children}</CommitteePortalShell></SidebarProvider></CommitteePortalEntry>;
}
