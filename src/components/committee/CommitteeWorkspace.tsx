"use client";
import Link from "next/link";
import {useCallback,useEffect,useMemo,useState} from "react";
import {useCommitteeAuth} from "./CommitteeAuthProvider";
import {useCommitteeServices} from "./CommitteeServices";
import {getPortalPrefix,type CommitteeWorkspace as Workspace,type CommitteeNotification} from "@/lib/committee";
import {getLoanTypeLabel as loanTypeLabel} from "@/lib/loanTypeLabel";
import {Button} from "@/components/ui/Button";
import {Card} from "@/components/ui/Card";
import {DataTable} from "@/components/ui/DataTable";
import {StatusBadge} from "@/components/ui/StatusBadge";
import {EmptyState,LoadingState} from "@/components/ui/Feedback";
import {FilterToolbar,SearchInput} from "@/components/ui/FilterToolbar";
import {Select} from "@/components/ui/Fields";
import {Pagination,PaginationControls} from "@/components/ui/Pagination";
import {actionButtonStyles} from "@/components/shared/actionButtonStyles";
import type {DateSortOrder} from "@/lib/tablePagination";
import CommitteeProfile from "./CommitteeProfile";
import CommitteeActiveLogs from "./CommitteeActiveLogs";
import {watchAdminNotifications} from "@/lib/adminNotifications";
import {committeeDate,committeeMoney} from "@/lib/committeePresentation";
export default function CommitteeWorkspace({section}:{section:string}){
 if(section==="active-logs")return <CommitteeActiveLogs/>;
 if(section==="profile")return <CommitteeProfile />;
 if(section==="notifications")return <CommitteeInbox />;
 return <CommitteeCases section={section} />;
}
function CommitteeCases({section}:{section:string}){
 const {committeeRequest}=useCommitteeServices(),{role,portalPrefix,user,prototype,access}=useCommitteeAuth(),prefix=portalPrefix??getPortalPrefix(role),[data,setData]=useState<Workspace|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState("");
 const [query,setQuery]=useState(""),[filter,setFilter]=useState("all"),[page,setPage]=useState(1),[size,setSize]=useState(10),[sort,setSort]=useState<DateSortOrder>("Newest");
 const load=useCallback(async()=>{setLoading(true);setError("");try{setData(await committeeRequest<Workspace>());}catch(error){setData(null);setError(error instanceof Error?error.message:"Assigned work could not be loaded.");}finally{setLoading(false);}},[committeeRequest]);
 useEffect(()=>{let active=true;void committeeRequest<Workspace>().then(value=>{if(active)setData(value);}).catch(error=>{if(active)setError(error instanceof Error?error.message:"Assigned work could not be loaded.");}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[committeeRequest]);
 useEffect(()=>{if(prototype)return;return watchAdminNotifications(user.id,()=>void load());},[user.id,prototype,load]);
 const history=section==="history";
 const assignments=useMemo(()=>data?.assignments.filter(row=>(section!=="dashboard"||row.state==="assigned")&&(filter==="all"||row.state===filter)&&(row.applicationId+" "+row.applicant+" "+row.memberNumber+" "+row.loanType).toLowerCase().includes(query.toLowerCase())).sort((a,b)=>(sort==="Newest"?-1:1)*(Date.parse(a.assignedAt)-Date.parse(b.assignedAt)))??[],[data,query,filter,sort,section]);
 const decisions=useMemo(()=>data?.history.filter(row=>(row.applicationId+" "+row.decision+" "+row.reason).toLowerCase().includes(query.toLowerCase())).sort((a,b)=>(sort==="Newest"?-1:1)*(Date.parse(a.createdAt)-Date.parse(b.createdAt)))??[],[data,query,sort]);
 const count=history?decisions.length:assignments.length,pages=Math.max(1,Math.ceil(count/size)),current=Math.min(page,pages),start=(current-1)*size;
 return <div className="space-y-4">
  {section==="dashboard"&&<div><h2 className="text-section-title font-semibold">Welcome, {access.name}</h2><p className="mt-1 text-support text-portal-secondary">Here is an overview of your assigned loan reviews.</p></div>}
  {section==="dashboard"&&data&&<div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{([["Assigned",data.counts.assigned],["Needs My Review",data.counts.pending],["Awaiting Others",data.counts.waiting],["Completed Reviews",data.counts.completed]] as const).map(([label,value])=><Card key={label}><p className="text-caption text-portal-secondary">{label}</p><p className="mt-1 text-section-title font-bold tabular-nums">{value}</p></Card>)}</div>}
  <Card padded={false}>
   <div className="border-b border-portal-border px-4 py-4 sm:px-6"><h2 className="text-card-title font-semibold">{history?"Review History":section==="dashboard"?"Applications Requiring My Review":"Applications"}</h2><p className="mt-1 text-support text-portal-secondary">{history?"Your recorded decisions, linked to the packet version reviewed.":"Open your assigned packet to view the frozen application summary and supporting documents."}</p></div>
   <FilterToolbar><SearchInput aria-label={history?"Search my review history":"Search my assigned applications"} placeholder="Search application, member name or ID…" value={query} onChange={event=>{setQuery(event.target.value);setPage(1);}} />
    {!history&&<Select aria-label="Assignment state" value={filter} onChange={event=>{setFilter(event.target.value);setPage(1);}}><option value="all">All assignments</option><option value="assigned">Awaiting my review</option><option value="awaiting_clarification">For clarification</option><option value="decision_recorded">Decision recorded</option><option value="recused">Recused</option></Select>}
    <Button disabled={loading} onClick={()=>void load()}>Refresh</Button>
   </FilterToolbar>
   {error?<div className="p-6"><p role="alert" className="mb-3 text-support text-status-danger">{error}</p><Button onClick={()=>void load()}>Retry</Button></div>:loading?<LoadingState label="Loading assigned work…" />:<>
    {history?<DataTable density="compact" label="My review history" className="min-w-[700px]"><thead><tr><th className="text-left">Application</th><th className="text-left">Cycle / packet</th><th className="text-left">My decision</th><th className="text-left">Reason</th><th className="text-left">Recorded</th><th className="text-center">Action</th></tr></thead><tbody>
     {decisions.slice(start,start+size).map(row=><tr key={row.id}><td className="font-semibold">{row.applicationId}</td><td>{row.cycle} / v{row.packetVersion}</td><td><StatusBadge status={row.decision==="approve"?"approved":"rejected"} label={row.decision==="approve"?"Approve":"Reject"} /></td><td className="max-w-72 whitespace-pre-wrap break-words">{row.reason||"—"}</td><td>{committeeDate(row.createdAt)}</td><td className="text-center">{row.accessAvailable!==false?<Link href={prefix+"/review/"+row.assignmentId} className={actionButtonStyles()}>View packet</Link>:<span className="text-caption text-portal-secondary">Archived cycle</span>}</td></tr>)}
    </tbody></DataTable>:<DataTable density="compact" label="My assigned applications" className="min-w-[900px]"><thead><tr><th className="text-left">Application</th><th className="text-left">Member</th><th className="text-left">Loan type</th><th className="text-right">Amount</th><th className="text-left">Stage / cycle</th><th className="text-left">My review</th><th className="text-left">Group responses</th><th className="text-left">Due</th><th className="text-center">Action</th></tr></thead><tbody>
     {assignments.slice(start,start+size).map(row=><tr key={row.id}><td className="font-semibold">{row.applicationId}</td><td><p className="font-semibold">{row.applicant}</p><p className="mt-0.5 text-caption text-portal-secondary">{row.memberNumber}</p></td><td>{loanTypeLabel(row.loanType)}</td><td className="whitespace-nowrap text-right font-semibold tabular-nums">{committeeMoney(row.amount)}</td><td>{row.stage} · {row.cycle}<p className="text-caption text-portal-secondary">Packet v{row.packetVersion}</p></td><td className="capitalize">{row.state.replaceAll("_"," ")}</td><td>{row.responded} of {row.assigned} responded</td><td>{committeeDate(row.dueAt)}</td><td className="text-center"><Link className={actionButtonStyles()} href={prefix+"/review/"+row.id}>View packet</Link></td></tr>)}
    </tbody></DataTable>}
    {!count&&<EmptyState title={history?"No review decisions recorded.":"No assigned applications."} description={query||filter!=="all"?"Try changing your search or filter.":"Cases appear here after authorized staff forward and assign a review packet."} />}
    <Pagination currentPage={current} totalPages={pages} showingFrom={start+1} showingTo={Math.min(start+size,count)} totalItems={count} itemLabel={history?"decisions":"assignments"} onPageChange={setPage} controls={<PaginationControls sortOption={sort} pageSize={size} onSortChange={value=>{setSort(value);setPage(1);}} onPageSizeChange={value=>{setSize(value);setPage(1);}} />} />
   </>}
  </Card>
  {section==="dashboard"&&data&&<Card><h2 className="text-card-title font-semibold">Recent Review Activities</h2>{data.history.length?<ol className="mt-3 divide-y divide-portal-border">{data.history.slice(0,5).map(item=><li key={item.id} className="flex flex-wrap justify-between gap-2 py-3 text-support"><span className="font-medium">{item.applicationId} · {item.decision==="approve"?"Approved":"Rejected"}</span><span className="text-caption text-portal-secondary">{committeeDate(item.createdAt)}</span>{item.reason&&<p className="w-full whitespace-pre-wrap text-portal-secondary">{item.reason}</p>}</li>)}</ol>:<p className="mt-2 text-support text-portal-secondary">Your confirmed decisions will appear here.</p>}</Card>}
  <p className="text-caption text-portal-secondary">Open an assigned packet to record your own confirmation. All three CRECOM reviewers must approve before BOD review. Authorized staff records final approval after the BOD chairperson confirms.</p>
 </div>;
}
function CommitteeInbox(){
 const {committeeRequest}=useCommitteeServices(),{role,portalPrefix,user,prototype}=useCommitteeAuth(),prefix=portalPrefix??getPortalPrefix(role),[rows,setRows]=useState<CommitteeNotification[]|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const [query,setQuery]=useState(""),[filter,setFilter]=useState("all"),[page,setPage]=useState(1),[size,setSize]=useState(10),[sort,setSort]=useState<DateSortOrder>("Newest");
 const load=useCallback(async()=>{setError("");setBusy(true);try{setRows(await committeeRequest<CommitteeNotification[]>("operation=inbox"));}catch(error){setRows(null);setError(error instanceof Error?error.message:"Notifications could not be loaded.");}finally{setBusy(false);}},[committeeRequest]);
 useEffect(()=>{let active=true;void committeeRequest<CommitteeNotification[]>("operation=inbox").then(value=>{if(active)setRows(value);}).catch(error=>{if(active)setError(error instanceof Error?error.message:"Notifications could not be loaded.");});return()=>{active=false;};},[committeeRequest]);
 useEffect(()=>{if(!prototype)return watchAdminNotifications(user.id,()=>void load());const timer=window.setInterval(()=>void load(),5000);return()=>window.clearInterval(timer);},[user.id,prototype,load]);
 const mark=async(id:string|null)=>{setBusy(true);setError("");try{setRows(await committeeRequest<CommitteeNotification[]>("",{method:"POST",body:JSON.stringify({operation:"read",id,all:id===null})}));}catch(error){setError(error instanceof Error?error.message:"The notification could not be updated.");}finally{setBusy(false);}};
 const filtered=(rows??[]).filter(row=>(filter==="all"||!row.read)&&(row.title+" "+row.message).toLowerCase().includes(query.toLowerCase())).sort((a,b)=>(sort==="Newest"?-1:1)*(Date.parse(a.createdAt)-Date.parse(b.createdAt)));
 const pages=Math.max(1,Math.ceil(filtered.length/size)),current=Math.min(page,pages),start=(current-1)*size;
 return <Card padded={false}>
  <FilterToolbar><SearchInput aria-label="Search my notifications" placeholder="Search my notifications…" value={query} onChange={event=>{setQuery(event.target.value);setPage(1);}} /><Select aria-label="Notification state" value={filter} onChange={event=>{setFilter(event.target.value);setPage(1);}}><option value="all">All notifications</option><option value="unread">Unread</option></Select><Button disabled={busy} onClick={()=>void load()}>Refresh</Button><Button disabled={busy||!rows?.some(row=>!row.read)} onClick={()=>void mark(null)}>Mark all read</Button></FilterToolbar>
  {error&&<p role="alert" className="px-6 pb-3 text-support text-status-danger">{error}</p>}
  {!rows&&!error?<LoadingState label="Loading my notifications…" />:<>
   <ul className="divide-y divide-portal-border">{filtered.slice(start,start+size).map(row=><li key={row.id} className="space-y-2 px-4 py-4 sm:px-6"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-support font-semibold">{row.title}{!row.read&&<span className="ml-2 text-caption text-coop-dashboard-green">Unread</span>}</h2><span className="text-caption text-portal-secondary">{committeeDate(row.createdAt)}</span></div><p className="whitespace-pre-wrap break-words text-support text-portal-secondary">{row.message}</p><div className="flex flex-wrap gap-2">{!row.read&&<Button size="compact" disabled={busy} onClick={()=>void mark(row.id)}>Mark read</Button>}{row.assignmentId&&(row.accessAvailable?<Link href={prefix+"/review/"+row.assignmentId} className={actionButtonStyles()}>View assigned case</Link>:<span className="text-caption text-portal-secondary">Case access is no longer available.</span>)}</div></li>)}</ul>
   {!filtered.length&&<EmptyState title="No notifications." description="Notifications addressed to your own account will appear here." />}
   <Pagination currentPage={current} totalPages={pages} totalItems={filtered.length} showingFrom={start+1} showingTo={Math.min(start+size,filtered.length)} itemLabel="notifications" onPageChange={setPage} controls={<PaginationControls sortOption={sort} pageSize={size} onSortChange={value=>{setSort(value);setPage(1);}} onPageSizeChange={value=>{setSize(value);setPage(1);}} />} />
  </>}
 </Card>;
}
