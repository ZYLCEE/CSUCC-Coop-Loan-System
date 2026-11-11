import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Actual All Accounts create form/provider; entirely synthetic services and data.
export async function checkAccountCreation({ browser, url, phase }) {
  const directory=resolve(process.env.COOP_ACCOUNT_CREATION_SCREENSHOTS ?? `docs/account-creation-validation/screenshots/${phase}`);mkdirSync(directory,{recursive:true});
  const metrics=[];
  for(const viewport of[{width:1536,height:694},{width:1366,height:768},{width:1280,height:640},{width:768,height:1024},{width:390,height:844}]){
    const context=await browser.newContext({viewport,locale:"en-PH",timezoneId:"Asia/Manila"});
    await context.route("**/*",route=>new URL(route.request().url()).origin===new URL(url).origin?route.continue():route.abort());
    const page=await context.newPage(),errors=[];page.on("pageerror",error=>errors.push(error.message));
    await page.goto(`${url}/super-admin/all-accounts?accounts`);
    await page.getByRole("button",{name:"Create Account",exact:true}).click();
    await page.locator("#idNumber").waitFor(); await page.waitForFunction(()=>document.querySelector("#idNumber").value.startsWith("CSUCC-"));
    const shot=async name=>{
      await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
      const dialog=page.getByRole("dialog").last();
      const measurement=await dialog.evaluate(el=>{const r=el.getBoundingClientRect(),f=el.querySelector(".ui-dialog-footer").getBoundingClientRect(),body=el.querySelector('.ui-dialog-body');return {bounded:r.x>=0&&r.y>=0&&r.bottom<=innerHeight&&r.right<=innerWidth,overflow:el.scrollWidth>el.clientWidth,footerVisible:f.bottom<=innerHeight,width:r.width,height:r.height,bodyHeight:body.clientHeight,contentHeight:body.scrollHeight,scrollable:body.scrollHeight>body.clientHeight+1};});
      assert.ok(measurement.bounded&&!measurement.overflow&&measurement.footerVisible,`${name}: ${JSON.stringify(measurement)}`);
      if(phase==='after'&&viewport.width>=1024&&['create-initial','full-name-focused','email-focused','medium-password','strong-password','valid-fields'].includes(name)){
        assert.equal(measurement.scrollable,false,`${name}: full form fits without scrolling at ${viewport.width}×${viewport.height}`);
      }
      if(phase==='after'&&viewport.width>=1024&&['invalid-fields','weak-password'].includes(name)){
        assert.equal(measurement.scrollable,false,`${name}: validation fits without scrolling at ${viewport.width}×${viewport.height}`);
      }
      metrics.push({name,viewport,...measurement});await page.screenshot({path:resolve(directory,`${name}-${viewport.width}.png`)});
    };
    await shot("create-initial");
    if(phase==="after"){
      assert.equal(await page.getByRole('heading',{name:'Account Information',exact:true}).count(),1);
      assert.equal(await page.getByRole('heading',{name:/^(Personal|Contact) Information$/}).count(),0);
      const id=page.locator('#idNumber'),generatedId=await id.inputValue();
      assert.equal(await id.evaluate(el=>el.readOnly),true);
      assert.equal(await id.evaluate(el=>getComputedStyle(el).cursor),'not-allowed');
      await id.click();await page.keyboard.press('End');await page.keyboard.insertText('9999');
      assert.equal(await id.inputValue(),generatedId,'typing cannot change the generated account ID');
      const height=await page.locator('#fullName').evaluate(el=>el.getBoundingClientRect().height);
      assert.ok(height>=36&&height<=40,'inputs stay compact and readable');
      if(viewport.width>=768){
        const rows=await Promise.all(['email','phone','address'].map(id=>page.locator(`#${id}`).boundingBox()));
        assert.ok(rows.every(box=>Math.abs(box.y-rows[0].y)<2),'contact inputs share one row on wider displays');
      }
      for(const id of["idNumber","fullName","email","phone","address","role","membershipType","temporaryPassword","confirmPassword","identityVerified"]){
        assert.equal(await page.locator(`#${id}-message`).isVisible(),false,`${id}: no permanent guidance on opening`);
      }
      await page.locator('#fullName').focus();
      assert.equal(await page.locator('#fullName-message').isVisible(),false,"focusing an empty field shows no gray hints");
      assert.equal(await page.locator('#fullName').getAttribute('aria-invalid'),'false',"focusing alone does not mark a field invalid");
      assert.equal(await page.locator('#email-message').isVisible(),false,"untouched fields stay quiet");
      for(const id of['fullName','email','phone','address'])assert.equal(await page.locator(`#${id}`).getAttribute('autocomplete'),'off','account creation does not request saved personal details');
      await shot('full-name-focused');
      await page.locator('#fullName').fill('Juan Dela Cruz');
      assert.equal(await page.locator('#fullName-message').isVisible(),false,"valid entries clear their guidance immediately");
      await page.keyboard.press('Tab');
      assert.equal(await page.locator('#email').evaluate(el=>el===document.activeElement),true);
      assert.equal(await page.locator('#email-message').isVisible(),false,"keyboard focus does not show gray hints on the next field");
      await shot('email-focused');
    }
    await page.locator("#fullName").fill("bad 123");await page.locator("#email").fill("invalid-email");
    await page.locator("#phone").fill("123"); await page.locator("#fullName").scrollIntoViewIfNeeded();await shot("invalid-fields");
    await page.locator("#temporaryPassword").fill("abc");await page.locator("#confirmPassword").fill("different");
    if(phase==="after"){
      await page.locator("#temporaryPassword-strength").scrollIntoViewIfNeeded();
      await page.locator("#confirmPassword-message").scrollIntoViewIfNeeded();
    } else await page.locator("#temporaryPassword").scrollIntoViewIfNeeded();
    await shot("weak-password");
    if(phase==="after")await checkFinalCreation({page,shot,viewport});
    assert.deepEqual(errors,[]);await context.close();
  }
  writeFileSync(resolve(directory,"metrics.json"),JSON.stringify(metrics,null,2));
  console.log(`PASS: Create Account ${phase} previews at desktop/tablet/mobile; no live account operations.`);
}

async function checkFinalCreation({page,shot,viewport}) {
  const createButton=page.getByRole("dialog").last().getByRole("button",{name:"Create Account",exact:true});
  assert.equal(await createButton.isDisabled(),true);
  assert.equal(await page.locator('#password-requirements').count(),0);
  assert.equal(await page.getByText(/Complete these requirements to enable/).count(),0);
  for(const id of["idNumber","fullName","email","phone","address","role","membershipType","temporaryPassword","confirmPassword"]){
    const message=page.locator(`#${id}-message`);assert.equal(await message.count(),1);
    assert.equal(await page.locator(`#${id}`).getAttribute("aria-describedby").then(value=>value.split(" ").includes(`${id}-message`)),true);
    if(!await message.isVisible())continue;
    assert.equal(await message.evaluate(el=>getComputedStyle(el).color),'rgb(153, 27, 27)',`${id}: validation messages are red`);
    const geometry=await message.evaluate((el,id)=>{const input=document.getElementById(id),a=input.getBoundingClientRect(),b=el.getBoundingClientRect();return {below:b.top>=a.bottom,leftAligned:Math.abs(b.left-a.left)<2};},id);
    assert.ok(geometry.below&&geometry.leftAligned,`${id}: message is directly below its input`);
  }
  assert.equal(await page.locator('#fullName').getAttribute('aria-invalid'),"true");
  assert.equal(await page.locator('#email').getAttribute('aria-invalid'),"true");
  assert.equal(await page.locator('#phone').getAttribute('aria-invalid'),"true");
  assert.ok((await page.locator('#temporaryPassword-strength').textContent()).includes("Weak"));
  assert.equal(await page.locator('#temporaryPassword-strength').evaluate(el=>getComputedStyle(el).color),'rgb(153, 27, 27)','weak passwords show red strength feedback');
  assert.ok((await page.locator('#confirmPassword-message').textContent()).includes("do not match"));
  if(viewport.width>=768){
    const a=await page.locator('#temporaryPassword').boundingBox(),b=await page.locator('#confirmPassword').boundingBox();
    assert.ok(Math.abs(a.y-b.y)<2,"password fields share the same row");
  }
  for(const [password,requirement] of[['abcdefgh','uppercase'],['ABCDEFGH','lowercase'],['Abcdefgh','number']]){
    await page.locator('#temporaryPassword').fill(password);
    assert.ok((await page.locator('#temporaryPassword-message').textContent()).includes(requirement),`password shows the next missing ${requirement} requirement`);
    assert.equal(await createButton.isDisabled(),true);
  }
  await page.locator('#temporaryPassword').fill('Abcdefg1');
  assert.equal(await page.locator('#temporaryPassword-message').isVisible(),false,"meeting the password policy clears its requirement");
  assert.equal(await page.locator('#confirmPassword').getAttribute('aria-invalid'),'true',"confirmation is rechecked when the password changes");
  await page.locator('#fullName').fill("Juan Dela Cruz");await page.locator('#email').fill("juan@example.invalid");
  await page.locator('#phone').fill("09123456789");await page.locator('#address').fill("Synthetic address for component testing only");
  await page.locator('#membershipType').selectOption('regular');await page.locator('#department').fill('Cooperative Services');
  assert.equal(await page.locator('#department-message').isVisible(),false);
  assert.equal(await page.locator('#department').getAttribute('aria-describedby'),"department-message");
  assert.equal(await page.locator('#department').evaluate(el=>el.maxLength),200);
  await page.locator('#membershipType').selectOption('associate');assert.equal(await page.locator('#department').count(),0);
  await page.locator('#role').selectOption('Admin');assert.equal(await page.locator('#membershipType').count(),0);
  await page.locator('#role').selectOption('Member');await page.locator('#membershipType').selectOption('regular');await page.locator('#department').fill('Cooperative Services');
  for(const id of['fullName','email','phone','address','role','membershipType','department'])assert.equal(await page.locator(`#${id}`).getAttribute('aria-invalid'),"false");
  // The strength guide does not introduce a new password policy or save gate.
  await page.locator('#temporaryPassword').fill('JdC4zT8x');await page.locator('#confirmPassword').fill('JdC4zT8x');
  assert.ok((await page.locator('#temporaryPassword-strength').textContent()).includes('Medium'));
  const [red,green,blue]=await page.locator('#temporaryPassword-strength').evaluate(el=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
    const context=canvas.getContext('2d');context.fillStyle=getComputedStyle(el).color;context.fillRect(0,0,1,1);
    return Array.from(context.getImageData(0,0,1,1).data);
  });
  assert.ok(red>150&&green>100&&blue<60&&red>green,'medium passwords show yellow strength feedback');
  await shot('medium-password');
  assert.equal(await createButton.isDisabled(),true,"identity acknowledgment is still required");
  await page.locator('#identityVerified').check();assert.equal(await createButton.isEnabled(),true);
  const password='Zq!8rT#4mL9v';
  await page.locator('#temporaryPassword').fill(password);
  assert.equal(await createButton.isDisabled(),true,"editing original password revalidates confirmation");
  await page.locator('#confirmPassword').fill(password);
  assert.ok((await page.locator('#temporaryPassword-strength').textContent()).includes('Strong'));
  assert.equal(await page.locator('#temporaryPassword-strength').evaluate(el=>getComputedStyle(el).color),'rgb(22, 101, 52)','strong passwords show green strength feedback');
  assert.equal(await page.locator('#confirmPassword-message').isVisible(),false,'matching passwords clear their error without a success hint');
  assert.equal(await page.locator('#confirmPassword').getAttribute('aria-invalid'),'false');
  for(const id of['temporaryPassword','confirmPassword']){
    const label=page.locator(`label[for="${id}"]`);assert.equal(await label.isVisible(),true);
    const a=await label.boundingBox(),b=await page.locator(`#${id}`).boundingBox();assert.ok(a.y+a.height<=b.y,`${id}: label stays above its input`);
  }
  assert.equal(await page.locator('#temporaryPassword').evaluate(el=>el.maxLength),128);
  assert.equal(await page.locator('#confirmPassword').evaluate(el=>el.maxLength),128);
  await page.locator('#temporaryPassword').scrollIntoViewIfNeeded();await shot('strong-password');
  await page.getByRole('button',{name:'Show temporary password',exact:true}).click();
  assert.equal(await page.locator('#temporaryPassword').getAttribute('type'),'text');
  assert.equal(await page.locator('#confirmPassword-message').isVisible(),false,"matching confirmation stays clear while using password visibility controls");
  await page.getByRole('button',{name:'Hide temporary password',exact:true}).click();
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Keep editing',exact:true}).click();
  assert.equal(await page.locator('#temporaryPassword').inputValue(),password);
  await page.locator('#fullName').scrollIntoViewIfNeeded();await shot('valid-fields');
  assert.equal(await page.evaluate(()=>window.calls.length),0);
  await createButton.evaluate(el=>{el.click();el.click();});
  await page.getByRole('heading',{name:'Verify Account Creation',exact:true}).waitFor();await shot('super-admin-password');
  assert.equal(await page.evaluate(()=>window.calls.length),0);
  await page.getByRole('dialog').last().getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal(await page.locator('#temporaryPassword').inputValue(),password);
  const verify=async(fail=false)=>{
    await page.getByRole('dialog').last().getByRole('button',{name:'Create Account',exact:true}).click();
    await page.locator('input[autocomplete="current-password"]').fill('SyntheticActor123');
    await page.evaluate(fail=>{window.verifyFailure=fail;},fail);
    await page.getByRole('button',{name:'Verify password',exact:true}).click();
  };
  await verify(true);await page.getByText('Password rejected',{exact:true}).waitFor();await shot('verification-error');
  assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.mode==='execute').length),0);
  await page.evaluate(()=>{window.verifyFailure=false;});await page.getByRole('button',{name:'Verify password',exact:true}).click();
  await page.getByRole('heading',{name:'Verify Account Creation',exact:true}).waitFor({state:'detached'});
  const confirm=page.getByRole('dialog').last();
  assert.ok((await confirm.innerText()).includes('Juan Dela Cruz'));assert.ok(!(await confirm.innerText()).includes(password));await shot('final-confirmation');
  await page.evaluate(()=>{window.executeFailure=true;window.executeFailureMessage='Synthetic account creation failed';});
  await confirm.getByRole('button',{name:'Create Account',exact:true}).evaluate(el=>{el.click();el.click();});
  await page.getByRole('heading',{name:'Action Failed',exact:true}).waitFor();await shot('server-error');
  assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.mode==='execute').length),1);
  assert.equal(await page.evaluate(()=>window.accountLoads),1);
  await page.getByRole('button',{name:'OK',exact:true}).click();
  assert.equal(await page.locator('#fullName').inputValue(),'Juan Dela Cruz');assert.equal(await page.locator('#temporaryPassword').inputValue(),password);
  assert.equal(await page.locator('#identityVerified').isChecked(),true);
  await page.evaluate(()=>{window.executeFailure=false;window.holdAccountExecution=true;});await verify();
  await page.getByRole('heading',{name:'Verify Account Creation',exact:true}).waitFor({state:'detached'});
  await page.getByRole('dialog').last().getByRole('button',{name:'Create Account',exact:true}).click();
  await page.waitForFunction(()=>typeof window.resumeAccountExecution==='function');
  assert.equal(await page.getByRole('heading',{name:'Success',exact:true}).count(),0);
  assert.equal(await page.getByRole('dialog').last().getAttribute('aria-busy'),'true');
  await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),2);
  await shot('waiting-for-response');
  await page.evaluate(()=>window.resumeAccountExecution());
  await page.getByRole('heading',{name:'Success',exact:true}).waitFor();await shot('success');
  const request=await page.evaluate(()=>window.calls.filter(c=>c.mode==='execute').at(-1));
  assert.equal(request.action,'create-account');assert.equal(request.target,'new-account');assert.ok(request.grant);
  assert.equal(request.payload.fullName,'Juan Dela Cruz');assert.equal(request.payload.identityVerified,true);
  assert.equal(request.secret.temporaryPassword,password);assert.ok(!Object.keys(request.payload).some(key=>/password|secret/i.test(key)));
  assert.equal(await page.evaluate(()=>window.accountLoads),2);
  await page.getByRole('button',{name:'OK',exact:true}).click();assert.equal(await page.getByRole('dialog').count(),0);
  // Programmatic submit cannot bypass inline validation or the security provider.
  await page.getByRole('button',{name:'Create Account',exact:true}).click();
  const requestsBefore=await page.evaluate(()=>window.calls.length);
  await page.locator('#member-account-form').evaluate(form=>form.requestSubmit());
  assert.equal(await page.locator('#fullName-message').textContent(),'Full Name is required.');
  assert.equal(await page.locator('#fullName').evaluate(el=>el===document.activeElement),true);
  assert.equal(await page.evaluate(()=>window.calls.length),requestsBefore);
}
