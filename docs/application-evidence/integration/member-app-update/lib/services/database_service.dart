import 'package:supabase_flutter/supabase_flutter.dart';
import '../loan_application_mode.dart';
import '../models/loan_document.dart';
import '../models/loan_consent_submission.dart';
import '../models/loan_policy.dart';
import 'loan_document_upload_service.dart';

class DatabaseService {
  static final DatabaseService _instance = DatabaseService._internal();
  factory DatabaseService() => _instance;
  DatabaseService._internal();

  final _supabase = Supabase.instance.client;

  Future<LoanPolicySettings> getLoanPolicySettings() async {
    final response = await _supabase
        .from('loan_policy_settings')
        .select()
        .eq('singleton', true)
        .single();
    return LoanPolicySettings.fromMap(Map<String, dynamic>.from(response));
  }

  // Members operations
  Future<Map<String, dynamic>> getMember(String userId) async {
    final response = await _supabase
        .from('members')
        .select()
        .eq('user_id', userId)
        .single();
    return response;
  }

  Future<List<Map<String, dynamic>>> getAllMembers() async {
    final response = await _supabase.from('members').select();
    return response;
  }

  // Loan applications operations
  Future<List<Map<String, dynamic>>> getLoanApplications(String userId) async {
    late final Map<String, dynamic> member;
    try {
      member = await getMember(userId);
    } catch (_) {
      throw const LoanHistoryLoadException('member account link');
    }

    try {
      final response = await _supabase
          .from('loan_applications')
          .select()
          .eq('member_id', member['id'])
          .order('date_submitted', ascending: false);
      final applications = List<Map<String, dynamic>>.from(response);
      if (applications.isEmpty) return applications;

      final applicationIds = applications
          .map((application) => application['id'])
          .whereType<String>()
          .toList();
      try {
        final paymentRows = await _supabase
            .from('loan_payments')
            .select('loan_application_id, payment_amount, payment_date')
            .inFilter('loan_application_id', applicationIds);
        final paymentsByApplication = <String, List<Map<String, dynamic>>>{};
        for (final row in List<Map<String, dynamic>>.from(paymentRows)) {
          final applicationId = row['loan_application_id'] as String?;
          if (applicationId == null) continue;
          paymentsByApplication
              .putIfAbsent(applicationId, () => <Map<String, dynamic>>[])
              .add(row);
        }
        return applications
            .map(
              (application) => {
                ...application,
                'loan_payments':
                    paymentsByApplication[application['id']] ??
                    <Map<String, dynamic>>[],
              },
            )
            .toList();
      } catch (_) {
        // Payment summaries are optional; keep loan selection/history available.
        return applications
            .map((application) => {...application, 'loan_payments': null})
            .toList();
      }
    } catch (_) {
      throw const LoanHistoryLoadException('loan records');
    }
  }

  Future<List<Map<String, dynamic>>> getMemberLoanDetails() async {
    final user = _supabase.auth.currentUser;
    if (user == null) throw StateError('Sign in to view your loan details.');
    final member = await getMember(user.id);
    final rows = await _supabase
        .from('loan_applications')
        .select(
          '*, members(member_id,first_name,last_name), loan_payments(payment_amount,payment_date)',
        )
        .eq('member_id', member['id'])
        .inFilter('status', ['approved', 'released', 'overdue', 'completed'])
        .order('date_submitted', ascending: false);
    return List<Map<String, dynamic>>.from(rows);
  }

  Future<Map<String, dynamic>> getLoanApplication(String applicationId) async {
    final response = await _supabase
        .from('loan_applications')
        .select('*, members(member_id, first_name, last_name)')
        .eq('application_id', applicationId)
        .single();
    return response;
  }

  Future<void> createLoanApplication(Map<String, dynamic> data) async {
    requireLiveLoanOperations();
    await _supabase.from('loan_applications').insert(data);
  }

  Future<void> submitLoanApplication({
    required String applicationId,
    required String loanType,
    required double amount,
    required List<SelectedLoanDocument> documents,
    required int tenureMonths,
    LoanConsentSubmission? consent,
    void Function(String)? onProgress,
    bool participantsDemo = false,
  }) async {
    requireLiveLoanOperations(participantsDemo: participantsDemo);
    await LoanDocumentUploadService(client: _supabase).submit(
      applicationId: applicationId,
      loanType: loanType,
      amount: amount,
      documents: documents,
      tenureMonths: tenureMonths,
      consent: consent,
      onProgress: onProgress,
      participantsDemo: participantsDemo,
    );
  }

  Future<void> updateLoanApplication(
    String applicationId,
    Map<String, dynamic> data,
  ) async {
    await _supabase
        .from('loan_applications')
        .update(data)
        .eq('application_id', applicationId);
  }

  // Loan payments operations
  Future<List<Map<String, dynamic>>> getLoanPayments(
    String loanApplicationId,
  ) async {
    final response = await _supabase
        .from('loan_payments')
        .select()
        .eq('loan_application_id', loanApplicationId)
        .order('payment_date', ascending: false);
    return response;
  }

  Future<void> createLoanPayment(Map<String, dynamic> data) async {
    await _supabase.from('loan_payments').insert(data);
  }

  // Savings accounts operations
  Future<List<Map<String, dynamic>>> getSavingsAccounts(String userId) async {
    final member = await getMember(userId);
    final response = await _supabase
        .from('savings_accounts')
        .select('*, members(member_id, first_name, last_name)')
        .eq('member_id', member['id']);
    return response;
  }

  Future<Map<String, dynamic>> getSavingsAccount(String accountNumber) async {
    final response = await _supabase
        .from('savings_accounts')
        .select('*, members(member_id, first_name, last_name)')
        .eq('account_number', accountNumber)
        .single();
    return response;
  }

  // Notifications operations
  Future<List<Map<String, dynamic>>> getNotifications(String userId) async {
    final response = await _supabase
        .from('notifications')
        .select()
        .eq('user_id', userId)
        .order('created_at', ascending: false);
    return response;
  }

  Future<void> markNotificationAsRead(String notificationId) async {
    await _supabase
        .from('notifications')
        .update({'read': true})
        .eq('id', notificationId);
  }

  Future<void> markAllNotificationsAsRead(String userId) async {
    await _supabase
        .from('notifications')
        .update({'read': true})
        .eq('user_id', userId);
  }

  // Database function calls
  Future<Map<String, dynamic>> checkLoanEligibility({
    required String memberId,
    required String loanType,
    required double amount,
  }) async {
    final response = await _supabase.functions.invoke(
      'loan-eligibility',
      body: {'member_id': memberId, 'loan_type': loanType, 'amount': amount},
    );
    final data = response.data;
    if (data is Map<String, dynamic>) return data;
    if (data is Map) return Map<String, dynamic>.from(data);
    throw StateError(
      'Loan eligibility service returned an unexpected response.',
    );
  }

  Future<List<Map<String, dynamic>>> calculatePaymentSchedule({
    required double loanAmount,
    required double interestRate,
    required int termMonths,
  }) async {
    final response = await _supabase.rpc(
      'calculate_payment_schedule',
      params: {
        'p_loan_amount': loanAmount,
        'p_interest_rate': interestRate,
        'p_term_months': termMonths,
      },
    );
    return response;
  }

  // Edge function calls
  Future<FunctionResponse> processLoanApproval({
    required String applicationId,
    required String approvedBy,
    String? notes,
  }) async {
    final response = await _supabase.functions.invoke(
      'loan-approval',
      body: {
        'application_id': applicationId,
        'approved_by': approvedBy,
        'notes': notes,
      },
    );
    return response;
  }

  Future<FunctionResponse> releaseLoan({required String applicationId}) async {
    final response = await _supabase.functions.invoke(
      'loan-release',
      body: {'application_id': applicationId},
    );
    return response;
  }

  Future<void> sendNotification({
    required String userId,
    required String title,
    required String message,
    String type = 'info',
  }) async {
    await _supabase.functions.invoke(
      'notifications',
      body: {
        'user_id': userId,
        'title': title,
        'message': message,
        'type': type,
      },
    );
  }
}

class LoanHistoryLoadException implements Exception {
  const LoanHistoryLoadException(this.stage);

  final String stage;
}
