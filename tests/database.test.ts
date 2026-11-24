import {test} from 'node:test'
import {strict as assert} from 'node:assert'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'

test('migration isolates users, requires memory consent and cascades deletion',async()=>{
  const db=new PGlite()
  const alice='00000000-0000-4000-8000-000000000001'
  const bob='00000000-0000-4000-8000-000000000002'
  const chat='00000000-0000-4000-8000-000000000003'
  const login=(id:string)=>db.exec(`reset role; set test.uid='${id}'; set role authenticated;`)
  try{
    await db.exec(`
      create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
      grant usage on schema auth to authenticated;
      insert into auth.users values ('${alice}'),('${bob}');
    `)
    await db.exec(await readFile(new URL('../supabase/migrations/202611230001_initial.sql',import.meta.url),'utf8'))
    await login(alice)
    await db.exec(`insert into profiles(name) values ('Alice');
      insert into conversations(id,title) values ('${chat}','Private');
      insert into messages(conversation_id,role,content) values ('${chat}','user','secret');`)
    await assert.rejects(db.exec("insert into memories(content) values ('private')"),/row-level security/)
    await db.exec("update profiles set memory_enabled=true; insert into memories(content) values ('private');")
    assert.equal((await db.query("select * from public.search_conversations('secret')")).rows.length,1)
    await login(bob)
    assert.equal((await db.query("select * from public.search_conversations('secret')")).rows.length,0)
    for(const table of ['profiles','conversations','messages','memories']){
      assert.deepEqual((await db.query('select * from '+table)).rows,[])
      assert.deepEqual((await db.query('delete from '+table+' returning *')).rows,[])
    }
    await assert.rejects(db.exec(`insert into messages(conversation_id,role,content) values ('${chat}','user','other');`),/foreign key/)
    await assert.rejects(db.exec(`insert into memories(user_id,content) values ('${alice}','other');`),/row-level security/)
    await db.exec('reset role; set role anon;')
    await assert.rejects(db.exec('select * from memories'),/permission denied/)
    await db.exec(`reset role; delete from auth.users where id='${alice}';`)
    for(const table of ['profiles','conversations','messages','memories'])assert.deepEqual((await db.query('select * from '+table)).rows,[])
  }finally{await db.close()}
})
