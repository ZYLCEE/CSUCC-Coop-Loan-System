"use client";
import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from "react";
import type {User} from "@supabase/supabase-js";
import {useRouter} from "next/navigation";
import {getSupabaseClient} from "@/lib/supabase";
import {resolvePortalAccess} from "@/lib/committeeAuth";
import {getPortalDashboardPath,type CommitteeRole,type PortalAccess} from "@/lib/committee";
import {useLoginTransition} from "@/components/auth/LoginTransitionProvider";
import {Button} from "@/components/ui/Button";
import PortalSessionBoundary from "@/components/auth/PortalSessionBoundary";
import {portalSessionAction} from "@/lib/portalSession";

export type CommitteeSession={user:User;access:PortalAccess;role:CommitteeRole;refresh:()=>Promise<void>;signOut:()=>Promise<void>;portalPrefix?:string;prototype?:boolean;banner?:ReactNode};
const Context=createContext<CommitteeSession|null>(null);
export function CommitteeSessionProvider({value,children}:{value:CommitteeSession;children:ReactNode}){return <Context.Provider value={value}>{children}</Context.Provider>;}
export default function CommitteeAuthProvider({children,role}:{children:ReactNode;role:CommitteeRole}){
 const [state,setState]=useState<{user:User|null;access:PortalAccess|null;error:string;loading:boolean}>({user:null,access:null,error:"",loading:true});
 const router=useRouter(),{finish}=useLoginTransition(),pending=useRef<Promise<void>|null>(null),mounted=useRef(false),generation=useRef(0);
 const refresh=useCallback(()=>{
  if(pending.current)return pending.current;
  const version=generation.current;
  const task=(async()=>{
   try{
    const current=await getSupabaseClient().auth.getUser();
    if(current.error || !current.data.user){if(mounted.current&&generation.current===version){setState({user:null,access:null,error:"",loading:false});router.replace("/login");}return;}
    const access=await resolvePortalAccess();
    if(!mounted.current||generation.current!==version)return;
    setState({user:current.data.user,access,error:"",loading:false});
    if(access.setupRequired)router.replace("/auth/committee-setup");
    else if(access.allowed && access.role && access.role!==role)router.replace(getPortalDashboardPath(access.role));
   }catch(error){if(mounted.current&&generation.current===version)setState({user:null,access:null,error:error instanceof Error?error.message:"Committee access could not be verified.",loading:false});}
   finally{if(generation.current===version)pending.current=null;}
  })();pending.current=task;return task;
 },[role,router]);
 useEffect(()=>{
  mounted.current=true;void refresh();
  const update=()=>{if(document.visibilityState!=="hidden")void refresh();};
  const timer=window.setInterval(update,30000);
  const {data:{subscription}}=getSupabaseClient().auth.onAuthStateChange((event,session)=>{
   if(event==="INITIAL_SESSION")return;
   generation.current++;pending.current=null;
   if(!session){setState({user:null,access:null,error:"",loading:false});router.replace("/login");return;}
   if(event==="SIGNED_IN")setState({user:null,access:null,error:"",loading:true});
   window.setTimeout(update,0);
  });
  window.addEventListener("focus",update);window.addEventListener("online",update);document.addEventListener("visibilitychange",update);
  // This sequence counter deliberately invalidates whichever request is current.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return()=>{mounted.current=false;generation.current++;pending.current=null;subscription.unsubscribe();window.clearInterval(timer);window.removeEventListener("focus",update);window.removeEventListener("online",update);document.removeEventListener("visibilitychange",update);};
 },[refresh,router]);
 useEffect(()=>{if(!state.loading)finish();},[finish,state.loading]);
 const signOut=async()=>{await portalSessionAction("logout").catch(()=>{});const result=await getSupabaseClient().auth.signOut({scope:"local"});if(result.error)throw result.error;generation.current++;pending.current=null;setState({user:null,access:null,error:"",loading:false});router.replace("/login");};
 if(state.loading)return <p role="status" className="p-8 text-support">Validating committee membership…</p>;
 if(state.error || !state.access?.allowed || state.access.role!==role || !state.user)return <div className="mx-auto my-16 max-w-lg space-y-4 rounded-xl border border-portal-border bg-surface-card p-6">
  <h1 className="text-card-title">Committee access unavailable</h1><p role="alert" className="text-support text-portal-secondary">{state.error||state.access?.reason||"Opening your authorized portal…"}</p>
  <div className="flex gap-2"><Button onClick={()=>void refresh()}>Retry</Button><Button onClick={()=>void signOut().catch(error=>setState(current=>({...current,error:error instanceof Error?error.message:"Sign out failed."})))}>Sign out</Button></div>
 </div>;
 return <Context.Provider value={{user:state.user,access:state.access,role,refresh,signOut}}><PortalSessionBoundary>{children}</PortalSessionBoundary></Context.Provider>;
}
export function useCommitteeAuth(){const context=useContext(Context);if(!context)throw new Error("Committee context is unavailable.");return context;}
