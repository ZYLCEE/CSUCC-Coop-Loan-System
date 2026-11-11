import 'dart:math';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../models/loan_document.dart';

typedef DocumentRow = Map<String, dynamic>;

class DocumentCenterService {
  DocumentCenterService({SupabaseClient? client})
    : client = client ?? Supabase.instance.client;
  final SupabaseClient client;

  Future<List<DocumentRow>> _rows(
    String table,
    String columns, {
    String? owner,
  }) async {
    final rows = <DocumentRow>[];
    for (var offset = 0; ; offset += 500) {
      var query = client.from(table).select(columns);
      if (owner != null) query = query.eq('user_id', owner);
      final data = await query.order('id').range(offset, offset + 499);
      rows.addAll(data);
      if (data.length < 500) break;
    }
    return rows;
  }

  Future<
    ({
      List<DocumentRow> submissions,
      List<DocumentRow> shared,
      List<DocumentRow> corrections,
    })
  >
  load() async {
    final user = client.auth.currentUser;
    if (user == null) throw StateError('Sign in to view your documents.');
    // Supabase row and storage policies also enforce member ownership and audience.
    final results = await Future.wait([
      _rows(
        'loan_documents',
        'id,kind,storage_path,original_name,content_type,size_bytes,created_at,loan_applications(application_id,loan_type,status)',
        owner: user.id,
      ),
      _rows('loan_document_versions', '*'),
      _rows('loan_document_reviews', '*'),
      _rows(
        'shared_documents',
        'id,title,category,description,audience,storage_path,original_name,content_type,size_bytes,published_at,uploaded_by_name',
      ),
    ]);
    final corrections = List<DocumentRow>.from(
      await client.rpc('member_application_corrections') as List,
    );
    final roots = results[0];
    for (final root in roots) {
      final versions =
          results[1].where((row) => row['document_id'] == root['id']).toList()
            ..sort(
              (a, b) => (b['version'] as num).compareTo(a['version'] as num),
            );
      final reviews =
          results[2].where((row) => row['document_id'] == root['id']).toList()
            ..sort(
              (a, b) => (b['created_at'] as String).compareTo(
                a['created_at'] as String,
              ),
            );
      root['versions'] = versions;
      root['reviews'] = reviews;
      root['latest'] = versions.isEmpty ? root : versions.first;
      final versionId = versions.isEmpty ? null : versions.first['id'];
      root['latest_version_id'] = versionId;
      root['review'] = reviews
          .where((row) => row['version_id'] == versionId)
          .firstOrNull;
    }
    roots.sort(
      (a, b) =>
          (b['created_at'] as String).compareTo(a['created_at'] as String),
    );
    final shared = results[3]
      ..sort(
        (a, b) => (b['published_at'] as String).compareTo(
          a['published_at'] as String,
        ),
      );
    return (submissions: roots, shared: shared, corrections: corrections);
  }

  Future<String> fileLink(String bucket, String path) =>
      client.storage.from(bucket).createSignedUrl(path, 300);

  Future<void> replace(DocumentRow root, SelectedLoanDocument file) async {
    final owner = client.auth.currentUser?.id;
    if (owner == null) throw StateError('Sign in before replacing a document.');
    final token = List.generate(
      16,
      (_) => Random.secure().nextInt(256).toRadixString(16).padLeft(2, '0'),
    ).join();
    final path = '$owner/replacements/${root['id']}/$token.${file.extension}';
    await client.storage
        .from('loan-documents')
        .uploadBinary(
          path,
          file.bytes,
          fileOptions: FileOptions(
            contentType: file.contentType,
            upsert: false,
          ),
        );
    try {
      await client.rpc(
        'submit_document_replacement',
        params: {
          'p_document_id': root['id'],
          'p_expected_version_id': root['latest_version_id'],
          'p_storage_path': path,
          'p_name': file.name,
          'p_content_type': file.contentType,
          'p_size_bytes': file.bytes.length,
        },
      );
    } catch (_) {
      // A lost response may follow a successful commit. Never remove a saved version.
      try {
        final saved = await client
            .from('loan_document_versions')
            .select('id')
            .eq('document_id', root['id'])
            .eq('storage_path', path)
            .maybeSingle();
        if (saved != null) return;
        await client.storage.from('loan-documents').remove([path]);
      } catch (_) {
        /* Submitted-file storage policies protect committed versions. */
      }
      rethrow;
    }
  }
}
