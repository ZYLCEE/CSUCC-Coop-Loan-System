"use client";
import {useId,useState,type ComponentProps} from "react";
import {Eye,EyeOff} from "lucide-react";
import {Input} from "./Fields";
export default function PasswordInput({label,className="",wrapperClassName="",...props}:Omit<ComponentProps<typeof Input>,"type">&{label:string}){
 const {onFocus,name,readOnly,autoComplete,...inputProps}=props;
 const id=useId(),manualEntry=autoComplete==="current-password";
 const [visible,setVisible]=useState(false),[entryEnabled,setEntryEnabled]=useState(!manualEntry);
 return <span className={"relative block w-full "+wrapperClassName}><Input {...inputProps} id={props.id??id} name={manualEntry?(name??`confirmation-${id}`):name} autoComplete={manualEntry?"off":autoComplete} readOnly={readOnly??(manualEntry&&!entryEnabled)} onFocus={event=>{if(manualEntry)setEntryEnabled(true);onFocus?.(event);}} aria-label={props["aria-label"]??label} type={visible?"text":"password"} className={"w-full pr-12 "+className}/><button type="button" disabled={props.disabled} aria-label={`${visible?"Hide":"Show"} ${label.toLowerCase()}`} aria-pressed={visible} onClick={()=>setVisible(value=>!value)} className="absolute inset-y-1 right-1 flex w-9 items-center justify-center rounded-md text-portal-secondary hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-coop-dashboard-green">{visible?<Eye className="h-4 w-4" aria-hidden="true"/>:<EyeOff className="h-4 w-4" aria-hidden="true"/>}</button></span>;
}
