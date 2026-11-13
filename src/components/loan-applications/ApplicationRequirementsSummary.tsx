"use client";
import {useEffect,useState} from "react";
import {workflowRequest} from "@/lib/applicationWorkflowRequest";
import {workflowStagePresentation,type ApplicationVerification} from "@/lib/applicationWorkflow";
import {Button} from "@/components/ui/Button";
import ProcessingRequirements from "./ProcessingRequirements";
export default function ApplicationRequirementsSummary({applicationId,refreshVersion=0}:{applicationId:string;refreshVersion?:number}){
 const [data,setData]=useState<ApplicationVerification|null>(null),[error,setError]=useState(""),[attempt,setAttempt]=useState(0);
 useEffect(()=>{let active=true;void workflowRequest<ApplicationVerification>(new URLSearchParams({applicationId}).toString()).then(value=>{if(active){setData(value);setError("");}}).catch(error=>{if(active)setError(error instanceof Error?error.message:"Requirements could not be loaded.");});return()=>{active=false;};},[applicationId,attempt,refreshVersion]);
 const stage= data?workflowStagePresentation(data.stage,data.stale):null;
 return <section aria-label="Documents, consent and witnesses" className="py-4"><h3 className="mb-3 text-sm font-semibold text-coop-primary">Documents, Consent & Witnesses</h3>{error?<div role="alert"><p className="text-support text-status-danger">{error}</p><Button onClick={()=>setAttempt(value=>value+1)}>Retry requirements</Button></div>:!data?<p role="status" className="text-support">Loading recorded requirements…</p>:<><div className="mb-4 space-y-1" aria-label="Current processing stage"><p className="text-caption font-medium text-portal-secondary">Current Processing Stage</p><p className="text-support font-semibold">{stage?.label??"Processing stage unavailable"}</p>{stage?.staleNotice&&<p role="status" className="text-caption text-status-warning">{stage.staleNotice}</p>}</div><ProcessingRequirements data={data} checks={data.checks} editable={false} canReview={false} dirty={false} busy={false} hideChecklist onCheck={()=>{}} onBusy={()=>{}} onUpdated={async()=>{}}/></>}</section>;
}
