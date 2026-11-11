import 'loan_application_flow.dart';
import 'widgets/loan_progress_indicator.dart';
import 'package:flutter/material.dart';
import 'app_theme.dart';
import 'email_otp_verification_screen.dart';
import 'models/loan_agreement_snapshot.dart';
import 'models/loan_consent_submission.dart';
import 'demo_loan_consent_screen.dart';
import 'co_maker_invitation_screen.dart';

class ReviewTermsScreen extends StatefulWidget {
  final LoanApplicationFlow flow;

  const ReviewTermsScreen({
    super.key,
    required this.flow,
    required this.snapshot,
  });

  final LoanAgreementSnapshot snapshot;

  @override
  State<ReviewTermsScreen> createState() => _ReviewTermsScreenState();
}

class _ReviewTermsScreenState extends State<ReviewTermsScreen> {
  bool _acceptedTerms = false;
  bool _certifiedInformation = false;

  bool get _isValidated => _acceptedTerms && _certifiedInformation;

  @override
  Widget build(BuildContext context) {
    if (widget.flow.participantsDemo) {
      return DemoLoanConsentScreen(
        key: ValueKey(widget.snapshot),
        flow: widget.flow,
        snapshot: widget.snapshot,
      );
    }
    if (widget.flow.previewOnly) {
      return BorrowerAgreementPreviewScreen(
        flow: widget.flow,
        snapshot: widget.snapshot,
      );
    }
    if (widget.flow.requireCoMaker) {
      return BorrowerCoMakerInvitationScreen(
        flow: widget.flow,
        snapshot: widget.snapshot,
      );
    }
    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: _buildAppBar(),
      body: SafeArea(
        child: SingleChildScrollView(
          physics: const BouncingScrollPhysics(),
          padding: const EdgeInsets.all(AppTheme.spacingL),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              LoanProgressIndicator.forApplication(
                LoanApplicationStep.review,
                participantsDemo: false,
              ),
              const SizedBox(height: AppTheme.spacingL),
              const TermsCard(),
              const SizedBox(height: AppTheme.spacingL),
              const Text(
                'Please review the Terms & Conditions carefully before proceeding.',
                style: TextStyle(
                  color: Color(0xFF7D8A82),
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(height: AppTheme.spacingM),
              AgreementCheckbox(
                label:
                    'I have read, understood, and agree to the Terms and Conditions.',
                value: _acceptedTerms,
                onChanged: (value) {
                  setState(() {
                    _acceptedTerms = value ?? false;
                  });
                },
              ),
              const SizedBox(height: AppTheme.spacingM),
              AgreementCheckbox(
                label:
                    'I certify that all information provided in this loan application is true and correct.',
                value: _certifiedInformation,
                onChanged: (value) {
                  setState(() {
                    _certifiedInformation = value ?? false;
                  });
                },
              ),
              const SizedBox(height: AppTheme.spacingXL),
              PrimaryButton(
                isEnabled: _isValidated,
                onPressed: _isValidated
                    ? () => widget.flow.push(
                        context,
                        (_) => EmailOtpVerificationScreen(
                          flow: widget.flow,
                          consent: LoanConsentSubmission(
                            termsAccepted: _acceptedTerms,
                            informationCertified: _certifiedInformation,
                            witnessNames: [
                              widget.snapshot.witnessOne,
                              widget.snapshot.witnessTwo,
                            ],
                          ),
                        ),
                      )
                    : null,
              ),
              const SizedBox(height: AppTheme.spacingXL),
            ],
          ),
        ),
      ),
    );
  }

  PreferredSizeWidget _buildAppBar() {
    return AppBar(
      backgroundColor: AppTheme.cardWhite,
      elevation: 0,
      leading: IconButton(
        icon: const Icon(
          Icons.arrow_back_ios_new,
          color: AppTheme.mutedGray,
          size: 20,
        ),
        onPressed: () => Navigator.of(context).pop(),
      ),
      title: const Text(
        'Review',
        style: TextStyle(
          color: Color(0xFF183A24),
          fontSize: 18,
          fontWeight: FontWeight.w700,
        ),
      ),
      centerTitle: true,
    );
  }
}

class TermsCard extends StatelessWidget {
  const TermsCard({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: AppTheme.cardWhite,
        borderRadius: BorderRadius.circular(AppTheme.cardBorderRadius),
        boxShadow: AppTheme.cardShadow,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'TERMS AND CONDITIONS',
            style: TextStyle(
              color: Color(0xFF183A24),
              fontSize: 14,
              fontWeight: FontWeight.w700,
              letterSpacing: 1.0,
            ),
          ),
          const SizedBox(height: 16),
          const Text(
            '1. The loan shall be payable in __________ mo/s. with monthly amortization of PhP __________ thru salary deduction/ATM retention or issuance of PDC to commence on the payroll date immediately succeeding the date of loan granted.',
            style: TextStyle(
              color: Color(0xFF4A5568),
              fontSize: 13,
              fontWeight: FontWeight.w400,
              height: 1.5,
            ),
          ),
          const SizedBox(height: 12),
          const Text(
            '2. The borrower hereby agrees to pay the <b>2% interest per month</b>. The borrower also agrees that the above interest rate of the loan as well as all fees and charges under this agreement/note maybe increase by the coop anytime during the term of the loan if CSUCC ER MPC so requires. The borrower shall be notified of the increase which shall take effect on the next scheduled amortization.',
            style: TextStyle(
              color: Color(0xFF4A5568),
              fontSize: 13,
              fontWeight: FontWeight.w400,
              height: 1.5,
            ),
          ),
          const SizedBox(height: 12),
          const Text(
            '3. The borrower that in case of his transfer of assignment where he/she no longer receives his salary from his former station, the loan shall become <b>due and demandable</b>.',
            style: TextStyle(
              color: Color(0xFF4A5568),
              fontSize: 13,
              fontWeight: FontWeight.w400,
              height: 1.5,
            ),
          ),
          const SizedBox(height: 12),
          const Text(
            '4. In the event the borrower is TERMINATED/SEPARATED from CSU Cabadbaran City (CSUCC), (a) the borrower\'s outstanding loan shall become <b>Due and Demandable</b>; (b) the borrower hereby agrees that all his salaries, bonuses, separation/gratuity pay, retirement benefits, and all other benefits due to him from his/employer and from any other sources (SSS, GSIS, etc.) shall be withheld by his/her employer and remitted to the CSUCC ER MPC to settle the borrower\'s outstanding loan; (c) if the outstanding loan plus all interest thereon have been fully settled by the borrower (d) if the amount collected from the borrower is insufficient to cover the borrower\'s outstanding obligation with the coop, the Co-Maker agrees to settle the balance of the loan and authorizes the Head of Office/Disbursing Officer to withhold his/her Payroll until the loan balance has been settled:',
            style: TextStyle(
              color: Color(0xFF4A5568),
              fontSize: 13,
              fontWeight: FontWeight.w400,
              height: 1.5,
            ),
          ),
          const SizedBox(height: 12),
          const Text(
            '5. In the event the Co-maker is terminated/separated from service with CSU Cabadbaran City (CSUCC), the borrower shall submit to the Coop a qualified and acceptable replacement of the Co-maker for the loan as determined by the Coop within ten (10) days from termination/separation of the co-maker. Failure to do so shall constitute an event of Default hereunder.',
            style: TextStyle(
              color: Color(0xFF4A5568),
              fontSize: 13,
              fontWeight: FontWeight.w400,
              height: 1.5,
            ),
          ),
          const SizedBox(height: 12),
          const Text(
            '6. The Borrower and Co-maker shall be <b>jointly and severally liable</b> to the CSUCC ER MPC for the full payment and complete performance of such obligation from any one of them;',
            style: TextStyle(
              color: Color(0xFF4A5568),
              fontSize: 13,
              fontWeight: FontWeight.w400,
              height: 1.5,
            ),
          ),
          const SizedBox(height: 12),
          const Text(
            '7. The borrower and co-maker hereby assign in favor of CSUCC ER MPC their salaries, allowances, bonuses, retirement benefits, separation/gratuity pay, monetary value of their accumulated leave credits/service credits and other monies/benefits (collectively referred to as receivable) due to them from their employer, SSS, GSIS or from whatever source. The liability of the borrower and co-maker under this assignment shall extend to all renewals and/or extensions of time of payment of the loan plus all interest thereon. To affect above assignment, the borrower and co-maker irrevocably appoint and constitute CSUCC ER MPC as their True and Lawful Attorney-In-Fact with full power and authority to apply or use the proceeds of the Receivables in payment of the loan plus interest thereon, to collect the amounts due hereunder and endorsed any checks or other instruments and to file any claims on institute any proceedings which are necessary to protect the bank\'s right under the Assignment.',
            style: TextStyle(
              color: Color(0xFF4A5568),
              fontSize: 13,
              fontWeight: FontWeight.w400,
              height: 1.5,
            ),
          ),
          const SizedBox(height: 12),
          const Text(
            '8. The borrower agrees and authorizes CSUCC ER MPC to act as his agent to, (a) periodically deduct from his/her salary and other remuneration the amortization of the loan and (b) remit the same to CSUCC ER MPC not later than the 10th banking after each payroll date without demand, protest or notice of any kind;',
            style: TextStyle(
              color: Color(0xFF4A5568),
              fontSize: 13,
              fontWeight: FontWeight.w400,
              height: 1.5,
            ),
          ),
          const SizedBox(height: 12),
          const Text(
            '9. The borrower agrees that any legal action suit or proceedings arising out or relating to this agreement/note, or other documentation contemplated hereby maybe instituted by the CSUCC ER MPC and its option in the appropriate Courts of Agusan del Norte or in any other jurisdiction where the assets or properties of the borrowers, maybe found. The borrower hereby irrevocably submits himself to the jurisdiction of such courts;',
            style: TextStyle(
              color: Color(0xFF4A5568),
              fontSize: 13,
              fontWeight: FontWeight.w400,
              height: 1.5,
            ),
          ),
          const SizedBox(height: 12),
          const Text(
            '10. The borrower shall pay the CSUCC ER MPC reasonable attorney\'s fees which shall be in the amount equal to <b>twenty (20%) percent</b> of the total amount due, regardless of whether or not CSUCC ER MPC institutes suit for purposes of collection and any and all cost of litigation the event CSUCC ER MPC is constrained to institute a court suit to enforce collection of amounts due hereunder or for breach of any terms of this agreement/note;',
            style: TextStyle(
              color: Color(0xFF4A5568),
              fontSize: 13,
              fontWeight: FontWeight.w400,
              height: 1.5,
            ),
          ),
          const SizedBox(height: 12),
          const Text(
            '11. The borrower agrees to pay a service fee of <b>One percent (1%)</b> of the loaned amount.',
            style: TextStyle(
              color: Color(0xFF4A5568),
              fontSize: 13,
              fontWeight: FontWeight.w400,
              height: 1.5,
            ),
          ),
          const SizedBox(height: 12),
          const Text(
            '12. Violation from the Terms and Conditions shall make the Loan <b>DUE and DEMANDABLE</b>.',
            style: TextStyle(
              color: Color(0xFF4A5568),
              fontSize: 13,
              fontWeight: FontWeight.w400,
              height: 1.5,
            ),
          ),
        ],
      ),
    );
  }
}

class AgreementCheckbox extends StatelessWidget {
  final String label;
  final bool value;
  final ValueChanged<bool?> onChanged;

  const AgreementCheckbox({
    super.key,
    required this.label,
    required this.value,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppTheme.spacingL),
      decoration: BoxDecoration(
        color: AppTheme.cardWhite,
        borderRadius: BorderRadius.circular(16),
        boxShadow: AppTheme.cardShadow,
      ),
      child: Row(
        children: [
          Checkbox(
            value: value,
            onChanged: onChanged,
            activeColor: AppTheme.primaryGreen,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(4),
            ),
          ),
          const SizedBox(width: AppTheme.spacingM),
          Expanded(
            child: Text(
              label,
              style: const TextStyle(
                color: Color(0xFF183A24),
                fontSize: 14,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class PrimaryButton extends StatelessWidget {
  final bool isEnabled;
  final VoidCallback? onPressed;

  const PrimaryButton({super.key, required this.isEnabled, this.onPressed});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      height: 52,
      child: ElevatedButton(
        onPressed: onPressed,
        style: ElevatedButton.styleFrom(
          backgroundColor: isEnabled
              ? AppTheme.primaryGreen
              : const Color(0xFFB8C4B8),
          foregroundColor: Colors.white,
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
        ),
        child: const Text(
          'Send OTP to Continue',
          style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        ),
      ),
    );
  }
}
