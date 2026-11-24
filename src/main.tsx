import {Component,lazy,Suspense,memo,useCallback,useEffect,useRef,useState,type FormEvent,type ReactNode} from 'react'
import {createRoot} from 'react-dom/client'
import type {Session} from '@supabase/supabase-js'
import {AudioLines,ArrowUp,BrainCircuit,ChevronDown,CircleHelp,Clock3,Download,History as HistoryIcon,Mic,Paperclip,Plus,Settings2,Square,UserRound,Workflow,X} from 'lucide-react'
import type {CoreState} from './Core'
import {AudioEngine} from './audio'
import {consumeChat} from './chat-stream'
import {api,db,defaults,messageFor,type Chat,type Config,type Message,type Profile} from './data'
import {Account,History,Memories,Settings,SidePanel,type Panel} from './Workspace'
import './style.css'

const Core=lazy(()=>import('./Core'))
const labels:Record<CoreState,string>={STANDBY:'Bereit',LISTENING:'Mikrofon aktiv',PROCESSING:'Verarbeitung',SPEAKING:'Sprachausgabe',OFFLINE:'Offline',ERROR:'Systemhinweis'}
const titles={history:'Gesprächsverlauf',settings:'Einstellungen',memory:'Langzeitgedächtnis',integrations:'Integrationen',profile:'Benutzerprofil'}
const suggestions=[
  {icon:BrainCircuit,label:'Ideen entwickeln',prompt:'Hilf mir, Ideen für ein neues Projekt zu entwickeln.'},
  {icon:Workflow,label:'Aufgaben planen',prompt:'Hilf mir, meine Aufgaben für heute zu planen.'},
  {icon:CircleHelp,label:'Etwas erklären',prompt:'Erkläre mir ein komplexes Thema in einfachen Worten: '},
]
type RecognitionResult={isFinal:boolean;0:{transcript:string}}
type Recognition= {
  lang:string;continuous:boolean;interimResults:boolean;
  onresult:((e:{resultIndex:number;results:ArrayLike<RecognitionResult>})=>void)|null;
  onend:(()=>void)|null;onerror:((e:{error:string})=>void)|null;
  start():void;abort():void
}
type InstallEvent=Event & {prompt:()=>Promise<void>;userChoice:Promise<{outcome:string}>}
class CanvasBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false}
  static getDerivedStateFromError(){return {failed:true}}
  render(){return this.state.failed?null:this.props.children}
}
const Time=memo(function Time(){
  const [now,setNow]=useState(new Date())
  useEffect(()=>{const id=setInterval(()=>setNow(new Date()),1000);return ()=>clearInterval(id)},[])
  return <div className="clock"><Clock3 size={17}/><div><time>{now.toLocaleTimeString('de-DE')}</time><span>{now.toLocaleDateString('de-DE',{day:'2-digit',month:'long',year:'numeric'})}</span></div></div>
})
function Mark(){return <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="27" fill="none" stroke="#99602d" strokeDasharray="2 3"/><circle cx="32" cy="32" r="23" fill="none" stroke="#ffc773" strokeDasharray="12 3 2 3"/><circle cx="32" cy="32" r="18" fill="none" stroke="#e89635" strokeDasharray="3 2"/><ellipse cx="32" cy="32" rx="25" ry="12" transform="rotate(-35 32 32)" fill="none" stroke="#ffc773"/><ellipse cx="32" cy="32" rx="25" ry="12" transform="rotate(45 32 32)" fill="none" stroke="#e89635"/><ellipse cx="32" cy="32" rx="12" ry="23" fill="none" stroke="#e89635" opacity=".7"/><circle cx="32" cy="32" r="7" fill="#ffcf85" opacity=".25"/><circle cx="32" cy="32" r="3" fill="#fff1d6"/><path d="M15 32H49M32 15V49" stroke="#ffb44f" opacity=".4"/></svg>}
const Orb=memo(function Orb({mode,level,reduced}:{mode:CoreState;level:React.MutableRefObject<number>;reduced:boolean}){
  return <div className={'orb '+mode.toLowerCase()}>
    <div className="orb-grid"/><div className="orb-aura"/>
    <div className="reticle r1"/><div className="reticle r2"/><div className="reticle r3"/><div className="reticle r4"/>
    <div className="orb-axis horizontal"/><div className="orb-axis vertical"/>
    <div className="orb-fallback"><i/><i/><i/></div>
    <CanvasBoundary><Suspense fallback={null}><Core state={mode} level={level} reduced={reduced}/></Suspense></CanvasBoundary>
    <div className="flare"/>
  </div>
})
function App(){
  const [session,setSession]=useState<Session|null>(null)
  const [recovery,setRecovery]=useState(false)
  const [config,setConfig]=useState<Config>()
  const [profile,setProfile]=useState<Profile>(defaults)
  const [chats,setChats]=useState<Chat[]>([])
  const [messages,setMessages]=useState<Message[]>([])
  const [current,setCurrent]=useState<string>()
  const [panel,setPanel]=useState<Panel>(null)
  const [input,setInput]=useState('')
  const [notice,setNotice]=useState('')
  const [phase,setPhase]=useState<CoreState>('STANDBY')
  const [online,setOnline]=useState(navigator.onLine)
  const [reduced,setReduced]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [install,setInstall]=useState<InstallEvent>()
  const [saved,setSaved]=useState(false)
  const [installHelp,setInstallHelp]=useState(false)
  const [diagnostic,setDiagnostic]=useState('')
  const [diagnosing,setDiagnosing]=useState(false)
  const [handsFree,setHandsFree]=useState(false)
  const [voicePrompt,setVoicePrompt]=useState(true)
  const recognition=useRef<Recognition|null>(null)
  const followupUntil=useRef(0)
  const latestVoice=useRef<(text:string)=>boolean>(()=>false)
  const engine=useRef(new AudioEngine())
  const level=useRef(0)
  const abort=useRef<AbortController>(null)
  const sequence=useRef(0)
  const inputRef=useRef<HTMLTextAreaElement>(null)
  const fileRef=useRef<HTMLInputElement>(null)
  const close=useCallback(()=>setPanel(null),[])
  const report=useCallback((error:unknown)=>{setNotice(messageFor(error));setPhase('ERROR')},[])
  const guest=config?.guest===true
  const authMode=config?.guest===false
  const uid=authMode?session?.user.id:undefined
  const activeUid=useRef(uid)
  activeUid.current=uid
  const busy=phase==='LISTENING'||phase==='PROCESSING'
  const state:CoreState=!online?'OFFLINE':phase
  const refresh=useCallback(async()=>{
    if(!uid||!db)return
    const {data,error}=await db.from('conversations').select('id,title,updated_at').eq('user_id',uid).order('updated_at',{ascending:false})
    if(error)throw new Error(error.message)
    if(activeUid.current===uid)setChats(data)
  },[uid])
  useEffect(()=>{
    if(!db||!authMode)return
    const {data:{subscription}}=db.auth.onAuthStateChange((event,next)=>{
      setSession(next?.user.email_confirmed_at?next:null)
      if(event==='PASSWORD_RECOVERY'){setRecovery(true);setPanel('profile')}
    })
    return ()=>subscription.unsubscribe()
  },[authMode])
  useEffect(()=>{
    setHandsFree(false);
    sequence.current++
    abort.current?.abort()
    engine.current.dispose()
    setPhase('STANDBY');setMessages([]);setCurrent(undefined);setChats([]);setProfile(defaults);setNotice('');setInput('')
    if(!uid||!db)return
    let active=true
    const client=db
    void refresh().catch(error=>{if(active)report(error)})
    void client.from('profiles').select('name,language,voice,volume,speech,memory_enabled').eq('user_id',uid).maybeSingle().then(({data,error})=>{
      if(!active)return
      if(data)setProfile(data)
      if(error)report(new Error(error.message))
    })
    return ()=>{active=false}
  },[uid,refresh,report])
  useEffect(()=>{
    const update=()=>setOnline(navigator.onLine)
    const mq=matchMedia('(prefers-reduced-motion: reduce)')
    const motion=()=>setReduced(mq.matches)
    const installEvent=(e:Event)=>{e.preventDefault();setInstall(e as InstallEvent)}
    const installed=()=>{setInstall(undefined);setInstallHelp(false)}
    const hide=()=>{if(document.hidden && engine.current.cancelPendingRecording())setPhase(value=>value==='LISTENING'?'STANDBY':value)}
    window.addEventListener('online',update);window.addEventListener('offline',update)
    window.addEventListener('beforeinstallprompt',installEvent);window.addEventListener('appinstalled',installed)
    document.addEventListener('visibilitychange',hide)
    mq.addEventListener('change',motion)
    return ()=>{
      window.removeEventListener('online',update);window.removeEventListener('offline',update)
      window.removeEventListener('beforeinstallprompt',installEvent);window.removeEventListener('appinstalled',installed)
      document.removeEventListener('visibilitychange',hide)
      mq.removeEventListener('change',motion)
    }
  },[])
  useEffect(()=>{
    if(!online)return
    const ctl=new AbortController()
    fetch('/api/config',{signal:ctl.signal}).then(response=>{if(!response.ok)throw new Error();return response.json()}).then(setConfig).catch(()=>{
      if(!ctl.signal.aborted)setNotice('Der CORE-Server ist momentan nicht erreichbar.')
    })
    return ()=>ctl.abort()
  },[online])
  useEffect(()=>{
    if(phase!=='LISTENING'&&phase!=='SPEAKING'){level.current=0;return}
    let frame:number
    function tick(){level.current=engine.current.level();frame=requestAnimationFrame(tick)}
    frame=requestAnimationFrame(tick)
    return ()=>cancelAnimationFrame(frame)
  },[phase])
  useEffect(()=>{engine.current.setVolume(profile.volume)},[profile.volume])
  useEffect(()=>()=>{abort.current?.abort();engine.current.dispose()},[])
  function permitted(feature:'chat'|'speech'){
    if(!online){setNotice('Du bist offline. Stelle eine Internetverbindung her.');return false}
    if(!config){report(new Error('Die Serverkonfiguration ist momentan nicht erreichbar.'));return false}
    if(authMode&&(!config.auth||!db)){report(new Error('Supabase ist noch nicht konfiguriert.'));return false}
    if(!config[feature]){
      report(new Error(feature==='chat'?'Groq ist noch nicht konfiguriert. Hinterlege den API-Key auf dem Server.':'Fish Audio ist noch nicht konfiguriert. Hinterlege den API-Key und eine Voice-ID.'))
      return false
    }
    if(authMode&&(!session||recovery)){setPanel('profile');return false}
    return true
  }
  function stopAssistant(){
    followupUntil.current=0
    recognition.current?.abort()
    setHandsFree(false);
  }
  function reset(){
    stopAssistant()
    sequence.current++;abort.current?.abort();engine.current.stopSpeech();engine.current.finishRecording(false)
    setCurrent(undefined);setMessages([]);setInput('');setNotice('');setPhase('STANDBY')
  }
  async function openChat(id:string){
    stopAssistant()
    if(!db||!uid)return
    const client=db
    const ticket=++sequence.current
    engine.current.stopSpeech()
    setNotice('');setPhase('PROCESSING')
    try{
      const all:Message[]=[]
      for(let from=0;;from+=500){
        const {data,error}=await client.from('messages').select('id,role,content').eq('conversation_id',id).order('created_at').order('id').range(from,from+499)
        if(error)throw new Error(error.message)
        if(ticket!==sequence.current)return
        all.push(...data as Message[])
        if(data.length<500)break
      }
      setMessages(all);setCurrent(id);setInput('');setPhase('STANDBY')
    }catch(error){if(ticket===sequence.current)report(error)}
  }
  async function diagnose(kind:'tone'|'fish'|'assistant'){
    if(diagnosing)return
    stopAssistant()
    setDiagnosing(true);setDiagnostic('Test läuft …')
    let stage='Audiofreigabe'
    const controller=new AbortController()
    const timeout=setTimeout(()=>controller.abort(),25000)
    try{
      await engine.current.unlock()
      let answer='Hallo, hier ist CORE. Dies ist ein Sprachtest.'
      if(kind==='assistant'){
        stage='Groq'
        const response=await api('chat',session,{method:'POST',signal:controller.signal,body:JSON.stringify({text:'Antworte nur mit: Hallo, hier ist CORE.',language:'de'})})
        answer=''
        await consumeChat(response,piece=>{answer+=piece})
        if(!answer.trim())throw new Error('Keine Textantwort erhalten.')
      }
      stage=kind==='tone'?'Lokaler Testton':'Fish Audio'
      let bytes:Uint8Array
      if(kind==='tone'){
        bytes=new Uint8Array(24000*2)
        const view=new DataView(bytes.buffer)
        for(let i=0;i<24000;i++)view.setInt16(i*2,Math.round(Math.sin(i*2*Math.PI*440/24000)*6000),true)
      }else{
        const response=await api('speech',session,{method:'POST',signal:controller.signal,body:JSON.stringify({text:answer,voice:profile.voice})})
        bytes=new Uint8Array(await response.arrayBuffer())
        if(bytes.length<2)throw new Error('Keine Audiodaten erhalten.')
      }
      stage='Audiowiedergabe'
      const size=bytes.length
      setDiagnostic((kind==='assistant'?'Groq OK. ':'')+(kind==='tone'?'Testton bereit. ':'Fish Audio HTTP OK: '+size+' Bytes. ')+'Wiedergabe läuft …')
      await engine.current.speak(async()=>new Response(bytes.slice().buffer),0.8,()=>{})
      setDiagnostic((kind==='assistant'?'Groq OK. ':'')+(kind==='tone'?'Testton':'Fish Audio: '+size+' Bytes')+' – Wiedergabe beendet. Hast du etwas gehört?')
    }catch(error){setDiagnostic(stage+': '+(error instanceof Error?error.message:String(error)))}
    finally{clearTimeout(timeout);setDiagnosing(false)}
  }
  async function speak(text:string,ticket=++sequence.current){
    if(!permitted('speech'))return
    engine.current.stopSpeech()
    setNotice('');setPhase('PROCESSING')
    try {
      await engine.current.speak(signal=>api('speech',session,{method:'POST',signal,body:JSON.stringify({text,voice:profile.voice})}),profile.volume,()=>{
        if(ticket===sequence.current)setPhase('SPEAKING')
      })
      if(ticket===sequence.current)setPhase('STANDBY')
    }catch(error){if(ticket===sequence.current)report(error)}
  }
  async function send(text=input,existingTicket?:number,forceSpeech=false){
    const clean=text.trim()
    if(!clean||!permitted('chat'))return
    const ticket=existingTicket??++sequence.current
    engine.current.stopSpeech()
    if((forceSpeech||profile.speech)&&config?.speech)void engine.current.unlock().catch(()=>undefined)
    const controller=new AbortController()
    abort.current?.abort();abort.current=controller
    setNotice('');setPhase('PROCESSING');setInput('')
    const previous=messages
    const body=guest?{text:clean,language:profile.language,history:previous.slice(-4)
      .filter(message=>message.content.length>0)
      .map(({role,content})=>({role,content:content.slice(0,2000)}))}:{conversationId:current,text:clean}
    const user:Message={role:'user',content:clean}
    setMessages([...previous,user])
    let answer='', id=current
    try {
      const response=await api('chat',session,{method:'POST',signal:controller.signal,body:JSON.stringify(body)})
      id=response.headers.get('X-Conversation-Id')||current
      if(ticket!==sequence.current)return
      setCurrent(id)
      await consumeChat(response,piece=>{
        answer+=piece
        if(ticket===sequence.current)setMessages([...previous,user,{role:'assistant',content:answer}])
      })
      if(ticket!==sequence.current)return
      setPhase('STANDBY')
      void refresh().catch(report)
      if((forceSpeech||profile.speech)&&config?.speech)await speak(answer,ticket)
    }catch(error){
      if(ticket!==sequence.current||controller.signal.aborted)return
      const savedId=(error as {conversationId?:string}).conversationId||id
      if(savedId){setCurrent(savedId);void refresh().catch(report)}
      else {setMessages(previous);setInput(clean)}
      if(answer&&savedId)setMessages([...previous,user])
      report(error)
    }finally{if(abort.current===controller)abort.current=null}
  }
  latestVoice.current=(text)=>{
    const command=text.trim()
    const wake=command.match(/^hey[\s,!.:-]+(?:core|kor|kore|chor)\b[\s,!.?:-]*/i)
    if(!wake&&Date.now()>followupUntil.current)return false
    followupUntil.current=0
    const request=wake?command.slice(wake[0].length).trim():command
    recognition.current?.abort()
    if(/^(?:stopp|stop|schlafmodus|ruhe)[.!]?$/i.test(request)){stopAssistant();return true}
    if(!request)void speak('Ja, ich höre zu.').then(()=>{followupUntil.current=Date.now()+12000})
    else void send(request,undefined,true)
    return true
  }
  useEffect(()=>{
    if(!handsFree||(phase!=='STANDBY'&&phase!=='ERROR')||!online)return
    const browser=window as unknown as {SpeechRecognition?:new()=>Recognition;webkitSpeechRecognition?:new()=>Recognition}
    const Constructor=browser.SpeechRecognition||browser.webkitSpeechRecognition
    if(!Constructor){setHandsFree(false);setNotice('Dieser Browser unterstützt keine automatische Spracherkennung.');return}
    const r=new Constructor()
    recognition.current=r
    r.lang=profile.language==='en'?'en-US':'de-DE'
    r.continuous=true;r.interimResults=false
    let active=true, timer:ReturnType<typeof setTimeout>|undefined, failures=0, handled=false
    const retry=(delay=700)=>{clearTimeout(timer);if(active&&!document.hidden&&!handled)timer=setTimeout(start,delay)}
    const start=()=>{if(active&&!document.hidden&&!handled){try{r.start()}catch{retry(1200)}}}
    r.onresult=e=>{
      failures=0
      for(let i=e.resultIndex;i<e.results.length;i++){
        if(e.results[i].isFinal&&!handled&&e.results[i][0].transcript.trim()){
          if(latestVoice.current(e.results[i][0].transcript.trim())){handled=true;clearTimeout(timer);break}
        }
      }
    }
    r.onerror=e=>{
      if(!active||handled)return
      if(['not-allowed','service-not-allowed','audio-capture'].includes(e.error)){
        setNotice('Mikrofonzugriff nicht verfügbar: '+e.error)
        retry(3000);return
      }
      failures++
      retry(Math.min(3000,500*failures))
    }
    r.onend=()=>retry()
    const visibility=()=>{if(document.hidden){clearTimeout(timer);r.abort()}else retry()}
    document.addEventListener('visibilitychange',visibility)
    retry(900)
    return ()=>{active=false;clearTimeout(timer);r.onend=null;r.onresult=null;r.onerror=null;r.abort();document.removeEventListener('visibilitychange',visibility);if(recognition.current===r)recognition.current=null}
  },[handsFree,phase,online,profile.language,uid])
  async function activateCore(){
    if(busy||!permitted('chat')||!permitted('speech'))return
    try{
      await engine.current.unlock()
      recognition.current?.abort()
      setVoicePrompt(false);setHandsFree(true)
      await speak('Ja, ich höre zu.')
      followupUntil.current=Date.now()+12000
    }catch(error){report(error)}
  }
  async function toggleAssistant(){
    if(handsFree){stopAssistant();interrupt();return}
    if(busy||!permitted('chat')||!permitted('speech'))return
    const browser=window as unknown as {SpeechRecognition?:unknown;webkitSpeechRecognition?:unknown}
    if(!browser.SpeechRecognition&&!browser.webkitSpeechRecognition){setNotice('Automatische Spracherkennung wird in diesem Browser nicht unterstützt.');return}
    try{await engine.current.unlock();setVoicePrompt(false);setNotice('');setPhase('STANDBY');setHandsFree(true)}catch(error){report(error)}
  }
  async function microphone(){
    if(handsFree)stopAssistant()
    if(phase==='LISTENING'){if(engine.current.cancelPendingRecording())setPhase('STANDBY');return}
    if(busy||!permitted('chat'))return
    const ticket=++sequence.current
    setNotice('');setPhase('LISTENING')
    try{
      await engine.current.record(blob=>{
        if(ticket!==sequence.current)return
        if(!blob.size){report(new Error('Keine Aufnahme erkannt.'));return}
        setPhase('PROCESSING')
        const controller=new AbortController()
        abort.current=controller
        void api('transcribe',session,{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/octet-stream'},body:blob})
          .then(r=>r.json()).then(({text})=>{
            if(ticket!==sequence.current)return
            if(!text)throw new Error('Whisper hat keine Sprache erkannt.')
            setInput(text);setPhase('STANDBY')
            void send(text,ticket,true)
          }).catch(error=>{if(ticket===sequence.current&&!controller.signal.aborted)report(error)})
          .finally(()=>{if(abort.current===controller)abort.current=null})
      })
    }catch(error){if(ticket===sequence.current)report(error)}
  }
  function interrupt(){
    stopAssistant()
    sequence.current++;abort.current?.abort();engine.current.stopSpeech();engine.current.finishRecording(false);setPhase('STANDBY')
  }
  async function save(next:Profile){
    if(guest){setProfile(next);setSaved(true);return}
    if(!authMode)return
    if(!db||!uid||recovery){setPanel('profile');return}
    const {error}=await db.from('profiles').upsert({...next,user_id:uid})
    if(error){report(new Error(error.message));return}
    if(activeUid.current===uid){setProfile(next);setSaved(true)}
  }
  async function attach(file?:File){
    if(!file||(!guest&&!session))return
    if(file.size>8*1024*1024){report(new Error('Dateien dürfen höchstens 8 MB groß sein.'));return}
    const mime=file.type||({txt:'text/plain',pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'} as Record<string,string>)[file.name.split('.').pop()?.toLowerCase()||'']||''
    try{
      await api('files/validate?mime='+encodeURIComponent(mime),session,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file})
      setNotice('Dateiformat geprüft. Dokumenten- und Bildanalyse ist derzeit deaktiviert.')
    }catch(error){report(error)}
  }
  function submit(event:FormEvent){event.preventDefault();if(!busy)void send()}
  function switchPanel(next:Panel){setSaved(false);setPanel(value=>value===next?null:next)}
  const last=messages.at(-1)
  const setup=config?(authMode&&!config.auth?'Supabase einrichten':!config.chat?'Groq einrichten':guest?'Gastmodus':null):null
  return <div className="app">
    <header className="topbar">
      <button className="brand" aria-label="CORE Startseite" onClick={()=>{if(!busy){reset();close()}}}><Mark/><span><b>INTEL AI CORE</b><small>KI-KOMMANDOZENTRALE</small></span></button>
      <div className="top-actions"><Time/>{authMode&&<><span className="top-separator"/><button className="profile-btn" onClick={()=>switchPanel('profile')}><UserRound size={17}/><span>{session?(profile.name||'Profil'):'Anmelden'}</span></button></>}</div>
    </header>
    <nav className="rail" aria-label="Kommandonavigation">
      <div>
        <button title="Neuer Chat" aria-label="Neuer Chat" disabled={busy} onClick={reset}><Plus size={20}/></button>
        <button title="Gesprächsverlauf" aria-label="Gesprächsverlauf" aria-pressed={panel==='history'} onClick={()=>switchPanel('history')}><HistoryIcon size={19}/></button>
        {authMode&&<button title="Langzeitgedächtnis" aria-label="Langzeitgedächtnis" aria-pressed={panel==='memory'} onClick={()=>switchPanel('memory')}><BrainCircuit size={19}/></button>}
        <button title="Integrationen" aria-label="Integrationen" aria-pressed={panel==='integrations'} onClick={()=>switchPanel('integrations')}><Workflow size={19}/></button>
      </div>
      <button title="Einstellungen" aria-label="Einstellungen" aria-pressed={panel==='settings'} onClick={()=>switchPanel('settings')}><Settings2 size={19}/></button>
    </nav>
    <main className="command">
      <div className="stage">
        <div className="core-label"><span/> NEURALER KERN <span/></div>
        <button type="button" aria-label="CORE aktivieren" title="CORE aktivieren" disabled={busy} onClick={()=>void activateCore()} style={{display:"grid",placeItems:"center",width:"100%",border:0,background:"transparent",cursor:"pointer"}}><Orb mode={state} level={level} reduced={reduced}/></button>
        <div className="identity"><h1>INTEL AI CORE</h1><p>Intelligent AI Core · Dein persönlicher KI-Assistent</p><div className={'status '+state.toLowerCase()} role="status"><i/>{handsFree&&state==='STANDBY'?'Warte auf Hey CORE':labels[state]}</div></div>
      </div>
      <div className="interaction">
        {notice&&<div className="feedback" role="alert">{notice}<button className="icon-button" aria-label="Hinweis schließen" onClick={()=>{setNotice('');if(phase==='ERROR')setPhase('STANDBY')}}><X size={16}/></button></div>}
        {!notice&&last&&<div className="latest" aria-live={phase==='PROCESSING'?'off':'polite'}><b>{last.role==='assistant'?'CORE':'Du'}</b><div>{last.content}</div><button className="icon-button" title="Gespräch öffnen" aria-label="Gespräch öffnen" onClick={()=>setPanel('history')}><ChevronDown size={16}/></button></div>}
        {!last&&!notice&&<div className="suggestions">{suggestions.map(({icon:Icon,label,prompt})=><button key={label} onClick={()=>{setInput(prompt);inputRef.current?.focus()}}><Icon size={15}/>{label}</button>)}</div>}
        <form className="composer" onSubmit={submit}>
          <input type="file" accept=".pdf,.txt,.docx,.png,.jpg,.jpeg,.webp" hidden ref={fileRef} onChange={e=>{void attach(e.target.files?.[0]);e.target.value=''}}/>
          <button type="button" className="icon-button attachment" aria-label="Dateiformat prüfen" title="Dateiformat prüfen" onClick={()=>{if(guest||session)fileRef.current?.click();else if(authMode)setPanel('profile')}}><Paperclip size={18}/></button>
          <textarea ref={inputRef} aria-label="Nachricht an CORE" placeholder="Nachricht an CORE …" rows={2} value={input} maxLength={8000} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(!busy)void send()}}}/>
          <button type="button" className={'icon-button mic '+(phase==='LISTENING'?'recording':'')} aria-label={phase==='LISTENING'?'Aufnahme beenden':'Mikrofon aktivieren'} disabled={phase==='PROCESSING'} onClick={()=>void microphone()}>{phase==='LISTENING'?<Square size={16}/>:<Mic size={19}/>}</button>
          {(phase==='SPEAKING'||phase==='PROCESSING')&&<button type="button" className="icon-button" aria-label="Unterbrechen" title="Unterbrechen" onClick={interrupt}><Square size={16}/></button>}
          <button type="submit" className="send" aria-label="Nachricht senden" disabled={busy||!input.trim()}><ArrowUp size={21}/></button>
        </form>
        <div className="composer-meta"><span><AudioLines size={13}/> SPRACHE & TEXT</span><button type="button" aria-pressed={handsFree} disabled={busy&&!handsFree} onClick={()=>void toggleAssistant()} style={{color:handsFree?'#55e6ff':undefined,background:'transparent',border:'1px solid currentColor',borderRadius:6,padding:'4px 7px',cursor:'pointer'}}>{handsFree?'Sprachmodus: AN':'Sprachmodus starten'}</button><span>{setup||'ENTER ZUM SENDEN'}</span></div>
      </div>
    </main>
    <footer><div><i className={online?'':'off'}/>{online?'SYSTEM ONLINE':'SYSTEM OFFLINE'}</div><span>intelaicore.org</span><button className="install" onClick={async()=>{if(install){await install.prompt();await install.userChoice;setInstall(undefined)}else setInstallHelp(v=>!v)}}><Download size={13}/> Installieren</button></footer>
    {voicePrompt&&config&&(guest||session&&!recovery)&&<div role="dialog" aria-modal="true" aria-label="Sprachassistent starten" style={{position:'fixed',inset:0,zIndex:1000,display:'grid',placeItems:'center',background:'rgba(0,0,0,.78)',padding:20}}><div style={{maxWidth:360,width:'100%',background:'#15110d',border:'1px solid #8d693e',borderRadius:16,padding:24,color:'#f1d2a5',textAlign:'center'}}><Mic size={30}/><h2>CORE Sprachmodus</h2><p>Erlaube das Mikrofon und beginne jede Frage mit „Hey CORE“. Die Spracherkennung des Browsers kann gesprochene Sätze zur Verarbeitung übertragen.</p><button className="action-btn" onClick={()=>{setVoicePrompt(false);void toggleAssistant()}}>Mikrofon zulassen</button><button className="action-btn" onClick={()=>setVoicePrompt(false)}>Nur Text verwenden</button></div></div>}
    {installHelp&&<div className="install-help" role="status">iOS: In Safari „Teilen“ und „Zum Home-Bildschirm“ wählen. Auf Android oder Desktop die Installationsoption im Browsermenü öffnen.</div>}
    {panel&&<SidePanel title={titles[panel]} close={close}>
      {panel==='history'&&(guest||session&&!recovery?<History guest={guest} chats={chats} id={current} messages={messages} newChat={()=>{reset();close()}} open={id=>void openChat(id)} refresh={refresh} report={report} speak={text=>void speak(text)} busy={busy}/>:authMode&&<button className="action-btn" onClick={()=>setPanel('profile')}>Anmelden</button>)}
      {panel==='settings'&&<><Settings profile={profile} config={config} save={save}/><section style={{padding:16,display:'grid',gap:10}}><h3>Sprachdiagnose</h3><button className="action-btn" disabled={diagnosing||busy} onClick={()=>void diagnose('tone')}>1. Testton abspielen</button><button className="action-btn" disabled={diagnosing||busy} onClick={()=>void diagnose('fish')}>2. Fish Audio testen</button><button className="action-btn" disabled={diagnosing||busy} onClick={()=>void diagnose('assistant')}>3. Groq + Sprachausgabe testen</button><p role="status" style={{overflowWrap:'anywhere'}}>{diagnostic}</p><p>Für den Mikrofontest anschließend den Sprachmodus starten und eine Frage stellen.</p></section></>}
      {panel==='memory'&&(!session||recovery?<button className="action-btn" onClick={()=>setPanel('profile')}>Anmelden</button>:<Memories userId={session.user.id} profile={profile} save={save} report={report}/>)}
      {panel==='integrations'&&<div className="fields"><p className="muted">Schnittstellen für zukünftige Versionen.</p><ul className="integrations">{config?.integrations.map(name=><li key={name}>{name}<small>Geplant</small></li>)}</ul></div>}
      {authMode&&panel==='profile'&&<Account session={session} profile={profile} save={save} report={report} recovery={recovery} config={config} onRecoveryDone={()=>setRecovery(false)}/>}
      {saved&&<p className="notice" role="status">Gespeichert.</p>}
      {phase==='ERROR'&&notice&&<p className="notice" role="status">{notice}</p>}
    </SidePanel>}
  </div>
}
createRoot(document.getElementById('root')!).render(<App/>)
if(import.meta.env.PROD&&'serviceWorker' in navigator)window.addEventListener('load',()=>void navigator.serviceWorker.register('/sw.js').catch(()=>undefined))
