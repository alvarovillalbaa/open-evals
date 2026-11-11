import assert from 'node:assert/strict';
import {readdir,readFile,writeFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {cleanupHarborFixture,guardedPool} from '../helpers/harbor-api-fixture.mjs';
const pool=await guardedPool(),rows=[];
try {
  const root=join(process.env.HARBOR_WORK,'fixtures'),files=await readdir(root).catch(error=>error.code==='ENOENT'?[]:Promise.reject(error));assert.ok(files.length<=8);
  for(const file of files) {
    assert.match(file,/^hbr_[0-9a-f]{32}\.json$/);const path=join(root,file),info=await lstat(path);assert.ok(info.isFile()&&!info.isSymbolicLink()&&info.size<32768);
    const data=JSON.parse(await readFile(path,'utf8'));assert.equal(file,data.prefix+'.json');await cleanupHarborFixture(pool,data);rows.push({fixturePrefix:data.prefix,rowsRemovedAndReadBack:true});
  }
  await writeFile(join(process.env.HARBOR_PROOF,'fixture-cleanup.json'),JSON.stringify({passed:true,fixtures:rows},null,2)+'\n');
}finally{await pool.end();}
