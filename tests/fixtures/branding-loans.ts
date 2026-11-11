export async function fetchLoanApplications(){
  return Array.from({length:18},(_,index)=>({
    id:"APP-SYNTHETIC-"+String(18-index).padStart(3,"0"),memberId:"CSUCC-TEST-"+index,member:"Synthetic Member "+(index+1),type:index%2?"Emergency":"Business",amount:"₱10,000.00",status:"Pending",date:"Nov 10, 2026",membershipType:"regular",
  }));
}
