import {test} from 'node:test'
import {strict as assert} from 'node:assert'
import {once} from 'node:events'
import {readFile} from 'node:fs/promises'
import {consumeChat} from '../src/chat-stream'

test('API protects private routes and streams provider responses without exposing secrets',async()=>{
  process.env.AUTH_ENABLED='true'
  process.env.VITE_SUPABASE_URL='https://supabase.invalid'
  process.env.VITE_SUPABASE_ANON_KEY='public-fixture'
  process.env.GROQ_API_KEY='groq-fixture'
  process.env.FISH_AUDIO_API_KEY='speech-fixture'
  process.env.FISH_AUDIO_VOICE_ID='voice-fixture'
  const id='00000000-0000-4000-8000-000000000003'
  const user='00000000-0000-4000-8000-000000000001'
  const realFetch=globalThis.fetch
  const writes:Record<string,string>[]=[]
  let providerCalls=0
  globalThis.fetch=async (resource,init)=>{
    const url=new URL(resource instanceof Request?resource.url:resource.toString())
    if(url.hostname==='supabase.invalid'){
      const token=new Headers(init?.headers).get('Authorization')
      if(url.pathname==='/auth/v1/user'){
        if(token==='Bearer confirmed')return Response.json({id:user,email_confirmed_at:'2025-01-01'})
        return Response.json({message:'Invalid token'},{status:401})
      }
      assert.equal(token,'Bearer confirmed')
      if(url.pathname.endsWith('/conversations'))return init?.method==='POST'?Response.json({id}):new Response(null,{status:204})
      if(url.pathname.endsWith('/profiles'))return Response.json([])
      if(url.pathname.endsWith('/messages')){
        if(init?.method==='POST'){writes.push(JSON.parse(String(init.body)));return new Response(null,{status:201})}
        return Response.json([{role:'assistant',content:'Earlier answer'}])
      }
    }
    if(url.hostname==='api.groq.com'){
      providerCalls++
      assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer groq-fixture')
      if(url.pathname.endsWith('/transcriptions')){
        const form=init!.body as FormData
        assert.equal(form.get('model'),'whisper-large-v3-turbo')
        assert.equal(form.get('language'),null)
        return Response.json({text:' Guten Morgen '})
      }
      const body=JSON.parse(String(init?.body))
      assert.equal(body.stream,true)
      assert.equal(body.messages.at(-2).content,'Earlier answer')
      return new Response('data: {"choices":[{"delta":{"content":"Guten "}}]}\n\ndata: {"choices":[{"delta":{"content":"Tag"}}]}\n\ndata: [DONE]\n\n')
    }
    if(url.hostname==='api.fish.audio'){
      assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer speech-fixture')
      assert.equal(url.pathname,'/v1/tts')
      const speech=JSON.parse(String(init?.body))
      assert.equal(speech.format,'pcm')
      assert.equal(speech.sample_rate,24000)
      assert.equal(speech.reference_id,'voice-fixture')
      return new Response(new Uint8Array([0,0,1,0]))
    }
    return realFetch(resource,init)
  }
  const {app}=await import('../server/index')
  const server=app.listen(0,'127.0.0.1')
  try{
    await once(server,'listening')
    const address=server.address()
    assert.ok(address&&typeof address!=='string')
    const base='http://127.0.0.1:'+address.port+'/api/'
    const request=(path:string,body:unknown,token?:string)=>realFetch(base+path,{
      method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)})
    const config=await realFetch(base+'config')
    assert.equal(config.headers.get('cache-control'),'no-store')
    assert.doesNotMatch(await config.text(),/groq-fixture|speech-fixture/)
    assert.equal((await realFetch(base+'config',{headers:{Origin:'https://unauthorized.invalid'}})).status,403)
    assert.equal((await request('chat',{text:'test'})).status,401)
    assert.equal((await request('chat',{text:'test'},'bad')).status,401)
    assert.equal((await request('chat',{text:''},'confirmed')).status,400)
    assert.equal(providerCalls,0)
    const response=await request('chat',{text:'Hallo'},'confirmed')
    assert.equal(response.status,200)
    assert.equal(response.headers.get('X-Conversation-Id'),id)
    let answer=''
    await consumeChat(response,chunk=>{answer+=chunk})
    assert.equal(answer,'Guten Tag')
    assert.deepEqual(writes.map(row=>[row.role,row.content]),[['user','Hallo'],['assistant','Guten Tag']])
    assert.equal((await request('speech',{text:answer,voice:'unlisted'},'confirmed')).status,400)
    const audio=await request('speech',{text:answer},'confirmed')
    assert.deepEqual([...new Uint8Array(await audio.arrayBuffer())],[0,0,1,0])
    const upload=async(path:string,body:BodyInit)=>realFetch(base+path,{method:'POST',headers:{
      Authorization:'Bearer confirmed','Content-Type':'application/octet-stream'},body})
    const wav=new Uint8Array(48)
    const view=new DataView(wav.buffer)
    wav.set(Buffer.from('RIFF'),0);view.setUint32(4,40,true);wav.set(Buffer.from('WAVEfmt '),8)
    view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true)
    wav.set(Buffer.from('data'),36);view.setUint32(40,4,true)
    assert.deepEqual(await (await upload('transcribe',wav)).json(),{text:'Guten Morgen'})
    assert.equal((await upload('transcribe','bad data')).status,415)
    const png=await readFile(new URL('../public/icon-192.png',import.meta.url))
    assert.equal((await upload('files/validate?mime=text/plain',png)).status,415)
    assert.deepEqual(await (await upload('files/validate?mime=image/png',png)).json(),{format:'png',analysisAvailable:false})
  }finally{
    server.close()
    globalThis.fetch=realFetch
  }
})
