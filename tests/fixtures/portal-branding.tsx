import {PortalShell} from "../../src/components/shared/AdminPortalLayout";
import {SidebarProvider} from "../../src/contexts/SidebarContext";
import {SecureAdminActionProvider} from "../../src/components/auth/SecureAdminActionProvider";
import LoanApplicationsPage from "../../src/app/(admin)/loan-applications/page";
import MembersPage from "../../src/app/(admin)/members/page";
import ActiveLoansWorkspace from "../../src/components/active-loans/ActiveLoansWorkspace";
import ReportWorkspace from "../../src/components/reports/ReportWorkspace";
import NotificationsPage from "../../src/app/(admin)/notifications/page";
import CommitteeAccounts from "../../src/components/committee/CommitteeAccounts";
import SettingsPage from "../../src/app/(admin)/settings/page";
import ProfilePage from "../../src/app/(admin)/profile/page";

const params=new URLSearchParams(window.location.search);
const role=params.get("role")==="admin"?"admin":"super_admin";
const view=params.get("view")??"loans";
Object.assign(window,{
  testRole:role,testPathname:(role==="admin"?"/admin":"/super-admin")+"/"+({loans:"loan-applications",accounts:"all-accounts",active:"active-loans",reports:"reports",notifications:"communication",committee:"committee-accounts",settings:"settings",profile:"profile"}[view]??"loan-applications"),
  testUser:{id:"synthetic-staff",email:"staff@example.invalid",app_metadata:{role},user_metadata:{full_name:"Synthetic Alexandra Villanueva"}},
  activityRows:[],
});

export default function BrandingPreview(){
  return <SecureAdminActionProvider><SidebarProvider><PortalShell role={role}>
    {view==="accounts"?<MembersPage/>:view==="active"?<ActiveLoansWorkspace/>:view==="reports"?<ReportWorkspace/>:view==="notifications"?<NotificationsPage/>:view==="committee"?<CommitteeAccounts/>:view==="settings"?<SettingsPage/>:view==="profile"?<ProfilePage/>:<LoanApplicationsPage/>}
  </PortalShell></SidebarProvider></SecureAdminActionProvider>;
}
