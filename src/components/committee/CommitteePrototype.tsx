"use client";
import PasswordInput from "@/components/ui/PasswordInput";
import {useCallback,useEffect,useMemo,useState,type FormEvent} from "react";
import type {User} from "@supabase/supabase-js";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {CommitteeSessionProvider} from "./CommitteeAuthProvider";
import {CommitteeServicesProvider} from "./CommitteeServices";
import {CommitteePortalShell} from "./CommitteePortalLayout";
import CommitteeWorkspace from "./CommitteeWorkspace";
import CommitteePacket from "./CommitteePacket";
import {SidebarProvider} from "@/contexts/SidebarContext";
import {prototypeAccounts,prototypeAccount,prototypeBase,prototypeCases,prototypePrefix,prototypeSessionKey,prototypeStoreKey,prototypeSignIn,prototypeUserId,parsePrototypeStore,createPrototypeStore,createPrototypeServices,sampleFlow,type PrototypeAccount,type PrototypeStore} from "@/lib/committeePrototype";
import {committeePositionLabel,type PortalAccess} from "@/lib/committee";
import {Button} from "@/components/ui/Button";
import {Input} from "@/components/ui/Fields";
import {Card} from "@/components/ui/Card";
import {ActionDialog} from "@/components/ui/ActionDialog";
import {CommitteeField} from "./CommitteeFields";

export default function CommitteePrototype({path}:{path:string[]}){
 const account=prototypeAccount(path[0]);
 return account?<PrototypePortal key={account.id} account={account} section={path[1]??"dashboard"} assignmentId={path[2]} />:<PrototypeSignIn />;
}
function PrototypeSignIn(){
 const router=useRouter(),[email,setEmail]=useState(""),[password,setPassword]=useState(""),[error,setError]=useState("");
 const submit=(event:FormEvent)=>{
  event.preventDefault();setError("");
  try{const account=prototypeSignIn(email,password);window.sessionStorage.setItem(prototypeSessionKey,account.id);router.push(prototypePrefix(account.id)+"/dashboard");}
  catch(error){setError(error instanceof Error?error.message:"Prototype sign-in is unavailable.");}
 };
 return <main className="min-h-screen bg-portal-bg px-4 py-8 sm:px-8">
  <div className="mx-auto max-w-6xl space-y-6">
   <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="mb-2 text-caption font-bold uppercase tracking-wide text-coop-dashboard-green">CSUCC MPC · Prototype</p><h1 className="text-section-title font-bold">Explore the committee portals</h1><p className="mt-2 max-w-3xl text-support text-portal-secondary">Four separate sample accounts let you explore the CRECOM and BOD screens. Everything here uses fictional applications and saves only in this browser.</p></div><Link href="/login" className="ui-button ui-button--outline">Real account sign-in</Link></div>
   <div className="grid items-start gap-6 lg:grid-cols-[1.5fr_1fr]">
    <section aria-label="Prototype accounts" className="grid gap-3 sm:grid-cols-2">
     {prototypeAccounts.map(account=><Card key={account.id}><p className="mb-1 text-caption text-portal-secondary">Sample identity</p><h2 className="text-support font-semibold">{account.name}</h2><p className="mt-1 text-caption text-portal-secondary">{committeePositionLabel(account.role,account.seat)} portal</p><dl className="my-4 space-y-2 text-caption"><div><dt className="text-portal-secondary">Prototype email</dt><dd className="mt-0.5 break-all font-medium">{account.email}</dd></div><div><dt className="text-portal-secondary">Sample password</dt><dd className="mt-0.5 break-all font-mono">{account.password}</dd></div></dl><Button size="compact" onClick={()=>{setEmail(account.email);setPassword(account.password);setError("");}}>Use {account.id==="crecom-1"?"CRECOM Member 1":account.id==="crecom-2"?"CRECOM Member 2":account.id==="crecom-chair"?"CRECOM Chairperson":"BOD Chairperson"}</Button></Card>)}
    </section>
    <Card><h2 className="mb-1 text-card-title font-semibold">Prototype sign-in</h2><p className="mb-4 text-caption text-portal-secondary">Choose a sample identity on the left, then open its portal. These credentials work only in this prototype.</p><form onSubmit={submit} className="space-y-4"><CommitteeField label="Prototype email"><Input type="email" required autoComplete="off" value={email} onChange={event=>setEmail(event.target.value)} /></CommitteeField><CommitteeField label="Prototype password"><PasswordInput label="Prototype password"  required autoComplete="off" value={password} onChange={event=>setPassword(event.target.value)} /></CommitteeField>{error&&<p role="alert" className="text-support text-status-danger">{error}</p>}<Button type="submit" variant="primary" className="w-full">Open prototype portal</Button></form><div className="mt-5 border-t border-portal-border pt-4 text-caption text-portal-secondary"><p>Try Member 1, Member 2 and the CRECOM Chairperson on PROTO-2026-0001. After all three responses, switch to BOD to review it.</p><p className="mt-2">PROTO-2026-0002 already has sample CRECOM confirmations, so BOD has a case to explore immediately.</p></div></Card>
   </div>
  </div>
 </main>;
}
function PrototypePortal({account,section,assignmentId}:{account:PrototypeAccount;section:string;assignmentId?:string}){
 const router=useRouter(),[loaded,setLoaded]=useState(false),[allowed,setAllowed]=useState(false),[store,setStore]=useState<PrototypeStore>(createPrototypeStore),[generation,setGeneration]=useState(0),[reset,setReset]=useState(false),[error,setError]=useState("");
 const refresh=useCallback(async()=>{
  setAllowed(window.sessionStorage.getItem(prototypeSessionKey)===account.id);setStore(parsePrototypeStore(window.localStorage.getItem(prototypeStoreKey)));setLoaded(true);
 },[account.id]);
 useEffect(()=>{let active=true;void Promise.resolve().then(()=>{if(active)return refresh();}).catch(error=>{if(active){setError(error instanceof Error?error.message:"Prototype storage is unavailable.");setLoaded(true);}});return()=>{active=false;};},[refresh]);
 const services=useMemo(()=>createPrototypeServices(account,{getItem:key=>window.localStorage.getItem(key),setItem:(key,value)=>{window.localStorage.setItem(key,value);setStore(parsePrototypeStore(value));}},()=>window.sessionStorage.getItem(prototypeSessionKey)),[account]);
 const signOut=async()=>{window.sessionStorage.removeItem(prototypeSessionKey);router.push(prototypeBase);};
 if(!loaded)return <p role="status" className="p-8 text-support">Opening prototype portal…</p>;
 if(!allowed)return <main className="mx-auto my-16 max-w-lg space-y-4 px-4"><h1 className="text-card-title font-semibold">Choose a prototype account</h1><p className="text-support text-portal-secondary">Use the separate prototype sign-in to open this sample identity. Your real account session stays unchanged.</p>{error&&<p role="alert">{error}</p>}<Link href={prototypeBase} className="ui-button ui-button--primary">Open prototype sign-in</Link></main>;
 const profile=store.profiles[account.id],name=profile?.name??account.name;
 const user:User={id:prototypeUserId(account),email:account.email,aud:"prototype",app_metadata:{role:"prototype",prototype:true},user_metadata:{full_name:name,phone:profile?.phone??""},created_at:"2026-11-11T01:00:00Z"};
 const access:PortalAccess={allowed:true,role:account.role,setupRequired:false,reason:null,membershipId:"prototype-"+account.id,name,email:account.email,committeeSeat:account.seat};
 const resetSamples=()=>{try{const fresh=createPrototypeStore();window.localStorage.setItem(prototypeStoreKey,JSON.stringify(fresh));setStore(fresh);setGeneration(value=>value+1);setReset(false);setError("");}catch{setError("The sample data could not be reset. Check browser storage availability.");}};
 const banner=<section className="mb-5 rounded-xl border border-portal-border bg-surface-card p-4" aria-label="Prototype controls"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-support font-semibold text-coop-dashboard-green">Prototype · Sample data only</p><p className="mt-1 text-caption text-portal-secondary">{account.name} · Sample password: <span className="select-all font-mono">{account.password}</span>. Confirmations affect only this browser&apos;s sample data.</p></div><div className="flex flex-wrap gap-2"><Link href={prototypeBase} className="ui-button ui-button--compact ui-button--outline">Switch sample account</Link><Button size="compact" onClick={()=>void refresh()}>Refresh sample progress</Button><Button size="compact" onClick={()=>setReset(true)}>Reset prototype</Button></div></div><details className="mt-3 border-t border-portal-border pt-3 text-caption"><summary className="cursor-pointer font-medium">Sample approval flow</summary><ul className="mt-2 space-y-1 text-portal-secondary">{prototypeCases.map(loan=><li key={loan.id}>{loan.applicationId}: {sampleFlow(store,loan.id)}</li>)}</ul><p className="mt-2 text-portal-secondary">The BOD summary below previews CRECOM confirmations. Real Super Admin approval and loan release are outside this prototype.</p></details>{error&&<p role="alert" className="mt-2 text-caption text-status-danger">{error}</p>}</section>;
 return <CommitteeSessionProvider value={{user,access,role:account.role,refresh,signOut,portalPrefix:prototypePrefix(account.id),prototype:true}}><CommitteeServicesProvider value={services}><SidebarProvider><CommitteePortalShell banner={banner}><div key={generation}>{section==="review"?<CommitteePacket assignmentId={assignmentId??""} />:<CommitteeWorkspace key={section} section={section} />}</div></CommitteePortalShell>{reset&&<ActionDialog title="Reset prototype data" onClose={()=>setReset(false)} footer={<><Button onClick={()=>setReset(false)}>Cancel</Button><Button variant="primary" onClick={resetSamples}>Reset sample data</Button></>}><p className="text-support">Reset all four sample identities&apos; decisions, notifications and profile changes in this browser? Real accounts and loan records are unaffected.</p></ActionDialog>}</SidebarProvider></CommitteeServicesProvider></CommitteeSessionProvider>;
}
