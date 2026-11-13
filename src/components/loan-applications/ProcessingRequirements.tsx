"use client";

import {useEffect,useRef,useState} from "react";
import {CheckCircle2,ExternalLink} from "lucide-react";
import PasswordInput from "@/components/ui/PasswordInput";
import {ActionResultDialog} from "@/components/ui/ActionResultDialog";
import {ActionDialog} from "@/components/ui/ActionDialog";
import {Badge} from "@/components/ui/StatusBadge";
import {Button} from "@/components/ui/Button";
import {Textarea} from "@/components/ui/Fields";
import DocumentFilePreview from "@/components/documents/DocumentFilePreview";
import DocumentStatusBadge from "@/components/documents/DocumentStatusBadge";
import {documentDate} from "@/components/documents/documentPresentation";
import {documentKindLabels} from "@/lib/documentWorkspace";
import {documentsRequest} from "@/lib/documentWorkspaceRequest";
import {workflowRequest} from "@/lib/applicationWorkflowRequest";
import {borrowerTerms} from "@/lib/borrowerTerms";
import {verificationCheckLabels,type ApplicationVerification,type VerificationChecks,type ConsentEvidenceRecord} from "@/lib/applicationWorkflow";
import styles from "./processing.module.css";

const shortChecks:Record<keyof VerificationChecks,string>={identity:"Identity checked",eligibility:"Eligibility & affordability checked",terms:"Loan terms checked"};

export function requirementEvidence(data:ApplicationVerification) {
  const config=data.policy?.status==="approved"?data.policy.config:null;
  return [
    {key:"borrower",label:"Borrower consent",count:data.evidence.borrower,required:config?.borrowerConsentRequired===null||config?.borrowerConsentRequired===undefined?null:config.borrowerConsentRequired?1:0},
    {key:"co_maker",label:"Co-maker consent",count:data.evidence.coMaker,required:config?.coMakerConsentRequired===null||config?.coMakerConsentRequired===undefined?null:config.coMakerConsentRequired?1:0},
    {key:"witness",label:"Witness names",count:data.evidence.witnesses,required:config?.witnessCount??null},
  ].map(row=>({...row,complete:row.required!==null&&(row.required===0||(row.key==="co_maker"?row.count===row.required:row.count>=row.required))}));
}

export default function ProcessingRequirements({data,checks,editable,canReview,busy,onCheck,onUpdated,onBusy,hideChecklist=false}:{
  hideChecklist?:boolean;data:ApplicationVerification;checks:VerificationChecks;editable:boolean;canReview:boolean;dirty:boolean;busy:boolean;
  onCheck:(key:keyof VerificationChecks,value:boolean)=>void;onUpdated:()=>Promise<void>;onBusy:(value:boolean)=>void;
}) {
  const [preview,setPreview]=useState<string|null>(null),[replacing,setReplacing]=useState(false),[reason,setReason]=useState(""),[saving,setSaving]=useState(false),[error,setError]=useState("");
  const [evidence,setEvidence]=useState<ConsentEvidenceRecord[]|null>(null),[evidenceKind,setEvidenceKind]=useState<string|null>(null),[evidenceLoading,setEvidenceLoading]=useState(false);
  const evidenceKey=data.applicationId+":"+data.packetHash+":"+data.stateHash;
  const [savedEvidence,setSavedEvidence]=useState<{key:string;records:ConsentEvidenceRecord[];error:string}|null>(null);
  const records=savedEvidence?.key===evidenceKey?savedEvidence.records:[],recordsError=savedEvidence?.key===evidenceKey?savedEvidence.error:"",recordsLoading=savedEvidence?.key!==evidenceKey;
  useEffect(()=>{let active=true;
    void workflowRequest<{records:ConsentEvidenceRecord[]}>(new URLSearchParams({operation:"evidence",applicationId:data.applicationId,packetHash:data.packetHash}).toString()).then(result=>{if(active)setSavedEvidence({key:evidenceKey,records:result.records,error:""});}).catch(error=>{if(active)setSavedEvidence({key:evidenceKey,records:[],error:error instanceof Error?error.message:"Evidence could not be loaded."});});
    return()=>{active=false;};
  },[data,evidenceKey]);
  const agreement=evidence?.find(item=>item.kind==="borrower"&&item.terms_text);
  const displayedTerms=agreement?.terms_text?.split(/\n\n/)??borrowerTerms;
  const pending=useRef(false);
  const [reviewConfirm,setReviewConfirm]=useState<"verified"|"needs_replacement"|null>(null),[password,setPassword]=useState(""),[success,setSuccess]=useState("");
  const kinds=Array.from(new Set([...data.requiredKinds,...data.documents.map(item=>item.kind)]));
  const submitted=data.requiredKinds.filter(kind=>data.documents.some(document=>document.kind===kind)).length;
  const verified=data.requiredKinds.filter(kind=>data.documents.some(document=>document.kind===kind&&document.reviewStatus==="verified")).length;
  const rows=requirementEvidence(data),evidenceComplete=rows.every(row=>row.complete);
  const complete=submitted===data.requiredKinds.length&&verified===data.requiredKinds.length&&evidenceComplete;
  const document=data.documents.find(item=>item.id===preview);
  const save=async(status:"verified"|"needs_replacement")=>{
    if(!document||pending.current||!canReview||!password)return;
    if(status==="needs_replacement"&&!reason.trim()){setError("Enter a replacement reason for the member.");return;}
    pending.current=true;setSaving(true);onBusy(true);setError("");
    try{
      await documentsRequest("",{method:"POST",body:JSON.stringify({operation:"review",documentId:document.id,versionId:document.versionId,expectedReviewId:document.reviewId,status,reason,password})});
      await onUpdated();setPreview(null);setReplacing(false);setReason("");setReviewConfirm(null);setPassword("");setSuccess(status==="verified"?"Document verified.":"Document replacement request recorded. Correction instructions are available to the member.");
    }catch(error){setError(error instanceof Error?error.message:"The document review could not be saved.");}
    finally{pending.current=false;setSaving(false);onBusy(false);}
  };
  const viewEvidence=async(kind:string)=>{
    if(pending.current)return;
    pending.current=true;setEvidenceKind(kind);setEvidence(null);setEvidenceLoading(true);setError("");onBusy(true);
    try{const result=await workflowRequest<{records:ConsentEvidenceRecord[]}>(new URLSearchParams({operation:"evidence",applicationId:data.applicationId,packetHash:data.packetHash}).toString());setEvidence(result.records.filter(item=>item.kind===kind));}
    catch(error){setError(error instanceof Error?error.message:"Evidence records could not be loaded.");}
    finally{pending.current=false;setEvidenceLoading(false);onBusy(false);}
  };
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-label font-semibold">Required documents</h3><Badge tone={complete?"success":"warning"}>{complete?"Submission complete":submitted<data.requiredKinds.length?"Requirements incomplete":"Review & evidence pending"}</Badge></div>
    <div className={styles.tableWrap}><table className={styles.table} aria-label="Required documents"><thead><tr><th>Requirement</th><th>Submission</th><th>Review</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>
      {kinds.map(kind=>{const item=data.documents.find(document=>document.kind===kind);return <tr key={kind}>
        <td>{documentKindLabels[kind]}{!data.requiredKinds.includes(kind)&&<span className="mt-1 block text-caption font-normal text-portal-secondary">Supporting document</span>}</td>
        <td><Badge tone={item?"success":"warning"}>{item?"Submitted":"Not submitted"}</Badge></td>
        <td>{item?<DocumentStatusBadge status={item.reviewStatus==="verified"?"verified":item.reviewStatus==="needs_replacement"?"needs_replacement":"to_review"} />:<span className="text-portal-secondary">—</span>}</td>
        <td><Button size="compact" variant="ghost" disabled={!item||busy} aria-label={"Preview "+documentKindLabels[kind]} onClick={()=>{setPreview(item?.id??null);setError("");setReplacing(false);setReviewConfirm(null);setPassword("");}}><ExternalLink className="h-3.5 w-3.5" />View</Button></td>
      </tr>;})}
    </tbody></table></div>
    <p className="text-caption text-portal-secondary">{submitted} of {data.requiredKinds.length} required documents submitted · {verified} verified</p>
    <section aria-label="Consent and witness evidence" className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-label font-semibold">Consent & witness evidence</h3><Badge tone={evidenceComplete?"success":"warning"}>{evidenceComplete?"Complete":"Incomplete"}</Badge></div>
      <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Evidence</th><th>Status</th><th>Verification requirement</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{rows.map(row=>{const rowRecords=records.filter(item=>item.kind===row.key);const confirmedBorrower=row.key==="borrower"&&rowRecords.some(item=>item.terms_accepted===true&&item.information_certified===true);const approved=row.key==="witness"?false:row.key==="borrower"?row.required===0||confirmedBorrower:row.required===0||rowRecords.some(item=>item.status==="approved");return <tr key={row.key}>
        <td>{row.label}{row.key!=="witness"&&<p className="mt-1 text-caption font-normal text-portal-secondary">{row.key==="borrower"?"Terms & Conditions agreement": "Co-maker’s approval of this loan request"}</p>}{rowRecords.map(item=><p key={item.id} className="mt-1 text-caption font-normal">{row.key==="witness"?item.subject_name??item.subject_reference:row.key==="borrower"&&item.terms_accepted===true&&item.information_certified===true?"Borrower confirmed the Terms & Conditions and certified the application information.":item.subject_name??item.subject_reference}{item.subject_name&&item.subject_reference!==item.subject_name&&<span className="ml-2 text-portal-secondary">{item.subject_reference}</span>}</p>)}</td><td><Badge tone={approved?"success":rowRecords.some(item=>item.status==="declined")?"danger":rowRecords.length?"neutral":"warning"}>{recordsLoading?"Loading…":recordsError?"Unavailable":row.required===0?"Not required":approved?(row.key==="borrower"?"Accepted":"Approved"):rowRecords.some(item=>item.status==="declined")?"Declined":rowRecords.some(item=>item.status==="expired")?"Expired":rowRecords.some(item=>item.status==="invalidated")?"Invalidated":rowRecords.some(item=>item.status==="pending")?"Pending Response":row.key==="witness"&&rowRecords.length?(row.required!==null&&rowRecords.length<row.required?"Incomplete":"Names Recorded"):rowRecords.length?"Recorded":"Not Recorded"}</Badge></td>
        <td className="text-portal-secondary">{row.required===null?"Policy requirement pending":row.required===0?"—":`${row.count} of ${row.required} recorded`}</td>
        <td><Button size="compact" variant="ghost" disabled={busy} onClick={()=>void viewEvidence(row.key)} aria-label={"View "+row.label.toLowerCase()}>View evidence</Button></td>
      </tr>;})}</tbody></table></div>
      {recordsError&&<p role="alert" className="text-support text-status-danger">{recordsError}</p>}
    </section>
    {!hideChecklist&&<fieldset disabled={!editable||busy} className={styles.checks} aria-label="Staff checklist">{(Object.keys(shortChecks) as (keyof VerificationChecks)[]).map(key=><label key={key}>
      <input type="checkbox" aria-label={verificationCheckLabels[key]} checked={checks[key]} onChange={event=>onCheck(key,event.target.checked)} />{shortChecks[key]}
    </label>)}</fieldset>}
    {preview&&document&&<ActionDialog title={documentKindLabels[document.kind]} subtitle={document.name} overlayClassName="z-[160]" className="max-w-3xl" busy={saving} onClose={()=>setPreview(null)} footer={<>
      <Button disabled={saving} onClick={()=>setPreview(null)}>Close</Button>
      {canReview&&<><Button disabled={saving} onClick={()=>setReplacing(true)}>Request Replacement</Button><Button variant="primary" disabled={saving||document.reviewStatus==="verified"} loading={saving} onClick={()=>{setReviewConfirm("verified");setPassword("");}}><CheckCircle2 className="h-4 w-4" />Verify Document</Button></>}
    </>}>
      <DocumentFilePreview key={document.id+":"+document.version} kind="member" id={document.id} versionId={document.versionId} />
      {replacing&&!reviewConfirm&&<label className="mt-3 block space-y-2 text-label">Reason shown to the member<Textarea value={reason} maxLength={2000} onChange={event=>setReason(event.target.value)} /><Button disabled={saving||!reason.trim()} onClick={()=>{setReviewConfirm("needs_replacement");setPassword("");}}>Continue</Button></label>}
      {reviewConfirm&&<div className="mt-4 space-y-3 rounded-lg border border-portal-border p-4"><p className="text-support">{reviewConfirm==="verified"?"Confirm that this document has been checked and meets the requirements.":`Request replacement of this document? Reason: ${reason.trim()}`}</p><label className="block space-y-2 text-label">Your account password<PasswordInput label="Your account password" value={password} onChange={event=>setPassword(event.target.value)} autoComplete="current-password" disabled={saving}/></label><Button variant="primary" disabled={saving||!password} onClick={()=>void save(reviewConfirm)}>{reviewConfirm==="verified"?"Confirm Verification":"Confirm Replacement"}</Button><Button disabled={saving} onClick={()=>{setReviewConfirm(null);setPassword("");}}>Back</Button></div>}
      {error&&<p role="alert" className="mt-3 text-support text-status-danger">{error}</p>}
    </ActionDialog>}
    {success&&<ActionResultDialog success message={success} overlayClassName="z-[170]" onClose={()=>setSuccess("")}/>}
    {evidenceKind&&<ActionDialog title={evidenceKind==="witness"?"Witness names":"Recorded consent evidence"} subtitle={rows.find(row=>row.key===evidenceKind)?.label} overlayClassName="z-[160]" busy={evidenceLoading} onClose={()=>setEvidenceKind(null)} footer={<Button onClick={()=>setEvidenceKind(null)} disabled={evidenceLoading}>Close</Button>}>
      {evidenceKind==="witness"?(evidenceLoading?<p role="status">Loading witness names…</p>:error?<p role="alert" className="text-status-danger">{error}</p>:evidence?.length?<ul className="list-disc space-y-1 pl-5 text-support">{evidence.map(item=><li key={item.id}>{item.subject_name??item.subject_reference}</li>)}</ul>:<p className="text-support text-portal-secondary">No witness names were recorded.</p>):<>
      {evidenceKind==="borrower"&&<section className="mb-4 space-y-3 text-support" aria-label="Borrower terms and conditions"><h3 className="font-semibold">Terms & Conditions</h3><p className="text-caption text-portal-secondary">{agreement?`Exact terms accepted by the borrower · ${agreement.terms_version}`:"Current terms shown in the member application. This template alone does not establish that the borrower accepted it; saved consent evidence is shown below."}</p><div className="max-h-64 space-y-3 overflow-y-auto rounded-lg border border-portal-border p-3">{displayedTerms.map(text=><p key={text}>{text}</p>)}</div></section>}
      {evidenceLoading?<p role="status">Loading evidence…</p>:error?<p role="alert" className="text-status-danger">{error}</p>:!evidence?.length?<p className="text-support text-portal-secondary">No saved evidence was found for this application. Application submission alone does not establish borrower consent or record witness names.</p>:<div className="space-y-3">{evidence.map(item=><dl key={item.id} className="grid gap-3 rounded-lg border border-portal-border p-4 text-support sm:grid-cols-2">
        <div><dt className="text-caption text-portal-secondary">Subject / witness</dt><dd className="break-all">{item.subject_name??item.subject_reference}</dd></div><div><dt className="text-caption text-portal-secondary">Method</dt><dd>{item.source==="borrower_witness_names"?"Borrower-declared with OTP-confirmed submission":item.method==="borrower_declaration"?"Named by borrower":item.method==="member_approval"?"OTP-verified member approval":item.method==="otp"?"OTP confirmation":item.method==="paper"?"Recorded paper evidence":item.method}</dd></div>
        <div><dt className="text-caption text-portal-secondary">Recorded · Philippine time</dt><dd>{documentDate(item.occurred_at,true)}</dd></div><div><dt className="text-caption text-portal-secondary">Evidence reference</dt><dd className="break-all">{item.evidence_reference}</dd></div>
        {item.kind==="borrower"&&<div className="sm:col-span-2"><dt className="text-caption text-portal-secondary">Terms & Conditions consent</dt><dd>Borrower consent recorded using the evidence reference above.</dd></div>}
        {item.terms_accepted!=null&&<div className="space-y-2 sm:col-span-2"><p className="font-medium">Saved borrower confirmations</p><label className="flex items-start gap-2"><input type="checkbox" checked={item.terms_accepted} disabled readOnly />I have read, understood, and agree to the Terms and Conditions.</label><label className="flex items-start gap-2"><input type="checkbox" checked={item.information_certified===true} disabled readOnly />I certify that all information provided in this loan application is true and correct.</label></div>}
        {item.decision_reason&&<div className="sm:col-span-2"><dt className="text-caption text-portal-secondary">Recorded response reason</dt><dd className="whitespace-pre-wrap">{item.decision_reason}</dd></div>}
        {(item.status==="named"||item.source==="borrower_witness_names")&&<p className="text-caption text-portal-secondary sm:col-span-2">This witness name was recorded from the borrower&apos;s OTP-confirmed submission.</p>}
        {item.source==="co_maker_request"&&<><div><dt className="text-caption text-portal-secondary">Approval</dt><dd>Approved by {item.subject_name} for {item.borrower_name}</dd></div><div><dt className="text-caption text-portal-secondary">Relationship</dt><dd>{item.relationship||"Not recorded"}</dd></div><div><dt className="text-caption text-portal-secondary">Approved loan</dt><dd>{item.loan_type} · {Number(item.amount).toLocaleString("en-PH",{style:"currency",currency:"PHP"})} · {item.tenure_months} months</dd></div></>}
      </dl>)}</div>}
      </>}
    </ActionDialog>}
  </div>;
}
