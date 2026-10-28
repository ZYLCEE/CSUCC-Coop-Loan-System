"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, CalendarDays, CheckCircle2, Search, Send, Smartphone, X } from "lucide-react";
import type { Member } from "@/components/members/MembersData";
import { fetchAdminAccounts } from "@/lib/adminAccounts";
import { useSecureAdminAction } from "@/components/auth/SecureAdminActionProvider";
import { useAdminAuth } from "@/components/auth/AdminAuthProvider";
import NotificationTypePills from "./NotificationTypePills";

type RecipientTarget = "allMembers" | "activeLoanMembers" | "specificMember" | "selectedMembers";
const control = "w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#17212F] outline-none focus:border-[#145B3C] focus:ring-2 focus:ring-[#145B3C]/15";
const label = "mb-1.5 block text-xs font-semibold text-[#334155]";

export default function SendNotificationCard({ onRequestCompleted }: { onRequestCompleted?: () => void }) {
  const { role } = useAdminAuth();
  const { beginSecureAction } = useSecureAdminAction();
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
      if (active) setMembers(accounts.filter((account) => account.role === "Member" && account.profileLinked && account.authUserId));
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
  const enabled = role === "super_admin" && !membersLoading && !memberError && recipientCount > 0 &&
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
      <form onSubmit={submit} className="min-w-0 rounded-[14px] border border-[#E2E8F0] bg-white shadow-sm">
        <div className="border-b border-[#E2E8F0] px-5 py-4"><h2 className="text-base font-semibold text-[#17212F]">Compose Member Notification</h2><p className="mt-1 text-xs leading-5 text-[#64748B]">Send a message to the member mobile application.</p></div>
        <div className="space-y-4 p-5">
          {memberError && <div role="alert" className="rounded-lg bg-red-50 p-3 text-xs leading-5 text-red-700">{memberError}<button type="button" onClick={() => { setMembersLoading(true); setMemberError(""); setLoadAttempt((value) => value + 1); }} className="ml-2 font-semibold underline">Retry recipients</button></div>}
          {role !== "super_admin" && <p className="text-xs text-[#64748B]">Sending and scheduling require the existing Super Admin permission.</p>}
          <div><label className={label} htmlFor="notification-recipient">Recipients</label><select id="notification-recipient" value={sendTo} disabled={pending} onChange={(event) => { setSendTo(event.target.value as RecipientTarget); setSelectedMember(null); setMemberSearch(""); edited(); }} className={`${control} h-10`}>
            <option value="allMembers">All Members</option><option value="specificMember">Specific Member</option>
            <option value="activeLoanMembers" disabled>Active Loan Members — delivery support unavailable</option><option value="selectedMembers" disabled>Selected Members — delivery support unavailable</option>
          </select><p className="mt-1.5 text-xs text-[#64748B]">{membersLoading ? "Loading member recipients…" : memberError ? "Recipient count unavailable" : `${recipientCount.toLocaleString()} recipient${recipientCount === 1 ? "" : "s"}`}</p></div>
          {specific && <div><label className={label} htmlFor="specific-member-search">Find a member</label><div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" aria-hidden="true" /><input id="specific-member-search" type="search" disabled={pending} value={memberSearch} onChange={(event) => { setMemberSearch(event.target.value); setSelectedMember(null); edited(); }} placeholder="Search name, email or Member ID" className={`${control} h-10 pl-9`} /></div>
            {selectedMember ? <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-green-200 bg-green-50 p-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-[#145B3C]">{selectedMember.fullName}</p><p className="text-xs text-[#64748B]">{selectedMember.idNumber}</p></div><button type="button" aria-label="Clear selected member" disabled={pending} onClick={() => { setSelectedMember(null); edited(); }}><X className="h-4 w-4" /></button></div>
              : memberSearch && <ul className="mt-2 rounded-lg border border-[#E2E8F0]">{matchingMembers.length ? matchingMembers.map((member) => <li key={member.accountKey ?? member.idNumber}><button type="button" disabled={pending} onClick={() => { setSelectedMember(member); setMemberSearch(member.fullName); edited(); }} className="w-full px-3 py-2 text-left hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-[#145B3C]"><span className="block text-sm font-medium text-[#17212F]">{member.fullName}</span><span className="block text-xs text-[#64748B]">{member.idNumber}</span></button></li>) : <li className="p-3 text-xs text-[#64748B]">No matching members found.</li>}</ul>}
          </div>}
          <fieldset disabled={pending}><legend className={label}>Notification type</legend><NotificationTypePills selectedType={selectedType} onTypeChange={(type) => { setSelectedType(type); edited(); }} /></fieldset>
          <div><label htmlFor="notification-title" className={label}>Title</label><input id="notification-title" required maxLength={200} disabled={pending} value={title} onChange={(event) => { setTitle(event.target.value); edited(); }} placeholder="Enter notification title" className={`${control} h-10`} /></div>
          <div><label htmlFor="notification-message" className={label}>Message</label><textarea id="notification-message" required rows={4} disabled={pending} value={message} onChange={(event) => { setMessage(event.target.value); edited(); }} placeholder="Write your message to members" className={`${control} min-h-28 resize-y py-2`} /></div>
          <fieldset disabled={pending}><legend className={label}>Delivery</legend><div className="grid grid-cols-1 gap-2 min-[30rem]:grid-cols-2">{(["now", "later"] as const).map((value) => <label key={value} className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-xs font-medium ${delivery === value ? "border-[#145B3C] bg-[#F2F8F5] text-[#145B3C]" : "border-[#E2E8F0] text-[#64748B]"}`}><input type="radio" name="notification-delivery" value={value} checked={delivery === value} onChange={() => { setDelivery(value); edited(); }} className="accent-[#145B3C]" />{value === "now" ? "Send Now" : "Schedule for Later"}</label>)}</div></fieldset>
          {delivery === "later" && <div><label htmlFor="notification-schedule" className={label}>Schedule date and time</label><input id="notification-schedule" type="datetime-local" required disabled={pending} value={schedule} onChange={(event) => { setSchedule(event.target.value); edited(); }} className={`${control} h-10`} /><p className="mt-1.5 text-xs leading-5 text-[#64748B]">Uses your local time. Scheduled delivery requires the notification service scheduler.</p></div>}
          {formError && <p role="alert" className="text-xs leading-5 text-red-700">{formError}</p>}
          {accepted && <p role="status" className="flex items-start gap-2 rounded-lg bg-[#F2F8F5] p-3 text-xs leading-5 text-[#145B3C]"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />The service returned a response. Check outgoing history for delivery confirmation. Your draft is retained; edit it to submit another request.</p>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E2E8F0] px-5 py-4"><p className="text-[11px] text-[#64748B]">You’ll confirm this request before it is submitted.</p><button type="submit" disabled={!enabled} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#145B3C] px-4 text-sm font-semibold text-white hover:bg-[#104A31] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145B3C] disabled:cursor-not-allowed disabled:opacity-40">{delivery === "later" ? <CalendarDays className="h-4 w-4" /> : <Send className="h-4 w-4" />}{pending ? "Awaiting verification…" : delivery === "later" ? "Schedule Notification" : "Send Now"}</button></div>
      </form>
      <aside aria-labelledby="mobile-preview-heading" className="min-w-0 rounded-[14px] border border-[#E2E8F0] bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2"><Smartphone className="h-4 w-4 text-[#145B3C]" /><h2 id="mobile-preview-heading" className="text-base font-semibold text-[#17212F]">Mobile App Preview</h2><span className="ml-auto rounded-full bg-slate-100 px-2 py-1 text-[10px] font-medium text-[#64748B]">Draft</span></div>
        <p className="mt-1 text-xs leading-5 text-[#64748B]">Updates as you compose. This preview does not send a message.</p>
        <div className="mx-auto mt-6 w-full max-w-[290px] rounded-[28px] border-[6px] border-[#17212F] bg-[#F4F6F8] p-3 pb-8 shadow-sm">
          <div className="mx-auto mb-5 h-1 w-16 rounded-full bg-[#17212F]" /><div className="rounded-t-xl bg-[#145B3C] px-4 py-4"><p className="text-xs font-bold tracking-[0.12em] text-[#E7C84B]">CSUCC MPC</p><p className="mt-1 text-[10px] text-white/80">Member Notifications</p></div>
          <div className="min-h-[220px] rounded-b-xl bg-white p-4"><span className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#E7F0EB] text-[#145B3C]"><Bell className="h-4 w-4" /></span><p className="break-words text-[10px] font-semibold uppercase tracking-wide text-[#145B3C]">{selectedType}</p><p className="mt-2 break-words text-sm font-semibold text-[#17212F]">{title.trim() || "Notification title"}</p><p className="mt-2 whitespace-pre-wrap break-words text-xs leading-6 text-[#64748B]">{message.trim() || "Your message preview will appear here."}</p></div>
        </div>
        <div className="mx-auto mt-5 max-w-[290px] space-y-2 text-xs leading-5 text-[#64748B]"><p><span className="font-medium text-[#334155]">To:</span> {recipientSummary}</p><p><span className="font-medium text-[#334155]">Delivery:</span> {delivery === "now" ? "Send Now" : schedule && Number.isFinite(Date.parse(schedule)) ? new Date(schedule).toLocaleString("en-PH") : "Choose a schedule"}</p></div>
      </aside>
    </div>
  );
}
