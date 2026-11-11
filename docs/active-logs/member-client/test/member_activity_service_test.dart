import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:coop_frontend/services/member_activity_service.dart';

void main() {
  test(
    'activity shortly before idle expiry is sent before the next periodic check',
    () async {
      var time = DateTime.utc(2026, 11, 11);
      DateTime? expires;
      final service = MemberActivityService(
        sessionKey: () => 'verified-session',
        clock: () => time,
        pollInterval: const Duration(days: 1),
        send: (operation, idle, _) async {
          if (expires != null && !time.isBefore(expires!)) {
            return {'expired': true};
          }
          if (operation == 'touch' || expires == null) {
            expires = time
                .subtract(Duration(seconds: idle))
                .add(const Duration(minutes: 15));
          }
          return {'id': 'tracked'};
        },
      );
      addTearDown(service.dispose);
      await service.start();
      time = time.add(const Duration(minutes: 14, seconds: 30));
      await service.check();
      time = time.add(const Duration(seconds: 1));
      service.interaction();
      await service.check();
      time = time.add(const Duration(seconds: 30));
      await service.check();
      expect(service.ready, isTrue);
      expect(service.ended, isFalse);
    },
  );
  test(
    'background checks do not renew idle time, interactions do, and expiry cannot reopen',
    () async {
      final calls = <String>[];
      var time = DateTime.utc(2026, 11, 11), expire = false;
      final service = MemberActivityService(
        sessionKey: () => 'verified-session',
        clock: () => time,
        pollInterval: const Duration(days: 1),
        send: (operation, idle, os) async {
          calls.add('$operation:$idle');
          return expire ? {'expired': true} : {'id': 'tracked'};
        },
      );
      addTearDown(service.dispose);
      await service.start();
      expect(service.ready, isTrue);
      time = time.add(const Duration(seconds: 30));
      await service.check();
      expect(calls, ['start:0', 'start:30']);
      time = time.add(const Duration(seconds: 30));
      service.interaction();
      await service.check();
      expect(calls.last, 'touch:0');
      expire = true;
      time = time.add(const Duration(minutes: 16));
      await expectLater(service.check(), throwsStateError);
      expect(service.ended, isTrue);
      final count = calls.length;
      await expectLater(service.start(), throwsStateError);
      expect(calls.length, count);
    },
  );
  test(
    'signout closes only an opened session and retry does not invent successful activity',
    () async {
      final calls = <String>[];
      var fail = true;
      final service = MemberActivityService(
        sessionKey: () => 'verified-session',
        pollInterval: const Duration(days: 1),
        send: (operation, _, _) async {
          calls.add(operation);
          if (fail) throw StateError('Offline');
          return {'id': 'tracked'};
        },
      );
      addTearDown(service.dispose);
      await expectLater(service.start(), throwsStateError);
      expect(service.ready, isFalse);
      fail = false;
      await service.start();
      await service.logout();
      expect(calls, ['start', 'start', 'logout']);
      expect(service.requested, isFalse);
    },
  );
  test(
    'a response from a previous Auth session cannot open the next account',
    () async {
      var key = 'first';
      final pending = Completer<Map<String, dynamic>>();
      final service = MemberActivityService(
        sessionKey: () => key,
        pollInterval: const Duration(days: 1),
        send: (_, _, _) => pending.future,
      );
      addTearDown(service.dispose);
      final opening = service.start();
      key = 'next';
      service.reset();
      pending.complete({'id': 'old'});
      await opening;
      expect(service.ready, isFalse);
      expect(service.requested, isFalse);
    },
  );
}
