"use client";

import { useEffect, useRef, useState } from "react";
import { fetchDashboardActiveMembers, fetchDashboardLoans } from "./dashboard-data";

export interface DashboardResource<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

function useDashboardResource<T>(load: () => Promise<T>) {
  const [attempt, setAttempt] = useState(0);
  const [resource, setResource] = useState<DashboardResource<T>>({
    data: null, loading: true, error: null,
  });
  const request = useRef<{ attempt: number; promise: Promise<T> } | null>(null);

  useEffect(() => {
    let active = true;
    // Reuse the in-flight request during React Strict Mode's effect replay.
    if (!request.current || request.current.attempt !== attempt) {
      request.current = { attempt, promise: load() };
    }
    void request.current.promise.then((data) => {
      if (active) setResource({ data, loading: false, error: null });
    }).catch((error: unknown) => {
      if (active) setResource({
        data: null, loading: false,
        error: error instanceof Error ? error.message : "Unable to load dashboard data. Please retry.",
      });
    });
    return () => { active = false; };
  }, [attempt, load]);

  const retry = () => {
    setResource({ data: null, loading: true, error: null });
    setAttempt((value) => value + 1);
  };
  return { ...resource, retry };
}

export function useDashboardData() {
  const loans = useDashboardResource(fetchDashboardLoans);
  const activeMembers = useDashboardResource(fetchDashboardActiveMembers);
  return { loans, activeMembers };
}
