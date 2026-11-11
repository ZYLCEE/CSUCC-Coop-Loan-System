import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {readFileSync} from "node:fs";
import ts from "typescript";
const load=(path,imports={})=>{const exports={};new Function("require","exports",ts.transpileModule(readFileSync(new URL(path,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)(name=>{if(!(name in imports))throw new Error("Unexpected dependency "+name);return imports[name];},exports);return exports;};
const server=load("./committeeDemoServer.ts",{"server-only":{},"node:crypto":crypto}),validation=load("./committeeReview.ts"),api=load("../app/api/committee-demo/route.ts",{"@/lib/committeeDemoServer":server,"@/lib/committeeReview":validation});
const password="Synthetic-Only!2026",salt=crypto.randomBytes(16),passwordHash="scrypt-v1:"+salt.toString("hex")+":"+crypto.scryptSync(password,salt,64).toString("hex");
const accounts=[{id:"crecom-1",seat:"member",role:"crecom_member"},{id:"crecom-2",seat:"member",role:"crecom_member"},{id:"crecom-chair",seat:"chairperson",role:"crecom_member"},{id:"bod-chair",seat:"chairperson",role:"bod_member"}].map(row=>({...row,name:"Synthetic "+row.id,email:row.id+"@example.invalid",passwordHash}));
const configure=(rows=accounts)=>{process.env.COOP_COMMITTEE_DEMO_ACCOUNTS=Buffer.from(JSON.stringify(rows)).toString("base64");process.env.COOP_COMMITTEE_DEMO_SESSION_SECRET="synthetic-test-secret-"+"x".repeat(48);};configure();
const origin="http://localhost:3000",post=(body,cookie,requestOrigin=origin)=>new Request(origin+"/api/committee-demo",{method:"POST",headers:{"Content-Type":"application/json",Origin:requestOrigin,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
test("configuration accepts exactly two CRECOM members and the two chairpersons",()=>{
 configure();assert.equal(server.configuredDemoAccounts().length,4);
 for(const rows of [accounts.slice(0,3),accounts.map(row=>({...row,role:"super_admin"})),accounts.map(row=>({...row,seat:"member"})),accounts.map(row=>({...row,passwordHash:password}))]){configure(rows);assert.throws(()=>server.configuredDemoAccounts());}
 configure();assert.equal(server.verifyDemoPassword(accounts[0],password),true);assert.equal(server.verifyDemoPassword(accounts[0],"wrong"),false);
});
test("sessions are signed, expire, and are invalidated by configuration/password changes",()=>{
 configure();const now=Date.now(),token=server.createDemoSession(accounts[0],now),request=value=>new Request(origin,{headers:{Cookie:server.committeeDemoCookie+"="+value}});
 assert.equal(server.readDemoSession(request(token),now).account.id,"crecom-1");
 assert.equal(server.readDemoSession(request(token+"bad"),now).account,null);
 assert.equal(server.readDemoSession(request(token),now+9*60*60*1000).account,null);
 configure(accounts.map(row=>({...row,email:"changed-"+row.email})));assert.equal(server.readDemoSession(request(token),now).account,null);configure();
});
test("shared login returns the correct portal identity without password hashes or Auth tokens",async()=>{
 configure();for(const account of accounts){
  const response=await api.POST(post({operation:"login",email:account.email,password})),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.account.role,account.role);assert.equal(body.account.seat,account.seat);
  assert.equal(JSON.stringify(body).includes(passwordHash),false);assert.equal(JSON.stringify(body).includes(password),false);
  const cookie=response.headers.get("set-cookie");assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);assert.equal(cookie.includes(password),false);
  assert.equal((await (await api.GET(new Request(origin,{headers:{Cookie:cookie}}))).json()).account.id,account.id);
 }
 assert.equal((await api.POST(post({operation:"login",email:accounts[0].email,password:"wrong"}))).status,401);
 assert.equal((await (await api.POST(post({operation:"login",email:"not-demo@example.invalid",password}))).json()).account,null);
});
test("confirmation requires a valid cookie, the account password and a supported individual action",async()=>{
 configure();const cookie=server.committeeDemoCookie+"="+server.createDemoSession(accounts[0]);
 const review={operation:"approve",applicationId:"PROTO-2026-0001",revision:1,stateHash:"0".repeat(64),requestId:crypto.randomUUID(),password,payload:{assignmentId:crypto.randomUUID(),confirmed:true,reason:"Synthetic review"}};
 assert.equal((await api.POST(post({operation:"confirm",review}))).status,401);
 assert.equal((await api.POST(post({operation:"confirm",review:{...review,password:"wrong"}},cookie))).status,401);
 assert.equal((await (await api.POST(post({operation:"confirm",review},cookie))).json()).verified,true);
 assert.equal((await api.POST(post({operation:"confirm",review:{...review,operation:"finalize",payload:{decision:"approve",reason:"Bypass"}}},cookie))).status,403);
});
test("cross-origin requests cannot sign in and sign-out expires only the demonstration cookie",async()=>{
 configure();assert.equal((await api.POST(post({operation:"login",email:accounts[0].email,password},null,"https://other.example.invalid"))).status,403);
 const response=await api.POST(post({operation:"logout"}));assert.match(response.headers.get("set-cookie"),/csucc_committee_demo=;.*Max-Age=0/);assert.equal(response.headers.get("cache-control"),"no-store");
});
test("same-origin loopback sign-ins use the browser host when Next.js normalizes the request URL",async()=>{
 configure();
 const login=(host,requestOrigin,forwardedHost)=>new Request(origin+"/api/committee-demo",{method:"POST",headers:{"Content-Type":"application/json",Host:host,Origin:requestOrigin,...(forwardedHost?{"X-Forwarded-Host":forwardedHost}:{})},body:JSON.stringify({operation:"login",email:"not-demo@example.invalid",password})});
 for(const host of ["localhost:3000","127.0.0.1:3000","[::1]:3000"]){
  const response=await api.POST(login(host,"http://"+host));
  assert.equal(response.status,200);assert.equal((await response.json()).account,null);
 }
 assert.equal((await api.POST(login("127.0.0.1:3000","https://other.example.invalid"))).status,403);
 assert.equal((await api.POST(login("127.0.0.1:3000","http://127.0.0.1:3001"))).status,403);
 assert.equal((await api.POST(login("127.0.0.1:3000","https://127.0.0.1:3000"))).status,403);
 assert.equal((await api.POST(login("127.0.0.1:3000","null"))).status,403);
 assert.equal((await api.POST(login("127.0.0.1:3000","https://other.example.invalid","other.example.invalid"))).status,403);
 const noOrigin=login("127.0.0.1:3000","http://127.0.0.1:3000");noOrigin.headers.delete("origin");assert.equal((await api.POST(noOrigin)).status,403);
 const notJson=login("127.0.0.1:3000","http://127.0.0.1:3000");notJson.headers.set("content-type","text/plain");assert.equal((await api.POST(notJson)).status,403);
});

test("repeated incorrect passwords are throttled",async()=>{
 configure();let response;for(let n=0;n<10;n++)response=await api.POST(post({operation:"login",email:accounts[1].email,password:"wrong"}));assert.equal(response.status,429);
});
