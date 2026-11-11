import {notFound} from "next/navigation";
import CommitteeWorkspace from "@/components/committee/CommitteeWorkspace";
export default async function CommitteeSection({params}:{params:Promise<{section:string}>}){
 const {section}=await params;
 if(!["dashboard","assignments","notifications","history","profile","active-logs"].includes(section))notFound();
 return <CommitteeWorkspace section={section} />;
}
