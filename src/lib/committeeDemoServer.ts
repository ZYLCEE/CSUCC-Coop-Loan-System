import "server-only";
import {createHash,createHmac,scryptSync,timingSafeEqual} from "node:crypto";
import type {CommitteeDemoAccount} from "./committeeDemo";
type ConfiguredAccount=CommitteeDemoAccount&{passwordHash:string};
export const committeeDemoCookie="csucc_committee_demo";
const positions:Record<string,{role:string;seat:string}>={"crecom-1":{role:"crecom_member",seat:"member"},"crecom-2":{role:"crecom_member",seat:"member"},"crecom-chair":{role:"crecom_member",seat:"chairperson"},"bod-chair":{role:"bod_member",seat:"chairperson"}};
export function configuredDemoAccounts():ConfiguredAccount[]{
 const encoded=process.env.COOP_COMMITTEE_DEMO_ACCOUNTS;
 if(!encoded)return [];
 try{
  const rows=JSON.parse(Buffer.from(encoded,"base64").toString("utf8")) as ConfiguredAccount[];
  if(!Array.isArray(rows)||rows.length!==4||new Set(rows.map(row=>row.id)).size!==4||new Set(rows.map(row=>row.email.toLowerCase())).size!==4||rows.some(row=>!positions[row.id]||row.role!==positions[row.id].role||row.seat!==positions[row.id].seat||typeof row.name!=="string"||!row.name.trim()||row.name.length>160||!/^\S+@\S+\.\S+$/.test(row.email)||!/^scrypt-v1:[0-9a-f]{32}:[0-9a-f]{128}$/.test(row.passwordHash)))throw new Error();
  return rows;
 }catch{throw new Error("Committee demonstration configuration is unavailable. Contact the system administrator.");}
}
export function publicDemoAccount({id,name,email,role,seat}:ConfiguredAccount):CommitteeDemoAccount{return {id,name,email,role,seat};}
export function verifyDemoPassword(account:ConfiguredAccount,password:unknown){
 if(typeof password!=="string"||!password||password.length>1024)return false;
 const [,salt,expected]=account.passwordHash.split(":");
 return timingSafeEqual(scryptSync(password,Buffer.from(salt,"hex"),64),Buffer.from(expected,"hex"));
}
function sessionSecret(){const value=process.env.COOP_COMMITTEE_DEMO_SESSION_SECRET;if(!value||value.length<40)throw new Error("Committee demonstration sessions are not configured.");return value;}
const revision=(account:ConfiguredAccount)=>createHash("sha256").update(account.passwordHash+":"+account.email).digest("hex");
export function createDemoSession(account:ConfiguredAccount,now=Date.now()){
 const payload=Buffer.from(JSON.stringify({id:account.id,exp:Math.floor(now/1000)+8*60*60,revision:revision(account)})).toString("base64url");
 return payload+"."+createHmac("sha256",sessionSecret()).update(payload).digest("base64url");
}
export function readDemoSession(request:Request,now=Date.now()){
 const token=request.headers.get("cookie")?.split(";").map(value=>value.trim()).find(value=>value.startsWith(committeeDemoCookie+"="))?.slice(committeeDemoCookie.length+1);
 if(!token)return {account:null,expired:false};
 try{
  if(token.length>1000)throw new Error();
  const [payload,signature,...extra]=token.split("."),expected=createHmac("sha256",sessionSecret()).update(payload).digest(),provided=Buffer.from(signature??"","base64url");
  if(extra.length||provided.length!==expected.length||!timingSafeEqual(provided,expected))throw new Error();
  const data=JSON.parse(Buffer.from(payload,"base64url").toString("utf8")) as {id:string;exp:number;revision:string};
  const account=configuredDemoAccounts().find(row=>row.id===data.id);
  if(!account||!Number.isSafeInteger(data.exp)||data.exp<=now/1000||data.exp>now/1000+8*60*60+60||data.revision!==revision(account))throw new Error();
  return {account,expired:false};
 }catch{return {account:null,expired:true};}
}
export function demoCookieHeader(request:Request,token:string|null){return committeeDemoCookie+"="+(token??"")+"; Path=/; HttpOnly; SameSite=Strict; Max-Age="+(token?8*60*60:0)+(new URL(request.url).protocol==="https:"?"; Secure":"");}
const attempts=new Map<string,{count:number;until:number}>();
export function checkDemoAttempts(email:string,failed=false){
 const key=createHash("sha256").update(email.toLowerCase()).digest("hex"),now=Date.now();
 if(attempts.size>1000)for(const [id,row]of attempts)if(row.until<=now)attempts.delete(id);
 const current=attempts.get(key);
 if(current&&current.until>now&&current.count>=8)return false;
 if(failed)attempts.set(key,{count:(current&&current.until>now?current.count:0)+1,until:current&&current.until>now?current.until:now+15*60*1000});
 return true;
}
