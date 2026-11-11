"use client";
import {useEffect,useRef,useState} from "react";
import {Search} from "lucide-react";
import {useAdminAuth} from "@/components/auth/AdminAuthProvider";
import PortalPageHeading from "@/components/shared/PortalPageHeading";
import AccountRoleBadge from "@/components/shared/AccountRoleBadge";
import {formatAccountNumber,type AccountRole} from "@/lib/accountPresentation";
import {Card} from "@/components/ui/Card";
import {Badge} from "@/components/ui/StatusBadge";
import {Button} from "@/components/ui/Button";
import {Input,Select} from "@/components/ui/Fields";
import {DataTable} from "@/components/ui/DataTable";
import {Pagination} from "@/components/ui/Pagination";
import {LoadingState} from "@/components/ui/Feedback";
import {activeLogRoles,logDateTime,type ActiveLogPage,type ActiveLogRow} from "@/lib/activeLogs";
import {fetchActiveLogs,watchActiveLogs} from "@/lib/activeLogsRequest";
import styles from "./ActiveLogs.module.css";

function Time({value,active=false}:{value:string|null;active?:boolean}){const date=logDateTime(value);return active?<span className="font-semibold text-status-success">Active</span>:date?<time dateTime={value!} className={styles.time}><span>{date.date}</span><span>{date.time}</span></time>:<span className="text-portal-secondary">—</span>;}
function actionTone(action:string){return /reject|delete|block|reverse/i.test(action)&&!/unblock/i.test(action)?"danger":/login|approv|verif|create|release|record payment/i.test(action)?"success":/logout/i.test(action)?"neutral":"info";}
function Row({row}:{row:ActiveLogRow}){return <tr>
 <td><span className={styles.account}>{formatAccountNumber(row.accountNumber)}</span></td><td className="font-semibold">{row.name}</td>
 <td><AccountRoleBadge role={row.role}/></td><td><Badge tone={actionTone(row.action)}>{row.action}</Badge></td>
 <td>{row.browser||row.os?(row.browser??"—")+"/"+(row.os??"—"):"—"}</td><td><Time value={row.timeIn}/></td><td><Time value={row.timeOut} active={row.sessionState==="active"}/></td>
 <td><span className={styles.ip}>{row.ipAddress??"—"}</span></td><td className={styles.details}>{row.details}</td>
 </tr>;}
export default function ActiveLogsWorkspace(){
 const {role}=useAdminAuth();
 return <ActiveLogsView viewerRole={role??"admin"}/>;
}
export function ActiveLogsView({viewerRole}:{viewerRole:AccountRole}){
 const ownOnly=!["admin","super_admin"].includes(viewerRole);
 const [search,setSearch]=useState(""),[debounced,setDebounced]=useState(""),[filterRole,setRole]=useState(""),[from,setFrom]=useState(""),[to,setTo]=useState(""),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(10);
 const [data,setData]=useState<ActiveLogPage|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(""),[live,setLive]=useState(false),[reload,setReload]=useState(0);
 const request=useRef(0);
 useEffect(()=>{const timer=window.setTimeout(()=>setDebounced(search),350);return()=>window.clearTimeout(timer);},[search]);
 const invalid=!!from&&!!to&&from>to;
 useEffect(()=>{
  if(invalid)return;
  let disposed=false;let activeRequest:AbortController|null=null;let timer:number|undefined;
  const load=async()=>{
   setLoading(true);
   activeRequest?.abort();const controller=new AbortController();activeRequest=controller;const sequence=++request.current;
   try{const result=await fetchActiveLogs({search:debounced,role:filterRole,from,to,page,pageSize},controller.signal);if(disposed||sequence!==request.current)return;setData(result);setError("");}
   catch(error){if(!disposed&&!controller.signal.aborted&&sequence===request.current)setError(error instanceof Error?error.message:"Active Logs could not be loaded.");}
   finally{if(!disposed&&sequence===request.current)setLoading(false);}
  };
  const schedule=()=>{if(document.visibilityState!=="hidden"){window.clearTimeout(timer);timer=window.setTimeout(()=>void load(),200);}};
  void load();const stop=watchActiveLogs(schedule,setLive),poll=window.setInterval(schedule,15000);
  window.addEventListener("focus",schedule);window.addEventListener("online",schedule);document.addEventListener("visibilitychange",schedule);
  return()=>{disposed=true;activeRequest?.abort();stop();window.clearInterval(poll);window.clearTimeout(timer);window.removeEventListener("focus",schedule);window.removeEventListener("online",schedule);document.removeEventListener("visibilitychange",schedule);};
 },[debounced,filterRole,from,to,page,pageSize,reload,invalid]);
 const reset=()=>{setPage(1);};
 const totalPages=Math.max(1,Math.ceil((data?.total??0)/pageSize)),current=data?.page??page;
 return <Card padded={false} className="min-w-0 overflow-hidden">
  <PortalPageHeading section="active-logs"><span role="status" className="flex items-center gap-2 text-caption text-portal-secondary"><span className={styles.dot} data-live={live}/>{live?"Live updates":"Auto-refreshing"}</span></PortalPageHeading>
  <div className={styles.toolbar}>
   <label className={styles.search}>Search<span className="relative block"><Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-portal-secondary"/><Input type="search" aria-label="Search Active Logs" placeholder="Name, user, action" value={search} onChange={event=>{setSearch(event.target.value);reset();}} className="w-full pl-9"/></span></label>
   <label>Role<Select aria-label="Filter role" value={filterRole} className="w-full" onChange={event=>{setRole(event.target.value);reset();}}><option value="">{ownOnly?"My activity":"All Roles"}</option>{Object.entries(activeLogRoles).filter(([value])=>ownOnly?value===viewerRole:viewerRole==="super_admin"||value!=="super_admin").map(([value,label])=><option key={value} value={value}>{label}</option>)}</Select></label>
   <label>From Date<Input type="date" aria-label="From Date" value={from} max={to||undefined} onChange={event=>{setFrom(event.target.value);reset();}} className="w-full"/></label>
   <label>To Date<Input type="date" aria-label="To Date" value={to} min={from||undefined} onChange={event=>{setTo(event.target.value);reset();}} className="w-full"/></label>
  </div>
  {ownOnly&&<p className="border-b border-portal-border px-4 py-3 text-caption text-portal-secondary sm:px-6">Only activity performed by your own account is shown.</p>}
  {invalid&&<p role="alert" className="px-4 py-3 text-support text-status-danger">From Date must be on or before To Date.</p>}
  {error&&<div role="alert" className="flex flex-wrap items-center gap-3 px-4 py-3 text-support text-status-danger">{error}<Button size="compact" onClick={()=>setReload(value=>value+1)}>Retry</Button></div>}
  {loading&&!data?<LoadingState label="Loading Active Logs…"/>:<>
   <DataTable label="Active Logs table" aria-busy={loading} className={styles.table} density="compact"><colgroup>{[12,13,10,13,10,10,10,9,13].map((width,index)=><col key={index} style={{width:width+"%"}}/>)}</colgroup>
    <thead><tr>{["ID Number","Name","Role","Action","Browser / OS","Time In","Time Out","IP Address","Details"].map(label=><th key={label} scope="col">{label}</th>)}</tr></thead>
    <tbody>{!invalid&&data?.rows.map(row=><Row key={row.id} row={row}/>)}{(invalid||!data?.rows.length)&&<tr><td colSpan={9} className="py-12! text-center! text-portal-secondary">{invalid?"Choose a valid date range.":"No activity logs found."}</td></tr>}</tbody>
   </DataTable>
   <Pagination label="Active Logs pagination" currentPage={current} totalPages={totalPages} totalItems={invalid?0:data?.total??0} showingFrom={(current-1)*pageSize+1} showingTo={Math.min(current*pageSize,data?.total??0)} onPageChange={setPage} itemLabel="entries"
    controls={<label className="flex items-center gap-2 text-caption text-portal-secondary">Show<Select size="compact" aria-label="Rows per page" value={pageSize} onChange={event=>{setPageSize(Number(event.target.value));reset();}}>{[10,25,50].map(size=><option key={size} value={size}>{size}</option>)}</Select>per page</label>}/>
  </>}
 </Card>;
}
