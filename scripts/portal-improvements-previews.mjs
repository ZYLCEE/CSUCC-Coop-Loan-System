import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
export async function checkPortalImprovements({browser,url}){
 const directory=resolve('docs/portal-improvements/screenshots');mkdirSync(directory,{recursive:true});
 const errors=[];let reference;
 for(const role of ['super_admin','admin','crecom_member','bod_member']){
  for(const width of [1366,390]){
   const page=await browser.newPage({viewport:{width,height:900}});page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`${url}/?view=dashboard&role=${role}`);
   await page.getByRole('complementary',{name:'CSUCC ERMPC sidebar',exact:true}).waitFor();await page.waitForTimeout(200);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,role+' must fit');
   const header=page.getByRole('banner',{name:'Cooperative header and portal utilities'});
   const geometry=await header.evaluate(el=>{const copy=el.querySelector('.coop-letterhead-copy').getBoundingClientRect(),box=el.getBoundingClientRect(),bell=el.querySelector('.coop-portal-utilities>button').getBoundingClientRect();return {height:Math.round(box.height),center:Math.abs(copy.x+copy.width/2-box.x-box.width/2),bellWidth:bell.width,bellHeight:bell.height};});
   assert.ok(geometry.center<1,'The letterhead text stays centered for '+role);assert.equal(geometry.bellWidth,geometry.bellHeight);
   if(width===1366){if(!reference)reference=geometry;else assert.deepEqual(geometry,reference,'All four roles share header dimensions');}
   const badge=header.locator('button').filter({has:page.locator('span.bg-status-danger')}).locator('span.bg-status-danger').first();
   assert.ok(await badge.count()>0);const color=await badge.evaluate(el=>getComputedStyle(el).backgroundColor);const channels=color.match(/\d+/g).map(Number);assert.ok(channels[0]>channels[1]*2,'Unread counts use red');
   await page.screenshot({path:resolve(directory,`${role}-${width}.png`),fullPage:true});
   if(!role.includes('member')){
    const recent=page.getByRole('region',{name:'Recent loan applications table',exact:true});assert.equal(await recent.locator('tbody tr').count(),5);assert.equal(await recent.getByRole('button').count(),5);
    await recent.getByRole('button').first().click();const detail=page.getByRole('dialog',{name:'Loan Application Details'});await detail.waitFor();
    for(const label of ['Process Application','Return Application','Record Loan Release','Verify Document'])assert.equal(await detail.getByRole('button',{name:label,exact:true}).count(),0);
    assert.equal(await detail.getByRole('button',{name:'Close',exact:true}).count(),1);assert.equal(await page.evaluate(()=>(window.verificationCalls??[]).length),0);
   }
   await page.close();
  }
 }
 const page=await browser.newPage({viewport:{width:1366,height:900}});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url+'/?view=process');await page.getByRole('button',{name:'Open actions for APP-TEST',exact:true}).click();await page.getByRole('menuitem',{name:'Process Application',exact:true}).click();
 const process=page.getByRole('dialog',{name:'Process Application',exact:true});await process.waitFor();
 for(const label of ['Refresh','Return Application'])assert.equal(await process.getByRole('button',{name:label,exact:true}).count(),0);
 assert.equal(await process.getByText('Processing history & additional actions',{exact:true}).count(),0);
 await process.getByRole('button',{name:'Review Requirements',exact:true}).click();assert.equal(await page.evaluate(()=>(window.verificationCalls??[]).length),0,'Opening the review is read-only');
 for(const name of ['Member identity and application details checked','Membership eligibility and affordability checked','Loan amount, term and payment projection checked'])await process.getByLabel(name,{exact:true}).check();
 await process.getByRole('button',{name:'Verify & Send to CRECOM',exact:true}).click();let confirm=page.getByRole('dialog',{name:'Verify requirements and send to CRECOM?',exact:true});await confirm.getByRole('button',{name:'Continue',exact:true}).click();
 confirm=page.getByRole('dialog',{name:'Confirm your identity',exact:true});await confirm.getByLabel('Your account password',{exact:true}).fill('Synthetic-Password1!');await page.evaluate(()=>window.verificationFailure=true);await confirm.getByRole('button',{name:'Confirm & Send',exact:true}).click();await confirm.getByRole('alert').waitFor();assert.equal(await page.evaluate(()=>window.verificationData.enrolled),false);
 await page.evaluate(()=>window.verificationFailure=false);await confirm.getByRole('button',{name:'Confirm & Send',exact:true}).click();await page.getByRole('dialog',{name:'Action completed',exact:true}).getByRole('button',{name:'OK',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.verificationData.stage),'crecom_review');assert.equal(await page.evaluate(()=>new Set(window.verificationCalls.filter(row=>row.operation==='verify_and_forward').map(row=>row.requestId)).size),1,'Retry reuses the original request identity');await page.screenshot({path:resolve(directory,'requirements-sent-to-crecom.png'),fullPage:true});await page.close();
 const rejected=await browser.newPage({viewport:{width:1366,height:900}});rejected.on('pageerror',e=>errors.push(e.message));await rejected.goto(url+'/?view=process&state=rejected-review');await rejected.getByRole('button',{name:'Open actions for APP-TEST',exact:true}).click();await rejected.getByRole('menuitem',{name:'Process Application',exact:true}).click();await rejected.getByRole('button',{name:'Review Final Decision',exact:true}).click();
 const decision=rejected.getByRole('dialog',{name:'Reject Application',exact:true});await decision.getByLabel('Reason shown to the member',{exact:true}).fill('The application does not meet the recorded requirements.');await decision.getByRole('button',{name:'Continue',exact:true}).click();await decision.getByLabel('Your account password',{exact:true}).fill('Synthetic-Password1!');await decision.getByRole('button',{name:'Confirm Rejection',exact:true}).click();await rejected.getByRole('dialog',{name:'Application rejected',exact:true}).getByRole('button',{name:'OK',exact:true}).click();
 assert.equal(await rejected.evaluate(()=>window.verificationData.loanStatus),'rejected');assert.equal(await rejected.evaluate(()=>(window.reviewCalls??[]).filter(row=>row.operation==='forward_bod').length),0);await rejected.getByRole('button',{name:'Step 5: Release',exact:true}).click();await rejected.getByText('This application was rejected. It cannot be released.',{exact:true}).waitFor();await rejected.screenshot({path:resolve(directory,'crecom-rejection-release-blocked.png'),fullPage:true});await rejected.close();
 assert.deepEqual(errors,[]);console.log('PASS: four shared portal layouts, desktop/mobile bounds, red unread counts, five read-only Dashboard rows, requirements review without writes, confirmed routing/retry identity, committee rejection without BOD, and blocked release.');
}
