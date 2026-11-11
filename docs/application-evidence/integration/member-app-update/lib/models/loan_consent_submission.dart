/// Values explicitly confirmed on the review screen, never inferred from submission.
class LoanConsentSubmission {
  const LoanConsentSubmission({
    required this.termsAccepted,
    required this.informationCertified,
    this.witnessNames = const [],
  });

  static const termsVersion = 'csucc-loan-terms-2026-11-12-v1';
  final bool termsAccepted;
  final bool informationCertified;
  final List<String> witnessNames;

  List<String> get normalizedWitnessNames => witnessNames
      .map((name) => name.trim())
      .where((name) => name.isNotEmpty)
      .toList(growable: false);

  void validate() {
    if (!termsAccepted || !informationCertified) {
      throw StateError(
        'Accept the Terms and Conditions and certify your application information.',
      );
    }
    final names = normalizedWitnessNames;
    if (names.length > 2 ||
        names.any(
          (name) =>
              name.length > 160 || RegExp(r'[\x00-\x1f\x7f]').hasMatch(name),
        )) {
      throw StateError(
        'Enter up to two valid witness names, each at most 160 characters.',
      );
    }
    if (names.map((name) => name.toLowerCase()).toSet().length !=
        names.length) {
      throw StateError('Enter different people in the witness fields.');
    }
  }
}
