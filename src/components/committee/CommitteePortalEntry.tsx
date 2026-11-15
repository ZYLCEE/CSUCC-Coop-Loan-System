"use client";
import type {ReactNode} from "react";
import CommitteeAuthProvider from "./CommitteeAuthProvider";
import type {CommitteeRole} from "@/lib/committee";

export default function CommitteePortalEntry({role,children}:{role:CommitteeRole;children:ReactNode}){
 return <CommitteeAuthProvider role={role}>{children}</CommitteeAuthProvider>;
}
