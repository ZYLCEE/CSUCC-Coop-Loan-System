import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';
import 'app_theme.dart';
import 'models/loan_document.dart';
import 'services/document_center_service.dart';
import 'services/document_picker_service.dart';

class DocumentsScreen extends StatefulWidget {
  const DocumentsScreen({super.key});
  @override
  State<DocumentsScreen> createState() => _DocumentsScreenState();
}

class _DocumentsScreenState extends State<DocumentsScreen> {
  final service = DocumentCenterService();
  List<DocumentRow> submissions = [], shared = [], corrections = [];
  bool loading = true, busy = false;
  String? error;
  String query = '';
  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final data = await service.load();
      if (mounted) {
        setState(() {
          submissions = data.submissions;
          shared = data.shared;
          corrections = data.corrections;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => error =
              'Documents could not be loaded. Check your connection and retry.',
        );
      }
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  String date(dynamic value) {
    final parsed = DateTime.tryParse(value?.toString() ?? '');
    // The cooperative uses Philippine time, including on devices in other zones.
    return parsed == null
        ? 'Date unavailable'
        : DateFormat(
            'MMM d, yyyy · h:mm a',
          ).format(parsed.toUtc().add(const Duration(hours: 8)));
  }

  void message(String text) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
    }
  }

  Future<void> open(DocumentRow file, String bucket) async {
    if (busy) return;
    setState(() => busy = true);
    try {
      final url = await service.fileLink(
        bucket,
        file['storage_path'] as String,
      );
      if (!await launchUrl(
        Uri.parse(url),
        mode: LaunchMode.externalApplication,
      )) {
        throw StateError('Cannot open file');
      }
    } catch (_) {
      message('This file could not be opened. Refresh and try again.');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> replace(DocumentRow root) async {
    if (busy) return;
    setState(() => busy = true);
    try {
      final kind = LoanDocumentKind.values.byName(root['kind'] as String);
      final file = await DocumentPickerService().pick(
        kind,
        DocumentSource.files,
      );
      if (file == null || !mounted) return;
      final accepted = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Submit replacement?'),
          content: Text(
            '${file.name}\n\nThe previous file and review history will be kept. Your new file will be sent for review.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Submit'),
            ),
          ],
        ),
      );
      if (accepted != true) return;
      await service.replace(root, file);
      message('Replacement submitted for review.');
      await load();
    } on StateError catch (failure) {
      message(failure.message.toString());
    } catch (_) {
      message(
        'The replacement could not be submitted. Refresh your documents and try again.',
      );
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> history(DocumentRow root) async {
    final versions = <DocumentRow>[
      root,
      ...List<DocumentRow>.from(root['versions'] as List),
    ];
    final events = <({String title, String time, String? reason})>[
      for (var i = 0; i < versions.length; i++)
        (
          title: 'Version ${versions[i]['version'] ?? 1} uploaded',
          time: versions[i]['created_at'] as String,
          reason: null,
        ),
      for (final review in List<DocumentRow>.from(root['reviews'] as List))
        (
          title:
              '${review['status'] == 'verified' ? 'Verified' : 'Replacement requested'} · ${review['reviewer_name']}',
          time: review['created_at'] as String,
          reason: review['reason'] as String?,
        ),
    ]..sort((a, b) => b.time.compareTo(a.time));
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: SizedBox(
          height: MediaQuery.sizeOf(context).height * .7,
          child: ListView(
            padding: const EdgeInsets.all(20),
            children: [
              Text(
                'File and review history',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 16),
              for (final event in events)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(event.title),
                  subtitle: Text(
                    '${date(event.time)} PHT${event.reason == null ? '' : '\n${event.reason}'}',
                  ),
                ),
              const Divider(),
              const Text('Previous file versions'),
              for (final version in versions)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    'Version ${version['version'] ?? 1} · ${version['original_name']}',
                  ),
                  trailing: const Icon(Icons.open_in_new),
                  onTap: () {
                    Navigator.pop(context);
                    open(version, 'loan-documents');
                  },
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget submissionCard(DocumentRow root) {
    final application = Map<String, dynamic>.from(
      root['loan_applications'] as Map? ?? {},
    );
    final latest = root['latest'] as DocumentRow;
    final review = root['review'] as DocumentRow?;
    final kind = LoanDocumentKind.values.byName(root['kind'] as String).label;
    final status = review?['status'] == 'verified'
        ? 'Verified'
        : review?['status'] == 'needs_replacement'
        ? 'Needs replacement'
        : 'To review';
    final canReplace =
        review?['status'] == 'needs_replacement' &&
        ['pending', 'under review'].contains(application['status']);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(kind, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 4),
            Text(
              '${application['application_id'] ?? 'Application'} · ${application['loan_type'] ?? 'Loan'}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 8),
            Text(
              status,
              style: TextStyle(
                fontWeight: FontWeight.w600,
                color: status == 'Verified'
                    ? AppTheme.primaryGreen
                    : status == 'Needs replacement'
                    ? Colors.red.shade700
                    : Colors.blueGrey,
              ),
            ),
            Text(
              '${latest['original_name']} · Version ${latest['version'] ?? 1}',
            ),
            Text(
              '${date(latest['created_at'])} PHT',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            if (review?['reason'] != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text('Please correct: ${review!['reason']}'),
              ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: [
                TextButton.icon(
                  onPressed: busy ? null : () => open(latest, 'loan-documents'),
                  icon: const Icon(Icons.open_in_new, size: 18),
                  label: const Text('View file'),
                ),
                TextButton(
                  onPressed: busy ? null : () => history(root),
                  child: const Text('History'),
                ),
                if (canReplace)
                  FilledButton(
                    onPressed: busy ? null : () => replace(root),
                    child: const Text('Upload replacement'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget correctionCard(DocumentRow item) => Card(
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Action required · ${item['applicationId']}',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          Text(item['reason'] as String),
          const SizedBox(height: 8),
          Text(
            '${date(item['createdAt'])} PHT',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 8),
          const Text(
            'Use Upload replacement on the affected files below. For application information or consent corrections, follow the cooperative instructions.',
          ),
        ],
      ),
    ),
  );

  Widget sharedCard(DocumentRow item) => Card(
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            item['title'] as String,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 4),
          Text(
            '${item['category']} · ${item['audience'] == 'selected' ? 'Shared with you' : 'All members'}',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          if ((item['description'] as String).isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(item['description'] as String),
            ),
          const SizedBox(height: 8),
          Text(item['original_name'] as String),
          Text(
            '${date(item['published_at'])} PHT',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          TextButton.icon(
            onPressed: busy ? null : () => open(item, 'coop-shared-documents'),
            icon: const Icon(Icons.open_in_new, size: 18),
            label: const Text('View / download'),
          ),
        ],
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final search = query.trim().toLowerCase();
    final mine = submissions
        .where(
          (row) =>
              '${row['original_name']} ${row['kind']} ${row['loan_applications']}'
                  .toLowerCase()
                  .contains(search),
        )
        .toList();
    final library = shared
        .where(
          (row) => '${row['title']} ${row['original_name']} ${row['category']}'
              .toLowerCase()
              .contains(search),
        )
        .toList();
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Documents'),
          actions: [
            IconButton(
              tooltip: 'Refresh documents',
              onPressed: busy || loading ? null : load,
              icon: const Icon(Icons.refresh),
            ),
          ],
          bottom: const TabBar(
            tabs: [
              Tab(text: 'My submissions'),
              Tab(text: 'Shared documents'),
            ],
          ),
        ),
        body: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: TextField(
                onChanged: (value) => setState(() => query = value),
                decoration: const InputDecoration(
                  prefixIcon: Icon(Icons.search),
                  hintText: 'Search documents',
                  border: OutlineInputBorder(),
                ),
              ),
            ),
            if (busy) const LinearProgressIndicator(),
            Expanded(
              child: loading
                  ? const Center(child: CircularProgressIndicator())
                  : error != null
                  ? Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Padding(
                            padding: const EdgeInsets.all(16),
                            child: Text(error!, textAlign: TextAlign.center),
                          ),
                          FilledButton(
                            onPressed: load,
                            child: const Text('Retry'),
                          ),
                        ],
                      ),
                    )
                  : TabBarView(
                      children: [
                        RefreshIndicator(
                          onRefresh: load,
                          child: ListView(
                            padding: const EdgeInsets.all(12),
                            physics: const AlwaysScrollableScrollPhysics(),
                            children: [
                              ...corrections
                                  .where(
                                    (item) =>
                                        '${item['applicationId']} ${item['reason']}'
                                            .toLowerCase()
                                            .contains(search),
                                  )
                                  .map(correctionCard),
                              if (mine.isEmpty)
                                const Padding(
                                  padding: EdgeInsets.all(24),
                                  child: Text(
                                    'No matching submissions. Documents uploaded with your loan applications appear here.',
                                  ),
                                )
                              else
                                ...mine.map(submissionCard),
                            ],
                          ),
                        ),
                        RefreshIndicator(
                          onRefresh: load,
                          child: ListView(
                            padding: const EdgeInsets.all(12),
                            physics: const AlwaysScrollableScrollPhysics(),
                            children: library.isEmpty
                                ? [
                                    const Padding(
                                      padding: EdgeInsets.all(24),
                                      child: Text(
                                        'No matching shared documents. Published forms and files shared with you appear here.',
                                      ),
                                    ),
                                  ]
                                : library.map(sharedCard).toList(),
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
}
