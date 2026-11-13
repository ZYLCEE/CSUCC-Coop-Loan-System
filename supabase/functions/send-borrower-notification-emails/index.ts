import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@^9';

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[character] ?? character));

function renderEmail(job: Record<string, any>, application: Record<string, any>, memberAppUrl: string) {
  const base = new URL(memberAppUrl);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname))) {
    throw new Error('Configure an HTTPS member application URL.');
  }

  const link = new URL(base);
  link.searchParams.set('application', application.application_id);
  const subject = `CSUCC ERMPC | ${job.subject} | ${application.application_id}`;
  const updated = new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  }).format(new Date(job.created_at));
  const action = /replacement|correction|returned/i.test(job.subject)
    ? 'Open the app to review the required changes and update your application.'
    : 'No action is required at this time. Open the app for the current details and any available next steps.';
  const stageTitle = String(job.subject).toLowerCase();
  const milestone = stageTitle === 'requirements verified' ? 'CRECOM Review'
    : stageTitle === 'crecom review complete' ? 'Awaiting BOD Review'
    : stageTitle === 'bod review complete' ? 'Awaiting Final Decision'
    : stageTitle.includes('crecom review') ? 'CRECOM Review'
    : stageTitle.includes('bod review') ? 'BOD Review'
    : null;
  const status = milestone ?? ({
    pending: 'Awaiting review',
    'under review': 'Application review',
    returned: 'Returned for correction',
    approved: 'Approved — Awaiting Release',
    rejected: 'Rejected',
    released: 'Released',
    overdue: 'Repayment',
    completed: 'Completed',
  } as Record<string, string>)[application.status] ?? application.status;
  const fields: [string, unknown][] = [
    ['Application Number', application.application_id],
    ['Loan Type', application.loan_type],
    ['Current Stage', status],
    ['Updated', updated],
  ];
  const text = `Hello ${application.member_name || 'Member'},\n\n${job.message}\n\n${fields.map(([label, value]) => `${label}: ${value}`).join('\n')}\n\nWhat you need to do:\n${action}\n\nView Details: ${link.href}\n\nCSUCC ERMPC\nThis is an automated application update.`;
  const html = `<main style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172c24"><h1 style="font-size:22px;color:#145b3c">${escapeHtml(job.subject)}</h1><p>Hello ${escapeHtml(application.member_name || 'Member')},</p><p style="white-space:pre-wrap">${escapeHtml(job.message)}</p><dl>${fields.map(([label, value]) => `<dt style="font-weight:bold;margin-top:12px">${escapeHtml(label)}</dt><dd style="margin-left:0">${escapeHtml(value)}</dd>`).join('')}</dl><h2 style="font-size:16px">What you need to do</h2><p>${escapeHtml(action)}</p><p><a style="display:inline-block;padding:12px 20px;background:#145b3c;color:white;border-radius:6px" href="${escapeHtml(link.href)}">View Details</a></p><p>CSUCC ERMPC</p><p style="font-size:12px;color:#66736d">This is an automated application update.</p></main>`;
  return { subject, text, html };
}

async function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ]);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const workerToken = Deno.env.get('COOP_EMAIL_WORKER_TOKEN');
  const authorization = request.headers.get('authorization') ?? '';
  const providedToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!workerToken || !providedToken || !(await constantTimeEqual(workerToken, providedToken))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const smtpHost = Deno.env.get('SMTP_HOST') ?? 'smtp.gmail.com';
  const smtpPort = Number(Deno.env.get('SMTP_PORT') ?? '465');
  const smtpSecure = (Deno.env.get('SMTP_SECURE') ?? 'true').toLowerCase() === 'true';
  const smtpUsername = Deno.env.get('SMTP_USERNAME');
  const smtpPassword = Deno.env.get('SMTP_PASSWORD')?.replace(/\s+/g, '');
  const from = Deno.env.get('SMTP_FROM') ?? smtpUsername;
  const memberAppUrl = Deno.env.get('COOP_MEMBER_APP_URL');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!smtpUsername || !smtpPassword || !from || !memberAppUrl || !supabaseUrl || !serviceRoleKey ||
      !Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
    return Response.json({ error: 'Email delivery is not configured.' }, { status: 503 });
  }

  try {
    const configuredUrl = new URL(memberAppUrl);
    if (configuredUrl.protocol !== 'https:') throw new Error('Configure an HTTPS member application URL.');
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const transport = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: { user: smtpUsername, pass: smtpPassword },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    const { data: jobs, error: claimError } = await supabase.rpc('portal_claim_email_jobs', { p_limit: 20 });
    if (claimError) {
      transport.close();
      throw new Error('Email jobs could not be claimed.');
    }

    let sent = 0;
    let failed = 0;
    try {
      for (const job of jobs ?? []) {
        let providerId: string | null = null;
        let failure: string | null = null;
        try {
          if (!job.application_snapshot) throw new Error('The email context snapshot is unavailable.');
          const body = renderEmail(job, job.application_snapshot, memberAppUrl);
          const { data: payload, error: prepareError } = await supabase.rpc('portal_prepare_email_payload', {
            p_id: job.id,
            p_lease: job.lease_id,
            p_payload: { from, to: [job.recipient_email], ...body },
          });
          if (prepareError || !payload) throw new Error('Email payload could not be preserved for safe retries.');

          const result = await transport.sendMail({
            ...payload,
            messageId: `<application-notice-${job.id}@${smtpHost}>`,
            headers: { 'X-Coop-Notification-ID': job.id },
          });
          const accepted = result.accepted.some((recipient: unknown) =>
            String(recipient).toLowerCase() === job.recipient_email.toLowerCase());
          if (!accepted || typeof result.messageId !== 'string') {
            throw new Error('SMTP did not confirm acceptance for the borrower email.');
          }
          providerId = result.messageId;
        } catch (error) {
          failure = error instanceof Error ? error.message : 'Email delivery failed.';
        }

        const { data: finished, error: finishError } = await supabase.rpc('portal_finish_email_job', {
          p_id: job.id,
          p_lease: job.lease_id,
          p_success: Boolean(providerId),
          p_provider_id: providerId,
          p_error: failure,
        });
        if (finishError || finished !== true) {
          throw new Error('Email outcome could not be recorded. The existing lease must be reconciled before retrying.');
        }
        if (providerId) sent += 1;
        else failed += 1;
      }
    } finally {
      transport.close();
    }

    return Response.json({ claimed: jobs?.length ?? 0, sent, failed });
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Email worker failed.');
    return Response.json({ error: error instanceof Error ? error.message : 'Email worker failed.' }, { status: 500 });
  }
});
