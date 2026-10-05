#!/usr/bin/env bash
# Add only the two assistant discovery aliases to the existing HTTPS site.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Discovery provisioning requires root' >&2; exit 1; }
site=/etc/nginx/sites-available/vndrly.ai
[[ -f "$site" ]] || { echo 'Existing VNDRLY nginx site was not found' >&2; exit 1; }
backup=$(mktemp /etc/nginx/sites-available/vndrly-assistant-backup.XXXXXX)
cp --preserve=mode,ownership "$site" "$backup"
rollback() { cp --preserve=mode,ownership "$backup" "$site"; }
trap 'rollback' ERR
python3 - "$site" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
text = path.read_text()
marker = '# VNDRLY-MANAGED-ASSISTANT-DISCOVERY'
locations = [
    '/.well-known/oauth-authorization-server/api/assistant-connection',
    '/.well-known/oauth-protected-resource/api/assistant-connection/mcp',
]
if marker not in text:
    if any('location = ' + location in text for location in locations):
        raise SystemExit('Existing unmanaged assistant discovery routes require review')
    anchor = '    location /api/ {'
    if text.count(anchor) != 1:
        raise SystemExit('Ambiguous API proxy location; existing site was preserved')
    block = '    ' + marker + '\n'
    for location in locations:
        block += '''    location = %s {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

''' % location
    path.write_text(text.replace(anchor, block + anchor, 1))
else:
    if any(text.count('location = ' + location + ' {') != 1 for location in locations):
        raise SystemExit('Managed assistant discovery routes are incomplete')
PY
nginx -t
systemctl reload nginx
trap - ERR
echo 'Assistant discovery aliases verified and loaded; backup retained'
