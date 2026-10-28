export interface Document {
  id: string;
  name: string;
  category: string;
  type: "PDF" | "DOCX" | "PNG" | "XLSX";
  size: string;
  uploaded: string;
}

export const documents: Document[] = [];
