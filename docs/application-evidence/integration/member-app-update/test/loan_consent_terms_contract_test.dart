import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:coop_frontend/models/loan_consent_submission.dart';

void main() {
  test('the saved terms match the member review text and version', () {
    final sql = File(
      'supabase/migrations/20261112030000_loan_submission_agreements.sql',
    ).readAsStringSync();
    final source = File('lib/review_terms_screen.dart').readAsStringSync();
    final termsCard = source.substring(source.indexOf('class TermsCard'));
    final paragraphs = RegExp(r"'((?:\\'|[^'\n])*)',")
        .allMatches(termsCard)
        .map((match) => match.group(1)!)
        .where((text) => RegExp(r'^\d+\.').hasMatch(text))
        .map(
          (text) =>
              text.replaceAll(r"\'", "'").replaceAll(RegExp(r'</?b>'), ''),
        )
        .toList();
    expect(paragraphs, hasLength(12));
    final savedTerms = RegExp(
      r'\$terms\$(.*?)\$terms\$',
      dotAll: true,
    ).firstMatch(sql)!.group(1);
    expect(savedTerms, paragraphs.join('\n\n'));
    expect(sql, contains(LoanConsentSubmission.termsVersion));
  });
}
