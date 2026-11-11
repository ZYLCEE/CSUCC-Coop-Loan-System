import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:coop_frontend/active_logs_screen.dart';

void main() {
  testWidgets(
    'member view uses own-activity reader with filters, canonical IDs and mobile details',
    (tester) async {
      final queries = <Map<String, dynamic>>[];
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MaterialApp(
          home: ActiveLogsScreen(
            enableRealtime: false,
            loadPage: (filters) async {
              queries.add(filters);
              return {
                'rows': [
                  {
                    'id': 'synthetic',
                    'accountNumber': '2026-0005',
                    'name': 'Synthetic Member',
                    'role': 'member',
                    'action': 'Login',
                    'browser': null,
                    'os': 'Android',
                    'timeIn': '2026-11-11T08:00:00Z',
                    'timeOut': null,
                    'sessionState': 'active',
                    'ipAddress': null,
                    'details': 'Synthetic member signed in.',
                  },
                ],
                'total': 1,
                'page': 1,
                'pageSize': 10,
              };
            },
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('Only your own activity'), findsOneWidget);
      expect(find.text('Member'), findsOneWidget);
      await tester.tap(find.text('Activity details'));
      await tester.pumpAndSettle();
      expect(find.text('CSUCC-2026-0005'), findsOneWidget);
      expect(find.text('Active'), findsOneWidget);
      await tester.enterText(find.byType(TextField), 'Login');
      await tester.pump(const Duration(milliseconds: 350));
      await tester.pumpAndSettle();
      expect(queries.last['p_search'], 'Login');
      expect(queries.last['p_role'], '');
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
