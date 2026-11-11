import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
export async function checkActiveLogs({browser,url}){
 const directory=resolve('docs/active-logs/screenshots');mkdirSync(directory,{recursive:true});
 const page=await browser.newPage({viewport:{width:1593,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(url);await page.getByRole('heading',{name:'Active Logs',exact:true}).waitFor();
 await page.getByText('Synthetic Super Admin',{exact:true}).waitFor();
 assert.equal(await page.getByRole('columnheader').count(),9);await page.getByRole('status').filter({hasText:'Live updates'}).waitFor();
 assert.equal(await page.getByRole('option',{name:'Member',exact:true}).count(),1);
 const superRow=page.getByRole('row').filter({has:page.getByText('Synthetic Super Admin',{exact:true})});
 assert.match(await superRow.getByText('Super Admin',{exact:true}).getAttribute('class'),/text-status-warning/);
 assert.equal(await superRow.getByText('CSUCC-2026-0001',{exact:true}).count(),1);
 await page.screenshot({path:resolve(directory,'active-logs-desktop.png'),fullPage:true});
 await page.getByRole('button',{name:'Next page',exact:true}).click();
 await page.waitForFunction(()=>window.logQueries.at(-1).page===2);await page.getByText('Synthetic Admin 14',{exact:true}).waitFor();
 await page.getByLabel('Rows per page',{exact:true}).selectOption('25');await page.getByText('Synthetic Admin 0',{exact:true}).waitFor();
 await page.getByLabel('Filter role',{exact:true}).selectOption('bod_member');await page.getByText('Synthetic Super Admin',{exact:true}).waitFor({state:'detached'});await page.getByText('Committee Rejection',{exact:true}).waitFor();assert.equal(await page.getByText('Synthetic Super Admin',{exact:true}).count(),0);
 await page.getByLabel('Filter role',{exact:true}).selectOption('');
 await page.getByLabel('From Date',{exact:true}).fill('2026-11-11');await page.getByLabel('To Date',{exact:true}).fill('2026-11-11');await page.getByText('Synthetic CRECOM Member',{exact:true}).waitFor();
 await page.getByText('Synthetic BOD Chairperson',{exact:true}).waitFor({state:'detached'});assert.equal(await page.getByText('Synthetic BOD Chairperson',{exact:true}).count(),0);
 await page.getByLabel('Search Active Logs',{exact:true}).fill('Synthetic Super Admin');await page.waitForFunction(()=>window.logQueries.at(-1).search==='Synthetic Super Admin');
 await page.getByText('Synthetic Super Admin',{exact:true}).waitFor();
 await page.evaluate(()=>{window.logRows[0].sessionState='closed';window.logRows[0].timeOut='2026-11-11T08:15:00Z';window.logPush();});
 await superRow.getByRole('cell',{name:'Active',exact:true}).waitFor({state:'detached'});
 assert.equal(await page.getByLabel('Search Active Logs',{exact:true}).inputValue(),'Synthetic Super Admin');
 await page.getByLabel('Search Active Logs',{exact:true}).fill('');await page.getByLabel('From Date',{exact:true}).fill('');await page.getByLabel('To Date',{exact:true}).fill('');
 await page.evaluate(()=>{window.logRows.unshift({...window.logRows[0],id:'live-new',name:'Synthetic Live Reviewer',role:'crecom_member',action:'Verify Requirements',sessionState:'activity',timeOut:null});window.logPush();});
 await page.getByText('Synthetic Live Reviewer',{exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve(directory,'active-logs-mobile.png'),fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.evaluate(()=>{window.logFailure=true;window.logPush();});await page.getByRole('alert').filter({hasText:'Synthetic log service unavailable'}).waitFor();
 await page.evaluate(()=>{window.logFailure=false;});await page.getByRole('button',{name:'Retry',exact:true}).click();await page.getByRole('alert').waitFor({state:'detached'});
 await page.close();
 const admin=await browser.newPage();admin.on('pageerror',error=>errors.push(error.message));await admin.addInitScript(()=>{window.testRole='admin';});await admin.goto(url);
 await admin.getByText('Synthetic CRECOM Member',{exact:true}).waitFor();assert.equal(await admin.getByText('Synthetic Super Admin',{exact:true}).count(),0);assert.equal(await admin.getByRole('option',{name:'Super Admin',exact:true}).count(),0);
 await admin.close();assert.deepEqual(errors,[]);
 for(const [role,name] of [['member','Synthetic Member'],['crecom_member','Synthetic CRECOM Member'],['bod_member','Synthetic BOD Chairperson']]){
  const own=await browser.newPage();await own.addInitScript(role=>{window.testRole=role;},role);await own.goto(url);
  await own.getByText(name,{exact:true}).waitFor();assert.equal(await own.getByRole('row').count(),2);
  assert.equal(await own.getByRole('option').count(),5); // two scope choices plus three page sizes
  assert.equal(await own.getByText('Synthetic Super Admin',{exact:true}).count(),0);
  assert.equal(await own.getByText(/Another (Member|CRECOM|BOD)/).count(),0);
  await own.getByText('Only activity performed by your own account is shown.').waitFor();
  await own.close();
 }
 console.log('PASS: five-role visibility, own-account reviewer/member scope, shared role colors, COOP IDs, filters, pagination, live updates, retry and mobile layout.');
}
