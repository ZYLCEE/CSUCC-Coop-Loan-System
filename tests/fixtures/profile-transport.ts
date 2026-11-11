import type {ProfileResponse} from "../../src/lib/profileModel";
type FixtureWindow=Window&{testRole?:string;profileRequests?:{method:string;body:Record<string,string>|null}[];profileData?:ProfileResponse};
const state=window as FixtureWindow;
export async function profileRequest(init:RequestInit={}){
 state.profileData??={profile:{first_name:"Synthetic Anna",last_name:"Navarro",phone:"09123456789",department:"Finance",position:"Cooperative Officer"},
 account:{id:"synthetic-profile",email:"synthetic@example.invalid",pendingEmail:null,role:state.testRole==="admin"?"Administrator":"Super Administrator",status:"Active",createdAt:"2026-01-01T00:00:00Z",lastSignInAt:"2026-11-11T00:00:00Z",emailConfirmed:true},memberLinked:true};
 const method=init.method??"GET",body=init.body?JSON.parse(String(init.body)):null;
 (state.profileRequests??=[]).push({method,body});await new Promise(resolve=>setTimeout(resolve,150));
 if(method==="PUT"){state.profileData.profile={...body};return {profile:{...body},warning:null};}
 if(method==="PATCH"){
  if(body.current!=="Synthetic-Current1!")throw new Error("Current password is incorrect.");
  state.profileData.account.pendingEmail=body.email;
  return {email:state.profileData.account.email,pendingEmail:body.email,confirmationRequired:true,warning:null};
 }
 return method==="POST"?{success:true,warning:null}:structuredClone(state.profileData);
}
