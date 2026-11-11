"""Stop declared runner processes, remove authored data, then retire owned storage."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import time

root=Path(os.environ['RUNNER_TEMP'])/'open-evals-harbor-product'
assert root==Path(os.environ['HARBOR_PRODUCT_ROOT']) and not root.is_symlink()
proof=root/'proof';work=root/'work'
report={'errors':[],'signals':[],'nativeDockerProjects':[],'ownedWorkRemoved':False,'imageCachesAndRunnerDisposalIndependentlyVerified':False}
def call(args,env=None,cwd=None,timeout=60):
    result=subprocess.run(args,env=env,cwd=cwd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
    assert len(result.stdout)<1048576 and len(result.stderr)<1048576
    if result.returncode:raise RuntimeError('cleanup_command_failed')
    return result.stdout.decode().strip()
def process_start(pid):
    try:
        raw=Path(f'/proc/{pid}/stat').read_text();return raw[raw.rfind(')')+2:].split()[19]
    except FileNotFoundError:return None
def live_work_processes():
    rows=[]
    for line in call(['ps','-eo','pid=,pgid=,args=']).splitlines():
        parts=line.strip().split(None,2)
        if len(parts)==3 and str(work) in parts[2] and int(parts[0])!=os.getpid():rows.append((int(parts[0]),int(parts[1]),parts[2]))
    return rows
try:
    declared=json.loads((proof/'process-ownership.json').read_text()) if (proof/'process-ownership.json').exists() else []
    for row in reversed(declared):
        if process_start(row['pid'])!=row['startTicks']:continue
        try:os.killpg(row['pid'],signal.SIGTERM);report['signals'].append({'pid':row['pid'],'signal':'TERM','phase':row['name']})
        except ProcessLookupError:pass
    time.sleep(1)
    for row in declared:
        if process_start(row['pid'])!=row['startTicks']:continue
        try:os.killpg(row['pid'],signal.SIGKILL);report['signals'].append({'pid':row['pid'],'signal':'KILL','phase':row['name']})
        except ProcessLookupError:pass
    journals=work/'cli-journals';projects=[]
    if journals.exists():
        paths=list(journals.iterdir());assert len(paths)<=2
        for path in paths:
            assert re.fullmatch(r'harbor-run-[0-9a-f-]{36}',path.name) and path.is_dir() and not path.is_symlink()
            reserved=path/'reserved.json'
            if not reserved.exists():continue
            assert reserved.stat().st_size<8388608
            value=json.loads(reserved.read_text());assert path.name=='harbor-run-'+value['run']['runId'] and len(value['run']['rows'])<=4
            for row in value['run']['rows']:
                execution=row['executionId'];assert re.fullmatch(r'[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}',execution)
                projects.append('oe-harbor-'+execution+'__env')
                owned=path/row['versionId']/('open-evals-harbor-'+execution)
                original=owned/'trials'/('oe-harbor-'+execution)/'result.json'
                result=path/row['versionId']/'result.json'
                if original.exists() and result.exists():
                    data=original.read_bytes();assert len(data)<1048576
                    claimed=json.loads(result.read_text());assert hashlib.sha256(data).hexdigest()==claimed['nativeResultSha256']
                    (proof/'bridge-native-original.json').write_bytes(data)
                    shutil.copyfile(result,proof/'bridge-result.json')
                    for console in ('stdout.log','stderr.log'):
                        file=owned/console
                        if file.exists():assert file.stat().st_size<=524288;shutil.copyfile(file,proof/('bridge-'+console))
    assert len(projects)<=8 and len(projects)==len(set(projects))
    for pid,group,args in live_work_processes():
        if any(project.removesuffix('__env') in args for project in projects) and ('harbor.cli.main' in args or 'open_evals_harbor.cli' in args or '--project-name' in args):
            try:os.killpg(group,signal.SIGKILL);report['signals'].append({'pid':pid,'pgid':group,'signal':'KILL','phase':'declared_native'})
            except ProcessLookupError:pass
    environment_file=work/'test-environment.json'
    fixtures=work/'fixtures'
    if fixtures.exists() and list(fixtures.iterdir()):
        assert environment_file.stat().st_size<65536
        env=json.loads(environment_file.read_text())
        result=subprocess.run(['node','--import','tsx','tests/integration/harbor-fixture-cleanup.mjs'],env=env,cwd=work/'repo',stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=60)
        (proof/'fixture-cleanup.stdout').write_bytes(result.stdout);(proof/'fixture-cleanup.stderr').write_bytes(result.stderr)
        assert result.returncode==0
    else:(proof/'fixture-cleanup.json').write_text(json.dumps({'passed':True,'fixtures':[]})+'\n')
    for project in projects:
        item={'project':project,'removed':{}}
        for kind in ('container','network','volume'):
            args=['docker',kind,'ls','-q','--filter','label=com.docker.compose.project='+project]
            if kind=='container':args.insert(3,'-a')
            ids=call(args).splitlines();assert all(re.fullmatch('[A-Za-z0-9_.-]+',value) for value in ids)
            if ids:call(['docker',kind,'rm',*(['--force'] if kind=='container' else []),*ids])
            assert not call(args);item['removed'][kind]=ids
        report['nativeDockerProjects'].append(item)
    ownership=proof/'database-ownership.json'
    if ownership.exists():
        owner=json.loads(ownership.read_text());assert re.fullmatch('[0-9a-f]{32}',owner['owner'])
        assert owner['containerName']=='oe-harbor-db-'+owner['owner'] and owner['database']=='open_evals_harbor_ci_'+owner['owner'][:16]
        args=['docker','container','ls','-aq','--filter','label=open-evals.harbor-product-owner='+owner['owner']]
        ids=call(args).splitlines();assert len(ids)<=1 and all(re.fullmatch('[0-9a-f]{12,64}',value) for value in ids)
        if ids:
            inspected=json.loads(call(['docker','inspect',ids[0]]))[0]
            assert inspected['Name']=='/'+owner['containerName'] and inspected['Config']['Labels']['open-evals.harbor-product-owner']==owner['owner']
            call(['docker','container','rm','--force','--volumes',ids[0]])
        assert not call(args);report['databaseContainerRemovedAndReadBack']=True
    remaining=live_work_processes();report['remainingWorkArgvProcesses']=[{'pid':pid,'pgid':group} for pid,group,_ in remaining]
    assert not remaining
    handles=subprocess.run(['sudo','-n','lsof','-nP','-t','+D',str(work)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30)
    report['openHandleCheck']={'exitCode':handles.returncode,'stdoutBytes':len(handles.stdout),'stderrBytes':len(handles.stderr)}
    report['noOpenHandlesVerified']=handles.returncode==1 and not handles.stdout and not handles.stderr
    assert report['noOpenHandlesVerified']
    identity=json.loads((proof/'work-identity.json').read_text());info=work.lstat()
    assert work.is_dir() and not work.is_symlink() and info.st_uid==os.getuid()==identity['uid']
    assert (info.st_dev,info.st_ino)==(identity['device'],identity['inode']) and hashlib.sha256((work/'.owner').read_bytes()).hexdigest()==identity['markerSha256']
    shutil.rmtree(work);report['ownedWorkRemoved']=not work.exists()
except Exception as error:report['errors'].append({'type':type(error).__name__,'code':str(error) if re.fullmatch('[a-z_]+',str(error)) else 'cleanup_unverified'})
finally:(proof/'cleanup.json').write_text(json.dumps(report,indent=2)+'\n')
if report['errors'] or not report['ownedWorkRemoved']:raise SystemExit(1)
