"""One authored task, actual installed Harbor oracle/nop, bounded original evidence."""
import copy
import hashlib
from importlib.metadata import version
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from uuid import uuid4

import open_evals_harbor.bundle as bundle_module
import open_evals_harbor.runner as runner_module
from open_evals_harbor.bundle import BundleError, canonical, load_bundle, pack_task, stage_bundle
from open_evals_harbor.runner import _environment, _native_result, execute_bundle

proof = Path(os.environ['HARBOR_PROOF'])
work = Path(os.environ['HARBOR_WORK'])
source = Path.cwd()
socket = '/var/run/docker.sock'
assert version('harbor') == '0.25.0' and version('open-evals-harbor') == '0.1.0'
assert Path(bundle_module.__file__).resolve().is_relative_to(Path(sys.prefix).resolve())
assert Path(runner_module.__file__).resolve().is_relative_to(Path(sys.prefix).resolve())
for name in ('bundle.py', 'runner.py', 'cli.py', '__init__.py'):
    assert (Path(bundle_module.__file__).parent / name).read_bytes() == (source / 'python/open_evals_harbor/src/open_evals_harbor' / name).read_bytes()

def command(args):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120, check=True)
    assert len(result.stdout) <= 131072 and len(result.stderr) <= 131072
    return result.stdout.decode().strip()

def resource_ids(kind, project):
    args = ['docker', kind, 'ls', '-q', '--filter', 'label=com.docker.compose.project=' + project]
    if kind == 'container':
        args.insert(3, '-a')
    return command(args).splitlines()

executions = {agent: str(uuid4()) for agent in ('oracle', 'nop')}
projects = ['oe-harbor-' + value + '__env' for value in executions.values()]
(proof / 'ownership.json').write_text(json.dumps({'executionIds': executions, 'dockerProjects': projects,
    'source': os.environ['HARBOR_SOURCE_COMMIT'], 'fixturesAuthored': True, 'providerModel': None}, indent=2) + '\n')
for project in projects:
    assert all(not resource_ids(kind, project) for kind in ('container', 'network', 'volume'))

image = os.environ['HARBOR_FIXTURE_IMAGE']
assert re.fullmatch(r'(?:docker.io/library/)?ubuntu@sha256:[0-9a-f]{64}', image)
fixture = work / 'fixture'
fixture.mkdir(mode=0o700)
for path in ('task.toml', 'instruction.md', 'solution/solve.sh', 'tests/test.sh'):
    target = fixture / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes((source / 'tests/fixtures/harbor-native' / path).read_bytes())
    target.chmod(0o755 if path.endswith('.sh') else 0o644)
dockerfile = fixture / 'environment/Dockerfile'
dockerfile.parent.mkdir()
dockerfile.write_text((source / 'tests/fixtures/harbor-native/environment/Dockerfile.in').read_text().replace('APPROVED_UBUNTU_IMAGE', image))
report = {'source': os.environ['HARBOR_SOURCE_COMMIT'], 'python': sys.version, 'harbor': version('harbor'),
          'installedComponent': version('open-evals-harbor'), 'image': image, 'cases': [], 'passed': False,
          'cleanupVerifiedForDeclaredDockerProjects': False, 'processGroupsIndependentlyVerified': False}
cleanup_errors = []
try:
    executable = str(Path(sys.executable).parent / 'open-evals-harbor')
    bundle_file = proof / 'native-bundle.json'
    packed = json.loads(command([executable, 'pack', '--task', str(fixture), '--out', str(bundle_file)]))
    bundle = load_bundle(bundle_file.read_bytes())
    assert packed['bundleFingerprint'] == bundle['fingerprint'] and packed['executed'] is False
    assert pack_task(fixture) == bundle
    report['cases'].append({'id': 'HB-N01', 'passed': True, 'boundary': 'installed CLI/native Task validation and content-bound snapshot'})
    # Synthetic markers, never real credentials. Neither may reach native children.
    os.environ['OPEN_EVALS_API_KEY'] = 'authored-marker-do-not-forward'
    os.environ['GITHUB_TOKEN'] = 'authored-marker-do-not-forward'
    child = _environment([], socket)
    assert not any(name in child for name in ('OPEN_EVALS_API_KEY', 'GITHUB_TOKEN', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'))
    assert child['HARBOR_TELEMETRY'] == '0' and child['DOCKER_HOST'].startswith('unix://')
    original = None
    for index, (agent, expected) in enumerate((('oracle', 1), ('nop', 0)), 2):
        result = execute_bundle(bundle, execution_id=executions[agent], agent=agent, timeout_seconds=180,
                                work_root=work, docker_socket=socket, execute=True)
        (proof / (agent + '-report.json')).write_text(json.dumps(result, indent=2) + '\n')
        owned = work / ('open-evals-harbor-' + executions[agent])
        for name in ('stdout.log', 'stderr.log'):
            file = owned / name
            if file.exists():
                assert file.stat().st_size <= 512 * 1024
                shutil.copyfile(file, proof / (agent + '-' + name))
        raw_result = owned / 'trials' / ('oe-harbor-' + executions[agent]) / 'result.json'
        if raw_result.exists():
            assert raw_result.stat().st_size <= 1024 * 1024
            shutil.copyfile(raw_result, proof / (agent + '-native-result.json'))
        assert result['outcome'] == 'completed', result
        assert result['agent']['kind'] == 'reference' and result['agent']['model'] is None
        assert result['nativeRewardValid'] and result['rewards'] == {'reward': expected}
        assert result['nativeChecksum'] == bundle['nativeChecksum'] and result['stagedTaskRemoved']
        assert result['process']['exitCode'] == 0 and not result['process']['interruption']
        assert all(row['complete'] and row['bytes'] == row['retainedBytes'] for row in result['process']['streams'].values())
        assert all(not resource_ids(kind, 'oe-harbor-' + executions[agent] + '__env') for kind in ('container', 'network', 'volume'))
        report['cases'].append({'id': 'HB-N0' + str(index), 'passed': True, 'agent': agent,
                                'nativeTrialId': result['nativeTrialId'], 'reward': expected, 'nativeResultSha256': result['nativeResultSha256']})
        if agent == 'oracle':
            original = json.loads(raw_result.read_text())
    # An unchanged transport hash alone cannot attest a native task checksum.
    forged = copy.deepcopy(bundle)
    forged['nativeChecksum'] = '0' * 64
    identity = {key: value for key, value in forged.items() if key not in ('files', 'fingerprint')}
    identity['files'] = [{key: value for key, value in file.items() if key != 'content'} for file in forged['files']]
    forged['fingerprint'] = hashlib.sha256(canonical(identity).encode()).hexdigest()
    rejected = False
    try:
        with stage_bundle(forged, work / 'forged-task'):
            raise AssertionError('Forged native checksum entered execution')
    except BundleError as error:
        rejected = str(error) == 'harbor_native_identity_mismatch'
    assert rejected and not (work / 'forged-task').exists()
    report['cases'].append({'id': 'HB-N04', 'passed': True, 'boundary': 'native metadata cannot be forged by resealing transport'})
    # Mutate copies, never the original Harbor result or its source task.
    assert original is not None
    trial_name = original['trial_name']
    copies = work / 'result-copies'
    copies.mkdir()
    for name in ('boolean-reward', 'exception-with-reward'):
        trials = copies / name
        destination = trials / trial_name / 'result.json'
        destination.parent.mkdir(parents=True)
        value = copy.deepcopy(original)
        if name == 'boolean-reward':
            value['verifier_result']['rewards']['reward'] = True
        else:
            value['exception_info'] = {'exception_type': 'AgentTimeoutError', 'exception_message': 'authored fixture',
                'exception_traceback': 'authored fixture', 'occurred_at': value['finished_at']}
        destination.write_text(json.dumps(value))
        if name == 'boolean-reward':
            try:
                _native_result(trials, bundle, Path(original['config']['task']['path']), {'name': 'oracle', 'model': None, 'kind': 'reference'}, trial_name)
                raise AssertionError('Boolean reward was accepted as a numeric result')
            except BundleError as error:
                assert str(error) == 'harbor_trial_rewards_invalid'
        else:
            normalized = _native_result(trials, bundle, Path(original['config']['task']['path']), {'name': 'oracle', 'model': None, 'kind': 'reference'}, trial_name)
            assert normalized['outcome'] == 'operational_error' and normalized['exceptionType'] == 'AgentTimeoutError'
    report['cases'].extend([{'id': 'HB-R01', 'passed': True, 'boundary': 'actual-result copy rejects boolean reward'},
                            {'id': 'HB-R02', 'passed': True, 'boundary': 'actual-result copy preserves operational failure despite reward'}])
    report['passed'] = True
finally:
    for project in projects:
        for kind, remove in (('container', ['container', 'rm', '--force']), ('network', ['network', 'rm']), ('volume', ['volume', 'rm'])):
            try:
                ids = resource_ids(kind, project)
                assert all(re.fullmatch(r'[A-Za-z0-9_.-]+', value) for value in ids)
                if ids:
                    command(['docker', *remove, *ids])
                assert not resource_ids(kind, project)
            except Exception as error:
                cleanup_errors.append({'project': project, 'kind': kind, 'type': type(error).__name__})
    report['cleanupVerifiedForDeclaredDockerProjects'] = not cleanup_errors
    report['cleanupErrors'] = cleanup_errors
    (proof / 'native-checks.json').write_text(json.dumps(report, indent=2) + '\n')
    if cleanup_errors:
        raise AssertionError('Declared Docker cleanup is unverified')
print(json.dumps({'passed': report['passed'], 'caseIds': [row['id'] for row in report['cases']], 'bundleFingerprint': bundle['fingerprint']}))
