import { Badge } from "@/components/ui/StatusBadge";
import { reviewLabels, type SubmissionReviewStatus } from "@/lib/documentWorkspace";

export default function DocumentStatusBadge({ status }: {status: SubmissionReviewStatus | "published" | "draft" | "staff_only" | "missing"}) {
  const tone = ["verified","published"].includes(status) ? "success" : status === "needs_replacement" ? "danger"
    : ["awaiting_files","missing"].includes(status) ? "warning" : status === "to_review" ? "info" : "neutral";
  const label = status === "published" ? "Published" : status === "draft" ? "Draft" : status === "staff_only" ? "Staff only"
    : status === "missing" ? "Missing" : reviewLabels[status];
  return <Badge tone={tone} className="max-w-full whitespace-normal">{label}</Badge>;
}
