"use client";

import {
  FileCheck,
  Bell,
  Megaphone,
  BarChart3,
  UserPlus,
  Upload,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAdminAuth } from "@/components/auth/AdminAuthProvider";

interface QuickAction {
  label: string;
  icon: LucideIcon;
  color: string;
  href: string;
}

const quickActions: QuickAction[] = [
  {
    label: "Process Application",
    icon: FileCheck,
    color: "#1A5E38",
    href: "/loan-applications",
  },
  {
    label: "Send Notification",
    icon: Bell,
    color: "#C9A227",
    href: "/notifications",
  },
  {
    label: "Post Announcement",
    icon: Megaphone,
    color: "#2563EB",
    href: "/announcements",
  },
  {
    label: "Generate Report",
    icon: BarChart3,
    color: "#7E22CE",
    href: "/reports",
  },
  {
    label: "Add Member",
    icon: UserPlus,
    color: "#0F9D8A",
    href: "/members",
  },
  {
    label: "Upload Document",
    icon: Upload,
    color: "#F97316",
    href: "/documents",
  },
];

interface QuickActionsProps {
  className?: string;
}

export default function QuickActions({ className = "" }: QuickActionsProps) {
  const pathname = usePathname();
  const { role } = useAdminAuth();

  const resolveHref = (href: string) => {
    const normalized = href.startsWith("/") ? href : `/${href}`;
    if (pathname.startsWith("/admin/") || pathname.startsWith("/super-admin/")) {
      const prefix = role === "super_admin" ? "/super-admin" : "/admin";
      return `${prefix}${normalized}`;
    }
    return normalized;
  };

  return (
    <div className={`bg-white rounded-[14px] p-3 shadow-[0_1px_3px_rgba(0,0,0,0.04)] border border-[#ECECEC] ${className}`}>
      <h2 className="text-[14px] font-semibold text-[#0F172A] leading-tight mb-2">Quick Actions</h2>

      <div className="flex flex-nowrap gap-2">
        {quickActions.map((action) => (
          <Link
            key={action.href}
            href={resolveHref(action.href)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full text-white font-semibold transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md cursor-pointer text-[12px]"
            style={{ backgroundColor: action.color }}
          >
            <action.icon className="w-3.5 h-3.5" />
            <span>{action.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
