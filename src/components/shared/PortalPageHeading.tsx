import type {ReactNode} from "react";

const pageHeadings = {
  dashboard: {title:"Dashboard",description:"Overview of cooperative activities and system information"},
  "loan-applications": {title:"Loan Applications",description:"Review and manage member loan applications"},
  "all-accounts": {title:"All Accounts",description:"Manage member and administrator accounts"},
  "active-loans": {title:"Active Loans",description:"Monitor and manage active member loans"},
  notifications: {title:"Notifications",description:"View and manage system notifications"},
  announcements: {title:"Announcements",description:"Create and manage cooperative announcements"},
  "committee-accounts": {title:"Committee Accounts",description:"Manage live CRECOM and BOD reviewer memberships"},
  documents: {title:"Documents",description:"Manage cooperative and member documents"},
  reports: {title:"Reports",description:"View and generate cooperative reports"},
  "audit-logs": {title:"Active Logs",description:"Track successful sessions and completed cooperative activities"},
  "active-logs": {title:"Active Logs",description:"Track successful sessions and completed cooperative activities"},
  settings: {title:"Settings",description:"Manage system settings and preferences"},
  profile: {title:"My Profile",description:"View and manage your account information"},
} as const;

export default function PortalPageHeading({section,children}:{section:keyof typeof pageHeadings;children?:ReactNode}) {
  const heading=pageHeadings[section];
  return <header className="portal-page-heading flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-portal-border px-4 py-3 sm:px-6">
    <div className="min-w-0">
      <h1 className="text-[18px] font-semibold leading-6 text-portal-primary">{heading.title}</h1>
      <p className="mt-0.5 text-caption text-portal-secondary">{heading.description}</p>
    </div>
    {children}
  </header>;
}
