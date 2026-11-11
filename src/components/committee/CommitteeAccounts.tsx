"use client";
import PortalPageHeading from "@/components/shared/PortalPageHeading";
import AccountRoleBadge from "@/components/shared/AccountRoleBadge";
import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import CommitteePasswordField from "./CommitteePasswordField";
import {CommitteeField} from "./CommitteeFields";
import {useAdminAuth} from "@/components/auth/AdminAuthProvider";
import {committeeRequest} from "@/lib/committeeRequest";
import {committeePositionLabel,membershipDateInput,membershipDates,validateCommitteeInvite,validateCommitteeCredentials,type CommitteeAccount,type CommitteeAccountsData,type CommitteeInvite,type CommitteeRole,type CommitteeSeat} from "@/lib/committee";
import {Button} from "@/components/ui/Button";
import {Card} from "@/components/ui/Card";
import {DataTable} from "@/components/ui/DataTable";
import {ActionDialog} from "@/components/ui/ActionDialog";
import {Input,Select,Textarea} from "@/components/ui/Fields";
import {FilterToolbar,SearchInput} from "@/components/ui/FilterToolbar";
import {Pagination,PaginationControls} from "@/components/ui/Pagination";
import {EmptyState,LoadingState} from "@/components/ui/Feedback";
import {StatusBadge} from "@/components/ui/StatusBadge";
import {UserRoundPlus} from "lucide-react";
import type {DateSortOrder} from "@/lib/tablePagination";

const date=(value:string|null)=>value?new Date(value).toLocaleDateString("en-PH",{timeZone:"Asia/Manila",month:"short",day:"numeric",year:"numeric"}):"No end date";
type Mode="create"|"invite"|"edit"|"deactivate"|"reactivate"|"link";
type Selection={mode:Mode;account?:CommitteeAccount};
export default function CommitteeAccounts(){
 const {role,can}=useAdminAuth(),permitted=role==="super_admin"||can("committee.accounts.manage"),[data,setData]=useState<CommitteeAccountsData|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [query,setQuery]=useState(""),[filter,setFilter]=useState("all"),[statusFilter,setStatusFilter]=useState("all"),[positionFilter,setPositionFilter]=useState("all"),[page,setPage]=useState(1),[size,setSize]=useState(10),[sort,setSort]=useState<DateSortOrder>("Newest");
 const [selection,setSelection]=useState<Selection|null>(null),[details,setDetails]=useState<CommitteeAccount|null>(null);
 const load=useCallback(async()=>{
  setLoading(true);setError("");
  try{setData(await committeeRequest<CommitteeAccountsData>("",{},true));}catch(error){setData(null);setError(error instanceof Error?error.message:"Committee accounts could not be loaded.");}
  finally{setLoading(false);}
 },[]);
 useEffect(()=>{
  if(!permitted)return;
  let active=true;
  void committeeRequest<CommitteeAccountsData>("",{},true).then(value=>{if(active)setData(value);}).catch(error=>{if(active)setError(error instanceof Error?error.message:"Committee accounts could not be loaded.");}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[permitted]);
 const rows=useMemo(()=>data?.accounts.filter(row=>(filter==="all"||row.role===filter)&&(statusFilter==="all"||row.status===statusFilter)&&(positionFilter==="all"||(positionFilter==="1"||positionFilter==="2"?row.committeeSeat==="member"&&row.committeeMemberNumber===Number(positionFilter):row.committeeSeat===positionFilter))&&(row.name+" "+row.email+" "+row.title+" "+committeePositionLabel(row.role,row.committeeSeat,row.committeeMemberNumber)).toLowerCase().includes(query.toLowerCase())).sort((a,b)=>(sort==="Newest"?-1:1)*(Date.parse(a.startsAt)-Date.parse(b.startsAt)))??[],[data,filter,statusFilter,positionFilter,query,sort]);
 const pages=Math.max(1,Math.ceil(rows.length/size)),current=Math.min(page,pages),start=(current-1)*size;
 if(!permitted)return <Card><p role="alert">Committee account management permission is required. Ask your Super Admin to enable it for your Admin account.</p></Card>;
 return <>
  <Card padded={false}>
   <PortalPageHeading section="committee-accounts" />
   <p className="px-4 pt-3 text-caption text-portal-secondary sm:px-6">Create and manage individual reviewer accounts. Each reviewer signs in through the main login page and confirms decisions with their own password.</p>
   {data?.bodEnabled===false&&<p className="px-4 pt-2 text-caption text-portal-secondary sm:px-6">BOD accounts can be created and set up now. BOD loan reviews will be available after the workflow policy is approved and activated.</p>}
   <FilterToolbar><SearchInput aria-label="Search committee accounts" placeholder="Search reviewer name or email…" value={query} onChange={event=>{setQuery(event.target.value);setPage(1);}} />
    <Select aria-label="Committee role" value={filter} onChange={event=>{setFilter(event.target.value);setPage(1);}}><option value="all">All committees</option><option value="crecom_member">CRECOM Members</option><option value="bod_member">BOD</option></Select>
    <Select aria-label="Committee position" value={positionFilter} onChange={event=>{setPositionFilter(event.target.value);setPage(1);}}><option value="all">All positions</option><option value="1">CRECOM Member 1</option><option value="2">CRECOM Member 2</option><option value="member">All CRECOM members</option><option value="chairperson">Chairpersons</option></Select>
    <Select aria-label="Account status" value={statusFilter} onChange={event=>{setStatusFilter(event.target.value);setPage(1);}}><option value="all">All statuses</option><option value="active">Active</option><option value="invited">Password setup pending</option><option value="inactive">Inactive</option><option value="scheduled">Scheduled</option><option value="expired">Expired</option><option value="failed">Creation failed</option></Select>
    <Button onClick={()=>void load()} disabled={loading}>Refresh</Button>
    <Button variant="primary" onClick={()=>setSelection({mode:"create"})} disabled={!data||loading}><UserRoundPlus className="h-4 w-4" />Create Committee Account</Button>
   </FilterToolbar>
   {notice&&<p role="status" className="px-4 pb-3 text-support text-status-success sm:px-6">{notice}</p>}
   {error?<div className="p-6"><p role="alert" className="mb-3 text-support text-status-danger">{error}</p><Button onClick={()=>void load()}>Retry</Button></div>:loading?<LoadingState label="Loading committee accounts…" />:<>
    <DataTable density="compact" label="Committee accounts" className="min-w-[850px]">
     <thead><tr><th className="text-left">Full name</th><th className="text-left">Email address</th><th className="text-left">Committee / role</th><th className="text-left">Membership</th><th className="text-left">Status</th><th className="text-center">Open cases</th><th className="text-center">Actions</th></tr></thead>
     <tbody>{rows.slice(start,start+size).map(account=><tr key={account.id}>
      <td className="font-semibold">{account.name}</td><td>{account.email}</td>
      <td><AccountRoleBadge role={account.role}/><p className="mt-1 text-caption">{committeePositionLabel(account.role,account.committeeSeat,account.committeeMemberNumber)}</p>{account.role==="crecom_member"&&account.committeeSeat==="member"&&!account.committeeMemberNumber&&<p className="mt-1 text-caption text-status-warning">Set Member 1 or Member 2 in membership details.</p>}{account.title&&<p className="mt-0.5 text-caption text-portal-secondary">{account.title}</p>}</td>
      <td className="whitespace-nowrap"><p>{date(account.startsAt)}</p><p className="mt-0.5 text-caption text-portal-secondary">{account.endsAt?"Through "+date(new Date(Date.parse(account.endsAt)-1).toISOString()):"No end date"}</p></td>
      <td><StatusBadge status={account.status} label={account.status==="invited"?"Password setup pending":undefined} className="capitalize" />{account.error&&<p className="mt-1 max-w-44 text-caption text-status-danger">{account.error}</p>}</td>
      <td className="text-center tabular-nums">{account.assignedCount}</td>
      <td className="text-center"><Button size="compact" onClick={()=>account.revision>0?setDetails(account):setSelection({mode:account.creationMode==="password"?"create":"invite",account})}>{account.revision>0?"Manage":"Retry creation"}</Button></td>
     </tr>)}</tbody>
    </DataTable>
    {!rows.length&&<EmptyState title="No committee accounts." description="Create a separate account for each CRECOM member, CRECOM chairperson and BOD chairperson." />}
    <Pagination currentPage={current} totalPages={pages} totalItems={rows.length} showingFrom={start+1} showingTo={Math.min(start+size,rows.length)} itemLabel="reviewers" onPageChange={setPage}
     controls={<PaginationControls sortOption={sort} pageSize={size} onSortChange={value=>{setSort(value);setPage(1);}} onPageSizeChange={value=>{setSize(value);setPage(1);}} />} />
   </>}
  </Card>
  {details&&<CommitteeAccountDetails account={details} onClose={()=>setDetails(null)} onAction={mode=>{setSelection({mode,account:details});setDetails(null);}} />}
  {selection&&<CommitteeMembershipDialog {...selection} accounts={data?.accounts??[]} onClose={()=>setSelection(null)} onSaved={message=>{setSelection(null);setNotice(message);void load();}} />}
 </>;
}
function CommitteeMembershipDialog({mode,account,accounts,onClose,onSaved}:{mode:Mode;account?:CommitteeAccount;accounts:CommitteeAccount[];onClose:()=>void;onSaved:(message:string)=>void}){
 const creating=mode==="create"||mode==="invite",retry=creating&&!!account;
 const [name,setName]=useState(account?.name??""),[email,setEmail]=useState(account?.email??""),[role,setRole]=useState<CommitteeRole>(account?.role??"crecom_member"),[title,setTitle]=useState(account?.title??"");
 const [committeeSeat,setCommitteeSeat]=useState<CommitteeSeat>(account?.committeeSeat??"member");
 const [memberNumber,setMemberNumber]=useState<1|2|null>(account?.committeeMemberNumber??null);
 const [start,setStart]=useState(membershipDateInput(account?.startsAt??new Date().toISOString())),[end,setEnd]=useState(membershipDateInput(account?.endsAt??null,true)),[reason,setReason]=useState(""),[password,setPassword]=useState("");
 const [review,setReview]=useState(false),[attempted,setAttempted]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[requestId]=useState(()=>retry?account!.requestId:crypto.randomUUID()),[payload,setPayload]=useState<CommitteeInvite|null>(null);
 const label=creating?(retry?"Retry creation":"Create Committee Account"):mode==="edit"?"Edit membership":mode==="link"?"Send setup / reset link":mode==="deactivate"?"Deactivate membership":"Reactivate membership";
 const [temporary,setTemporary]=useState(""),[temporaryConfirm,setTemporaryConfirm]=useState(""),[identityVerified,setIdentityVerified]=useState(false);
 const pending=useRef(false),[checked,setChecked]=useState(false),[touched,setTouched]=useState<Record<string,boolean>>({});
 const fieldErrors:Record<string,string>={};
 if(!name.trim()||name.trim().length>160||/[\u0000-\u001f\u007f]/.test(name))fieldErrors.name="Enter a full name of up to 160 characters.";
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())||email.length>254)fieldErrors.email="Enter a valid email address.";
 const duplicate=creating&&!retry?accounts.find(row=>row.email.trim().toLowerCase()===email.trim().toLowerCase()):null;
 if(duplicate)fieldErrors.email=duplicate.revision>0?`This email already belongs to ${committeePositionLabel(duplicate.role,duplicate.committeeSeat,duplicate.committeeMemberNumber)}. Manage that account or choose a different email.`:"This email already has a saved committee creation request. Use Retry creation for that request.";
 if(role==="crecom_member"&&committeeSeat==="member"&&!memberNumber)fieldErrors.position="Choose CRECOM Member 1 or CRECOM Member 2.";
 if(!/^\d{4}-\d{2}-\d{2}$/.test(start))fieldErrors.start="Choose a start date.";
 if(end&&end<start)fieldErrors.end="End date must be on or after the start date.";
 if(mode==="create"){
  if(!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,128}$/.test(temporary))fieldErrors.temporary="Use 8–128 characters with uppercase, lowercase, a number and a symbol.";
  if(!temporaryConfirm||temporaryConfirm!==temporary)fieldErrors.confirm="Passwords must match.";
  if(!identityVerified)fieldErrors.identity="Confirm the reviewer identity and committee appointment.";
 }
 const inputProps=(key:string)=>({id:"committee-account-"+key,"aria-invalid":!!fieldErrors[key]&&(checked||touched[key]),"aria-describedby":fieldErrors[key]&&(checked||touched[key])?"committee-account-"+key+"-error":undefined,onBlur:()=>setTouched(current=>({...current,[key]:true}))});
 const shownError=(key:string)=>(checked||touched[key])?fieldErrors[key]:undefined;
 const prepare=()=>{
  setError("");setChecked(true);
  try{
   if(creating||mode==="edit"){
    if(Object.keys(fieldErrors).length)throw new Error("Complete the highlighted fields before continuing.");
    const input=validateCommitteeInvite({name,email,role,committeeSeat,committeeMemberNumber:memberNumber,title,...membershipDates(start,end)});

    setPayload(input);
   }
   if(["edit","deactivate","reactivate"].includes(mode)&&!reason.trim())throw new Error("Enter a reason for this membership change.");
   if(mode==="create"){validateCommitteeCredentials({password:temporary,confirm:temporaryConfirm});if(!identityVerified)throw new Error("Confirm the reviewer identity and committee appointment.");}
   setReview(true);
  }catch(error){setError(error instanceof Error?error.message:"Check the membership details.");}
 };
 const save=async()=>{
  if(pending.current)return;setError("");if(!password){setError("Enter your account password.");return;}
  pending.current=true;setBusy(true);setAttempted(true);
  try{
   const result=await committeeRequest<{message?:string}>("",{method:"POST",body:JSON.stringify({operation:mode,id:account?.id,revision:account?.revision,requestId,password,...(mode==="create"?{credentials:{password:temporary,confirm:temporaryConfirm},identityVerified}:{}),payload:creating?payload:mode==="edit"?{...payload,reason:reason.trim()}:{reason:reason.trim()}})},true);
   onSaved(result.message??(mode==="invite"?"Invitation processed. The reviewer must open their email link and choose a password.":mode==="link"?"A setup/reset link was requested for this reviewer.":"Committee membership updated."));
  }catch(error){setError(error instanceof Error?error.message:"The committee action failed. Retry this request.");}
  finally{pending.current=false;setPassword("");setBusy(false);}
 };
 return <ActionDialog title={label} subtitle={account?.email} onClose={onClose} busy={busy} className="max-w-xl" footer={<><Button disabled={busy} onClick={onClose}>Cancel</Button>{review?<Button variant="primary" loading={busy} onClick={()=>void save()}>{mode==="create"?"Create account":mode==="invite"?"Send invitation":"Confirm"}</Button>:<Button variant="primary" onClick={prepare}>Review</Button>}</>}>
  {review?<div className="space-y-4 text-support">
   <dl className="grid grid-cols-2 gap-3"><div><dt className="text-caption text-portal-secondary">Reviewer</dt><dd className="break-words font-semibold">{name||account?.name}</dd></div><div><dt className="text-caption text-portal-secondary">Approval position</dt><dd>{committeePositionLabel(role,committeeSeat,memberNumber)}</dd></div>
    <div className="col-span-2"><dt className="text-caption text-portal-secondary">Email</dt><dd className="break-all">{email}</dd></div>
    {(creating||mode==="edit")&&<div className="col-span-2"><dt className="text-caption text-portal-secondary">Membership</dt><dd>{start} through {end||"no end date"}</dd></div>}
    {reason&&<div className="col-span-2"><dt className="text-caption text-portal-secondary">Reason</dt><dd className="whitespace-pre-wrap break-words">{reason}</dd></div>}
   </dl>
   {mode==="deactivate"&&<p>New access to assigned cases and files will stop. Existing decisions and assignment history stay recorded.</p>}
   {creating&&<p>The reviewer signs in through the main login page and sets their own password before opening assigned cases. Share initial credentials privately.</p>}
   {mode==="link"&&<p>A personal setup or password reset link will be sent to this account&apos;s registered email.</p>}
   <CommitteeField label="Your account password" id="committee-creator-password"><CommitteePasswordField id="committee-creator-password" label="Your account password" autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} disabled={busy} maxLength={1024}/></CommitteeField>
   {!busy&&<Button size="compact" onClick={()=>{setReview(false);setPassword("");setError("");}}>Back to details</Button>}
  </div>:<div className="grid gap-3 text-support sm:grid-cols-2">
   {(creating||mode==="edit")?<>
    <CommitteeField label="Full name" id="committee-account-name" error={shownError("name")}><Input {...inputProps("name")} value={name} onChange={event=>setName(event.target.value)} maxLength={160} disabled={retry||attempted} autoComplete="name" /></CommitteeField>
    <CommitteeField label="Email address" id="committee-account-email" error={shownError("email")}><Input {...inputProps("email")} type="email" value={email} onChange={event=>setEmail(event.target.value)} disabled={mode==="edit"||retry||attempted} maxLength={254} autoComplete="off" /></CommitteeField>
    <CommitteeField label="Approval position" id="committee-account-position" error={shownError("position")}><Select {...inputProps("position")} value={role==="crecom_member"&&committeeSeat==="member"?memberNumber?"crecom_member:member:"+memberNumber:"":role+":"+committeeSeat} onChange={event=>{const [nextRole,nextSeat,nextNumber]=event.target.value.split(":");setRole(nextRole as CommitteeRole);setCommitteeSeat(nextSeat as CommitteeSeat);setMemberNumber(nextNumber?Number(nextNumber) as 1|2:null);}} disabled={attempted||(retry&&!!account?.committeeMemberNumber)}><option value="" disabled>Choose approval position</option><option value="crecom_member:member:1">CRECOM Member 1</option><option value="crecom_member:member:2">CRECOM Member 2</option><option value="crecom_member:chairperson">CRECOM Chairperson</option><option value="bod_member:chairperson">BOD Chairperson</option></Select></CommitteeField>
    <CommitteeField label="Title (optional)"><Input value={title} onChange={event=>setTitle(event.target.value)} maxLength={100} disabled={retry||attempted} /></CommitteeField>
    <CommitteeField label="Start date" id="committee-account-start" error={shownError("start")}><Input {...inputProps("start")} type="date" value={start} onChange={event=>setStart(event.target.value)} disabled={retry||attempted} /></CommitteeField>
    <CommitteeField label="End date (optional)" id="committee-account-end" error={shownError("end")}><Input {...inputProps("end")} type="date" value={end} min={start} onChange={event=>setEnd(event.target.value)} disabled={retry||attempted} /></CommitteeField>
   </>:<p className="sm:col-span-2">{mode==="link"?"Request a personal setup or reset link for this reviewer.":mode==="deactivate"?"Deactivate this membership and remove access to assigned work.":"Reactivate this membership using its current committee and dates."}</p>}
   {mode==="create"&&<><CommitteeField label="Temporary password" id="committee-account-temporary" error={shownError("temporary")}><CommitteePasswordField {...inputProps("temporary")} label="Temporary password" autoComplete="new-password" value={temporary} onChange={event=>setTemporary(event.target.value)} maxLength={128} /></CommitteeField><CommitteeField label="Confirm temporary password" id="committee-account-confirm" error={shownError("confirm")}><CommitteePasswordField {...inputProps("confirm")} label="Confirm temporary password" autoComplete="new-password" value={temporaryConfirm} onChange={event=>setTemporaryConfirm(event.target.value)} maxLength={128} /></CommitteeField><p className="text-caption text-portal-secondary sm:col-span-2">Use 8–128 characters with uppercase, lowercase, a number and a symbol. Both passwords must match.</p><label className="flex items-start gap-2 sm:col-span-2"><input type="checkbox" checked={identityVerified} onChange={event=>setIdentityVerified(event.target.checked)} /><span>I verified this person&apos;s identity, email and committee appointment.</span></label>{shownError("identity")&&<p className="text-caption text-status-danger sm:col-span-2">{shownError("identity")}</p>}</>}
   {["edit","deactivate","reactivate"].includes(mode)&&<div className="sm:col-span-2"><CommitteeField label="Reason"><Textarea value={reason} onChange={event=>setReason(event.target.value)} maxLength={2000} rows={2} /></CommitteeField></div>}
   {retry&&<p className="text-caption text-portal-secondary sm:col-span-2">Retry keeps the original request details to prevent duplicate accounts.</p>}
   {mode==="edit"&&<p className="text-caption text-portal-secondary sm:col-span-2">Changing the approval position stops access to assignments for the previous position. Reassign outstanding work to someone holding that same position. Recorded confirmations retain their original position.</p>}
  </div>}
  {error&&(error!=="Complete the highlighted fields before continuing."||Object.keys(fieldErrors).length>0)&&<p role="alert" className="mt-3 text-support text-status-danger">{error}</p>}
 </ActionDialog>;
}
type MembershipAssignment={id:string;applicationId:string;stage:string;cycle:number;state:string;assignedAt:string;needsReassignment:boolean};
function CommitteeAccountDetails({account,onClose,onAction}:{account:CommitteeAccount;onClose:()=>void;onAction:(mode:Mode)=>void}){
 const [rows,setRows]=useState<MembershipAssignment[]|null>(null),[error,setError]=useState("");
 useEffect(()=>{let active=true;void committeeRequest<MembershipAssignment[]>("id="+encodeURIComponent(account.id),{},true).then(value=>{if(active)setRows(value);}).catch(error=>{if(active)setError(error instanceof Error?error.message:"Assignment history could not be loaded.");});return()=>{active=false;};},[account.id]);
 return <ActionDialog title={account.name} subtitle={account.email} onClose={onClose} className="max-w-3xl" footer={<Button onClick={onClose}>Close</Button>}>
  <div className="flex flex-wrap items-center gap-2 text-support"><StatusBadge status={account.status} label={account.status==="invited"?"Password setup pending":undefined} className="capitalize" /><span>{committeePositionLabel(account.role,account.committeeSeat,account.committeeMemberNumber)}</span><span className="text-portal-secondary">{account.title}</span></div>
  <dl className="my-4 grid gap-3 text-support sm:grid-cols-2"><div><dt className="text-caption text-portal-secondary">Membership</dt><dd>{date(account.startsAt)} · {account.endsAt?"Through "+date(new Date(Date.parse(account.endsAt)-1).toISOString()):"No end date"}</dd></div><div><dt className="text-caption text-portal-secondary">Account setup</dt><dd>{account.setupCompletedAt?date(account.setupCompletedAt):"Awaiting personal password setup"}</dd></div></dl>
  <div className="mb-5 flex flex-wrap gap-2"><Button size="compact" onClick={()=>onAction("edit")}>Edit membership</Button><Button size="compact" onClick={()=>onAction(account.active?"deactivate":"reactivate")}>{account.active?"Deactivate":"Reactivate"}</Button><Button size="compact" onClick={()=>onAction("link")} disabled={!account.active}>Send setup / reset link</Button></div>
  <h3 className="mb-2 text-support font-semibold">Assignment history</h3>
  {error?<p role="alert" className="text-support text-status-danger">{error}</p>:rows===null?<LoadingState label="Loading assignments…" />:rows.length?<DataTable density="compact" label="Reviewer assignments"><thead><tr><th className="text-left">Application</th><th className="text-left">Stage / cycle</th><th className="text-left">State</th><th className="text-left">Access follow-up</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td>{row.applicationId}</td><td>{row.stage} · {row.cycle}</td><td>{row.state.replaceAll("_"," ")}</td><td>{row.needsReassignment?"Requires reassignment":"—"}</td></tr>)}</tbody></DataTable>:<p className="text-support text-portal-secondary">No assignments have been recorded for this membership.</p>}
 </ActionDialog>;
}
