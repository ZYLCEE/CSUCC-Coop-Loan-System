export const loanTypes=["Regular Loan","Emergency Loan","Multi-Purpose Loan","Quick Loan","Educational Loan","Medical Loan","Livelihood Loan","Appliance Loan","Birthday Loan","Anniversary Loan","Fiesta Loan","Bonus Loan"] as const;
const key=(value:string)=>value.trim().toLowerCase().replace(/[-\s]+/g," ").replace(/ loans?$/,"");
export function loanTypeLabel(value:string):string{
 const normalized=key(value);
 const match=loanTypes.find(type=>key(type)===normalized||(normalized==="education"&&type==="Educational Loan"));
 if(match)return match;
 const label=value.trim();return !label?"Not recorded":label==="Not recorded"||/\bloans?$/i.test(label)?label:`${label} Loan`;
}
export function loanTypeOptions(existing:string[]=[]):string[]{return [...loanTypes,...Array.from(new Set(existing.map(loanTypeLabel))).filter(type=>!loanTypes.some(known=>known===type)&&type!=="Not recorded").sort()];}
