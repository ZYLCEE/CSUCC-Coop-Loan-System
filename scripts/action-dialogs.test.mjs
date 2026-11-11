// Isolated browser tests: real React/components, mocked protected-action transport, no live mutations.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve, extname } from "node:path";
import { createServer } from "node:http";
import { homedir } from "node:os";
import ts from "typescript";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { captureModalPreviews } from "./modal-preview-captures.mjs";
import { captureLoanDetails } from "./loan-details-previews.mjs";
import { checkLoanRejectionUI } from "./loan-rejection-previews.mjs";
import { checkAccountActions } from "./account-actions-previews.mjs";
import { checkAccountCreation } from "./account-creation-previews.mjs";
import { checkActiveLoans } from "./active-loans-previews.mjs";
import { checkPagination } from "./pagination-previews.mjs";
import { checkDocuments } from "./documents-previews.mjs";
import { checkVerification } from "./verification-previews.mjs";
import { checkCommittee } from "./committee-previews.mjs";
import { checkCommitteeReview } from "./committee-review-previews.mjs";
import {checkActivityNotifications} from "./activity-notification-previews.mjs";
import {checkPortalBranding} from "./portal-branding-previews.mjs";
import {checkActiveLogs} from "./active-logs-previews.mjs";
import {checkProfile} from "./profile-previews.mjs";
import {checkCommitteeSetup} from "./committee-setup-previews.mjs";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require(process.env.PLAYWRIGHT_MODULE ?? "playwright"); }
catch (error) {
  if (process.env.PLAYWRIGHT_MODULE) throw error;
  playwright = require(resolve(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
}
const { chromium } = playwright;
const root = process.cwd();
const modules = new Map();
function bundle(file) {
  if (modules.has(file)) return;
  const index = modules.size;
  modules.set(file, { index });
  if (/\.(png|jpe?g|webp)$/.test(file)) {
    const mime=file.endsWith('.webp')?'image/webp':file.endsWith('.png')?'image/png':'image/jpeg';
    modules.set(file,{index,code:'exports.__esModule=true;exports.default='+JSON.stringify({src:'data:'+mime+';base64,'+readFileSync(file).toString('base64')})+';'});return;
  }
  if (file.endsWith('.module.css')) {
    modules.set(file, {index, code:'exports.__esModule=true;exports.default=new Proxy({},{get:(_,key)=>String(key)});'}); return;
  }
  if (file === "notification-pagination-stub" || file === "announcement-pagination-stub") {
    const announcement = file === "announcement-pagination-stub";
    modules.set(file, {index, code:`exports.announcementPageSize=10;exports.fetchAnnouncementSetup=async()=>({categories:[{id:'general',name:'General'}],schedulingEnabled:false,notificationsEnabled:false});exports.${announcement ? 'fetchAnnouncements' : 'fetchOutgoingNotifications'}=async(user,status,search='',offset=0,size=10,sort='Newest')=>{window.paginationRequests??=[];window.paginationRequests.push({view:'${announcement ? 'announcements' : 'notifications'}',status,search,offset,size,sort});await new Promise(resolve=>setTimeout(resolve,30));const rows=window.paginationRecords['${announcement ? 'announcements' : 'notifications'}'].filter(row=>(status==='all'||row.status===status)&&row.title.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>(sort==='Oldest'?1:-1)*(Date.parse(a.createdAt)-Date.parse(b.createdAt)));return {items:structuredClone(rows.slice(offset,offset+size)),total:rows.length};};`}); return;
  }
  if (file === "auth-stub") {
    modules.set(file, { index, code: 'exports.useAdminAuth=()=>({user:window.testUser===null?null:window.testUser??{id:"synthetic-super",email:"current@example.invalid"},role:"testRole" in window?window.testRole:"super_admin",refreshUser:async()=>{},can:key=>(window.testRole??"super_admin")==="super_admin"||(window.testPrivileges??[]).includes(key)});' }); return;
  }
  if(file==="workflow-loans-stub"){
    modules.set(file,{index,code:'exports.fetchLoanApplications=async()=>[{id:"APP-TEST",memberId:"CSUCC-TEST-1",member:"Synthetic Maria Cruz",type:"Business",amount:"₱1,000.00",status:"Pending",date:"Nov 10, 2026",membershipType:"regular"}];'});return;
  }
  if (file === "transport-stub") {
    modules.set(file, { index, code: `exports.invokeProtectedAction=async(body)=>{window.calls.push(body);await new Promise(r=>setTimeout(r,window.protectedActionDelay??100));if(body.mode==="verify")return window.verifyFailure?{data:{error:"Password rejected"},error:{}}:{data:{grant:"test-grant"},error:null};if(window.holdAccountExecution){await new Promise(resolve=>{window.resumeAccountExecution=resolve;});window.holdAccountExecution=false;window.resumeAccountExecution=null;}if(window.executeFailure)return {data:{success:false,error:window.executeFailureMessage??"Backend rejected approval"},error:null};if(window.syntheticAccounts){const account=window.syntheticAccounts.find(a=>a.idNumber===body.target);if(account&&body.action==='block-account')account.status='Blocked';if(account&&body.action==='unblock-account')account.status='Active';if(body.action==='delete-account')window.syntheticAccounts=window.syntheticAccounts.filter(a=>a.idNumber!==body.target);}return {data:{success:true,result:{}},error:null};};` }); return;
  }
  if (file === "link-stub") {
    const react = require.resolve("react"); bundle(react);
    modules.set(file, { index, code: `exports.__esModule=true;exports.default=({children,...props})=>require(${modules.get(react).index}).createElement("a",props,children);` }); return;
  }
  if (file === "image-stub") {
    const react=require.resolve("react");bundle(react);
    modules.set(file,{index,code:`exports.__esModule=true;exports.default=({src,unoptimized,preload,...props})=>require(${modules.get(react).index}).createElement("img",{...props,src:typeof src==='string'?src:src.src});`});return;
  }
  if (file === "router-stub") {
    modules.set(file, { index, code: 'exports.usePathname=()=>window.testPathname??window.location.pathname;exports.useRouter=()=>({push:path=>{window.navigationPath=path;},replace:path=>{window.navigationPath=path;}});' }); return;
  }
  if (file === "accounts-stub") {
    const accounts = readFileSync(resolve(root, "tests/fixtures/accounts.json"), "utf8");
    modules.set(file, { index, code: `exports.AdminAccountLoadError=class extends Error{};exports.fetchAdminAccounts=async()=>{window.accountLoads=(window.accountLoads??0)+1;window.syntheticAccounts??=${accounts};return {accounts:window.syntheticAccounts.map(a=>({...a})),dataIntegrityIssues:0};};` }); return;
  }
  if (file === "privileges-stub") {
    modules.set(file, { index, code: `exports.adminPrivilegeRequest=async(options)=>{window.privilegeCalls??=[];window.privilegeCalls.push(options??{method:'GET'});await new Promise(r=>setTimeout(r,120));if(window.privilegeFailure)throw new Error('Synthetic privilege request failed');return options?{success:true,version:'synthetic-version',warning:null}:{accounts:[{id:'synthetic-admin',active:!window.inactiveAdmin,privileges:[],version:null}]};};` }); return;
  }
  if (file === "inbox-stub") {
    modules.set(file, { index, code: 'exports.useNotificationInbox=()=>({items:[],unreadCount:0,total:0,filter:"all",category:"all",search:"",resetRecent:async()=>{},refresh:async()=>{},changeFilter:()=>{},changeQuery:()=>{}});' }); return;
  }
  if (file === "documents-stub") {
    const activeModel = resolve(root, "src/lib/activeLoans.ts"); bundle(activeModel);
    const activeFixtures = readFileSync(resolve(root, "tests/fixtures/active-loans.json"), "utf8");
    modules.set(file, { index, code: `exports.adminRequest=async(resource,options)=>{
      if(window.paginationRecords?.[resource]){await new Promise(resolve=>setTimeout(resolve,30));return structuredClone(resource==='active'?window.paginationRecords.active.map(({payments,...loan})=>require(${modules.get(activeModel).index}).toActiveLoan(loan,payments)):window.paginationRecords[resource]);}
      if(resource==='active'){
        window.activeLoads=(window.activeLoads??0)+1;await new Promise(r=>setTimeout(r,60));
        if(window.activeLoansFailure)throw new Error('Synthetic active-loan service unavailable');
        const raw=${activeFixtures};
        raw.push(...Array.from({length:8},(_,i)=>({...raw[0],id:'extra-'+i,application_id:'APP-EXTRA-'+i,member_name:'Synthetic Member '+i})));
        window.syntheticActiveLoans??=raw.map(({payments,...loan})=>require(${modules.get(activeModel).index}).toActiveLoan(loan,payments));
        return structuredClone(window.syntheticActiveLoans);
      }
      if(!options)return [{id:'doc-test',name:'Test document.pdf',size:100,createdAt:'2026-01-01',url:null,linkError:null,source:'cooperative',kind:null,applicationId:null}];window.documentCalls??=[];window.documentCalls.push(options);await new Promise(r=>setTimeout(r,100));if(window.documentFailure)throw new Error('Backend rejected deletion');return {};};` }); return;
  }
  if (file === "profile-stub") {
    modules.set(file, { index, code: 'exports.profileRequest=async()=>{window.profileCalls=(window.profileCalls??0)+1;await new Promise(r=>setTimeout(r,120));return {warning:null};};' }); return;
  }
  if (file === "supabase-stub") {
    const activeFixtures = readFileSync(resolve(root, "tests/fixtures/active-loans.json"), "utf8");
    const repaymentReceipts = readFileSync(resolve(root, "tests/fixtures/repayment-receipts.json"), "utf8");
    modules.set(file, { index, code: `
      const activeRaw=${activeFixtures};const repaymentReceipts=${repaymentReceipts};
      const loan={application_id:"APP-TEST",member_name:"Test member",amount:1000,status:"approved",date_submitted:"2026-01-01",date_approved:"2026-01-02",date_released:null};
      const policy={base_interest_rate:2,processing_fee_percent:1,service_fee_percent:0.5};
      const payment={id:'payment-test',payment_amount:100,payment_date:'2026-01-10',payment_method:'cash',receipt_number:'OR-SYNTHETIC-001',principal_amount:90,interest_amount:10,penalty_amount:0,fee_amount:0,notes:null,recorded_by:'synthetic-staff',recorded_by_name:'Test cashier',payment_status:'posted',reversal_reason:null,reversed_at:null,created_at:'2026-01-10T02:15:30Z'};
      const documents=[{id:'document-test',kind:'supporting',original_name:'Synthetic supporting document.pdf',storage_path:'synthetic/document.pdf',content_type:'application/pdf',size_bytes:2048}];
      exports.getSupabaseClient=()=>({
        channel:()=>{const channel={on:(event,filter,callback)=>{(window.realtimeSubscriptions??=[]).push({filter,callback});return channel;},subscribe:()=>channel};return channel;},removeChannel:async()=>{},
        functions:{invoke:async(name,options)=>{if(name!=='secure-admin-action')throw new Error('Unexpected synthetic function request');if(options?.body?.mode==='account-action-reason-capability')return {data:window.accountReasonsUnavailable?null:{version:1,reason_max_length:2000,actions:['block-account','delete-account'],audit_mode:'authorized-request-and-result'},error:window.accountReasonsUnavailable?{}:null};if(options?.body?.mode==='loan-rejection-capability')return {data:window.rejectionUnavailable?null:{version:1,reason_max_length:2000,statuses:['pending','under review']},error:window.rejectionUnavailable?{}:null};if(options?.body?.mode!=='preview-account-id')throw new Error('Unexpected synthetic function request');return {data:{previewId:'CSUCC-2026-0002'},error:null};}},
        storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'#synthetic-preview'},error:null})})},
        from:(table)=>{const result={data:['loan_document_versions','loan_document_reviews'].includes(table)?null:table==='loan_policy_settings'?policy:table==='loan_payments'?[payment]:table==='loan_documents'?documents:{id:'loan-test',...loan,purpose:'Synthetic loan purpose for preview review.',tenure_months:12,monthly_payment:100,...window.loanDetailsRecord},error:table==='loan_applications'&&window.loanDetailsFailure?{message:'Unable to load this application. Please try again.'}:null};
          let requestedId;
          const query={select:()=>query,eq:(key,value)=>{if(key==='id')requestedId=value;return query;},single:async()=>{
            if(window.previewLoading)return new Promise(()=>{});
            if(table==='loan_applications'&&requestedId){const source=activeRaw.find(item=>item.id===requestedId);return {data:source??{...result.data,status:'released',date_released:'2026-01-03'},error:window.repaymentTermsFailure?{message:'Synthetic term failure'}:result.error};}
            return result;
          },is:()=>query,limit:()=>query,maybeSingle:async()=>result,order:()=>query,returns:async()=>result,then:(resolve)=>Promise.resolve(result).then(resolve)};return query;},rpc:async(name,args)=>{
        window.rpcCalls??=[];window.rpcCalls.push({name,args});await new Promise(r=>setTimeout(r,120));
        if(name==='loan_rejection_details')return {data:window.syntheticRejection??null,error:window.rejectionDetailsFailure?{}:null};
        if(window.financialFailure&&!['loan_payment_ledger','preview_counter_payment'].includes(name))return {data:null,error:{message:'Backend rejected transaction'}};
        if(name==='loan_payment_ledger'){
          if(window.repaymentLoadFailure)return {data:null,error:{message:'Synthetic repayment ledger unavailable'}};
          const source=activeRaw.find(item=>item.id===args.p_loan_id);
          if(source){
            window.repaymentPayments??=structuredClone(repaymentReceipts);
            const entries=source.id==='loan-paid'?structuredClone(window.repaymentPayments):source.payments.map((item,i)=>({...payment,...item,id:source.id+'-receipt-'+i,receipt_number:'OR-'+source.id+'-'+i}));
            const posted=entries.filter(item=>item.payment_status==='posted');const paid=posted.reduce((sum,item)=>sum+Number(item.principal_amount??0),0);
            const unallocated=posted.filter(item=>item.principal_amount==null).length;
            return {data:{loan_id:source.id,application_id:source.application_id,member_name:source.member_name,status:source.status,date_released:'2026-01-03',principal:source.amount,total_received:posted.reduce((sum,item)=>sum+Number(item.payment_amount),0),principal_paid:paid,principal_remaining:unallocated?null:source.amount-paid,unallocated_payments:unallocated,automatic_allocation:true,payments:entries},error:null};
          }
          return {data:{loan_id:'loan-test',application_id:'APP-TEST',member_name:'Test member',status:'released',date_released:'2026-01-03',principal:1000,total_received:0,principal_paid:0,principal_remaining:1000,unallocated_payments:0,automatic_allocation:true,payments:[payment]},error:null};
        }
        if(name==='preview_counter_payment')return {data:{principal:90,interest:10,fee:0,penalty:0},error:null};
        if(name==='record_allocated_counter_payment'){
          const entry={...payment,id:'new-'+args.p_request_id,receipt_number:args.p_receipt,payment_amount:Number(args.p_amount),payment_date:args.p_date,principal_amount:args.p_reviewed_allocation.principal,interest_amount:args.p_reviewed_allocation.interest,created_at:'2026-11-10T10:00:00Z'};
          if(args.p_loan_id==='loan-paid')window.repaymentPayments.push(entry);
          return {data:entry,error:null};
        }
        if(name==='reverse_counter_payment'){
          const entry=window.repaymentPayments?.find(item=>item.id===args.p_payment_id)??payment;
          entry.payment_status='reversed';entry.reversal_reason=args.p_reason;entry.reversed_at='2026-11-10T10:00:00Z';return {data:entry,error:null};
        }
        return {data:{...loan,status:'released',date_released:args.p_date,release_reference:args.p_reference,interest_rate_at_release:2,processing_fee_amount_at_release:10,service_fee_amount_at_release:5,net_proceeds:985},error:null};
      }});` }); return;
  }
  let code = readFileSync(file, "utf8");
  if (/\.tsx?$/.test(file)) code = ts.transpileModule(code, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  code = code.replace(/require\(["']([^"']+)["']\)/g, (_, specifier) => {
    let target;
    if (specifier.endsWith("/AdminAuthProvider")) target = "auth-stub";
    else if(process.env.COOP_SETUP_QA&&["/committeeAuth","/committeeRequest","/supabase"].some(name=>specifier.endsWith(name)))target=resolve(root,"tests/fixtures/committee-setup-transport.ts");
    else if(process.env.COOP_LOGS_QA&&specifier.endsWith("/activeLogsRequest"))target=resolve(root,"tests/fixtures/active-logs-transport.ts");
    else if((process.env.COOP_ACTIVITY_QA||process.env.COOP_BRANDING_QA)&&specifier.endsWith("/adminNotifications"))target=resolve(root,"tests/fixtures/activity-notification-transport.ts");
    else if(process.env.COOP_PROFILE_QA&&specifier.endsWith("/profileRequest"))target=resolve(root,"tests/fixtures/profile-transport.ts");
    else if(process.env.COOP_BRANDING_QA&&(specifier.endsWith("/profileRequest")||specifier.endsWith("/committeeRequest")))target=resolve(root,"tests/fixtures/branding-profile.ts");
    else if (process.env.COOP_REVIEW_QA && (specifier.endsWith("/CommitteeAuthProvider") || specifier.endsWith("/committeeRequest") || specifier.endsWith("/committeeReviewRequest"))) target=resolve(root,"tests/fixtures/committee-review-transport.ts");
    else if (process.env.COOP_COMMITTEE_QA && (specifier.endsWith("/CommitteeAuthProvider") || specifier.endsWith("/committeeRequest"))) target=resolve(root,"tests/fixtures/committee-transport.ts");
    else if (process.env.COOP_PAGINATION_QA && specifier.endsWith('/memberNotifications')) target = 'notification-pagination-stub';
    else if (process.env.COOP_PAGINATION_QA && specifier.endsWith('/announcements')) target = 'announcement-pagination-stub';
    else if (specifier.endsWith("/protectedAction")) target = "transport-stub";
    else if (specifier === "next/link") target = "link-stub";
    else if (specifier === "next/image") target = "image-stub";
    else if (specifier === "next/navigation") target = "router-stub";
    else if (specifier.endsWith("/useNotificationInbox")) target = "inbox-stub";
    else if (specifier.endsWith("/adminRequest")) target = "documents-stub";
    else if (specifier.endsWith("/documentWorkspaceRequest")) target = resolve(root,"tests/fixtures/document-transport.ts");
    else if (specifier.endsWith("/applicationWorkflowRequest")) target = resolve(root,"tests/fixtures/verification-transport.ts");
    else if (process.env.COOP_WORKFLOW_QA && specifier==="@/lib/api") target="workflow-loans-stub";
    else if (process.env.COOP_BRANDING_QA && specifier==="@/lib/api") target=resolve(root,"tests/fixtures/branding-loans.ts");
    else if (process.env.COOP_WORKFLOW_QA && specifier.endsWith("/committeeReviewRequest")) target=resolve(root,"tests/fixtures/processing-transport.ts");
    else if (specifier.endsWith("/committeeReviewRequest")) target=resolve(root,"tests/fixtures/release-transport.ts");
    else if (specifier.endsWith("/profileRequest")) target = "profile-stub";
    else if (specifier.endsWith("/adminAccounts")) target = "accounts-stub";
    else if (specifier.endsWith("/adminPrivilegeRequest")) target = "privileges-stub";
    else if (specifier.endsWith("/supabase") || specifier === "./supabase") target = "supabase-stub";
    else if (specifier.startsWith(".") || specifier.startsWith("@/")) {
      const path = specifier.startsWith("@/") ? resolve(root, "src", specifier.slice(2)) : resolve(dirname(file), specifier);
      target = [path, `${path}.tsx`, `${path}.ts`, `${path}.js`].find(item => existsSync(item) && extname(item));
      if (!target) throw new Error(`Cannot resolve ${specifier} from ${file}`);
    } else target = require.resolve(specifier, { paths: [dirname(file), root] });
    bundle(target);
    return `require(${modules.get(target).index})`;
  });
  modules.set(file, { index, code });
}
const entry = resolve(root, process.env.COOP_SETUP_QA?"tests/fixtures/committee-setup.tsx":process.env.COOP_PROFILE_QA?"tests/fixtures/profile.tsx":process.env.COOP_LOGS_QA?"tests/fixtures/active-logs.tsx":process.env.COOP_BRANDING_QA ? "tests/fixtures/portal-branding.tsx" : process.env.COOP_ACTIVITY_QA ? "tests/fixtures/activity-notifications.tsx" : process.env.COOP_REVIEW_QA ? "tests/fixtures/committee-review.tsx" : process.env.COOP_COMMITTEE_QA ? "tests/fixtures/committee.tsx" : process.env.COOP_PAGINATION_QA ? "tests/fixtures/pagination.tsx" : "tests/fixtures/action-dialogs.tsx");
const client = require.resolve("react-dom/client");
bundle(entry); bundle(client);
const js = `var process={env:{NODE_ENV:"production"}};var windowGlobal=window;var calls=window.calls=[];var cache={};var modules={${[...modules.values()].map(({ index, code }) => `${index}:function(require,module,exports){${code}\n}`).join(",")}};function require(id){if(cache[id])return cache[id].exports;var module=cache[id]={exports:{}};modules[id](require,module,module.exports);return module.exports;}require(${modules.get(client).index}).createRoot(document.getElementById("root")).render(require(${modules.get(require.resolve("react")).index}).createElement(require(${modules.get(entry).index}).default));`;
const css = (await postcss([tailwind()]).process(readFileSync(resolve(root, "src/app/globals.css"), "utf8"), { from: resolve(root, "src/app/globals.css") })).css+readFileSync(resolve(root,"src/components/loan-applications/processing.module.css"),"utf8")+(process.env.COOP_LOGS_QA?readFileSync(resolve(root,"src/components/active-logs/ActiveLogs.module.css"),"utf8"):"")+(process.env.COOP_BRANDING_QA?readFileSync(resolve(root,"src/components/shared/Sidebar.module.css"),"utf8"):"");
const screenshots = resolve(root, process.env.COOP_DIALOG_TEST_SCREENSHOTS ?? "docs/action-ui-screenshots");
mkdirSync(screenshots, { recursive: true });
const server = createServer((request, response) => {
  if(request.url==='/images/coop-official-seal.jpg'){
    response.setHeader('Content-Type','image/jpeg');response.end(readFileSync(resolve(root,'public/images/coop-official-seal.jpg')));return;
  }
  response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'");
  response.setHeader("Content-Type", request.url === "/bundle.js" ? "application/javascript; charset=utf-8" : "text/html; charset=utf-8");
  response.end(request.url === "/bundle.js" ? js : `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Action dialog tests</title><style>${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === "win32" ? "msedge" : undefined) });
  const url = `http://127.0.0.1:${server.address().port}`;
  if(process.env.COOP_SETUP_QA){
    await checkCommitteeSetup({browser,url});
  } else if(process.env.COOP_PROFILE_QA){
    await checkProfile({browser,url});
  } else if(process.env.COOP_LOGS_QA){
    await checkActiveLogs({browser,url});
  } else if(process.env.COOP_BRANDING_QA){
    await checkPortalBranding({browser,url});
  } else if(process.env.COOP_ACTIVITY_QA){
    await checkActivityNotifications({browser,url,screenshots});
  } else if (process.env.COOP_REVIEW_QA) {
    await checkCommitteeReview({browser,url,screenshots});
  } else if (process.env.COOP_COMMITTEE_QA) {
    await checkCommittee({browser,url,screenshots});
  } else if (process.env.COOP_WORKFLOW_QA) {
    await checkVerification({browser,url});
  } else if (process.env.COOP_DOCUMENTS_QA) {
    await checkDocuments({browser,url,screenshots});
  } else if (process.env.COOP_PAGINATION_QA) {
    await checkPagination({browser,url});
  } else if (process.env.COOP_ACTIVE_LOANS_QA) {
    await checkActiveLoans({ browser, url });
  } else if (process.env.COOP_ACCOUNT_CREATION_QA) {
    await checkAccountCreation({ browser, url, phase:process.env.COOP_ACCOUNT_CREATION_QA });
  } else if (process.env.COOP_ACCOUNTS_QA) {
    await checkAccountActions({ browser, url });
  } else if (process.env.COOP_LOAN_REJECTION_QA) {
    await checkLoanRejectionUI({ browser, url });
  } else if (process.env.COOP_LOAN_DETAILS_PHASE) {
    await captureLoanDetails({ browser, url, phase: process.env.COOP_LOAN_DETAILS_PHASE });
  } else if (process.env.COOP_MODAL_PREVIEW_PHASE) {
    await captureModalPreviews({ browser, url, phase: process.env.COOP_MODAL_PREVIEW_PHASE });
  } else {
  await test("confirmation cancels/restores focus; double click executes once", async () => {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } }); await page.goto(url);
    await page.getByRole("button", { name: "Open confirmation" }).click();
    await page.screenshot({ path: resolve(screenshots, "desktop-confirmation.png") });
    assert.equal(await page.locator("main").evaluate(el => el.closest("[inert]") !== null), true);
    await page.keyboard.press("Escape");
    assert.equal(await page.getByLabel("Completed actions").textContent(), "0");
    assert.equal(await page.evaluate(() => document.activeElement.textContent), "Open confirmation");
    await page.getByRole("button", { name: "Open confirmation" }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).evaluate(el => { el.click(); el.click(); });
    await page.getByRole("dialog").waitFor({ state: "detached" });
    assert.equal(await page.getByLabel("Completed actions").textContent(), "1"); await page.close();
  });
  await test("form validates, traps focus, scrolls at mobile/desktop and protects unsaved changes", async () => {
    for (const viewport of [{ width: 390, height: 844 }, { width: 1366, height: 768 }]) {
      const page = await browser.newPage({ viewport }); await page.goto(url);
      await page.getByRole("button", { name: "Open form" }).click();
      await page.getByRole("button", { name: "Save", exact: true }).click();
      assert.equal(await page.getByRole("dialog").count(), 1);
      await page.getByLabel("Required value").fill("Unsaved");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Keep editing" }).click();
      assert.equal(await page.getByLabel("Required value").inputValue(), "Unsaved");
      const box = await page.getByRole("dialog").boundingBox(); assert.ok(box.width <= viewport.width && box.height <= viewport.height);
      await page.screenshot({ path: resolve(screenshots, `form-${viewport.width}.png`) });
      assert.equal(await page.locator(".ui-dialog-body").evaluate(el => el.scrollHeight > el.clientHeight), true);
      await page.getByRole("button", { name: "Save", exact: true }).focus(); await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]')), true);
      await page.keyboard.press("Escape"); await page.getByRole("button", { name: "Discard changes", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "detached" });
      assert.equal(await page.getByLabel("Completed actions").textContent(), "0"); await page.close();
    }
  });
  await test("secure provider retains verification, API error, grant, role gate and successful flow", async () => {
    const page = await browser.newPage(); await page.goto(url);
    await page.evaluate(() => { window.testRole = "admin"; });
    // Role is read when the provider renders; reload fixture with an init script.
    await page.addInitScript(() => { window.testRole = "admin"; }); await page.reload();
    await page.getByRole("button", { name: "Secure action" }).click(); assert.equal(await page.getByRole("dialog").count(), 0);
    await page.close();
    for (const failure of [true, false]) {
      const p = await browser.newPage(); await p.goto(url); await p.evaluate(value => { window.executeFailure = value; }, failure);
      await p.getByRole("button", { name: "Secure action" }).click();
      await p.locator('input[autocomplete="current-password"]').fill("test-only-password");
      await p.getByRole("button", { name: "Verify password" }).click();
      await p.getByRole("heading", { name: "Approve application" }).waitFor();
      assert.equal(await p.evaluate(() => window.calls.filter(call => call.mode === "execute").length), 0);
      await p.getByRole("button", { name: "Approve", exact: true }).evaluate(el => { el.click(); el.click(); });
      await p.getByRole("heading", { name: failure ? "Action Failed" : "Success", exact: true }).waitFor();
      assert.equal(await p.evaluate(() => window.calls.filter(call => call.mode === "execute").length), 1);
      assert.equal(await p.getByLabel("Completed actions").textContent(), failure ? "0" : "1");
      await p.keyboard.press("Escape"); assert.equal(await p.getByRole("dialog").count(), 1);
      await p.getByRole("button", { name: "OK", exact: true }).click();
      assert.equal(await p.getByRole("button", { name: "Secure action", exact: true }).evaluate(el => el === document.activeElement), true);
      await p.close();
    }
  });
  await test("release keeps acknowledgment, reviewed totals, backend failure and retry identity", async () => {
    const page = await browser.newPage(); await page.goto(url);
    await page.getByRole("button", { name: "Release loan", exact: true }).click();
    await page.getByLabel("Disbursement reference / voucher number").fill("DV-TEST");
    assert.equal(await page.getByRole("button", { name: "Review release", exact: true }).isDisabled(), true);
    await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "Review release", exact: true }).click();
    const confirmation = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Review release details" }) });
    assert.match(await confirmation.textContent(), /Test member/); assert.match(await confirmation.textContent(), /985\.00/);
    await page.screenshot({ path: resolve(screenshots, "release-review.png") });
    assert.equal(await page.evaluate(() => window.rpcCalls?.length ?? 0), 0);
    await page.getByRole("button", { name: "Confirm release", exact: true }).click();
    await confirmation.getByRole("alert").filter({hasText:"account password"}).waitFor();
    await confirmation.getByLabel("Your account password",{exact:true}).fill("Synthetic-Password1!");
    await page.evaluate(() => { window.financialFailure = true; });
    await page.getByRole("button", { name: "Confirm release", exact: true }).click();
    await confirmation.getByRole("alert").filter({hasText:"Backend rejected transaction"}).waitFor(); assert.equal(await page.getByLabel("Completed actions").textContent(), "0");
    await page.evaluate(() => { window.financialFailure = false; });
    await confirmation.getByLabel("Your account password",{exact:true}).fill("Synthetic-Password1!");
    await page.getByRole("button", { name: "Confirm release", exact: true }).evaluate(el => { el.click(); el.click(); });
    await page.getByRole("heading", { name: "Loan release recorded" }).waitFor();
    const calls = await page.evaluate(() => window.releaseCalls); assert.equal(calls.length, 2);
    assert.equal(calls[0].requestId, calls[1].requestId); assert.equal(calls[1].amount, 1000);assert.equal('password' in calls[1],false);
    await page.getByRole("button", { name: "Done", exact: true }).click(); assert.equal(await page.getByLabel("Completed actions").textContent(), "1"); await page.close();
  });
  await test("counter payment preserves amount, reviewed allocation, failure and double-submit protection", async () => {
    const page = await browser.newPage(); await page.goto(url);
    await page.getByRole("button", { name: "Counter payment", exact: true }).click();
    await page.getByLabel("Official receipt number").fill("OR-TEST"); await page.getByLabel("Amount paid").fill("100.00");
    await page.getByRole("button", { name: "Review payment", exact: true }).click();
    await page.getByRole("heading", { name: "Review payment allocation" }).waitFor();
    assert.equal(await page.evaluate(() => window.rpcCalls.filter(call => call.name.startsWith('record_')).length), 0);
    await page.evaluate(() => { window.financialFailure = true; });
    await page.getByRole("button", { name: "Confirm and record", exact: true }).click();
    await page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Review payment allocation" }) }).getByRole("alert").waitFor();
    assert.equal(await page.getByLabel("Completed actions").textContent(), "0");
    await page.evaluate(() => { window.financialFailure = false; });
    await page.getByRole("button", { name: "Confirm and record", exact: true }).evaluate(el => { el.click(); el.click(); });
    await page.getByRole("heading", { name: "Payment records updated" }).waitFor();
    const calls = await page.evaluate(() => window.rpcCalls.filter(call => call.name.startsWith('record_')));
    assert.equal(calls.length, 2); assert.equal(calls[0].args.p_request_id, calls[1].args.p_request_id);
    assert.equal(calls[1].args.p_amount, "100.00"); assert.deepEqual(calls[1].args.p_reviewed_allocation, {principal:90,interest:10,fee:0,penalty:0});
    await page.close();
  });
  await test("document deletion waits for confirmation, preserves API errors, and retains privilege gates", async () => {
    const page = await browser.newPage(); await page.goto(url); await page.getByRole("button", { name: "Documents", exact: true }).click();
    await page.getByRole('tab',{name:'Shared Documents'}).click();
    await page.getByRole('button',{name:'View details for Test document.pdf'}).click();
    await page.getByRole("button", { name: "Delete document", exact: true }).click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await page.evaluate(() => window.documentCalls?.length ?? 0), 0);
    await page.getByRole('button',{name:'View details for Test document.pdf'}).click();
    await page.getByRole("button", { name: "Delete document", exact: true }).click();
    await page.evaluate(() => { window.documentFailure = true; });
    await page.getByRole("button", { name: "Delete document", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Backend rejected deletion" }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "Document updated" }).count(), 0);
    await page.evaluate(() => { window.documentFailure = false; });
    await page.getByRole("button", { name: "Delete document", exact: true }).evaluate(el => { el.click(); el.click(); });
    await page.getByRole("heading", { name: "Document updated" }).waitFor();
    const calls = await page.evaluate(() => window.documentCalls); assert.equal(calls.length, 2); assert.equal(calls[1].method, "DELETE");
    assert.equal(JSON.parse(calls[1].body).id,"legacy:documents/Test-document.pdf"); await page.close();
    const admin = await browser.newPage(); await admin.addInitScript(() => { window.testRole = "admin"; }); await admin.goto(url);
    await admin.getByRole("button", { name: "Documents", exact: true }).click();
    await admin.getByRole('tab',{name:'Shared Documents'}).click();
    await admin.getByRole('button',{name:'View details for Test document.pdf'}).click();
    assert.equal(await admin.getByRole("button", { name: "Delete document", exact: true }).count(), 0); await admin.close();
  });
  await test("notification history uses the shared modal while recent alerts remain a popover", async () => {
    const page = await browser.newPage(); await page.goto(url);
    await page.getByRole("button", { name: "Open notifications", exact: true }).click();
    assert.equal(await page.getByRole("dialog").getAttribute("aria-modal"), "false");
    await page.getByRole("button", { name: "View All Notifications", exact: true }).click();
    await page.getByRole("heading", { name: "Notification Center", exact: true }).waitFor();
    assert.equal(await page.getByRole("dialog").getAttribute("aria-modal"), "true");
    await page.getByRole("button", { name: "Back to Recent", exact: true }).click();
    assert.equal(await page.getByRole("dialog").getAttribute("aria-modal"), "false");
    await page.getByRole("button", { name: "View All Notifications", exact: true }).click(); await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    assert.equal(await page.getByRole("button", { name: "Open notifications", exact: true }).evaluate(el => el === document.activeElement), true);
    await page.close();
  });
  await test("inline password validation and duplicate-submit protection remain effective", async () => {
    const page = await browser.newPage(); await page.goto(url);
    await page.getByRole("button", { name: "Password settings", exact: true }).click();
    await page.getByLabel("Current password", { exact: true }).fill("Existing-test-password!");
    await page.getByLabel("New password", { exact: true }).fill("New-test-password1!");
    await page.getByLabel("Confirm new password", { exact: true }).fill("Mismatch1!");
    await page.getByRole("button", { name: "Update Password", exact: true }).click();
    await page.getByRole("alert").waitFor(); assert.equal(await page.evaluate(() => window.profileCalls ?? 0), 0);
    await page.getByLabel("Confirm new password", { exact: true }).fill("New-test-password1!");
    await page.getByRole("button", { name: "Update Password", exact: true }).evaluate(el => { el.click(); el.click(); });
    await page.getByRole("status").filter({ hasText: "Password updated successfully" }).waitFor();
    assert.equal(await page.evaluate(() => window.profileCalls), 1); assert.equal(await page.getByLabel("Completed actions").textContent(), "1");
    await page.close();
  });
  await test("payment footer retains native required validation and dirty-close protection", async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); await page.goto(url);
    await page.getByRole("button", { name: "Counter payment", exact: true }).click();
    const review = page.getByRole("button", { name: "Review payment", exact: true });
    await review.waitFor();
    assert.equal(await review.evaluate(button => button.form?.id), "counter-payment-form");
    const footer = await page.locator(".ui-dialog-footer").boundingBox(); assert.ok(footer.y + footer.height <= 844);
    await review.click();
    assert.equal(await page.evaluate(() => window.rpcCalls.filter(call => call.name === 'preview_counter_payment').length), 0);
    await page.getByLabel("Official receipt number").fill("OR-DIRTY");
    await page.locator(".ui-dialog-footer").getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("heading", { name: "Discard unsaved changes?" }).waitFor();
    await page.getByRole("button", { name: "Keep editing", exact: true }).click();
    assert.equal(await page.getByLabel("Official receipt number").inputValue(), "OR-DIRTY");
    await page.close();
  });
  await test("nested document details restore focus and keep footer actions visible", async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); await page.goto(`${url}/?preview`);
    await page.getByRole("button", { name: "Loan details", exact: true }).click();
    await page.getByRole("heading", { name: "Loan Application Information", exact: true }).waitFor();
    await page.getByRole("button", { name: "View documents", exact: true }).click();
    await page.getByText("Synthetic supporting document.pdf", { exact: true }).waitFor();
    const active = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Application Documents", exact: true }) });
    const footer = await active.locator(".ui-dialog-footer").boundingBox(); assert.ok(footer.y + footer.height <= 844);
    await active.locator(".ui-dialog-footer").getByRole("button", { name: "Close", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "View documents", exact: true }).evaluate(button => button === document.activeElement), true);
    await page.keyboard.press("Escape"); await page.getByRole("dialog").waitFor({ state: "detached" });
    await page.close();
  });
  await test("reversal preserves reason gate, receipt identity and single mocked request", async () => {
    const page = await browser.newPage(); await page.goto(`${url}/?preview`);
    await page.getByRole("button", { name: "Repayment details", exact: true }).click();
    await page.getByRole("button", { name: "Reverse payment", exact: true }).click();
    const confirm = page.getByRole("button", { name: "Confirm reversal", exact: true });
    assert.equal(await confirm.isDisabled(), true);
    await page.getByLabel("Reason", { exact: true }).fill("Synthetic duplicate receipt");
    assert.match(await page.getByRole("dialog").last().textContent(), /OR-SYNTHETIC-001/);
    await confirm.evaluate(button => { button.click(); button.click(); });
    await page.getByRole("heading", { name: "Payment records updated", exact: true }).waitFor();
    const calls = await page.evaluate(() => window.rpcCalls.filter(call => call.name === 'reverse_counter_payment'));
    assert.equal(calls.length, 1); assert.equal(calls[0].args.p_payment_id, "payment-test"); assert.equal(calls[0].args.p_reason, "Synthetic duplicate receipt");
    await page.close();
  });
}
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
