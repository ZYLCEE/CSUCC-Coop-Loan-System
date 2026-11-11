import 'dart:async';
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'bellicon.dart';
import 'schedtracker.dart';
import 'drawer_menu.dart';
import 'app_bottom_navigation_bar.dart';
import 'loan_calculator_service.dart';
import 'loans_screen.dart';
import 'services/database_service.dart';

class Dashboard extends StatefulWidget {
  const Dashboard({super.key});

  @override
  State<Dashboard> createState() => _DashboardState();
}

class _DashboardState extends State<Dashboard> {
  final int _currentIndex = 0;
  final PageController _advertisementController = PageController();
  Timer? _advertisementTimer;
  int _advertisementIndex = 0;
  final DatabaseService _dbService = DatabaseService();

  Map<String, dynamic>? _userData;
  Map<String, dynamic>? _loanData;
  List<Map<String, dynamic>> _recentActivities = [];
  bool _isLoading = true;

  static const List<String> _advertisements = [
    'assets/adevertise1.png',
    'assets/advertise 2.png',
    'assets/advertise3.png',
  ];

  @override
  void initState() {
    super.initState();
    _loadData();
    _advertisementTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      if (!_advertisementController.hasClients) return;
      _advertisementController.animateToPage(
        (_advertisementIndex + 1) % _advertisements.length,
        duration: const Duration(milliseconds: 350),
        curve: Curves.easeInOut,
      );
    });
  }

  @override
  void dispose() {
    _advertisementTimer?.cancel();
    _advertisementController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    try {
      final user = Supabase.instance.client.auth.currentUser;
      if (user == null) return;

      final memberData = await _dbService.getMember(user.id);
      final loanApplications = await _dbService.getLoanApplications(user.id);

      final activeLoan = loanApplications.isNotEmpty
          ? loanApplications.firstWhere(
              (loan) => const {
                'released',
                'overdue',
              }.contains(LoanEligibility.statusFor(loan)),
              orElse: () => loanApplications.first,
            )
          : null;

      final activities = [
        for (final loan in loanApplications)
          for (final payment in postedLoanPayments(loan))
            {
              'title': 'Loan Payment · ${loan['application_id']}',
              'date': '${payment['payment_date'] ?? ''}',
              'amount': -(double.tryParse('${payment['payment_amount']}') ?? 0),
            },
      ]..sort((a, b) => '${b['date']}'.compareTo('${a['date']}'));

      if (mounted) {
        setState(() {
          _userData = memberData;
          _loanData = activeLoan;
          _recentActivities = activities.take(5).toList();
          _isLoading = false;
        });
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  void _openAvailableLoans() {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => const LoansScreen(hideTabs: true)),
    );
  }

  // Design System Constants
  static const Color _primaryGreen = Color(0xFF206A3B);
  static const Color _headerGreen = Color(0xFF1F6B3A);
  static const Color _accentGold = Color(0xFFC8A64A);
  static const Color _background = Color(0xFFF3F5F4);
  static const Color _cardWhite = Color(0xFFFFFFFF);
  static const Color _textDark = Color(0xFF153D22);
  static const Color _captionGray = Color(0xFF7C8B82);
  static const Color _positiveGreen = Color(0xFF5E9F66);

  static const double _cardBorderRadius = 20.0;
  static const double _buttonBorderRadius = 16.0;
  static const double _pillBorderRadius = 999.0;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _background,
      drawer: const AppDrawer(),
      body: SafeArea(
        child: Column(
          children: [
            // Header
            _buildHeader(),
            // Scrollable content
            Expanded(
              child: _isLoading
                  ? const Center(child: CircularProgressIndicator())
                  : RefreshIndicator(
                      onRefresh: _loadData,
                      child: SingleChildScrollView(
                        physics: const AlwaysScrollableScrollPhysics(),
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            // Membership Badge
                            _buildMembershipBadge(),
                            const SizedBox(height: 16),
                            // Advertisement carousel
                            _buildAdvertisementCarousel(),
                            const SizedBox(height: 16),
                            // Active Loan Card
                            if (_loanData != null) _buildActiveLoanCard(),
                            if (_loanData != null) const SizedBox(height: 16),
                            // Quick Actions Card
                            _buildQuickActionsCard(),
                            const SizedBox(height: 16),
                            // Recent Activity Card
                            _buildRecentActivityCard(),
                            const SizedBox(height: 24),
                          ],
                        ),
                      ),
                    ),
            ),
            // Fixed Bottom Navigation
            AppBottomNavigationBar(
              currentIndex: _currentIndex,
              parentContext: context,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader() {
    final userName = _userData != null
        ? '${_userData!['first_name']} ${_userData!['last_name']}'
        : 'Loading...';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 20),
      decoration: const BoxDecoration(color: _headerGreen),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Top row with menu, greeting, and notification
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Hamburger menu button
              Container(
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.15),
                  shape: BoxShape.circle,
                ),
                child: Builder(
                  builder: (context) => IconButton(
                    onPressed: () {
                      Scaffold.of(context).openDrawer();
                    },
                    icon: const Icon(Icons.menu, color: Colors.white, size: 24),
                  ),
                ),
              ),
              const SizedBox(width: 16),
              // Greeting
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Good morning,',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 14,
                        fontWeight: FontWeight.w400,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      userName,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
              // Notification button
              Container(
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.15),
                  shape: BoxShape.circle,
                ),
                child: Stack(
                  children: [
                    IconButton(
                      onPressed: () {
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => const NotificationsScreen(),
                          ),
                        );
                      },
                      icon: const Icon(
                        Icons.notifications,
                        color: Colors.white,
                        size: 24,
                      ),
                    ),
                    Positioned(
                      top: 12,
                      right: 12,
                      child: Container(
                        width: 8,
                        height: 8,
                        decoration: const BoxDecoration(
                          color: _accentGold,
                          shape: BoxShape.circle,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildMembershipBadge() {
    final memberId = _userData != null ? _userData!['member_id'] : 'Loading...';
    final status = _userData != null ? _userData!['status'] : 'loading';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0xFF2D5A3D),
        borderRadius: BorderRadius.circular(_pillBorderRadius),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              color: status == 'active' ? _accentGold : Colors.red,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 8),
          Text(
            status == 'active'
                ? 'Active Member ($memberId)'
                : 'Inactive ($memberId)',
            style: const TextStyle(
              color: Color(0xFFE8D5A7),
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAdvertisementCarousel() {
    return Container(
      decoration: BoxDecoration(
        color: _cardWhite,
        borderRadius: BorderRadius.circular(_cardBorderRadius),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 10,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(_cardBorderRadius),
            child: AspectRatio(
              aspectRatio: 1774 / 887,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  PageView.builder(
                    controller: _advertisementController,
                    itemCount: _advertisements.length,
                    onPageChanged: (index) {
                      setState(() {
                        _advertisementIndex = index;
                      });
                    },
                    itemBuilder: (context, index) {
                      return Image.asset(
                        _advertisements[index],
                        fit: BoxFit.cover,
                      );
                    },
                  ),
                  if (_advertisementIndex == 0)
                    Positioned(
                      left: 18,
                      bottom: 18,
                      child: ElevatedButton.icon(
                        onPressed: _openAvailableLoans,
                        icon: const Icon(Icons.arrow_forward, size: 15),
                        label: const Text('Apply Now'),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: _primaryGreen,
                          foregroundColor: Colors.white,
                          disabledBackgroundColor: const Color(0xFFB8C4B8),
                          disabledForegroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(
                            horizontal: 13,
                            vertical: 6,
                          ),
                          minimumSize: const Size(0, 0),
                          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(18),
                          ),
                          textStyle: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ),
                  Positioned(
                    left: 0,
                    right: 0,
                    bottom: 12,
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: List.generate(_advertisements.length, (index) {
                        final isActive = index == _advertisementIndex;
                        return Container(
                          width: 7,
                          height: 7,
                          margin: const EdgeInsets.symmetric(horizontal: 3),
                          decoration: BoxDecoration(
                            color: isActive
                                ? _accentGold
                                : Colors.white.withOpacity(0.7),
                            shape: BoxShape.circle,
                          ),
                        );
                      }),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildActiveLoanCard() {
    if (_loanData == null) return const SizedBox.shrink();

    final loanType = _loanData!['loan_type'] ?? 'Unknown';
    final amount = _loanData!['amount'] ?? 0.0;
    final status = LoanEligibility.statusFor(_loanData!);

    return GestureDetector(
      onTap: () {
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => LoanDetailsScreen(
              applicationId: _loanData!['application_id'] as String,
            ),
          ),
        );
      },
      child: Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: _primaryGreen,
          borderRadius: BorderRadius.circular(_cardBorderRadius),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.08),
              blurRadius: 15,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Top row
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'ACTIVE LOAN - ${loanType.toUpperCase()}',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 1.0,
                  ),
                ),
                const Icon(Icons.chevron_right, color: Colors.white, size: 20),
              ],
            ),
            const SizedBox(height: 16),
            // Main content
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '₱${(amount as num).toStringAsFixed(2)}',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 32,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Loan amount',
                        style: TextStyle(
                          color: Colors.white.withOpacity(0.7),
                          fontSize: 12,
                          fontWeight: FontWeight.w400,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 16),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      status.toUpperCase(),
                      style: const TextStyle(
                        color: _accentGold,
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        Text(
                          'Status',
                          style: TextStyle(
                            color: Colors.white.withOpacity(0.7),
                            fontSize: 11,
                            fontWeight: FontWeight.w400,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 16),
            // Date Container
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFF2D7A4A),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      const Icon(
                        Icons.calendar_today,
                        color: Colors.white,
                        size: 16,
                      ),
                      const SizedBox(width: 8),
                      Text(
                        'Submitted on',
                        style: TextStyle(
                          color: Colors.white.withOpacity(0.8),
                          fontSize: 12,
                          fontWeight: FontWeight.w400,
                        ),
                      ),
                    ],
                  ),
                  Text(
                    _loanData!['date_submitted'] ?? 'N/A',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildQuickActionsCard() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: _cardWhite,
        borderRadius: BorderRadius.circular(_cardBorderRadius),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 10,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'QUICK ACTIONS',
            style: TextStyle(
              color: _captionGray,
              fontSize: 11,
              fontWeight: FontWeight.w600,
              letterSpacing: 1.0,
            ),
          ),
          const SizedBox(height: 16),
          // Button 1
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: _openAvailableLoans,
              style: ElevatedButton.styleFrom(
                backgroundColor: _primaryGreen,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(_buttonBorderRadius),
                ),
              ),
              child: const Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.account_balance_wallet, size: 20),
                  SizedBox(width: 8),
                  Text(
                    'Apply for a Loan',
                    style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          // Button 2
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: () {
                // TODO: Navigate to contributions/ledgers screen
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFE8F5E9),
                foregroundColor: _primaryGreen,
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(_buttonBorderRadius),
                ),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Flexible(
                    flex: 0,
                    child: Icon(Icons.description, size: 20),
                  ),
                  const SizedBox(width: 8),
                  const Flexible(
                    child: Text(
                      'View Contributions / Ledgers',
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRecentActivityCard() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: _cardWhite,
        borderRadius: BorderRadius.circular(_cardBorderRadius),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 10,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'RECENT ACTIVITY',
            style: TextStyle(
              color: _captionGray,
              fontSize: 11,
              fontWeight: FontWeight.w600,
              letterSpacing: 1.0,
            ),
          ),
          const SizedBox(height: 16),
          // Activity rows
          ..._recentActivities.map((activity) {
            return Container(
              margin: const EdgeInsets.only(bottom: 12),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          activity['title'],
                          style: const TextStyle(
                            color: _textDark,
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          activity['date'],
                          style: TextStyle(
                            color: _captionGray,
                            fontSize: 12,
                            fontWeight: FontWeight.w400,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Text(
                    activity['amount'] < 0
                        ? '-₱${(activity['amount'].abs()).toStringAsFixed(2)}'
                        : '+₱${activity['amount'].toStringAsFixed(2)}',
                    style: TextStyle(
                      color: activity['amount'] < 0
                          ? _textDark
                          : _positiveGreen,
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }
}
