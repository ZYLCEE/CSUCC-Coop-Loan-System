"use client";
import {useCommitteeAuth} from "./CommitteeAuthProvider";
import {ActiveLogsView} from "@/components/active-logs/ActiveLogsWorkspace";
export default function CommitteeActiveLogs(){
 const {role,prototype}=useCommitteeAuth();
 if(prototype)return <p className="text-support text-portal-secondary">Active Logs is available for your live cooperative account. Demonstration activity is not recorded.</p>;
 return <ActiveLogsView viewerRole={role} hideHeading/>;
}
