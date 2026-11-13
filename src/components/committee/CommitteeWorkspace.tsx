"use client";
import {useRouter} from "next/navigation";
import {useCallback,useEffect,useMemo,useState} from "react";
import {useCommitteeAuth} from "./CommitteeAuthProvider";
import {useCommitteeServices} from "./CommitteeServices";
import {getPortalPrefix,type CommitteeWorkspace as Workspace,type CommitteeDecision} from "@/lib/committee";
import {getLoanTypeLabel as loanTypeLabel} from "@/lib/loanTypeLabel";
import {Button} from "@/components/ui/Button";
import {Card} from "@/components/ui/Card";
import {DataTable} from "@/components/ui/DataTable";
import {StatusBadge} from "@/components/ui/StatusBadge";
import {EmptyState,LoadingState} from "@/components/ui/Feedback";
import {FilterToolbar,SearchInput} from "@/components/ui/FilterToolbar";
import {Select} from "@/components/ui/Fields";
import {Pagination,PaginationControls} from "@/components/ui/Pagination";
import {ActionDialog} from "@/components/ui/ActionDialog";
import RecordActionsMenu from "@/components/shared/RecordActionsMenu";
import type {DateSortOrder} from "@/lib/tablePagination";
import CommitteeProfile from "./CommitteeProfile";
import CommitteeActiveLogs from "./CommitteeActiveLogs";
import CommitteePacket,{type ReviewTab} from "./CommitteePacket";
import {useCommitteeInbox} from "./useCommitteeInbox";
import {watchAdminNotifications} from "@/lib/adminNotifications";
import {committeeDecisionLabel,committeeApprovalLabel,crecomConfirmationProgress} from "@/lib/committeeReviewPresentation";
import {committeeDate,committeeMoney} from "@/lib/committeePresentation";
export default function CommitteeWorkspace({section,initialAssignmentId}:{section:string;initialAssignmentId?:string}){
 if(section==="active-logs")return <CommitteeActiveLogs/>;
 if(section==="profile")return <CommitteeProfile/>;
 if(section==="notifications")return <CommitteeInbox/>;
 return <CommitteeCases section={section} initialAssignmentId={initialAssignmentId}/>;
}
function CommitteeCases({section,initialAssignmentId}:{section:string;initialAssignmentId?:string}){
 const {committeeRequest}=useCommitteeServices(),{role,portalPrefix,user,prototype,access}=useCommitteeAuth(),router=useRouter(),prefix=portalPrefix??getPortalPrefix(role);
 const [data,setData]=useState<Workspace|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState("");
 const [query,setQuery]=useState(""),[filter,setFilter]=useState("all"),[page,setPage]=useState(1),[size,setSize]=useState(10),[sort,setSort]=useState<DateSortOrder>("Newest");
 const [selected,setSelected]=useState<{id:string;tab:ReviewTab}|null>(initialAssignmentId?{id:initialAssignmentId,tab:"details"}:null),[receipt,setReceipt]=useState<CommitteeDecision|null>(null);
 const load=useCallback(async()=>{setLoading(true);setError("");try{setData(await committeeRequest<Workspace>());}catch(error){setData(null);setError(error instanceof Error?error.message:"Assigned applications could not be loaded.");}finally{setLoading(false);}},[committeeRequest]);
 useEffect(()=>{let active=true;const update=()=>{if(document.visibilityState==="hidden")return;void committeeRequest<Workspace>().then(value=>{if(active){setData(value);setError("");}}).catch(error=>{if(active){setData(null);setError(error instanceof Error?error.message:"Assigned applications could not be loaded.");}}).finally(()=>{if(active)setLoading(false);});};update();const unwatch=prototype?()=>{}:watchAdminNotifications(user.id,update);const timer=window.setInterval(update,30000);return()=>{active=false;unwatch();window.clearInterval(timer);};},[committeeRequest,user.id,prototype]);
 const history=section==="history";
 const assignments=useMemo(()=>data?.assignments.filter(row=>(section!=="dashboard"||row.state==="assigned")&&(filter==="all"||filter==="approve"||filter==="reject"?filter==="all"||row.myDecision===filter:row.state===filter)&&(row.applicationId+" "+row.applicant+" "+row.memberNumber+" "+row.loanType).toLowerCase().includes(query.toLowerCase())).sort((a,b)=>(sort==="Newest"?-1:1)*(Date.parse(a.assignedAt)-Date.parse(b.assignedAt)))??[],[data,query,filter,sort,section]);
 const decisions=useMemo(()=>data?.history.filter(row=>(row.applicationId+" "+row.decision+" "+row.reason).toLowerCase().includes(query.toLowerCase())).sort((a,b)=>(sort==="Newest"?-1:1)*(Date.parse(a.createdAt)-Date.parse(b.createdAt)))??[],[data,query,sort]);
 const count=history?decisions.length:assignments.length,pages=Math.max(1,Math.ceil(count/size)),current=Math.min(page,pages),start=(current-1)*size;
 const close=()=>{setSelected(null);if(initialAssignmentId)router.replace(prefix+"/assignments");};
 return <div className="space-y-4">
  {section==="dashboard"&&<div><h2 className="text-section-title font-semibold">Welcome, {access.name}</h2><p className="mt-1 text-support text-portal-secondary">Here is an overview of your assigned loan reviews.</p></div>}
  {section==="dashboard"&&data&&<div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{([["Assigned",data.counts.assigned],["Needs My Review",data.counts.pending],["Awaiting Others",data.counts.waiting],["Completed Reviews",data.counts.completed]] as const).map(([label,value])=><Card key={label}><p className="text-caption text-portal-secondary">{label}</p><p className="mt-1 text-section-title font-bold tabular-nums">{value}</p></Card>)}</div>}
  <Card padded={false}>
   {section==="dashboard"&&<h2 className="border-b border-portal-border px-6 py-4 text-card-title font-semibold">Applications Requiring My Review</h2>}
   <FilterToolbar><SearchInput aria-label={history?"Search my review history":"Search my assigned applications"} placeholder="Search application, borrower or member ID…" value={query} onChange={event=>{setQuery(event.target.value);setPage(1);}}/>
    {!history&&<Select aria-label="My decision filter" value={filter} onChange={event=>{setFilter(event.target.value);setPage(1);}}><option value="all">All decisions</option><option value="assigned">Pending Review</option><option value="approve">Approved</option><option value="reject">Rejected</option><option value="awaiting_clarification">Clarification Requested</option><option value="recused">Unable to Review</option></Select>}
    <Button disabled={loading} onClick={()=>void load()}>Refresh</Button>
   </FilterToolbar>
   {error?<div className="p-6"><p role="alert" className="mb-3 text-support text-status-danger">{error}</p><Button onClick={()=>void load()}>Retry</Button></div>:loading?<LoadingState label="Loading assigned applications…"/>:<>
    {history?<DataTable density="compact" label="My review history" className="min-w-[700px]"><thead><tr><th className="text-left">Application No.</th><th className="text-left">My Decision</th><th className="text-left">Reason</th><th className="text-left">Decision Date</th><th className="text-center">Actions</th></tr></thead><tbody>
     {decisions.slice(start,start+size).map(row=><tr key={row.id}><td className="font-semibold">{row.applicationId}</td><td><StatusBadge status={row.decision==="approve"?"approved":"rejected"}/></td><td className="max-w-72 whitespace-pre-wrap break-words">{row.reason||"—"}</td><td>{committeeDate(row.createdAt)}</td><td className="text-center"><RecordActionsMenu label={row.applicationId} viewLabel="View My Decision" onView={()=>setReceipt(row)} additionalActions={row.accessAvailable!==false?[{label:"View Application",onSelect:()=>setSelected({id:row.assignmentId,tab:"details"})}]:[]}/></td></tr>)}
    </tbody></DataTable>:<DataTable density="compact" label="My assigned applications" className="min-w-[950px]"><thead><tr><th className="text-left">Application No.</th><th className="text-left">Borrower</th><th className="text-left">Loan Type</th><th className="text-right">Loan Amount</th><th className="text-left">My Decision</th><th className="text-left">Approval Progress</th><th className="text-center">Actions</th></tr></thead><tbody>
     {assignments.slice(start,start+size).map(row=><tr key={row.id}><td className="font-semibold">{row.applicationId}</td><td><p className="font-semibold">{row.applicant}</p><p className="mt-0.5 text-caption text-portal-secondary">{row.memberNumber}</p></td><td>{loanTypeLabel(row.loanType)}</td><td className="whitespace-nowrap text-right font-semibold tabular-nums">{committeeMoney(row.amount)}</td><td><StatusBadge status={row.myDecision==="approve"?"approved":row.myDecision==="reject"?"rejected":row.state==="assigned"?"pending":"under review"} label={committeeDecisionLabel(row)}/></td><td>{row.stage==="BOD"&&<p className="mb-1 text-caption text-portal-secondary">{row.crecomConfirmations?"CRECOM: "+crecomConfirmationProgress(row.crecomConfirmations).approved+" of 3 approved":"CRECOM approvals unavailable"}</p>}<span className={row.approvalProgress?.rejected?"text-status-danger":""}>{committeeApprovalLabel(row)}</span></td><td className="text-center"><RecordActionsMenu label={row.applicationId} viewLabel={row.state==="assigned"||row.state==="awaiting_clarification"?"Review Application":"View Application"} onView={()=>setSelected({id:row.id,tab:"details"})} additionalActions={row.state==="decision_recorded"?[{label:"View My Decision",onSelect:()=>setSelected({id:row.id,tab:"decision"})}]:[]}/></td></tr>)}
    </tbody></DataTable>}
    {!count&&<EmptyState title={history?"No review decisions recorded.":"No assigned applications."} description={query||filter!=="all"?"Try changing your search or filter.":"Applications appear here after staff verify the requirements and assign your review."}/>}
    <Pagination currentPage={current} totalPages={pages} showingFrom={start+1} showingTo={Math.min(start+size,count)} totalItems={count} itemLabel={history?"decisions":"applications"} onPageChange={setPage} controls={<PaginationControls sortOption={sort} pageSize={size} onSortChange={value=>{setSort(value);setPage(1);}} onPageSizeChange={value=>{setSize(value);setPage(1);}}/>}/>
   </>}
  </Card>
  {selected&&<CommitteePacket key={selected.id} assignmentId={selected.id} initialTab={selected.tab} onClose={close} onUpdated={load}/>}
  {receipt&&<ActionDialog title="My Recorded Decision" subtitle={receipt.applicationId} onClose={()=>setReceipt(null)} footer={<Button onClick={()=>setReceipt(null)}>Close</Button>}><dl className="space-y-3 text-support"><div><dt className="text-portal-secondary">Decision</dt><dd className="font-semibold">{receipt.decision==="approve"?"Approved":"Rejected"}</dd></div><div><dt className="text-portal-secondary">Decision Date</dt><dd>{committeeDate(receipt.createdAt)}</dd></div><div><dt className="text-portal-secondary">Reason</dt><dd className="whitespace-pre-wrap">{receipt.reason||"No reason added."}</dd></div><div><dt className="text-portal-secondary">Reference</dt><dd className="break-all">{receipt.id}</dd></div></dl></ActionDialog>}
 </div>;
}
function CommitteeInbox(){
 const {rows,error,busy,load,mark}=useCommitteeInbox();
 const [query,setQuery]=useState(""),[filter,setFilter]=useState("all"),[page,setPage]=useState(1),[size,setSize]=useState(10),[sort,setSort]=useState<DateSortOrder>("Newest"),[assignment,setAssignment]=useState<string|null>(null);
 const filtered=(rows??[]).filter(row=>(filter==="all"||!row.read)&&(row.title+" "+row.message).toLowerCase().includes(query.toLowerCase())).sort((a,b)=>(sort==="Newest"?-1:1)*(Date.parse(a.createdAt)-Date.parse(b.createdAt)));
 const pages=Math.max(1,Math.ceil(filtered.length/size)),current=Math.min(page,pages),start=(current-1)*size;
 return <><Card padded={false}>
  <FilterToolbar><SearchInput aria-label="Search my notifications" placeholder="Search my notifications…" value={query} onChange={event=>{setQuery(event.target.value);setPage(1);}} /><Select aria-label="Notification state" value={filter} onChange={event=>{setFilter(event.target.value);setPage(1);}}><option value="all">All notifications</option><option value="unread">Unread</option></Select><Button disabled={busy} onClick={()=>void load()}>Refresh</Button><Button disabled={busy||!rows?.some(row=>!row.read)} onClick={()=>void mark(null)}>Mark all read</Button></FilterToolbar>
  {error&&<p role="alert" className="px-6 pb-3 text-support text-status-danger">{error}</p>}
  {!rows&&!error?<LoadingState label="Loading my notifications…" />:<>
   <ul className="divide-y divide-portal-border">{filtered.slice(start,start+size).map(row=><li key={row.id} className="space-y-2 px-4 py-4 sm:px-6"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-support font-semibold">{row.title}{!row.read&&<span className="ml-2 text-caption text-coop-dashboard-green">Unread</span>}</h2><span className="text-caption text-portal-secondary">{committeeDate(row.createdAt)}</span></div><p className="whitespace-pre-wrap break-words text-support text-portal-secondary">{row.message}</p><div className="flex flex-wrap gap-2">{!row.read&&<Button size="compact" disabled={busy} onClick={()=>void mark(row.id)}>Mark read</Button>}{row.assignmentId&&(row.accessAvailable?<Button size="compact" disabled={busy} onClick={()=>void (async()=>{if(row.read||await mark(row.id))setAssignment(row.assignmentId);})()}>View Application</Button>:<span className="text-caption text-portal-secondary">Case access is no longer available.</span>)}</div></li>)}</ul>
   {!filtered.length&&<EmptyState title="No notifications." description="Notifications addressed to your own account will appear here." />}
   <Pagination currentPage={current} totalPages={pages} totalItems={filtered.length} showingFrom={start+1} showingTo={Math.min(start+size,filtered.length)} itemLabel="notifications" onPageChange={setPage} controls={<PaginationControls sortOption={sort} pageSize={size} onSortChange={value=>{setSort(value);setPage(1);}} onPageSizeChange={value=>{setSize(value);setPage(1);}} />} />
  </>}
 </Card>{assignment&&<CommitteePacket key={assignment} assignmentId={assignment} onClose={()=>setAssignment(null)}/>}</>;
}
