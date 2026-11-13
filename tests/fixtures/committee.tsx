import CommitteeAccounts from "../../src/components/committee/CommitteeAccounts";
import CommitteeWorkspace from "../../src/components/committee/CommitteeWorkspace";
import CommitteePacket from "../../src/components/committee/CommitteePacket";
import CommitteeNotificationBell from "../../src/components/committee/CommitteeNotificationBell";
export default function Fixture(){
 const section=new URLSearchParams(window.location.search).get("committee")??"accounts";
 return <main className="mx-auto min-h-screen max-w-[1600px] p-4 font-sans">{section!=="accounts"&&section!=="packet"&&<div className="mb-4 flex items-center justify-between"><h1 className="text-section-title font-semibold">{section==="history"?"Review History":section==="notifications"?"Notifications":"Loan Applications"}</h1><CommitteeNotificationBell/></div>}{section==="accounts"?<CommitteeAccounts />:section==="packet"?<CommitteePacket assignmentId="assignment-own" />:<CommitteeWorkspace key={section} section={section} />}</main>;
}
