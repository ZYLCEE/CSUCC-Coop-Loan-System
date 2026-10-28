export interface LoanType {
  id: string;
  name: string;
  description: string;
  interestRate: string;
  minimum: string;
  maximum: string;
  term: string;
  isActive: boolean;
}

export const loanTypes: LoanType[] = [];
