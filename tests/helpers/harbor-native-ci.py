"""Bounded hosted verification; no provider credentials or paid model execution."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from uuid import uuid4

root = Path(os.environ['RUNNER_TEMP']) / 'open-evals-harbor-native'
root.mkdir(mode=0o700)
proof, work = root / 'proof', root / 'work'
proof.mkdir(mode=0o700); work.mkdir(mode=0o700)
marker = str(uuid4()).encode()
(work / '.owner').write_bytes(marker)
info = work.stat()
(proof / 'work-identity.json').write_text(json.dumps({'device': info.st_dev, 'inode': info.st_ino,
    'uid': info.st_uid, 'markerSha256': hashlib.sha256(marker).hexdigest()}, indent=2) + '\n')
with open(os.environ['GITHUB_ENV'], 'a') as stream:
    for key, value in {'HARBOR_NATIVE_ROOT': root, 'HARBOR_PROOF': proof, 'HARBOR_WORK': work}.items():
        stream.write(f'{key}={value}\n')
environment = {key: os.environ[key] for key in ('HOME', 'PATH', 'LANG', 'RUNNER_TEMP', 'HARBOR_SOURCE_COMMIT') if key in os.environ}
environment.update(HARBOR_NATIVE_ROOT=str(root), HARBOR_PROOF=str(proof), HARBOR_WORK=str(work),
    HARBOR_TELEMETRY='0', PYTHONDONTWRITEBYTECODE='1', PIP_CONFIG_FILE='/dev/null', PIP_DISABLE_PIP_VERSION_CHECK='1',
    PIP_NO_CACHE_DIR='1', PIP_INDEX_URL='https://pypi.org/simple', NPM_CONFIG_REGISTRY='https://registry.npmjs.org',
    NPM_CONFIG_CACHE=str(work / 'npm-cache'), NPM_CONFIG_USERCONFIG='/dev/null', NPM_CONFIG_GLOBALCONFIG='/dev/null',
    XDG_CACHE_HOME=str(work / 'cache'), XDG_CONFIG_HOME=str(work / 'config'), TMPDIR=str(work / 'tmp'),
    DOCKER_HOST='unix:///var/run/docker.sock', CI='true')
for directory in ('cache', 'config', 'tmp'): (work / directory).mkdir(mode=0o700)
source = Path.cwd()

def run(name, args, timeout=180):
    with (proof / (name + '.stdout')).open('wb') as out, (proof / (name + '.stderr')).open('wb') as err:
        result = subprocess.run(args, env=environment, stdin=subprocess.DEVNULL, stdout=out, stderr=err, timeout=timeout)
    print(f'{name}: exit {result.returncode}', flush=True)
    if result.returncode:
        # All inputs are authored fixtures or public dependency metadata; no secrets.
        print((proof / (name + '.stderr')).read_text(errors='replace')[-12000:], flush=True)
        print((proof / (name + '.stdout')).read_text(errors='replace')[-12000:], flush=True)
        raise RuntimeError(name + '_failed')
    return (proof / (name + '.stdout')).read_text().strip()

run('source-before', [sys.executable, 'tests/helpers/harbor-source-guard.py', str(proof / 'source-before.json')])
assert shutil.which('lsof') and shutil.which('docker')
run('docker-version', ['docker', 'version', '--format', '{{json .Server.Version}}'])
run('docker-compose-version', ['docker', 'compose', 'version', '--short'])
run('docker-image-baseline', ['docker', 'image', 'ls', '--digests', '--format', '{{json .}}'])
package = work / 'runtime-package'
package.mkdir()
for name in ('pyproject.toml', 'LICENSE'):
    shutil.copyfile(source / 'python/open_evals_harbor' / name, package / name)
target = package / 'src/open_evals_harbor'
target.mkdir(parents=True)
for name in ('__init__.py', 'bundle.py', 'runner.py', 'cli.py'):
    shutil.copyfile(source / 'python/open_evals_harbor/src/open_evals_harbor' / name, target / name)
venv = work / 'venv'
run('venv', [sys.executable, '-m', 'venv', str(venv)])
python = str(venv / 'bin/python')
run('pip-install', [python, '-m', 'pip', 'install', '--no-input', '--no-cache-dir', '--index-url', 'https://pypi.org/simple',
    '--report', str(proof / 'pip-install.json'), str(package) + '[runtime]'], timeout=480)
installation = json.loads((proof / 'pip-install.json').read_text())
harbor = next(item for item in installation['install'] if item['metadata']['name'].lower() == 'harbor')
assert harbor['metadata']['version'] == '0.25.0'
assert harbor['download_info']['archive_info']['hashes']['sha256'] == '51923ac567fc57b03279e93468b105f689628bcac2cd3d541d4e44aa5c0ec309'
run('pip-freeze', [python, '-m', 'pip', 'freeze', '--all'])
run('node-version', ['node', '--version'])
run('pnpm-tool', ['npm', 'install', '--prefix', str(work / 'tools'), '--ignore-scripts', '--no-audit', '--no-fund', 'pnpm@10.14.0'])
pnpm = str(work / 'tools/node_modules/.bin/pnpm')
run('workspace-install', [pnpm, 'install', '--frozen-lockfile', '--ignore-scripts', '--store-dir', str(work / 'pnpm-store')], timeout=240)
run('core-types', [pnpm, '--filter', '@open-evals/core', 'build'])
run('core-unit', ['node', '--experimental-vm-modules', '--test', 'tests/unit/harbor-tasks.test.mjs'])
run('python-unit', [python, '-m', 'unittest', 'discover', '-s', 'python/open_evals_harbor/tests', '-p', 'test_transport.py', '-v'])
run('fixture-image-pull', ['docker', 'pull', 'ubuntu:24.04'], timeout=120)
images = json.loads(run('fixture-image-inspect', ['docker', 'image', 'inspect', 'ubuntu:24.04', '--format', '{{json .RepoDigests}}']))
image = next(item for item in images if item.startswith('ubuntu@sha256:'))
environment['HARBOR_FIXTURE_IMAGE'] = image
run('native', [python, 'tests/integration/harbor-native.py'], timeout=480)
run('interop', ['node', '--experimental-vm-modules', 'tests/integration/harbor-interop.mjs'])
(proof / 'phases.json').write_text(json.dumps({'source': environment['HARBOR_SOURCE_COMMIT'],
    'transportCaseCount': 29, 'nativeAndInteropCaseCount': 7, 'phasesCompleted': True,
    'providerCalls': 0, 'nativeAgents': ['oracle', 'nop']}, indent=2) + '\n')
