import assert from 'node:assert/strict';
import {mkdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';

export async function checkPortalBranding({browser,url}){
  const directory=resolve('docs/portal-branding/screenshots');mkdirSync(directory,{recursive:true});
  const errors=[];
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',error=>errors.push(error.message));
  const header=page.getByRole('banner',{name:'Cooperative header and portal utilities'});
  const checkWatermark=async target=>{
    const mark=target.locator('.portal-content-watermark');
    assert.equal(await mark.count(),1,'The portal has one stationary seal.');
    const result=await mark.evaluate(element=>{
      const style=getComputedStyle(element),box=element.getBoundingClientRect();
      const shell=getComputedStyle(element.closest('.admin-portal-shell'));
      const offset=parseFloat(shell.getPropertyValue('--portal-content-offset'));
      return {position:style.position,opacity:style.opacity,filter:style.filter,pointerEvents:style.pointerEvents,image:style.backgroundImage,width:box.width,height:box.height,centerX:box.x+box.width/2,expectedX:offset+(innerWidth-offset)/2};
    });
    assert.equal(result.position,'fixed');assert.match(result.image,/coop-official-seal/);assert.match(result.filter,/blur/);assert.equal(result.pointerEvents,'none');
    assert.ok(Number(result.opacity)>=0.06&&Number(result.opacity)<=0.075,'The background remains faint enough for table text.');
    assert.match(result.filter,/blur\(1\.25px\)/);
    assert.ok(Math.abs(result.centerX-result.expectedX)<1,'The seal stays centered in the main workspace.');
    assert.ok(Math.abs(result.width-result.height)<1,'The seal retains its square proportions.');
    return mark.boundingBox();
  };
  const check=async()=>{
    await header.getByText('CDA Registration No. 0084',{exact:true}).waitFor();
    await page.waitForFunction(()=>document.querySelector('.coop-letterhead-seal')?.complete&&document.querySelector('.coop-letterhead-seal')?.naturalWidth>0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const bounds=await header.boundingBox(),main=await page.locator('main.portal-content').boundingBox();
    assert.ok(main.y>=bounds.y+bounds.height-1,'The letterhead must not overlap page content.');
    const items=await header.locator('.coop-letterhead-copy p,.coop-letterhead-seal,.coop-portal-utilities').all();
    for(const item of items){const box=await item.boundingBox();assert.ok(box.x>=bounds.x-1&&box.x+box.width<=bounds.x+bounds.width+1&&box.y>=bounds.y-1&&box.y+box.height<=bounds.y+bounds.height+1,'Every letterhead detail must fit.');}
    await page.getByRole('button',{name:'Open notifications',exact:true}).waitFor();
    assert.equal(await page.getByRole('complementary',{name:'CSUCC MPC sidebar'}).locator('img').count(),0,'The sidebar seal must be removed.');
    const account=await page.getByRole('group',{name:'Signed-in account'}).boundingBox(),mainLabel=await page.getByRole('heading',{name:'MAIN',exact:true}).boundingBox();
    if(mainLabel)assert.ok(account.y+account.height<=mainLabel.y,'Account identity stays above MAIN.');
    const watermark=await checkWatermark(page);
    if(bounds.width>1100){assert.ok(bounds.height<=110,'Desktop header stays compact.');assert.ok(watermark.width>=550,'Desktop watermark is larger.');}
    const motto=await page.getByRole('contentinfo',{name:'Cooperative motto'}).evaluate(footer=>{const text=footer.querySelector('p').getBoundingClientRect(),bounds=footer.getBoundingClientRect();return {delta:Math.abs(text.x+text.width/2-bounds.x-bounds.width/2),height:bounds.height};});
    assert.ok(motto.delta<1);assert.ok(motto.height<=45,'Desktop footer stays just tall enough for its motto.');
  };
  await page.goto(url+'/?view=loans');
  await page.waitForTimeout(350);
  await page.getByRole('region',{name:'Loan applications table',exact:true}).waitFor();await check();
  assert.equal(await page.locator('main').getByRole('heading',{name:'Loan Applications',exact:true}).count(),1);
  await page.screenshot({path:resolve(directory,'letterhead-desktop.png'),fullPage:true});
  const seal=await header.locator('.coop-letterhead-seal').boundingBox(),copy=await header.locator('.coop-letterhead-copy').boundingBox(),utilities=await header.locator('.coop-portal-utilities').boundingBox();
  assert.equal(seal.height,88,'The header seal follows the smaller guide.');
  assert.ok(seal.x+seal.width<copy.x&&copy.x+copy.width<utilities.x,'Text sits between the logo and date.');
  assert.ok(Math.abs(seal.y+seal.height/2-utilities.y-utilities.height/2)<1,'Desktop utilities share the logo row.');
  const originalMark=await checkWatermark(page);
  await page.getByRole('button',{name:'Next page',exact:true}).click();
  await page.getByRole('button',{name:'Page 2',exact:true}).waitFor();
  assert.deepEqual(await checkWatermark(page),originalMark,'Pagination does not resize or move the logo.');
  await page.getByRole('button',{name:'Open notifications',exact:true}).click();
  await page.getByRole('heading',{name:'Notifications',exact:true}).waitFor();await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Toggle sidebar',exact:true}).click();
  await page.waitForTimeout(350);await check();
  await page.screenshot({path:resolve(directory,'letterhead-collapsed.png'),fullPage:true});
  const collapsedMark=await checkWatermark(page);
  await page.getByRole('contentinfo',{name:'Cooperative motto'}).scrollIntoViewIfNeeded();
  assert.deepEqual(await checkWatermark(page),collapsedMark,'Scrolling keeps the logo stationary with a collapsed sidebar.');
  await page.screenshot({path:resolve(directory,'cooperative-footer.png')});
  await page.close();
  const prototype=await browser.newPage({viewport:{width:1330,height:692},deviceScaleFactor:1.25});
  prototype.on('pageerror',error=>errors.push(error.message));
  if(process.env.COOP_PREVIEW_FONT)await prototype.route('**/prototype-font.woff2',route=>route.fulfill({contentType:'font/woff2',body:readFileSync(process.env.COOP_PREVIEW_FONT)}));
  await prototype.goto(url+'/?view=loans');
  await prototype.getByRole('region',{name:'Loan applications table',exact:true}).waitFor();
  if(process.env.COOP_PREVIEW_FONT){
    await prototype.addStyleTag({content:"@font-face{font-family:'Inter Prototype';font-style:normal;font-weight:100 900;src:url('/prototype-font.woff2') format('woff2')} :root{--font-inter:'Inter Prototype',Arial,sans-serif}"});
    await prototype.evaluate(()=>document.fonts.ready);
  }
  await prototype.getByRole('button',{name:'Toggle sidebar',exact:true}).click();
  await prototype.waitForTimeout(350);
  const referenceMark=await checkWatermark(prototype),referenceHeader=await prototype.getByRole('banner',{name:'Cooperative header and portal utilities'}).boundingBox();
  assert.ok(Math.abs(referenceMark.y-referenceHeader.height-24)<1,'The larger seal starts below the header guide.');
  assert.ok(Math.abs(referenceMark.y+referenceMark.height-668)<1,'The seal reaches the lower guide at the reference screen height.');
  await prototype.screenshot({path:resolve(directory,'logo-sizing-prototype.png')});
  await prototype.close();
  for(const width of [1280,1024,900,768,390,320]){
    const mobile=await browser.newPage({viewport:{width,height:900}});mobile.on('pageerror',error=>errors.push(error.message));
    await mobile.goto(url+'/?view=loans'+(width<900?'&role=admin':''));
    await mobile.getByRole('region',{name:'Loan applications table',exact:true}).waitFor();
    const nav=mobile.getByRole('banner',{name:'Cooperative header and portal utilities'});
    await mobile.getByText('CDA Registration No. 0084',{exact:true}).waitFor();
    const box=await nav.boundingBox(),body=await mobile.locator('main.portal-content').boundingBox();assert.ok(body.y>=box.y+box.height-1);
    assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await mobile.getByRole('button',{name:'Open notifications',exact:true}).waitFor();
    if(width>=900){
      const seal=await nav.locator('.coop-letterhead-seal').boundingBox(),tools=await nav.locator('.coop-portal-utilities').boundingBox();
      assert.ok(Math.abs(seal.y+seal.height/2-tools.y-tools.height/2)<1,'Date and bell stay on the logo row at '+width+'px.');
    }
    if(width===390)await mobile.screenshot({path:resolve(directory,'letterhead-mobile.png'),fullPage:true});
    await mobile.close();
  }
  const report=await browser.newPage({viewport:{width:1440,height:1000}});report.on('pageerror',error=>errors.push(error.message));
  await report.goto(url+'/?view=reports');await report.getByRole('heading',{name:'Reports',exact:true}).waitFor();
  const footer=await report.getByRole('contentinfo',{name:'Cooperative motto'}).boundingBox(),main=await report.locator('main.portal-content').boundingBox();
  assert.ok(footer.y>=main.y+main.height-1);assert.ok(footer.y+footer.height<=1000.5,'Short-page footer stays at the bottom.');
  await report.screenshot({path:resolve(directory,'letterhead-short-page.png'),fullPage:true});await report.close();
  const superMobile=await browser.newPage({viewport:{width:390,height:900}});superMobile.on('pageerror',error=>errors.push(error.message));
  await superMobile.goto(url+'/?view=reports');await superMobile.getByRole('heading',{name:'Reports',exact:true}).waitFor();
  await superMobile.locator('#portal-live-status button').waitFor();
  const mobileFooter=superMobile.getByRole('contentinfo',{name:'Cooperative motto'});await mobileFooter.scrollIntoViewIfNeeded();
  assert.equal(await mobileFooter.locator('button').count(),0,'The footer contains only its motto.');
  await superMobile.screenshot({path:resolve(directory,'cooperative-footer-mobile.png'),fullPage:true});await superMobile.close();
  for(const height of [900,768,693,640,620]){
    const compact=await browser.newPage({viewport:{width:1366,height}});compact.on('pageerror',error=>errors.push(error.message));
    await compact.goto(url+'/?view=reports');await compact.getByRole('heading',{name:'Reports',exact:true}).waitFor();
    assert.equal(await compact.locator('#sidebar-navigation').evaluate(element=>element.scrollHeight>element.clientHeight+1),false,'Sidebar must fit at '+height+'px height.');
    if(height>=693){
      const profile=await compact.getByRole('link',{name:'My Profile',exact:true}).boundingBox();
      assert.ok(profile.y+profile.height>=height*.8&&profile.y+profile.height<=height*.87,'The menu reaches the lower guide with balanced spacing.');
    }
    if(height===693)await compact.screenshot({path:resolve(directory,'sidebar-compact.png'),fullPage:true});await compact.close();
  }
  for(const [view,title,ready] of [['notifications','Notifications','Activity notifications'],['committee','Committee Accounts','No committee accounts.'],['settings','Settings','Portal settings'],['profile','My Profile','Personal information']]){
    const panel=await browser.newPage({viewport:{width:1440,height:900}});panel.on('pageerror',error=>errors.push(error.message));
    await panel.goto(url+'/?view='+view);await panel.locator('main').getByRole('heading',{name:title,exact:true}).waitFor();await panel.getByText(ready,{exact:true}).waitFor();
    const mark=await checkWatermark(panel);assert.ok(mark.width>=550,'A large watermark must be present in '+view);
    await panel.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
    assert.deepEqual(await checkWatermark(panel),mark,'Scrolling does not resize or move the logo in '+view);
    await panel.evaluate(()=>window.scrollTo(0,0));
    await panel.screenshot({path:resolve(directory,'watermark-'+view+'.png'),fullPage:true});await panel.close();
  }
  assert.deepEqual(errors,[]);console.log('PASS: compact three-column letterhead, original seal/date/bell, balanced sidebar spacing, one stationary large noninteractive watermark, responsive layout, table pagination and footer placement.');
}
