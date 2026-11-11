"use client";
import PortalPageHeading from "@/components/shared/PortalPageHeading";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileUp, RefreshCw } from "lucide-react";
import { useAdminAuth } from "@/components/auth/AdminAuthProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { Select } from "@/components/ui/Fields";
import { FilterToolbar, SearchInput } from "@/components/ui/FilterToolbar";
import { EmptyState, LoadingState } from "@/components/ui/Feedback";
import { Pagination, PaginationControls } from "@/components/ui/Pagination";
import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import { ActionResultDialog } from "@/components/ui/ActionResultDialog";
import { documentApplicationSummary, documentKindLabels, filterDocumentApplications, reviewLabels, type DocumentWorkspace, type SharedDocument } from "@/lib/documentWorkspace";
import { documentsRequest } from "@/lib/documentWorkspaceRequest";
import { sortRowsByDate, type DateSortOrder } from "@/lib/tablePagination";
import { getLoanTypeLabel } from "@/lib/loanTypeLabel";
import DocumentStatusBadge from "./DocumentStatusBadge";
import DocumentReviewPanel from "./DocumentReviewPanel";
import SharedDocumentUploadDialog from "./SharedDocumentUploadDialog";
import SharedDocumentDetails from "./SharedDocumentDetails";
import { documentDate, documentTime } from "./documentPresentation";

export default function DocumentsWorkspace() {
  const { can }=useAdminAuth();
  const [workspace,setWorkspace]=useState<DocumentWorkspace|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [tab,setTab]=useState<"members"|"shared">("members");
  const [search,setSearch]=useState("");
  const [review,setReview]=useState("all");
  const [completeness,setCompleteness]=useState("all");
  const [membership,setMembership]=useState("all");
  const [audience,setAudience]=useState("all");
  const [publication,setPublication]=useState("all");
  const [sort,setSort]=useState<DateSortOrder>("Newest");
  const [pageSize,setPageSize]=useState(10);
  const [page,setPage]=useState(1);
  const [applicationId,setApplicationId]=useState<string|null>(null);
  const [sharedId,setSharedId]=useState<string|null>(null);
  const [upload,setUpload]=useState<{draft?:SharedDocument}|null>(null);
  const [pendingDelete,setPendingDelete]=useState<SharedDocument|null>(null);
  const [deleteBusy,setDeleteBusy]=useState(false);
  const [deleteError,setDeleteError]=useState("");
  const [notice,setNotice]=useState("");
  const deleting=useRef(false);
  const refresh=useCallback(async()=>{
    const data=await documentsRequest<DocumentWorkspace>();
    setWorkspace(data);setError("");
  },[]);
  useEffect(()=>{
    let active=true;
    void documentsRequest<DocumentWorkspace>().then(data=>{if(active){setWorkspace(data);setError("");}})
      .catch(error=>{if(active)setError(error instanceof Error ? error.message : "Documents could not be loaded.");})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[]);
  const reload=async()=>{setLoading(true);setError("");try{await refresh();}catch(error){setError(error instanceof Error ? error.message : "Documents could not be loaded.");}finally{setLoading(false);}};
  const changeTab=(next:"members"|"shared")=>{setTab(next);setSearch("");setPage(1);setApplicationId(null);setSharedId(null);};
  const applications=useMemo(()=>sortRowsByDate(filterDocumentApplications(workspace?.applications ?? [],{search,review,completeness,membership}),
    item=>documentApplicationSummary(item).lastUpload ?? item.submittedAt,sort),[workspace,search,review,completeness,membership,sort]);
  const shared=useMemo(()=>sortRowsByDate((workspace?.shared ?? []).filter(item=>{
    const query=search.trim().toLowerCase();
    const searchable=[item.title,item.filename,item.category,...item.recipients.flatMap(person=>[person.name,person.memberNumber])].join(" ").toLowerCase();
    return searchable.includes(query) && (audience==="all" || item.audience===(audience==="all-members" ? "all" : audience)) && (publication==="all" || item.status===publication);
  }),item=>item.createdAt,sort),[workspace,search,audience,publication,sort]);
  const count=tab==="members" ? applications.length : shared.length;
  const pages=Math.max(1,Math.ceil(count/pageSize)), currentPage=Math.min(page,pages), start=(currentPage-1)*pageSize;
  const selectedApplication=workspace?.applications.find(item=>item.id===applicationId);
  const selectedShared=workspace?.shared.find(item=>item.id===sharedId);
  const uploadAllowed=can("documents.upload") && !!workspace?.capabilities.sharing;
  const reviewAllowed=can("documents.review") && !!workspace?.capabilities.canReview;
  const saved=async(published:boolean)=>{
    await refresh();setTab("shared");setSearch("");setAudience("all");setPublication("all");setPage(1);setSort("Newest");
    setNotice(published ? "The document was published for the chosen recipients." : "The document was saved as a private staff draft.");
  };
  const remove=async()=>{
    if(!pendingDelete || deleting.current)return;
    deleting.current=true;setDeleteBusy(true);setDeleteError("");
    try{
      const result=await documentsRequest<{warning?:string|null}>("",{method:"DELETE",body:JSON.stringify({id:pendingDelete.id,updatedAt:pendingDelete.updatedAt})});
      await refresh();setPendingDelete(null);setSharedId(null);setNotice(result.warning ?? "The document was removed from the library and member access.");
    }catch(error){setDeleteError(error instanceof Error ? error.message : "The document could not be deleted.");}
    finally{deleting.current=false;setDeleteBusy(false);}
  };
  const openDelete=(item:SharedDocument)=>{setSharedId(null);setDeleteError("");setPendingDelete(item);};
  return <>
    <Card padded={false} className="overflow-hidden" aria-label="Documents workspace">
      <PortalPageHeading section="documents" />
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-portal-border p-4 sm:px-6">
        <div role="tablist" aria-label="Document purpose" className="flex max-w-full flex-wrap gap-1" onKeyDown={event=>{
          if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
          event.preventDefault();const next=event.key==="Home" ? "members" : event.key==="End" ? "shared" : tab==="members" ? "shared" : "members";
          changeTab(next);document.getElementById("documents-"+next+"-tab")?.focus();
        }}>
          <button type="button" role="tab" id="documents-members-tab" aria-controls="documents-members-panel" aria-selected={tab==="members"} tabIndex={tab==="members" ? 0 : -1}
            onClick={()=>changeTab("members")} className={"ui-button ui-button--ghost "+(tab==="members" ? "bg-surface-muted text-coop-dashboard-green" : "")}>Member Documents</button>
          <button type="button" role="tab" id="documents-shared-tab" aria-controls="documents-shared-panel" aria-selected={tab==="shared"} tabIndex={tab==="shared" ? 0 : -1}
            onClick={()=>changeTab("shared")} className={"ui-button ui-button--ghost "+(tab==="shared" ? "bg-surface-muted text-coop-dashboard-green" : "")}>Shared Documents</button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button aria-label="Refresh documents" disabled={loading} onClick={()=>void reload()}><RefreshCw className={"h-4 w-4 "+(loading ? "animate-spin" : "")} /><span className="hidden sm:inline">Refresh</span></Button>
          {can("documents.upload") && <Button variant="primary" disabled={loading || !uploadAllowed} onClick={()=>{changeTab("shared");setUpload({});}}><FileUp className="h-4 w-4" />Upload document</Button>}
        </div>
      </div>
      {workspace?.warnings.map(message=><p key={message} role="status" className="border-b border-portal-border px-4 py-3 text-support text-status-warning sm:px-6">{message}</p>)}
      {loading ? <LoadingState label="Loading documents…" /> : error ? <div role="alert" className="p-8 text-center text-support text-status-danger">{error}<Button className="ml-3" onClick={()=>void reload()}>Retry</Button></div>
        : <>
          <section role="tabpanel" id="documents-members-panel" aria-labelledby="documents-members-tab" hidden={tab!=="members"}>
            {tab==="members" && (selectedApplication ? <DocumentReviewPanel key={selectedApplication.id} application={selectedApplication} canReview={reviewAllowed} onBack={()=>setApplicationId(null)} onUpdated={refresh} /> : <>
              <FilterToolbar>
                <SearchInput aria-label="Search member documents" placeholder="Search member name, ID, application or loan type…" value={search} onChange={event=>{setSearch(event.target.value);setPage(1);}} />
                <Select aria-label="Filter document reviews" className="w-[172px]" value={review} onChange={event=>{setReview(event.target.value);setPage(1);}}>
                  <option value="all">All reviews</option>{(["to_review","awaiting_files","needs_replacement","verified"] as const).map(value=><option key={value} value={value}>{reviewLabels[value]}</option>)}
                </Select>
                <Select aria-label="Filter document requirements" className="w-[160px]" value={completeness} onChange={event=>{setCompleteness(event.target.value);setPage(1);}}>
                  <option value="all">All submissions</option><option value="complete">Complete</option><option value="missing">Missing files</option>
                </Select>
                <Select aria-label="Filter document membership" className="w-[164px]" value={membership} onChange={event=>{setMembership(event.target.value);setPage(1);}}>
                  <option value="all">All members</option><option value="regular">Regular Member</option><option value="associate">Associate Member</option>
                </Select>
              </FilterToolbar>
              <DataTable label="Member document submissions" density="compact" className="min-w-[1000px] table-fixed">
                <colgroup><col className="w-[20%]" /><col className="w-[22%]" /><col className="w-[18%]" /><col className="w-[16%]" /><col className="w-[14%]" /><col className="w-[10%]" /></colgroup>
                <thead><tr>{["Member","Application","Requirements","Review","Last upload","Actions"].map(label=><th key={label} scope="col" className={label==="Actions" ? "text-center" : ""}>{label}</th>)}</tr></thead>
                <tbody>{applications.slice(start,start+pageSize).map(application=>{
                  const summary=documentApplicationSummary(application);
                  return <tr key={application.id}>
                    <td><p className="font-semibold [overflow-wrap:anywhere]">{application.memberName}</p><p className="mt-0.5 text-caption text-portal-secondary">{application.memberNumber}</p></td>
                    <td><p className="[overflow-wrap:anywhere]">{getLoanTypeLabel(application.loanType)}</p><p className="mt-0.5 text-caption text-portal-secondary [overflow-wrap:anywhere]">{application.applicationId}</p></td>
                    <td><p className="font-medium tabular-nums">{summary.uploadedRequired===null ? "Not available" : summary.uploadedRequired+" of "+application.requiredKinds?.length+" required"}</p>
                      <p className="mt-0.5 text-caption text-portal-secondary">{summary.complete===null ? "Refresh loan requirements" : summary.missing.length ? "Missing: "+summary.missing.map(kind=>documentKindLabels[kind]).join(", ") : "All required files uploaded"}</p></td>
                    <td><DocumentStatusBadge status={summary.status} /></td>
                    <td><p>{summary.lastUpload ? documentDate(summary.lastUpload) : "No uploads yet"}</p>{summary.lastUpload && <p className="mt-0.5 text-caption text-portal-secondary">{documentTime(summary.lastUpload)}</p>}</td>
                    <td className="text-center"><Button size="compact" aria-label={"Review documents for "+application.memberName+" · "+application.applicationId} onClick={()=>setApplicationId(application.id)}>Review</Button></td>
                  </tr>;
                })}</tbody>
              </DataTable>
              {!applications.length && <EmptyState title="No matching member documents." description="Try another member name, ID, application or filter." />}
              <Pagination label="Member documents pagination" currentPage={currentPage} totalPages={pages} showingFrom={start+1} showingTo={Math.min(start+pageSize,count)} totalItems={count} itemLabel="applications" onPageChange={setPage}
                controls={<PaginationControls sortOption={sort} pageSize={pageSize} sortLabel="Sort member documents" pageSizeLabel="Document applications per page" onSortChange={value=>{setSort(value);setPage(1);}} onPageSizeChange={value=>{setPageSize(value);setPage(1);}} />} />
              <p className="border-t border-portal-border px-4 py-3 text-caption text-portal-secondary sm:px-6">Complete means required files are uploaded. Verified means an administrator reviewed and accepted the files.</p>
            </>)}
          </section>
          <section role="tabpanel" id="documents-shared-panel" aria-labelledby="documents-shared-tab" hidden={tab!=="shared"}>
            {tab==="shared" && <>
              <FilterToolbar>
                <SearchInput aria-label="Search shared documents" placeholder="Search title, filename or recipient…" value={search} onChange={event=>{setSearch(event.target.value);setPage(1);}} />
                <Select aria-label="Filter shared document audience" className="w-[180px]" value={audience} onChange={event=>{setAudience(event.target.value);setPage(1);}}>
                  <option value="all">All audiences</option><option value="all-members">All members</option><option value="selected">Selected members</option><option value="staff">Staff only</option>
                </Select>
                <Select aria-label="Filter shared document status" className="w-[164px]" value={publication} onChange={event=>{setPublication(event.target.value);setPage(1);}}>
                  <option value="all">All statuses</option><option value="published">Published</option><option value="draft">Draft</option><option value="staff_only">Staff only</option>
                </Select>
              </FilterToolbar>
              <DataTable label="Shared documents table" density="compact" className="min-w-[850px] table-fixed">
                <colgroup><col className="w-[28%]" /><col className="w-[24%]" /><col className="w-[20%]" /><col className="w-[14%]" /><col className="w-[14%]" /></colgroup>
                <thead><tr>{["Document","Audience","Uploaded by","Status","Actions"].map(label=><th key={label} scope="col" className={label==="Actions" ? "text-center" : ""}>{label}</th>)}</tr></thead>
                <tbody>{shared.slice(start,start+pageSize).map(item=><tr key={item.id}>
                  <td><p className="font-semibold [overflow-wrap:anywhere]">{item.title}</p><p className="mt-0.5 text-caption text-portal-secondary [overflow-wrap:anywhere]">{item.category} · {item.filename}</p></td>
                  <td><p>{item.audience==="staff" ? "Staff only" : item.audience==="all" ? "All members" : item.recipients.length===1 ? item.recipients[0].name : item.recipients.length+" selected members"}</p>
                    <p className="mt-0.5 text-caption text-portal-secondary">{item.status==="draft" ? "Not published yet" : item.audience==="staff" ? "Existing staff-library upload" : item.audience==="selected" ? "Selected recipients only" : "Available in the member app"}</p></td>
                  <td><p className="[overflow-wrap:anywhere]">{item.uploadedBy}</p><p className="mt-0.5 text-caption text-portal-secondary">{documentDate(item.createdAt)}</p></td>
                  <td><DocumentStatusBadge status={item.status} /></td>
                  <td className="text-center"><Button size="compact" onClick={()=>setSharedId(item.id)} aria-label={"View details for "+item.title}>Details</Button></td>
                </tr>)}</tbody>
              </DataTable>
              {!shared.length && <EmptyState title="No matching shared documents." description="Upload a document or adjust the search and audience filters." />}
              <Pagination label="Document pagination" currentPage={currentPage} totalPages={pages} showingFrom={start+1} showingTo={Math.min(start+pageSize,count)} totalItems={count} itemLabel="documents" onPageChange={setPage}
                controls={<PaginationControls sortOption={sort} pageSize={pageSize} sortLabel="Sort documents" pageSizeLabel="Documents per page" onSortChange={value=>{setSort(value);setPage(1);}} onPageSizeChange={value=>{setPageSize(value);setPage(1);}} />} />
            </>}
          </section>
        </>}
    </Card>
    {upload && <SharedDocumentUploadDialog draft={upload.draft} onClose={()=>setUpload(null)} onSaved={saved} />}
    {selectedShared && <SharedDocumentDetails document={selectedShared} onClose={()=>setSharedId(null)}
      onPublish={selectedShared.status==="draft" && uploadAllowed ? ()=>{setSharedId(null);setUpload({draft:selectedShared});} : undefined}
      onDelete={can("documents.delete") ? ()=>openDelete(selectedShared) : undefined} />}
    {pendingDelete && <ConfirmActionDialog title="Delete document" tone="destructive" busy={deleteBusy} error={deleteError} confirmLabel="Delete document"
      question={pendingDelete.source==="legacy" ? "Permanently delete this staff-library upload?" : "Remove this document from the library and member access?"}
      details={[{label:"Document",value:pendingDelete.title}]} onClose={()=>{if(!deleting.current)setPendingDelete(null);}} onConfirm={()=>void remove()} />}
    {notice && <ActionResultDialog success title="Document updated" message={notice} onClose={()=>setNotice("")} />}
  </>;
}
