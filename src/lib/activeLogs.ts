import {accountRoles} from "./accountPresentation";
export const activeLogRoles=accountRoles;
export type ActiveLogRole=keyof typeof activeLogRoles;
export type ActiveLogRow={id:string;accountNumber:string|null;name:string;role:ActiveLogRole;action:string;browser:string|null;os:string|null;timeIn:string|null;timeOut:string|null;sessionState:"active"|"closed"|"activity";ipAddress:string|null;details:string};
export type ActiveLogFilters={search:string;role:string;from:string;to:string;page:number;pageSize:number};
export type ActiveLogPage={rows:ActiveLogRow[];total:number;page:number;pageSize:number};
export function validLogDate(value:string){const date=new Date(value+"T00:00:00Z");return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;}
export function activeLogFilters(params:URLSearchParams):ActiveLogFilters{
  const search=(params.get("search")??"").trim(),role=params.get("role")??"",from=params.get("from")??"",to=params.get("to")??"";
  if(search.length>160||role&&!Object.hasOwn(activeLogRoles,role)||from&&!validLogDate(from)||to&&!validLogDate(to)||from&&to&&from>to)throw new Error("Choose a valid search, role and date range.");
  const page=Number(params.get("page")??1),pageSize=Number(params.get("pageSize")??10);
  if(!Number.isSafeInteger(page)||page<1||page>100000||![10,25,50].includes(pageSize))throw new Error("Choose valid pagination options.");
  return {search,role,from,to,page,pageSize};
}
export function logDateTime(value:string|null){if(!value||!Number.isFinite(Date.parse(value)))return null;const date=new Date(value);return {date:new Intl.DateTimeFormat("en-PH",{timeZone:"Asia/Manila",month:"short",day:"numeric",year:"numeric"}).format(date),time:new Intl.DateTimeFormat("en-PH",{timeZone:"Asia/Manila",hour:"numeric",minute:"2-digit"}).format(date)};}
