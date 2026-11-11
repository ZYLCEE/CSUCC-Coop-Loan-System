"use client";
import PortalPageHeading from "@/components/shared/PortalPageHeading";

import { actionButtonStyles } from "@/components/shared/actionButtonStyles";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Ban, KeyRound, Trash2, Unlock, UserRoundPen, UserRoundPlus } from "lucide-react";
import MemberToolbar, { MemberPaginationControls } from "@/components/members/MemberToolbar";
import MembersTable from "@/components/members/MembersTable";
import { Card } from "@/components/ui/Card";
import { LoadingState } from "@/components/ui/Feedback";
import { Pagination } from "@/components/ui/Pagination";
import MemberDetailsModal from "@/components/members/MemberDetailsModal";
import MemberFormModal from "@/components/members/MemberFormModal";
import ResetPasswordModal from "@/components/members/ResetPasswordModal";
import AccountPrivilegesDialog from "@/components/members/AccountPrivilegesDialog";
import AccountActionReasonDialog from "@/components/members/AccountActionReasonDialog";
import type { ReasonedAccountAction } from "@/lib/accountActionReasons";
import {
  Member,
  MemberRoleFilter,
  MemberSortOption,
  MemberStatusFilter,
} from "@/components/members/MembersData";
import {
  MembershipTypeFilter,
  getMembershipTypeLabel,
  normalizeMembershipMemberId,
} from "@/lib/membership";
import { AdminAccountLoadError, fetchAdminAccounts } from "@/lib/adminAccounts";
import { useSecureAdminAction } from "@/components/auth/SecureAdminActionProvider";
import { useAdminAuth } from "@/components/auth/AdminAuthProvider";

interface MemberFilters {
  search: string;
  role: MemberRoleFilter;
  status: MemberStatusFilter;
  membershipType: MembershipTypeFilter;
}

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersError, setMembersError] = useState("");
  const [sessionExpired, setSessionExpired] = useState(false);
  const [dataIntegrityIssues, setDataIntegrityIssues] = useState(0);
  const [filters, setFilters] = useState<MemberFilters>({
    search: "",
    role: "All Roles",
    status: "All Status",
    membershipType: "All Members",
  });
  const [pageSize, setPageSize] = useState(10);
  const [sortOption, setSortOption] = useState<MemberSortOption>("Newest");
  const [currentPage, setCurrentPage] = useState(1);
  const [viewedMember, setViewedMember] = useState<Member | null>(null);
  const [resetMember, setResetMember] = useState<Member | null>(null);
  const [privilegeMember, setPrivilegeMember] = useState<Member | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const resetting = useRef(false);
  const [accountDecision, setAccountDecision] = useState<{ member: Member; action: ReasonedAccountAction } | null>(null);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const deciding = useRef(false);
  const [formBusy, setFormBusy] = useState(false);
  const saving = useRef(false);
  const [memberForm, setMemberForm] = useState<{
    mode: "add" | "edit";
    member: Member | null;
  } | null>(null);
  const { beginSecureAction } = useSecureAdminAction();
  const { role } = useAdminAuth();
  const readOnly = role !== "super_admin";

  const loadMembers = useCallback(async () => {
    setMembersLoading(true);
    setMembersError("");
    setSessionExpired(false);
    try {
      const result = await fetchAdminAccounts();
      setMembers(result.accounts);
      setDataIntegrityIssues(result.dataIntegrityIssues);
    } catch (error) {
      setMembers([]);
      setDataIntegrityIssues(0);
      setSessionExpired(error instanceof AdminAccountLoadError && error.code === "session_expired");
      setMembersError(
        error instanceof Error
          ? error.message
          : "The secure account service could not load accounts. Retry or contact the system administrator."
      );
    } finally {
      setMembersLoading(false);
    }
  }, []);

  const refreshMembers = () => {
    setMembersLoading(true);
    setMembersError("");
    void loadMembers();
  };

  useEffect(() => {
    let isActive = true;
    void fetchAdminAccounts()
      .then((data) => {
        if (isActive) {
          setMembers(data.accounts);
          setDataIntegrityIssues(data.dataIntegrityIssues);
          setMembersError("");
        }
      })
      .catch((error: unknown) => {
        if (isActive) {
          setMembers([]);
          setDataIntegrityIssues(0);
          setSessionExpired(error instanceof AdminAccountLoadError && error.code === "session_expired");
          setMembersError(
            error instanceof Error
              ? error.message
              : "The secure account service could not load accounts. Retry or contact the system administrator."
          );
        }
      })
      .finally(() => {
        if (isActive) setMembersLoading(false);
      });
    return () => {
      isActive = false;
    };
  }, []);

  const filteredMembers = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    const memberIdSearch = normalizeMembershipMemberId(search);

    return members.filter((member) => {
      const searchableText = [
        member.fullName,
        member.email,
        member.department,
        member.idNumber,
      ]
        .join(" ")
        .toLowerCase();

      const matchesSearch = searchableText.includes(search) ||
        (memberIdSearch !== "" && normalizeMembershipMemberId(member.idNumber).includes(memberIdSearch));
      const matchesRole =
        filters.role === "All Roles" || member.role === filters.role;
      const matchesStatus =
        filters.status === "All Status" || member.status === filters.status;
      const matchesMembershipType =
        filters.membershipType === "All Members" ||
        member.membershipType ===
          (filters.membershipType === "Regular Member" ? "regular" : "associate");

      return (
        matchesSearch &&
        matchesRole &&
        matchesStatus &&
        matchesMembershipType
      );
    });
  }, [members, filters]);

  const sortedMembers = useMemo(() => {
    return [...filteredMembers].sort((firstMember, secondMember) => {
      if (sortOption === "Name A-Z") {
        return firstMember.fullName.localeCompare(secondMember.fullName);
      }

      if (sortOption === "Name Z-A") {
        return secondMember.fullName.localeCompare(firstMember.fullName);
      }

      const firstDate = Date.parse(firstMember.createdAt);
      const secondDate = Date.parse(secondMember.createdAt);
      const firstTimestamp = Number.isNaN(firstDate) ? 0 : firstDate;
      const secondTimestamp = Number.isNaN(secondDate) ? 0 : secondDate;

      return sortOption === "Newest"
        ? secondTimestamp - firstTimestamp
        : firstTimestamp - secondTimestamp;
    });
  }, [filteredMembers, sortOption]);

  const totalPages = Math.max(1, Math.ceil(sortedMembers.length / pageSize));
  const activePage = Math.min(currentPage, totalPages);
  const pageStartIndex = (activePage - 1) * pageSize;
  const paginatedMembers = sortedMembers.slice(
    pageStartIndex,
    pageStartIndex + pageSize
  );
  const showingFrom = sortedMembers.length === 0 ? 0 : pageStartIndex + 1;
  const showingTo = Math.min(pageStartIndex + pageSize, sortedMembers.length);
  const updateFilters = (changes: Partial<MemberFilters>) => {
    setFilters((current) => ({ ...current, ...changes }));
    setCurrentPage(1);
  };

  const updateSortOption = (sort: MemberSortOption) => {
    setSortOption(sort);
    setCurrentPage(1);
  };

  const updatePageSize = (size: number) => {
    setPageSize(size);
    setCurrentPage(1);
  };

  const toggleMemberBlockStatus = (member: Member) => {
    if (readOnly) return;
    const isBlocked = member.status === "Blocked";
    if (!isBlocked) { setAccountDecision({ member, action: "block-account" }); return; }
    beginSecureAction({
      action: isBlocked ? "unblock-account" : "block-account",
      target: member.idNumber,
      title: isBlocked ? "Unblock Account" : "Block Account",
      icon: Unlock,
      securityTitle: "Verify Account Unblock",
      securityDescription: "Enter your Super Admin password to continue unblocking this account.",
      securityDetails: [{ label: "Account", value: member.fullName }, { label: "ID Number", value: member.idNumber }],
      question: `Are you sure you want to ${isBlocked ? "unblock" : "block"} ${member.fullName}'s account?`,
      confirmLabel: isBlocked ? "Unblock Account" : "Block Account",
      successMessage: `Account ${isBlocked ? "unblocked" : "blocked"} successfully.`,
      payload: {},
      details: [
        { label: "Full Name", value: member.fullName },
        { label: "ID Number", value: member.idNumber },
      ],
      onSuccess: () => {
        refreshMembers();
      },
    });
  };

  const deleteMember = (member: Member) => {
    if (!readOnly) setAccountDecision({ member, action: "delete-account" });
  };

  const submitAccountDecision = (reason: string) => {
    if (!accountDecision || readOnly || deciding.current) return;
    const { member, action } = accountDecision;
    const deleting = action === "delete-account";
    deciding.current = true; setDecisionBusy(true);
    const unlock = () => { deciding.current = false; setDecisionBusy(false); };
    beginSecureAction({
      action,
      target: member.idNumber,
      title: deleting ? "Delete Account" : "Block Account",
      icon: deleting ? Trash2 : Ban,
      securityTitle: deleting ? "Verify Account Deletion" : "Verify Account Block",
      securityDescription: `Enter your Super Admin password to continue ${deleting ? "deleting" : "blocking"} this account.`,
      securityDetails: [{ label: "Account", value: member.fullName }, { label: "ID Number", value: member.idNumber }],
      question: deleting ? `Permanently delete ${member.fullName}'s sign-in account?` : `Block ${member.fullName}'s account? They will no longer be able to access the system.`,
      confirmLabel: deleting ? "Delete Account" : "Block Account",
      successMessage: deleting ? "Account deleted successfully." : "Account blocked successfully.",
      payload: { reason },
      details: [
        { label: "Full Name", value: member.fullName },
        { label: "ID Number", value: member.idNumber },
        { label: "Reason", value: reason },
      ],
      onCancel: unlock,
      onFailure: unlock,
      onSuccess: () => {
        unlock(); setAccountDecision(null);
        if (deleting) setCurrentPage(1);
        refreshMembers();
      },
    });
  };

  const resetPassword = (temporaryPassword: string) => {
    if (!resetMember || readOnly || resetting.current) return;
    resetting.current = true; setResetBusy(true);
    const unlock = () => { resetting.current = false; setResetBusy(false); };
    beginSecureAction({
      action: "reset-account-password", target: resetMember.idNumber,
      title: "Reset Account Password", question: `Reset the password for ${resetMember.fullName}? They must change the temporary password on their next sign-in.`,
      icon: KeyRound,
      securityTitle: "Verify Password Reset",
      securityDescription: "Enter your Super Admin password to continue resetting this account’s password.",
      securityDetails: [{ label: "Account", value: resetMember.fullName }, { label: "ID Number", value: resetMember.idNumber }],
      confirmLabel: "Reset Password", successMessage: "Account password reset successfully.",
      payload: {}, secret: { temporaryPassword },
      details: [{ label: "Account", value: resetMember.fullName }, { label: "ID Number", value: resetMember.idNumber }, { label: "Role", value: resetMember.role }],
      onCancel: unlock, onFailure: unlock,
      onSuccess: () => { unlock(); setResetMember(null); refreshMembers(); },
    });
  };

  const saveMember = (member: Member, temporaryPassword?: string) => {
    if (readOnly || saving.current) return;
    saving.current = true; setFormBusy(true);
    const unlock = () => { saving.current = false; setFormBusy(false); };
    const isEdit = memberForm?.mode === "edit" && Boolean(memberForm.member);
    const action = isEdit ? "edit-account" : "create-account";
    const target = isEdit
      ? memberForm?.member?.idNumber ?? member.idNumber
      : "new-account";
    const payload = {
      fullName: member.fullName,
      email: member.email,
      phone: member.phone,
      address: member.address,
      role: member.role,
      membershipType:
        member.role === "Member" ? member.membershipType : null,
      department: member.department,
      identityVerified: !isEdit,
    };

    beginSecureAction({
      action,
      target,
      title: isEdit ? "Save Account Changes" : "Create Account",
      icon: isEdit ? UserRoundPen : UserRoundPlus,
      securityTitle: isEdit ? "Verify Account Changes" : "Verify Account Creation",
      securityDescription: `Enter your Super Admin password to continue ${isEdit ? "saving these account changes" : "creating this account"}.`,
      securityDetails: [{ label: "Account", value: member.fullName }, ...(isEdit ? [{ label: "ID Number", value: member.idNumber }] : []), { label: "Role", value: member.role }],
      question: isEdit
        ? `Are you sure you want to save changes to ${member.fullName}'s account?`
        : `Are you sure you want to create a ${member.role} account for ${member.fullName}?`,
      confirmLabel: isEdit ? "Save Changes" : "Create Account",
      successMessage: isEdit
        ? "Account updated successfully."
        : `${member.role} account created successfully.`,
      payload,
      secret:
        !isEdit && temporaryPassword
          ? { temporaryPassword }
          : undefined,
      details: [
        { label: "Full Name", value: member.fullName },
        { label: "Email", value: member.email },
        { label: "Contact Number", value: member.phone ?? "" },
        { label: "Address", value: member.address ?? "" },
        { label: "Role", value: member.role },
        ...(member.role === "Member"
          ? [
              {
                label: "Membership Type",
                value: getMembershipTypeLabel(member.membershipType ?? null),
              },
            ]
          : []),
      ],
      onCancel: unlock,
      onFailure: unlock,
      onSuccess: () => {
        unlock();
        setMemberForm(null);
        setCurrentPage(1);
        refreshMembers();
      },
    });
  };

  return (
    <>
      <Card padded={false} className="overflow-hidden">
        <PortalPageHeading section="all-accounts" />
        <MemberToolbar
          searchValue={filters.search}
          roleFilter={filters.role}
          statusFilter={filters.status}
          membershipTypeFilter={filters.membershipType}
          readOnly={readOnly}
          onSearchChange={(search) => updateFilters({ search })}
          onRoleFilterChange={(role) => updateFilters({ role })}
          onStatusFilterChange={(status) => updateFilters({ status })}
          onMembershipTypeFilterChange={(membershipType) => updateFilters({ membershipType })}
          onAddMember={() => setMemberForm({ mode: "add", member: null })}
        />

        {membersError ? (
          <div role="alert" className="border-t border-portal-border px-4 py-8 text-center text-sm font-medium text-status-danger">
            {membersError}
            {sessionExpired && <Link href="/login" className={`ml-2 ${actionButtonStyles()}`}>Sign in again</Link>}
            <button
              type="button"
              onClick={refreshMembers}
              className={`ml-2 ${actionButtonStyles()}`}
            >
              Retry
            </button>
          </div>
        ) : membersLoading ? (
          <LoadingState label="Loading accounts..." />
        ) : (
          <>
            {dataIntegrityIssues > 0 && (
              <div
                className="border-t border-[#FDE68A] bg-[#FFFBEB] px-6 py-3 text-[13px] text-[#92400E]"
                role="status"
              >
                {dataIntegrityIssues} account
                {dataIntegrityIssues === 1 ? " has" : "s have"} incomplete or
                unlinked profile data. Review rows marked with a data-integrity
                notice; missing information is not inferred.
              </div>
            )}
            <MembersTable
              members={paginatedMembers}
              readOnly={readOnly}
              onViewMember={setViewedMember}
              onEditMember={(member) => setMemberForm({ mode: "edit", member })}
              onToggleBlockStatus={toggleMemberBlockStatus}
              onDeleteMember={deleteMember}
              onResetPassword={setResetMember}
              onManagePrivileges={setPrivilegeMember}
            />
            <Pagination
              currentPage={activePage}
              totalPages={totalPages}
              totalItems={sortedMembers.length}
              itemLabel="accounts"
              showingFrom={showingFrom}
              showingTo={showingTo}
              onPageChange={setCurrentPage}
              showStepButtons
              controls={
                <MemberPaginationControls
                  sortOption={sortOption}
                  pageSize={pageSize}
                  onSortChange={updateSortOption}
                  onPageSizeChange={updatePageSize}
                />
              }
            />
          </>
        )}
      </Card>

      <MemberDetailsModal
        member={viewedMember}
        onClose={() => setViewedMember(null)}
      />
      {resetMember && <ResetPasswordModal key={resetMember.accountKey ?? resetMember.idNumber} member={resetMember} busy={resetBusy} onClose={() => setResetMember(null)} onSubmit={resetPassword} />}
      {privilegeMember && <AccountPrivilegesDialog key={privilegeMember.accountKey ?? privilegeMember.idNumber} member={privilegeMember} onClose={() => setPrivilegeMember(null)} />}
      {accountDecision && <AccountActionReasonDialog key={`${accountDecision.action}-${accountDecision.member.accountKey ?? accountDecision.member.idNumber}`} member={accountDecision.member} action={accountDecision.action} busy={decisionBusy} onClose={() => setAccountDecision(null)} onContinue={submitAccountDecision} />}

      {memberForm && (
        <MemberFormModal
          key={`${memberForm.mode}-${memberForm.member?.idNumber ?? "new"}`}
          mode={memberForm.mode}
          member={memberForm.member}
          busy={formBusy}
          onClose={() => setMemberForm(null)}
          onSubmit={saveMember}
        />
      )}

    </>
  );
}
