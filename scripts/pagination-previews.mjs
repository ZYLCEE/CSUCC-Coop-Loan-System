import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Real page components; synthetic lists and read-only transports, never the live app.
export async function checkPagination({browser, url}) {
  const directory = resolve('docs/pagination-qa');
  mkdirSync(directory, {recursive:true});
  const records = {active:[],documents:[],audit:[],loans:[],members:[],payments:[],notifications:[],announcements:[]};
  const accounts = [];
  for (let index = 1; index <= 37; index++) {
    const suffix = String(index).padStart(2,'0');
    const date = new Date(Date.UTC(2026,0,index,1)).toISOString();
    accounts.push({accountKey:`member-${index}`,idNumber:`CSUCC-2026-00${suffix}`,fullName:`Member ${suffix}`,
      email:`member${suffix}@example.invalid`,department:'Cooperative Services',role:'Member',status:'Active',membershipType:'regular',createdAt:date});
    records.active.push({id:`loan-${index}`,application_id:`APP-${suffix}`,member_name:`Member ${suffix}`,loan_type:'Regular',
      amount:12000,monthly_payment:1000,status:'released',tenure_months:12,date_submitted:date,members:{member_id:`CSUCC-2026-00${suffix}`,membership_type:'Regular'},payments:[]});
    records.documents.push({id:`document-${index}`,name:`Document ${suffix}.pdf`,createdAt:date,size:100,source:'cooperative',url:null,linkError:null,kind:null,applicationId:null});
    records.audit.push({id:`audit-${index}`,created_at:date,action_name:`Action ${suffix}`,target_id:`TARGET-${suffix}`,result:'success'});
    records.loans.push({id:`report-${index}`,application_id:`REPORT-${suffix}`,member_name:`Member ${suffix}`,loan_type:'Regular',amount:12000,status:'released',date_submitted:date});
    records.members.push({id:`registry-${index}`,member_id:`MEMBER-${suffix}`,first_name:`First ${suffix}`,last_name:'Member',email:`member${suffix}@example.invalid`,membership_type:'Regular',status:'active',date_joined:date});
    records.payments.push({id:`payment-${index}`,loan_application_id:`LOAN-${suffix}`,receipt_number:`OR-${suffix}`,payment_date:date.slice(0,10),payment_amount:1000,principal_amount:1000,interest_amount:0,penalty_amount:0,fee_amount:0,payment_method:'cash',payment_status:'posted',recorded_by_name:'Synthetic cashier'});
    records.notifications.push({id:`notification-${index}`,title:`Notification ${suffix}`,message:'Synthetic delivery history',type:'Information',recipient:'Members',recipientCount:1,status:'sent',createdAt:date,scheduledAt:null});
    records.announcements.push({id:`announcement-${index}`,title:`Announcement ${suffix}`,content:'Synthetic cooperative update',categoryId:'general',category:'General',status:'published',createdAt:date,updatedAt:date,publishedAt:date,scheduledAt:null,author:'Synthetic author',notifyMembers:false});
  }
  const requestedViews = process.env.COOP_PAGINATION_VIEWS?.split(',');
  const scenarios = [
    ['accounts','Pagination','Sort members','Members per page'],
    ['active','Active loans pagination','Sort active loans','Loans per page'],
    ['notifications','Outgoing notification pagination','Sort outgoing notifications','Notifications per page'],
    ['announcements','Announcement pagination','Sort announcements','Announcements per page'],
    ['documents','Document pagination','Sort documents','Documents per page'],
    ['reports','Report pagination','Sort report records','Report records per page'],
    ['audit','Audit logs pagination','Sort Audit logs','Audit logs per page'],
  ].filter(([view]) => !requestedViews || requestedViews.includes(view));
  const metrics = [];
  for (const {width,role} of [{width:1366,role:'super_admin'},{width:1366,role:'admin'},{width:390,role:'super_admin'}]) {
    const context = await browser.newContext({viewport:{width,height:900},locale:'en-PH',timezoneId:'Asia/Manila'});
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
    for (const [view,label,sortLabel,sizeLabel] of scenarios) {
      const page = await context.newPage();
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(({records,accounts,role}) => {
        window.paginationRecords=structuredClone(records);window.syntheticAccounts=structuredClone(accounts);
        window.testRole=role;window.testPrivileges=['notifications.send'];
      },{records,accounts,role});
      await page.goto(`${url}/?view=${view}`);
      if(view==='documents')await page.getByRole('tab',{name:'Shared Documents'}).click();
      if (view === 'reports') {
        await page.getByLabel('Report date',{exact:true}).fill('2026-11-10');
        await page.getByRole('button',{name:'Generate Report',exact:true}).click();
      }
      const nav = page.getByRole('navigation',{name:label,exact:true});
      const checkPage = async (current,from,to,total=37) => {
        await page.waitForFunction(({label,current}) => document.querySelector(`nav[aria-label="${label}"] [aria-current="page"]`)?.textContent.trim() === String(current), {label,current});
        await nav.getByText(new RegExp(`Showing ${from}-${to} of ${total}`)).waitFor();
      };
      const rows = () => view === 'announcements' ? page.locator('article') : page.getByRole('table').locator('tbody tr');
      const first = async suffix => assert.match(await rows().first().innerText(), new RegExp(`(?: |-)${suffix}(?:\\b|\\.)`), `${view}: actual first record`);
      await checkPage(1,1,10); await first('37'); assert.equal(await rows().count(),10);
      assert.equal(await nav.getByRole('button',{name:'Previous page',exact:true}).isDisabled(),true);
      await nav.getByRole('button',{name:'Next page',exact:true}).click(); await checkPage(2,11,20); await first('27');
      await nav.getByRole('button',{name:'Next page',exact:true}).click(); await checkPage(3,21,30); await first('17');
      await nav.getByRole('button',{name:'Previous page',exact:true}).click(); await checkPage(2,11,20); await first('27');
      await nav.getByRole('button',{name:'Previous page',exact:true}).click(); await checkPage(1,1,10);
      await nav.getByRole('combobox',{name:sortLabel,exact:true}).selectOption('Oldest'); await checkPage(1,1,10); await first('01');
      await nav.getByRole('button',{name:'Next page',exact:true}).click(); await checkPage(2,11,20); await first('11');
      await nav.getByRole('combobox',{name:sizeLabel,exact:true}).selectOption('15'); await checkPage(1,1,15); assert.equal(await rows().count(),15);
      await nav.getByRole('button',{name:'Next page',exact:true}).click(); await checkPage(2,16,30); await first('16');
      await nav.getByRole('combobox',{name:sizeLabel,exact:true}).selectOption('25'); await checkPage(1,1,25); assert.equal(await rows().count(),25);
      await nav.getByRole('button',{name:'Next page',exact:true}).click(); await checkPage(2,26,37); await first('26');
      assert.equal(await nav.getByRole('button',{name:'Next page',exact:true}).isDisabled(),true);
      await nav.getByRole('button',{name:'Page 1',exact:true}).click(); await checkPage(1,1,25);
      await nav.getByRole('button',{name:'Page 1',exact:true}).click(); await checkPage(1,1,25);
      await nav.getByRole('combobox',{name:sortLabel,exact:true}).selectOption('Newest'); await checkPage(1,1,25); await first('37');
      await nav.getByRole('combobox',{name:sizeLabel,exact:true}).selectOption('10'); await checkPage(1,1,10);
      const measure = await nav.evaluate(el => ({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,overflow:el.scrollWidth>el.clientWidth,pageOverflow:document.documentElement.scrollWidth>innerWidth}));
      assert.ok(!measure.overflow && !measure.pageOverflow,`${view} footer fits ${width}px: ${JSON.stringify(measure)}`);
      metrics.push({view,width,role,...measure});
      await nav.screenshot({path:resolve(directory,`${view}-${role}-${width}.png`)});
      if (view === 'announcements' && process.env.COOP_ANNOUNCEMENT_CONTAINER_QA) {
        await page.getByRole('searchbox').fill('Announcement 37');
        await checkPage(1,1,1,1);
        await page.screenshot({path:resolve(directory,`announcements-container-${role}-${width}.png`),fullPage:true});
      }
      if (['announcements','notifications'].includes(view)) {
        const requests = await page.evaluate(()=>window.paginationRequests);
        assert.ok(requests.some(request=>request.offset===20&&request.size===10&&request.sort==='Newest'));
        assert.ok(requests.some(request=>request.offset===25&&request.size===25&&request.sort==='Oldest'));
      }
      if (view === 'reports') {
        for (const type of ['members','payments']) {
          await page.getByLabel('Report type',{exact:true}).selectOption(type);
          await page.getByRole('button',{name:'Generate Report',exact:true}).click();
          await nav.getByRole('combobox',{name:sortLabel,exact:true}).selectOption('Newest');
          await checkPage(1,1,10); await first('37');
          await nav.getByRole('combobox',{name:sortLabel,exact:true}).selectOption('Oldest'); await checkPage(1,1,10); await first('01');
        }
        await page.getByLabel('Report date',{exact:true}).fill('1990-01-01');
        await page.getByRole('button',{name:'Generate Report',exact:true}).click();
      } else if (view === 'notifications') {
        await page.getByLabel('Search outgoing notification titles',{exact:true}).fill('No matching record');
        await page.getByRole('button',{name:'Search outgoing history',exact:true}).click();
      } else await page.getByRole('searchbox').first().fill('No matching record');
      await checkPage(1,0,0,0);
      assert.equal(await nav.getByRole('button',{name:'Next page',exact:true}).isDisabled(),true);
      assert.deepEqual(errors,[]);
      await page.close();
    }
    await context.close();
  }
  writeFileSync(resolve(directory,'metrics.json'),JSON.stringify(metrics,null,2));
  console.log(`PASS: ${scenarios.map(([view]) => view).join(', ')}; Admin and Super Admin, desktop/mobile; 1→2→3→2→1, real row changes, oldest/newest, 10/15/25 rows, last/empty pages, and server offsets. Synthetic data only.`);
}
