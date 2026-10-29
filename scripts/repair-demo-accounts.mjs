import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

export const seed = 'csucc-fictional-demo-2026-v1';
const credentialPath = resolve('.env.demo-accounts.json');
const uuid = (text) => {
  const hash = createHash('md5').update(text).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`;
};

export function demoNumber(profile) {
  const match = /^csucc\.demo\.(\d{4})@example\.invalid$/.exec(profile.email ?? '');
  const number = Number(match?.[1]);
  if (!match || number < 1 || number > 60 ||
      profile.id !== uuid(`${seed}/member/${number}`) ||
      !profile.first_name?.startsWith('Demo ') || profile.role !== 'member') {
    throw new Error('Refusing to modify a profile outside the original demo dataset.');
  }
  return number;
}

function assertOwnedUser(user, profile) {
  if (user.email?.toLowerCase() !== profile.email.toLowerCase() ||
      user.app_metadata?.role !== 'member' ||
      user.app_metadata?.demo_seed !== seed ||
      user.app_metadata?.member_profile_id !== profile.id) {
    throw new Error(`Auth user for ${profile.member_id} is not owned by this repair. No existing user was changed.`);
  }
}

export async function repairProfile(client, profile, users, credentials, save, apply) {
  const number = demoNumber(profile);
  let user = users.find((candidate) => candidate.email?.toLowerCase() === profile.email.toLowerCase());
  if (profile.user_id) {
    if (!user || user.id !== profile.user_id) throw new Error(`Unexpected Auth link on ${profile.member_id}.`);
    assertOwnedUser(user, profile);
    return 'already linked';
  }
  if (user) assertOwnedUser(user, profile);
  if (!apply) return user ? 'would link existing demo Auth user' : 'would create and link demo Auth user';

  if (!user) {
    // Persist a random credential before calling Auth so interrupted runs can recover.
    // This ignored file is local only; credentials are never printed to the console.
    let credential = credentials.accounts.find((entry) => entry.profileId === profile.id);
    if (!credential) {
      credential = {
        profileId: profile.id,
        authUserId: uuid(`${seed}/auth/${number}`),
        email: profile.email,
        password: `Demo!9aA${randomBytes(24).toString('base64url')}`,
      };
      credentials.accounts.push(credential);
      await save(credentials);
    }
    if (credential.email !== profile.email || credential.authUserId !== uuid(`${seed}/auth/${number}`)) {
      throw new Error('Saved credential does not match the demo profile.');
    }
    const { data, error } = await client.auth.admin.createUser({
      id: credential.authUserId,
      email: profile.email,
      password: credential.password,
      email_confirm: true,
      app_metadata: { role: 'member', account_status: 'active', demo_seed: seed, member_profile_id: profile.id },
      user_metadata: {
        first_name: profile.first_name,
        last_name: profile.last_name,
        full_name: `${profile.first_name} ${profile.last_name}`,
        member_id: profile.member_id,
        membership_type: profile.membership_type,
        department: profile.department,
      },
    });
    if (error || !data.user) throw new Error(`Auth creation failed for ${profile.member_id}: ${error?.message ?? 'No user returned'}`);
    user = data.user;
    assertOwnedUser(user, profile);
    users.push(user);
  }

  // An Auth signup trigger may create another member row. Stop rather than deleting
  // a profile or moving financial records without knowing the live trigger behavior.
  const { data: linked, error: linkedError } = await client.from('members')
    .select('id').eq('user_id', user.id);
  if (linkedError) throw linkedError;
  if (linked.some((row) => row.id !== profile.id)) {
    throw new Error(`Auth created an additional member profile for ${profile.member_id}. Stopped for reconciliation; original profile and loans are intact.`);
  }
  // The live signup trigger can link the original profile itself.
  if (linked.some((row) => row.id === profile.id)) return 'linked';

  const { data: updated, error } = await client.from('members')
    .update({ user_id: user.id })
    .eq('id', profile.id).is('user_id', null)
    .select('id,user_id').maybeSingle();
  if (error) throw error;
  if (!updated || updated.user_id !== user.id) throw new Error(`Profile changed during repair: ${profile.member_id}. Retry after reviewing its link.`);
  return 'linked';
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--apply' && !/^--limit=\d+$/.test(arg))) {
    throw new Error('Usage: node --env-file=.env.local scripts/repair-demo-accounts.mjs [--apply] [--limit=1]');
  }
  const apply = args.includes('--apply');
  const limit = Number(args.find((arg) => arg.startsWith('--limit='))?.split('=')[1] ?? 60);
  if (!Number.isInteger(limit) || limit < 1 || limit > 60) throw new Error('Limit must be between 1 and 60.');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.');
  if (new URL(url).hostname !== 'jhgsqvxlvwhrwpcekvpq.supabase.co') throw new Error('This repair is restricted to the configured CSUCC demo project.');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: profiles, error } = await client.from('members')
    .select('id,user_id,member_id,first_name,last_name,email,role,membership_type,department')
    .like('email', 'csucc.demo.%@example.invalid').order('email').limit(61);
  if (error) throw error;
  if (profiles.length !== 60) throw new Error(`Expected exactly 60 seeded profiles, found ${profiles.length}. Stopped without changes.`);
  profiles.forEach(demoNumber);

  const users = [];
  for (let page = 1; ; page++) {
    const { data, error: authError } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (authError) throw authError;
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }
  // Preflight every selected profile before any mutation.
  for (const profile of profiles) {
    const user = users.find((entry) => entry.email?.toLowerCase() === profile.email.toLowerCase());
    if (user) assertOwnedUser(user, profile);
    if (profile.user_id && (!user || profile.user_id !== user.id)) throw new Error('Unexpected linked account; stopped before modifying data.');
  }
  let credentials = { project: url, seed, accounts: [] };
  try {
    credentials = JSON.parse(await readFile(credentialPath, 'utf8'));
    if (credentials.project !== url || credentials.seed !== seed || !Array.isArray(credentials.accounts)) throw new Error('Saved credential file belongs to another dataset.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const save = async (data) => writeFile(credentialPath, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  let processed = 0;
  for (const profile of profiles) {
    const result = await repairProfile(client, profile, users, credentials, save, apply);
    console.log(`${profile.member_id}: ${result}`);
    if (result !== 'already linked') processed++;
    if (processed >= limit) break;
  }
  console.log(apply ? 'Repair completed for the selected batch. Refresh the Members page as Super Admin.' : 'Preview only. No accounts or database records were modified.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
