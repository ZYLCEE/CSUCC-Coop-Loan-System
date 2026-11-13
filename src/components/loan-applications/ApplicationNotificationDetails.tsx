"use client";
import {usePathname,useRouter,useSearchParams} from "next/navigation";
import LoanDetailsModal from "./LoanDetailsModal";
export default function ApplicationNotificationDetails(){
 const params=useSearchParams(),path=usePathname(),router=useRouter(),id=params.get("application");
 if(!id||id.length>100||!/^[A-Za-z0-9_-]+$/.test(id))return null;
 return <LoanDetailsModal applicationId={id} onClose={()=>{const next=new URLSearchParams(params);next.delete("application");router.replace(path+(next.size?"?"+next.toString():""),{scroll:false});}}/>;
}
