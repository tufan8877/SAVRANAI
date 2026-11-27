import {test} from 'node:test'
import {strict as assert} from 'node:assert'
import {AudioEngine} from '../src/audio'

test('PCM playback observes real samples and interruption aborts pending audio',async()=>{
  let stopped=0
  const analyser={fftSize:512,connect(){},getFloatTimeDomainData(data:Float32Array){data.fill(.25)}}
  const gain={gain:{value:1},connect(){}}
  const destination={}
  const source={playbackRate:{value:1},connect(){},disconnect(){},start(){},buffer:null,onended:()=>{},stop(){stopped++;this.onended()}}
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
      let cancelled=false
      return new Response(new ReadableStream({
        start(controller){
          controller.enqueue(new Uint8Array([0,64,0,192]))
          current.addEventListener('abort',()=>{if(!cancelled)controller.close()},{once:true})
        },
        cancel(){cancelled=true},
      }))
    },.6,onStart)
    await started
    assert.deepEqual([...samples],[.5,-.5])
    assert.equal(engine.level(),.25)
    assert.equal(gain.gain.value,.6)
    assert.equal(source.playbackRate.value,1.06)
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
