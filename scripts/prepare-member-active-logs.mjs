import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve('../coop_frontend_client'),stage=resolve('docs/active-logs/member-client'),manifest=[];
function edit(path,changes){let source=readFileSync(resolve(root,path),'utf8');const hash=createHash('sha256').update(source).digest('hex');for(const [before,after] of changes){if(source.split(before).length!==2)throw Error('Ambiguous edit: '+path+' '+before);source=source.replace(before,after);}const target=resolve(stage,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,source);manifest.push({path,originalSha256:hash});}
edit('lib/main.dart',[
 ["import 'splashscreen.dart';","import 'splashscreen.dart';\nimport 'member_activity_boundary.dart';"],
 ["void main() async {","final _memberNavigatorKey = GlobalKey<NavigatorState>();\n\nvoid main() async {"],
 ["title: 'CSUCCERMPC',","title: 'CSUCCERMPC',\n      navigatorKey: _memberNavigatorKey,"],
 ["anonKey: dotenv.env['SUPABASE_ANON_KEY']!","publishableKey: dotenv.env['SUPABASE_ANON_KEY']!"],
 ["ScreenshotProtection(child: child ?? const SizedBox.shrink())","ScreenshotProtection(child: MemberActivityBoundary(navigatorKey: _memberNavigatorKey, child: child ?? const SizedBox.shrink()))"],
]);
edit('lib/dashboard.dart',[
 ["import 'services/database_service.dart';","import 'services/database_service.dart';\nimport 'services/member_activity_service.dart';"],
 ["    _loadData();","    _loadData();\n    scheduleMicrotask(() { if (mounted) unawaited(MemberActivityService.instance.start().catchError((_) {})); });"],
]);
edit('lib/services/supabase_service.dart',[
 ["import '../security/quick_access_controller.dart';","import '../security/quick_access_controller.dart';\nimport 'member_activity_service.dart';"],
 ["  Future<void> signOut() async {\n    await client.auth.signOut();","  Future<void> signOut() async {\n    await MemberActivityService.instance.logout();\n    await client.auth.signOut();"],
]);
edit('lib/drawer_menu.dart',[
 ["import 'documents_screen.dart';","import 'documents_screen.dart';\nimport 'active_logs_screen.dart';"],
 ["                  icon: Icons.help_outline,","                  icon: Icons.history_outlined,\n                  title: 'Active Logs',\n                  subtitle: 'Your successful sessions and activity',\n                  onTap: () {\n                    Navigator.pop(context);\n                    Navigator.push(context, MaterialPageRoute(builder: (_) => const ActiveLogsScreen()));\n                  },\n                ),\n                _buildDrawerItem(\n                  icon: Icons.help_outline,"],
]);
for(const path of ['lib/services/member_activity_service.dart','lib/member_activity_boundary.dart','lib/active_logs_screen.dart','test/member_activity_service_test.dart','test/active_logs_screen_test.dart'])manifest.push({path,originalSha256:null});
writeFileSync(resolve(stage,'manifest.json'),JSON.stringify({root,files:manifest},null,2));
