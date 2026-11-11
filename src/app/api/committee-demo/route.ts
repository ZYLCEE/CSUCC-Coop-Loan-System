import {configuredDemoAccounts,publicDemoAccount,readDemoSession,createDemoSession,verifyDemoPassword,demoCookieHeader,checkDemoAttempts} from "@/lib/committeeDemoServer";
import {validateReviewMutation} from "@/lib/committeeReview";
export const runtime="nodejs";
function reply(body:unknown,status=200,cookie?:string){return Response.json(body,{status,headers:{"Cache-Control":"no-store","Vary":"Cookie",...(cookie?{"Set-Cookie":cookie}:{})}});}
export async function GET(request:Request){
 try{const {account,expired}=readDemoSession(request);return reply({account:account?publicDemoAccount(account):null,expired});}
 catch{return reply({error:"Committee demonstration sign-in is unavailable."},503);}
}
export async function POST(request:Request){
 try{
  const url=new URL(request.url);
  // Next.js normalizes loopback URLs to localhost; Host preserves the browser's actual origin.
  const requestOrigin=new URL(url.protocol+"//"+(request.headers.get("host")??url.host)).origin;
  if(request.headers.get("origin")!==requestOrigin||!request.headers.get("content-type")?.startsWith("application/json"))return reply({error:"Use the system's sign-in page to continue."},403);
  const text=await request.text();if(text.length>12000)return reply({error:"The sign-in request is too large."},400);
  const body=JSON.parse(text) as Record<string,unknown>;
  if(body.operation==="logout")return reply({account:null},200,demoCookieHeader(request,null));
  if(body.operation==="login"){
   const email=typeof body.email==="string"?body.email.trim().toLowerCase():"";
   if(!email||email.length>254||typeof body.password!=="string"||body.password.length>1024)return reply({error:"Enter a valid email address and password."},400);
   const account=configuredDemoAccounts().find(row=>row.email.toLowerCase()===email);
   if(!account)return reply({account:null},200,demoCookieHeader(request,null));
   if(!checkDemoAttempts(email))return reply({error:"Too many attempts. Wait before trying this account again."},429);
   if(!verifyDemoPassword(account,body.password)){checkDemoAttempts(email,true);return reply({error:"The email address or password is incorrect."},401);}
   return reply({account:publicDemoAccount(account)},200,demoCookieHeader(request,createDemoSession(account)));
  }
  if(body.operation==="confirm"){
   const {account}=readDemoSession(request);if(!account)return reply({error:"Your committee demonstration session expired. Sign in again."},401);
   const review=validateReviewMutation(body.review),raw=body.review as Record<string,unknown>;
   if(!["approve","reject","clarify","recuse"].includes(review.operation))return reply({error:"Only individual sample review actions are available."},403);
   if(!checkDemoAttempts(account.email))return reply({error:"Too many attempts. Wait before trying again."},429);
   if(!verifyDemoPassword(account,raw.password)){checkDemoAttempts(account.email,true);return reply({error:"Your account password could not be verified."},401);}
   return reply({verified:true,account:publicDemoAccount(account)});
  }
  return reply({error:"Unsupported demonstration account action."},400);
 }catch{return reply({error:"The committee demonstration request could not be completed. Check its details and retry."},400);}
}
