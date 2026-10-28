"use client";

import { FileText, Download, Pencil, Trash2, Filter } from "lucide-react";
import { Document } from "./DocumentsData";
import FileTypeBadge from "./FileTypeBadge";

interface DocumentsTableProps {
  documents: Document[];
}

export default function DocumentsTable({ documents }: DocumentsTableProps) {
  const getIconColor = (type: string) => {
    const colors = {
      PDF: "text-red-500",
      DOCX: "text-blue-500",
      PNG: "text-green-500",
      XLSX: "text-orange-500",
    };
    return colors[type as keyof typeof colors] || "text-[#6B7280]";
  };

  return (
    <div className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] border border-[#E5E7EB] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#E5E7EB]">
        <h2 className="text-[16px] font-semibold text-[#1F2937]">All Documents</h2>
        <button className="flex items-center gap-2 px-2.5 h-[32px] bg-white border border-[#E5E7EB] rounded-[10px] text-[12px] text-[#1F2937] hover:bg-[#F9FAFB] transition-colors">
          <Filter className="w-3.5 h-3.5" />
          Filter
        </button>
      </div>

      {/* Table */}
      <table className="w-full">
        <thead>
          <tr className="border-b border-[#E5E7EB]">
            <th className="text-left py-2 px-3 text-[10px] font-semibold uppercase text-[#6B7280] tracking-wider">
              Document Name
            </th>
            <th className="text-left py-2 px-3 text-[10px] font-semibold uppercase text-[#6B7280] tracking-wider">
              Category
            </th>
            <th className="text-left py-2 px-3 text-[10px] font-semibold uppercase text-[#6B7280] tracking-wider">
              Type
            </th>
            <th className="text-left py-2 px-3 text-[10px] font-semibold uppercase text-[#6B7280] tracking-wider">
              Size
            </th>
            <th className="text-left py-2 px-3 text-[10px] font-semibold uppercase text-[#6B7280] tracking-wider">
              Uploaded
            </th>
            <th className="text-center py-2 px-3 text-[10px] font-semibold uppercase text-[#6B7280] tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => (
            <tr key={doc.id} className="border-b border-[#E5E7EB] hover:bg-[#F8FAFC] transition-colors h-[42px]">
              <td className="px-3">
                <div className="flex items-center gap-2">
                  <FileText className={`w-3.5 h-3.5 flex-shrink-0 ${getIconColor(doc.type)}`} strokeWidth={2} />
                  <span className="text-[13px] font-semibold text-[#1F2937]">{doc.name}</span>
                </div>
              </td>
              <td className="px-3 text-[12px] text-[#4B5563]">{doc.category}</td>
              <td className="px-3">
                <FileTypeBadge type={doc.type} />
              </td>
              <td className="px-3 text-[12px] text-[#6B7280]">{doc.size}</td>
              <td className="px-3 text-[12px] text-[#6B7280]">{doc.uploaded}</td>
              <td className="px-3">
                <div className="flex items-center justify-center gap-1">
                  <button className="w-6 h-6 rounded-full flex items-center justify-center text-[#6B7280] hover:text-[#1F2937] transition-colors">
                    <Download className="w-[14px] h-[14px]" strokeWidth={2} />
                  </button>
                  <button className="w-6 h-6 rounded-full flex items-center justify-center text-[#6B7280] hover:text-[#1F2937] transition-colors">
                    <Pencil className="w-[14px] h-[14px]" strokeWidth={2} />
                  </button>
                  <button className="w-6 h-6 rounded-full flex items-center justify-center text-[#6B7280] hover:text-[#EF4444] transition-colors">
                    <Trash2 className="w-[14px] h-[14px]" strokeWidth={2} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
