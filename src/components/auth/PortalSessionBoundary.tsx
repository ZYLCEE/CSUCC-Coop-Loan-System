"use client";
import {useEffect,useState,type ReactNode} from "react";
import {useRouter} from "next/navigation";
import {portalSessionAction} from "@/lib/portalSession";
import {getSupabaseClient} from "@/lib/supabase";
import {Button} from "@/components/ui/Button";

export default function PortalSessionBoundary({children}:{children:ReactNode}){
 const router=useRouter(),[ready,setReady]=useState(false),[error,setError]=useState(""),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  let disposed=false,pending=false,initialized=false,interaction=0,sent=0,lastInteraction=Date.now();
  const update=async()=>{
   if(disposed||pending)return;pending=true;
   try{
    const version=interaction,operation=initialized&&version!==sent?"touch":"start";
    await portalSessionAction(operation,Math.max(0,Math.floor((Date.now()-lastInteraction)/1000)));
    if(disposed)return;initialized=true;sent=version;setReady(true);setError("");
   }catch(error){
    if(disposed)return;
    const status=error&&typeof error==="object"&&"status" in error?error.status:null;
    if(status===401||status===403){await getSupabaseClient().auth.signOut({scope:"local"});if(!disposed)router.replace("/login");}
    else if(!initialized)setError("Your portal session could not be opened. Please retry.");
   }finally{pending=false;}
  };
  const activity=(event:Event)=>{if(event.isTrusted){const now=Date.now(),wasQuiet=now-lastInteraction>=30000;interaction++;lastInteraction=now;if(wasQuiet)void update();}};
  const focus=()=>{if(document.visibilityState!=="hidden")void update();};
  for(const event of ["pointerdown","keydown","scroll","touchstart"])window.addEventListener(event,activity,{passive:true});
  window.addEventListener("focus",focus);window.addEventListener("online",focus);document.addEventListener("visibilitychange",focus);
  void update();const timer=window.setInterval(()=>void update(),30000);
  return()=>{disposed=true;window.clearInterval(timer);for(const event of ["pointerdown","keydown","scroll","touchstart"])window.removeEventListener(event,activity);window.removeEventListener("focus",focus);window.removeEventListener("online",focus);document.removeEventListener("visibilitychange",focus);};
 },[router,attempt]);
 if(!ready)return <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-support text-portal-secondary"><p role={error?"alert":"status"}>{error||"Opening your portal session…"}</p>{error&&<Button onClick={()=>{setError("");setAttempt(value=>value+1);}}>Retry</Button>}</div>;
 return <>{children}</>;
}
