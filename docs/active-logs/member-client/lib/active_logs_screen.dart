import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'app_theme.dart';
import 'services/member_activity_service.dart';

typedef ActiveLogLoader =
    Future<Map<String, dynamic>> Function(Map<String, dynamic> filters);

class ActiveLogsScreen extends StatefulWidget {
  const ActiveLogsScreen({
    super.key,
    this.loadPage,
    this.enableRealtime = true,
  });
  final ActiveLogLoader? loadPage;
  final bool enableRealtime;
  @override
  State<ActiveLogsScreen> createState() => _ActiveLogsScreenState();
}

class _ActiveLogsScreenState extends State<ActiveLogsScreen>
    with WidgetsBindingObserver {
  final _search = TextEditingController();
  DateTime? _from, _to;
  int _page = 1, _size = 10, _total = 0, _sequence = 0;
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true, _live = false;
  String? _error;
  Timer? _poll, _debounce;
  RealtimeChannel? _channel;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    scheduleMicrotask(() => unawaited(_load()));
    _poll = Timer.periodic(
      const Duration(seconds: 15),
      (_) => unawaited(_load()),
    );
    if (widget.enableRealtime && widget.loadPage == null) {
      _channel = Supabase.instance.client
          .channel(
            'member-active-logs-${DateTime.now().microsecondsSinceEpoch}',
          )
          .onPostgresChanges(
            event: PostgresChangeEvent.insert,
            schema: 'public',
            table: 'portal_active_log_entries',
            callback: (_) => _schedule(),
          )
          .onPostgresChanges(
            event: PostgresChangeEvent.all,
            schema: 'public',
            table: 'portal_log_sessions',
            callback: (_) => _schedule(),
          )
          .subscribe((status, _) {
            if (mounted) {
              setState(
                () => _live = status == RealtimeSubscribeStatus.subscribed,
              );
              if (_live) {
                _schedule();
              }
            }
          });
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(_load());
  }

  void _schedule() {
    _debounce?.cancel();
    _debounce = Timer(
      const Duration(milliseconds: 300),
      () => unawaited(_load()),
    );
  }

  String _dateOnly(DateTime value) => DateFormat('yyyy-MM-dd').format(value);
  Future<void> _load() async {
    final request = ++_sequence;
    if (mounted) setState(() => _loading = true);
    try {
      if (widget.loadPage == null) await MemberActivityService.instance.start();
      final filters = <String, dynamic>{
        'p_search': _search.text.trim(),
        'p_role': '',
        'p_from': _from == null ? null : '${_dateOnly(_from!)}T00:00:00+08:00',
        'p_to': _to == null
            ? null
            : '${_dateOnly(_to!.add(const Duration(days: 1)))}T00:00:00+08:00',
        'p_page': _page,
        'p_page_size': _size,
      };
      final result = widget.loadPage != null
          ? await widget.loadPage!(filters)
          : Map<String, dynamic>.from(
              await Supabase.instance.client.rpc(
                    'read_portal_active_logs',
                    params: filters,
                  )
                  as Map,
            );
      if (!mounted || request != _sequence) return;
      setState(() {
        _rows = (result['rows'] as List)
            .map((row) => Map<String, dynamic>.from(row as Map))
            .toList();
        _total = result['total'] as int;
        _page = result['page'] as int;
        _error = null;
      });
    } catch (_) {
      if (mounted && request == _sequence) {
        setState(
          () => _error = 'Your activity could not be loaded. Please retry.',
        );
      }
    } finally {
      if (mounted && request == _sequence) setState(() => _loading = false);
    }
  }

  Future<void> _chooseDate(bool from) async {
    final chosen = await showDatePicker(
      context: context,
      initialDate: (from ? _from : _to) ?? DateTime.now(),
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
    );
    if (!mounted || chosen == null) return;
    setState(() {
      if (from) {
        _from = chosen;
        if (_to != null && chosen.isAfter(_to!)) _to = chosen;
      } else {
        _to = chosen;
        if (_from != null && chosen.isBefore(_from!)) _from = chosen;
      }
      _page = 1;
    });
    unawaited(_load());
  }

  String _time(dynamic value) {
    final parsed = value is String ? DateTime.tryParse(value) : null;
    return parsed == null
        ? '—'
        : '${DateFormat('MMM d, y\nh:mm a').format(parsed.toUtc().add(const Duration(hours: 8)))} PHT';
  }

  String _id(dynamic value) {
    final id = value?.toString().trim() ?? '';
    if (id.isEmpty) return '—';
    return RegExp(
          r'^(?:CSUCC-)?\d{4}-\d{4,}$',
          caseSensitive: false,
        ).hasMatch(id)
        ? 'CSUCC-${id.replaceFirst(RegExp(r'^CSUCC-', caseSensitive: false), '')}'
        : id;
  }

  Widget _badge(String text, {bool role = false}) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
    decoration: BoxDecoration(
      color: role ? const Color(0xffdcfce7) : AppTheme.background,
      borderRadius: BorderRadius.circular(999),
    ),
    child: Text(
      text,
      style: TextStyle(
        fontSize: 12,
        fontWeight: FontWeight.w600,
        color: role ? const Color(0xff166534) : AppTheme.darkText,
      ),
    ),
  );
  List<MapEntry<String, String>> _details(Map<String, dynamic> row) => [
    MapEntry('ID Number', _id(row['accountNumber'])),
    MapEntry('Name', '${row['name']}'),
    const MapEntry('Role', 'Member'),
    MapEntry('Action', '${row['action']}'),
    MapEntry('Browser / OS', '${row['browser'] ?? '—'} / ${row['os'] ?? '—'}'),
    MapEntry('Time In', _time(row['timeIn'])),
    MapEntry(
      'Time Out',
      row['sessionState'] == 'active' ? 'Active' : _time(row['timeOut']),
    ),
    MapEntry('IP Address', '${row['ipAddress'] ?? '—'}'),
    MapEntry('Details', '${row['details']}'),
  ];
  @override
  void dispose() {
    _sequence++;
    WidgetsBinding.instance.removeObserver(this);
    _search.dispose();
    _poll?.cancel();
    _debounce?.cancel();
    if (_channel != null) {
      unawaited(Supabase.instance.client.removeChannel(_channel!));
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final pages = (_total / _size).ceil().clamp(1, 100000);
    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        title: const Text('Active Logs'),
        backgroundColor: AppTheme.primaryGreen,
        foregroundColor: Colors.white,
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const Text(
              'Your successful sessions and completed cooperative activities.',
              style: AppTheme.bodyRegular,
            ),
            const SizedBox(height: 8),
            Text(
              _live
                  ? '● Live updates · Only your own activity'
                  : 'Auto-refreshing · Only your own activity',
              style: AppTheme.captionRegular,
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _search,
              decoration: const InputDecoration(
                labelText: 'Search my activity',
                prefixIcon: Icon(Icons.search),
                border: OutlineInputBorder(),
              ),
              onChanged: (_) {
                _page = 1;
                _schedule();
              },
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                OutlinedButton.icon(
                  onPressed: () => _chooseDate(true),
                  icon: const Icon(Icons.calendar_month_outlined),
                  label: Text(
                    _from == null ? 'From Date' : 'From: ${_dateOnly(_from!)}',
                  ),
                ),
                OutlinedButton.icon(
                  onPressed: () => _chooseDate(false),
                  icon: const Icon(Icons.calendar_month_outlined),
                  label: Text(
                    _to == null ? 'To Date' : 'To: ${_dateOnly(_to!)}',
                  ),
                ),
                if (_from != null || _to != null)
                  TextButton(
                    onPressed: () {
                      setState(() {
                        _from = null;
                        _to = null;
                        _page = 1;
                      });
                      unawaited(_load());
                    },
                    child: const Text('Clear dates'),
                  ),
              ],
            ),
            if (_loading)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 12),
                child: LinearProgressIndicator(),
              ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Column(
                  children: [
                    Text(_error!, style: const TextStyle(color: Colors.red)),
                    TextButton(onPressed: _load, child: const Text('Retry')),
                  ],
                ),
              ),
            if (!_loading && _error == null && _rows.isEmpty)
              const Padding(
                padding: EdgeInsets.all(32),
                child: Text(
                  'No activity logs found.',
                  textAlign: TextAlign.center,
                ),
              ),
            LayoutBuilder(
              builder: (context, constraints) => constraints.maxWidth >= 800
                  ? SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: DataTable(
                        columns:
                            const [
                                  'ID Number',
                                  'Name',
                                  'Role',
                                  'Action',
                                  'Browser / OS',
                                  'Time In',
                                  'Time Out',
                                  'IP Address',
                                  'Details',
                                ]
                                .map((label) => DataColumn(label: Text(label)))
                                .toList(),
                        rows: _rows
                            .map(
                              (row) => DataRow(
                                cells: _details(row)
                                    .map(
                                      (entry) => DataCell(
                                        entry.key == 'Role'
                                            ? _badge(entry.value, role: true)
                                            : ConstrainedBox(
                                                constraints:
                                                    const BoxConstraints(
                                                      maxWidth: 280,
                                                    ),
                                                child: Text(entry.value),
                                              ),
                                      ),
                                    )
                                    .toList(),
                              ),
                            )
                            .toList(),
                      ),
                    )
                  : Column(
                      children: _rows
                          .map(
                            (row) => Card(
                              margin: const EdgeInsets.symmetric(vertical: 6),
                              child: Padding(
                                padding: const EdgeInsets.all(16),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      children: [
                                        Expanded(
                                          child: Text(
                                            '${row['action']}',
                                            style: AppTheme.titleBold,
                                          ),
                                        ),
                                        _badge('Member', role: true),
                                      ],
                                    ),
                                    const SizedBox(height: 10),
                                    Text(
                                      '${row['details']}',
                                      style: AppTheme.bodyRegular,
                                    ),
                                    const SizedBox(height: 8),
                                    Text(
                                      _time(row['timeIn'] ?? row['timeOut']),
                                      style: AppTheme.captionRegular,
                                    ),
                                    ExpansionTile(
                                      tilePadding: EdgeInsets.zero,
                                      title: const Text('Activity details'),
                                      children: _details(row)
                                          .map(
                                            (entry) => Padding(
                                              padding:
                                                  const EdgeInsets.symmetric(
                                                    vertical: 5,
                                                  ),
                                              child: Row(
                                                crossAxisAlignment:
                                                    CrossAxisAlignment.start,
                                                children: [
                                                  SizedBox(
                                                    width: 110,
                                                    child: Text(
                                                      entry.key,
                                                      style: AppTheme
                                                          .captionRegular,
                                                    ),
                                                  ),
                                                  Expanded(
                                                    child: Text(
                                                      entry.value,
                                                      style:
                                                          AppTheme.bodyRegular,
                                                    ),
                                                  ),
                                                ],
                                              ),
                                            ),
                                          )
                                          .toList(),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          )
                          .toList(),
                    ),
            ),
            const SizedBox(height: 12),
            Text(
              _total == 0
                  ? 'Showing 0 entries'
                  : 'Showing ${(_page - 1) * _size + 1}–${(_page * _size).clamp(0, _total)} of $_total entries',
              style: AppTheme.captionRegular,
            ),
            Wrap(
              spacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                const Text('Show'),
                DropdownButton<int>(
                  value: _size,
                  items: [10, 25, 50]
                      .map(
                        (size) =>
                            DropdownMenuItem(value: size, child: Text('$size')),
                      )
                      .toList(),
                  onChanged: (value) {
                    if (value != null) {
                      setState(() {
                        _size = value;
                        _page = 1;
                      });
                      unawaited(_load());
                    }
                  },
                ),
                OutlinedButton(
                  onPressed: _page <= 1 || _loading
                      ? null
                      : () {
                          _page--;
                          unawaited(_load());
                        },
                  child: const Text('Previous'),
                ),
                Text('$_page / $pages'),
                OutlinedButton(
                  onPressed: _page >= pages || _loading
                      ? null
                      : () {
                          _page++;
                          unawaited(_load());
                        },
                  child: const Text('Next'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
