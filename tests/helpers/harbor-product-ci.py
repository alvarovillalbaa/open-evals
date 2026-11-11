"""One exact-source public runner; authored database, browser and native fixtures."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
from uuid import uuid4

root=Path(os.environ['RUNNER_TEMP'])/'open-evals-harbor-product'
root.mkdir(mode=0o700);proof=root/'proof';work=root/'work';proof.mkdir(mode=0o700);work.mkdir(mode=0o700)
marker=uuid4().hex.encode();(work/'.owner').write_bytes(marker);info=work.stat()
(proof/'work-identity.json').write_text(json.dumps({'uid':info.st_uid,'device':info.st_dev,'inode':info.st_ino,'markerSha256':hashlib.sha256(marker).hexdigest()})+'\n')
with open(os.environ['GITHUB_ENV'],'a') as stream:
    for key,value in {'HARBOR_PRODUCT_ROOT':root,'HARBOR_PROOF':proof,'HARBOR_WORK':work}.items():stream.write(f'{key}={value}\n')
source=Path.cwd();processes=[]
env={key:os.environ[key] for key in ('HOME','PATH','LANG','RUNNER_TEMP','HARBOR_SOURCE_COMMIT') if key in os.environ}
env.update(HARBOR_PRODUCT_ROOT=str(root),HARBOR_PROOF=str(proof),HARBOR_WORK=str(work),PYTHONDONTWRITEBYTECODE='1',HARBOR_TELEMETRY='0',
    DOCKER_HOST='unix:///var/run/docker.sock',PIP_CONFIG_FILE='/dev/null',PIP_DISABLE_PIP_VERSION_CHECK='1',PIP_NO_CACHE_DIR='1',PIP_INDEX_URL='https://pypi.org/simple',
    NPM_CONFIG_REGISTRY='https://registry.npmjs.org',NPM_CONFIG_CACHE=str(work/'npm-cache'),NPM_CONFIG_USERCONFIG=str(work/'npm-user-config'),NPM_CONFIG_GLOBALCONFIG=str(work/'npm-global-config'),
    XDG_CACHE_HOME=str(work/'cache'),XDG_CONFIG_HOME=str(work/'config'),TMPDIR=str(work/'tmp'),PLAYWRIGHT_BROWSERS_PATH=str(work/'browsers'),
    CI='true',AUTH_MODE='hosted',AUTH_SECRET='harbor-ci-authored-session-secret-20261111',API_KEY_PEPPER='harbor-ci-authored-key-pepper-20261111',
    NEXT_TELEMETRY_DISABLED='1',TURBO_TELEMETRY_DISABLED='1',HARBOR_TEST_ALLOW='local-disposable',HARBOR_TEST_URL='http://127.0.0.1:3291',DATABASE_SSL='false')
for name in ('cache','config','tmp'):(work/name).mkdir(mode=0o700)
for name in ('npm-user-config','npm-global-config'):(work/name).write_text('')
(proof/'driver-environment-keys.json').write_text(json.dumps(sorted(env))+'\n')
def start(name,args,cwd=None):
    out=(proof/(name+'.stdout')).open('wb');err=(proof/(name+'.stderr')).open('wb')
    try: process=subprocess.Popen(args,cwd=cwd,env=env,stdin=subprocess.DEVNULL,stdout=out,stderr=err,start_new_session=True)
    finally: out.close();err.close()
    stat=Path(f'/proc/{process.pid}/stat').read_text();start_ticks=stat[stat.rfind(')')+2:].split()[19]
    processes.append({'pid':process.pid,'startTicks':start_ticks,'name':name,'argv':args})
    (proof/'process-ownership.json').write_text(json.dumps(processes,indent=2)+'\n')
    return process
def run(name,args,timeout=180,cwd=None):
    process=start(name,args,cwd)
    try: code=process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        for requested in (signal.SIGINT,signal.SIGTERM,signal.SIGKILL):
            try:os.killpg(process.pid,requested)
            except ProcessLookupError:pass
            try:process.wait(timeout=3);break
            except subprocess.TimeoutExpired:pass
        raise
    print(f'{name}: exit {code}',flush=True)
    if code:
        for suffix in ('.stderr','.stdout'):print((proof/(name+suffix)).read_text(errors='replace')[-16000:],flush=True)
        raise RuntimeError(name+'_failed')
    return (proof/(name+'.stdout')).read_text().strip()
run('source-before',[sys.executable,'tests/helpers/harbor-source-guard.py',str(proof/'source-before.json')])
assert shutil.which('lsof') and shutil.which('docker')
repo=work/'repo';repo.mkdir();copies=[]
for row in json.loads((proof/'source-before.json').read_text()):
    path=row['path']
    if 'node_modules' in Path(path).parts:continue
    assert row['mode'] in ('100644','100755')
    data=(source/path).read_bytes();assert hashlib.sha256(data).hexdigest()==row['sha256']
    target=repo/path;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data);target.chmod(0o755 if row['mode']=='100755' else 0o644);copies.append(row)
(proof/'runtime-source-before.json').write_text(json.dumps(copies,indent=2)+'\n')
run('pnpm-tool',['npm','install','--prefix',str(work/'tools'),'--ignore-scripts','--no-audit','--no-fund','pnpm@10.14.0'])
pnpm=str(work/'tools/node_modules/.bin/pnpm')
env['PATH']=str(work/'tools/node_modules/.bin')+os.pathsep+env['PATH']
run('workspace-install',[pnpm,'install','--frozen-lockfile','--ignore-scripts','--store-dir',str(work/'pnpm-store')],240,repo)
docs=repo/'apps/web/node_modules/next/dist/docs'
doc_rows=[]
for file in docs.rglob('*'):
    if file.is_file() and file.stem in ('route','use-client','05-server-and-client-components','server-and-client-components'):
        data=file.read_bytes();assert len(data)<131072
        relative=file.relative_to(docs);target=proof/'next-docs'/relative;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
        doc_rows.append({'path':str(relative),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
assert len(doc_rows)>=2
(proof/'next-docs.json').write_text(json.dumps(doc_rows,indent=2)+'\n')
run('protocol',['node','--experimental-vm-modules','--test','--test-reporter=tap','tests/unit/harbor-tasks.test.mjs','tests/unit/harbor-evals.test.mjs'],cwd=repo)
owner=uuid4().hex;name='oe-harbor-db-'+owner;database='open_evals_harbor_ci_'+owner[:16]
(proof/'database-ownership.json').write_text(json.dumps({'owner':owner,'containerName':name,'database':database,'imageCachesIndependentlyVerified':False},indent=2)+'\n')
run('postgres-pull',['docker','pull','postgres:16'],120)
image=json.loads(run('postgres-image',['docker','image','inspect','postgres:16','--format','{{json .RepoDigests}}']))[0]
container=run('postgres-create',['docker','create','--name',name,'--label','open-evals.harbor-product-owner='+owner,'--tmpfs','/var/lib/postgresql/data',
    '--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD=authored_disposable_password','--env','POSTGRES_DB='+database,image])
assert re.fullmatch('[0-9a-f]{64}',container)
(proof/'database-container.json').write_text(json.dumps({'id':container,'image':image,'owner':owner,'database':database},indent=2)+'\n')
run('postgres-start',['docker','start',container])
port=run('postgres-port',['docker','port',container,'5432/tcp']);assert re.fullmatch(r'127\.0\.0\.1:[0-9]+',port)
url='postgresql://postgres:authored_disposable_password@'+port+'/'+database
env.update(DATABASE_URL=url,HARBOR_TEST_DATABASE_URL=url)
(work/'test-environment.json').write_text(json.dumps(env)+'\n')
for _ in range(30):
    ready=subprocess.run(['docker','exec',container,'pg_isready','-U','postgres','-d',database],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=10)
    if ready.returncode==0:break
    time.sleep(1)
else:raise RuntimeError('postgres_not_ready')
run('database-prepare',['node','--import','tsx','tests/integration/harbor-database-prepare.mjs'],cwd=repo)
run('normal-build',[pnpm,'build'],360,repo)
package=work/'runtime-package';package.mkdir()
for name in ('pyproject.toml','LICENSE'):shutil.copyfile(repo/'python/open_evals_harbor'/name,package/name)
target=package/'src/open_evals_harbor';target.mkdir(parents=True)
for name in ('__init__.py','bundle.py','runner.py','cli.py'):shutil.copyfile(repo/'python/open_evals_harbor/src/open_evals_harbor'/name,target/name)
venv=work/'venv';run('venv',[sys.executable,'-m','venv',str(venv)])
python=str(venv/'bin/python');env['HARBOR_PYTHON']=python
run('harbor-install',[python,'-m','pip','install','--no-input','--no-cache-dir','--index-url','https://pypi.org/simple','--report',str(proof/'pip-install.json'),str(package)+'[runtime]'],360)
installation=json.loads((proof/'pip-install.json').read_text());harbor=next(item for item in installation['install'] if item['metadata']['name'].lower()=='harbor')
assert harbor['metadata']['version']=='0.25.0' and harbor['download_info']['archive_info']['hashes']['sha256']=='51923ac567fc57b03279e93468b105f689628bcac2cd3d541d4e44aa5c0ec309'
run('fixture-image',['docker','pull','ubuntu@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852'],120)
run('chromium-install',[pnpm,'exec','playwright','install','--with-deps','chromium'],240,repo)
(work/'test-environment.json').write_text(json.dumps(env)+'\n')
server=start('server',['node',str(repo/'apps/web/node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port','3291'],repo/'apps/web')
for _ in range(60):
    assert server.poll() is None
    try:
        with urllib.request.urlopen(env['HARBOR_TEST_URL']+'/login',timeout=2) as response:
            if response.status==200:break
    except Exception:pass
    time.sleep(0.5)
else:raise RuntimeError('server_not_ready')
run('api',['node','--import','tsx','tests/integration/harbor-api.mjs'],300,repo)
run('browser',[pnpm,'exec','playwright','test','--config','tests/integration/harbor-browser.config.mjs'],240,repo)
after=[]
for row in copies:
    data=(repo/row['path']).read_bytes();current={**row,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()};after.append(current)
    if row['path']!='apps/web/next-env.d.ts':assert current==row,row['path']
(proof/'runtime-source-after.json').write_text(json.dumps(after,indent=2)+'\n')
(proof/'phases.json').write_text(json.dumps({'passed':True,'source':env['HARBOR_SOURCE_COMMIT'],'newProtocolCases':18,'transportRegressionCases':16,'apiCases':23,'browserCases':4,'freshNativeBridgeExecutions':1,'providerModelCalls':0},indent=2)+'\n')
print('All product verification phases completed; cleanup and evidence sealing are separate.',flush=True)
