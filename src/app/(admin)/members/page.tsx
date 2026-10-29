"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import MemberToolbar from "@/components/members/MemberToolbar";
import MembersTable from "@/components/members/MembersTable";
import MemberDetailsModal from "@/components/members/MemberDetailsModal";
import MemberFormModal from "@/components/members/MemberFormModal";
import {
  Member,
  MemberRoleFilter,
  MemberSortOption,
  MemberStatusFilter,
} from "@/components/members/MembersData";
import {
  MembershipTypeFilter,
  getMembershipTypeLabel,
} from "@/lib/membership";
import { AdminAccountLoadError, fetchAdminAccounts } from "@/lib/adminAccounts";
import { useSecureAdminAction } from "@/components/auth/SecureAdminActionProvider";
import { useAdminAuth } from "@/components/auth/AdminAuthProvider";

interface AppliedFilters {
  search: string;
  memberId: string;
  role: MemberRoleFilter;
  status: MemberStatusFilter;
  membershipType: MembershipTypeFilter;
}

const normalizeFilterValue = (value: string) => value.trim().toLowerCase();

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersError, setMembersError] = useState("");
  const [sessionExpired, setSessionExpired] = useState(false);
  const [dataIntegrityIssues, setDataIntegrityIssues] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [memberIdInput, setMemberIdInput] = useState("");
  const [filters, setFilters] = useState<AppliedFilters>({
    search: "",
    memberId: "",
    role: "All Roles",
    status: "All Status",
    membershipType: "All Members",
  });
  const [pageSize, setPageSize] = useState(10);
  const [sortOption, setSortOption] = useState<MemberSortOption>("Newest");
  const [currentPage, setCurrentPage] = useState(1);
  const [viewedMember, setViewedMember] = useState<Member | null>(null);
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
    const search = normalizeFilterValue(filters.search);
    const memberId = normalizeFilterValue(filters.memberId);

    return members.filter((member) => {
      const searchableText = [
        member.fullName,
        member.email,
        member.department,
      ]
        .join(" ")
        .toLowerCase();

      const matchesSearch = search === "" || searchableText.includes(search);
      const matchesMemberId =
        memberId === "" || member.idNumber.toLowerCase().includes(memberId);
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
        matchesMemberId &&
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
  const showClearButton =
    filters.search.trim() !== "" ||
    filters.memberId.trim() !== "" ||
    filters.role !== "All Roles" ||
    filters.status !== "All Status" ||
    filters.membershipType !== "All Members";

  const applyTextFilters = () => {
    setFilters((current) => ({
      ...current,
      search: searchInput,
      memberId: memberIdInput,
    }));
    setCurrentPage(1);
  };

  const updateRoleFilter = (role: MemberRoleFilter) => {
    setFilters((current) => ({ ...current, role }));
    setCurrentPage(1);
  };

  const updateStatusFilter = (status: MemberStatusFilter) => {
    setFilters((current) => ({ ...current, status }));
    setCurrentPage(1);
  };

  const updateMembershipTypeFilter = (membershipType: MembershipTypeFilter) => {
    setFilters((current) => ({ ...current, membershipType }));
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

  const clearMemberControls = () => {
    setSearchInput("");
    setMemberIdInput("");
    setFilters({
      search: "",
      memberId: "",
      role: "All Roles",
      status: "All Status",
      membershipType: "All Members",
    });
    setSortOption("Newest");
    setCurrentPage(1);
  };

  const toggleMemberBlockStatus = (member: Member) => {
    const isBlocked = member.status === "Blocked";
    beginSecureAction({
      action: isBlocked ? "unblock-account" : "block-account",
      target: member.idNumber,
      title: isBlocked ? "Unblock Account" : "Block Account",
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
    beginSecureAction({
      action: "delete-account",
      target: member.idNumber,
      title: "Delete Account",
      question: `Are you sure you want to permanently delete ${member.fullName}'s account?`,
      confirmLabel: "Delete Account",
      successMessage: "Account deleted successfully.",
      payload: {},
      details: [
        { label: "Full Name", value: member.fullName },
        { label: "ID Number", value: member.idNumber },
      ],
      onSuccess: () => {
        setCurrentPage(1);
        refreshMembers();
      },
    });
  };

  const saveMember = (member: Member, temporaryPassword?: string) => {
    const isEdit = memberForm?.mode === "edit" && Boolean(memberForm.member);
    const action = isEdit ? "edit-account" : "create-account";
    const target = isEdit
      ? memberForm?.member?.idNumber ?? member.idNumber
      : "new-account";
    const payload = {
      fullName: member.fullName,
      email: member.email,
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
      question: isEdit
        ? `Are you sure you want to save changes to ${member.fullName}'s account?`
        : `Are you sure you want to create this account for ${member.fullName}?`,
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
      onSuccess: () => {
        setMemberForm(null);
        setCurrentPage(1);
        refreshMembers();
      },
    });
  };

  return (
    <>
      <div className="overflow-hidden rounded-[8px] border border-[#E1E7EF] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.08)]">
        <MemberToolbar
          searchValue={searchInput}
          memberIdValue={memberIdInput}
          roleFilter={filters.role}
          statusFilter={filters.status}
          membershipTypeFilter={filters.membershipType}
          sortOption={sortOption}
          pageSize={pageSize}
          showClear={showClearButton}
          readOnly={readOnly}
          onSearchChange={setSearchInput}
          onMemberIdChange={setMemberIdInput}
          onApplyFilters={applyTextFilters}
          onClearFilters={clearMemberControls}
          onRoleFilterChange={updateRoleFilter}
          onStatusFilterChange={updateStatusFilter}
          onMembershipTypeFilterChange={updateMembershipTypeFilter}
          onSortChange={updateSortOption}
          onPageSizeChange={updatePageSize}
          onAddMember={() => setMemberForm({ mode: "add", member: null })}
        />

        {membersError ? (
          <div role="alert" className="border-t border-[#E5E7EB] px-4 py-8 text-center text-sm font-medium text-[#B91C1C]">
            {membersError}
            {sessionExpired && <Link href="/login" className="ml-2 font-semibold underline">Sign in again</Link>}
            <button
              type="button"
              onClick={refreshMembers}
              className="ml-2 font-semibold underline"
            >
              Retry
            </button>
          </div>
        ) : membersLoading ? (
          <div className="border-t border-[#E5E7EB] px-4 py-10 text-center text-sm font-medium text-[#64748B]">
            Loading accounts...
          </div>
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
              currentPage={activePage}
              totalPages={totalPages}
              totalItems={sortedMembers.length}
              showingFrom={showingFrom}
              showingTo={showingTo}
              readOnly={readOnly}
              onPageChange={setCurrentPage}
              onViewMember={setViewedMember}
              onEditMember={(member) => setMemberForm({ mode: "edit", member })}
              onToggleBlockStatus={toggleMemberBlockStatus}
              onDeleteMember={deleteMember}
            />
          </>
        )}
      </div>

      <MemberDetailsModal
        member={viewedMember}
        onClose={() => setViewedMember(null)}
      />

      {memberForm && (
        <MemberFormModal
          key={`${memberForm.mode}-${memberForm.member?.idNumber ?? "new"}`}
          mode={memberForm.mode}
          member={memberForm.member}
          onClose={() => setMemberForm(null)}
          onSubmit={saveMember}
        />
      )}

    </>
  );
}
