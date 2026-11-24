import {useEffect,useState,type FormEvent,type ReactNode} from 'react'
import type {Session} from '@supabase/supabase-js'
import {AudioLines,Copy,LogOut,Pencil,Plus,Search,Trash2,X} from 'lucide-react'
import {api,db,messageFor,type Chat,type Config,type Memory,type Message,type Profile} from './data'

export type Panel = 'history'|'settings'|'memory'|'integrations'|'profile'|null
export function SidePanel({title,close,children}:{title:string;close:()=>void;children:ReactNode}) {
  useEffect(()=>{
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')close()}
    window.addEventListener('keydown',escape)
    return ()=>window.removeEventListener('keydown',escape)
  },[close])
  return <aside className="drawer" aria-label={title}>
    <div className="drawer-head"><h2>{title}</h2><button className="icon-button" aria-label="Schließen" onClick={close}><X size={19}/></button></div>
    {children}
  </aside>
}
export function History({chats,id,messages,newChat,open,refresh,report,speak,busy}:{
  chats:Chat[];id?:string;messages:Message[];newChat:()=>void;open:(id:string)=>void;
  refresh:()=>Promise<void>;report:(error:unknown)=>void;speak:(text:string)=>void;busy:boolean
}) {
  const [search,setSearch]=useState('')
  const [results,setResults]=useState<Chat[]>()
  useEffect(()=>{
    const client=db
    if(!client||!search.trim())return
    const request=new AbortController()
    const timer=setTimeout(()=>{
      void client.rpc('search_conversations',{search_query:search.trim()}).abortSignal(request.signal).then(({data,error})=>{
        if(request.signal.aborted)return
        if(error){report(new Error(error.message));return}
        setResults(data)
      })
    },250)
    return ()=>{clearTimeout(timer);request.abort()}
  },[search,chats,report])
  const [editing,setEditing]=useState<string>()
  const [title,setTitle]=useState('')
  const [copied,setCopied]=useState<number>()
  async function change(chat:Chat,remove=false) {
    if(!db)return
    if(remove&&!confirm('Dieses Gespräch und alle Nachrichten löschen?'))return
    try {
      const result=remove?await db.from('conversations').delete().eq('id',chat.id):
        await db.from('conversations').update({title:title.trim()}).eq('id',chat.id)
      if(result.error)throw new Error(result.error.message)
      if(remove&&id===chat.id)newChat()
      setEditing(undefined)
      await refresh()
    }catch(error){report(error)}
  }
  return <>
    <button className="action-btn" onClick={newChat} disabled={busy}><Plus size={16}/> Neues Gespräch</button>
    <label className="search-field"><Search size={16}/><input placeholder="Gespräche suchen" aria-label="Gespräche suchen" value={search} maxLength={150} onChange={e=>{setSearch(e.target.value);setResults(undefined)}}/></label>
    <div className="chat-list">
      {(search.trim()?(results||[]):chats).map(chat=>
        <div key={chat.id} className={'chat-row '+(chat.id===id?'selected':'')}>
          {editing===chat.id?<form onSubmit={e=>{e.preventDefault();void change(chat)}}><input aria-label="Gesprächstitel" value={title} maxLength={150} required onChange={e=>setTitle(e.target.value)}/><button>Speichern</button><button type="button" onClick={()=>setEditing(undefined)}>Abbrechen</button></form>:
          <><button className="chat-name" disabled={busy} onClick={()=>open(chat.id)}>{chat.title}</button>
          <button aria-label="Umbenennen" className="icon-button" disabled={busy} onClick={()=>{setEditing(chat.id);setTitle(chat.title)}}><Pencil size={14}/></button>
          <button aria-label="Löschen" className="icon-button" disabled={busy} onClick={()=>void change(chat,true)}><Trash2 size={14}/></button></>}
        </div>)}
      {!search.trim()&&!chats.length&&<p className="muted">Noch keine gespeicherten Gespräche.</p>}
      {search.trim()&&results?.length===0&&<p className="muted">Keine passenden Gespräche.</p>}
    </div>
    {!!messages.length&&<section className="transcript" aria-label="Nachrichten im aktuellen Gespräch">{messages.map((m,i)=><article key={m.id||i}>
      <header>{m.role==='assistant'?'SAVRAN':'Du'}<span>
      {m.role==='assistant'&&<button className="icon-button" aria-label="Vorlesen" disabled={busy} onClick={()=>speak(m.content)}><AudioLines size={14}/></button>}
      <button className="icon-button" aria-label="Nachricht kopieren" onClick={()=>void navigator.clipboard.writeText(m.content).then(()=>setCopied(i)).catch(report)}>{copied===i?'Kopiert':<Copy size={14}/>}</button></span></header>
      <div>{m.content}</div>
    </article>)}</section>}
  </>
}
export function Settings({profile,config,save}:{profile:Profile;config?:Config;save:(next:Profile)=>Promise<void>}) {
  const [draft,setDraft]=useState(profile)
  useEffect(()=>setDraft(profile),[profile])
  return <form className="fields" onSubmit={e=>{e.preventDefault();void save(draft)}}>
    <label>Antwortsprache<select value={draft.language} onChange={e=>setDraft({...draft,language:e.target.value})}>
      <option value="auto">Automatisch</option><option value="de">Deutsch</option><option value="en">English</option>
    </select></label>
    <label>Stimme<select value={draft.voice} onChange={e=>setDraft({...draft,voice:e.target.value})}>
      <option value="">Standardstimme</option>{config?.voices.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}
    </select></label>
    <label>Lautstärke · {Math.round(draft.volume*100)} %<input type="range" min={0} max={1} step={.01} value={draft.volume} onChange={e=>setDraft({...draft,volume:Number(e.target.value)})}/></label>
    <label className="check"><input type="checkbox" checked={draft.speech} onChange={e=>setDraft({...draft,speech:e.target.checked})}/> Antworten automatisch vorlesen</label>
    {!config?.speech&&<p className="muted">Sprachausgabe erfordert eine ElevenLabs-Konfiguration.</p>}
    <p className="muted">Sprachmodell · {config?.model||'–'}</p>
    <button className="action-btn">Speichern</button>
  </form>
}
export function Memories({profile,save,report,userId}:{profile:Profile;userId:string;save:(next:Profile)=>Promise<void>;report:(error:unknown)=>void}) {
  const [list,setList]=useState<Memory[]>([])
  const [content,setContent]=useState('')
  const [id,setId]=useState<string>()
  const [busy,setBusy]=useState(false)
  const [consent,setConsent]=useState(false)
  useEffect(()=>{
    let current=true
    const client=db
    async function load(){
      if(!client)return
      const entries:Memory[]=[]
      for(let from=0;;from+=500){
        const {data,error}=await client.from('memories').select('id,content').eq('user_id',userId).order('created_at',{ascending:false}).order('id').range(from,from+499)
        if(!current)return
        if(error)throw new Error(error.message)
        entries.push(...data)
        if(data.length<500)break
      }
      setList(entries)
    }
    void load().catch(error=>{if(current)report(error)})
    return ()=>{current=false}
  },[report,userId])
  async function submit(event:FormEvent) {
    event.preventDefault()
    if(!db||!content.trim()||!consent)return
    setBusy(true)
    try {
      const clean=content.trim()
      const result=id?await db.from('memories').update({content:clean}).eq('id',id).select('id,content').single():
        await db.from('memories').insert({content:clean}).select('id,content').single()
      if(result.error)throw new Error(result.error.message)
      setList(prev=>id?prev.map(m=>m.id===id?result.data:m):[result.data,...prev])
      setContent('');setId(undefined);setConsent(false)
    }catch(error){report(error)}finally{setBusy(false)}
  }
  async function remove(item?:Memory) {
    if(!db||!confirm(item?'Diese Erinnerung vollständig löschen?':'Alle Erinnerungen vollständig löschen?'))return
    setBusy(true)
    try {
      const result=item?await db.from('memories').delete().eq('id',item.id):
        await db.from('memories').delete().eq('user_id',userId)
      if(result.error)throw new Error(result.error.message)
      setList(prev=>item?prev.filter(m=>m.id!==item.id):[])
      if(!item||id===item.id){setId(undefined);setContent('');setConsent(false)}
    }catch(error){report(error)}finally{setBusy(false)}
  }
  return <div className="fields">
    <label className="check"><input type="checkbox" checked={profile.memory_enabled} onChange={e=>void save({...profile,memory_enabled:e.target.checked})}/> Langzeitgedächtnis aktivieren</label>
    <p className="muted">Aktive Erinnerungen fließen in Groq-Anfragen ein. Der Gesprächsverlauf wird separat gespeichert. Du bestimmst, welche Notizen dauerhaft gespeichert werden.</p>
    {profile.memory_enabled&&<form className="fields" onSubmit={submit}>
      <label>{id?'Erinnerung bearbeiten':'Neue Erinnerung'}<textarea value={content} onChange={e=>{setContent(e.target.value);setConsent(false)}} maxLength={2000} required placeholder="Zum Beispiel dein Projekt oder eine Präferenz"/></label>
      <label className="check"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/> Ich stimme der Speicherung dieser Notiz zu.</label>
      <button className="action-btn" disabled={busy||!consent}>Erinnerung speichern</button>
      {id&&<button type="button" onClick={()=>{setId(undefined);setContent('');setConsent(false)}}>Bearbeitung abbrechen</button>}
    </form>}
    {list.map(item=><article className="memory-row" key={item.id}><p>{item.content}</p>
      <button className="icon-button" aria-label="Erinnerung bearbeiten" disabled={busy||!profile.memory_enabled} onClick={()=>{setId(item.id);setContent(item.content);setConsent(false)}}><Pencil size={15}/></button>
      <button className="icon-button" aria-label="Erinnerung löschen" disabled={busy} onClick={()=>void remove(item)}><Trash2 size={15}/></button>
    </article>)}
    {!!list.length&&<button className="danger" disabled={busy} onClick={()=>void remove()}>Alle Erinnerungen löschen</button>}
  </div>
}
type AuthMode='login'|'register'|'reset'|'recovery'
export function Account({session,profile,save,report,recovery,config,onRecoveryDone}:{session:Session|null;profile:Profile;save:(next:Profile)=>Promise<void>;report:(error:unknown)=>void;recovery:boolean;config?:Config;onRecoveryDone:()=>void}) {
  const [mode,setMode]=useState<AuthMode>('login')
  const [notice,setNotice]=useState('')
  const [busy,setBusy]=useState(false)
  const [name,setName]=useState(profile.name)
  const [confirmation,setConfirmation]=useState('')
  useEffect(()=>setName(profile.name),[profile.name])
  const activeMode=recovery?'recovery':mode
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if(!db){setNotice('Supabase ist noch nicht konfiguriert.');return}
    const fields=new FormData(event.currentTarget)
    const email=String(fields.get('email')||'')
    const password=String(fields.get('password')||'')
    setBusy(true);setNotice('')
    try{
      const redirect=window.location.origin+'/'
      const result=activeMode==='register'?await db.auth.signUp({email,password,options:{emailRedirectTo:redirect}}):
        activeMode==='reset'?await db.auth.resetPasswordForEmail(email,{redirectTo:redirect}):
        activeMode==='recovery'?await db.auth.updateUser({password}):await db.auth.signInWithPassword({email,password})
      if(result.error)throw new Error(result.error.message)
      if(activeMode==='register')setNotice('Prüfe dein Postfach und bestätige deine E-Mail-Adresse.')
      if(activeMode==='reset')setNotice('Falls ein Konto existiert, erhältst du einen Link zum Zurücksetzen.')
      if(activeMode==='recovery'){onRecoveryDone();setNotice('Passwort aktualisiert.')}
    }catch(error){setNotice(messageFor(error))}finally{setBusy(false)}
  }
  async function logout() {
    if(!db)return
    const {error}=await db.auth.signOut({scope:'local'})
    if(error)report(new Error(error.message))
  }
  async function remove() {
    if(!session||!db||confirmation!=='DELETE'||!confirm('Konto, Gespräche und Erinnerungen endgültig löschen?'))return
    setBusy(true)
    try {await api('account',session,{method:'DELETE',body:JSON.stringify({confirmation})});await logout()}
    catch(error){report(error)}finally{setBusy(false)}
  }
  if(session&&!recovery)return <div className="fields">
    <p>{session.user.email}</p>
    <form className="fields" onSubmit={e=>{e.preventDefault();void save({...profile,name:name.trim()})}}>
      <label>Anzeigename<input value={name} onChange={e=>setName(e.target.value)} maxLength={120}/></label><button className="action-btn">Profil speichern</button>
    </form>
    <button className="action-btn" onClick={()=>void logout()}><LogOut size={15}/> Abmelden</button>
    {config?.accountDeletion&&<div className="fields deletion">
      <label>Zur Kontolöschung DELETE eingeben<input value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label>
      <button className="danger" disabled={confirmation!=='DELETE'||busy} onClick={()=>void remove()}>Konto endgültig löschen</button>
    </div>}
    {!config?.accountDeletion&&<p className="muted">Kontolöschung erfordert eine Server-Konfiguration.</p>}
  </div>
  return <form className="fields" onSubmit={submit}>
    {activeMode!=='recovery'&&<label>E-Mail<input type="email" name="email" autoComplete="email" required/></label>}
    {activeMode!=='reset'&&<label>{activeMode==='recovery'?'Neues Passwort':'Passwort'}<input type="password" name="password" autoComplete={activeMode==='login'?'current-password':'new-password'} minLength={activeMode==='login'?1:8} required/></label>}
    <button className="action-btn" disabled={busy}>{({login:'Anmelden',register:'Registrieren',reset:'Reset-Link anfordern',recovery:'Passwort aktualisieren'})[activeMode]}</button>
    {!recovery&&<div className="auth-links">
      {mode!=='login'&&<button type="button" onClick={()=>{setMode('login');setNotice('')}}>Anmelden</button>}
      {mode!=='register'&&<button type="button" onClick={()=>{setMode('register');setNotice('')}}>Konto erstellen</button>}
      {mode!=='reset'&&<button type="button" onClick={()=>{setMode('reset');setNotice('')}}>Passwort vergessen</button>}
    </div>}
    {(!db||notice)&&<p role="status" className="notice">{notice||'Supabase ist noch nicht konfiguriert.'}</p>}
  </form>
}
