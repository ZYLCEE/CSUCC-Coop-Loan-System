"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Check, Volume2, VolumeX, X } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import { useAdminAuth } from "@/components/auth/AdminAuthProvider";

interface LoanAlert {
  id: string;
  applicationId: string;
  memberName: string;
  amount: string;
  receivedAt: number;
}

function money(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? `₱${amount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "Amount unavailable";
}

export default function SuperAdminLoanAlerts() {
  const { role } = useAdminAuth();
  const router = useRouter();
  const [alerts, setAlerts] = useState<LoanAlert[]>([]);
  const [realtimeStatus, setRealtimeStatus] = useState("connecting");
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [alertError, setAlertError] = useState("");
  const soundEnabledRef = useRef(false);
  const audioContext = useRef<AudioContext | null>(null);
  const seenIds = useRef(new Set<string>());
  const timers = useRef(new Map<string, number>());

  const playAlert = useCallback(() => {
    const audio = audioContext.current;
    if (!soundEnabledRef.current || !audio || audio.state !== "running" || document.visibilityState !== "visible") return;

    const now = audio.currentTime;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, now);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.15);
  }, []);

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.current.delete(id);
    setAlerts((current) => current.filter((alert) => alert.id !== id));
  }, []);

  const enableAlerts = async () => {
    try {
      const AudioConstructor = window.AudioContext;
      if (!AudioConstructor) throw new Error("This browser does not support alert sounds.");
      audioContext.current ??= new AudioConstructor();
      await audioContext.current.resume();
      if ("Notification" in window && Notification.permission === "default") {
        await Notification.requestPermission();
      }
      setAlertError("");
      const enabled = audioContext.current.state === "running";
      soundEnabledRef.current = enabled;
      setSoundEnabled(enabled);
      if (!enabled) throw new Error("Browser audio is blocked. Allow sound for this site and try again.");
    } catch (error) {
      soundEnabledRef.current = false;
      setAlertError(error instanceof Error ? error.message : "Unable to enable alert sound.");
      setSoundEnabled(false);
    }
  };

  useEffect(() => {
    if (role !== "super_admin") return;
    let active = true;
    const activeTimers = timers.current;
    const client = getSupabaseClient();
    const channel = client
      .channel("super-admin-new-loan-requests")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "loan_applications" }, ({ new: row }) => {
        if (!active || row.status !== "pending" || typeof row.application_id !== "string") return;
        if (seenIds.current.has(row.application_id)) return;
        seenIds.current.add(row.application_id);
        if (seenIds.current.size > 500) seenIds.current.clear();

        const alert: LoanAlert = {
          id: row.application_id,
          applicationId: row.application_id,
          memberName: typeof row.member_name === "string" ? row.member_name : "Member",
          amount: money(row.amount),
          receivedAt: Date.now(),
        };
        setAlerts((current) => [alert, ...current].slice(0, 3));
        setAlertError("");
        playAlert();

        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          try {
            new Notification("New loan application", {
              body: `${alert.memberName} submitted ${alert.applicationId} for ${alert.amount}.`,
              tag: alert.applicationId,
              silent: true,
            });
          } catch { /* In-page alert remains visible if desktop notifications are unavailable. */ }
        }

        const timer = window.setTimeout(() => dismiss(alert.id), 15000);
        timers.current.set(alert.id, timer);
      })
      .subscribe((status) => {
        if (!active) return;
        if (status === "SUBSCRIBED") setRealtimeStatus("connected");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setRealtimeStatus("disconnected");
      });

    return () => {
      active = false;
      for (const timer of activeTimers.values()) window.clearTimeout(timer);
      activeTimers.clear();
      void client.removeChannel(channel);
      void audioContext.current?.close();
      audioContext.current = null;
    };
  }, [dismiss, playAlert, role]);

  if (role !== "super_admin") return null;

  return (
    <>
      <div className="fixed bottom-4 right-4 z-[90] flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-xl border border-[#D7E5DC] bg-white px-3 py-2 shadow-lg">
        <span className={`h-2.5 w-2.5 rounded-full ${realtimeStatus === "connected" ? "bg-emerald-500" : "bg-amber-500"}`} aria-label={`Realtime ${realtimeStatus}`} />
        <span className="text-xs text-slate-600">Loan alerts {realtimeStatus === "connected" ? "live" : "reconnecting"}</span>
        <button type="button" onClick={() => void enableAlerts()} aria-label={soundEnabled ? "Loan alert sound enabled" : "Enable loan alert sound and desktop notifications"} title={soundEnabled ? "Sound enabled" : "Enable sound and desktop notifications"} className="rounded-md p-1 text-[#155D3B] hover:bg-emerald-50">
          {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </button>
      </div>
      {alertError && <div role="status" className="fixed bottom-16 right-4 z-[90] rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow">{alertError}</div>}
      <div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed right-4 top-20 z-[100] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
        {alerts.map((alert) => <section key={alert.id} role="status" className="pointer-events-auto rounded-xl border border-emerald-200 bg-white p-4 shadow-xl">
          <div className="flex items-start gap-3">
            <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-[#155D3B]" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-[#17212F]">New loan application</p>
              <p className="mt-1 break-words text-sm text-slate-600">{alert.memberName} · {alert.applicationId}</p>
              <p className="mt-0.5 text-sm font-semibold text-[#155D3B]">{alert.amount}</p>
              <button type="button" onClick={() => { dismiss(alert.id); router.push("/super-admin/loan-applications"); }} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[#155D3B] underline"><Check className="h-4 w-4" /> Review application</button>
            </div>
            <button type="button" onClick={() => dismiss(alert.id)} aria-label="Dismiss loan alert" className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
          </div>
        </section>)}
      </div>
    </>
  );
}
