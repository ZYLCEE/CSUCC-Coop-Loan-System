"""Install the prepared consent fix after checking source hashes; retain backups."""
from pathlib import Path
import hashlib
import json
import shutil

workspace = Path(__file__).resolve().parents[1]
stage = workspace / '.tmp/member-consent-live-fix'
client = Path('C:/Users/zylcee/Desktop/COOP/coop_frontend_client').resolve()
backup = workspace / '.tmp/member-consent-live-fix-backup'
manifest = json.loads((stage / 'install-manifest.json').read_text(encoding='utf-8'))

for entry in manifest:
    destination = (client / entry['path']).resolve()
    assert destination.is_relative_to(client), 'Unexpected destination'
    actual = hashlib.sha256(destination.read_bytes()).hexdigest() if destination.exists() else None
    assert actual == entry['before'], f"File changed since preparation: {entry['path']}"

for entry in manifest:
    destination = client / entry['path']
    if destination.exists():
        saved = backup / entry['path']
        saved.parent.mkdir(parents=True, exist_ok=True)
        assert not saved.exists(), 'Preserve the earlier backup before reinstalling'
        shutil.copyfile(destination, saved)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(stage / entry['path'], destination)

print(f"Installed {len(manifest)} consent-related files. Existing source backups: {backup}")
print('No Git branch, remote, credentials, hosted data or unrelated files changed.')
