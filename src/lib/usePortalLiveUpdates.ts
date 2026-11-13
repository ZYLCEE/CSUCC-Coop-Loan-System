"use client";
import {useEffect,useRef,useState} from "react";
import {getSupabaseClient} from "./supabase";
export const portalDataChanged="coop-portal-data-changed";
export function usePortalLiveUpdates(onChange:()=>void){
 const callback=useRef(onChange);useEffect(()=>{callback.current=onChange;},[onChange]);
 const [connected,setConnected]=useState(true);
 useEffect(()=>{
  let disposed=false,timer:ReturnType<typeof setTimeout>|undefined;
  const update=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(!disposed&&document.visibilityState!=="hidden")callback.current();},200);};
  const client=getSupabaseClient(),channel=client.channel("portal-data-"+crypto.randomUUID());
  for(const table of ["loan_applications","members","loan_payments","application_verifications"])channel.on("postgres_changes",{event:"*",schema:"public",table},update);
  channel.subscribe(status=>{if(disposed)return;setConnected(status==="SUBSCRIBED");if(status==="SUBSCRIBED")update();});
  const foreground=()=>{if(document.visibilityState!=="hidden")update();};
  const offline=()=>setConnected(false),poll=window.setInterval(foreground,30000);
  window.addEventListener("focus",foreground);window.addEventListener("online",foreground);window.addEventListener("offline",offline);window.addEventListener(portalDataChanged,update);document.addEventListener("visibilitychange",foreground);
  return()=>{disposed=true;clearTimeout(timer);window.clearInterval(poll);window.removeEventListener("focus",foreground);window.removeEventListener("online",foreground);window.removeEventListener("offline",offline);window.removeEventListener(portalDataChanged,update);document.removeEventListener("visibilitychange",foreground);void client.removeChannel(channel);};
 },[]);
 return connected;
}
