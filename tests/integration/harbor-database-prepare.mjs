import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fixtureGuard,MARKER} from '../helpers/harbor-api-fixture.mjs';
const {Pool}=createRequire(new URL('../../packages/db/package.json',import.meta.url))('pg');
const guard=fixtureGuard(),name=new URL(guard.databaseUrl).pathname.slice(1),pool=new Pool({connectionString:guard.databaseUrl,max:1});
try {
  const result=await pool.query("select count(*)::int as count from information_schema.tables where table_schema='public'");assert.equal(result.rows[0].count,0);
  const marker=await pool.query("select shobj_description(oid,'pg_database') as marker from pg_database where datname=current_database()");assert.equal(marker.rows[0].marker,null);
  await pool.query(`comment on database ${name} is '${MARKER}'`);
  for(const path of ['0001_init.sql','0002_hosted_integrations.sql','0003_supabase_hosted_auth_rls.sql'])await pool.query(await readFile(new URL('../../packages/db/migrations/'+path,import.meta.url),'utf8'));
  console.log('Prepared only the empty marked authored disposable database');
}finally{await pool.end();}
