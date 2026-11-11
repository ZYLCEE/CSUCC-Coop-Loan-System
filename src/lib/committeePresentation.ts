export const committeeDate=(value:string|null)=>value?new Date(value).toLocaleString("en-PH",{timeZone:"Asia/Manila",month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"}):"Not set";
export const committeeMoney=(value:number)=>new Intl.NumberFormat("en-PH",{style:"currency",currency:"PHP"}).format(value);
