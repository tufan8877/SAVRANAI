import {test} from 'node:test'
import {strict as assert} from 'node:assert'
import {AudioEngine} from '../src/audio'

test('PCM playback observes real samples and interruption aborts pending audio',async()=>{
  let stopped=0
  const analyser={fftSize:512,connect(){},getFloatTimeDomainData(data:Float32Array){data.fill(.25)}}
  const gain={gain:{value:1},connect(){}}
  const destination={}
  const source={connect(){},disconnect(){},start(){},buffer:null,onended:()=>{},stop(){stopped++;this.onended()}}
  const samples=new Float32Array(2)
  const original=Object.getOwnPropertyDescriptor(globalThis,'AudioContext')
  Object.defineProperty(globalThis,'AudioContext',{configurable:true,value:class {
    state='running';currentTime=1;destination=destination
    createAnalyser(){return analyser}
    createGain(){return gain}
    createBuffer(){return {getChannelData:()=>samples,duration:.001}}
    createBufferSource(){return source}
    async close(){this.state='closed'}
  }})
  const engine=new AudioEngine()
  try {
    let signal:AbortSignal|undefined
    let onStart!:()=>void
    const started=new Promise<void>(resolve=>{onStart=resolve})
    const playback=engine.speak(async current=>{
      signal=current
      return new Response(new ReadableStream({
        start(controller){
          controller.enqueue(new Uint8Array([0,64,0,192]))
          current.addEventListener('abort',()=>controller.close(),{once:true})
        },
      }))
    },.6,onStart)
    await started
    assert.deepEqual([...samples],[.5,-.5])
    assert.equal(engine.level(),.25)
    assert.equal(gain.gain.value,.6)
    engine.stopSpeech()
    assert.equal(signal?.aborted,true)
    assert.equal(stopped,1)
    await playback
  } finally {
    engine.dispose()
    if(original)Object.defineProperty(globalThis,'AudioContext',original)
    else Reflect.deleteProperty(globalThis,'AudioContext')
  }
})

test('microphone delivers the recording after a speech pause',async t=>{
  t.mock.timers.enable({apis:['setInterval','setTimeout']})
  let now=0
  let level=.05
  let stopped=0
  t.mock.method(performance,'now',()=>now)
  const track={stop(){stopped++}}
  const analyser={fftSize:512,connect(){},getFloatTimeDomainData(data:Float32Array){data.fill(level)}}
  const replacements={
    AudioContext:class {
      state='running'
      createAnalyser(){return analyser}
      createGain(){return {connect(){}}}
      createMediaStreamSource(){return {connect(){},disconnect(){}}}
      async close(){}
    },
    MediaRecorder:class {
      static isTypeSupported(){return true}
      state='inactive'
      mimeType='audio/webm'
      ondataavailable?: (event:{data:Blob})=>void
      onstop?: ()=>void
      start(){this.state='recording'}
      stop(){
        this.state='inactive'
        queueMicrotask(()=>{
          this.ondataavailable?.({data:new Blob(['audio'])})
          this.onstop?.()
        })
      }
    },
    navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[track]})}},
  }
  const originals=Object.keys(replacements).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const)
  for(const [key,value] of Object.entries(replacements))Object.defineProperty(globalThis,key,{configurable:true,value})
  const engine=new AudioEngine()
  try {
    let recorded:Blob|undefined
    await engine.record(blob=>{recorded=blob})
    now=50
    t.mock.timers.tick(50)
    level=0
    now=1100
    t.mock.timers.tick(1050)
    assert.equal(stopped,0)
    now=1150
    t.mock.timers.tick(50)
    await Promise.resolve()
    assert.equal(stopped,1)
    assert.equal(await recorded?.text(),'audio')
  } finally {
    engine.dispose()
    for(const [key,descriptor] of originals){
      if(descriptor)Object.defineProperty(globalThis,key,descriptor)
      else Reflect.deleteProperty(globalThis,key)
    }
  }
})
