"use client";

import { FileText, FileCheck, Shield, Book } from "lucide-react";
import DocumentCategoryCard from "@/components/documents/DocumentCategoryCard";
import UploadArea from "@/components/documents/UploadArea";
import DocumentsTable from "@/components/documents/DocumentsTable";
import { documents } from "@/components/documents/DocumentsData";

export default function DocumentsPage() {
  return (
    <div className="px-6 py-3">
      {/* Document Category Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-[12px] mb-3">
        <DocumentCategoryCard
          icon={FileText}
          title="Loan Forms"
          count={documents.filter((document) => document.category === "Loan Forms").length}
          iconBgColor="bg-blue-50"
          iconColor="text-[#2563EB]"
        />
        <DocumentCategoryCard
          icon={FileCheck}
          title="Terms & Conditions"
          count={documents.filter((document) => document.category === "Terms & Conditions").length}
          iconBgColor="bg-green-50"
          iconColor="text-[#16A34A]"
        />
        <DocumentCategoryCard
          icon={Shield}
          title="Policies"
          count={documents.filter((document) => document.category === "Policies").length}
          iconBgColor="bg-purple-50"
          iconColor="text-[#9333EA]"
        />
        <DocumentCategoryCard
          icon={Book}
          title="Guidelines"
          count={documents.filter((document) => document.category === "Guidelines").length}
          iconBgColor="bg-orange-50"
          iconColor="text-[#F59E0B]"
        />
      </div>

      {/* Upload Area */}
      <div className="mb-3">
        <UploadArea />
      </div>

      {/* Documents Table */}
      <DocumentsTable documents={documents} />
    </div>
  );
}
