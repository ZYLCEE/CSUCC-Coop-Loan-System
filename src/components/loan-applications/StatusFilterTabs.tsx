export const loanStatusTabs = [
  "All",
  "Pending",
  "Under Review",
  "Approved",
  "Rejected",
  "Released",
  "Completed",
  "Overdue",
] as const;

interface StatusFilterTabsProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export default function StatusFilterTabs({ activeTab, onTabChange }: StatusFilterTabsProps) {
  return (
    <div className="border-b border-[#E5E7EB] px-5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {loanStatusTabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => onTabChange(tab)}
            className={`h-9 rounded-full px-4 text-[14px] font-semibold transition-colors ${
              activeTab === tab
                ? "bg-[#155D3B] text-white"
                : "text-[#475569] hover:bg-[#F1F5F9]"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>
    </div>
  );
}
