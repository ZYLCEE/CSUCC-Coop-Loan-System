export function getLoanTypeLabel(loanType: string): string {
  const label = loanType.trim();
  if (!label) return "Not recorded";
  if (label === "Not recorded" || /\bloans?$/i.test(label)) return label;
  return `${label} Loan`;
}
