"use client";
import type {ReactNode} from "react";
import {useSidebar} from "@/contexts/SidebarContext";
import PortalFooter from "./PortalFooter";
export default function PortalFrame({sidebar,header,children,utilities}:{sidebar:ReactNode;header:ReactNode;children:ReactNode;utilities?:ReactNode}){
 const {isCollapsed,toggleSidebar}=useSidebar();
 return <div className="portal-shell admin-portal-shell" data-sidebar-collapsed={isCollapsed}>{sidebar}{header}<main className="portal-content">{children}</main><div className="portal-content-watermark" aria-hidden="true"/><PortalFooter/>{utilities}<button type="button" className="portal-sidebar-dismiss" tabIndex={-1} aria-label="Close sidebar" onClick={toggleSidebar}/></div>;
}
