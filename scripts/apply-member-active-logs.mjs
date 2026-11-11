import {readFileSync,writeFileSync,copyFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
const stage=resolve('docs/active-logs/member-client');
const manifest=JSON.parse(readFileSync(resolve(stage,'manifest.json'),'utf8'));
const root=resolve('../coop_frontend_client');
if(resolve(manifest.root)!==root)throw Error('Unexpected member workspace');
for(const file of manifest.files){
 const target=resolve(root,file.path),path=relative(root,target);
 if(path.startsWith('..')||isAbsolute(path))throw Error('Path outside member workspace');
 if(file.originalSha256){
  const current=readFileSync(target,'utf8');
  if(createHash('sha256').update(current).digest('hex')!==file.originalSha256)throw Error('Member file changed since preparation: '+file.path);
 }else if(existsSync(target))throw Error('Refusing to replace an existing file: '+file.path);
 if(!existsSync(resolve(stage,file.path)))throw Error('Missing prepared file: '+file.path);
}
for(const file of manifest.files){
 const target=resolve(root,file.path);
 if(file.originalSha256){const backup=resolve(stage,'before',file.path);mkdirSync(dirname(backup),{recursive:true});writeFileSync(backup,readFileSync(target));}
 mkdirSync(dirname(target),{recursive:true});copyFileSync(resolve(stage,file.path),target);
}
console.log('Applied '+manifest.files.length+' prepared member Active Logs files. Existing member source backups remain in the admin workspace.');
