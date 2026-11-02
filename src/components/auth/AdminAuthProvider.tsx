"use client";

import {
  createContext,
  useMemo,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase";
import { hasAdminPrivilege, type AdminPrivilege } from "@/lib/adminPrivileges";
import {
  AdminRole,
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

export function AdminAuthProvider({
  children,
  requiredRole = "super_admin",
}: {
  children: ReactNode;
  requiredRole?: AdminRole;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [accountStatus, setAccountStatus] = useState<"active" | "denied">("active");
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

  useEffect(() => {
    const supabase = clientState.client;
    if (!supabase) return;

    void supabase.auth.getSession().then(async ({ data, error }) => {
      if (error) {
        console.error("Unable to validate the admin session:", error);
        setSessionError("Unable to validate the admin session.");
        setLoading(false);
        return;
      }
      const current = data.session ? await supabase.auth.getUser() : null;
      if (current?.error) throw current.error;
      setUser(current?.data.user ?? null);
      const status = current?.data.user?.app_metadata.account_status;
      setAccountStatus(status && status !== "active" ? "denied" : "active");
      setSessionError(null);
      setLoading(false);
    }).catch((error: unknown) => {
      console.error("Unable to load the admin session:", error);
      setSessionError("Unable to validate the admin session.");
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      const status = session?.user?.app_metadata.account_status;
      setAccountStatus(status && status !== "active" ? "denied" : "active");
      setSessionError(null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [clientState.client]);

  useEffect(() => {
    const client = clientState.client;
    if (!client) return;
    let active = true;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      void client.auth.getUser().then(({ data, error }) => {
        if (!active) return;
        if (error) return;
        if (!data.user) { setUser(null); return; }
        setUser(current => JSON.stringify(current) === JSON.stringify(data.user) ? current : data.user);
        const status = data.user.app_metadata.account_status;
        setAccountStatus(status && status !== "active" ? "denied" : "active");
      }).catch(() => { /* Requests still check current privileges on the server. */ });
    };
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [clientState.client]);

  useEffect(() => {
    if (loading || configurationError) {
      return;
    }
    if (!user || !role || accountStatus === "denied") {
      router.replace("/login");
    } else if (role !== requiredRole) {
      router.replace(getAdminDashboardPath(role));
    }
  }, [accountStatus, configurationError, loading, requiredRole, role, router, user]);

  const signOut = async () => {
    const supabase = clientState.client;
    if (!supabase) {
      throw new Error(clientState.error ?? "Supabase configuration is unavailable.");
    }
    const { error } = await supabase.auth.signOut();
    if (error) {
      throw error;
    }
    setUser(null);
    router.replace("/login");
  };

  const refreshUser = async () => {
    if (!clientState.client) throw new Error("Account service is unavailable.");
    const { data, error } = await clientState.client.auth.getUser();
    if (error) throw error;
    setUser(data.user);
    const status = data.user?.app_metadata.account_status;
    setAccountStatus(status && status !== "active" ? "denied" : "active");
  };

  if (configurationError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F6F8] p-6">
        <div className="max-w-xl rounded-xl border border-[#FECACA] bg-white p-6 text-sm text-[#991B1B] shadow-sm">
          {configurationError}
        </div>
      </div>
    );
  }

  if (
    loading ||
    !user ||
    !role ||
    accountStatus !== "active" ||
    role !== requiredRole
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
