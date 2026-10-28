export interface ActiveLoan {
  loanNumber: string;
  memberName: string;
  memberId: string;
  type: string;
  originalAmount: string;
  balance: string;
  monthlyDue: string;
  nextDue: string;
  status: "Current" | "Due Soon" | "Overdue";
  createdAt: string;
}

export const activeLoans: ActiveLoan[] = [];
