import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:coop_frontend/models/loan_consent_submission.dart';
import 'package:coop_frontend/models/loan_document.dart';
import 'package:coop_frontend/services/loan_document_upload_service.dart';
import 'dart:typed_data';

void main() {
  test(
    'both confirmations are required and witness names are normalized and distinct',
    () {
      for (final consent in [
        const LoanConsentSubmission(
          termsAccepted: false,
          informationCertified: true,
        ),
        const LoanConsentSubmission(
          termsAccepted: true,
          informationCertified: false,
        ),
        const LoanConsentSubmission(
          termsAccepted: true,
          informationCertified: true,
          witnessNames: ['Same', ' same '],
        ),
      ]) {
        expect(consent.validate, throwsStateError);
      }
      const consent = LoanConsentSubmission(
        termsAccepted: true,
        informationCertified: true,
        witnessNames: [' Witness One ', '', 'Witness Two'],
      );
      consent.validate();
      expect(consent.normalizedWitnessNames, ['Witness One', 'Witness Two']);
    },
  );

  test(
    'a retry sends the saved document manifest and explicit consent to the atomic RPC',
    () async {
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      const owner = '10000000-0000-0000-0000-000000000003';
      final calls = <Map<String, dynamic>>[];
      String part(Object data) =>
          base64Url.encode(utf8.encode(jsonEncode(data))).replaceAll('=', '');
      final token =
          '${part({'alg': 'HS256'})}.${part({'sub': owner, 'role': 'authenticated', 'exp': DateTime.now().millisecondsSinceEpoch ~/ 1000 + 3600})}.synthetic';
      server.listen((request) async {
        final body = await utf8.decoder.bind(request).join();
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
              'email': 'synthetic@example.invalid',
              'app_metadata': {'role': 'member'},
              'user_metadata': {},
              'created_at': '2026-01-01T00:00:00Z',
            },
          };
        } else if (request.uri.path.endsWith('/loan_policy_settings')) {
          data = {'collateral_required_above': 200000};
        } else if (request.uri.path.endsWith('/members')) {
          data = {
            'id': 'member-fixture',
            'status': 'active',
            'must_change_password': false,
          };
        } else if (request.uri.path.endsWith('/loan_applications')) {
          data = {
            'id': 'app-fixture',
            'member_id': 'member-fixture',
            'loan_type': 'Regular',
            'amount': 1000,
            'tenure_months': 12,
          };
        } else if (request.uri.path.endsWith('/loan_documents')) {
          data = [
            for (final kind in ['validId', 'payslip'])
              {
                'kind': kind,
                'storage_path': '$owner/LA-2026-123456/$kind.pdf',
                'original_name': '$kind.pdf',
                'content_type': 'application/pdf',
                'size_bytes': 10,
              },
          ];
        } else if (request.uri.path.endsWith(
          '/rpc/submit_loan_with_agreements',
        )) {
          calls.add(Map<String, dynamic>.from(jsonDecode(body) as Map));
          data = 'app-fixture';
        } else {
          request.response.statusCode = 500;
          data = {'message': 'Unexpected endpoint'};
        }
        request.response.write(jsonEncode(data));
        await request.response.close();
      });
      final client = SupabaseClient(
        'http://${server.address.address}:${server.port}',
        'synthetic-key',
      );
      try {
        await client.auth.signInWithPassword(
          email: 'synthetic@example.invalid',
          password: 'Synthetic1!',
        );
        final documents = <SelectedLoanDocument>[];
        // The selected document model is tested separately; use actual valid PDF fixtures here.
        for (final kind in [
          LoanDocumentKind.validId,
          LoanDocumentKind.payslip,
        ]) {
          documents.add(
            SelectedLoanDocument.fromBytes(
              kind: kind,
              name: '${kind.name}.pdf',
              bytes: Uint8List.fromList(utf8.encode('%PDF-1.4 fixture')),
            ),
          );
        }
        await LoanDocumentUploadService(client: client).submit(
          applicationId: 'LA-2026-123456',
          loanType: 'Regular',
          amount: 1000,
          documents: documents,
          tenureMonths: 12,
          consent: const LoanConsentSubmission(
            termsAccepted: true,
            informationCertified: true,
            witnessNames: [' Witness One ', 'Witness Two'],
          ),
        );
        expect(calls, hasLength(1));
        expect(calls.single['p_terms_accepted'], true);
        expect(calls.single['p_information_certified'], true);
        expect(calls.single['p_witness_names'], ['Witness One', 'Witness Two']);
        expect(
          calls.single['p_terms_version'],
          LoanConsentSubmission.termsVersion,
        );
        expect(calls.single['p_documents'], hasLength(2));
      } finally {
        await client.dispose();
        await server.close(force: true);
      }
    },
  );
}
