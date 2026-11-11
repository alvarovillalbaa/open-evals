"""Seal final readback only when all independent evidence boundaries agree."""
import hashlib
import json
import os
from pathlib import Path

proof = Path(os.environ['HARBOR_PROOF'])
phases = json.loads((proof / 'phases.json').read_text())
native = json.loads((proof / 'native-checks.json').read_text())
cleanup = json.loads((proof / 'cleanup.json').read_text())
interop = json.loads((proof / 'interop.json').read_text())
assert phases['phasesCompleted'] and phases['source'] == os.environ['HARBOR_SOURCE_COMMIT']
assert native['passed'] and native['cleanupVerifiedForDeclaredDockerProjects']
assert {row['id'] for row in native['cases']} == {'HB-N01', 'HB-N02', 'HB-N03', 'HB-N04', 'HB-R01', 'HB-R02'}
assert all(row['passed'] for row in native['cases']) and interop['passed'] and interop['id'] == 'HB-I01'
assert cleanup['ownedWorkRemoved'] and cleanup['noOpenHandlesVerified'] and not cleanup['errors']
assert cleanup['declaredContainerNetworkVolumeCleanupVerified']
assert (proof / 'source-before.json').read_bytes() == (proof / 'source-after.json').read_bytes()
files = []
for file in sorted(proof.iterdir()):
    assert file.is_file() and not file.is_symlink() and file.stat().st_size <= 8000000
    data = file.read_bytes()
    files.append({'path': file.name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
assert sum(row['bytes'] for row in files) <= 16000000
(proof / 'manifest.json').write_text(json.dumps({'source': phases['source'], 'passed': True, 'files': files,
    'proofLimits': ['authored reference agents only; no model-quality claim', 'Docker image cache and runner disposal not independently verified',
                    'transport and native component only; hosted product persistence/UI acceptance pending']}, indent=2) + '\n')
print('PASS: 29 transport cases, 7 native/result/interop cases, source equality and owned cleanup')
