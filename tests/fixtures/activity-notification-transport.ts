// Isolated browser fixtures. No live service is called.
const state=window as unknown as Record<string,any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export const adminNotificationReceivedEvent="coop-admin-notification-received";
export const notificationCategoryOptions=[{value:"all",label:"All categories"},{value:"accounts",label:"Accounts"},{value:"loans",label:"Loan Applications"},{value:"approvals",label:"Committee & Approvals"},{value:"documents",label:"Documents"},{value:"payments",label:"Payments"},{value:"announcements",label:"Announcements"},{value:"system",label:"System"},{value:"other",label:"Other"}];
export const recentNotificationQuery={filter:"all",category:"all",search:""},notificationPageSize=20;
function initialize(){
 state.activityRows??=Array.from({length:23},(_,n)=>({id:"notice-"+n,title:n%3===0?"Pending member account":n%3===1?"New loan application":"CRECOM approval recorded",message:"Sample Member "+n+" · Application SAMPLE-"+n,category:["accounts","loans","approvals"][n%3],type:"info",read:false,createdAt:new Date(Date.parse("2026-11-11T00:00:00Z")+n*60000).toISOString(),actorName:"Synthetic Reviewer",actorRole:"crecom_member",entityType:n%3===0?"member":"application",entityKey:"SAMPLE-"+n}));
 state.activityListeners??=[];state.activityCalls??=[];
}
export async function fetchAdminNotifications(userId:string,filter:string,offset=0,limit=20,options:{category?:string;search?:string;sort?:string}={}){
 initialize();state.activityCalls.push({userId,filter,offset,limit,options});await new Promise(resolve=>setTimeout(resolve,40));
 const rows=state.activityRows.filter((row:{read:boolean;category:string;title:string;message:string})=>(filter==="all"||(filter==="read")===row.read)&&(!options.category||options.category==="all"||row.category===options.category)&&(!options.search||(row.title+" "+row.message).toLowerCase().includes(options.search.toLowerCase()))).sort((a:{createdAt:string},b:{createdAt:string})=>(options.sort==="Oldest"?1:-1)*(Date.parse(a.createdAt)-Date.parse(b.createdAt)));
 return {items:structuredClone(rows.slice(offset,offset+limit)),total:rows.length};
}
export async function fetchUnreadNotificationCount(){initialize();return state.activityRows.filter((row:{read:boolean})=>!row.read).length;}
export async function markAdminNotificationRead(_userId:string,id:string){initialize();state.activityRows.find((row:{id:string})=>row.id===id).read=true;}
export async function markAllAdminNotificationsRead(){initialize();for(const row of state.activityRows)row.read=true;}
export function notificationHref(_type:string,prefix:string,context?:{entityType?:string}){return prefix+(context?.entityType==="member"?"/all-accounts":"/loan-applications");}
export function watchAdminNotifications(_userId:string,onChange:()=>void){initialize();state.activityListeners.push(onChange);return()=>{state.activityListeners=state.activityListeners.filter((listener:unknown)=>listener!==onChange);};}
