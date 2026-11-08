"use client";

import {
  createContext,
  useMemo,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  isAuthApiError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
  type User,
} from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase";
import { hasAdminPrivilege, isActiveAdministrator, type AdminPrivilege } from "@/lib/adminPrivileges";
import {
  type AdminRole,
  getAdminDashboardPath,
  getAdminRole,
} from "@/lib/auth/roles";

interface AdminAuthContextValue {
  user: User | null;
  role: AdminRole | null;
  loading: boolean;
  configurationError: string | null;
  signOut: () => Promise<void>;
  can: (privilege: AdminPrivilege) => boolean;
  refreshUser: () => Promise<void>;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

interface SessionState {
  user: User | null;
  loading: boolean;
  sessionError: string | null;
}

const signedOutSession: SessionState = { user: null, loading: false, sessionError: null };
const loadingSession: SessionState = { ...signedOutSession, loading: true };

export function AdminAuthProvider({
  children,
  requiredRole = "super_admin",
}: {
  children: ReactNode;
  requiredRole?: AdminRole | null;
}) {
  const [{ user, loading, sessionError }, setSession] = useState(loadingSession);
  const checkSessionRef = useRef<(() => Promise<void>) | null>(null);
  const clientState = useMemo(() => {
    try {
      return { client: getSupabaseClient(), error: null };
    } catch (error) {
      return {
        client: null,
        error:
          error instanceof Error
            ? error.message
            : "Supabase configuration is unavailable.",
      };
    }
  }, []);
  const configurationError = clientState.error ?? sessionError;
  const router = useRouter();
  const role = getAdminRole(user);
  const activeAdministrator = isActiveAdministrator(user);

  useEffect(() => {
    const client = clientState.client;
    if (!client) return;

    let pendingCheck: Promise<void> | null = null;
    let sessionUserId: string | null = null;
    let authChangeTimer: number | undefined;

    const checkSession = () => {
      if (pendingCheck) return pendingCheck;

      const check: Promise<void> = client.auth.getUser().then(({ data, error }) => {
        if (error) throw error;
        if (pendingCheck !== check) return;

        sessionUserId = data.user?.id ?? null;
        setSession(current => {
          const sameUser = JSON.stringify(current.user) === JSON.stringify(data.user);
          if (sameUser && !current.loading && !current.sessionError) return current;
          return { ...signedOutSession, user: sameUser ? current.user : data.user };
        });
      }).catch((error: unknown) => {
        if (pendingCheck === check) {
          if (isAuthSessionMissingError(error) || (isAuthApiError(error) && (error.status === 401 || error.status === 403))) {
            sessionUserId = null;
            setSession(signedOutSession);
          } else {
            const retryable = isAuthRetryableFetchError(error);
            const sessionError = retryable
              ? "Can't reach the sign-in service. Check your connection and try again."
              : "Unable to validate your administrator session. Try again.";
            setSession(current => retryable && current.user ? current : { ...signedOutSession, sessionError });
          }
        }
        throw error;
      }).finally(() => {
        if (pendingCheck === check) pendingCheck = null;
      });

      pendingCheck = check;
      return check;
    };

    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      void checkSession().catch(() => {});
    };

    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION") return;
      window.clearTimeout(authChangeTimer);

      if (!session) {
        pendingCheck = null;
        sessionUserId = null;
        setSession(signedOutSession);
        return;
      }

      if (session.user.id !== sessionUserId) {
        pendingCheck = null;
        sessionUserId = session.user.id;
        setSession(loadingSession);
      }
      // Start the server check after Supabase finishes delivering the auth event.
      authChangeTimer = window.setTimeout(refresh, 0);
    });

    checkSessionRef.current = checkSession;
    refresh();
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      pendingCheck = null;
      checkSessionRef.current = null;
      subscription.unsubscribe();
      window.clearTimeout(authChangeTimer);
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [clientState.client]);

  useEffect(() => {
    if (loading || configurationError) {
      return;
    }
    if (!activeAdministrator || !role) {
      router.replace("/login");
    } else if (requiredRole && role !== requiredRole) {
      router.replace(getAdminDashboardPath(role));
    }
  }, [activeAdministrator, configurationError, loading, requiredRole, role, router]);

  const signOut = async () => {
    const supabase = clientState.client;
    if (!supabase) {
      throw new Error(clientState.error ?? "Supabase configuration is unavailable.");
    }
    const { error } = await supabase.auth.signOut();
    if (error) {
      throw error;
    }
    setSession(signedOutSession);
    router.replace("/login");
  };

  const refreshUser = async () => {
    const checkSession = checkSessionRef.current;
    if (!checkSession) throw new Error("Account service is unavailable.");
    await checkSession();
  };

  const retrySession = () => {
    setSession(current => ({ ...current, loading: true }));
    void refreshUser().catch(() => {});
  };

  if (configurationError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F6F8] p-6">
        <div className="max-w-xl rounded-xl border border-[#FECACA] bg-white p-6 text-sm text-[#991B1B] shadow-sm">
          <p role="alert">{configurationError}</p>
          {sessionError && (
            <button type="button" onClick={retrySession} disabled={loading} className="mt-3 rounded-md border border-red-200 px-3 py-1.5 font-medium hover:bg-red-50 disabled:opacity-50">
              {loading ? "Retrying…" : "Retry"}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (
    loading ||
    !user ||
    !role ||
    !activeAdministrator ||
    (requiredRole && role !== requiredRole)
  ) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F6F8] text-sm font-medium text-[#475569]">
        Validating administrator session...
      </div>
    );
  }

  return (
    <AdminAuthContext.Provider
      value={{ user, role, loading, configurationError, signOut, refreshUser, can: privilege => hasAdminPrivilege(user, privilege) }}
    >
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  const context = useContext(AdminAuthContext);
  if (!context) {
    throw new Error("useAdminAuth must be used inside AdminAuthProvider.");
  }
  return context;
}
