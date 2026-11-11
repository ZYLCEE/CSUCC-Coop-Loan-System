import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {homedir} from "node:os";
import {resolve} from "node:path";
import {mkdirSync} from "node:fs";
const require=createRequire(import.meta.url);
let playwright;try{playwright=require("playwright");}catch{playwright=require(resolve(homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));}
const browser=await playwright.chromium.launch({channel:"msedge",headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),errors=[],liveRequests=[];
page.on("pageerror",error=>errors.push(error.message));
await context.route("**/*",async route=>{
 const url=new URL(route.request().url());
 if(url.hostname.endsWith("supabase.co")||url.pathname.startsWith("/api/")){liveRequests.push(url.origin+url.pathname);return route.abort();}
 return route.continue();
});
const base="http://localhost:3000/prototype/committee",out="docs/committee-prototype/screenshots";
mkdirSync(out,{recursive:true});
const choose=async label=>{await page.goto(base);await page.getByRole("button",{name:"Use "+label,exact:true}).click();await page.getByRole("button",{name:"Open prototype portal",exact:true}).click();await page.getByRole("heading",{name:"Applications Requiring My Review",exact:true}).waitFor();};
const openCase=async id=>{const row=page.getByRole("region",{name:"My assigned applications",exact:true}).locator("tbody tr").filter({hasText:id});await row.getByRole("link",{name:"View packet",exact:true}).click();await page.getByRole("heading",{name:id,exact:true}).waitFor();};
try{
 await page.goto(base);await page.getByRole("heading",{name:"Explore the committee portals"}).waitFor();
 assert.equal(await page.getByRole("button",{name:/^Use /}).count(),4);
 await page.screenshot({path:resolve(out,"prototype-sign-in.png"),fullPage:true});
 await page.getByLabel("Prototype email",{exact:true}).fill("crecom1@prototype.example.invalid");await page.getByLabel("Prototype password",{exact:true}).fill("wrong");
 await page.getByRole("button",{name:"Open prototype portal",exact:true}).click();await page.getByRole("alert").filter({hasText:"displayed prototype"}).waitFor();
 await page.evaluate(()=>localStorage.setItem("real-session-sentinel","unchanged"));
 const people=[["CRECOM Member 1","Crecom1!Demo2026"],["CRECOM Member 2","Crecom2!Demo2026"],["CRECOM Chairperson","CrecomChair!Demo2026"]];
 for(const [index,[label,password]]of people.entries()){
  await choose(label);
  if(index===0){await page.screenshot({path:resolve(out,"crecom-dashboard.png"),fullPage:true});await page.getByRole("link",{name:"My Profile",exact:true}).first().click();assert.equal(await page.getByRole("button",{name:"Update password",exact:true}).isDisabled(),true);await page.getByRole("link",{name:"Applications",exact:true}).first().click();}
  await openCase("PROTO-2026-0001");
  if(index===0){
   await page.getByRole("button",{name:"View document",exact:true}).click();assert.equal(await page.getByRole("link",{name:"Open original",exact:true}).getAttribute("href"),"/prototype/sample-document.svg");await page.getByRole("button",{name:"Close",exact:true}).click();
  }
  await page.getByRole("button",{name:"Approve this packet",exact:true}).click();await page.getByLabel(/I reviewed packet v1/).check();
  await page.getByLabel("Your account password",{exact:true}).fill(password);
  await page.getByRole("button",{name:"Record my decision",exact:true}).click();await page.getByRole("heading",{name:"My recorded confirmation",exact:true}).waitFor();
  assert.equal(await page.getByRole("button",{name:"Approve this packet",exact:true}).count(),0);
 }
 await choose("BOD Chairperson");await openCase("PROTO-2026-0001");
 const confirmations=page.getByRole("region",{name:"CRECOM confirmations",exact:true});await confirmations.waitFor();assert.equal(await confirmations.locator("tbody tr").count(),3);
 await page.screenshot({path:resolve(out,"bod-crecom-confirmations.png"),fullPage:true});
 await page.getByRole("button",{name:"Approve this packet",exact:true}).click();await page.getByLabel(/I reviewed packet v1/).check();await page.getByLabel("Your account password",{exact:true}).fill("BodChair!Demo2026");await page.getByRole("button",{name:"Record my decision",exact:true}).click();await page.getByRole("heading",{name:"My recorded confirmation",exact:true}).waitFor();
 await page.getByText("Sample approval flow",{exact:true}).click();await page.getByText("PROTO-2026-0001: Ready for staff final decision",{exact:true}).waitFor();
 await page.reload();await page.getByRole("heading",{name:"My recorded confirmation",exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve(out,"bod-mobile.png"),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 await page.getByRole("button",{name:"Toggle sidebar",exact:true}).click();await page.getByRole("button",{name:"Sign out",exact:true}).click();await page.getByRole("heading",{name:"Explore the committee portals"}).waitFor();assert.equal(await page.evaluate(()=>localStorage.getItem("real-session-sentinel")),"unchanged");
 await page.setViewportSize({width:1440,height:900});await choose("CRECOM Member 1");
 await page.getByRole("button",{name:"Reset prototype",exact:true}).click();await page.getByRole("button",{name:"Reset sample data",exact:true}).click();await openCase("PROTO-2026-0001");await page.getByRole("button",{name:"Approve this packet",exact:true}).waitFor();
 assert.deepEqual(liveRequests,[]);assert.deepEqual(errors,[]);
 console.log("PASS: four prototype identities, independent confirmations, BOD handoff and summary, local persistence/reset, documents/profile/mobile, and zero real API or Auth requests.");
}catch(error){await page.screenshot({path:resolve(out,"failure.png"),fullPage:true});console.error({url:page.url(),errors,liveRequests});throw error;}finally{await browser.close();}
