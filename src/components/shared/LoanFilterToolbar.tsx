import { Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Fields";
import { FilterToolbar, SearchInput } from "@/components/ui/FilterToolbar";
import { membershipTypeFilterOptions, type MembershipTypeFilter } from "@/lib/membership";
import { getLoanTypeLabel } from "@/lib/loanTypeLabel";

export interface LoanFilterToolbarProps<Status extends string> {
  searchValue: string;
  searchLabel: string;
  loanTypeFilter: string;
  statusFilter: Status;
  statusOptions: readonly Status[];
  membershipTypeFilter: MembershipTypeFilter;
  loanTypeOptions: string[];
  onSearchChange: (value: string) => void;
  onLoanTypeChange: (value: string) => void;
  onStatusFilterChange: (value: Status) => void;
  onMembershipTypeChange: (value: MembershipTypeFilter) => void;
  onExport: () => void;
  exportDisabled?: boolean;
}

export default function LoanFilterToolbar<Status extends string>({
  searchValue, searchLabel, loanTypeFilter, statusFilter, statusOptions,
  membershipTypeFilter, loanTypeOptions, onSearchChange, onLoanTypeChange,
  onStatusFilterChange, onMembershipTypeChange, onExport, exportDisabled = false,
}: LoanFilterToolbarProps<Status>) {
  return <FilterToolbar>
    <SearchInput aria-label={searchLabel} value={searchValue}
      onChange={event => onSearchChange(event.target.value)} placeholder="Search name or Member ID..." />
    <Select value={statusFilter} onChange={event => onStatusFilterChange(event.target.value as Status)}
      className="w-[130px]" aria-label="Filter by status">
      {statusOptions.map(status => <option key={status} value={status}>{status}</option>)}
    </Select>
    <Select value={loanTypeFilter} onChange={event => onLoanTypeChange(event.target.value)}
      className="w-[180px]" aria-label="Filter by loan type">
      <option value="All Loan Types">All Loan Types</option>
      {loanTypeOptions.map(type => <option key={type} value={type}>{getLoanTypeLabel(type)}</option>)}
    </Select>
    <Select value={membershipTypeFilter} onChange={event => onMembershipTypeChange(event.target.value as MembershipTypeFilter)}
      className="w-[156px]" aria-label="Filter by membership type">
      {membershipTypeFilterOptions.map(type => <option key={type} value={type}>{type}</option>)}
    </Select>
    <Button type="button" disabled={exportDisabled} onClick={onExport}>
      <Download className="h-4 w-4 shrink-0" aria-hidden="true" />Export
    </Button>
  </FilterToolbar>;
}
