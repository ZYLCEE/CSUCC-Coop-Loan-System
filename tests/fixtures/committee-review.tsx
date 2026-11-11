import CommitteeReviewPanel from "../../src/components/loan-applications/CommitteeReviewPanel";
import CommitteePacket from "../../src/components/committee/CommitteePacket";
import WorkflowPolicyActivation from "../../src/components/settings/WorkflowPolicyActivation";
import {syntheticReviewPolicy} from "./committee-review-transport";
export default function Fixture(){
 const view=new URLSearchParams(window.location.search).get("view")??"admin";
 return <main className="mx-auto min-h-screen max-w-[1200px] p-4 font-sans">{view==="reviewer"?<CommitteePacket assignmentId="b0000000-0000-0000-0000-000000000001" />:view==="policy"?<WorkflowPolicyActivation policy={syntheticReviewPolicy()} dirty={false} onActivated={async()=>{}} />:<CommitteeReviewPanel applicationId="APP-TEST" onUpdated={()=>{}} />}</main>;
}
