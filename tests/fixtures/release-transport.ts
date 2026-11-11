type ReleaseTestWindow=Window & {financialFailure?:boolean;releaseCalls?:Record<string,unknown>[]};
export async function reviewRequest(_query="",init:RequestInit={},endpoint?:string){
  void _query;
  if(endpoint!=="/api/admin/loan-release")throw new Error("Unexpected isolated review endpoint");
  const state=window as ReleaseTestWindow,body=JSON.parse(String(init.body));
  if(!body.password)throw new Error("Enter your account password.");
  const {password,...details}=body;void password;
  (state.releaseCalls??=[]).push(details);
  await new Promise(resolve=>setTimeout(resolve,100));
  if(state.financialFailure)throw new Error("Backend rejected transaction");
  return {id:"synthetic-release",application_id:body.applicationId,status:"released",date_released:body.date,release_reference:body.reference,amount:body.amount,interest_rate_at_release:2,processing_fee_amount_at_release:10,service_fee_amount_at_release:5,net_proceeds:985};
}
