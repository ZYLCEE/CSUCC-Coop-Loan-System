"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import {getPortalDashboardPath,type PortalRole} from "@/lib/committee";
import { CoopLoginLoadingScreen } from "./CoopLoginLoadingScreen";

type Phase = "loading" | "slow" | "exiting" | null;

const LoginTransitionContext = createContext<{
  openDashboard: (role: PortalRole) => void;
  finish: () => void;
} | null>(null);

export function LoginTransitionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [navigating, startNavigation] = useTransition();
  const [phase, setPhase] = useState<Phase>(null);

  const openDashboard = useCallback((role: PortalRole) => {
    setPhase("loading");
    startNavigation(() => router.replace(getPortalDashboardPath(role)));
  }, [router]);

  const finish = useCallback(() => {
    setPhase(current => current === null ? null : "exiting");
  }, []);

  const context = useMemo(() => ({ openDashboard, finish }), [openDashboard, finish]);
  const blocking = phase === "loading" || phase === "slow";
  const atDashboard = (["admin","super_admin","crecom_member","bod_member"] as const).some(role=>pathname===getPortalDashboardPath(role));
  const navigationFailed = blocking && !navigating && !atDashboard;

  useEffect(() => {
    if (phase !== "loading" || navigationFailed) return;
    // Offer a way out of a stalled handoff without cancelling the underlying requests.
    const timer = window.setTimeout(() => setPhase(current => current === "loading" ? "slow" : current), 30000);
    return () => window.clearTimeout(timer);
  }, [phase, navigationFailed]);

  useEffect(() => {
    if (phase !== "exiting") return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => setPhase(null), reducedMotion ? 0 : 240);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const error = navigationFailed ? "Couldn’t open the dashboard. Please sign in again."
    : phase === "slow" ? "The dashboard is taking longer than expected."
    : null;

  return (
    <LoginTransitionContext.Provider value={context}>
      <div className="contents" inert={blocking}>{children}</div>
      <p role="status" className="sr-only">{blocking && !error ? "Signing you in..." : ""}</p>
      {phase && <CoopLoginLoadingScreen exiting={phase === "exiting"} error={error} />}
    </LoginTransitionContext.Provider>
  );
}

export function useLoginTransition() {
  const context = useContext(LoginTransitionContext);
  if (!context) throw new Error("useLoginTransition must be used inside LoginTransitionProvider.");
  return context;
}
