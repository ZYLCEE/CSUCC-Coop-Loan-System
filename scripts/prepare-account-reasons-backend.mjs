import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

// Local preparation only. This script never contacts or deploys to Supabase.
export const reasonPatches = [
  [
    '  if (action === "reset-account-password") {\n    const secretFields',
    `  // Persist the verified request before changing Auth/profile data. This is
  // an authorization audit, not a claim that the requested operation succeeded.
  const accountReason = action === "block-account" || action === "delete-account"
    ? requireString(payload.reason, "Enter an account action reason of 1 to 2000 characters.", 2000)
    : null;
  const accountRequestId = accountReason ? crypto.randomUUID() : null;
  if (accountReason) {
    await insertAudit(admin, actorId, \`authorize:\${action}\`, target, "success", {
      phase: "authorized_request", requested_action: action, reason: accountReason,
      request_id: accountRequestId, operation_completed: false,
    });
  }

  if (action === "reset-account-password") {\n    const secretFields`,
  ],
  [
    '    await insertAudit(admin, actorId, action, target, "success", { status });',
    `    await insertAudit(admin, actorId, action, target, "success", {
      status, ...(accountReason ? { reason: accountReason, request_id: accountRequestId, phase: "completed", operation_completed: true } : {}),
    });`,
  ],
  [
    '    await insertAudit(admin, actorId, action, target, "success");\n    return { member_id: target };',
    `    await insertAudit(admin, actorId, action, target, "success", {
      reason: accountReason, request_id: accountRequestId, phase: "completed", operation_completed: true,
    });\n    return { member_id: target };`,
  ],
  [
    '  if (body.mode === "preview-account-id") {',
    `  if (body.mode === "account-action-reason-capability") {
    if (Object.keys(body).length !== 1) return send({ error: "Invalid capability request." }, 400);
    const { error } = await admin.from("admin_activity_logs")
      .select("actor_id,action_name,target_id,result,details").limit(1);
    return error ? send({ error: "Audited account actions are unavailable." }, 503) : send({
      version: 1, reason_max_length: 2000, actions: ["block-account", "delete-account"],
      audit_mode: "authorized-request-and-result",
    });
  }

  if (body.mode === "preview-account-id") {`,
  ],
  [
    '  let actionSecret: JsonObject | null;',
    `  if ((action === "block-account" || action === "delete-account") && (
    typeof payload.reason !== "string" || !payload.reason.trim() || payload.reason.trim().length > 2000
  )) return send({ error: "Enter an account action reason of 1 to 2000 characters." }, 400);

  let actionSecret: JsonObject | null;`,
  ],
];

export function applyReasonPatches(source) {
  for (const [before, after] of reasonPatches) {
    if (source.includes(after)) continue;
    if (source.split(before).length !== 2) throw new Error("Canonical account-action patch baseline changed; refusing replacement.");
    source = source.replace(before, after);
  }
  return source;
}

export function prepareAccountReasonBundle({ writeCanonical = false } = {}) {
  const canonical = resolve("../coop_backend/supabase/edge-functions/secure-admin-action/index.ts");
  const original = readFileSync(canonical, "utf8").replaceAll("\r\n", "\n");
  const updated = applyReasonPatches(original);
  const base = readFileSync("docs/loan-rejection-deploy/deployed-source-v9/supabase/edge-functions/secure-admin-action/index.ts.txt", "utf8").replaceAll("\r\n", "\n");
  const localCreate = '    const role = payload.role === "Member" || payload.role === "Admin" || payload.role === "Super Admin"\n      ? getRoleMetadata(payload.role)\n      : null;';
  const hostedCreate = '    const role =\n      payload.role === "Member"\n        ? { role: "member", label: "Member" }\n        : payload.role === "Admin"\n          ? { role: "coop_admin", label: "Administrator" }\n          : null;';
  if (updated.split(localCreate).length !== 2) throw new Error("Unreviewed local account-creation baseline; refusing bundle.");
  const staged = updated.replace(localCreate, hostedCreate);
  if (staged !== applyReasonPatches(base)) throw new Error("Unrelated canonical changes detected; deployment bundle refused.");
  const directory = resolve("node_modules/.cache/coop-account-reasons-deploy");
  const write = (path, value) => { mkdirSync(dirname(path), { recursive:true }); writeFileSync(path, value); };
  write(resolve(directory, "supabase/edge-functions/secure-admin-action/index.ts"), staged);
  write(resolve(directory, "supabase/functions/secure-admin-action/index.ts"), readFileSync("../coop_backend/supabase/functions/secure-admin-action/index.ts", "utf8"));
  write(resolve(directory, "supabase/config.toml"), 'project_id = "jhgsqvxlvwhrwpcekvpq"\n[functions.secure-admin-action]\nverify_jwt = true\n');
  write(resolve("docs/member-account-flow/secure-admin-action-proposed.ts.txt"), staged);
  const sha = value => createHash("sha256").update(value).digest("hex");
  const manifest = { project:"jhgsqvxlvwhrwpcekvpq", function:"secure-admin-action", baselineVersion:9, verifyJwt:true,
    baselineNormalizedSha256:sha(base), proposedSha256:sha(staged), sqlMigrations:[],
    canonicalDerived:true, unrelatedSuperAdminCreationExcluded:true, hostedChanges:false };
  write(resolve("docs/member-account-flow/deployment-manifest.json"), JSON.stringify(manifest, null, 2));
  if (writeCanonical && updated !== original) writeFileSync(canonical, updated);
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(prepareAccountReasonBundle({ writeCanonical:process.argv.includes("--write-canonical") })));
}
