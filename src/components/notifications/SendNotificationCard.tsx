"use client";

import { StatusBadge } from "@/components/ui/StatusBadge";
import { Input, Select, Textarea } from "@/components/ui/Fields";
import { SearchInput } from "@/components/ui/FilterToolbar";

import { actionButtonStyles } from "@/components/shared/actionButtonStyles";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, CalendarDays, CheckCircle2, Send, Smartphone, X } from "lucide-react";
import type { Member } from "@/components/members/MembersData";
import { fetchAdminAccounts } from "@/lib/adminAccounts";
import { useSecureAdminAction } from "@/components/auth/SecureAdminActionProvider";
import { getSupabaseClient } from "@/lib/supabase";
import { useAdminAuth } from "@/components/auth/AdminAuthProvider";
import NotificationTypePills from "./NotificationTypePills";

type RecipientTarget = "allMembers" | "activeLoanMembers" | "specificMember" | "selectedMembers";
const control = "w-full";
const label = "mb-1 block text-label text-portal-primary";

export default function SendNotificationCard({ onRequestCompleted }: { onRequestCompleted?: () => void }) {
  const { role, can } = useAdminAuth();
  const canSend = can("notifications.send");
  const { beginSecureAction } = useSecureAdminAction();
  const [deliveryService, setDeliveryService] = useState<{ delivery_enabled: boolean; scheduling_enabled: boolean } | null>(null);
  const [deliveryError, setDeliveryError] = useState("");
  useEffect(() => {
    let active = true;
    if (!canSend) return;
    void (async () => {
      if (role === "super_admin") {
        const { data, error } = await getSupabaseClient().rpc("notification_service_status");
        if (error) throw error;
        return data;
      }
      const { data } = await getSupabaseClient().auth.getSession();
      if (!data.session) throw new Error("Sign in again.");
      const response = await fetch("/api/admin/notifications", { headers: { Authorization: `Bearer ${data.session.access_token}` } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      return result;
    })().then(data => { if (active) { setDeliveryService(data); setDeliveryError(""); } }).catch(() => { if (active) setDeliveryError("Notification delivery is unavailable. Refresh and retry."); });
    return () => { active = false; };
  }, [role, canSend]);
  const [members, setMembers] = useState<Member[]>([]);
  const [memberError, setMemberError] = useState("");
  const [membersLoading, setMembersLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const memberRequest = useRef<{ attempt: number; promise: ReturnType<typeof fetchAdminAccounts> } | null>(null);
  useEffect(() => {
    let active = true;
    if (!memberRequest.current || memberRequest.current.attempt !== loadAttempt) {
      memberRequest.current = { attempt: loadAttempt, promise: fetchAdminAccounts() };
    }
    void memberRequest.current.promise.then(({ accounts }) => {
      if (active) setMembers(accounts.filter((account) => account.role === "Member" && account.status === "Active" && account.profileLinked && account.authUserId));
    }).catch(() => {
      if (active) setMemberError("Unable to load member recipients. Check your connection and retry.");
    }).finally(() => { if (active) setMembersLoading(false); });
    return () => { active = false; };
  }, [loadAttempt]);
  const [sendTo, setSendTo] = useState<RecipientTarget>("allMembers");
  const [memberSearch, setMemberSearch] = useState("");
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [selectedType, setSelectedType] = useState("Information");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [delivery, setDelivery] = useState<"now" | "later">("now");
  const [schedule, setSchedule] = useState("");
  const [formError, setFormError] = useState("");
  const [pending, setPending] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const requestPending = useRef(false);

  const matchingMembers = useMemo(() => {
    const query = memberSearch.trim().toLowerCase();
    return query ? members.filter((member) => [member.fullName, member.email, member.idNumber].some((value) => value.toLowerCase().includes(query))).slice(0, 5) : [];
  }, [members, memberSearch]);
  const specific = sendTo === "specificMember";
  const recipientCount = specific ? selectedMember ? 1 : 0 : members.length;
  const recipientSummary = specific ? selectedMember ? selectedMember.fullName : "Choose a member" : "All members";
  const enabled = deliveryService?.delivery_enabled && canSend && !membersLoading && !memberError && recipientCount > 0 &&
    !!title.trim() && !!message.trim() && !pending && !accepted && (delivery === "now" || !!schedule);
  const edited = () => { setAccepted(false); setFormError(""); };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!enabled || requestPending.current) return;
    const scheduledDate = delivery === "later" ? new Date(schedule) : null;
    if (scheduledDate && (!Number.isFinite(scheduledDate.getTime()) || scheduledDate.getTime() <= Date.now())) {
      setFormError("Choose a valid future date and time."); return;
    }
    const payload = {
      title: title.trim(), message: message.trim(), type: selectedType, sendTo,
      recipientSummary: specific ? "1 member" : `${recipientCount} members`,
      recipientCount, scheduledAt: scheduledDate?.toISOString() ?? null,
      memberId: specific ? selectedMember?.idNumber ?? null : null,
      memberName: specific ? selectedMember?.fullName ?? null : null,
      createdAt: new Date().toISOString(),
    };
    requestPending.current = true; setPending(true); setFormError("");
    const finish = () => { requestPending.current = false; setPending(false); };
    beginSecureAction({
      action: scheduledDate ? "schedule-notification" : "send-notification",
      target: specific ? selectedMember!.idNumber : sendTo,
      title: scheduledDate ? "Schedule Member Notification" : "Send Member Notification",
      question: scheduledDate ? `Schedule this notification for ${scheduledDate.toLocaleString("en-PH")}?` : `Send this notification to ${payload.recipientSummary}?`,
      confirmLabel: scheduledDate ? "Schedule Notification" : "Send Now",
      successMessage: "Notification request completed. Check outgoing history for delivery confirmation.",
      payload,
      details: [
        { label: "Title", value: payload.title },
        { label: "Recipients", value: payload.recipientSummary },
        { label: "Type", value: selectedType },
        ...(scheduledDate ? [{ label: "Schedule", value: scheduledDate.toLocaleString("en-PH") }] : []),
      ],
      onSuccess: () => { finish(); setAccepted(true); onRequestCompleted?.(); },
      onFailure: (error) => { finish(); setFormError(error); onRequestCompleted?.(); },
      onCancel: finish,
    });
  };

  return (
    <div className="grid min-w-0 gap-5 min-[75rem]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <form onSubmit={submit} className="ui-card">
        <div className="border-b border-portal-border px-5 py-4"><h2 className="text-card-title">Compose Member Notification</h2><p className="mt-1 text-xs leading-5 text-[#64748B]">Send a message to the member mobile application.</p></div>
        <div className="space-y-4 p-5">
          {deliveryError && <p role="alert" className="text-xs text-red-700">{deliveryError}</p>}
          {memberError && <div role="alert" className="rounded-lg bg-red-50 p-3 text-xs leading-5 text-red-700">{memberError}<button type="button" onClick={() => { setMembersLoading(true); setMemberError(""); setLoadAttempt((value) => value + 1); }} className={`ml-2 ${actionButtonStyles("secondary", "xs")}`}>Retry recipients</button></div>}
          {!canSend && <p className="text-xs text-[#64748B]">Your Super Admin can enable member notifications for your account.</p>}
          <div><label className={label} htmlFor="notification-recipient">Recipients</label><Select id="notification-recipient" value={sendTo} disabled={pending} onChange={(event) => { setSendTo(event.target.value as RecipientTarget); setSelectedMember(null); setMemberSearch(""); edited(); }} className={control}>
            <option value="allMembers">All Members</option><option value="specificMember">Specific Member</option>
            <option value="activeLoanMembers" disabled>Active Loan Members — delivery support unavailable</option><option value="selectedMembers" disabled>Selected Members — delivery support unavailable</option>
          </Select><p className="mt-1.5 text-xs text-[#64748B]">{membersLoading ? "Loading member recipients…" : memberError ? "Recipient count unavailable" : `${recipientCount.toLocaleString()} recipient${recipientCount === 1 ? "" : "s"}`}</p></div>
          {specific && <div><label className={label} htmlFor="specific-member-search">Find a member</label><SearchInput id="specific-member-search" disabled={pending} value={memberSearch} onChange={(event) => { setMemberSearch(event.target.value); setSelectedMember(null); edited(); }} placeholder="Search name, email or Member ID" />
            {selectedMember ? <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-green-200 bg-green-50 p-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-[#145B3C]">{selectedMember.fullName}</p><p className="text-xs text-[#64748B]">{selectedMember.idNumber}</p></div><button type="button" aria-label="Clear selected member" disabled={pending} onClick={() => { setSelectedMember(null); edited(); }}><X className="h-4 w-4" /></button></div>
              : memberSearch && <ul className="mt-2 rounded-lg border border-portal-border">{matchingMembers.length ? matchingMembers.map((member) => <li key={member.accountKey ?? member.idNumber}><button type="button" disabled={pending} onClick={() => { setSelectedMember(member); setMemberSearch(member.fullName); edited(); }} className="w-full px-3 py-2 text-left hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-[#145B3C]"><span className="block text-sm font-medium text-[#17212F]">{member.fullName}</span><span className="block text-xs text-[#64748B]">{member.idNumber}</span></button></li>) : <li className="p-3 text-xs text-[#64748B]">No matching members found.</li>}</ul>}
          </div>}
          <fieldset disabled={pending}><legend className={label}>Notification type</legend><NotificationTypePills selectedType={selectedType} onTypeChange={(type) => { setSelectedType(type); edited(); }} /></fieldset>
          <div><label htmlFor="notification-title" className={label}>Title</label><Input id="notification-title" required maxLength={200} disabled={pending} value={title} onChange={(event) => { setTitle(event.target.value); edited(); }} placeholder="Enter notification title" className={control} /></div>
          <div><label htmlFor="notification-message" className={label}>Message</label><Textarea id="notification-message" required maxLength={10000} rows={4} disabled={pending} value={message} onChange={(event) => { setMessage(event.target.value); edited(); }} placeholder="Write your message to members" className={`${control} min-h-28 resize-y py-2`} /></div>
          <fieldset disabled={pending}><legend className={label}>Delivery</legend><div className="grid grid-cols-1 gap-2 min-[30rem]:grid-cols-2">{(["now", "later"] as const).map((value) => <label key={value} className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-xs font-medium ${delivery === value ? "border-[#145B3C] bg-[#F2F8F5] text-[#145B3C]" : "border-portal-border text-[#64748B]"}`}><input type="radio" disabled={value === "later" && !deliveryService?.scheduling_enabled} name="notification-delivery" value={value} checked={delivery === value} onChange={() => { setDelivery(value); edited(); }} className="accent-[#145B3C]" />{value === "now" ? "Send Now" : deliveryService?.scheduling_enabled ? "Schedule for Later" : "Scheduling unavailable"}</label>)}</div></fieldset>
          {delivery === "later" && <div><label htmlFor="notification-schedule" className={label}>Schedule date and time</label><Input id="notification-schedule" type="datetime-local" required disabled={pending} value={schedule} onChange={(event) => { setSchedule(event.target.value); edited(); }} className={control} /><p className="mt-1.5 text-xs leading-5 text-[#64748B]">Uses your local time. Scheduled delivery requires the notification service scheduler.</p></div>}
          {formError && <p role="alert" className="text-xs leading-5 text-red-700">{formError}</p>}
          {accepted && <p role="status" className="flex items-start gap-2 rounded-lg bg-[#F2F8F5] p-3 text-xs leading-5 text-[#145B3C]"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />The service returned a response. Check outgoing history for delivery confirmation. Your draft is retained; edit it to submit another request.</p>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-portal-border px-5 py-4"><p className="text-[11px] text-[#64748B]">You’ll confirm this request before it is submitted.</p><button type="submit" disabled={!enabled} className="ui-button ui-button--primary">{delivery === "later" ? <CalendarDays className="h-4 w-4" /> : <Send className="h-4 w-4" />}{pending ? "Awaiting verification…" : delivery === "later" ? "Schedule Notification" : "Send Now"}</button></div>
      </form>
      <aside aria-labelledby="mobile-preview-heading" className="ui-card ui-card-padding">
        <div className="flex flex-wrap items-center gap-2"><Smartphone className="h-4 w-4 text-coop-primary" /><h2 id="mobile-preview-heading" className="text-card-title">Mobile App Preview</h2><StatusBadge status="draft" label="Draft" className="ml-auto" /></div>
        <p className="mt-1 text-caption leading-5 text-portal-muted">Updates as you compose. This preview does not send a message.</p>
        <div className="mx-auto mt-6 w-full max-w-[290px] rounded-[28px] border-[6px] border-portal-primary bg-surface-page p-3 pb-8 shadow-sm">
          <div className="mx-auto mb-5 h-1 w-16 rounded-full bg-portal-primary" /><div className="rounded-t-xl bg-coop-dashboard-green px-4 py-4"><p className="text-caption font-bold tracking-[0.12em] text-coop-accent">CSUCC MPC</p><p className="mt-1 text-caption text-white/80">Member Notifications</p></div>
          <div className="min-h-[220px] rounded-b-xl bg-surface-card p-4"><span className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-status-info-surface text-coop-primary"><Bell className="h-4 w-4" /></span><p className="[overflow-wrap:anywhere] text-caption font-semibold uppercase tracking-wide text-coop-primary">{selectedType}</p><p className="mt-2 [overflow-wrap:anywhere] text-sm font-semibold text-portal-primary">{title.trim() || "Notification title"}</p><p className="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere] text-caption leading-6 text-portal-muted">{message.trim() || "Your message preview will appear here."}</p></div>
        </div>
        <div className="mx-auto mt-5 max-w-[290px] space-y-2 text-caption leading-5 text-portal-muted"><p><span className="font-medium text-portal-primary">To:</span> {recipientSummary}</p><p><span className="font-medium text-portal-primary">Delivery:</span> {delivery === "now" ? "Send Now" : schedule && Number.isFinite(Date.parse(schedule)) ? new Date(schedule).toLocaleString("en-PH") : "Choose a schedule"}</p></div>
      </aside>
    </div>
  );
}
