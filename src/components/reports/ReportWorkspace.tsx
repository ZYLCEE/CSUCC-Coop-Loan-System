"use client";
import PortalPageHeading from "@/components/shared/PortalPageHeading";
import { useState } from 'react';
import { adminRequest } from '@/lib/adminRequest';
import { exportCsv } from '@/lib/download';
import { reportWindow } from '@/lib/reporting';
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/Feedback";
import { Input, Select } from "@/components/ui/Fields";
import { FilterToolbar } from "@/components/ui/FilterToolbar";
import { Pagination, PaginationControls } from "@/components/ui/Pagination";
import { sortRowsByDate, type DateSortOrder } from "@/lib/tablePagination";
import { StatusBadge } from "@/components/ui/StatusBadge";

export default function ReportWorkspace() {
  const [type,setType] = useState('loans');
  const [period,setPeriod] = useState('Yearly');
  const [date,setDate] = useState(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(new Date()));
  const [report,setReport] = useState<{rows:Record<string,unknown>[];title:string;range:string;resource:string}|null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [page,setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortOrder, setSortOrder] = useState<DateSortOrder>("Newest");
  const dateField = report?.resource === 'payments' ? 'payment_date' : report?.resource === 'members' ? 'date_joined' : 'date_submitted';
  const sortedRows = sortRowsByDate(report?.rows ?? [], row => row[dateField], sortOrder);
  const pageCount = Math.max(1,Math.ceil((report?.rows.length ?? 0)/pageSize));
  const currentPage = Math.min(page,pageCount);
  const start = (currentPage-1)*pageSize;
  const visibleRows = sortedRows.slice(start,start+pageSize);
  const generate = async()=>{setBusy(true);setError('');setReport(null);setPage(1);try{const range=reportWindow(date,period);const data:Record<string,unknown>[]=await adminRequest(type);const field=type==='loans'?'date_submitted':type==='payments'?'payment_date':'date_joined';const rows=data.filter(row=>String(row[field]).slice(0,10)>=range.start&&String(row[field]).slice(0,10)<range.end);setReport({rows,title:type==='loans'?'Loan Summary':type==='payments'?'Recorded Payment History':'Membership Registry',range:`${period} · ${range.start} to ${new Date(Date.parse(range.end)-86400000).toISOString().slice(0,10)}`,resource:type});}catch(error){setError(error instanceof Error?error.message:'Report failed.');}finally{setBusy(false);}};
  const columns=!report?[]:report.resource==='loans'?['application_id','member_name','loan_type','amount','status','date_submitted']:report.resource==='members'?['member_id','first_name','last_name','email','membership_type','status','date_joined']:['loan_application_id','receipt_number','payment_date','payment_amount','principal_amount','interest_amount','penalty_amount','fee_amount','payment_method','payment_status','recorded_by_name','reversal_reason','notes'];
  const print=()=>{if(!report)return;const popup=window.open('','_blank');if(!popup){setError('Allow popups to print this report.');return;}const escape=(v:unknown)=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');popup.document.write(`<html><head><title>${escape(report.title)}</title><style>body{font:12px sans-serif}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:5px;overflow-wrap:anywhere}@page{size:landscape}</style></head><body><h1>${escape(report.title)}</h1><p>${escape(report.range)} · ${report.rows.length} records</p><table><thead><tr>${columns.map(c=>`<th>${escape(c.replaceAll('_',' '))}</th>`).join('')}</tr></thead><tbody>${sortedRows.map(row=>`<tr>${columns.map(c=>`<td>${escape(row[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`);popup.document.close();popup.focus();popup.print();};
  const numericColumns = new Set(["amount", "payment_amount", "principal_amount", "interest_amount", "penalty_amount", "fee_amount"]);
  const alignment = (column: string) => numericColumns.has(column) ? "text-right tabular-nums" : column.endsWith("status") ? "text-center" : "";

  return (
    <Card padded={false} aria-busy={busy} className="overflow-hidden">
      <PortalPageHeading section="reports" />
      <div className="ui-card-padding">
      <FilterToolbar className="mb-4 p-0 sm:px-0">
        <Select aria-label="Report type" value={type} onChange={event => setType(event.target.value)}>
          <option value="loans">Loan Summary</option>
          <option value="members">Membership Registry</option>
          <option value="payments">Recorded Payment History</option>
        </Select>
        <Select aria-label="Reporting period" value={period} onChange={event => setPeriod(event.target.value)}>
          {["Daily", "Weekly", "Monthly", "Yearly"].map(value => <option key={value}>{value}</option>)}
        </Select>
        <Input aria-label="Report date" type="date" value={date} onChange={event => setDate(event.target.value)} />
        <Button variant="primary" loading={busy} onClick={() => void generate()}>{busy ? "Generating…" : "Generate Report"}</Button>
        <Button disabled={!report || busy} onClick={() => report && exportCsv(`${report.resource}-${date}.csv`, sortedRows)}>Export CSV (Excel)</Button>
        <Button disabled={!report || busy} onClick={print}>Print / Save PDF</Button>
      </FilterToolbar>
      {error && <p role="alert" className="text-body text-status-danger">{error}</p>}
      {report && <>
        <h3 className="text-card-title">{report.title}</h3>
        <p className="my-2 text-support text-portal-muted">{report.range} · {report.rows.length} records</p>
        {report.resource === "loans" && <p className="mb-3 text-body">Requested principal: ₱{report.rows.reduce((sum, row) => sum + Number(row.amount), 0).toLocaleString("en-PH")} · Approved / released / completed / overdue: {report.rows.filter(row => ["approved", "released", "completed", "overdue"].includes(String(row.status))).length}</p>}
        {report.resource === "payments" && <p className="mb-3 text-body">Net recorded payments: ₱{report.rows.filter(row => row.payment_status !== "reversed").reduce((sum, row) => sum + Number(row.payment_amount), 0).toLocaleString("en-PH")}. Reversed receipts remain visible and are excluded from this total. Amounts reflect staff-recorded receipts.</p>}
        <DataTable label={`${report.title} table`}>
          <thead><tr>{columns.map(key => <th key={key} scope="col" className={alignment(key)}>{key.replaceAll("_", " ")}</th>)}</tr></thead>
          <tbody>{visibleRows.map((row, index) => (
            <tr key={String(row.id ?? index)}>
              {columns.map(key => (
                <td key={key} className={`max-w-xs whitespace-nowrap ${alignment(key)}`}>
                  {key.endsWith("status") && row[key] != null
                    ? <StatusBadge status={String(row[key])} label={String(row[key])} />
                    : String(row[key] ?? "—")}
                </td>
              ))}
            </tr>
          ))}</tbody>
        </DataTable>
        {!report.rows.length && <EmptyState title="No records for the selected period." description="Choose a different date or reporting period." />}
        <Pagination label="Report pagination" currentPage={currentPage} totalPages={pageCount}
          showingFrom={start + 1} showingTo={start + visibleRows.length} totalItems={report.rows.length} onPageChange={setPage}
          controls={<PaginationControls sortOption={sortOrder} pageSize={pageSize} sortLabel="Sort report records" pageSizeLabel="Report records per page" disabled={busy}
            onSortChange={value => { setSortOrder(value); setPage(1); }} onPageSizeChange={value => { setPageSize(value); setPage(1); }} />} />
      </>}
      </div>
    </Card>
  );
}
