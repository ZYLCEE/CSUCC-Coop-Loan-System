import 'dart:async';
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'services/member_activity_service.dart';
import 'services/supabase_service.dart';
import 'loginscreen.dart';

class MemberActivityBoundary extends StatefulWidget {
  const MemberActivityBoundary({
    super.key,
    required this.child,
    required this.navigatorKey,
  });
  final Widget child;
  final GlobalKey<NavigatorState> navigatorKey;
  @override
  State<MemberActivityBoundary> createState() => _MemberActivityBoundaryState();
}

class _MemberActivityBoundaryState extends State<MemberActivityBoundary>
    with WidgetsBindingObserver {
  final _activity = MemberActivityService.instance;
  StreamSubscription<AuthState>? _auth;
  bool _redirecting = false;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _activity.addListener(_changed);
    _auth = Supabase.instance.client.auth.onAuthStateChange.listen((state) {
      if (state.session == null) scheduleMicrotask(_activity.reset);
    });
  }

  void _changed() {
    if (!mounted) return;
    if (_activity.ended && !_redirecting) {
      _redirecting = true;
      scheduleMicrotask(() async {
        try {
          await SupabaseService().signOut();
        } catch (_) {
          if (mounted) {
            _redirecting = false;
            setState(() {});
          }
          return;
        }
        if (!mounted) return;
        widget.navigatorKey.currentState?.pushAndRemoveUntil(
          MaterialPageRoute(
            builder: (_) => const LoginScreen(
              notice: 'Your session ended. Please sign in again.',
            ),
          ),
          (_) => false,
        );
        _redirecting = false;
      });
    }
    setState(() {});
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _activity.foreground = state == AppLifecycleState.resumed;
    if (_activity.foreground && _activity.requested) {
      unawaited(_activity.check().catchError((_) {}));
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _activity.removeListener(_changed);
    unawaited(_auth?.cancel());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final waiting = _activity.requested && !_activity.ready;
    return Listener(
      behavior: HitTestBehavior.translucent,
      onPointerDown: (_) => _activity.interaction(),
      onPointerSignal: (_) => _activity.interaction(),
      child: Focus(
        canRequestFocus: false,
        onKeyEvent: (_, _) {
          _activity.interaction();
          return KeyEventResult.ignored;
        },
        child: Stack(
          fit: StackFit.expand,
          children: [
            ExcludeFocus(
              excluding: waiting,
              child: IgnorePointer(ignoring: waiting, child: widget.child),
            ),
            if (waiting)
              Material(
                color: Theme.of(context).scaffoldBackgroundColor,
                child: Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          _activity.error ?? 'Opening your member session…',
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: 16),
                        if (_activity.error == null)
                          const CircularProgressIndicator()
                        else
                          FilledButton(
                            onPressed: () {
                              if (_activity.ended) {
                                _redirecting = false;
                                _changed();
                              } else {
                                unawaited(_activity.start().catchError((_) {}));
                              }
                            },
                            child: Text(
                              _activity.ended ? 'Sign in again' : 'Retry',
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
