import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:coop_frontend/services/document_center_service.dart';

void main() {
  test(
    'member loader uses owner scope, keeps versions and resets review on replacement',
    () async {
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      const owner = '10000000-0000-0000-0000-000000000003';
      final requests = <Uri>[];
      String segment(Map<String, dynamic> value) =>
          base64Url.encode(utf8.encode(jsonEncode(value))).replaceAll('=', '');
      final token =
          '${segment({'alg': 'HS256', 'typ': 'JWT'})}.${segment({'sub': owner, 'role': 'authenticated', 'exp': DateTime.now().millisecondsSinceEpoch ~/ 1000 + 3600})}.synthetic';
      server.listen((request) async {
        requests.add(request.uri);
        await request.drain<void>();
        request.response.headers.contentType = ContentType.json;
        Object data = [];
        if (request.uri.path.endsWith('/token')) {
          data = {
            'access_token': token,
            'refresh_token': 'synthetic-refresh',
            'token_type': 'bearer',
            'expires_in': 3600,
            'user': {
              'id': owner,
              'aud': 'authenticated',
              'email': 'synthetic@example.invalid',
              'app_metadata': {'role': 'member'},
              'user_metadata': {},
              'created_at': '2026-11-01T00:00:00Z',
            },
          };
        } else if (request.uri.path.endsWith('/loan_documents')) {
          data = [
            {
              'id': 'document-one',
              'user_id': owner,
              'kind': 'validId',
              'created_at': '2026-11-01T00:00:00Z',
              'original_name': 'original.pdf',
              'loan_applications': {
                'application_id': 'APP-TEST',
                'loan_type': 'Business',
                'status': 'pending',
              },
            },
          ];
        } else if (request.uri.path.endsWith('/loan_document_versions')) {
          data = [
            {
              'id': 'version-two',
              'document_id': 'document-one',
              'version': 2,
              'original_name': 'replacement.pdf',
              'created_at': '2026-11-03T00:00:00Z',
            },
          ];
        } else if (request.uri.path.endsWith('/loan_document_reviews')) {
          data = [
            {
              'id': 'review-original',
              'document_id': 'document-one',
              'version_id': null,
              'status': 'needs_replacement',
              'reason': 'Upload a clear copy.',
              'created_at': '2026-11-02T00:00:00Z',
            },
          ];
        } else if (request.uri.path.endsWith(
          '/member_application_corrections',
        )) {
          data = [
            {
              'applicationId': 'APP-TEST',
              'stage': 'returned_for_requirements',
              'reason': 'Replace blurred ID.',
              'affectedKinds': ['validId'],
              'createdAt': '2026-11-04T00:00:00Z',
            },
          ];
        } else if (request.uri.path.endsWith('/shared_documents')) {
          data = [
            {
              'id': 'shared-one',
              'title': 'Shared form',
              'published_at': '2026-11-04T00:00:00Z',
            },
          ];
        }
        request.response.write(jsonEncode(data));
        await request.response.close();
      });
      final client = SupabaseClient(
        'http://127.0.0.1:${server.port}',
        'synthetic-public-key',
        authOptions: const AuthClientOptions(autoRefreshToken: false),
      );
      try {
        await client.auth.signInWithPassword(
          email: 'synthetic@example.invalid',
          password: 'synthetic-password',
        );
        final result = await DocumentCenterService(client: client).load();
        final root = result.submissions.single;
        expect(
          (root['latest'] as DocumentRow)['original_name'],
          'replacement.pdf',
        );
        expect(root['latest_version_id'], 'version-two');
        expect(root['review'], isNull);
        expect(
          (root['reviews'] as List).single['reason'],
          'Upload a clear copy.',
        );
        expect(root['original_name'], 'original.pdf');
        expect(result.shared.single['title'], 'Shared form');
        expect(result.corrections.single['reason'], 'Replace blurred ID.');
        expect(
          requests
              .singleWhere((uri) => uri.path.endsWith('/loan_documents'))
              .queryParameters['user_id'],
          'eq.$owner',
        );
      } finally {
        await client.dispose();
        await server.close(force: true);
      }
    },
  );
}
