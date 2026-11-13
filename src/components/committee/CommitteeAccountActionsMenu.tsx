"use client";
import {useEffect,useId,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {Ban,Eye,KeyRound,MoreVertical,Pencil,RotateCcw,Trash2,Unlock} from "lucide-react";
import {navigateRecordMenu,recordMenuPosition} from "@/components/shared/recordMenu";
import type {CommitteeAccount} from "@/lib/committee";

export type CommitteeAccountAction="edit"|"reset"|"deactivate"|"reactivate"|"delete"|"create"|"invite";
export default function CommitteeAccountActionsMenu({account,credentialsEnabled,onView,onAction}:{account:CommitteeAccount;credentialsEnabled:boolean;onView:()=>void;onAction:(action:CommitteeAccountAction)=>void}){
 const id=useId(),trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null),anchor=useRef<DOMRect|null>(null),[position,setPosition]=useState<ReturnType<typeof recordMenuPosition>|null>(null);
 const created=account.revision>0,pending=account.status==="recovery_pending";
 useEffect(()=>{
  if(!position)return;
  menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({preventScroll:true});
  const outside=(event:PointerEvent)=>{if(!trigger.current?.contains(event.target as Node)&&!menu.current?.contains(event.target as Node))setPosition(null);};
  const close=()=>setPosition(null);
  const scroll=(event:Event)=>{
   if(event.target instanceof Node&&menu.current?.contains(event.target))return;
   const before=anchor.current,after=trigger.current?.getBoundingClientRect();
   if(!before||!after||Math.abs(before.top-after.top)>0.5||Math.abs(before.left-after.left)>0.5)close();
  };
  document.addEventListener("pointerdown",outside);window.addEventListener("resize",close);window.addEventListener("scroll",scroll,true);
  return()=>{document.removeEventListener("pointerdown",outside);window.removeEventListener("resize",close);window.removeEventListener("scroll",scroll,true);};
 },[position]);
 const choose=(callback:()=>void)=>{setPosition(null);trigger.current?.focus({preventScroll:true});callback();};
 const item="ui-button ui-button--ghost min-h-11 w-full justify-start gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-portal-primary hover:bg-surface-muted";
 const icon="h-5 w-5 shrink-0 text-portal-muted";
 const open=()=>{if(trigger.current){anchor.current=trigger.current.getBoundingClientRect();setPosition(recordMenuPosition(trigger.current,250,created?264:308));}};
 return <>
  <button ref={trigger} type="button" className="ui-icon-button" aria-label={"Open actions for "+account.name} aria-haspopup="menu" aria-expanded={!!position} aria-controls={position?id:undefined} onClick={()=>position?setPosition(null):open()} onKeyDown={event=>{if(event.key==="ArrowDown"||event.key==="ArrowUp"){event.preventDefault();open();}}}><MoreVertical className="size-icon" aria-hidden="true"/></button>
  {position&&createPortal(<div ref={menu} id={id} role="menu" aria-label={"Actions for "+account.name} className="ui-card fixed z-[70] w-[250px] overflow-y-auto p-2 shadow-portal-dropdown" style={position} onKeyDown={event=>navigateRecordMenu(event,()=>{setPosition(null);trigger.current?.focus({preventScroll:true});})}>
   <button type="button" role="menuitem" tabIndex={-1} className={item} onClick={()=>choose(onView)}><Eye className={icon} aria-hidden="true"/>View Details</button>
   <button type="button" role="menuitem" tabIndex={-1} className={item} disabled={!created||pending} onClick={()=>choose(()=>onAction("edit"))}><Pencil className={icon} aria-hidden="true"/>Edit</button>
   <button type="button" role="menuitem" tabIndex={-1} className={item} disabled={!created||!credentialsEnabled} title={!credentialsEnabled?"This action is currently unavailable.":undefined} onClick={()=>choose(()=>onAction("reset"))}><KeyRound className={icon} aria-hidden="true"/>Reset Password</button>
   <button type="button" role="menuitem" tabIndex={-1} className={item} disabled={!created||pending} onClick={()=>choose(()=>onAction(account.active?"deactivate":"reactivate"))}>{account.active?<Ban className={icon} aria-hidden="true"/>:<Unlock className={icon} aria-hidden="true"/>}{account.active?"Block":"Unblock"}</button>
   <button type="button" role="menuitem" tabIndex={-1} className={item+" mt-1 bg-status-danger-surface text-status-danger hover:bg-status-danger-surface"} disabled={!created||!credentialsEnabled} title={!credentialsEnabled?"This action is currently unavailable.":undefined} onClick={()=>choose(()=>onAction("delete"))}><Trash2 className="h-5 w-5 shrink-0" aria-hidden="true"/>Delete</button>
   {!created&&<button type="button" role="menuitem" tabIndex={-1} className={item} onClick={()=>choose(()=>onAction(account.creationMode==="password"?"create":"invite"))}><RotateCcw className={icon} aria-hidden="true"/>Retry creation</button>}
  </div>,document.body)}
 </>;
}
