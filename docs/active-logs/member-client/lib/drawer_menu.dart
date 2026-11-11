import 'package:flutter/material.dart';
import 'app_theme.dart';
import 'announcements_screen.dart';
import 'documents_screen.dart';
import 'active_logs_screen.dart';
import 'faq_screen.dart';
import 'contact_us_screen.dart';
import 'about_cooperative_screen.dart';

class AppDrawer extends StatelessWidget {
  const AppDrawer({super.key});

  @override
  Widget build(BuildContext context) {
    return Drawer(
      child: Column(
        children: [
          _buildDrawerHeader(),
          Expanded(
            child: ListView(
              padding: EdgeInsets.zero,
              children: [
                _buildDrawerItem(
                  icon: Icons.campaign_outlined,
                  title: 'Announcements',
                  subtitle: 'Published cooperative updates',
                  onTap: () {
                    Navigator.pop(context);
                    Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const AnnouncementsScreen(),
                      ),
                    );
                  },
                ),
                _buildDrawerItem(
                  icon: Icons.folder_outlined,
                  title: 'Documents',
                  subtitle: 'Your submissions and shared files',
                  onTap: () {
                    Navigator.pop(context);
                    Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const DocumentsScreen(),
                      ),
                    );
                  },
                ),
                _buildDrawerItem(
                  icon: Icons.history_outlined,
                  title: 'Active Logs',
                  subtitle: 'Your successful sessions and activity',
                  onTap: () {
                    Navigator.pop(context);
                    Navigator.push(context, MaterialPageRoute(builder: (_) => const ActiveLogsScreen()));
                  },
                ),
                _buildDrawerItem(
                  icon: Icons.help_outline,
                  title: 'FAQ',
                  subtitle: 'Frequently Asked Questions',
                  onTap: () {
                    Navigator.push(
                      context,
                      MaterialPageRoute(builder: (_) => const FAQScreen()),
                    );
                  },
                ),
                _buildDrawerItem(
                  icon: Icons.call_outlined,
                  title: 'Contact Us',
                  subtitle: 'Cooperative Information',
                  onTap: () {
                    Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const ContactUsScreen(),
                      ),
                    );
                  },
                ),
                _buildDrawerItem(
                  icon: Icons.apartment,
                  title: 'About the Cooperative',
                  subtitle: 'Mission, Vision, and Background',
                  onTap: () {
                    Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const AboutCooperativeScreen(),
                      ),
                    );
                  },
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDrawerHeader() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppTheme.spacingXL),
      decoration: const BoxDecoration(color: AppTheme.primaryGreen),
      child: Column(
        children: [
          Image.asset(
            'assets/csucc-logo.png',
            width: 70,
            height: 70,
            fit: BoxFit.contain,
          ),
          const SizedBox(height: AppTheme.spacingL),
          const Text.rich(
            TextSpan(
              children: [
                TextSpan(
                  text: 'CSUCC',
                  style: TextStyle(color: Color(0xFFFFD817)),
                ),
                TextSpan(
                  text: 'ERMPC',
                  style: TextStyle(color: Colors.white),
                ),
              ],
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: AppTheme.spacingS),
          Text(
            'Serving members with integrity.',
            style: TextStyle(
              color: AppTheme.lightGrayGreen,
              fontSize: 13,
              fontWeight: FontWeight.w400,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDrawerItem({
    required IconData icon,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
  }) {
    return ListTile(
      leading: Icon(icon, color: AppTheme.primaryGreen, size: 24),
      title: Text(
        title,
        style: const TextStyle(
          color: AppTheme.primaryText,
          fontSize: 15,
          fontWeight: FontWeight.w600,
        ),
      ),
      subtitle: Text(
        subtitle,
        style: const TextStyle(
          color: AppTheme.mutedGray,
          fontSize: 12,
          fontWeight: FontWeight.w400,
        ),
      ),
      trailing: const Icon(
        Icons.chevron_right,
        color: AppTheme.mutedGray,
        size: 20,
      ),
      onTap: onTap,
    );
  }
}
