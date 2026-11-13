"use client";
import {useEffect,useRef,useState,type ReactNode} from "react";
import {CalendarDays} from "lucide-react";
import CooperativeLetterhead from "./CooperativeLetterhead";
const dateText=()=>new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric",timeZone:"Asia/Manila"});
export default function PortalHeader({children}:{children:ReactNode}){
 const header=useRef<HTMLElement>(null),[date,setDate]=useState(dateText);
 useEffect(()=>{const timer=window.setInterval(()=>setDate(dateText()),60000);return()=>window.clearInterval(timer);},[]);
 useEffect(()=>{const element=header.current;if(!element)return;const resize=()=>element.closest<HTMLElement>(".admin-portal-shell")?.style.setProperty("--portal-navbar-height",element.getBoundingClientRect().height+"px");const observer=new ResizeObserver(resize);observer.observe(element);resize();return()=>observer.disconnect();},[]);
 return <header ref={header} aria-label="Cooperative header and portal utilities" className="portal-navbar coop-portal-header z-10 bg-surface-card"><CooperativeLetterhead><div className="coop-portal-utilities"><div className="coop-date-pill flex h-control-compact min-w-0 items-center gap-1.5 rounded-full border border-portal-border-control px-3 text-caption font-semibold text-portal-muted sm:text-support"><CalendarDays className="size-icon-compact shrink-0 text-coop-dashboard-green" aria-hidden="true"/><span className="truncate" suppressHydrationWarning>{date}</span></div>{children}</div></CooperativeLetterhead></header>;
}
