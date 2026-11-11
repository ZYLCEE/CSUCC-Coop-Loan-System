"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Fields";
import { PaginationControls } from "@/components/ui/Pagination";
import { FilterToolbar, SearchInput } from "@/components/ui/FilterToolbar";
import {
  memberSortOptions,
  roleFilterOptions,
  statusFilterOptions,
  type MemberRoleFilter,
  type MemberSortOption,
  type MemberStatusFilter,
} from "./MembersData";
import { membershipTypeFilterOptions, type MembershipTypeFilter } from "@/lib/membership";

interface MemberToolbarProps {
  searchValue: string;
  roleFilter: MemberRoleFilter;
  statusFilter: MemberStatusFilter;
  membershipTypeFilter: MembershipTypeFilter;
  readOnly?: boolean;
  onSearchChange: (value: string) => void;
  onRoleFilterChange: (value: MemberRoleFilter) => void;
  onStatusFilterChange: (value: MemberStatusFilter) => void;
  onMembershipTypeFilterChange: (value: MembershipTypeFilter) => void;
  onAddMember: () => void;
}

export default function MemberToolbar({
  searchValue,
  roleFilter,
  statusFilter,
  membershipTypeFilter,
  readOnly = false,
  onSearchChange,
  onRoleFilterChange,
  onStatusFilterChange,
  onMembershipTypeFilterChange,
  onAddMember,
}: MemberToolbarProps) {
  return (
    <FilterToolbar>
      <SearchInput
        aria-label="Search accounts by name, Member ID, email, or department"
        value={searchValue}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder="Search name or Member ID..."
      />

      <Select
        value={roleFilter}
        onChange={(event) => onRoleFilterChange(event.target.value as MemberRoleFilter)}
        className="w-[140px]"
        aria-label="Filter by role"
      >
        {roleFilterOptions.map((role) => (
          <option key={role} value={role}>{role}</option>
        ))}
      </Select>

      <Select
        value={statusFilter}
        onChange={(event) => onStatusFilterChange(event.target.value as MemberStatusFilter)}
        className="w-[130px]"
        aria-label="Filter by status"
      >
        {statusFilterOptions.map((status) => (
          <option key={status} value={status}>{status}</option>
        ))}
      </Select>

      <Select
        value={membershipTypeFilter}
        onChange={(event) => onMembershipTypeFilterChange(event.target.value as MembershipTypeFilter)}
        className="w-[156px]"
        aria-label="Filter by membership type"
      >
        {membershipTypeFilterOptions.map((membershipType) => (
          <option key={membershipType} value={membershipType}>{membershipType}</option>
        ))}
      </Select>

      {!readOnly && (
        <Button
          type="button"
          variant="primary"
          onClick={onAddMember}
        >
          <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
          Create Account
        </Button>
      )}
    </FilterToolbar>
  );
}

export function MemberPaginationControls({
  sortOption,
  pageSize,
  onSortChange,
  onPageSizeChange,
}: {
  sortOption: MemberSortOption;
  pageSize: number;
  onSortChange: (value: MemberSortOption) => void;
  onPageSizeChange: (value: number) => void;
}) {
  return <PaginationControls sortOption={sortOption} pageSize={pageSize} sortOptions={memberSortOptions}
    onSortChange={onSortChange} onPageSizeChange={onPageSizeChange}
    sortLabel="Sort members" pageSizeLabel="Members per page" />;
}
