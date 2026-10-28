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

    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        console.error("Unable to validate the admin session:", error);
        setSessionError("Unable to validate the admin session.");
        setLoading(false);
        return;
      }
      setUser(data.session?.user ?? null);
      const status = data.session?.user?.app_metadata.account_status;
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
      value={{ user, role, loading, configurationError, signOut }}
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
