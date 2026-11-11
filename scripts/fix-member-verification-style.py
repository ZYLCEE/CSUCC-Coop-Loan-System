from pathlib import Path
p=Path('docs/application-verification/member-client/documents_screen.dart')
s=p.read_text(encoding='utf-8')
for old,new in [
    ("'Action required · '+item['applicationId'].toString()","'Action required · DOLLAR{item['applicationId']}'"),
    ("date(item['createdAt'])+' PHT'","'DOLLAR{date(item['createdAt'])} PHT'"),
    ("(item['applicationId'].toString()+' '+item['reason'].toString())","'DOLLAR{item['applicationId']} DOLLAR{item['reason']}'"),
]:
    if s.count(old)!=1: raise ValueError('Member style point changed: '+old)
    s=s.replace(old,new.replace('DOLLAR',chr(36)))
p.write_text(s,encoding='utf-8')
print('Updated member correction strings to Dart interpolation.')
