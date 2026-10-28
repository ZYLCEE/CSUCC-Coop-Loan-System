"use client";

interface FileTypeBadgeProps {
  type: "PDF" | "DOCX" | "PNG" | "XLSX";
}

export default function FileTypeBadge({ type }: FileTypeBadgeProps) {
  const styles = {
    PDF: "bg-red-50 text-red-700 border-red-200",
    DOCX: "bg-blue-50 text-blue-700 border-blue-200",
    PNG: "bg-green-50 text-green-700 border-green-200",
    XLSX: "bg-orange-50 text-orange-700 border-orange-200",
  };

  return (
    <span className={`inline-flex items-center h-[20px] px-[8px] py-0 rounded-full text-[12px] font-medium border ${styles[type]}`}>
      {type}
    </span>
  );
}
