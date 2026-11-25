export class AudioEngine {
  private context?:AudioContext
  private analyser?:AnalyserNode
  private gain?:GainNode
  private output?:AnalyserNode
  private playback?:AbortController
  private recording?:MediaRecorder
  private stream?:MediaStream
  private input?:MediaStreamAudioSourceNode
  private timer?:ReturnType<typeof setTimeout>
  private opening=0
  private sources=new Set<AudioBufferSourceNode>()
  private sample?:Float32Array<ArrayBuffer>
  async unlock() {
    if(!this.context || this.context.state==='closed'){
      this.context=new AudioContext()
      this.analyser=this.output=this.context.createAnalyser()
      this.analyser.fftSize=512
      this.sample=new Float32Array(this.analyser.fftSize)
      this.gain=this.context.createGain()
      this.gain.connect(this.analyser)
      this.analyser.connect(this.context.destination)
    }
    if(this.context.state!=='running'){
      let timer:ReturnType<typeof setTimeout>|undefined
      try{await Promise.race([this.context.resume(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Audioausgabe konnte nicht aktiviert werden.')),4000)})])}finally{clearTimeout(timer)}
    }
  }
  async microphoneAnalyser(stream:MediaStream){
    await this.unlock()
    const input=this.context!.createMediaStreamSource(stream)
    const analyser=this.context!.createAnalyser();analyser.fftSize=1024
    input.connect(analyser)
    return {analyser,disconnect:()=>input.disconnect()}
  }
  level() {
    if(!this.analyser||!this.sample)return 0
    this.analyser.getFloatTimeDomainData(this.sample)
    let sum=0
    for(const value of this.sample)sum+=value*value
    return Math.sqrt(sum/this.sample.length)
  }
  setVolume(volume:number) {if(this.gain)this.gain.gain.value=volume}
  async record(onFinish:(blob:Blob)=>void) {
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw new Error('Die Mikrofonaufnahme benötigt einen unterstützten Browser und HTTPS.')
    const opening=++this.opening
    this.stopSpeech()
    await this.unlock()
    const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}})
    if(opening!==this.opening){stream.getTracks().forEach(t=>t.stop());return}
    try {
      this.stream=stream
      // A separate analyser observes microphone input without routing it to speakers.
      const mic=this.context!.createAnalyser()
      mic.fftSize=512
      this.input=this.context!.createMediaStreamSource(stream)
      this.input.connect(mic)
      this.analyser=mic
      const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(value=>MediaRecorder.isTypeSupported(value))
      const recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined)
      const chunks:Blob[]=[]
      let bytes=0
      this.recording=recorder
      recorder.ondataavailable=event=>{
        if(!event.data.size)return
        bytes+=event.data.size
        if(bytes<=10*1024*1024)chunks.push(event.data)
        else this.finishRecording(true)
      }
      recorder.onstop=()=>{
        if(opening===this.opening)onFinish(new Blob(chunks,{type:recorder.mimeType}))
      }
      recorder.onerror=()=>this.finishRecording(true)
      recorder.start(250)
      this.timer=setTimeout(()=>this.finishRecording(true),60_000)
    } catch(error) { this.finishRecording(false);throw error }
  }
  cancelPendingRecording() {
    const pending=!this.recording
    this.finishRecording()
    return pending
  }
  finishRecording(deliver=true) {
    if(!deliver||!this.recording)this.opening++
    clearTimeout(this.timer)
    if(this.recording?.state==='recording')this.recording.stop()
    this.recording=undefined
    this.stream?.getTracks().forEach(track=>track.stop())
    this.stream=undefined
    this.input?.disconnect()
    this.input=undefined
    this.analyser=this.output
  }
  stopSpeech() {
    this.playback?.abort()
    this.playback=undefined
    for(const source of this.sources){try{source.stop()}catch{};source.disconnect()}
    this.sources.clear()
  }
  async speak(load:(signal:AbortSignal)=>Promise<Response>,volume:number,onStart:()=>void) {
    this.stopSpeech()
    const controller=new AbortController()
    this.playback=controller
    let timedOut=false
    const timeout=setTimeout(()=>{timedOut=true;controller.abort();this.stopSpeech()},45000)
    try {
      await this.unlock()
      if(controller.signal.aborted)return
      this.setVolume(volume)
      const context=this.context!
      let start=context.currentTime, remainder:number|undefined, started=false
      let last:Promise<void>=Promise.resolve()
      const response=await load(controller.signal)
      if(!response.body)throw new Error('Audiostream nicht verfügbar.')
      const reader=response.body.getReader()
      try{
        for(;;){
          const {value,done}=await reader.read()
          if(done||controller.signal.aborted)break
          let bytes=value
          if(remainder!==undefined){bytes=new Uint8Array(value.length+1);bytes[0]=remainder;bytes.set(value,1)}
          const samples=bytes.length>>1
          remainder=bytes.length%2?bytes[bytes.length-1]:undefined
          if(!samples)continue
          const buffer=context.createBuffer(1,samples,24000)
          const pcm=buffer.getChannelData(0)
          const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
          for(let i=0;i<samples;i++)pcm[i]=view.getInt16(i*2,true)/32768
          const source=context.createBufferSource()
          source.buffer=buffer
          source.connect(this.gain!)
          this.sources.add(source)
          last=new Promise(resolve=>{source.onended=()=>{this.sources.delete(source);source.disconnect();resolve()}})
          start=Math.max(start,context.currentTime+.025)
          source.start(start)
          start+=buffer.duration
          if(!started){started=true;onStart()}
        }
      } finally {await reader.cancel().catch(()=>undefined);reader.releaseLock()}
      await Promise.race([last,new Promise<void>(resolve=>{if(controller.signal.aborted)resolve();else controller.signal.addEventListener('abort',()=>resolve(),{once:true})})])
      if(!started&&!controller.signal.aborted)throw new Error('Fish Audio hat kein Audio geliefert.')
    } catch(error) {if(timedOut)throw new Error('Zeitlimit der Sprachausgabe erreicht.');if(!controller.signal.aborted){this.stopSpeech();throw error}}
    finally {clearTimeout(timeout);if(this.playback===controller)this.playback=undefined}
    if(timedOut)throw new Error('Zeitlimit der Sprachausgabe erreicht.')
  }
  dispose() {
    this.finishRecording(false)
    this.stopSpeech()
    if(this.context && this.context.state!=='closed')void this.context.close().catch(()=>undefined)
  }
}
