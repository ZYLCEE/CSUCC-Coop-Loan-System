import{readFileSync,writeFileSync}from'node:fs';
const inputs={
 'src/components/committee/ReviewerResponseDialog.tsx':['Your account password'],
 'src/components/committee/CommitteePrototype.tsx':['Prototype password'],
 'src/components/committee/CommitteeProfile.tsx':['Current password','New password','Confirm new password'],
 'src/components/loan-applications/ReturnApplicationDialog.tsx':['Your account password'],
 'src/components/loan-applications/LoanReleaseDialog.tsx':['Your account password'],
 'src/components/loan-applications/CommitteeReviewPanel.tsx':['Your account password'],
 'src/components/settings/WorkflowPolicyActivation.tsx':['Your Super Admin password'],
 'src/components/members/AccountPrivilegesDialog.tsx':['Your Super Admin Password'],
};
for(const[file,labels]of Object.entries(inputs)){
 let text=readFileSync(file,'utf8'),index=0;
 text=text.replace(/<Input\b[\s\S]*?\/>/g,tag=>{
  if(!tag.includes('type="password"'))return tag;
  return tag.replace('<Input','<PasswordInput label='+JSON.stringify(labels[index++])).replace('type="password"','');
 });
 if(index!==labels.length)throw Error('Unexpected password input count: '+file);
 text=text.replace('"use client";','"use client";\nimport PasswordInput from "@/components/ui/PasswordInput";');
 if(!text.includes('<Input'))text=text.replace(/import \{Input\} from "@\/components\/ui\/Fields";\r?\n/,'').replace('{Input,Textarea}','{Textarea}').replace('{Input,Select,Textarea}','{Select,Textarea}').replace('{ Input } from "@/components/ui/Fields";','{ } from "@/components/ui/Fields";').replace(/import \{ \} from "@\/components\/ui\/Fields";\r?\n/,'');
 writeFileSync(file,text);
}
const file='src/components/settings/RolesPermissions.tsx';
let text=readFileSync(file,'utf8');text=text.replace('"use client";','"use client";\nimport PasswordInput from "@/components/ui/PasswordInput";').replace('<input type="password"','<PasswordInput label="Your Super Admin password" wrapperClassName="mt-2 max-w-sm"').replace('className="ui-field mt-2 block w-full max-w-sm"','');writeFileSync(file,text);
