import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Isolated real components and mocked transport only. Never uses localhost:3000 or live accounts.
export async function checkLoanRejectionUI({ browser, url }) {
 const directory=resolve('docs/loan-rejection-qa/screenshots');mkdirSync(directory,{recursive:true});const metrics=[];
 const openMenu=async page=>{const button=page.getByRole('button',{name:'Open actions for APP-TEST',exact:true});await button.scrollIntoViewIfNeeded();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await button.click();};
 const reason='The submitted supporting documents do not establish the requested application requirements.';
 for(const viewport of[{width:1366,height:768},{width:768,height:1024},{width:390,height:844}]){
  const context=await browser.newContext({viewport,locale:'en-PH',timezoneId:'Asia/Manila'});
  await context.route('**/*',route=>{const u=new URL(route.request().url());return u.origin===new URL(url).origin&&['/','/bundle.js'].includes(u.pathname)?route.continue():route.abort();});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.refreshCount=0;window.addEventListener('qa-loan-refreshed',()=>window.refreshCount++);window.executeFailureMessage='The application could not be rejected. Please try again.';});
  const shot=async name=>{
   const dialog=page.getByRole('dialog').last();if(name.includes('error')&&await dialog.getByRole('alert').count())await dialog.getByRole('alert').first().scrollIntoViewIfNeeded();
   if(await dialog.count()){
    const measure=await dialog.evaluate(el=>{const r=el.getBoundingClientRect(),f=el.querySelector('.ui-dialog-footer').getBoundingClientRect();return {width:r.width,height:r.height,horizontalOverflow:el.scrollWidth>el.clientWidth,footerVisible:f.bottom<=innerHeight,bounded:r.x>=0&&r.y>=0&&r.bottom<=innerHeight&&r.right<=innerWidth};});
    assert.ok(measure.bounded&&measure.footerVisible&&!measure.horizontalOverflow,`${name}: ${JSON.stringify(measure)}`);assert.ok(measure.width<=(name==="rejection-details"?900:540));metrics.push({name,viewport,...measure});
   }
   await page.screenshot({path:resolve(directory,`${name}-${viewport.width}.png`)});
  };
  await page.goto(`${url}/?preview`);await page.getByRole('button',{name:'Loan application actions',exact:true}).click();
  await openMenu(page);await page.getByRole('menuitem',{name:'Reject Application',exact:true}).waitFor();await shot('action-menu');
  await page.getByRole('menuitem',{name:'Reject Application',exact:true}).click();await page.getByRole('heading',{name:'Reject Loan Application',exact:true}).waitFor();await shot('reason-form');
  const textarea=await page.locator('#loan-rejection-reason').boundingBox();const form=await page.locator('#loan-rejection-form').boundingBox();const label=await page.locator('label[for="loan-rejection-reason"] > span').boundingBox();assert.ok(textarea.width>=form.width*0.95);assert.ok(label.y+label.height<=textarea.y);
  const initialDialog=page.getByRole('dialog').last();await initialDialog.locator('button').first().focus();await page.keyboard.press('Shift+Tab');assert.equal(await initialDialog.locator('button').last().evaluate(el=>el===document.activeElement),true);await page.keyboard.press('Tab');assert.equal(await initialDialog.locator('button').first().evaluate(el=>el===document.activeElement),true);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.evaluate(()=>window.calls.length),0);
  await openMenu(page);await page.getByRole('menuitem',{name:'Reject Application',exact:true}).click();
  await page.getByRole('button',{name:'Reject Application',exact:true}).click();assert.equal(await page.getByLabel('Reason for Rejection',{exact:false}).evaluate(el=>el.validity.valueMissing),true);assert.equal(await page.evaluate(()=>window.calls.length),0);
  await page.getByLabel('Reason for Rejection',{exact:false}).fill('   ');await page.getByRole('button',{name:'Reject Application',exact:true}).click();await page.getByText('Please enter a reason for rejecting this application.',{exact:true}).waitFor();await shot('validation-error');
  await page.getByLabel('Reason for Rejection',{exact:false}).fill(`  ${reason}  `);await page.keyboard.press('Escape');await page.getByRole('heading',{name:'Discard unsaved changes?'}).waitFor();await page.getByRole('button',{name:'Keep editing',exact:true}).click();assert.equal(await page.evaluate(()=>window.calls.length),0);
  await page.getByRole('button',{name:'Reject Application',exact:true}).click();await page.getByRole('heading',{name:'Verify to reject loan',exact:true}).waitFor();await shot('password-verification');
  await page.getByRole('dialog').last().getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.evaluate(()=>window.calls.length),0);assert.equal(await page.getByLabel('Reason for Rejection',{exact:false}).inputValue(),`  ${reason}  `);await page.getByRole('button',{name:'Reject Application',exact:true}).click();await page.getByRole('heading',{name:'Verify to reject loan',exact:true}).waitFor();
  await page.evaluate(()=>{window.verifyFailure=true;});await page.locator('input[autocomplete="current-password"]').fill('synthetic-password');await page.getByRole('button',{name:'Verify password',exact:true}).click();await page.getByText('Password rejected',{exact:true}).waitFor();await shot('password-error');
  assert.equal(await page.locator('#loan-rejection-reason').inputValue(),`  ${reason}  `);
  await page.evaluate(()=>{window.verifyFailure=false;});await page.getByRole('button',{name:'Verify password',exact:true}).click();
  await page.getByRole('heading',{name:'Verify to reject loan',exact:true}).waitFor({state:'detached'});const confirm=page.getByRole('dialog').last();await confirm.getByText(reason,{exact:true}).waitFor();assert.ok((await confirm.innerText()).includes('Maria Dela Cruz'));assert.ok((await confirm.innerText()).includes('₱60,000.00'));await shot('final-confirmation');
  const countBefore=await page.evaluate(()=>window.calls.filter(c=>c.mode==='execute').length);
  await page.evaluate(()=>{window.executeFailure=true;window.protectedActionDelay=800;});
  await confirm.getByRole('button',{name:'Reject Application',exact:true}).evaluate(el=>{el.click();el.click();});await shot('submitting');
  await page.getByRole('heading',{name:'Action Failed',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.mode==='execute').length),countBefore+1);assert.equal(await page.evaluate(()=>window.refreshCount),0);await shot('server-error');
  await page.getByRole('button',{name:'OK',exact:true}).click();assert.equal(await page.getByLabel('Reason for Rejection',{exact:false}).inputValue(),`  ${reason}  `);await shot('preserved-reason');
  const firstRequest=await page.evaluate(()=>window.calls.find(c=>c.mode==='execute').payload);
  await page.evaluate(()=>{window.executeFailure=false;window.protectedActionDelay=100;});await page.getByRole('button',{name:'Reject Application',exact:true}).click();await page.locator('input[autocomplete="current-password"]').fill('synthetic-password');await page.getByRole('button',{name:'Verify password',exact:true}).click();await page.getByRole('heading',{name:'Verify to reject loan',exact:true}).waitFor({state:'detached'});await page.getByRole('dialog').last().getByText(reason,{exact:true}).waitFor();
  await page.getByRole('dialog').last().getByRole('button',{name:'Reject Application',exact:true}).click();assert.equal(await page.getByRole('heading',{name:'Loan Application Rejected',exact:true}).count(),0);
  await page.getByRole('heading',{name:'Loan Application Rejected',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.refreshCount),1);await shot('success');
  const latest=await page.evaluate(()=>window.calls.filter(c=>c.mode==='execute').at(-1));assert.equal(latest.action,'reject-loan');assert.equal(latest.target,'APP-TEST');assert.equal(latest.payload.reason,reason);assert.equal(latest.payload.request_id,firstRequest.request_id);assert.equal(latest.payload.expected_status,'under review');assert.ok(latest.grant);
  await page.getByRole('button',{name:'OK',exact:true}).click();assert.equal(await page.getByRole('dialog').count(),0);
  await page.goto(`${url}/?preview`);await page.evaluate(({reason})=>{window.loanDetailsRecord={status:'rejected'};window.syntheticRejection={reason,rejected_at:'2026-11-10T00:00:00Z',rejected_by:'Recorded administrator'};},{reason});
  await page.getByRole('button',{name:'Loan details',exact:true}).click();await page.getByRole('heading',{name:'Rejection Information',exact:true}).waitFor();await page.getByText(reason,{exact:true}).waitFor();await page.getByRole('dialog').last().locator('section').last().scrollIntoViewIfNeeded();await shot('rejection-details');assert.equal(await page.getByRole('button',{name:'Open payment history',exact:true}).count(),0);
  await page.keyboard.press('Tab');assert.equal(await page.getByRole('dialog').last().evaluate(el=>el.contains(document.activeElement)),true);await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);assert.deepEqual(errors,[]);await context.close();
 }
 // Actual table controls: seven statuses, ordinary Admin, and unupgraded backend.
 for(const scenario of [...['Pending','Under Review','Approved','Rejected','Released','Completed','Overdue'].map(status=>({status,role:'super_admin',unavailable:false})),{status:'Under Review',role:'admin',unavailable:false},{status:'Under Review',role:'super_admin',unavailable:true}]){
  const context=await browser.newContext();await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin?route.continue():route.abort());const page=await context.newPage();
  await page.addInitScript(s=>{window.testRole=s.role;window.rejectionUnavailable=s.unavailable;},scenario);await page.goto(`${url}/?preview&loanStatus=${encodeURIComponent(scenario.status)}`);await page.getByRole('button',{name:'Loan application actions',exact:true}).click();await openMenu(page);
  const expected=scenario.role==='super_admin'&&!scenario.unavailable&&['Pending','Under Review'].includes(scenario.status);if(expected)await page.getByRole('menuitem',{name:'Reject Application',exact:true}).waitFor();assert.equal(await page.getByRole('menuitem',{name:'Reject Application',exact:true}).count(),expected?1:0);
  const expectedMenu=['View Details','View Documents','Process Application'];
  if(scenario.role==='super_admin'){
   if(scenario.status==='Approved')expectedMenu.push('Mark as Released');
   if(scenario.status==='Pending')expectedMenu.push('Move to Under Review');
   if(['Pending','Under Review'].includes(scenario.status))expectedMenu.push('Approve Application');
   if(expected)expectedMenu.push('Reject Application');
  }
  assert.deepEqual((await page.getByRole('menuitem').allTextContents()).map(text=>text.trim()),expectedMenu);
  assert.equal(await page.getByRole('menuitem',{name:'View Details',exact:true}).count(),1);assert.equal(await page.getByRole('menuitem',{name:'View Documents',exact:true}).count(),1);assert.equal(await page.evaluate(()=>window.calls.length),0);await context.close();
 }
 writeFileSync(resolve(directory,'metrics.json'),JSON.stringify(metrics,null,2));console.log('Rejection UI: three viewports, all stages, preserved reason, single-submit/retry identity, private details and nine menu scenarios passed.');
}
