const wakePhrase=/^he[yi][\s,]+s\.?\s*a\.?\s*v\.?\s*r\.?\s*a\.?\s*n(?=$|[\s,.!?;:–—-])[\s,.!?;:–—-]*/i

export function wakePrompt(transcript:string):string|undefined {
  const text=transcript.trim()
  const match=wakePhrase.exec(text)
  return match ? text.slice(match[0].length).trim() : undefined
}

type RecognitionResult={isFinal:boolean;[index:number]:{transcript:string}}
interface Recognition {
  lang:string
  continuous:boolean
  onresult:((event:{resultIndex:number;results:ArrayLike<RecognitionResult>})=>void)|null
  onerror:((event:{error:string})=>void)|null
  onstart:(()=>void)|null
  onend:(()=>void)|null
  start():void
  abort():void
}

export function wakeRecognition() {
  const browser=globalThis as typeof globalThis & {
    SpeechRecognition?:new()=>Recognition
    webkitSpeechRecognition?:new()=>Recognition
  }
  return browser.SpeechRecognition??browser.webkitSpeechRecognition
}

export function startWakeListener(Recognition:new()=>Recognition,callbacks:{
  ready:()=>void
  blocked:()=>void
  wake:(prompt:string)=>void
  question?:boolean
}){
  const recognition=new Recognition()
  recognition.lang='de-DE'
  recognition.continuous=!callbacks.question
  let stopped=false
  let restart:ReturnType<typeof setTimeout>|undefined
  let networkFailures=0
  let delay=300
  function stop(){
    if(stopped)return
    stopped=true
    clearTimeout(restart)
    recognition.onresult=recognition.onerror=recognition.onstart=recognition.onend=null
    recognition.abort()
  }
  function start(){
    if(stopped)return
    try{recognition.start()}catch{stop();callbacks.blocked()}
  }
  recognition.onstart=callbacks.ready
  recognition.onerror=({error})=>{
    if(error==='no-speech'||error==='aborted')return
    if(error==='network'&&++networkFailures<3){delay=3000;return}
    stop()
    callbacks.blocked()
  }
  recognition.onend=()=>{
    if(!stopped)restart=setTimeout(start,delay)
    delay=300
  }
  recognition.onresult=({resultIndex,results})=>{
    networkFailures=0
    for(let i=resultIndex;i<results.length;i++){
      const result=results[i]
      if(!result.isFinal)continue
      const text=result[0].transcript.trim()
      const prompt=callbacks.question?(text||undefined):wakePrompt(text)
      if(prompt===undefined)continue
      stop()
      callbacks.wake(prompt)
      return
    }
  }
  start()
  return stop
}
