"""Seal every tracked source entry, without following repository symlinks."""
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys

assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip() == os.environ['HARBOR_SOURCE_COMMIT']
assert not subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=all'])
rows = []
for entry in subprocess.check_output(['git', 'ls-files', '--stage', '-z']).split(b'\0'):
    if not entry:
        continue
    header, path = entry.split(b'\t', 1)
    mode, blob, stage = header.decode().split()
    file = Path(path.decode())
    assert stage == '0' and mode in ('100644', '100755', '120000')
    info = file.lstat()
    if mode == '120000':
        assert stat.S_ISLNK(info.st_mode)
        data = os.readlink(file).encode()
    else:
        assert stat.S_ISREG(info.st_mode) and bool(info.st_mode & 0o111) == (mode == '100755')
        data = file.read_bytes()
    assert hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest() == blob
    rows.append({'path': str(file), 'mode': mode, 'blob': blob, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
assert len(rows) <= 2048 and sum(row['bytes'] for row in rows) <= 32000000
Path(sys.argv[1]).write_text(json.dumps(rows, indent=2) + '\n')
