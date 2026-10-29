import { createClient } from '@supabase/supabase-js';

const tables: Record<string, string> = { active: 'loan_applications', loans: 'loan_applications', members: 'members', payments: 'loan_payments', audit: 'admin_activity_logs' };
const configNames = new Set(['general']);
const bucket = 'coop-admin-resources';

export async function GET(request: Request) { return handle(request); }
export async function POST(request: Request) { return handle(request); }
export async function DELETE(request: Request) { return handle(request); }

async function handle(request: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return Response.json({ error: 'Server-side Supabase configuration is missing.' }, { status: 503 });
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const bearer = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
    if (!bearer) return Response.json({ error: 'Sign in to continue.' }, { status: 401 });
    const { data: { user }, error } = await client.auth.getUser(bearer);
    if (error || !user) return Response.json({ error: 'Session expired.' }, { status: 401 });
    const role = user.app_metadata.role;
    if (!['admin', 'coop_admin', 'super_admin'].includes(role) || (user.app_metadata.account_status && user.app_metadata.account_status !== 'active')) return Response.json({ error: 'Access denied.' }, { status: 403 });
    const write = request.method !== 'GET';
    if (write && role !== 'super_admin') return Response.json({ error: 'Super Admin access required.' }, { status: 403 });
    const resource = new URL(request.url).searchParams.get('resource') ?? '';
    if (tables[resource] && !write) {
      const rows: Record<string, unknown>[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await client.from(tables[resource]).select('*').order('created_at', { ascending: false }).order('id').range(offset, offset + 499);
        if (error) throw error;
        rows.push(...data);
        if (data.length < 500) break;
      }
      return Response.json(resource === 'active' ? rows.filter(row => ['approved','released','overdue'].includes(String(row.status))) : rows, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (!configNames.has(resource) && resource !== 'documents') return Response.json({ error: 'Unknown resource or unsupported operation.' }, { status: 400 });
    if (resource === 'documents' && !write) {
      const documents = [];
      // Loan attachments live in their own table/bucket, independently of portal uploads.
      for (let offset = 0; ; offset += 100) {
        const { data, error } = await client.from('loan_documents')
          .select('id,kind,original_name,storage_path,size_bytes,created_at,loan_applications(application_id)')
          .order('created_at', { ascending: false }).order('id').range(offset, offset + 99);
        if (error) throw error;
        if (!data.length) break;
        documents.push(...await Promise.all(data.map(async file => {
          const { data: link, error } = await client.storage.from('loan-documents').createSignedUrl(file.storage_path, 300);
          const application = Array.isArray(file.loan_applications) ? file.loan_applications[0] : file.loan_applications;
          return { id: `loan:${file.id}`, name: file.original_name, size: file.size_bytes, createdAt: file.created_at,
            source: 'loan', kind: file.kind, applicationId: application?.application_id ?? null,
            url: error ? null : link?.signedUrl ?? null, linkError: error ? 'File unavailable. Refresh to retry.' : null };
        })));
      }
      const { data: existing, error: bucketError } = await client.storage.getBucket(bucket);
      if (bucketError && !/not found/i.test(bucketError.message)) throw bucketError;
      if (existing) {
        for (let offset = 0; ; offset += 100) {
          const { data, error } = await client.storage.from(bucket).list('documents', { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } });
          if (error) throw error;
          documents.push(...await Promise.all(data.filter(file => file.id).map(async file => {
            const path = `documents/${file.name}`;
            const { data: link, error } = await client.storage.from(bucket).createSignedUrl(path, 300);
            return { id: path, name: file.name.replace(/^[0-9a-f-]{36}-/, ''), size: file.metadata?.size ?? null,
              createdAt: file.created_at, source: 'cooperative', kind: null, applicationId: null,
              url: error ? null : link?.signedUrl ?? null, linkError: error ? 'File unavailable. Refresh to retry.' : null };
          })));
          if (data.length < 100) break;
        }
      }
      documents.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || a.id.localeCompare(b.id));
      return Response.json(documents, { headers: { 'Cache-Control': 'no-store' } });
    }
    const { data: existing, error: bucketError } = await client.storage.getBucket(bucket);
    if (!existing) {
      if (!write) return Response.json(resource !== 'general' ? [] : {});
      if (bucketError && !/not found/i.test(bucketError.message)) throw bucketError;
      const { error } = await client.storage.createBucket(bucket, { public: false, fileSizeLimit: 10 * 1024 * 1024 });
      if (error && !/already exists/i.test(error.message)) throw error;
    }
    if (resource === 'documents') {
      if (request.method === 'POST') {
        const form = await request.formData();
        const file = form.get('file');
        if (!(file instanceof File) || !file.size || file.size > 10 * 1024 * 1024) throw new Error('Select a file of up to 10 MB.');
        if (!/\.(pdf|docx|png|jpe?g)$/i.test(file.name)) throw new Error('Supported files: PDF, DOCX, PNG, JPG.');
        const settingsFile = await client.storage.from(bucket).download('configuration/general.json');
        if (settingsFile.data) {
          const settings = JSON.parse(await settingsFile.data.text());
          if (file.size > Number(settings.maxUploadSize ?? 10) * 1024 * 1024) throw new Error('This file exceeds the configured document size limit.');
          const extensions = String(settings.allowedFileTypes ?? 'PDF,DOCX,PNG,JPG').toLowerCase().split(',').map(value => value.trim().replace(/^\./,''));
          if (!extensions.includes(file.name.split('.').pop()?.toLowerCase() ?? '')) throw new Error('This file type is disabled in portal settings.');
        } else if (settingsFile.error && !/not found|does not exist/i.test(settingsFile.error.message)) throw settingsFile.error;
        const path = `documents/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
        const { error } = await client.storage.from(bucket).upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
        if (error) throw error;
        return Response.json({ success: true });
      }
      const { id } = await request.json();
      if (typeof id !== 'string' || !/^documents\/[a-zA-Z0-9_.-]+$/.test(id)) throw new Error('Invalid document.');
      const { error } = await client.storage.from(bucket).remove([id]);
      if (error) throw error;
      return Response.json({ success: true });
    }
    const path = `configuration/${resource}.json`;
    if (!write) {
      const { data, error } = await client.storage.from(bucket).download(path);
      if (error) {
        if (String(error.message).match(/not found|does not exist/i)) return Response.json(resource !== 'general' ? [] : {});
        throw error;
      }
      return Response.json(JSON.parse(await data.text()));
    }
    if (request.method !== 'POST') return Response.json({ error: 'Unsupported operation.' }, { status: 405 });
    const body = await request.text();
    if (body.length > 100_000) throw new Error('Configuration is too large.');
    const value = JSON.parse(body);
    if (!value || typeof value !== 'object') throw new Error('Invalid configuration.');
    if (resource !== 'general' && (!Array.isArray(value) || value.length > 500 || value.some(item => !item || typeof item.id !== 'string' || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 160 || typeof item.description !== 'string' || item.description.length > 20000 || typeof item.isActive !== 'boolean'))) throw new Error('Invalid catalog entries.');
    if (resource === 'general') {
      if (typeof value.cooperativeName !== 'string' || !value.cooperativeName.trim() || value.cooperativeName.length > 100 || !Number.isInteger(value.maxUploadSize) || value.maxUploadSize < 1 || value.maxUploadSize > 10 || typeof value.allowedFileTypes !== 'string') throw new Error('Invalid portal settings.');
      const extensions = value.allowedFileTypes.toLowerCase().split(',').map((extension: string) => extension.trim());
      if (!extensions.length || extensions.some((extension: string) => !['pdf','docx','png','jpg','jpeg'].includes(extension))) throw new Error('Select PDF, DOCX, PNG, JPG or JPEG extensions separated by commas.');
    }
    const { error: saveError } = await client.storage.from(bucket).upload(path, new Blob([JSON.stringify(value)]), { upsert: true, contentType: 'application/json' });
    if (saveError) throw saveError;
    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Request failed.' }, { status: 400 });
  }
}
