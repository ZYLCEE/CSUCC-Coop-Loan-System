from pathlib import Path
import shutil

client=Path(r'C:/Users/zylcee/Desktop/COOP/coop_frontend_client')
out=Path('docs/application-verification/member-client')
out.mkdir(parents=True,exist_ok=True)
for name in ['document_center_service.dart','documents_screen.dart','document_center_service_test.dart']:
    source=client / ('lib/services' if name=='document_center_service.dart' else 'test' if name.endswith('_test.dart') else 'lib') / name
    shutil.copyfile(source,out/name)

def replace(path,old,new):
    content=path.read_text(encoding='utf-8')
    if content.count(old)!=1: raise ValueError('Member insertion point changed: '+old[:100])
    path.write_text(content.replace(old,new),encoding='utf-8')

service=out/'document_center_service.dart'
replace(service,'Future<({List<DocumentRow> submissions, List<DocumentRow> shared})>','Future<({List<DocumentRow> submissions, List<DocumentRow> shared, List<DocumentRow> corrections})>')
replace(service,'    final roots = results[0];',"""    final corrections = List<DocumentRow>.from(await client.rpc('member_application_corrections') as List);
    final roots = results[0];""")
replace(service,'return (submissions: roots, shared: shared);','return (submissions: roots, shared: shared, corrections: corrections);')
screen=out/'documents_screen.dart'
replace(screen,'List<DocumentRow> submissions = [], shared = [];','List<DocumentRow> submissions = [], shared = [], corrections = [];')
replace(screen,'          shared = data.shared;','          shared = data.shared;\n          corrections = data.corrections;')
replace(screen,'  Widget sharedCard(DocumentRow item) => Card(','''  Widget correctionCard(DocumentRow item) => Card(
    child: Padding(padding: const EdgeInsets.all(16), child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Action required · '+item['applicationId'].toString(), style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        Text(item['reason'] as String),
        const SizedBox(height: 8),
        Text(date(item['createdAt'])+' PHT', style: Theme.of(context).textTheme.bodySmall),
        const SizedBox(height: 8),
        const Text('Use Upload replacement on the affected files below. For application information or consent corrections, follow the cooperative instructions.'),
      ],
    )),
  );

  Widget sharedCard(DocumentRow item) => Card(''')
old='''                            children: mine.isEmpty
                                ? [
                                    const Padding(
                                      padding: EdgeInsets.all(24),
                                      child: Text(
                                        'No matching submissions. Documents uploaded with your loan applications appear here.',
                                      ),
                                    ),
                                  ]
                                : mine.map(submissionCard).toList(),'''
new='''                            children: [
                              ...corrections.where((item) => (item['applicationId'].toString()+' '+item['reason'].toString()).toLowerCase().contains(search)).map(correctionCard),
                              if (mine.isEmpty)
                                const Padding(padding: EdgeInsets.all(24), child: Text('No matching submissions. Documents uploaded with your loan applications appear here.'))
                              else ...mine.map(submissionCard),
                            ],'''
replace(screen,old,new)
test=out/'document_center_service_test.dart'
replace(test,"} else if (request.uri.path.endsWith('/shared_documents')) {","""} else if (request.uri.path.endsWith('/member_application_corrections')) {
        data = [{'applicationId': 'APP-TEST', 'stage': 'returned_for_requirements', 'reason': 'Replace blurred ID.', 'affectedKinds': ['validId'], 'createdAt': '2026-11-04T00:00:00Z'}];
      } else if (request.uri.path.endsWith('/shared_documents')) {""")
replace(test,"expect(result.shared.single['title'], 'Shared form');","expect(result.shared.single['title'], 'Shared form');\n      expect(result.corrections.single['reason'], 'Replace blurred ID.');")
print('Prepared member correction notice and service test changes.')
