import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {homedir} from "node:os";
import {resolve} from "node:path";
import {mkdirSync} from "node:fs";
const accounts=JSON.parse(process.env.COOP_DEMO_ACCOUNT_INPUT??"null");
if(!Array.isArray(accounts)||accounts.length!==4)throw new Error("Supply the four private test credentials through COOP_DEMO_ACCOUNT_INPUT.");
const require=createRequire(import.meta.url);let playwright;
try{playwright=require("playwright");}catch{playwright=require(resolve(homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));}
const browser=await playwright.chromium.launch({channel:"msedge",headless:true}),context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),errors=[],live=[];
page.on("pageerror",error=>errors.push(error.message));
await context.route("**/*",async route=>{
 const url=new URL(route.request().url());
 if(url.hostname.endsWith("supabase.co")||url.pathname.startsWith("/api/")&&!url.pathname.startsWith("/api/committee-demo")){live.push(url.pathname);return route.abort();}
 return route.continue();
});
const origin="http://localhost:3000",out="docs/shared-committee-login/screenshots";mkdirSync(out,{recursive:true});let stage="shared login";
const signOut=async()=>{await page.getByRole("button",{name:"Switch account",exact:true}).click();await page.waitForURL(origin+"/login");};
const signIn=async account=>{
 await page.goto(origin+"/login");await page.locator("#login-email").fill(account.email);await page.locator("#login-password").fill(account.password);await page.getByRole("button",{name:"Sign In",exact:true}).click();
 await page.waitForURL(origin+(account.id==="bod-chair"?"/bod":"/crecom")+"/dashboard");await page.getByRole("heading",{name:"My Assigned Applications",exact:true}).waitFor();
 assert.equal(await page.getByText("Committee demonstration",{exact:true}).count(),1);
};
const openCase=async()=>{await page.getByRole("region",{name:"My assigned applications",exact:true}).locator("tbody tr").filter({hasText:"PROTO-2026-0001"}).getByRole("link",{name:"View packet",exact:true}).click();await page.getByRole("heading",{name:"PROTO-2026-0001",exact:true}).waitFor();};
try{
 await page.goto(origin+"/login");assert.equal(await page.getByRole("link",{name:/Explore prototype/}).count(),0);
 await page.locator("#login-email").fill(accounts[0].email);await page.locator("#login-password").fill("Synthetic-Wrong!2026");await page.getByRole("button",{name:"Sign In",exact:true}).click();await page.getByRole("alert").filter({hasText:/incorrect/}).waitFor();
 for(const [index,account]of accounts.entries()){
  stage=account.id+" sign-in";
  await signIn(account);
  if(index===0){await page.getByRole("button",{name:"Reset sample data",exact:true}).click();await page.getByRole("button",{name:"Reset samples",exact:true}).click();await page.screenshot({path:resolve(out,"crecom-dashboard.png"),fullPage:true});}
  stage=account.id+" sample packet";await openCase();
  if(index===3){const summary=page.getByRole("region",{name:"CRECOM confirmations",exact:true});await summary.waitFor();assert.equal(await summary.locator("tbody tr").count(),3);await page.screenshot({path:resolve(out,"bod-confirmations.png"),fullPage:true});}
  stage=account.id+" password confirmation";await page.getByRole("button",{name:"Approve this packet",exact:true}).click();await page.getByLabel(/I reviewed packet v1/).check();
  if(index===0){await page.getByLabel("Your account password",{exact:true}).fill("Synthetic-Wrong!2026");await page.getByRole("button",{name:"Record my decision",exact:true}).click();await page.getByRole("alert").filter({hasText:/password could not/}).waitFor();}
  await page.getByLabel("Your account password",{exact:true}).fill(account.password);await page.getByRole("button",{name:"Record my decision",exact:true}).click();await page.getByRole("heading",{name:"My recorded confirmation",exact:true}).waitFor();
  assert.equal((await page.locator("body").innerText()).includes(account.password),false);
  if(index===3){await page.getByText("Sample approval flow",{exact:true}).click();await page.getByText("PROTO-2026-0001: Ready for Super Admin final decision",{exact:true}).waitFor();await page.reload();await page.getByRole("heading",{name:"My recorded confirmation",exact:true}).waitFor();}
  stage=account.id+" sign-out";await signOut();console.log("Verified demonstration account: "+account.id);
 }
 const access=await context.request.get(origin+"/api/committee-demo");assert.equal((await access.json()).account,null);
 assert.deepEqual(live,[]);assert.deepEqual(errors,[]);
 console.log("PASS: all four supplied accounts use the existing login page, route to the correct portal, require their own passwords for sample confirmations, preserve the CRECOM/BOD handoff and sign out without real Auth or business API calls.");
}catch{await page.screenshot({path:resolve(out,"failure.png"),fullPage:true});console.error("Shared committee login walkthrough failed at "+stage+". Diagnostics omit credentials.");process.exitCode=1;}finally{await browser.close();}
