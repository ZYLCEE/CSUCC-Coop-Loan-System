import CommitteePacket from "@/components/committee/CommitteePacket";
export default async function AssignedReviewPage({params}:{params:Promise<{assignmentId:string}>}){
 const {assignmentId}=await params;
 return <CommitteePacket key={assignmentId} assignmentId={assignmentId} />;
}
