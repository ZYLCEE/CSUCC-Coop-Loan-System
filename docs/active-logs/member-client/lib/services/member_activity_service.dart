import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

typedef MemberSessionSender =
    Future<Map<String, dynamic>> Function(
      String operation,
      int idleSeconds,
      String? os,
    );

/// The database derives the member and Auth-session identity from the JWT.
/// Only admitted portal entry and real interactions renew this activity session.
class MemberActivityService extends ChangeNotifier {
  MemberActivityService({
    MemberSessionSender? send,
    String? Function()? sessionKey,
    DateTime Function()? clock,
    this.pollInterval = const Duration(seconds: 30),
  }) : _send = send ?? _sendToServer,
       _sessionKey = sessionKey ?? _currentSessionKey,
       _clock = clock ?? DateTime.now;
  static final instance = MemberActivityService();
  final MemberSessionSender _send;
  final String? Function() _sessionKey;
  final DateTime Function() _clock;
  final Duration pollInterval;
  Timer? _timer;
  Future<void>? _pending;
  String? _key;
  DateTime? _lastInteraction;
  DateTime? _lastSync;
  int _generation = 0, _interaction = 0, _sent = 0;
  bool requested = false, ready = false, ended = false, foreground = true;
  String? error;

  static String? _currentSessionKey() {
    final client = Supabase.instance.client;
    if (client.auth.currentUser?.appMetadata['role'] != 'member') return null;
    final jwt = client.auth.currentSession?.accessToken;
    if (jwt == null) return null;
    try {
      final payload = jsonDecode(
        utf8.decode(base64Url.decode(base64Url.normalize(jwt.split('.')[1]))),
      );
      return payload['session_id'] as String?;
    } catch (_) {
      return null;
    }
  }

  static Future<Map<String, dynamic>> _sendToServer(
    String operation,
    int idleSeconds,
    String? os,
  ) async {
    final result = await Supabase.instance.client.rpc(
      'member_log_session',
      params: {
        'p_operation': operation,
        'p_idle_seconds': idleSeconds,
        'p_device_os': os,
      },
    );
    return Map<String, dynamic>.from(result as Map);
  }

  String? get _os => switch (defaultTargetPlatform) {
    TargetPlatform.android => 'Android',
    TargetPlatform.iOS => 'iOS',
    TargetPlatform.macOS => 'macOS',
    TargetPlatform.windows => 'Windows',
    TargetPlatform.linux => 'Linux',
    _ => null,
  };
  void interaction() {
    if (!requested || ended || !foreground) return;
    final wasQuiet =
        _lastInteraction == null ||
        _clock().difference(_lastInteraction!).inSeconds >= 30;
    _lastInteraction = _clock();
    _interaction++;
    // Send the first interaction after a quiet period promptly; background
    // polling itself never extends idle time.
    if (ready &&
        _pending == null &&
        (wasQuiet ||
            _lastSync == null ||
            _clock().difference(_lastSync!).inSeconds >= 15)) {
      unawaited(check().catchError((_) {}));
    }
  }

  Future<void> start() {
    final key = _sessionKey();
    if (key == null) {
      return Future.error(StateError('Sign in with your member account.'));
    }
    if (_key != key) {
      reset();
      _key = key;
      _lastInteraction = _clock();
    }
    final opening = !requested;
    requested = true;
    if (opening) notifyListeners();
    _timer ??= Timer.periodic(pollInterval, (_) {
      if (foreground) {
        unawaited(check().catchError((_) {}));
      }
    });
    return check();
  }

  Future<void> check() {
    if (ended) {
      return Future.error(StateError('Your session ended. Sign in again.'));
    }
    if (_key == null || _sessionKey() != _key) {
      reset();
      return Future.value();
    }
    if (_pending != null) return _pending!;
    final generation = _generation, version = _interaction;
    _lastSync = _clock();
    final operation = ready && version != _sent ? 'touch' : 'start';
    final idle = _lastInteraction == null
        ? 0
        : _clock().difference(_lastInteraction!).inSeconds.clamp(0, 86400);
    final task = () async {
      try {
        final result = await _send(operation, idle, _os);
        if (generation != _generation) return;
        if (result['expired'] == true) {
          ended = true;
          ready = false;
          _timer?.cancel();
          throw StateError(
            'Your session ended after inactivity. Sign in again.',
          );
        }
        ready = true;
        error = null;
        _sent = version;
      } catch (failure) {
        if (generation != _generation) return;
        if (failure is PostgrestException && failure.code == '42501') {
          ended = true;
          ready = false;
          _timer?.cancel();
        }
        error = ended
            ? 'Your session ended. Sign in again.'
            : 'Activity tracking is unavailable. Please retry.';
        rethrow;
      } finally {
        if (generation == _generation) {
          _pending = null;
          notifyListeners();
        }
      }
    }();
    _pending = task;
    return task;
  }

  Future<void> logout() async {
    // Finish an in-flight opening request before recording this session's exit.
    try {
      await _pending;
    } catch (_) {}
    try {
      if (ready && !ended) await _send('logout', 0, _os);
    } catch (_) {}
    reset();
  }

  void reset() {
    _generation++;
    _timer?.cancel();
    _timer = null;
    _pending = null;
    _key = null;
    requested = false;
    ready = false;
    ended = false;
    error = null;
    _interaction = 0;
    _sent = 0;
    _lastInteraction = null;
    _lastSync = null;
    notifyListeners();
  }

  @override
  void dispose() {
    _generation++;
    _timer?.cancel();
    super.dispose();
  }
}
