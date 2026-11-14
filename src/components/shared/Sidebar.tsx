"use client";
import {usePathname} from "next/navigation";
import {LayoutDashboard,FileText,Users,CreditCard,Folder,BarChart3,ClipboardList,Settings,User} from "lucide-react";
import {useAdminAuth} from "@/components/auth/AdminAuthProvider";
import {getAdminRole} from "@/lib/auth/roles";
import PortalSidebar,{type PortalNavigationGroup} from "./PortalSidebar";
export default function Sidebar(){
 const path=usePathname(),{user,signOut,can}=useAdminAuth(),role=getAdminRole(user)??"super_admin";
 const prefix=path.startsWith("/admin/")?"/admin":path.startsWith("/super-admin/")?"/super-admin":"";
 const fullName=user?.user_metadata.full_name,name=(typeof fullName==="string"?fullName.trim():"")||user?.email||"Account";
 const href=(section:string)=>`${prefix}/${section}`;
 const groups:PortalNavigationGroup[]=[
  {label:"MAIN",items:[{icon:LayoutDashboard,label:"Dashboard",href:href("dashboard")}]},
  {label:"LOAN MANAGEMENT",items:[{icon:FileText,label:"Loan Applications",href:href("loan-applications")},{icon:Users,label:"All Accounts",href:href(prefix?"all-accounts":"members")},{icon:CreditCard,label:"Active Loans",href:href("active-loans")}]},
  {label:"SYSTEM MANAGEMENT",items:[...(role==="super_admin"||can("committee.accounts.manage")?[{icon:Users,label:"Committee Accounts",href:href("committee-accounts")}]:[]),{icon:Folder,label:"Documents",href:href("documents")},{icon:BarChart3,label:"Reports",href:href("reports")},{icon:ClipboardList,label:"Active Logs",href:href("active-logs")}]},
  {label:"ACCOUNT",items:[{icon:Settings,label:"Settings",href:href("settings")},{icon:User,label:"My Profile",href:href("profile")}]},
 ];
 return <PortalSidebar name={name} role={role==="admin"?"Administrator":"Super Administrator"} groups={groups} onSignOut={signOut}/>;
}
