import type {ReactNode} from "react";
import {StatusBadge} from "@/components/ui/StatusBadge";
import MembershipTypeBadge from "@/components/shared/MembershipTypeBadge";
import {getLoanTypeLabel} from "@/lib/loanTypeLabel";
import type {MembershipType} from "@/lib/membership";

export function ApplicationTableHead(){
 return <thead><tr>{["Application ID","Member","Loan Type","Membership Type","Amount","Status","Date Applied","Actions"].map(label=><th key={label} scope="col" className={label==="Amount"?"text-right":label==="Actions"?"text-center":""}>{label}</th>)}</tr></thead>;
}
export default function ApplicationTableRow({record,children}:{record:{id:string;member:string;memberId:string;type:string;membershipType?:MembershipType;amount:ReactNode;date:string;status:string;workflowLabel?:string};children:ReactNode}){
 const parsed=Date.parse(record.date),date=Number.isNaN(parsed)?record.date:new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:/^\d{4}-\d{2}-\d{2}$/.test(record.date)?"UTC":"Asia/Manila"}).format(new Date(parsed));
 return <tr><td className="whitespace-normal text-body font-semibold text-coop-dashboard-green [overflow-wrap:anywhere]">{record.id}</td><td><p className="whitespace-normal text-body font-semibold text-portal-primary [overflow-wrap:anywhere]">{record.member.trim()||"Member name not recorded"}</p><p className="mt-0.5 text-caption font-medium text-portal-secondary">{record.memberId||"Member ID not recorded"}</p></td><td className="whitespace-normal text-body text-portal-primary [overflow-wrap:anywhere]">{getLoanTypeLabel(record.type)}</td><td><MembershipTypeBadge membershipType={record.membershipType}/></td><td className="whitespace-nowrap text-right text-body font-semibold text-portal-primary tabular-nums">{record.amount}</td><td><StatusBadge status={record.status}/>{record.workflowLabel&&<p className="mt-1 text-caption text-portal-secondary">{record.workflowLabel}</p>}</td><td className="text-body text-portal-primary">{date}</td><td><div className="flex justify-center">{children}</div></td></tr>;
}
