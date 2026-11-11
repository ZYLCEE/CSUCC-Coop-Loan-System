"use client";
import {useEffect,useRef,useState,type FormEvent} from "react";
import {useRouter} from "next/navigation";
import {acceptCommitteeEmailLink,resolvePortalAccess} from "@/lib/committeeAuth";
import {committeeRequest} from "@/lib/committeeRequest";
import {getCommitteeRole,getPortalDashboardPath,type PortalAccess} from "@/lib/committee";
import {getSupabaseClient} from "@/lib/supabase";
import {Button} from "@/components/ui/Button";
import PasswordInput from "@/components/ui/PasswordInput";

export default function CommitteeSetup(){
 const [access,setAccess]=useState<PortalAccess|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [password,setPassword]=useState(""),[confirm,setConfirm]=useState(""),pending=useRef(false),accepted=useRef<Promise<void>|null>(null),router=useRouter();
 useEffect(()=>{
  let active=true;
  accepted.current??=acceptCommitteeEmailLink();
  void accepted.current.then(async()=>{const user=await getSupabaseClient().auth.getUser();if(!getCommitteeRole(user.data.user))throw new Error("Open the setup link for your committee account.");return resolvePortalAccess();})
   .then(value=>{if(active){setAccess(value);if(!value.allowed && !value.setupRequired)setError(value.reason??"This invitation is no longer available.");}})
   .catch(error=>{if(active)setError(error instanceof Error?error.message:"The setup link is unavailable.");}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[]);
 const submit=async(event:FormEvent)=>{
  event.preventDefault();if(pending.current)return;setError("");
  if(password!==confirm || !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,128}$/.test(password)){setError("Use matching passwords of 8–128 characters with uppercase, lowercase, a number and a symbol.");return;}
  pending.current=true;setBusy(true);
  try{const next=await committeeRequest<PortalAccess>("",{method:"POST",body:JSON.stringify({operation:"setup",password,confirm})});setPassword("");setConfirm("");setAccess(next);
   if(next.allowed&&next.role)router.replace(getPortalDashboardPath(next.role));else setNotice("Password setup completed. "+(next.reason??"Sign in when your membership becomes active."));
  }catch(error){setError(error instanceof Error?error.message:"Password setup failed. Retry.");}
  finally{pending.current=false;setBusy(false);}
 };
 return <main className="flex min-h-screen items-center justify-center bg-surface-muted p-4"><section className="ui-card w-full max-w-md p-6">
  <h1 className="text-card-title">Set up your committee account</h1><p className="mt-2 text-support text-portal-secondary">Choose your own password before reviewing applications. Use the temporary credentials provided by the Super Admin, or your secure setup/reset link.</p>
  {loading?<p role="status" className="mt-5 text-support">Checking your setup link…</p>:<>{error&&<p role="alert" className="mt-4 text-support text-status-danger">{error}</p>}{notice&&<p role="status" className="mt-4 text-support text-status-success">{notice}</p>}
  {access && (access.allowed||access.setupRequired) && !notice && <form className="mt-5 space-y-4" onSubmit={submit}>
   <p className="text-support font-medium">{access.name} · {access.email}</p>
   <label className="block space-y-1.5 text-label">New password<PasswordInput label="New password" autoComplete="new-password" required minLength={8} maxLength={128} disabled={busy} value={password} onChange={event=>{setPassword(event.target.value);setError("");}} /></label>
   <label className="block space-y-1.5 text-label">Confirm password<PasswordInput label="Confirm password" autoComplete="new-password" required maxLength={128} disabled={busy} value={confirm} onChange={event=>{setConfirm(event.target.value);setError("");}} /></label>
   <p className="text-caption text-portal-secondary">Use a different password from your temporary password: 8–128 characters with uppercase, lowercase, a number and a symbol.</p>
   <Button type="submit" variant="primary" loading={busy}>Save password and continue</Button>
  </form>}
  <Button className="mt-4" disabled={busy} onClick={()=>void getSupabaseClient().auth.signOut({scope:"local"}).then(()=>router.replace("/login"))}>Return to sign in</Button></>}
 </section></main>;
}
