"use client";

import { useEffect,useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {useRouter} from "next/navigation";
import Image from "next/image";
import {
  CircleAlert, Eye, EyeOff, LoaderCircle, LockKeyhole, LogIn, Mail,
  ShieldCheck, TriangleAlert,
} from "lucide-react";
import { isActiveAdministrator } from "@/lib/adminPrivileges";
import { getAdminRole } from "@/lib/auth/roles";
import { useLoginTransition } from "@/components/auth/LoginTransitionProvider";
import { getAuthErrorMessage } from "@/lib/authErrors";
import { getSupabaseClient } from "@/lib/supabase";
import campusPhoto from "../../../assets/csu-cabadbaran-campus.jpg";
import campusLogo from "../../../assets/csu-cabadbaran-logo.png";
import cooperativeLogo from "../../../assets/csucc-logo.png";
import styles from "./login.module.css";
import {getCommitteeRole} from "@/lib/committee";
import {hasCommitteeEmailLink,acceptCommitteeEmailLink,resolvePortalAccess} from "@/lib/committeeAuth";
import {committeeDemoAction,CommitteeDemoError} from "@/lib/committeeDemo";

export default function AdminLoginPage() {
  const { openDashboard } = useLoginTransition();
  const router=useRouter();
  const [email, setEmail] = useState("");
  const [emailInvalid, setEmailInvalid] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false);
  const passwordInput = useRef<HTMLInputElement>(null);
  const emailLink = useRef<Promise<void>|null>(null);
  useEffect(()=>{
    if(!hasCommitteeEmailLink())return;
    let active=true;
    emailLink.current??=acceptCommitteeEmailLink();
    void emailLink.current.then(()=>{if(active)router.replace("/auth/committee-setup");}).catch(error=>{if(active)setErrorMessage(error instanceof Error?error.message:"The setup link could not be opened.");});
    return()=>{active=false;};
  },[router]);

  const updateCapsLock = (event: KeyboardEvent<HTMLInputElement>) => {
    setCapsLock(event.getModifierState("CapsLock"));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current || !email.trim() || !password) return;

    submitting.current = true;
    setErrorMessage("");
    setLoading(true);

    try {
      const demonstration=await committeeDemoAction({operation:"login",email:email.trim(),password});
      if(demonstration.account){setPassword("");openDashboard(demonstration.account.role);return;}
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error || !data.user) {
        setErrorMessage(getAuthErrorMessage(error));
        return;
      }

      if(getCommitteeRole(data.user)){
        const access=await resolvePortalAccess();
        if(access.setupRequired){setPassword("");router.replace("/auth/committee-setup");return;}
        if(access.allowed && (access.role==="crecom_member" || access.role==="bod_member")){setPassword("");openDashboard(access.role);return;}
        await supabase.auth.signOut();setErrorMessage(access.reason??"Committee access is inactive or unavailable.");return;
      }
      const role = getAdminRole(data.user);
      if (!role) {
        await supabase.auth.signOut();
        setErrorMessage("This account is not authorized for the admin portal.");
        return;
      }

      if (!isActiveAdministrator(data.user)) {
        await supabase.auth.signOut();
        setErrorMessage("This account is blocked or inactive. Please contact your system administrator.");
        return;
      }

      setPassword("");
      openDashboard(role);
    } catch (error) {
      setErrorMessage(error instanceof CommitteeDemoError?error.message:getAuthErrorMessage(error));
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  return (
    <main className={styles.page}>
      <div className={styles.scene} aria-hidden="true">
        <Image
          src={campusPhoto}
          alt=""
          fill
          sizes="100vw"
          className={styles.campusPhoto}
          loading="eager"
        />
        <div className={styles.sky}>
          <Image
            src={campusPhoto}
            alt=""
            fill
            sizes="100vw"
            className={styles.campusPhoto}
            loading="eager"
          />
        </div>
      </div>

      <header className={styles.university}>
        <Image
          src={campusLogo}
          alt="Caraga State University seal"
          className={styles.universityLogo}
          sizes="(max-width: 767px) 34px, 42px"
          loading="eager"
        />
        <p className={styles.universityName}>
          <strong>Caraga State University</strong>
          <span>Cabadbaran Campus</span>
        </p>
      </header>

      <div className={styles.layout}>
        <section className={styles.brand} aria-labelledby="portal-title">
          <div className={styles.logo}>
            <Image
              src={cooperativeLogo}
              alt="CSUCC Employees and Retirees Multi-Purpose Cooperative seal"
              className={styles.seal}
              sizes="(max-width: 767px) 112px, (max-width: 1023px) 192px, 248px"
              loading="eager"
            />
          </div>
          <h1 id="portal-title" className={styles.title}>
            <span>CSUCC</span> ERMPC Admin Portal
          </h1>
          <p className={styles.tagline}>
            Empowering efficient and secure cooperative management.
          </p>
        </section>

        <form className={styles.card} onSubmit={submit} aria-labelledby="login-heading">
          <header className={styles.cardHeader}>
            <h2 id="login-heading">Log In</h2>
            <p>Sign in to access your administrative dashboard.</p>
          </header>

          <div className={styles.field}>
            <label htmlFor="login-email">Email Address</label>
            <div className={styles.inputGroup}>
              <Mail className={styles.fieldIcon} size={18} aria-hidden="true" />
              {/* Browser form tools can inject fdprocessedid before hydration. */}
              <input
                suppressHydrationWarning
                id="login-email"
                name="email"
                type="email"
                autoComplete="username"
                placeholder="Enter your email address"
                required
                value={email}
                onChange={(event) => {
                  setEmail(event.currentTarget.value);
                  if (emailInvalid && !event.currentTarget.validity.typeMismatch) {
                    setEmailInvalid(false);
                  }
                }}
                onBlur={(event) => setEmailInvalid(event.currentTarget.validity.typeMismatch)}
                onInvalid={(event) => {
                  if (event.currentTarget.validity.typeMismatch) {
                    event.preventDefault();
                    setEmailInvalid(true);
                    event.currentTarget.focus();
                  }
                }}
                aria-invalid={emailInvalid || undefined}
                aria-describedby={emailInvalid ? "login-email-error" : undefined}
                className={styles.input}
              />
            </div>
            {emailInvalid && (
              <p id="login-email-error" role="alert" className={styles.fieldError}>
                <CircleAlert size={14} aria-hidden="true" />
                Please enter a valid email address.
              </p>
            )}
          </div>

          <div className={styles.field}>
            <div className={styles.passwordLabel}>
              <label htmlFor="login-password">Password</label>
              <span id="login-caps-lock" role="status" className={styles.capsLock}>
                {capsLock && (
                  <>
                    <TriangleAlert size={13} aria-hidden="true" />
                    Caps Lock is on.
                  </>
                )}
              </span>
            </div>
            <div className={styles.inputGroup}>
              <LockKeyhole className={styles.fieldIcon} size={18} aria-hidden="true" />
              <input
                suppressHydrationWarning
                ref={passwordInput}
                id="login-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Enter your password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={updateCapsLock}
                onKeyUp={updateCapsLock}
                onBlur={() => setCapsLock(false)}
                aria-describedby={capsLock ? "login-caps-lock" : undefined}
                className={`${styles.input} ${styles.passwordInput}`}
              />
              <button
                suppressHydrationWarning
                type="button"
                className={styles.toggle}
                onPointerDown={(event) => {
                  if (event.button === 0 && document.activeElement === passwordInput.current) {
                    event.preventDefault();
                  }
                }}
                onClick={() => setShowPassword((shown) => !shown)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-controls="login-password"
              >
                {showPassword ? (
                  <Eye size={17} aria-hidden="true" />
                ) : (
                  <EyeOff size={17} aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          {errorMessage && (
            <p role="alert" className={styles.error}>
              {errorMessage}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !email.trim() || !password}
            className={styles.submit}
          >
            {loading ? (
              <LoaderCircle className={styles.spinner} size={19} aria-hidden="true" />
            ) : (
              <LogIn className={styles.submitIcon} size={19} aria-hidden="true" />
            )}
            {loading ? "Signing in…" : "Sign In"}
          </button>
          <p role="status" className="sr-only">{loading ? "Signing in…" : ""}</p>

          <p className={styles.notice}>
            <ShieldCheck size={17} aria-hidden="true" />
            Authorized personnel only.
          </p>
        </form>
      </div>
    </main>
  );
}
