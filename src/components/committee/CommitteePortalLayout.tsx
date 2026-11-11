"use client";
import {usePathname} from "next/navigation";
import Link from "next/link";
import {CalendarDays,Bell,ClipboardCheck,History,LayoutDashboard,LogOut,Menu,UserRound} from "lucide-react";
import CommitteeNotificationBell from "./CommitteeNotificationBell";
import {SidebarProvider,useSidebar} from "@/contexts/SidebarContext";
import {useCommitteeAuth} from "./CommitteeAuthProvider";
import CommitteePortalEntry from "./CommitteePortalEntry";
import {getPortalPrefix,committeePositionLabel,type CommitteeRole} from "@/lib/committee";
import styles from "@/components/shared/Sidebar.module.css";
import CooperativeLetterhead from "@/components/shared/CooperativeLetterhead";
import PortalFooter from "@/components/shared/PortalFooter";
import {Card} from "@/components/ui/Card";
import {useEffect,useRef,useState} from "react";

export function CommitteePortalShell({children,banner}:{children:React.ReactNode;banner?:React.ReactNode}){
 const {isCollapsed,isMobile,toggleSidebar}=useSidebar(),{role,access,signOut,portalPrefix,banner:sessionBanner}=useCommitteeAuth(),path=usePathname(),prefix=portalPrefix??getPortalPrefix(role),[error,setError]=useState("");
 const items=[{path:"dashboard",name:"Dashboard",icon:LayoutDashboard},{path:"assignments",name:"Applications",icon:ClipboardCheck},{path:"notifications",name:"Notifications",icon:Bell},{path:"history",name:"Review History",icon:History},{path:"active-logs",name:"Active Logs",icon:History},{path:"profile",name:"My Profile",icon:UserRound}];
 const selected=items.find(item=>path===prefix+"/"+item.path),title=selected?.name??"Assigned Application";
 const header=useRef<HTMLElement>(null);
 useEffect(()=>{const element=header.current;if(!element)return;const resize=()=>element.closest<HTMLElement>(".admin-portal-shell")?.style.setProperty("--portal-navbar-height",element.getBoundingClientRect().height+"px");const observer=new ResizeObserver(resize);observer.observe(element);resize();return()=>observer.disconnect();},[]);
 const initials=access.name.split(/\s+/).filter(Boolean).slice(0,2).map(value=>value[0]).join("").toUpperCase();
 const currentDate=new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric",timeZone:"Asia/Manila"});
 return <div className="portal-shell admin-portal-shell" data-sidebar-collapsed={isCollapsed}>
  <aside aria-label={committeePositionLabel(role,access.committeeSeat,access.committeeMemberNumber)+" sidebar"} className={styles.sidebar+" fixed start-0 top-0 z-20 flex flex-col bg-coop-dashboard-green text-white"}>
   <div className={styles.header+" flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3"}>
    {!isCollapsed && <div className="flex min-w-0 items-center gap-2"><span className="text-caption font-bold text-[#FFD817]">CSUCC MPC</span></div>}
    <button type="button" aria-label="Toggle sidebar" className={styles.toggle+" ui-icon-button text-white"} onClick={toggleSidebar}><Menu className="h-5 w-5" /></button>
   </div>
   <nav aria-label="Committee navigation" className={styles.navigation}><div className={styles.account+" "+(isCollapsed?styles.accountCollapsed:"")} title={access.name}><span className={styles.avatar} aria-hidden="true">{initials}</span><div className={isCollapsed?"sr-only":"min-w-0"}><p className={styles.accountName}>{access.name}</p><p className={styles.accountRole}>{committeePositionLabel(role,access.committeeSeat,access.committeeMemberNumber)}</p></div></div><h2 className={isCollapsed?"sr-only":styles.heading}>{role==="crecom_member"?"CRECOM REVIEW":"BOD REVIEW"}</h2>
    <ul className={styles.items}>{items.map(item=><li key={item.path}><Link href={prefix+"/"+item.path} aria-current={path===prefix+"/"+item.path?"page":undefined} title={isCollapsed?item.name:undefined}
      className={styles.item+" "+(path===prefix+"/"+item.path?styles.active:"")+" "+(isCollapsed?"justify-center":"gap-2 px-3")} onNavigate={()=>{if(isMobile&&!isCollapsed)toggleSidebar();}}>
      <item.icon className="h-4 w-4 shrink-0" /><span className={isCollapsed?"sr-only":"text-caption"}>{item.name}</span></Link></li>)}</ul>
   </nav>
   <div className={styles.footer+" mt-auto border-t border-white/15"}><button type="button" className={styles.item+" w-full gap-2 px-3"} onClick={()=>void signOut().catch(error=>setError(error instanceof Error?error.message:"Sign out failed."))}><LogOut className="h-4 w-4" /><span className={isCollapsed?"sr-only":""}>Sign out</span></button>{error&&<p role="alert" className="p-2 text-caption">{error}</p>}</div>
  </aside>
  <header ref={header} aria-label="Cooperative header and portal utilities" className="portal-navbar coop-portal-header z-10 bg-surface-card"><CooperativeLetterhead><div className="coop-portal-utilities"><div className="coop-date-pill flex h-control-compact items-center gap-1.5 rounded-full border border-portal-border-control px-3 text-support font-semibold text-portal-muted"><CalendarDays className="size-icon-compact text-coop-dashboard-green" aria-hidden="true" /><span>{currentDate}</span></div><CommitteeNotificationBell /></div></CooperativeLetterhead></header>
  <main className="portal-content">{banner??sessionBanner}
   {role==="bod_member"&&access.reviewEnabled===false&&<p role="status" className="mb-4 rounded-lg border border-portal-border bg-surface-card p-4 text-support text-portal-secondary">Your BOD account is ready. Loan reviews are waiting for an approved and activated workflow policy.</p>}
   <Card padded={false}><div className="border-b border-portal-border px-4 py-3 sm:px-6"><h1 className="text-section-title font-semibold">{title}</h1><p className="mt-1 text-support text-portal-secondary">{committeePositionLabel(role,access.committeeSeat,access.committeeMemberNumber)} · {selected?.path==="dashboard"?"Overview of your assigned loan reviews":"Your assigned applications and recorded activity"}</p></div><div className="ui-card-padding">{children}</div></Card></main>
  <div className="portal-content-watermark" aria-hidden="true" />
  <PortalFooter />
  <button className="portal-sidebar-dismiss" aria-label="Close sidebar" tabIndex={-1} onClick={toggleSidebar} />
 </div>;
}
export default function CommitteePortalLayout({role,children}:{role:CommitteeRole;children:React.ReactNode}){
 return <CommitteePortalEntry role={role}><SidebarProvider><CommitteePortalShell>{children}</CommitteePortalShell></SidebarProvider></CommitteePortalEntry>;
}
