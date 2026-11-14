"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchDashboardActiveMembers, fetchDashboardLoans } from "./dashboard-data";

import { fetchDashboardCollections, fetchDashboardDisbursement } from "./dashboard-financials";
import {usePortalLiveUpdates} from "@/lib/usePortalLiveUpdates";
import type {ReportRange} from "./dashboard-model";

export interface DashboardResource<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

function useDashboardResource<T>(load: () => Promise<T>) {
  const [attempt, setAttempt] = useState(0);
  const [resource, setResource] = useState<DashboardResource<T> & {source:()=>Promise<T>}>({
    data: null, loading: true, error: null, source: load,
  });
  const request = useRef<{ attempt: number; load: () => Promise<T>; promise: Promise<T> } | null>(null);

  useEffect(() => {
    let active = true;
    // Reuse the in-flight request during React Strict Mode's effect replay.
    if (!request.current || request.current.attempt !== attempt || request.current.load !== load) {
      request.current = { attempt, load, promise: load() };
    }
    void request.current.promise.then((data) => {
      if (active) setResource({ data, loading: false, error: null, source: load });
    }).catch((error: unknown) => {
      if (active) setResource({
        data: null, loading: false, source: load,
        error: error instanceof Error ? error.message : "Unable to load dashboard data. Please retry.",
      });
    });
    return () => { active = false; };
  }, [attempt, load]);

  const retry = useCallback(() => { setAttempt(value => value + 1); }, []);
  return resource.source===load?{data:resource.data,loading:resource.loading,error:resource.error,retry}:{data:null,loading:true,error:null,retry};
}

export function useDashboardData(range: ReportRange) {
  const loans = useDashboardResource(fetchDashboardLoans);
  const activeMembers = useDashboardResource(fetchDashboardActiveMembers);
  const loadCollections = useCallback(() => fetchDashboardCollections(range.start, range.end), [range.start, range.end]);
  const loadDisbursement = useCallback(() => fetchDashboardDisbursement(range.start, range.end), [range.start, range.end]);
  const collections = useDashboardResource(loadCollections);
  const disbursement = useDashboardResource(loadDisbursement);
  const retryLoans=loans.retry,retryMembers=activeMembers.retry,retryCollections=collections.retry,retryDisbursement=disbursement.retry;
  const refresh=useCallback(()=>{retryLoans();retryMembers();retryCollections();retryDisbursement();},[retryLoans,retryMembers,retryCollections,retryDisbursement]);
  const connected=usePortalLiveUpdates(refresh);
  return { loans, activeMembers, collections, disbursement, connected };
}
