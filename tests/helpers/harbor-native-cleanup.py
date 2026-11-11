"""Always retire only declared native-fixture resources and owned tool storage."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import time

root = Path(os.environ['RUNNER_TEMP']) / 'open-evals-harbor-native'
assert root == Path(os.environ['HARBOR_NATIVE_ROOT']) and not root.is_symlink()
proof, work = root / 'proof', root / 'work'
report = {'dockerProjects': [], 'errors': [], 'signals': [], 'ownedWorkRemoved': False, 'processCheck': 'argv prefix; not a host-wide open-file audit'}
ownership = proof / 'ownership.json'
projects = json.loads(ownership.read_text())['dockerProjects'] if ownership.exists() else []
assert isinstance(projects, list) and len(projects) <= 2
assert all(re.fullmatch(r'oe-harbor-[0-9a-f-]{36}__env', value) for value in projects)

def run(args):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
    assert result.returncode == 0 and len(result.stdout) < 131072 and len(result.stderr) < 131072
    return result.stdout.decode().strip()

def process_rows():
    rows = []
    for line in run(['ps', '-eo', 'pid=,ppid=,pgid=,args=']).splitlines():
        parts = line.strip().split(None, 3)
        if len(parts) == 4 and str(work) in parts[3] and int(parts[0]) != os.getpid():
            rows.append({'pid': int(parts[0]), 'ppid': int(parts[1]), 'pgid': int(parts[2]), 'args': parts[3]})
    return rows

try:
    # Reap only exact declared native/Compose commands if a prior step was interrupted.
    for row in process_rows():
        owned = any(project in row['args'] or project.removesuffix('__env') in row['args'] for project in projects)
        if owned and ('harbor.cli.main' in row['args'] or '--project-name' in row['args']):
            try:
                os.kill(row['pid'], signal.SIGTERM)
                report['signals'].append({'pid': row['pid'], 'signal': 'TERM'})
            except ProcessLookupError:
                pass
    deadline = time.monotonic() + 5
    while process_rows() and time.monotonic() < deadline:
        time.sleep(0.1)
    remaining = process_rows()
    for row in remaining:
        owned = any(project in row['args'] or project.removesuffix('__env') in row['args'] for project in projects)
        if owned and ('harbor.cli.main' in row['args'] or '--project-name' in row['args']):
            try:
                os.kill(row['pid'], signal.SIGKILL)
                report['signals'].append({'pid': row['pid'], 'signal': 'KILL'})
            except ProcessLookupError:
                pass
    for project in projects:
        row = {'project': project, 'removed': {}}
        for kind in ('container', 'network', 'volume'):
            args = ['docker', kind, 'ls', '-q', '--filter', 'label=com.docker.compose.project=' + project]
            if kind == 'container': args.insert(3, '-a')
            ids = run(args).splitlines()
            assert all(re.fullmatch(r'[A-Za-z0-9_.-]+', value) for value in ids)
            if ids:
                run(['docker', kind, 'rm', *(['--force'] if kind == 'container' else []), *ids])
            assert not run(args)
            row['removed'][kind] = ids
        report['dockerProjects'].append(row)
    remaining = process_rows()
    report['remainingWorkArgvProcesses'] = [{key: value for key, value in row.items() if key != 'args'} for row in remaining]
    if remaining:
        raise RuntimeError('owned_work_processes_remain_or_are_unclassified')
    handles = subprocess.run(['sudo', '-n', 'lsof', '-nP', '-t', '+D', str(work)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
    report['openHandleCheck'] = {'exitCode': handles.returncode, 'stdoutBytes': len(handles.stdout), 'stderrBytes': len(handles.stderr)}
    report['noOpenHandlesVerified'] = handles.returncode == 1 and not handles.stdout and not handles.stderr
    if not report['noOpenHandlesVerified']:
        raise RuntimeError('owned_work_open_handles_or_uncertainty')
    identity = json.loads((proof / 'work-identity.json').read_text())
    current = work.lstat()
    assert work.is_dir() and not work.is_symlink() and current.st_uid == os.getuid()
    assert (current.st_dev, current.st_ino) == (identity['device'], identity['inode'])
    assert hashlib.sha256((work / '.owner').read_bytes()).hexdigest() == identity['markerSha256']
    shutil.rmtree(work)
    report['ownedWorkRemoved'] = not work.exists()
except Exception as error:
    report['errors'].append({'type': type(error).__name__, 'code': str(error) if re.fullmatch(r'[a-z_]+', str(error)) else 'cleanup_unverified'})
finally:
    report['declaredContainerNetworkVolumeCleanupVerified'] = not report['errors'] and len(report['dockerProjects']) == len(projects)
    report['dockerImageCacheAndRunnerDisposalIndependentlyVerified'] = False
    (proof / 'cleanup.json').write_text(json.dumps(report, indent=2) + '\n')
if report['errors'] or not report['ownedWorkRemoved']:
    raise SystemExit(1)
