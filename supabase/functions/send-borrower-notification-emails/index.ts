import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@^9';

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[character] ?? character));

function renderEmail(job: Record<string, any>, application: Record<string, any>, memberAppUrl?: string) {
  let detailsUrl: URL | null = null;
  if (memberAppUrl) {
    const base = new URL(memberAppUrl);
    if (base.protocol !== 'https:') throw new Error('Configure an HTTPS member application URL.');
    detailsUrl = new URL(base);
    detailsUrl.searchParams.set('application', application.application_id);
  }
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
  const detailsText = detailsUrl
    ? `View Details: ${detailsUrl.href}`
    : 'Sign in to the borrower app to review this application update.';
  const detailsHtml = detailsUrl
    ? `<p><a style="display:inline-block;padding:12px 20px;background:#145b3c;color:white;border-radius:6px" href="${escapeHtml(detailsUrl.href)}">View Details</a></p>`
    : '<p>Sign in to the borrower app to review this application update.</p>';
  const text = `Hello ${application.member_name || 'Member'},\n\n${job.message}\n\n${fields.map(([label, value]) => `${label}: ${value}`).join('\n')}\n\nWhat you need to do:\n${action}\n\n${detailsText}\n\nCSUCC ERMPC\nThis is an automated application update.`;
  const html = `<main style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172c24"><h1 style="font-size:22px;color:#145b3c">${escapeHtml(job.subject)}</h1><p>Hello ${escapeHtml(application.member_name || 'Member')},</p><p style="white-space:pre-wrap">${escapeHtml(job.message)}</p><dl>${fields.map(([label, value]) => `<dt style="font-weight:bold;margin-top:12px">${escapeHtml(label)}</dt><dd style="margin-left:0">${escapeHtml(value)}</dd>`).join('')}</dl><h2 style="font-size:16px">What you need to do</h2><p>${escapeHtml(action)}</p>${detailsHtml}<p>CSUCC ERMPC</p><p style="font-size:12px;color:#66736d">This is an automated application update.</p></main>`;
  return { subject, text, html };
}

function renderNotificationEmail(job: Record<string, any>) {
  const title = String(job.subject || 'Portal notification').replace(/[\r\n]+/g, ' ').slice(0, 200);
  const message = String(job.message || 'You have a new notification in CSUCC ERMPC.').slice(0, 2000);
  const subject = `CSUCC ERMPC | ${title}`;
  const text = `Hello,\n\n${message}\n\nSign in to the portal to review this notification.\n\nCSUCC ERMPC\nThis is an automated notification.`;
  const html = `<main style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172c24"><h1 style="font-size:22px;color:#145b3c">${escapeHtml(title)}</h1><p style="white-space:pre-wrap">${escapeHtml(message)}</p><p>Sign in to the portal to review this notification.</p><p>CSUCC ERMPC</p><p style="font-size:12px;color:#66736d">This is an automated notification.</p></main>`;
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

async function deliverJobs({
  supabase,
  transport,
  jobs,
  prepareRpc,
  finishRpc,
  render,
  smtpHost,
  from,
  messageKind,
}: Record<string, any>) {
  let sent = 0;
  let failed = 0;
  for (const job of jobs ?? []) {
    let providerId: string | null = null;
    let failure: string | null = null;
    try {
      const body = render(job);
      const { data: payload, error: prepareError } = await supabase.rpc(prepareRpc, {
        p_id: job.id,
        p_lease: job.lease_id,
        p_payload: { from, to: [job.recipient_email], ...body },
      });
      if (prepareError || !payload) throw new Error('Email payload could not be preserved for safe retries.');

      const notificationId = job.notification_id ?? job.id;
      const result = await transport.sendMail({
        ...payload,
        messageId: `<${messageKind}-${job.id}@${smtpHost}>`,
        headers: { 'X-Coop-Notification-ID': notificationId },
      });
      const accepted = result.accepted.some((recipient: unknown) =>
        String(recipient).toLowerCase() === job.recipient_email.toLowerCase());
      if (!accepted || typeof result.messageId !== 'string') {
        throw new Error('SMTP did not confirm acceptance for the notification email.');
      }
      providerId = result.messageId;
    } catch (error) {
      failure = error instanceof Error ? error.message : 'Email delivery failed.';
    }

    const { data: finished, error: finishError } = await supabase.rpc(finishRpc, {
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
  return { sent, failed };
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const workerToken = Deno.env.get('COOP_EMAIL_WORKER_TOKEN')?.trim();
  const providedToken = request.headers.get('x-coop-email-worker-token')?.trim() ?? '';
  if (!workerToken) {
    console.error('Borrower email worker token secret is missing.');
    return new Response('Unauthorized', { status: 401 });
  }
  if (!providedToken) {
    console.error('Borrower email worker token header is missing.');
    return new Response('Unauthorized', { status: 401 });
  }
  if (!(await constantTimeEqual(workerToken, providedToken))) {
    console.error('Borrower email worker token does not match the configured secret.');
    return new Response('Unauthorized', { status: 401 });
  }

  const smtpHost = Deno.env.get('SMTP_HOST') ?? 'smtp.gmail.com';
  const smtpPort = Number(Deno.env.get('SMTP_PORT') ?? '465');
  const smtpSecure = (Deno.env.get('SMTP_SECURE') ?? 'true').toLowerCase() === 'true';
  const smtpUsername = Deno.env.get('SMTP_USERNAME');
  const smtpPassword = Deno.env.get('SMTP_PASSWORD')?.replace(/\s+/g, '');
  const from = Deno.env.get('SMTP_FROM') ?? smtpUsername;
  const memberAppUrl = Deno.env.get('COOP_MEMBER_APP_URL')?.trim();
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const missingSettings = [
    !smtpUsername && 'SMTP_USERNAME',
    !smtpPassword && 'SMTP_PASSWORD',
    !from && 'SMTP_FROM (or SMTP_USERNAME)',
    !supabaseUrl && 'SUPABASE_URL',
    !serviceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY',
    (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) && 'SMTP_PORT',
  ].filter(Boolean);
  if (missingSettings.length > 0) {
    console.error(`Email configuration missing: ${missingSettings.join(', ')}`);
    return Response.json({ error: 'Email delivery is not configured.' }, { status: 503 });
  }

  try {
    if (memberAppUrl && new URL(memberAppUrl).protocol !== 'https:') {
      throw new Error('Configure an HTTPS member application URL.');
    }
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
    const [borrowerClaim, notificationClaim] = await Promise.all([
      supabase.rpc('portal_claim_email_jobs', { p_limit: 5 }),
      supabase.rpc('portal_claim_notification_email_jobs', { p_limit: 5 }),
    ]);
    const claimErrors = [borrowerClaim.error, notificationClaim.error].filter(Boolean);
    if (claimErrors.length === 2) {
      transport.close();
      throw new Error('Email jobs could not be claimed.');
    }
    if (borrowerClaim.error) console.error('Borrower application email jobs could not be claimed.');
    if (notificationClaim.error) console.error('Portal notification email jobs could not be claimed.');

    let sent = 0;
    let failed = 0;
    try {
      if (!borrowerClaim.error) {
        const result = await deliverJobs({
          supabase, transport, jobs: borrowerClaim.data,
          prepareRpc: 'portal_prepare_email_payload', finishRpc: 'portal_finish_email_job',
          render: (job: Record<string, any>) => {
            if (!job.application_snapshot) throw new Error('The email context snapshot is unavailable.');
            return renderEmail(job, job.application_snapshot, memberAppUrl);
          },
          smtpHost, from, messageKind: 'application-notice',
        });
        sent += result.sent;
        failed += result.failed;
      }
      if (!notificationClaim.error) {
        const result = await deliverJobs({
          supabase, transport, jobs: notificationClaim.data,
          prepareRpc: 'portal_prepare_notification_email_payload',
          finishRpc: 'portal_finish_notification_email_job',
          render: renderNotificationEmail,
          smtpHost, from, messageKind: 'portal-notification',
        });
        sent += result.sent;
        failed += result.failed;
      }
    } finally {
      transport.close();
    }

    if (claimErrors.length > 0) {
      return Response.json({
        claimed: (borrowerClaim.data?.length ?? 0) + (notificationClaim.data?.length ?? 0),
        sent,
        failed,
        error: 'One email queue could not be claimed; it will be retried on the next worker run.',
      }, { status: 503 });
    }
    return Response.json({
      claimed: (borrowerClaim.data?.length ?? 0) + (notificationClaim.data?.length ?? 0),
      sent,
      failed,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Email worker failed.');
    return Response.json({ error: error instanceof Error ? error.message : 'Email worker failed.' }, { status: 500 });
  }
});
