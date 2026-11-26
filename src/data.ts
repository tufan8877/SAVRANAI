import {createClient,type Session} from '@supabase/supabase-js'
const url=import.meta.env.VITE_SUPABASE_URL
const key=import.meta.env.VITE_SUPABASE_ANON_KEY
export const db = url && key ? createClient(url,key,{auth:{flowType:'pkce'}}) : null
export type Chat = {id:string;title:string;updated_at:string}
export type Message = {id?:string;role:'user'|'assistant';content:string}
export type MemoryCategory = 'personal'|'business'|'knowledge'|'task'
export type Memory = {id:string;content:string;category?:MemoryCategory}
export const defaults = {name:'',language:'auto',voice:'',volume:.8,speech:false,memory_enabled:false}
export type Profile = typeof defaults
export type Config = {guest:boolean;auth:boolean;chat:boolean;speech:boolean;accountDeletion:boolean;model:string;voices:{id:string;name:string}[];integrations:string[]}
export function messageFor(error:unknown) {
  if(error instanceof DOMException && error.name==='NotAllowedError') return 'Der Zugriff auf das Mikrofon oder die Audiowiedergabe wurde verweigert.'
  if(error instanceof DOMException && error.name==='NotFoundError') return 'Kein Mikrofon gefunden.'
  if(error instanceof Error && !(error instanceof TypeError)) return error.message
  return 'Die Anfrage konnte nicht abgeschlossen werden. Prüfe die Verbindung und versuche es erneut.'
}
export async function api(path:string, session:Session|null, options:RequestInit={}) {
  const response=await fetch('/api/'+path,{...options,headers:{...(session?{Authorization:'Bearer '+session.access_token}:{}),
    'Content-Type':'application/json',...options.headers}})
  if(!response.ok) {
    const body=await response.json().catch(()=>null)
    const error=new Error(body?.error?.message || 'Die Anfrage ist fehlgeschlagen.')
    throw Object.assign(error,{conversationId:response.headers.get('X-Conversation-Id')})
  }
  return response
}
