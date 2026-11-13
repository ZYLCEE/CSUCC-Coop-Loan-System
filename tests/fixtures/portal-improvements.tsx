import {SidebarProvider} from "../../src/contexts/SidebarContext";
import {SecureAdminActionProvider} from "../../src/components/auth/SecureAdminActionProvider";
import {PortalShell} from "../../src/components/shared/AdminPortalLayout";
import {CommitteePortalShell} from "../../src/components/committee/CommitteePortalLayout";
import CommitteeWorkspace from "../../src/components/committee/CommitteeWorkspace";
import DashboardPage from "../../src/app/(admin)/dashboard/page";
import LoanApplicationsPage from "../../src/app/(admin)/loan-applications/page";
import {syntheticVerification} from "./verification-transport";
const params=new URLSearchParams(window.location.search),role=params.get("role")??"super_admin",committee=role==="crecom_member"||role==="bod_member",view=params.get("view")??"process";
const state=window as unknown as Record<string,unknown>;
Object.assign(state,{testRole:committee?"super_admin":role,committeeRole:role,testPathname:(committee?role==="bod_member"?"/bod":"/crecom":role==="admin"?"/admin":"/super-admin")+"/"+(view==="dashboard"?"dashboard":"loan-applications"),testPrivileges:["applications.verify","applications.forward","applications.return","documents.review"],testUser:{id:"synthetic-staff",email:"staff@example.invalid",app_metadata:{role},user_metadata:{full_name:"Synthetic Portal Reviewer"}},portalUnreadCount:3,portalNotificationRows:[{id:"notice-1",userId:"synthetic-staff",title:"New loan application",message:"Synthetic Member submitted APP-TEST.",type:"loan_submitted",read:false,createdAt:"2026-11-13T02:00:00Z",entityType:"application",entityKey:"APP-TEST"}]});
if(!state.verificationData){
 const app=syntheticVerification();app.loanType="Regular Loan";app.blockers=[];app.evidence={borrower:1,coMaker:1,witnesses:2};
 app.policy={id:"a0000000-0000-0000-0000-000000000020",name:"Project Workflow",version:1,status:"approved",authorizationReference:"docs/approval-workflow/PROJECT_WORKFLOW_POLICY.md",createdAt:"2026-11-01T00:00:00Z",createdBy:"Synthetic Super Admin",config:{reviewerCount:3,quorumRule:"All three",crecomAuthority:"recommendation",bodMode:"required",bodCriteria:"Every application",finalAuthority:"Super Admin",borrowerConsentRequired:true,coMakerConsentRequired:true,witnessCount:2,allowedConsentMethods:["otp","paper"],requirementsReference:"Project workflow"}};
 if(params.get("state")==="rejected-review"){
  app.enrolled=true;app.stage="review_attention";app.loanStatus="under review";app.canEnroll=false;app.checks={identity:true,eligibility:true,terms:true};
  state.reviewAdmin={applicationId:app.applicationId,revision:1,stateHash:app.stateHash,verificationStage:"review_attention",verified:true,blockers:[],policyId:app.policy.id,policyName:app.policy.name,candidates:[],events:[],finalDecision:null,canManage:true,canFinalize:false,cycles:[{id:"cycle-rejected",stage:"CRECOM",cycle:1,packetVersion:1,status:"completed",outcome:"reject",requiredApprovals:3,reviewerTarget:3,bodRequired:true,routingReason:"Required",createdAt:"2026-11-13T00:00:00Z",assignments:[1,2,3].map(n=>({id:"review-"+n,membershipId:"membership-"+n,name:"Synthetic CRECOM "+n,signatoryRole:n===3?"crecom_chairperson":"crecom_member",committeeMemberNumber:n<3?n:null,state:"decision_recorded",revision:1,decision:n===3?"reject":"approve",reason:n===3?"Submitted information requires review":null,decidedAt:"2026-11-13T01:00:00Z"}))}]};
 }
 state.verificationData=app;
}
export default function Fixture(){return <SecureAdminActionProvider><SidebarProvider>{committee?<CommitteePortalShell><CommitteeWorkspace section="dashboard"/></CommitteePortalShell>:view==="dashboard"?<PortalShell role={role==="admin"?"admin":"super_admin"}><DashboardPage/></PortalShell>:<main className="p-4"><LoanApplicationsPage/></main>}</SidebarProvider></SecureAdminActionProvider>;}
