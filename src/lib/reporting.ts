export function reportWindow(date: string, period: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date).toISOString().slice(0,10) !== date) throw new Error('Select a valid report date.');
  const start = new Date(`${date}T00:00:00Z`);
  if (period === 'Yearly') start.setUTCMonth(0,1);
  else if (period === 'Monthly') start.setUTCDate(1);
  else if (period === 'Weekly') start.setUTCDate(start.getUTCDate() - (start.getUTCDay()+6)%7);
  else if (period !== 'Daily') throw new Error('Unsupported reporting period.');
  const end = new Date(start);
  if (period === 'Yearly') end.setUTCFullYear(end.getUTCFullYear()+1);
  else if (period === 'Monthly') end.setUTCMonth(end.getUTCMonth()+1);
  else end.setUTCDate(end.getUTCDate() + (period === 'Weekly' ? 7 : 1));
  return { start: start.toISOString().slice(0,10), end: end.toISOString().slice(0,10) };
}
