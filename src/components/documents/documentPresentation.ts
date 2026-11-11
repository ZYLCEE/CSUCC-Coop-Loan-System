export function documentDate(value: string | null, time = false) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not recorded";
  return new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric",
    ...(time ? {hour:"numeric",minute:"2-digit"} as const : {}) }).format(new Date(value)) + (time ? " PHT" : "");
}
export function documentSize(size: number | null) {
  return size === null || !Number.isFinite(size) ? "Not recorded" : size >= 1048576 ? (size / 1048576).toFixed(1) + " MB" : (size / 1024).toFixed(1) + " KB";
}
export function documentTime(value: string) {
  return Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("en-PH",{timeZone:"Asia/Manila",hour:"numeric",minute:"2-digit"}).format(new Date(value))+" PHT" : "Not recorded";
}
