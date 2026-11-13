import {Check,TriangleAlert,X} from "lucide-react";
import {committeeProgress,processingSteps,processingStepState,type ProcessingStep} from "@/lib/applicationProcessing";
import type {ApplicationVerification} from "@/lib/applicationWorkflow";
import type {AdminReviewState} from "@/lib/committeeReview";
import styles from "./processing.module.css";

export default function ProcessingStepper({application,review,currentStep,selectedStep,onSelect,disabled=false,released=false}:{
  application?:ApplicationVerification;review?:AdminReviewState|null;currentStep:ProcessingStep;selectedStep?:ProcessingStep;
  onSelect?:(step:ProcessingStep)=>void;disabled?:boolean;released?:boolean;
}) {
  return <nav aria-label="Application processing steps" className={styles.stepper}><ol>
    {processingSteps.map(item=>{
      const state=application?processingStepState(item.number,application,review??null):item.number<currentStep||released?"complete":"pending";
      const active=item.number===currentStep&&state!=="complete",selected=item.number===(selectedStep??currentStep);
      const progress=review&&(item.number===2||item.number===3)?committeeProgress(review,item.number===2?"CRECOM":"BOD"):null;
      const finalRejected=review?.finalDecision?.decision==="reject"||application?.loanStatus?.toLowerCase()==="rejected";
      const notReached=(finalRejected&&(item.number===5||((item.number===2||item.number===3)&&!progress?.cycle)))||(!!review&&item.number===3&&!progress?.cycle&&committeeProgress(review,"CRECOM").rejected);
      const label=notReached?"Not Reached":state==="rejected"?"Rejected":state==="attention"?"Needs attention":state==="complete"?"Completed":progress?.cycle?`${progress.approvedCount} of ${progress.required} approved`:active&&progress?"Awaiting assignment":active?"Current step":item.number<currentStep?"Not recorded":"Upcoming";
      return <li key={item.number} data-complete={state==="complete"}>
        <button type="button" aria-label={`Step ${item.number}: ${item.label}`} aria-current={active?"step":undefined} aria-pressed={selected}
          disabled={disabled||!onSelect} onClick={()=>onSelect?.(item.number)} data-active={active} data-selected={selected} data-state={state}>
          <span className={styles.circle}>{state==="complete"?<Check aria-hidden="true" />:state==="rejected"?<X aria-hidden="true" />:state==="attention"?<TriangleAlert aria-hidden="true" />:item.number}</span>
          <span className={styles.stepLabel}>{item.label}</span><span className={styles.stepStatus}>{label}</span>
        </button>
      </li>;
    })}
  </ol></nav>;
}
