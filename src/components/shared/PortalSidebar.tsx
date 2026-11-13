"use client";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {useRef,useState} from "react";
import {LogOut,Menu,type LucideIcon} from "lucide-react";
import {useSidebar} from "@/contexts/SidebarContext";
import styles from "./Sidebar.module.css";

export type PortalNavigationGroup={label:string;items:{label:string;href:string;icon:LucideIcon}[]};
export default function PortalSidebar({name,role,groups,onSignOut}:{name:string;role:string;groups:PortalNavigationGroup[];onSignOut:()=>Promise<void>}){
 const path=usePathname(),{isCollapsed,isMobile,toggleSidebar}=useSidebar(),toggle=useRef<HTMLButtonElement>(null);
 const [error,setError]=useState(""),[busy,setBusy]=useState(false);
 const initials=name.split(/[\s@._-]+/).filter(Boolean).slice(0,2).map(part=>part[0]?.toUpperCase()).join("");
 const itemClass=(active=false)=>`${styles.item} ${active?styles.active:""} ${isCollapsed?"justify-center":"gap-2.5 px-3"}`;
 return <aside aria-label="CSUCC ERMPC sidebar" className={`${styles.sidebar} ${styles.adminSidebar} fixed start-0 top-0 z-20 flex flex-col bg-coop-dashboard-green text-white`}
  onKeyDown={event=>{if(event.key==="Escape"&&isMobile&&!isCollapsed){toggleSidebar();toggle.current?.focus();}}}>
  <div className={`${styles.header} flex shrink-0 items-center border-b border-white/10 ${isCollapsed?"justify-center px-0":"justify-between gap-3 px-4"}`}>
   {!isCollapsed&&<span className={`${styles.brand} truncate text-caption font-bold uppercase leading-none tracking-wide`}>CSUCC ERMPC</span>}
   <button ref={toggle} type="button" onClick={toggleSidebar} aria-label="Toggle sidebar" aria-expanded={!isCollapsed} aria-controls="sidebar-navigation" title={isCollapsed?"Expand sidebar":"Collapse sidebar"} className={`${styles.toggle} flex shrink-0 items-center justify-center border border-white/10 bg-white/[0.04]`}><Menu className="size-icon" strokeWidth={2} aria-hidden="true"/></button>
  </div>
  <nav id="sidebar-navigation" aria-label="Main navigation" className={`${styles.navigation} ${styles.adminNavigation}`}>
   <div role="group" aria-label="Signed-in account" title={isCollapsed?`${name} · ${role}`:undefined} className={`${styles.account} ${isCollapsed?styles.accountCollapsed:""}`}>
    <span className={styles.avatar} aria-hidden="true">{initials}</span><div className={isCollapsed?"sr-only":"min-w-0"}><p className={styles.accountName} title={name}>{name}</p><p className={styles.accountRole}>{role}</p></div>
   </div>
   <div className={styles.groups}>{groups.map(group=><section key={group.label} aria-label={group.label}>
    <h2 className={isCollapsed?"sr-only":styles.heading}>{group.label}</h2><ul className={styles.items}>{group.items.map(item=><li key={item.href}><Link href={item.href} className={itemClass(path===item.href)} aria-current={path===item.href?"page":undefined} title={isCollapsed?item.label:undefined} onNavigate={()=>{if(isMobile&&!isCollapsed)toggleSidebar();}}><item.icon className="size-icon shrink-0" strokeWidth={1.9} aria-hidden="true"/><span className={isCollapsed?"sr-only":"whitespace-nowrap"}>{item.label}</span></Link></li>)}</ul>
   </section>)}</div>
  </nav>
  <div className={`${styles.footer} mt-auto shrink-0 border-t border-white/15`}><button type="button" className={`${itemClass()} w-full`} disabled={busy} title={isCollapsed?"Log Out":undefined} onClick={async()=>{setBusy(true);setError("");try{await onSignOut();}catch(error){setError(error instanceof Error?error.message:"Sign out failed. Please retry.");}finally{setBusy(false);}}}><LogOut className="size-icon shrink-0" aria-hidden="true"/><span className={isCollapsed?"sr-only":""}>Log Out</span></button>{error&&<p role="alert" className="p-2 text-caption">{error}</p>}</div>
 </aside>;
}
