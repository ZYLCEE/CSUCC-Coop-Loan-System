import assert from "node:assert/strict";
import {resolve} from "node:path";
export async function checkActivityNotifications({browser,url,screenshots}){
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on("pageerror",error=>errors.push(error.message));
 await page.goto(url);const table=page.getByRole("region",{name:"Activity notification history",exact:true});await table.waitFor();
 assert.equal(await table.locator("tbody tr").count(),10);
 await page.getByRole("button",{name:"Next page",exact:true}).click();assert.equal(await page.getByRole("button",{name:"Page 2",exact:true}).getAttribute("aria-current"),"page");
 await page.getByRole("button",{name:"Previous page",exact:true}).click();
 await page.getByRole("combobox",{name:"Activity category",exact:true}).selectOption("approvals");
 await page.waitForFunction(()=>document.querySelectorAll("tbody tr").length===7);
 assert.match(await table.innerText(),/CRECOM approval recorded/);
 await page.getByRole("combobox",{name:"Activity category",exact:true}).selectOption("all");
 await page.getByLabel("Search activity",{exact:true}).fill("Sample Member 22");await page.getByRole("button",{name:"Search",exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll("tbody tr").length===1);
 await page.getByRole("button",{name:"Search",exact:true}).click();await table.waitFor();
 await page.getByLabel("Search activity",{exact:true}).fill("");await page.getByRole("button",{name:"Search",exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll("tbody tr").length===10);
 await table.getByRole("button",{name:"Mark read",exact:true}).first().click();await page.getByText(/^22 unread/).waitFor();
 await page.evaluate(()=>{window.activityRows.push({id:"live-bod",title:"BOD approval recorded",message:"SAMPLE-LIVE is ready for final decision",category:"approvals",type:"info",read:false,createdAt:"2026-11-12T00:00:00Z",entityType:"application",entityKey:"SAMPLE-LIVE"});for(const notify of window.activityListeners)notify();});
 await page.getByText("BOD approval recorded",{exact:true}).waitFor();
 assert.equal(await table.locator("tbody tr").first().getByRole("link",{name:"View",exact:true}).getAttribute("href"),"/super-admin/loan-applications");
 await page.screenshot({path:resolve(screenshots,"activity-inbox.png"),fullPage:true});
 await page.getByRole("button",{name:"Mark all read",exact:true}).click();await page.getByText(/^0 unread/).waitFor();
 await page.getByRole("combobox",{name:"Activity read status",exact:true}).selectOption("unread");await page.getByText("No activity notifications found",{exact:true}).waitFor();
 await page.getByRole("button",{name:"Demonstration",exact:true}).click();await page.getByRole("heading",{name:"Committee demonstration activity",exact:true}).waitFor();
 await page.addInitScript(()=>{window.testRole="admin";window.testPrivileges=[];});await page.goto(url);await table.waitFor();assert.equal(await page.getByRole("button",{name:"Send to members",exact:true}).count(),0);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve(screenshots,"activity-inbox-mobile.png"),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 assert.deepEqual(errors,[]);await page.close();console.log("PASS: activity inbox categories/search, numbered pagination, individual/bulk read, simulated realtime updates, safe destinations, Admin read access and mobile layout.");
}
