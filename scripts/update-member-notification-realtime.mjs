import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
const target=resolve("../coop_frontend_client/lib/bellicon.dart");
let source=readFileSync(target,"utf8").replaceAll("\r\n","\n");
const replace=(from,to)=>{if(!source.includes(from))throw new Error("Member notification source changed; inspect before applying.");source=source.replace(from,()=>to);};
replace("import 'package:flutter/material.dart';","import 'dart:async';\n\nimport 'package:flutter/material.dart';");
replace("class _NotificationsScreenState extends State<NotificationsScreen> {","class _NotificationsScreenState extends State<NotificationsScreen>\n    with WidgetsBindingObserver {");
replace("  String? _error;","  String? _error;\n  RealtimeChannel? _notificationChannel;\n  Timer? _refreshDebounce;\n  Timer? _refreshFallback;\n  int _loadGeneration = 0;");
replace("    super.initState();\n    _loadNotifications();","    super.initState();\n    WidgetsBinding.instance.addObserver(this);\n    _loadNotifications();\n    _listenForNotificationChanges();\n    _refreshFallback = Timer.periodic(const Duration(seconds: 30), (_) {\n      final lifecycle = WidgetsBinding.instance.lifecycleState;\n      if (lifecycle == null || lifecycle == AppLifecycleState.resumed) {\n        _queueNotificationRefresh();\n      }\n    });");
const methods=[
"  void _listenForNotificationChanges() {",
"    final client = Supabase.instance.client;",
"    final user = client.auth.currentUser;",
"    if (user == null) return;",
"    final filter = PostgresChangeFilter(",
"      type: PostgresChangeFilterType.eq,",
"      column: 'user_id',",
"      value: user.id,",
"    );",
"    _notificationChannel = client",
"        .channel('member-notifications-${user.id}-${identityHashCode(this)}')",
"        .onPostgresChanges(",
"          event: PostgresChangeEvent.insert,",
"          schema: 'public',",
"          table: 'notifications',",
"          filter: filter,",
"          callback: (_) => _queueNotificationRefresh(),",
"        )",
"        .onPostgresChanges(",
"          event: PostgresChangeEvent.update,",
"          schema: 'public',",
"          table: 'notifications',",
"          filter: filter,",
"          callback: (_) => _queueNotificationRefresh(),",
"        )",
"        .subscribe();",
"  }",
"",
"  void _queueNotificationRefresh() {",
"    if (!mounted) return;",
"    _refreshDebounce?.cancel();",
"    _refreshDebounce = Timer(const Duration(milliseconds: 200), () {",
"      if (mounted) _loadNotifications(background: true);",
"    });",
"  }",
"",
"  @override",
"  void didChangeAppLifecycleState(AppLifecycleState state) {",
"    if (state == AppLifecycleState.resumed) _queueNotificationRefresh();",
"  }",
"",
"  @override",
"  void dispose() {",
"    _loadGeneration++;",
"    _refreshDebounce?.cancel();",
"    _refreshFallback?.cancel();",
"    WidgetsBinding.instance.removeObserver(this);",
"    final channel = _notificationChannel;",
"    if (channel != null) {",
"      unawaited(Supabase.instance.client.removeChannel(channel).then<void>((_) {}));",
"    }",
"    super.dispose();",
"  }",
"",
].join("\n");
replace("  Future<void> _loadNotifications() async {\n    setState(() {\n      _loading = true;\n      _error = null;\n    });",methods+"\n  Future<void> _loadNotifications({bool background = false}) async {\n    if (!mounted) return;\n    final generation = ++_loadGeneration;\n    if (!background) {\n      setState(() {\n        _loading = true;\n        _error = null;\n      });\n    }");
replace("      if (!mounted) return;\n      setState(\n        () => _notifications = rows.map(NotificationItem.fromDatabase).toList(),\n      );","      if (!mounted || generation != _loadGeneration) return;\n      if (Supabase.instance.client.auth.currentUser?.id != user.id) {\n        setState(() => _notifications = []);\n        return;\n      }\n      setState(() {\n        _notifications = rows.map(NotificationItem.fromDatabase).toList();\n        _error = null;\n      });");
replace("    } catch (error) {\n      if (!mounted) return;","    } catch (error) {\n      if (!mounted || generation != _loadGeneration) return;");
replace("      if (mounted) setState(() => _loading = false);","      if (mounted && generation == _loadGeneration) {\n        setState(() => _loading = false);\n      }");
writeFileSync(target,source);console.log("Updated the member notification screen with recipient-scoped realtime, foreground refresh and subscription cleanup.");
