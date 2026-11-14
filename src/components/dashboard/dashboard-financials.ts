import { getSupabaseClient } from "@/lib/supabase";

const pageSize = 500;
const releasedStatuses = ["released", "overdue", "completed"] as const;

function cents(value: unknown, label: string): number {
  const validNumber = typeof value === "number" && Number.isFinite(value) && value >= 0;
  const validString = typeof value === "string" && /^\d+(\.\d{1,2})?$/.test(value);
  if (!validNumber && !validString) throw new Error(`${label} has an invalid amount.`);
  const amount = Number(value);
  const result = Math.round(amount * 100);
  if (!Number.isSafeInteger(result)) throw new Error(`${label} is outside the supported reporting range.`);
  return result;
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export async function fetchDashboardCollections(start: string, end: string): Promise<number> {
  const client = getSupabaseClient();
  const payments = new Set<string>();
  let expectedCount: number | null = null;
  let offset = 0;
  let totalCents = 0;

  do {
    const { data, error, count } = await client.from("loan_payments")
      .select("id,payment_amount", { count: "exact" })
      .eq("payment_status", "posted")
      .gte("payment_date", start)
      .lt("payment_date", end)
      .order("payment_date", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error("Confirmed collections could not be loaded. Check your connection and retry.");
    if (!Array.isArray(data) || count === null) throw new Error("The collections service returned an incomplete report. Please retry.");
    if (expectedCount !== null && count !== expectedCount) throw new Error("Payments changed while loading. Please retry for an updated total.");
    expectedCount = count;

    for (const value of data as unknown[]) {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The collections service returned an invalid record.");
      const row = value as Record<string, unknown>;
      if (typeof row.id !== "string" || !row.id || payments.has(row.id)) throw new Error("Payments changed while loading. Please retry for an updated total.");
      payments.add(row.id);
      totalCents += cents(row.payment_amount, "A posted payment");
      if (!Number.isSafeInteger(totalCents)) throw new Error("The collections total is outside the supported reporting range.");
    }

    offset += data.length;
    if (data.length === 0 && offset < expectedCount) throw new Error("Some posted payments could not be loaded. Please retry.");
  } while (offset < (expectedCount ?? 0));

  return totalCents / 100;
}

export async function fetchDashboardDisbursement(start: string, end: string): Promise<number | null> {
  const client = getSupabaseClient();
  const releases = new Set<string>();
  let expectedCount: number | null = null;
  let offset = 0;
  let totalCents = 0;
  let incompleteReleaseHistory = false;

  do {
    const { data, error, count } = await client.from("loan_applications")
      .select("application_id,status,amount,date_released,processing_fee_amount_at_release,service_fee_amount_at_release", { count: "exact" })
      .in("status", [...releasedStatuses])
      .order("application_id", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error("Verified release totals could not be loaded. Check your connection and retry.");
    if (!Array.isArray(data) || count === null) throw new Error("The release service returned an incomplete report. Please retry.");
    if (expectedCount !== null && count !== expectedCount) throw new Error("Release records changed while loading. Please retry for an updated total.");
    expectedCount = count;

    for (const value of data as unknown[]) {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The release service returned an invalid record.");
      const row = value as Record<string, unknown>;
      if (typeof row.application_id !== "string" || !row.application_id || releases.has(row.application_id)) {
        throw new Error("Release records changed while loading. Please retry for an updated total.");
      }
      releases.add(row.application_id);

      if (row.date_released === null) {
        incompleteReleaseHistory = true;
        continue;
      }
      if (!validDate(row.date_released)) throw new Error("A release record has an invalid date. Reporting is unavailable.");
      if (row.date_released < start || row.date_released >= end) continue;

      if (row.processing_fee_amount_at_release === null || row.service_fee_amount_at_release === null) {
        incompleteReleaseHistory = true;
        continue;
      }
      const netCents = cents(row.amount, "A released loan") -
        cents(row.processing_fee_amount_at_release, "A processing fee") -
        cents(row.service_fee_amount_at_release, "A service fee");
      if (netCents < 0) throw new Error("A release fee exceeds its recorded principal. Reporting is unavailable.");
      totalCents += netCents;
      if (!Number.isSafeInteger(totalCents)) throw new Error("The net disbursement total is outside the supported reporting range.");
    }

    offset += data.length;
    if (data.length === 0 && offset < expectedCount) throw new Error("Some release records could not be loaded. Please retry.");
  } while (offset < (expectedCount ?? 0));

  return incompleteReleaseHistory ? null : totalCents / 100;
}
