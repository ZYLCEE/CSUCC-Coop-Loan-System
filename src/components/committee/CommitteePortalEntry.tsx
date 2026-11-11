"use client";
import {useCallback,useEffect,useMemo,useState,type ReactNode} from "react";
import type {User} from "@supabase/supabase-js";
import {useRouter} from "next/navigation";
import CommitteeAuthProvider,{CommitteeSessionProvider} from "./CommitteeAuthProvider";
import {CommitteeServicesProvider,type CommitteeServices} from "./CommitteeServices";
import {committeeDemoAction,committeeDemoSession,type CommitteeDemoAccount} from "@/lib/committeeDemo";
import {getPortalPrefix,type CommitteeRole,type PortalAccess} from "@/lib/committee";
import {createPrototypeServices,createPrototypeStore,parsePrototypeStore,prototypeAccount,prototypeCases,prototypeStoreKey,sampleFlow,type PrototypeStore} from "@/lib/committeePrototype";
import {useLoginTransition} from "@/components/auth/LoginTransitionProvider";
import {Button} from "@/components/ui/Button";
import {ActionDialog} from "@/components/ui/ActionDialog";

export default function CommitteePortalEntry({role,children}:{role:CommitteeRole;children:ReactNode}){
 const router=useRouter(),[status,setStatus]=useState<{loaded:boolean;account:CommitteeDemoAccount|null;error:string}>({loaded:false,account:null,error:""});
 useEffect(()=>{let active=true;void committeeDemoSession().then(result=>{
  if(!active)return;
  if(result.expired){router.replace("/login");return;}
  if(result.account&&result.account.role!==role){router.replace(getPortalPrefix(result.account.role)+"/dashboard");return;}
  setStatus({loaded:true,account:result.account,error:""});
 }).catch(()=>{if(active)setStatus({loaded:true,account:null,error:"Committee sign-in could not be checked. Reload this page to retry."});});return()=>{active=false;};},[role,router]);
 if(!status.loaded)return <p role="status" className="p-8 text-support">Checking committee sign-in…</p>;
 if(status.error)return <p role="alert" className="p-8 text-support text-status-danger">{status.error}</p>;
 return status.account?<DemonstrationSession initial={status.account}>{children}</DemonstrationSession>:<CommitteeAuthProvider role={role}>{children}</CommitteeAuthProvider>;
}
function DemonstrationSession({initial,children}:{initial:CommitteeDemoAccount;children:ReactNode}){
 const account=prototypeAccount(initial.id)!;
 const router=useRouter(),{finish}=useLoginTransition(),[store,setStore]=useState<PrototypeStore>(createPrototypeStore),[loaded,setLoaded]=useState(false),[error,setError]=useState(""),[reset,setReset]=useState(false),[generation,setGeneration]=useState(0);
 const refresh=useCallback(async()=>{
  const current=await committeeDemoSession();
  if(!current.account||current.account.id!==initial.id){router.replace("/login");return;}
  const saved=parsePrototypeStore(window.localStorage.getItem(prototypeStoreKey));
  if(!saved.profiles[initial.id]){saved.profiles[initial.id]={name:initial.name,phone:""};window.localStorage.setItem(prototypeStoreKey,JSON.stringify(saved));}
  setStore(saved);setLoaded(true);setError("");finish();
 },[initial.id,initial.name,router,finish]);
 useEffect(()=>{
  let active=true;const update=()=>{if(active&&document.visibilityState!=="hidden")void refresh().catch(()=>{if(active){setError("Demonstration session could not be refreshed. Sign in again if needed.");finish();}});};
  update();const timer=window.setInterval(update,30000);window.addEventListener("focus",update);
  return()=>{active=false;window.clearInterval(timer);window.removeEventListener("focus",update);};
 },[refresh,finish]);
 const services=useMemo<CommitteeServices>(()=>{
  const local=createPrototypeServices(account,{getItem:key=>window.localStorage.getItem(key),setItem:(key,value)=>{window.localStorage.setItem(key,value);setStore(parsePrototypeStore(value));}},()=>initial.id);
  return {...local,async reviewRequest<T>(query="",init:RequestInit={}):Promise<T>{
   const review=JSON.parse(String(init.body)) as Record<string,unknown>;
   const checked=await committeeDemoAction({operation:"confirm",review});
   if(!checked.verified||checked.account?.id!==initial.id)throw new Error("Sign in using your assigned committee account before confirming.");
   // The public fixture password is only an internal adapter input, never a real credential.
   return local.reviewRequest<T>(query,{...init,body:JSON.stringify({...review,password:account.password})});
  }};
 },[account,initial.id]);
 const signOut=async()=>{await committeeDemoAction({operation:"logout"});router.replace("/login");};
 if(!loaded)return <p role={error?"alert":"status"} className="p-8 text-support">{error||"Opening committee demonstration…"}</p>;
 const name=store.profiles[initial.id]?.name??initial.name;
 const user:User={id:"committee-demo:"+initial.id,email:initial.email,aud:"committee-demo",app_metadata:{role:"committee_demo"},user_metadata:{full_name:name,phone:store.profiles[initial.id]?.phone??""},created_at:"2026-11-11T00:00:00Z"};
 const access:PortalAccess={allowed:true,role:initial.role,setupRequired:false,reason:null,membershipId:"demo:"+initial.id,name,email:initial.email,committeeSeat:initial.seat};
 const resetSamples=()=>{try{const saved=createPrototypeStore();saved.profiles[initial.id]={name:initial.name,phone:""};window.localStorage.setItem(prototypeStoreKey,JSON.stringify(saved));setStore(saved);setGeneration(value=>value+1);setReset(false);}catch{setError("Browser sample data could not be reset.");}};
 const banner=<section aria-label="Committee demonstration" className="mb-5 rounded-xl border border-portal-border bg-surface-card p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-support font-semibold text-coop-dashboard-green">Committee demonstration</p><p className="mt-1 text-caption text-portal-secondary">Signed in as {initial.email}. Review sample applications using your account password. Sample decisions stay in this browser.</p></div><div className="flex flex-wrap gap-2"><Button size="compact" onClick={()=>void signOut().catch(()=>setError("Sign out could not be completed. Retry."))}>Switch account</Button><Button size="compact" onClick={()=>setReset(true)}>Reset sample data</Button></div></div><details className="mt-3 border-t border-portal-border pt-3 text-caption"><summary className="cursor-pointer font-medium">Sample approval flow</summary><ul className="mt-2 space-y-1 text-portal-secondary">{prototypeCases.map(loan=><li key={loan.id}>{loan.applicationId}: {sampleFlow(store,loan.id)}</li>)}</ul><p className="mt-2 text-portal-secondary">The BOD view includes a preview of CRECOM confirmations. Actual cooperative officer accounts and live loan decisions are configured separately.</p></details>{error&&<p role="alert" className="mt-2 text-caption text-status-danger">{error}</p>}</section>;
 return <CommitteeSessionProvider value={{user,access,role:initial.role,refresh,signOut,prototype:true,banner}}><CommitteeServicesProvider value={services}><div key={generation}>{children}</div>{reset&&<ActionDialog title="Reset sample applications" onClose={()=>setReset(false)} footer={<><Button onClick={()=>setReset(false)}>Cancel</Button><Button variant="primary" onClick={resetSamples}>Reset samples</Button></>}><p className="text-support">Reset the sample decisions, notifications and profile changes for this browser? Your configured sign-in accounts stay available.</p></ActionDialog>}</CommitteeServicesProvider></CommitteeSessionProvider>;
}
