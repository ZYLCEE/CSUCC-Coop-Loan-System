import assert from "node:assert/strict";
import {resolve} from "node:path";
export async function checkCommitteeAccountActions({browser,url,screenshots}){
 const page=await browser.newPage({viewport:{width:1366,height:900}}),errors=[];
 page.on("pageerror",error=>errors.push(error.message));
 await page.goto(url+"?committee=accounts");
 const open=async name=>{await page.getByRole("button",{name:"Open actions for "+name,exact:true}).click();};
 const action=async name=>{await page.getByRole("menuitem",{name,exact:true}).click();};
 const verify=async()=>{await page.getByLabel("Your account password",{exact:true}).fill("Synthetic-Admin1!");await page.getByRole("button",{name:"Verify Password",exact:true}).click();};
 await open("Synthetic Maria Cruz");
 assert.deepEqual(await page.getByRole("menuitem").allTextContents(),["View Details","Edit","Reset Password","Block","Delete"]);
 await page.screenshot({path:resolve(screenshots,"committee-account-actions-menu.png")});
 await action("View Details");await page.getByRole("heading",{name:"Committee Account Details",exact:true}).waitFor();await page.getByRole("region",{name:"Reviewer assignments",exact:true}).waitFor();await page.getByRole("button",{name:"Close",exact:true}).click();
 await open("Synthetic Maria Cruz");await action("Edit");
 await page.getByLabel("Full name",{exact:true}).fill("Updated Committee Reviewer");await page.getByLabel("Reason",{exact:true}).fill("Correct reviewer name");await page.getByRole("button",{name:"Review",exact:true}).click();await verify();
 assert.equal(await page.evaluate(()=>window.committeeCalls.filter(call=>call.body?.operation==="edit").length),0);
 await page.getByRole("button",{name:"Save Changes",exact:true}).click();await page.getByRole("button",{name:"Open actions for Updated Committee Reviewer",exact:true}).waitFor();
 await open("Updated Committee Reviewer");await action("Reset Password");
 await page.getByLabel("Temporary Password",{exact:true}).fill("weak");await page.getByLabel("Confirm Temporary Password",{exact:true}).fill("different");await page.getByRole("button",{name:"Continue to Verify",exact:true}).click();await page.getByRole("alert").waitFor();
 await page.getByLabel("Temporary Password",{exact:true}).fill("Synthetic-Recovery1!");await page.getByLabel("Confirm Temporary Password",{exact:true}).fill("Synthetic-Recovery1!");
 await page.getByRole("button",{name:"Show temporary password",exact:true}).click();assert.equal(await page.getByLabel("Temporary Password",{exact:true}).getAttribute("type"),"text");assert.equal(await page.getByLabel("Confirm Temporary Password",{exact:true}).getAttribute("type"),"password");
 await page.getByLabel("Reason",{exact:true}).fill("Reviewer forgot the temporary password");await page.screenshot({path:resolve(screenshots,"committee-reset-password.png")});
 await page.getByRole("button",{name:"Continue to Verify",exact:true}).click();
 await page.evaluate(()=>{window.committeeFailure="Wrong administrator password";});await verify();await page.getByRole("alert").filter({hasText:"Wrong administrator password"}).waitFor();assert.equal(await page.getByLabel("Your account password",{exact:true}).inputValue(),"");
 await page.evaluate(()=>{window.committeeFailure=false;});await verify();
 await page.getByRole("button",{name:"Reset Password",exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.committeeCalls.filter(call=>call.body?.operation==="reset").length),0);
 assert.equal(await page.getByText("Synthetic-Recovery1!",{exact:false}).count(),0);
 await page.screenshot({path:resolve(screenshots,"committee-reset-confirmation.png")});
 await page.evaluate(()=>{window.committeeFailure="Synthetic reset failure. Retry this saved request.";});
 await page.getByRole("button",{name:"Reset Password",exact:true}).evaluate(button=>{button.click();button.click();});await page.getByRole("alert").filter({hasText:"Synthetic reset failure"}).waitFor();
 const first=await page.evaluate(()=>window.committeeCalls.find(call=>call.body?.operation==="reset").body);
 await page.evaluate(()=>{window.committeeFailure=false;});await verify();await page.getByRole("button",{name:"Reset Password",exact:true}).click();
 await page.getByRole("region",{name:"Committee accounts",exact:true}).getByText("Password setup pending",{exact:true}).waitFor();
 const resets=await page.evaluate(()=>window.committeeCalls.filter(call=>call.body?.operation==="reset").map(call=>call.body));assert.equal(resets.length,2);assert.equal(resets[1].requestId,first.requestId);assert.deepEqual(resets[1].credentials,first.credentials);
 for(const [menu,button] of [["Block","Block Account"],["Unblock","Unblock Account"]]){
  await open("Updated Committee Reviewer");await action(menu);await page.getByLabel("Reason",{exact:true}).fill(menu+" committee access");await page.getByRole("button",{name:"Review",exact:true}).click();await verify();await page.getByRole("button",{name:button,exact:true}).click();await page.getByRole("button",{name:"Open actions for Updated Committee Reviewer",exact:true}).waitFor();
 }
 await page.setViewportSize({width:390,height:844});await open("Updated Committee Reviewer");await page.screenshot({path:resolve(screenshots,"committee-account-actions-mobile.png")});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await action("Delete");
 await page.getByLabel("Reason",{exact:true}).fill("Committee membership ended");await page.getByRole("button",{name:"Continue to Verify",exact:true}).click();await verify();
 await page.getByText("This cannot be undone. Past decisions and assignment history remain recorded. Open reviews must be reassigned.",{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.committeeCalls.some(call=>call.body?.operation==="delete")),false);
 await page.getByRole("button",{name:"Delete Account",exact:true}).click();await page.getByText("No committee accounts.",{exact:true}).waitFor();
 assert.deepEqual(errors,[]);await page.close();
 const pending=await browser.newPage();await pending.addInitScript(()=>{window.committeeActionsUnavailable=true;});await pending.goto(url+"?committee=accounts");await pending.getByRole("button",{name:"Open actions for Synthetic Maria Cruz",exact:true}).click();assert.equal(await pending.getByRole("menuitem",{name:"Reset Password",exact:true}).isDisabled(),true);assert.equal(await pending.getByRole("menuitem",{name:"Delete",exact:true}).isDisabled(),true);await pending.close();
 console.log("PASS: matching account menu, details/edit, independent password visibility, verify-before-confirm, no secret in summary, safe reset retry, Block/Unblock/Delete, deployment capability and mobile layout.");
}
