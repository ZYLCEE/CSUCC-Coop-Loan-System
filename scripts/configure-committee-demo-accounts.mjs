import {randomBytes,scryptSync} from "node:crypto";
import {readFileSync,writeFileSync,existsSync} from "node:fs";
const positions={"crecom-1":{role:"crecom_member",seat:"member"},"crecom-2":{role:"crecom_member",seat:"member"},"crecom-chair":{role:"crecom_member",seat:"chairperson"},"bod-chair":{role:"bod_member",seat:"chairperson"}};
try{
 const input=JSON.parse(process.env.COOP_DEMO_ACCOUNT_INPUT??"null");delete process.env.COOP_DEMO_ACCOUNT_INPUT;
 if(!Array.isArray(input)||input.length!==4||new Set(input.map(row=>row.id)).size!==4||new Set(input.map(row=>row.email?.toLowerCase())).size!==4)throw new Error();
 const accounts=input.map(row=>{
  if(!positions[row.id]||typeof row.name!=="string"||!row.name.trim()||row.name.length>160||typeof row.email!=="string"||!/^\S+@\S+\.\S+$/.test(row.email)||typeof row.password!=="string"||row.password.length<8||row.password.length>128)throw new Error();
  const salt=randomBytes(16),passwordHash="scrypt-v1:"+salt.toString("hex")+":"+scryptSync(row.password,salt,64).toString("hex");
  return {id:row.id,name:row.name.trim(),email:row.email.trim().toLowerCase(),...positions[row.id],passwordHash};
 });
 const path=".env.local";let env=existsSync(path)?readFileSync(path,"utf8"):"";
 const values={COOP_COMMITTEE_DEMO_ACCOUNTS:Buffer.from(JSON.stringify(accounts)).toString("base64"),COOP_COMMITTEE_DEMO_SESSION_SECRET:randomBytes(48).toString("base64url")};
 for(const [key,value]of Object.entries(values)){const pattern=new RegExp("^"+key+"=.*$","m");env=pattern.test(env)?env.replace(pattern,key+"="+value):env.replace(/\s*$/,"")+"\n"+key+"="+value+"\n";}
 writeFileSync(path,env,{mode:0o600});
 console.log("Configured four private demonstration sign-ins: two CRECOM members, one CRECOM chairperson and one BOD chairperson. Only salted password hashes were saved in the ignored local environment file.");
}catch{console.error("Configuration failed. Supply four valid account records through COOP_DEMO_ACCOUNT_INPUT. Credentials were not printed.");process.exitCode=1;}
