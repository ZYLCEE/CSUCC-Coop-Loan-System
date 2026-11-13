import CommitteeWorkspace from "@/components/committee/CommitteeWorkspace";
export default async function AssignedReviewPage({params}:{params:Promise<{assignmentId:string}>}){
 const {assignmentId}=await params;
 return <CommitteeWorkspace key={assignmentId} section="assignments" initialAssignmentId={assignmentId}/>;
}
