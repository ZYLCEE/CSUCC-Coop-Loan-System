import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'app_theme.dart';
import 'dashboard.dart';
import 'email_otp_verification_screen.dart';
import 'application_service.dart';
import 'loan_application_flow.dart';
import 'loan_participants_screen.dart';
import 'models/loan_agreement_snapshot.dart';
import 'models/loan_consent_submission.dart';
import 'responsive.dart';
import 'services/co_maker_invitation_service.dart';
import 'services/supabase_service.dart';
import 'widgets/loan_agreement_preview.dart';

CoMakerInvitationService _invitationService() =>
    CoMakerInvitationService(supabaseUrl: dotenv.env['SUPABASE_URL'] ?? '');

ButtonStyle _loanActionButtonStyle({required bool enabled}) =>
    ElevatedButton.styleFrom(
      backgroundColor: enabled
          ? AppTheme.primaryGreen
          : AppTheme.lightGrayGreen,
      disabledBackgroundColor: AppTheme.lightGrayGreen,
      foregroundColor: Colors.white,
      disabledForegroundColor: Colors.white,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppTheme.buttonBorderRadius),
      ),
    );

class BorrowerCoMakerInvitationScreen extends StatefulWidget {
  const BorrowerCoMakerInvitationScreen({
    super.key,
    required this.flow,
    required this.snapshot,
  });

  final LoanApplicationFlow flow;
  final LoanAgreementSnapshot snapshot;

  @override
  State<BorrowerCoMakerInvitationScreen> createState() =>
      _BorrowerCoMakerInvitationScreenState();
}

class _BorrowerCoMakerInvitationScreenState
    extends State<BorrowerCoMakerInvitationScreen> {
  bool _busy = false;
  bool _acknowledged = false;
  bool _termsAccepted = false;
  bool _informationCertified = false;
  String? _error;
  String? _requestId;
  String? _status;
  bool? _emailSent;

  @override
  void initState() {
    super.initState();
    final draft = widget.flow.draft;
    _requestId = draft.coMakerRequestId;
    if (_requestId != null) _refreshStatus();
  }

  Future<void> _sendInvitation() async {
    if (_busy || !widget.flow.canUseLiveSubmission) return;
    final draft = widget.flow.draft;
    final participants = draft.participants;
    final candidate = draft.participants?.coMaker;
    final idDocument = participants?.coMakerIdDocument;
    final relationship = draft.participants?.relationship.trim() ?? '';
    if (candidate == null ||
        !candidate.isVerifiedMember ||
        relationship.isEmpty ||
        idDocument == null) {
      setState(
        () => _error =
            'Verify an active co-maker, attach their ID document, and choose your relationship first.',
      );
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      draft.applicationId ??= ApplicationService.generateReferenceNumber();
      var idDocumentPath = participants!.coMakerIdDocumentPath;
      if (idDocumentPath == null) {
        idDocumentPath = await _invitationService().uploadCoMakerIdDocument(
          applicationId: draft.applicationId!,
          document: idDocument,
        );
        participants.coMakerIdDocumentPath = idDocumentPath;
      }
      final result = await _invitationService().createRequest(
        applicationId: draft.applicationId!,
        coMaker: candidate,
        relationship: relationship,
        coMakerIdDocumentPath: idDocumentPath,
        snapshot: widget.snapshot,
      );
      final id = result['request_id'];
      if (id is! String || id.isEmpty) {
        throw StateError('The invitation service returned an invalid request.');
      }
      draft.coMakerRequestId = id;
      if (!mounted) return;
      setState(() {
        _requestId = id;
        _status = result['status']?.toString() ?? 'pending';
        _emailSent = result['email_sent'] == true;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = _message(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _refreshStatus() async {
    final id = _requestId;
    if (_busy || id == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final request = await _invitationService().getRequest(id);
      if (!mounted) return;
      setState(() => _status = request['status']?.toString());
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = _message(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _continueToSubmission() async {
    if (_busy ||
        !widget.flow.canUseLiveSubmission ||
        _status != 'accepted' ||
        !_termsAccepted ||
        !_informationCertified) {
      return;
    }
    await widget.flow.push(
      context,
      (_) => EmailOtpVerificationScreen(
        flow: widget.flow,
        consent: LoanConsentSubmission(
          termsAccepted: _termsAccepted,
          informationCertified: _informationCertified,
          witnessNames: [
            widget.snapshot.witnessOne,
            widget.snapshot.witnessTwo,
          ],
        ),
      ),
    );
  }

  Future<void> _chooseAnotherCoMaker() async {
    final draft = widget.flow.draft;
    draft
      ..applicationId = null
      ..coMakerRequestId = null;
    final participants = draft.participants;
    if (participants != null) {
      final idDocumentPath = participants.coMakerIdDocumentPath;
      if (idDocumentPath != null) {
        try {
          await _invitationService().removeCoMakerIdDocument(idDocumentPath);
        } catch (_) {
          // Do not block replacing a declined co-maker if storage cleanup fails.
        }
      }
      participants
        ..coMaker = null
        ..memberIdInput = ''
        ..relationship = ''
        ..coMakerIdDocument = null
        ..coMakerIdDocumentPath = null;
    }
    await widget.flow.push(
      context,
      (_) => LoanParticipantsScreen(flow: widget.flow),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.flow.isActive ||
        (!widget.flow.previewOnly && !widget.flow.canUseLiveSubmission)) {
      return const Scaffold(
        body: Center(child: Text('Loan application unavailable.')),
      );
    }
    final coMaker = widget.snapshot.coMaker;
    final canInvite = coMaker?.isVerifiedMember == true;
    final statusText = switch (_status) {
      'pending' =>
        'Invitation sent. Waiting for the co-maker to review and respond.',
      'otp_pending' => 'The co-maker has started their email verification.',
      'accepted' =>
        'The co-maker accepted and verified their email. You can continue your application.',
      'rejected' =>
        'The co-maker declined. Choose another co-maker before submitting.',
      _ => null,
    };
    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        backgroundColor: AppTheme.cardWhite,
        elevation: 0,
        title: const Text('Agreement Preview', style: AppTheme.titleBold),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: EdgeInsets.all(Responsive.cardPadding(context)),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                widget.flow.previewOnly
                    ? 'This is a local draft. Online submission is disabled.'
                    : 'Review the proposed loan details. The application will be sent to the cooperative only after the co-maker accepts and verifies their email.',
                style: AppTheme.bodyRegular,
              ),
              const SizedBox(height: AppTheme.spacingL),
              LoanAgreementPreview(
                snapshot: widget.snapshot,
                localPreview: widget.flow.previewOnly,
              ),
              if (statusText != null) ...[
                const SizedBox(height: AppTheme.spacingL),
                _messageCard(statusText),
              ],
              if (_emailSent != null) ...[
                const SizedBox(height: AppTheme.spacingM),
                _messageCard(
                  _emailSent == true
                      ? 'The invitation was sent to the co-maker’s app notifications and registered email. They must respond in the app and verify by email OTP.'
                      : 'The invitation is in the co-maker’s app notifications, but its email could not be sent. Email delivery needs to be configured by the project administrator.',
                ),
              ],
              if (_error != null) ...[
                const SizedBox(height: AppTheme.spacingM),
                Text(_error!, style: const TextStyle(color: AppTheme.danger)),
              ],
              const SizedBox(height: AppTheme.spacingL),
              if (widget.flow.previewOnly)
                const Text(
                  'Switch this flow to live mode before sending invitations or submitting applications.',
                  style: AppTheme.captionRegular,
                )
              else if (_status == 'accepted') ...[
                CheckboxListTile(
                  value: _termsAccepted,
                  onChanged: _busy
                      ? null
                      : (value) =>
                            setState(() => _termsAccepted = value ?? false),
                  title: const Text(
                    'I have read, understood, and agree to the Terms and Conditions.',
                  ),
                ),
                CheckboxListTile(
                  value: _informationCertified,
                  onChanged: _busy
                      ? null
                      : (value) => setState(
                          () => _informationCertified = value ?? false,
                        ),
                  title: const Text(
                    'I certify that all information provided in this loan application is true and correct.',
                  ),
                ),
                ElevatedButton(
                  onPressed: _busy || !_termsAccepted || !_informationCertified
                      ? null
                      : _continueToSubmission,
                  style: _loanActionButtonStyle(enabled: !_busy),
                  child: const Text('Continue to Loan Submission'),
                ),
              ] else if (_status == 'rejected')
                ElevatedButton(
                  onPressed: _busy ? null : _chooseAnotherCoMaker,
                  style: _loanActionButtonStyle(enabled: !_busy),
                  child: const Text('Choose Another Co-Maker'),
                )
              else if (_requestId != null)
                OutlinedButton.icon(
                  onPressed: _busy ? null : _refreshStatus,
                  icon: _busy
                      ? const SizedBox.square(
                          dimension: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.refresh),
                  label: const Text('Check Co-Maker Response'),
                )
              else ...[
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                  value: _acknowledged,
                  onChanged: _busy
                      ? null
                      : (value) =>
                            setState(() => _acknowledged = value ?? false),
                  title: const Text(
                    'I reviewed these proposed details and understand that the loan remains subject to cooperative review.',
                  ),
                ),
                ElevatedButton(
                  onPressed: _busy || !_acknowledged || !canInvite
                      ? null
                      : _sendInvitation,
                  style: _loanActionButtonStyle(
                    enabled: !_busy && _acknowledged && canInvite,
                  ),
                  child: _busy
                      ? const CircularProgressIndicator()
                      : const Text('Send Co-Maker Invitation'),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _messageCard(String text) => Container(
    padding: const EdgeInsets.all(AppTheme.spacingL),
    decoration: BoxDecoration(
      color: AppTheme.cardWhite,
      borderRadius: BorderRadius.circular(AppTheme.cardBorderRadius),
      boxShadow: AppTheme.cardShadow,
    ),
    child: Text(text, style: AppTheme.bodyRegular),
  );
}

class CoMakerInvitationReviewScreen extends StatefulWidget {
  const CoMakerInvitationReviewScreen({super.key, required this.requestId});

  final String requestId;

  @override
  State<CoMakerInvitationReviewScreen> createState() =>
      _CoMakerInvitationReviewScreenState();
}

class _CoMakerInvitationReviewScreenState
    extends State<CoMakerInvitationReviewScreen> {
  bool _loading = true;
  bool _busy = false;
  bool _acknowledged = false;
  String? _error;
  Map<String, dynamic>? _request;

  @override
  void initState() {
    super.initState();
    _loadRequest();
  }

  Future<void> _loadRequest() async {
    try {
      final request = await _invitationService().getRequest(widget.requestId);
      final currentUserId = Supabase.instance.client.auth.currentUser?.id;
      if (request['co_maker_user_id'] != currentUserId) {
        throw StateError(
          'This invitation belongs to a different member account.',
        );
      }
      if (mounted) setState(() => _request = request);
    } catch (error) {
      if (mounted) setState(() => _error = _message(error));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _accept() async {
    final request = _request;
    final email = Supabase.instance.client.auth.currentUser?.email?.trim();
    if (_busy || request == null || email == null || email.isEmpty) {
      setState(
        () => _error =
            'Sign in to the invited member account with a registered email.',
      );
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _invitationService().beginAccept(widget.requestId);
      await SupabaseService().sendOtp(email: email);
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => CoMakerAcceptanceOtpScreen(
            requestId: widget.requestId,
            email: email,
            expectedUserId: Supabase.instance.client.auth.currentUser!.id,
            borrowerName:
                request['borrower_name']?.toString() ?? 'the borrower',
            loanType: request['loan_type']?.toString() ?? 'loan',
          ),
        ),
      );
    } catch (error) {
      if (mounted) setState(() => _error = _message(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reject() async {
    if (_busy) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Decline co-maker invitation?'),
        content: const Text('The borrower will be notified that you declined.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Decline'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _invitationService().reject(widget.requestId);
      if (!mounted) return;
      await _showResult(
        context,
        title: 'Invitation declined',
        message: 'The borrower has been notified.',
      );
    } catch (error) {
      if (mounted) setState(() => _error = _message(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final request = _request;
    final details = request?['loan_details'];
    final loanDetails = details is Map
        ? Map<String, dynamic>.from(details)
        : const <String, dynamic>{};
    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        backgroundColor: AppTheme.cardWhite,
        elevation: 0,
        title: const Text('Co-Maker Invitation', style: AppTheme.titleBold),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : request == null
          ? Center(child: Text(_error ?? 'Invitation unavailable.'))
          : SafeArea(
              child: SingleChildScrollView(
                padding: EdgeInsets.all(Responsive.cardPadding(context)),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      'You are invited to be a Co-Maker of ${request['borrower_name']} for the ${request['loan_type']} Loan.',
                      style: AppTheme.headingBold,
                    ),
                    const SizedBox(height: AppTheme.spacingL),
                    _detail('Requested amount', _currency(request['amount'])),
                    _detail(
                      'Repayment term',
                      '${request['tenure_months']} months',
                    ),
                    _detail(
                      'Relationship',
                      request['relationship']?.toString() ?? 'Not provided',
                    ),
                    _detail(
                      'Monthly amortization',
                      loanDetails['monthly_amortization']?.toString() ??
                          'Not provided',
                    ),
                    _detail(
                      'Interest rate',
                      loanDetails['interest_rate']?.toString() ??
                          'Not provided',
                    ),
                    _detail(
                      'Total interest',
                      loanDetails['total_interest']?.toString() ??
                          'Not provided',
                    ),
                    _detail(
                      'Processing fee',
                      loanDetails['processing_fee']?.toString() ??
                          'Not provided',
                    ),
                    _detail(
                      'Notarial fee',
                      loanDetails['notarial_fee']?.toString() ?? 'Not provided',
                    ),
                    _detail(
                      'Retention fee',
                      loanDetails['retention_fee']?.toString() ??
                          'Not provided',
                    ),
                    _detail(
                      'Estimated net take-home',
                      loanDetails['net_take_home']?.toString() ??
                          'Not provided',
                    ),
                    const SizedBox(height: AppTheme.spacingL),
                    const Text(
                      'Review the figures carefully. Accepting records your consent to be a co-maker for this proposed application. The cooperative still needs to review the loan; this is not an approval.',
                      style: AppTheme.bodyRegular,
                    ),
                    if (request['status'] == 'pending') ...[
                      CheckboxListTile(
                        contentPadding: EdgeInsets.zero,
                        controlAffinity: ListTileControlAffinity.leading,
                        value: _acknowledged,
                        onChanged: (value) =>
                            setState(() => _acknowledged = value ?? false),
                        title: const Text(
                          'I reviewed these loan details and want to respond to this invitation.',
                        ),
                      ),
                      if (_error != null)
                        Text(
                          _error!,
                          style: const TextStyle(color: AppTheme.danger),
                        ),
                      const SizedBox(height: AppTheme.spacingM),
                      ElevatedButton(
                        onPressed: _busy || !_acknowledged ? null : _accept,
                        style: _loanActionButtonStyle(
                          enabled: !_busy && _acknowledged,
                        ),
                        child: _busy
                            ? const CircularProgressIndicator()
                            : const Text('Accept and Verify by Email'),
                      ),
                      OutlinedButton(
                        onPressed: _busy ? null : _reject,
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppTheme.danger,
                          side: const BorderSide(color: AppTheme.danger),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(
                              AppTheme.buttonBorderRadius,
                            ),
                          ),
                        ),
                        child: const Text('Reject Invitation'),
                      ),
                    ] else
                      _detail(
                        'Invitation status',
                        request['status']?.toString() ?? 'unknown',
                      ),
                  ],
                ),
              ),
            ),
    );
  }

  Widget _detail(String label, String value) => Padding(
    padding: const EdgeInsets.only(bottom: AppTheme.spacingS),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(child: Text(label, style: AppTheme.captionBold)),
        const SizedBox(width: AppTheme.spacingM),
        Expanded(child: Text(value, style: AppTheme.bodyRegular)),
      ],
    ),
  );
}

class CoMakerAcceptanceOtpScreen extends StatefulWidget {
  const CoMakerAcceptanceOtpScreen({
    super.key,
    required this.requestId,
    required this.email,
    required this.expectedUserId,
    required this.borrowerName,
    required this.loanType,
  });

  final String requestId;
  final String email;
  final String expectedUserId;
  final String borrowerName;
  final String loanType;

  @override
  State<CoMakerAcceptanceOtpScreen> createState() =>
      _CoMakerAcceptanceOtpScreenState();
}

class _CoMakerAcceptanceOtpScreenState
    extends State<CoMakerAcceptanceOtpScreen> {
  final _controllers = List.generate(8, (_) => TextEditingController());
  final _focusNodes = List.generate(8, (_) => FocusNode());
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    for (final controller in _controllers) {
      controller.dispose();
    }
    for (final node in _focusNodes) {
      node.dispose();
    }
    super.dispose();
  }

  String get _token => _controllers.map((controller) => controller.text).join();

  Future<void> _resend() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _invitationService().beginAccept(widget.requestId);
      await SupabaseService().sendOtp(email: widget.email);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('A new verification code was sent.')),
        );
      }
    } catch (error) {
      if (mounted) setState(() => _error = _message(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verify() async {
    if (_busy || _token.length != _controllers.length) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _invitationService().verifyAcceptanceOtp(
        email: widget.email,
        token: _token,
      );
      final user = Supabase.instance.client.auth.currentUser;
      if (user?.id != widget.expectedUserId) {
        await Supabase.instance.client.auth.signOut();
        throw StateError(
          'The code verified a different member account. Sign in as the invited co-maker and try again.',
        );
      }
      await _invitationService().confirmAccept(widget.requestId);
      if (!mounted) return;
      await _showResult(
        context,
        title: 'Co-Maker consent confirmed',
        message:
            'You are now a Co-Maker of ${widget.borrowerName}’s ${widget.loanType} Loan. The application is still subject to cooperative review.',
      );
    } catch (error) {
      if (mounted) setState(() => _error = _message(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: AppTheme.background,
    appBar: AppBar(
      backgroundColor: AppTheme.cardWhite,
      elevation: 0,
      title: const Text('Verify Co-Maker Consent', style: AppTheme.titleBold),
    ),
    body: SafeArea(
      child: SingleChildScrollView(
        padding: EdgeInsets.all(Responsive.cardPadding(context)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Enter the code sent to ${_maskEmail(widget.email)} to confirm your response.',
            ),
            const SizedBox(height: AppTheme.spacingL),
            Row(
              children: List.generate(_controllers.length, (index) {
                return Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 2),
                    child: TextField(
                      controller: _controllers[index],
                      focusNode: _focusNodes[index],
                      enabled: !_busy,
                      textAlign: TextAlign.center,
                      keyboardType: TextInputType.number,
                      inputFormatters: [
                        FilteringTextInputFormatter.digitsOnly,
                        LengthLimitingTextInputFormatter(1),
                      ],
                      onChanged: (value) {
                        if (value.isNotEmpty &&
                            index < _focusNodes.length - 1) {
                          _focusNodes[index + 1].requestFocus();
                        } else if (value.isEmpty && index > 0) {
                          _focusNodes[index - 1].requestFocus();
                        }
                        setState(() {});
                      },
                      decoration: const InputDecoration(
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ),
                );
              }),
            ),
            if (_error != null) ...[
              const SizedBox(height: AppTheme.spacingM),
              Text(_error!, style: const TextStyle(color: AppTheme.danger)),
            ],
            const SizedBox(height: AppTheme.spacingL),
            ElevatedButton(
              onPressed: _busy || _token.length != _controllers.length
                  ? null
                  : _verify,
              style: _loanActionButtonStyle(
                enabled: !_busy && _token.length == _controllers.length,
              ),
              child: _busy
                  ? const CircularProgressIndicator()
                  : const Text('Verify and Accept'),
            ),
            TextButton(
              onPressed: _busy ? null : _resend,
              child: const Text('Resend code'),
            ),
            const Text(
              'Never share this code with anyone.',
              style: AppTheme.captionRegular,
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    ),
  );
}

Future<void> _showResult(
  BuildContext context, {
  required String title,
  required String message,
}) async {
  await showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (dialogContext) => AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(),
          child: const Text('Return to Dashboard'),
        ),
      ],
    ),
  );
  if (!context.mounted) return;
  Navigator.of(context).pushAndRemoveUntil(
    MaterialPageRoute(builder: (_) => const Dashboard()),
    (_) => false,
  );
}

String _maskEmail(String email) {
  final at = email.indexOf('@');
  if (at <= 0) return 'your registered email';
  return '${email.substring(0, 1)}•••${email.substring(at)}';
}

String _currency(dynamic value) {
  final amount = double.tryParse('$value');
  return amount == null ? 'Not provided' : 'PHP ${amount.toStringAsFixed(2)}';
}

String _message(Object error) => error is StateError
    ? error.message
    : 'Unable to complete the co-maker request. Please try again.';
