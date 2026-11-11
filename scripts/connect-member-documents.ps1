$taskRoot='C:/Users/zylcee/Desktop/COOP/coop_frontend_client'
$drawerPath=Join-Path $taskRoot 'lib/drawer_menu.dart'
$drawer=[IO.File]::ReadAllText($drawerPath).Replace("`r`n","`n")
if(-not $drawer.Contains("import 'documents_screen.dart';")) {
  $drawer=$drawer.Replace("import 'announcements_screen.dart';","import 'announcements_screen.dart';`nimport 'documents_screen.dart';")
  $anchor="                _buildDrawerItem(`n                  icon: Icons.help_outline,"
  if(-not $drawer.Contains($anchor)){throw 'Drawer insertion point changed'}
  $entry=@'
                _buildDrawerItem(
                  icon: Icons.folder_outlined,
                  title: 'Documents',
                  subtitle: 'Your submissions and shared files',
                  onTap: () {
                    Navigator.pop(context);
                    Navigator.push(context, MaterialPageRoute(builder: (_) => const DocumentsScreen()));
                  },
                ),
'@
  $drawer=$drawer.Replace($anchor,$entry+"`n"+$anchor)
  [IO.File]::WriteAllText($drawerPath,$drawer)
}
& 'C:/src/flutter/bin/flutter.bat' pub add url_launcher
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
& 'C:/src/flutter/bin/dart.bat' format lib/documents_screen.dart lib/services/document_center_service.dart lib/drawer_menu.dart
& 'C:/src/flutter/bin/flutter.bat' analyze lib/documents_screen.dart lib/services/document_center_service.dart lib/drawer_menu.dart
exit $LASTEXITCODE
