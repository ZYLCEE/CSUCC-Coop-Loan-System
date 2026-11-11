"use client";

import { navigateRecordMenu, recordMenuPosition } from "@/components/shared/recordMenu";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/Feedback";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  Eye,
  KeyRound,
  MoreVertical,
  Pencil,
  Trash2,
  Unlock,
  UserRoundCog,
} from "lucide-react";
import { Member } from "./MembersData";
import RoleBadge from "./RoleBadge";
import {formatAccountNumber} from "@/lib/accountPresentation";
import StatusBadge from "./StatusBadge";
import MembershipTypeBadge from "@/components/shared/MembershipTypeBadge";
import { useAdminAuth } from "@/components/auth/AdminAuthProvider";
import { accountActions } from "./accountActions";

interface MembersTableProps {
  members: Member[];
  readOnly?: boolean;
  onViewMember: (member: Member) => void;
  onEditMember: (member: Member) => void;
  onToggleBlockStatus: (member: Member) => void;
  onDeleteMember: (member: Member) => void;
  onResetPassword: (member: Member) => void;
  onManagePrivileges: (member: Member) => void;
}

type ActionMenuState = ReturnType<typeof recordMenuPosition> & { idNumber: string };

const menuItem = "ui-button ui-button--ghost min-h-11 w-full justify-start gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-portal-primary hover:bg-surface-muted";
const menuIcon = "h-5 w-5 shrink-0 text-portal-muted";
const protectedMessage = "Super Admin account changes are restricted in COOP.";
const getDisplayIdNumber = formatAccountNumber;

export default function MembersTable({
  members,
  readOnly = false,
  onViewMember,
  onEditMember,
  onToggleBlockStatus,
  onDeleteMember,
  onResetPassword,
  onManagePrivileges,
}: MembersTableProps) {
  const router = useRouter();
  const { user, role } = useAdminAuth();
  const [openMenu, setOpenMenu] = useState<ActionMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (openMenu) menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [openMenu]);
  const selectedMember = openMenu
    ? members.find((member) => (member.accountKey ?? member.idNumber) === openMenu.idNumber)
    : null;

  const actions = selectedMember ? accountActions(selectedMember, user?.id, role, readOnly) : null;
  const choose = (callback: (member: Member) => void) => {
    if (!selectedMember) return;
    menuTrigger.current?.focus({ preventScroll: true });
    setOpenMenu(null);
    callback(selectedMember);
  };

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      if (target.closest("[data-member-action-button='true']")) {
        return;
      }

      if (menuRef.current && !menuRef.current.contains(target)) {
        setOpenMenu(null);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenu(null);
      }
    };

    const closeOnViewportChange = () => setOpenMenu(null);
    const closeOnScroll = (event: Event) => {
      if (!(event.target instanceof Node) || !menuRef.current?.contains(event.target)) closeOnViewportChange();
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnScroll, true);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnScroll, true);
    };
  }, []);

  const handleActionButtonClick = (
    member: Member,
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    const accountKey = member.accountKey ?? member.idNumber;
    if (openMenu?.idNumber === accountKey) {
      setOpenMenu(null);
      return;
    }

    menuTrigger.current = event.currentTarget;

    setOpenMenu({
      idNumber: accountKey,
      ...recordMenuPosition(event.currentTarget, 250, 280),
    });
  };

  return (
    <div className="relative">
      <DataTable label="Accounts table" density="compact" className="min-w-[1000px] table-fixed">
          <colgroup>
              <col className="w-[14%]" />
              <col className="w-[14%]" />
              <col className="w-[20%]" />
              <col className="w-[11%]" />
              <col className="w-[12%]" />
              <col className="w-[14%]" />
              <col className="w-[8%]" />
              <col className="w-[7%]" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">
                ID Number
              </th>
              <th scope="col">
                Full Name
              </th>
              <th scope="col">
                Email Address
              </th>
              <th scope="col">
              Role
              </th>
              <th scope="col">
                Membership Type
              </th>
              <th scope="col">
              Department
              </th>
              <th scope="col">
                Status
              </th>
              <th scope="col" className="text-center">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {members.length > 0 ? (
              members.map((member) => (
                <tr
                  key={member.accountKey ?? member.idNumber}
                >
                  <td className="whitespace-normal text-body font-semibold text-coop-dashboard-green [overflow-wrap:anywhere]" title={member.idNumber}>
                    {member.idNumber ? getDisplayIdNumber(member.idNumber) : "N/A"}
                  </td>
                  <td className="whitespace-normal text-body font-semibold text-portal-primary [overflow-wrap:anywhere]" title={member.fullName}>
                    {member.fullName || "Not recorded"}
                    {member.integrityIssue && (
                      <span className="mt-1 block truncate text-caption font-medium text-status-warning" title={member.integrityIssue}>
                        Data integrity issue
                      </span>
                    )}
                  </td>
                  <td className="whitespace-normal text-body font-normal text-portal-primary [overflow-wrap:anywhere]" title={member.email}>
                    {member.email ? (
                      <a
                        href={`mailto:${member.email}`}
                        className="block transition-colors hover:text-coop-dashboard-green"
                      >
                        {member.email}
                      </a>
                    ) : (
                      "Not recorded"
                    )}
                  </td>
                  <td>
                    <RoleBadge role={member.role} />
                  </td>
                  <td>
                    {member.role === "Member" ? (
                      <MembershipTypeBadge membershipType={member.membershipType} />
                    ) : (
                      <span className="text-caption text-portal-secondary">N/A</span>
                    )}
                  </td>
                  <td className="truncate text-body font-normal text-portal-primary" title={member.department}>
                    {member.role === "Member" ? member.department || "N/A" : "N/A"}
                  </td>
                  <td>
                    <StatusBadge status={member.status} />
                  </td>
                  <td>
                    <div className="flex justify-center">
                      <button
                        type="button"
                        data-member-action-button="true"
                        onClick={(event) => handleActionButtonClick(member, event)}
                        className="ui-icon-button"
                        aria-label={`Open actions for ${member.fullName}`}
                        aria-haspopup="menu"
                        aria-expanded={openMenu?.idNumber === (member.accountKey ?? member.idNumber)}
                      >
                        <MoreVertical className="size-icon" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : null}
          </tbody>
      </DataTable>
      {!members.length && <EmptyState title="No accounts found." description={"Try changing your search or filters."} />}

      {openMenu && selectedMember && actions && (
        <div ref={menuRef} style={{ top: openMenu.top, bottom: openMenu.bottom, left: openMenu.left, maxHeight: openMenu.maxHeight }}
          onKeyDown={event => navigateRecordMenu(event, () => { setOpenMenu(null); menuTrigger.current?.focus({ preventScroll: true }); })}
          className="ui-card fixed z-[60] w-[250px] overflow-y-auto rounded-2xl p-2 shadow-portal-dropdown" role="menu">
          <button type="button" role="menuitem" onClick={() => choose(onViewMember)} className={menuItem}><Eye className={menuIcon} aria-hidden="true" />View Details</button>
          {actions.ownSuper ? <button type="button" role="menuitem" className={menuItem} onClick={() => {
            setOpenMenu(null); router.push(window.location.pathname.startsWith("/super-admin/") ? "/super-admin/profile" : "/profile");
          }}><Pencil className={menuIcon} aria-hidden="true" />Edit</button> : <>
            {(actions.edit || actions.protectedSuper) && <button type="button" role="menuitem" disabled={!actions.edit} title={!actions.edit ? protectedMessage : undefined} onClick={() => choose(onEditMember)} className={menuItem}><Pencil className={menuIcon} aria-hidden="true" />Edit</button>}
            {actions.reset && <button type="button" role="menuitem" onClick={() => choose(onResetPassword)} className={menuItem}><KeyRound className={menuIcon} aria-hidden="true" />Reset Password</button>}
            {actions.privileges && <button type="button" role="menuitem" onClick={() => choose(onManagePrivileges)} className={menuItem}><UserRoundCog className={menuIcon} aria-hidden="true" />Role &amp; Privileges</button>}
            {(actions.block || actions.protectedSuper) && <button type="button" role="menuitem" disabled={!actions.block} title={!actions.block ? protectedMessage : undefined} onClick={() => choose(onToggleBlockStatus)} className={menuItem}>
              {selectedMember.status === "Blocked" ? <Unlock className={menuIcon} aria-hidden="true" /> : <Ban className={menuIcon} aria-hidden="true" />}{selectedMember.status === "Blocked" ? "Unblock" : "Block"}
            </button>}
            {(actions.delete || actions.protectedSuper) && <button type="button" role="menuitem" disabled={!actions.delete} title={!actions.delete ? protectedMessage : undefined} onClick={() => choose(onDeleteMember)} className={`${menuItem} mt-1 bg-status-danger-surface text-status-danger hover:bg-status-danger-surface`}><Trash2 className="h-5 w-5 shrink-0" aria-hidden="true" />Delete</button>}
            {actions.protectedSuper && <p className="px-3 pb-1 pt-2 text-xs leading-5 text-portal-muted">{protectedMessage}</p>}
          </>}
        </div>
      )}
    </div>
  );
}
