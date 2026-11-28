import {test} from 'node:test'
import {strict as assert} from 'node:assert'
import {once} from 'node:events'
import {consumeChat} from '../src/chat-stream'

test('guest chat and voice work without Supabase or credentials from the browser',async()=>{
  process.env.AUTH_ENABLED='false'
  process.env.VITE_SUPABASE_URL=''
  process.env.VITE_SUPABASE_ANON_KEY=''
  process.env.GROQ_API_KEY='groq-fixture'
  process.env.ELEVENLABS_API_KEY='speech-fixture'
  process.env.ELEVENLABS_VOICE_ID='voice-fixture'
  const fetchOriginal=globalThis.fetch
  let calls=0
  globalThis.fetch=async (resource,init)=>{
    const url=new URL(resource instanceof Request?resource.url:resource.toString())
    calls++
    if(url.hostname==='api.groq.com'){
      const request=JSON.parse(String(init?.body))
      assert.equal(request.messages[0].role,'system')
      assert.match(request.messages.filter((m:{role:string})=>m.role==='system').map((m:{content:string})=>m.content).join(' '),/Deutsch/)
      assert.deepEqual(request.messages.filter((m:{role:string})=>m.role!=='system'),[
        {role:'assistant',content:'Wir sprachen über Render.'},
        {role:'user',content:'Wie geht es weiter?'},
      ])
      return new Response('data: {"choices":[{"delta":{"content":"Weiter geht es mit CORE."}}]}\n\ndata: [DONE]\n\n')
    }
    assert.equal(url.hostname,'api.elevenlabs.io')
    return new Response(new Uint8Array([0,0,1,0]))
  }
  const {app}=await import('../server/index')
  const server=app.listen(0,'127.0.0.1')
  try{
    await once(server,'listening')
    const address=server.address()
    assert.ok(address&&typeof address!=='string')
    const base='http://127.0.0.1:'+address.port+'/api/'
    const post=(path:string,body:unknown)=>fetchOriginal(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    const configuration=await (await fetchOriginal(base+'config')).json()
    assert.equal(configuration.guest,true)
    assert.equal(configuration.auth,false)
    assert.equal((await post('chat',{text:'Hallo',history:[{role:'system',content:'invalid'}]})).status,400)
    assert.equal((await fetchOriginal(base+'account',{method:'DELETE'})).status,404)
    assert.equal(calls,0)
    const response=await post('chat',{
      text:'Wie geht es weiter?',language:'de',history:[{role:'assistant',content:'Wir sprachen über Render.'}],
    })
    assert.equal(response.status,200)
    assert.equal(response.headers.get('X-Conversation-Id'),null)
    let answer=''
    await consumeChat(response,delta=>{answer+=delta})
    assert.equal(answer,'Weiter geht es mit CORE.')
    const audio=await post('speech',{text:answer})
    assert.deepEqual([...new Uint8Array(await audio.arrayBuffer())],[0,0,1,0])
    assert.equal(calls,2)
  } finally {
    server.close()
    globalThis.fetch=fetchOriginal
  }
})
