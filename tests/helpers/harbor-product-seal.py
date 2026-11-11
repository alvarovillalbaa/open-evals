import hashlib
import json
import os
from pathlib import Path
import re
proof=Path(os.environ['HARBOR_PROOF'])
phases=json.loads((proof/'phases.json').read_text());api=json.loads((proof/'api-checks.json').read_text());browser=json.loads((proof/'browser-results.json').read_text());cleanup=json.loads((proof/'cleanup.json').read_text())
assert phases['passed'] and phases['source']==os.environ['HARBOR_SOURCE_COMMIT']
assert api['passed'] and {row['id'] for row in api['cases']}=={f'HB-A{i:02d}' for i in range(1,24)} and all(row['passed'] for row in api['cases'])
specs=[]
def walk(suite):
    specs.extend(suite.get('specs',[]))
    for child in suite.get('suites',[]):walk(child)
for suite in browser['suites']:walk(suite)
assert len(specs)==4 and {spec['title'].split()[0] for spec in specs}=={f'HB-B{i:02d}' for i in range(1,5)}
assert all(spec['ok'] and len(spec['tests'])==1 and len(spec['tests'][0]['results'])==1 and spec['tests'][0]['results'][0]['status']=='passed' for spec in specs)
assert re.search(r'^# pass 34$',(proof/'protocol.stdout').read_text(),re.M) and re.search(r'^# fail 0$',(proof/'protocol.stdout').read_text(),re.M)
assert cleanup['ownedWorkRemoved'] and cleanup['noOpenHandlesVerified'] and cleanup['databaseContainerRemovedAndReadBack'] and not cleanup['errors']
assert json.loads((proof/'fixture-cleanup.json').read_text())['passed']
assert (proof/'source-before.json').read_bytes()==(proof/'source-after.json').read_bytes()
result=json.loads((proof/'bridge-result.json').read_text());original=(proof/'bridge-native-original.json').read_bytes()
assert result['nativeResultSha256']==hashlib.sha256(original).hexdigest()==api['nativeRun']['nativeResultSha256']
assert result['outcome']=='completed' and result['rewards']=={'reward':1} and result['agent']['kind']=='reference'
files=[]
for file in sorted(proof.rglob('*')):
    if file.is_dir():continue
    assert file.is_file() and not file.is_symlink();data=file.read_bytes();assert len(data)<=8000000
    files.append({'path':str(file.relative_to(proof)),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
assert sum(row['bytes'] for row in files)<=16000000
(proof/'manifest.json').write_text(json.dumps({'source':phases['source'],'passed':True,'files':files,'limits':['authored PostgreSQL and Chromium; hosted provider/session acceptance remains separate','one actual oracle reference run; no model-quality or provider performance claim','Docker image caches and runner disposal not independently verified']},indent=2)+'\n')
print('PASS: 18 protocol, 23 API/SDK/CLI, 4 browser cases; 16 transport regressions; normal build; native original result; owned cleanup')
