"use client";

import { useState } from "react";
import { Check, X, Plus } from "lucide-react";

interface Permission {
  module: string;
  superAdmin: boolean;
  manager: boolean;
  loanOfficer: boolean;
  cashier: boolean;
  encoder: boolean;
}

export default function RolesPermissions() {
  const [showAddRoleModal, setShowAddRoleModal] = useState(false);
  const [permissions, setPermissions] = useState<Permission[]>([
    { module: "Dashboard", superAdmin: true, manager: true, loanOfficer: true, cashier: true, encoder: true },
    { module: "Loan Applications", superAdmin: true, manager: true, loanOfficer: true, cashier: true, encoder: true },
    { module: "Members", superAdmin: true, manager: true, loanOfficer: true, cashier: true, encoder: true },
    { module: "Active Loans", superAdmin: true, manager: true, loanOfficer: true, cashier: true, encoder: false },
    { module: "Notifications", superAdmin: true, manager: true, loanOfficer: true, cashier: false, encoder: false },
    { module: "Announcements", superAdmin: true, manager: true, loanOfficer: true, cashier: false, encoder: false },
    { module: "Documents", superAdmin: true, manager: true, loanOfficer: false, cashier: false, encoder: false },
    { module: "Content Manager", superAdmin: true, manager: true, loanOfficer: false, cashier: false, encoder: false },
    { module: "Reports", superAdmin: true, manager: true, loanOfficer: false, cashier: false, encoder: false },
    { module: "Audit Logs", superAdmin: true, manager: false, loanOfficer: false, cashier: false, encoder: false },
    { module: "Settings", superAdmin: true, manager: false, loanOfficer: false, cashier: false, encoder: false },
  ]);

  const togglePermission = (index: number, role: keyof Omit<Permission, "module">) => {
    setPermissions((prev) =>
      prev.map((perm, i) =>
        i === index ? { ...perm, [role]: !perm[role] } : perm
      )
    );
  };

  return (
    <div className="bg-white rounded-[18px] shadow-[0_2px_10px_rgba(0,0,0,0.05)] border border-[#E5E7EB] p-3">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[14px] font-bold text-[#1F2937]">Role Permissions</h2>
        <button
          onClick={() => setShowAddRoleModal(true)}
          className="flex items-center gap-1.5 px-3 h-7 bg-[#166534] rounded-full text-[12px] font-medium text-white hover:bg-[#14532D] transition-colors"
        >
          <Plus className="w-3 h-3" />
          Add Role
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#E5E7EB]">
              <th className="text-left py-2 px-2 text-[10px] font-semibold uppercase text-[#9CA3AF] tracking-wider">
                Module
              </th>
              <th className="text-center py-2 px-2 text-[10px] font-semibold uppercase text-[#9CA3AF] tracking-wider">
                Super Admin
              </th>
              <th className="text-center py-2 px-2 text-[10px] font-semibold uppercase text-[#9CA3AF] tracking-wider">
                Manager
              </th>
              <th className="text-center py-2 px-2 text-[10px] font-semibold uppercase text-[#9CA3AF] tracking-wider">
                Loan Officer
              </th>
              <th className="text-center py-2 px-2 text-[10px] font-semibold uppercase text-[#9CA3AF] tracking-wider">
                Cashier
              </th>
              <th className="text-center py-2 px-2 text-[10px] font-semibold uppercase text-[#9CA3AF] tracking-wider">
                Encoder
              </th>
            </tr>
          </thead>
          <tbody>
            {permissions.map((perm, index) => (
              <tr key={perm.module} className="border-b border-[#E5E7EB] h-[36px]">
                <td className="px-2 text-[12px] font-medium text-[#1F2937]">{perm.module}</td>
                <td className="px-2">
                  <button
                    onClick={() => togglePermission(index, "superAdmin")}
                    className="flex items-center justify-center w-full"
                  >
                    {perm.superAdmin ? (
                      <Check className="w-3.5 h-3.5 text-[#10B981]" />
                    ) : (
                      <X className="w-3.5 h-3.5 text-[#D1D5DB]" />
                    )}
                  </button>
                </td>
                <td className="px-2">
                  <button
                    onClick={() => togglePermission(index, "manager")}
                    className="flex items-center justify-center w-full"
                  >
                    {perm.manager ? (
                      <Check className="w-3.5 h-3.5 text-[#10B981]" />
                    ) : (
                      <X className="w-3.5 h-3.5 text-[#D1D5DB]" />
                    )}
                  </button>
                </td>
                <td className="px-2">
                  <button
                    onClick={() => togglePermission(index, "loanOfficer")}
                    className="flex items-center justify-center w-full"
                  >
                    {perm.loanOfficer ? (
                      <Check className="w-3.5 h-3.5 text-[#10B981]" />
                    ) : (
                      <X className="w-3.5 h-3.5 text-[#D1D5DB]" />
                    )}
                  </button>
                </td>
                <td className="px-2">
                  <button
                    onClick={() => togglePermission(index, "cashier")}
                    className="flex items-center justify-center w-full"
                  >
                    {perm.cashier ? (
                      <Check className="w-3.5 h-3.5 text-[#10B981]" />
                    ) : (
                      <X className="w-3.5 h-3.5 text-[#D1D5DB]" />
                    )}
                  </button>
                </td>
                <td className="px-2">
                  <button
                    onClick={() => togglePermission(index, "encoder")}
                    className="flex items-center justify-center w-full"
                  >
                    {perm.encoder ? (
                      <Check className="w-3.5 h-3.5 text-[#10B981]" />
                    ) : (
                      <X className="w-3.5 h-3.5 text-[#D1D5DB]" />
                    )}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add Role Modal */}
      {showAddRoleModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[18px] shadow-[0_2px_10px_rgba(0,0,0,0.05)] border border-[#E5E7EB] w-full max-w-md p-6">
            <h2 className="text-[20px] font-bold text-[#1F2937] mb-4">Add New Role</h2>
            
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-[15px] font-medium text-[#1F2937] mb-1.5">
                  Role Name
                </label>
                <input
                  type="text"
                  placeholder="Enter role name"
                  className="w-full h-10 px-4 bg-white border border-[#E5E7EB] rounded-[10px] text-[15px] text-[#1F2937] focus:outline-none focus:ring-2 focus:ring-[#166534]/20 focus:border-[#166534]"
                />
              </div>
              <div>
                <label className="block text-[15px] font-medium text-[#1F2937] mb-1.5">
                  Description
                </label>
                <textarea
                  placeholder="Enter role description"
                  className="w-full h-24 px-4 bg-white border border-[#E5E7EB] rounded-[10px] text-[15px] text-[#1F2937] focus:outline-none focus:ring-2 focus:ring-[#166534]/20 focus:border-[#166534] resize-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowAddRoleModal(false)}
                className="px-4 h-10 bg-white border border-[#E5E7EB] rounded-[10px] text-[15px] font-medium text-[#1F2937] hover:bg-[#F9FAFB]"
              >
                Cancel
              </button>
              <button
                onClick={() => setShowAddRoleModal(false)}
                className="px-4 h-10 bg-[#166534] rounded-[10px] text-[15px] font-medium text-white hover:bg-[#14532D]"
              >
                Create Role
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
