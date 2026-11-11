import {isIP} from "node:net";
export function portalSessionId(token:string):string|null{
  try{const value=JSON.parse(Buffer.from(token.split(".")[1]??"","base64url").toString("utf8")).session_id;return typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)?value:null;}catch{return null;}
}
// Callers still verify the bearer with Supabase Auth before any protected write.
export function portalActivityHeaders(request:Request):Record<string,string>{const id=portalSessionId(request.headers.get("authorization")?.replace(/^Bearer /,"")??"");return id?{"x-coop-session-id":id}:{};}
export function portalDevice(request:Request){
  const ua=request.headers.get("user-agent")??"";
  const browser=/Edg\//.test(ua)?"Edge":/OPR\//.test(ua)?"Opera":/Firefox\//.test(ua)?"Firefox":/Chrome\//.test(ua)?"Chrome":/Safari\//.test(ua)?"Safari":null;
  const os=/Android/.test(ua)?"Android":/iPhone|iPad/.test(ua)?"iOS":/Windows/.test(ua)?"Windows":/Macintosh|Mac OS/.test(ua)?"macOS":/Linux/.test(ua)?"Linux":null;
  const host=new URL(request.url).hostname;
  const forwarded=process.env.VERCEL||process.env.COOP_TRUST_PROXY_HEADERS==="true"?(request.headers.get("x-forwarded-for")??request.headers.get("x-real-ip"))?.split(",")[0].trim():null;
  const ip=forwarded&&isIP(forwarded)?forwarded:["localhost","127.0.0.1","[::1]"].includes(host)?"127.0.0.1":null;
  return {browser,os,ip};
}
