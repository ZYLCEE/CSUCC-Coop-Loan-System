"use client";

import { UploadCloud } from "lucide-react";

export default function UploadArea() {
  return (
    <div className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] border border-[#D1D5DB] border-dashed p-4">
      <div className="flex flex-col items-center justify-center text-center">
        {/* Upload Icon */}
        <UploadCloud className="w-8 h-8 text-[#9CA3AF] mb-2" strokeWidth={1.5} />

        {/* Main Text */}
        <p className="text-[14px] font-semibold text-[#1F2937] mb-1">Drop files here or click to upload</p>

        {/* Subtitle */}
        <p className="text-[12px] text-[#6B7280] mb-2">PDF, DOCX, PNG — Max 10 MB</p>

        {/* Browse Files Button */}
        <button className="px-5 h-[32px] bg-[#166534] rounded-[9999px] text-[12px] font-semibold text-white hover:bg-[#145232] transition-colors">
          Browse Files
        </button>
      </div>
    </div>
  );
}
