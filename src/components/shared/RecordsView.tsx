"use client";
import PortalPageHeading from "@/components/shared/PortalPageHeading";
import RecordActionsMenu from "@/components/shared/RecordActionsMenu";
import ActiveLoansWorkspace from "@/components/active-loans/ActiveLoansWorkspace";
import { useCallback, useEffect, useMemo, useState } from 'react';
import { adminRequest } from '@/lib/adminRequest';
import LoanDetailsModal from '@/components/loan-applications/LoanDetailsModal';
import CounterPaymentDialog from '@/components/active-loans/CounterPaymentDialog';
import { useAdminAuth } from '@/components/auth/AdminAuthProvider';
import { exportCsv } from '@/lib/download';
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { DetailDialog } from "@/components/ui/DetailDialog";
import { EmptyState, LoadingState } from "@/components/ui/Feedback";
import { Input } from "@/components/ui/Fields";
import { FilterToolbar, SearchInput } from "@/components/ui/FilterToolbar";
import { Pagination, PaginationControls } from "@/components/ui/Pagination";
import { sortRowsByDate, type DateSortOrder } from "@/lib/tablePagination";
import { StatusBadge } from "@/components/ui/StatusBadge";

const numericColumns = ["amount", "monthly_payment"];
const columnAlignment = (key: string) =>
  numericColumns.includes(key) ? "text-right tabular-nums" : key === "status" ? "text-center" : "";

export default function RecordsView(props: { resource: string; title: string }) {
  return props.resource === "active" ? <ActiveLoansWorkspace /> : <RecordsTable {...props} />;
}

function RecordsTable({ resource, title }: { resource: string; title: string }) {
  const { role } = useAdminAuth();
  const [paymentLoan, setPaymentLoan] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [query, setQuery] = useState('');
  const [date, setDate] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [sortOrder, setSortOrder] = useState<DateSortOrder>("Newest");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setRows(await adminRequest(resource)); } catch (error) { setError(error instanceof Error ? error.message : 'Loading failed.'); }
    finally { setLoading(false); }
  }, [resource]);
  useEffect(() => { let active = true; void adminRequest(resource).then(data => { if (active) setRows(data); }).catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [resource]);
  const filtered = useMemo(() => sortRowsByDate(rows.filter(row => JSON.stringify(row).toLowerCase().includes(query.toLowerCase()) && (!date || String((resource === 'active' ? row.date_submitted : row.created_at) ?? '').startsWith(date))), row => resource === 'active' ? row.date_submitted : row.created_at, sortOrder), [rows, query, date, resource, sortOrder]);
  const columns = resource === 'active'
    ? ['application_id','member_name','loan_type','amount','monthly_payment','status','date_submitted']
    : ['created_at','action_name','target_id','result'];
  const labels: Record<string,string> = {application_id:'Application ID',member_name:'Member',loan_type:'Loan type',amount:'Principal',monthly_payment:'Monthly payment',status:'Status',date_submitted:'Submitted',created_at:'Date & time',action_name:'Action',target_id:'Target',result:'Result'};
  const display = (key: string, value: unknown) => {
    if (value == null) return 'Not recorded';
    if (numericColumns.includes(key)) return new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(value));
    if (['date_submitted','created_at'].includes(key) && Number.isFinite(Date.parse(String(value)))) return new Date(String(value)).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric',timeZone:'Asia/Manila',...(key==='created_at'?{hour:'numeric',minute:'2-digit'} as const:{})});
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value).replaceAll('_',' ');
  };
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, totalPages - 1);
  const start = current * pageSize;
  const end = Math.min(start + pageSize, filtered.length);

  return <Card padded={false}>
    {resource==="audit"?<PortalPageHeading section="audit-logs" />:<h2 className="border-b border-portal-border px-4 py-4 text-section-title sm:px-6">{title}</h2>}
    <FilterToolbar>
      <SearchInput aria-label={`Search ${title}`} placeholder="Search records" value={query}
        onChange={event => { setQuery(event.target.value); setPage(0); }} />
      <Input aria-label="Filter date" type="date" value={date}
        onChange={event => { setDate(event.target.value); setPage(0); }} />
      <Button onClick={() => { setQuery(''); setDate(''); setPage(0); }}>Clear</Button>
      <Button disabled={loading} onClick={() => void load()}>Refresh</Button>
      <Button disabled={loading || !!error || !filtered.length} onClick={() => exportCsv(`${resource}.csv`, filtered)}>Export CSV</Button>
    </FilterToolbar>
    {error ? <p role="alert" className="px-4 pb-4 text-body text-status-danger">{error}</p> : loading ? (
      <LoadingState label="Loading records…" />
    ) : <>
      <DataTable label={`${title} table`} className={resource === "active" ? "min-w-[960px]" : "min-w-[640px]"}>
        <thead>
          <tr>
            {columns.map(key => <th scope="col" className={columnAlignment(key)} key={key}>{labels[key] ?? key.replaceAll('_',' ')}</th>)}
            <th scope="col" className="text-center">Action</th>
          </tr>
        </thead>
        <tbody>
          {filtered.slice(start, end).map((row, index) => (
            <tr key={String(row.id ?? index)}>
              {columns.map(key => (
                <td key={key} className={`max-w-[240px] ${key === "result" ? "break-all" : "whitespace-nowrap"} ${columnAlignment(key)}`}>
                  {key === "status" ? <StatusBadge status={display(key, row[key])} className="capitalize" /> : display(key, row[key])}
                </td>
              ))}
              <td className="text-center">
                <RecordActionsMenu
                  label={String(row.application_id ?? row.id ?? index)}
                  onView={() => setSelected(row)}
                  onPayment={resource === "active" ? () => setPaymentLoan(String(row.id)) : undefined}
                  canRecordPayment={role === "super_admin" && ["released", "overdue"].includes(String(row.status))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      {!filtered.length && <EmptyState title="No matching records." description="Try changing your search or date filter." />}
      <Pagination label={`${title} pagination`} currentPage={current + 1} totalPages={totalPages}
        showingFrom={start + 1} showingTo={end} totalItems={filtered.length} onPageChange={next => setPage(next - 1)}
        controls={<PaginationControls sortOption={sortOrder} pageSize={pageSize} sortLabel={`Sort ${title}`} pageSizeLabel={`${title} per page`}
          onSortChange={value => { setSortOrder(value); setPage(0); }} onPageSizeChange={value => { setPageSize(value); setPage(0); }} />} />
    </>}
    {paymentLoan && <CounterPaymentDialog key={paymentLoan} loanId={paymentLoan} onClose={() => setPaymentLoan(null)} onSaved={() => void load()} />}
    {selected && resource === "active" && <LoanDetailsModal applicationId={String(selected.application_id)} onClose={() => setSelected(null)} />}
    {selected && resource !== "active" && (
      <DetailDialog title="Record details" titleId="record-details-title" closeLabel="Close details" onClose={() => setSelected(null)}>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {Object.entries(selected).map(([key, value]) => (
            <div key={key} className="min-w-0">
              <dt className="text-caption font-medium capitalize text-portal-secondary">{key.replaceAll("_", " ")}</dt>
              <dd className="mt-0.5 whitespace-pre-wrap text-body [overflow-wrap:anywhere]">
                {typeof value === "object" ? JSON.stringify(value) : String(value ?? "Not recorded")}
              </dd>
            </div>
          ))}
        </dl>
      </DetailDialog>
    )}
  </Card>;
}
