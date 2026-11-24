import {test} from 'node:test'
import {strict as assert} from 'node:assert'
import {once} from 'node:events'
import {spawn} from 'node:child_process'
import {createServer} from 'node:net'
import {existsSync} from 'node:fs'

test('production entry point serves the app shell and reports missing provider configuration', {skip:!existsSync('build/index.js') || !existsSync('dist/sw.js')},async()=>{
  const reservation=createServer().listen(0,'127.0.0.1')
  await once(reservation,'listening')
  const address=reservation.address()
  assert.ok(address&&typeof address!=='string')
  await new Promise<void>(resolve=>reservation.close(()=>resolve()))
  const child=spawn(process.execPath,['build/index.js'],{
    env:{...process.env,PORT:String(address.port),NODE_ENV:'production',AUTH_ENABLED:'false',VITE_SUPABASE_URL:'',VITE_SUPABASE_ANON_KEY:'',
      GROQ_API_KEY:'',ELEVENLABS_API_KEY:'',SUPABASE_SERVICE_ROLE_KEY:''},
    stdio:['ignore','pipe','pipe'],
  })
  const closed=once(child,'exit')
  const startup=new Promise<void>((resolve,reject)=>{
    child.stdout!.once('data',chunk=>String(chunk).includes('SAVRAN API gestartet')?resolve():reject(new Error('Unexpected startup output')))
    child.once('exit',()=>reject(new Error('Production server exited before startup')))
  })
  try{
    await startup
    const base='http://127.0.0.1:'+address.port
    const health=await fetch(base+'/api/health')
    assert.deepEqual(await health.json(),{ok:true})
    const page=await fetch(base+'/')
    assert.match(page.headers.get('content-security-policy')||'',/script-src 'self'/)
    assert.match(await page.text(),/<title>S\.A\.V\.R\.A\.N\./)
    const manifest=await (await fetch(base+'/manifest.webmanifest')).json()
    assert.equal(manifest.display,'standalone')
    const worker=await (await fetch(base+'/sw.js')).text()
    assert.match(worker,/savran-shell-[a-f0-9]{16}/)
    assert.doesNotMatch(worker,/__SHELL_FILES__/)
    const config=await (await fetch(base+'/api/config')).json()
    assert.equal(config.guest,true)
    assert.deepEqual([config.auth,config.chat,config.speech],[false,false,false])
    const chat=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"text":"Hallo"}'})
    assert.equal(chat.status,503)
    assert.equal((await chat.json()).error.code,'groq_config')
  }finally{child.kill();await closed}
})
