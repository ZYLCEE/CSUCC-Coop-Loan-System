import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:flutter/foundation.dart';
import '../security/quick_access_controller.dart';
import 'member_activity_service.dart';

class SupabaseService {
  static final SupabaseService _instance = SupabaseService._internal();
  factory SupabaseService() => _instance;
  SupabaseService._internal();

  SupabaseClient get client => Supabase.instance.client;

  bool get isAuthenticated => client.auth.currentSession != null;

  Future<Map<String, dynamic>> _invokeMemberAuth(
    Map<String, dynamic> body,
  ) async {
    try {
      final response = await client.functions.invoke('member-auth', body: body);
      final data = response.data;
      if (data is! Map) {
        throw StateError('The login server returned an invalid response.');
      }
      if (data['error'] is String) throw StateError(data['error'] as String);
      return Map<String, dynamic>.from(data);
    } on FunctionException catch (error) {
      final details = error.details;
      if (details is Map && details['error'] is String) {
        throw StateError(details['error'] as String);
      }
      throw StateError(
        'Cannot connect to the member login server. Please try again.',
      );
    }
  }

  Future<bool> signInWithMemberId({
    required String memberId,
    required String password,
  }) async {
    final data = await _invokeMemberAuth({
      'mode': 'login',
      'memberId': memberId.trim().toUpperCase(),
      'password': password,
    });
    final refreshToken = data['refreshToken'];
    if (refreshToken is! String ||
        refreshToken.isEmpty ||
        data['mustChangePassword'] is! bool) {
      throw StateError('The login server returned an invalid session.');
    }
    final response = await client.auth.setSession(refreshToken);
    if (response.session == null || response.user == null) {
      throw StateError(
        'Unable to start your member session. Please sign in again.',
      );
    }
    final mustChangePassword = data['mustChangePassword'] as bool;
    await QuickAccessController.instance.activateAfterPasswordLogin(
      mustChangePassword: mustChangePassword,
    );
    return mustChangePassword;
  }

  Future<bool> signInWithMemberEmail({
    required String email,
    required String password,
  }) async {
    final response = await client.auth.signInWithPassword(
      email: email,
      password: password,
    );
    try {
      final user = response.user;
      if (response.session == null ||
          user == null ||
          user.appMetadata['role'] != 'member') {
        throw StateError('Sign in with an active member account.');
      }
      final member = await client
          .from('members')
          .select('status, must_change_password')
          .eq('user_id', user.id)
          .maybeSingle();
      if (member?['status'] != 'active') {
        throw StateError('Sign in with an active member account.');
      }
      final mustChangePassword = member?['must_change_password'] == true;
      await QuickAccessController.instance.activateAfterPasswordLogin(
        mustChangePassword: mustChangePassword,
      );
      return mustChangePassword;
    } catch (_) {
      await client.auth.signOut(scope: SignOutScope.local);
      rethrow;
    }
  }

  Future<void> changeMemberPassword(String password) async {
    if (!isAuthenticated) {
      throw StateError('Please sign in before changing your password.');
    }
    final data = await _invokeMemberAuth({
      'mode': 'change-password',
      'password': password,
    });
    if (data['success'] != true) {
      throw StateError('Unable to complete the password change.');
    }
    final refreshToken = data['refreshToken'];
    if (refreshToken is! String || refreshToken.isEmpty) {
      throw StateError(
        'Your password was updated. Please sign in again with your new password.',
      );
    }
    await client.auth.setSession(refreshToken);
    await QuickAccessController.instance.activateAfterPasswordLogin(
      mustChangePassword: false,
    );
  }

  Future<void> signIn({required String email, required String password}) async {
    final response = await client.auth.signInWithPassword(
      email: email,
      password: password,
    );
    if (response.user == null) {
      throw Exception('Sign in failed');
    }
  }

  Future<void> signUp({
    required String email,
    required String password,
    Map<String, dynamic>? metadata,
  }) async {
    final response = await client.auth.signUp(
      email: email,
      password: password,
      data: metadata,
    );
    if (response.user == null) {
      throw Exception('Sign up failed');
    }
  }

  Future<void> signOut() async {
    await MemberActivityService.instance.logout();
    await client.auth.signOut();
    await QuickAccessController.instance.clearAfterSignOut();
  }

  Future<void> sendOtp({required String email}) async {
    final normalizedEmail = email.trim();
    if (normalizedEmail.isEmpty) {
      throw StateError(
        'This account has no email address. Contact the cooperative admin.',
      );
    }
    try {
      await client.auth.signInWithOtp(
        email: normalizedEmail,
        shouldCreateUser: false,
      );
    } on AuthException catch (error) {
      final message = error.message.toLowerCase();
      if (message.contains('rate limit') ||
          message.contains('too many requests')) {
        throw StateError(
          'Supabase has temporarily rate-limited email requests. Wait a minute, then resend the code.',
        );
      }
      if (message.contains('email not confirmed')) {
        throw StateError(
          'The registered email is not confirmed in Supabase Auth. Ask the cooperative admin to check the account.',
        );
      }
      if (message.contains('sending') ||
          message.contains('smtp') ||
          message.contains('email')) {
        throw StateError(
          'Supabase could not send the email. Verify the SMTP host, port, username, app password, sender email, and saved Magic Link OTP template.',
        );
      }
      if (kDebugMode)
        debugPrint('Supabase OTP request failed: ${error.message}');
      throw StateError(
        'Supabase could not send the verification code. Retry or contact the cooperative admin.',
      );
    } catch (error) {
      if (error is StateError) rethrow;
      if (kDebugMode) debugPrint('OTP network request failed: $error');
      throw StateError(
        'Could not connect to Supabase to send the verification code. Check your connection and retry.',
      );
    }
  }

  Future<void> verifyOtp({required String email, required String token}) async {
    await client.auth.verifyOTP(
      email: email,
      token: token,
      type: OtpType.email,
    );
  }
}
