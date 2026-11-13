"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {useCommitteeAuth} from "./CommitteeAuthProvider";
import {useCommitteeServices} from "./CommitteeServices";
import {watchAdminNotifications} from "@/lib/adminNotifications";
import type {CommitteeNotification} from "@/lib/committee";

const changedEvent="committee-inbox-updated";
export function useCommitteeInbox(){
 const {user,prototype}=useCommitteeAuth(),{committeeRequest}=useCommitteeServices();
 const [rows,setRows]=useState<CommitteeNotification[]|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const mounted=useRef(false),sequence=useRef(0),pending=useRef(false);
 const load=useCallback(async()=>{
  const current=++sequence.current;
  try{const result=await committeeRequest<CommitteeNotification[]>("operation=inbox");if(mounted.current&&current===sequence.current){setRows(result);setError("");}}
  catch(error){if(mounted.current&&current===sequence.current)setError(error instanceof Error?error.message:"Notifications could not be loaded.");}
 },[committeeRequest]);
 useEffect(()=>{
  mounted.current=true;const initial=window.setTimeout(()=>void load(),0);
  const update=()=>{if(document.visibilityState!=="hidden")void load();};
  const local=(event:Event)=>{if((event as CustomEvent<string>).detail===user.id)update();};
  const unwatch=prototype?()=>{}:watchAdminNotifications(user.id,update);
  const timer=prototype?window.setInterval(update,5000):undefined;
  window.addEventListener(changedEvent,local);document.addEventListener("visibilitychange",update);
  window.addEventListener("focus",update);window.addEventListener("online",update);
  return()=>{mounted.current=false;window.clearTimeout(initial);unwatch();clearInterval(timer);window.removeEventListener(changedEvent,local);document.removeEventListener("visibilitychange",update);window.removeEventListener("focus",update);window.removeEventListener("online",update);};
 },[load,user.id,prototype]);
 const mark=useCallback(async(id:string|null)=>{
  if(pending.current)return false;
  pending.current=true;++sequence.current;setBusy(true);setError("");
  try{
   const result=await committeeRequest<CommitteeNotification[]>("",{method:"POST",body:JSON.stringify({operation:"read",id,all:id===null})});
   if(id===null?result.some(row=>!row.read):!result.some(row=>row.id===id&&row.read))throw new Error("The notification read status could not be confirmed. Refresh and retry.");
   if(mounted.current){++sequence.current;setRows(result);window.dispatchEvent(new CustomEvent(changedEvent,{detail:user.id}));}
   return true;
  }catch(error){if(mounted.current)setError(error instanceof Error?error.message:"The notification could not be marked as read.");return false;}
  finally{pending.current=false;if(mounted.current)setBusy(false);}
 },[committeeRequest,user.id]);
 return {rows,error,busy,load,mark,unread:rows?.filter(row=>!row.read).length??0};
}
