import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'splashscreen.dart';
import 'security/device_security_service.dart';
import 'security/screenshot_protection.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await dotenv.load(fileName: '.env');
  await Supabase.initialize(
    url: dotenv.env['SUPABASE_URL']!,
    anonKey: dotenv.env['SUPABASE_ANON_KEY']!,
  );
  runApp(const MyApp());
  unawaited(_reportDeviceSecurityStatus());
}

Future<void> _reportDeviceSecurityStatus() async {
  final status = await DeviceSecurityService().check();
  if (kDebugMode) {
    debugPrint(status.debugSummary);
  }
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'CSUCCERMPC',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF1A5E38)),
      ),
      builder: (context, child) =>
          ScreenshotProtection(child: child ?? const SizedBox.shrink()),
      home: const Splashscreen(),
    );
  }
}
