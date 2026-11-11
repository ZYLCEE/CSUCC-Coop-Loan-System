import type {ReactNode} from "react";
export function CommitteeField({label,children,id,error}:{label:string;children:ReactNode;id?:string;error?:string}){
 if(id)return <div className="flex min-w-0 flex-col gap-1 text-support font-medium"><label htmlFor={id}>{label}</label>{children}{error&&<p id={id+"-error"} className="text-caption text-status-danger">{error}</p>}</div>;
 return <label className="flex min-w-0 flex-col gap-1 text-support font-medium">{label}{children}</label>;
}
