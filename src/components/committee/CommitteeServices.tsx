"use client";
import {createContext,useContext,type ReactNode} from "react";
import {committeeRequest} from "@/lib/committeeRequest";
import {reviewRequest} from "@/lib/committeeReviewRequest";
export type CommitteeServices={committeeRequest:typeof committeeRequest;reviewRequest:typeof reviewRequest};
const realServices:CommitteeServices={committeeRequest,reviewRequest};
const Context=createContext<CommitteeServices>(realServices);
export function CommitteeServicesProvider({value,children}:{value:CommitteeServices;children:ReactNode}){return <Context.Provider value={value}>{children}</Context.Provider>;}
export function useCommitteeServices(){return useContext(Context);}
