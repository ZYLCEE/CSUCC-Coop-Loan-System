"use client";
import PasswordInput from "@/components/ui/PasswordInput";
import {useState} from "react";
import {useCommitteeAuth} from "./CommitteeAuthProvider";
import {useCommitteeServices} from "./CommitteeServices";
import {committeePositionLabel} from "@/lib/committee";
import {validatePasswordChange} from "@/lib/profileModel";
import {Button} from "@/components/ui/Button";
import {Card} from "@/components/ui/Card";
import {Input} from "@/components/ui/Fields";
import {CommitteeField} from "./CommitteeFields";

export default function CommitteeProfile(){
 const {committeeRequest}=useCommitteeServices(),{user,access,role,refresh,prototype}=useCommitteeAuth();
 const [name,setName]=useState(access.name),[phone,setPhone]=useState(String(user.user_metadata.phone??"")),[current,setCurrent]=useState(""),[next,setNext]=useState(""),[confirm,setConfirm]=useState("");
 const [busy,setBusy]=useState(""),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const save=async(operation:"profile"|"password")=>{
  if(busy)return;setError("");setNotice("");
  try{
   const payload=operation==="password"?validatePasswordChange({current,next,confirm}):undefined;
   setBusy(operation);
   const result=await committeeRequest<{warning:string|null}>("",{method:"POST",body:JSON.stringify({operation,name,phone,payload})});
   if(operation==="password"){setCurrent("");setNext("");setConfirm("");}
   await refresh();setNotice(result.warning??(operation==="profile"?"Profile updated.":"Password updated."));
  }catch(error){setError(error instanceof Error?error.message:"Your account could not be updated.");}finally{setBusy("");}
 };
 return <div className="grid max-w-5xl gap-4 lg:grid-cols-2">
  <Card><h2 className="mb-4 text-card-title font-semibold">My profile</h2><form className="space-y-3" onSubmit={event=>{event.preventDefault();void save("profile");}}>
   <CommitteeField label="Full name"><Input required maxLength={160} value={name} onChange={event=>setName(event.target.value)} /></CommitteeField>
   <CommitteeField label="Contact number (optional)"><Input type="tel" maxLength={30} value={phone} onChange={event=>setPhone(event.target.value)} /></CommitteeField>
   <CommitteeField label="Registered email"><Input value={user.email??""} disabled className="cursor-not-allowed" /></CommitteeField>
   <p className="text-support text-portal-secondary">{committeePositionLabel(role,access.committeeSeat,access.committeeMemberNumber)} · Membership managed by the Super Admin</p>
   <Button type="submit" variant="primary" disabled={!!busy} loading={busy==="profile"}>Save profile</Button>
  </form></Card>
  <Card><h2 className="mb-4 text-card-title font-semibold">Change password</h2><form className="space-y-3" onSubmit={event=>{event.preventDefault();if(!prototype)void save("password");}}><fieldset disabled={prototype} className="space-y-3">
   <CommitteeField label="Current password"><PasswordInput label="Current password" required  value={current} onChange={event=>setCurrent(event.target.value)} autoComplete="current-password" /></CommitteeField>
   <CommitteeField label="New password"><PasswordInput label="New password" required  minLength={8} maxLength={128} value={next} onChange={event=>setNext(event.target.value)} autoComplete="new-password" /></CommitteeField>
   <CommitteeField label="Confirm new password"><PasswordInput label="Confirm new password" required  value={confirm} onChange={event=>setConfirm(event.target.value)} autoComplete="new-password" /></CommitteeField>
   <p className="text-caption text-portal-secondary">Use 8–128 characters with uppercase, lowercase, a number and a symbol.</p>
   <Button type="submit" variant="primary" disabled={!!busy} loading={busy==="password"}>Update password</Button></fieldset>{prototype&&<p className="text-caption text-portal-secondary">Demonstration passwords are configured by the system team. Personal password changes are available for real committee accounts.</p>}
  </form></Card>
  {error&&<p role="alert" className="text-support text-status-danger lg:col-span-2">{error}</p>}
  {notice&&<p role="status" className="text-support text-status-success lg:col-span-2">{notice}</p>}
 </div>;
}
