import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
export async function checkCommitteeSetup({browser,url}){
 const directory=resolve('docs/committee-creation/screenshots');mkdirSync(directory,{recursive:true});const errors=[];
 for(const role of ['crecom_member','bod_member']){
  const page=await browser.newPage({viewport:{width:1280,height:850}});page.on('pageerror',error=>errors.push(error.message));await page.addInitScript(role=>{window.setupRole=role;},role);await page.goto(url);
  const next=page.getByLabel('New password',{exact:true}),confirm=page.getByLabel('Confirm password',{exact:true});await next.waitFor();
  await next.fill('weakpass');await confirm.fill('weakpass');await page.getByRole('button',{name:'Save password and continue',exact:true}).click();await page.getByRole('alert').filter({hasText:'Use matching passwords'}).waitFor();assert.equal(await page.evaluate(()=>window.setupCalls?.length??0),0);
  await next.fill('Synthetic-Temporary1!');await confirm.fill('Synthetic-Temporary1!');
  await page.getByRole('button',{name:'Show new password',exact:true}).click();assert.equal(await next.getAttribute('type'),'text');assert.equal(await confirm.getAttribute('type'),'password');
  await page.getByRole('button',{name:'Show confirm password',exact:true}).click();assert.equal(await confirm.getAttribute('type'),'text');await page.getByRole('button',{name:'Hide confirm password',exact:true}).click();await page.getByRole('button',{name:'Hide new password',exact:true}).click();assert.equal(await page.evaluate(()=>window.setupCalls?.length??0),0);
  await page.getByRole('button',{name:'Save password and continue',exact:true}).click();await page.getByRole('alert').filter({hasText:'different from your temporary'}).waitFor();assert.equal(await page.evaluate(()=>window.navigationPath??null),null);
  await next.fill('Synthetic-Personal2!');await confirm.fill('Synthetic-Personal2!');
  if(role==='crecom_member'){await page.screenshot({path:resolve(directory,'password-setup-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:resolve(directory,'password-setup-mobile.png'),fullPage:true});}
  await page.getByRole('button',{name:'Save password and continue',exact:true}).evaluate(button=>{button.click();button.click();});
  await page.waitForFunction(path=>window.navigationPath===path,role==='crecom_member'?'/crecom/dashboard':'/bod/dashboard');
  assert.equal(await page.evaluate(()=>window.setupCalls.length),2);assert.equal(await next.inputValue(),'');assert.equal(await confirm.inputValue(),'');await page.close();
 }
 const denied=await browser.newPage();await denied.addInitScript(()=>{window.setupAccessError=true;});await denied.goto(url);await denied.getByRole('alert').filter({hasText:'access could not be checked'}).waitFor();assert.equal(await denied.getByLabel('New password',{exact:true}).count(),0);await denied.close();
 assert.deepEqual(errors,[]);console.log('PASS: first-login validation, independent password eyes, safe retry, duplicate protection, CRECOM/BOD dashboard redirects, access errors and mobile layout.');
}
