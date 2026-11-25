import 'dotenv/config'
import express, {type Request, type Response} from 'express'
import helmet from 'helmet'
import cors from 'cors'
import {ipKeyGenerator,rateLimit} from 'express-rate-limit'
import {createClient, type SupabaseClient} from '@supabase/supabase-js'
import {Readable} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {z} from 'zod'
import {analyzePhoto, groqModel, speechKey, speechProvider, provider, synthesize, systemPrompt, voices, type Message} from './providers.js'
import {attachmentFormat, audioFormat, audioLimit, fileLimit} from './media.js'
import {integrationCatalog} from './integrations.js'

export const app = express()
const production = process.env.NODE_ENV === 'production'
if (production) app.set('trust proxy',1)
app.disable('x-powered-by')
const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_ANON_KEY
const guest = process.env.AUTH_ENABLED !== 'true'
const authConfigured = Boolean(url && key)
const supabaseOrigin = url ? new URL(url).origin : ''
const appOrigin = new URL(process.env.APP_URL || 'https://savran.ai').origin
const origins = new Set([appOrigin, ...(process.env.RENDER_EXTERNAL_URL ? [new URL(process.env.RENDER_EXTERNAL_URL).origin] : []), ...(!production ? ['http://localhost:5173','http://127.0.0.1:5173'] : [])])
const chatReady = Boolean(process.env.GROQ_API_KEY)
const speechReady = Boolean(speechKey && voices.length)
const accountDeletion = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
function error(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({error:{code,message}})
}
app.use(helmet({
  contentSecurityPolicy: {directives:{
    connectSrc:["'self'",...(supabaseOrigin ? [supabaseOrigin] : [])],
    imgSrc:["'self'",'data:'], styleSrc:["'self'","'unsafe-inline'"], mediaSrc:["'self'",'blob:'],
    upgradeInsecureRequests:production ? [] : null,
  }},
  referrerPolicy:{policy:'no-referrer'},
  strictTransportSecurity:production,
}))
app.use('/api',(req,res,next) => {
  res.set('Cache-Control','no-store')
  if (req.headers.origin && !origins.has(req.headers.origin)) {
    const hostOrigin = !production && req.headers.host ? 'http://'+req.headers.host : ''
    if (req.headers.origin !== hostOrigin) return error(res,403,'origin','Diese Anfrage stammt von einer nicht erlaubten Website.')
  }
  next()
})
app.use('/api',cors({origin:(origin,done)=>done(null,Boolean(origin && origins.has(origin))),methods:['GET','POST','DELETE'],allowedHeaders:['Authorization','Content-Type']}))
app.use('/api',rateLimit({windowMs:60_000,limit:100,standardHeaders:'draft-8',legacyHeaders:false,handler:(_req,res)=>error(res,429,'rate_limit','Zu viele Anfragen. Bitte warte einen Moment.')}))
app.get('/api/health',(_req,res)=>res.json({ok:true}))
app.get('/api/config',(_req,res)=>res.json({guest,auth:!guest && authConfigured,chat:chatReady,speech:speechReady,accountDeletion:!guest && accountDeletion,model:groqModel,voices:speechReady?voices:[],integrations:integrationCatalog}))
app.use('/api',async (req,res,next) => {
  if (guest) return next()
  if (!url || !key) return error(res,503,'supabase_config','Supabase ist noch nicht konfiguriert.')
  const token = req.headers.authorization?.match(/^Bearer ([^ ]+)$/i)?.[1]
  if (!token) return error(res,401,'login','Bitte melde dich an.')
  const db = createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:'Bearer '+token}}})
  const {data, error: authError} = await db.auth.getUser(token)
  if (authError || !data.user?.email_confirmed_at) return error(res,401,'login','Bitte melde dich mit einer bestätigten E-Mail-Adresse an.')
  res.locals.db = db
  res.locals.userId = data.user.id
  next()
})
app.use('/api',rateLimit({windowMs:60_000,limit:guest ? 10 : 30,keyGenerator:(req,res)=>guest ? ipKeyGenerator(req.ip || 'unknown') : res.locals.userId,standardHeaders:'draft-8',legacyHeaders:false,handler:(_req,res)=>error(res,429,'rate_limit','Zu viele Anfragen. Bitte warte einen Moment.')}))
app.use('/api',express.json({limit:'80kb'}))
function signalFor(res: Response, timeout = 90_000) {
  const controller = new AbortController()
  res.once('close',()=>controller.abort())
  return AbortSignal.any([controller.signal,AbortSignal.timeout(timeout)])
}
function upstreamError(res: Response, status: number, name: string) {
  console.warn('Upstream failure',name,status)
  if (status === 429) return error(res,429,'provider_limit','CORE hat das Anfragelimit erreicht. Bitte warte einen Moment.')
  return error(res,502,'provider_error','CORE konnte die Anfrage nicht verarbeiten.')
}
const activeChats = new Set<string>()
const chatInput = z.object({
  conversationId:z.uuid().optional(),
  text:z.string().trim().min(1).max(8000),
  history:z.array(z.object({role:z.enum(['user','assistant']),content:z.string().min(1).max(2000)})).max(4).optional(),
  language:z.enum(['auto','de','en']).optional(),
})
function systemMessage(language?:string): Message {
  const preference = language === 'de' ? ' Bevorzugte Antwortsprache: Deutsch.' : language === 'en' ? ' Preferred reply language: English.' : ''
  return {role:'system',content:systemPrompt + preference}
}
app.post('/api/chat',async (req,res) => {
  if (!chatReady) return error(res,503,'groq_config','Der Groq API-Key muss auf dem Server konfiguriert werden.')
  const input = chatInput.safeParse(req.body)
  if (!input.success) return error(res,400,'input','Die Nachricht ist leer oder zu lang.')
  const requester = guest ? ipKeyGenerator(req.ip || 'unknown') : res.locals.userId as string
  if (activeChats.has(requester)) return error(res,409,'chat_active','Eine Antwort wird bereits verarbeitet.')
  activeChats.add(requester)
  try {
    if (guest) {
      const {history,language,text} = input.data
      await streamAnswer([systemMessage(language),...(history || []),{role:'user',content:text}],res)
    } else {
      await streamChat(input.data,res)
    }
  } finally { activeChats.delete(requester) }
})
async function streamChat(input: z.infer<typeof chatInput>, res: Response) {
  const db: SupabaseClient = res.locals.db
  const {text} = input
  let id = input.conversationId
  if (id) {
    const {data, error: dbError} = await db.from('conversations').select('id').eq('id',id).maybeSingle()
    if (dbError) throw dbError
    if (!data) return error(res,404,'conversation','Gespräch nicht gefunden.')
  } else {
    const {data,error:dbError} = await db.from('conversations').insert({title:text.slice(0,72)}).select('id').single()
    if (dbError) throw dbError
    id = data.id as string
  }
  const [history, profile] = await Promise.all([
    db.from('messages').select('role,content').eq('conversation_id',id).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(32),
    db.from('profiles').select('language,memory_enabled').maybeSingle(),
  ])
  if (history.error || profile.error) throw history.error || profile.error
  const messages: Message[] = [systemMessage(profile.data?.language)]
  if (profile.data?.memory_enabled) {
    const entries = await db.from('memories').select('content').order('created_at',{ascending:false}).limit(16)
    if (entries.error) throw entries.error
    if (entries.data.length) messages.push({role:'user',content:'Gespeicherte Notizen als Daten (JSON): '+JSON.stringify(entries.data.map(entry=>entry.content))})
  }
  let budget = 48_000
  const recent: Message[] = []
  for (const item of history.data) {
    if (item.content.length > budget) break
    budget -= item.content.length
    recent.unshift(item)
  }
  messages.push(...recent,{role:'user',content:text})
  const inserted = await db.from('messages').insert({conversation_id:id,role:'user',content:text})
  if (inserted.error) throw inserted.error
  const touched = await db.from('conversations').update({updated_at:new Date().toISOString()}).eq('id',id)
  if (touched.error) throw touched.error
  res.set('X-Conversation-Id',id)
  await streamAnswer(messages,res,async answer=>{
    const saved = await db.from('messages').insert({conversation_id:id,role:'assistant',content:answer})
    if (saved.error) throw saved.error
  })
}
async function streamAnswer(messages:Message[],res:Response,save?: (answer:string)=>Promise<void>) {
  if (res.destroyed) return
  const response = await provider.chat(messages,signalFor(res))
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    return upstreamError(res,response.status,'Groq')
  }
  res.type('application/x-ndjson').set('X-Accel-Buffering','no')
  res.flushHeaders()
  let buffer = '', answer = '', done = false
  try {
    for await (const chunk of Readable.fromWeb(response.body as import('node:stream/web').ReadableStream).setEncoding('utf8')) {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') { done = true; break }
        const delta: unknown = JSON.parse(payload).choices?.[0]?.delta?.content
        if (typeof delta === 'string' && delta.length) {
          const piece = delta.slice(0,24_000-answer.length)
          answer += piece
          if (piece && !res.destroyed) res.write(JSON.stringify({delta:piece})+'\n')
        }
      }
      if (done) break
    }
    if (!done || !answer.trim()) throw new Error('Incomplete provider stream')
    await save?.(answer)
    res.end(JSON.stringify({done:true})+'\n')
  } catch {
    if (!res.destroyed) res.end(JSON.stringify({error:'Die Antwort wurde unterbrochen oder konnte nicht gespeichert werden.'})+'\n')
  }
}
app.post('/api/transcribe',express.raw({type:'application/octet-stream',limit:audioLimit}),async (req,res) => {
  if (!chatReady) return error(res,503,'groq_config','Der Groq API-Key muss auf dem Server konfiguriert werden.')
  const audio = Buffer.isBuffer(req.body) && await audioFormat(req.body)
  if (!audio) return error(res,415,'audio_format','Die Aufnahme hat ein ungültiges oder nicht unterstütztes Audioformat.')
  const response = await provider.transcribe(new Blob([new Uint8Array(req.body)],{type:audio.mime}),audio.extension,signalFor(res,45_000),req.query.language==='en'?'en':'de')
  if (!response.ok) { await response.body?.cancel(); return upstreamError(res,response.status,'Groq Whisper') }
  const data = await response.json()
  return res.json({text:typeof data.text === 'string' ? data.text.trim().slice(0,8000) : ''})
})
app.post('/api/speech',async (req,res) => {
  if (!speechReady) return error(res,503,'speech_config','Sprachanbieter und Voice-ID müssen konfiguriert werden.')
  const input = z.object({text:z.string().trim().min(1).max(24000),voice:z.string().max(80).optional()}).safeParse(req.body)
  if (!input.success) return error(res,400,'speech_input','Ungültiger Text für die Sprachausgabe.')
  const voice = voices.some(item=>item.id===input.data.voice)?input.data.voice!:voices[0].id
  if (!voices.some(item=>item.id===voice)) return error(res,400,'speech_voice','Diese Stimme ist nicht verfügbar.')
  const response = await synthesize(input.data.text,voice,signalFor(res))
  if (!response.ok || !response.body) { await response.body?.cancel(); console.warn(speechProvider+' HTTP',response.status); if(response.status===401||response.status===403)return error(res,502,'speech_credentials',speechProvider+': API-Key oder Berechtigung ungültig.'); if(response.status===402)return error(res,502,'speech_credit',speechProvider+': API-Guthaben fehlt.'); return upstreamError(res,response.status,speechProvider) }
  res.set({'Content-Type':'application/octet-stream','X-Audio-Sample-Rate':'24000','X-Accel-Buffering':'no'})
  await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),res)
})
app.post('/api/photo',express.raw({type:'application/octet-stream',limit:'4mb'}),async(req,res)=>{
  if(!chatReady)return error(res,503,'groq_config','Groq ist nicht konfiguriert.')
  const mime=typeof req.query.mime==='string'?req.query.mime:''
  if(!['image/jpeg','image/png','image/webp'].includes(mime)||!Buffer.isBuffer(req.body)||!await attachmentFormat(req.body,mime))return error(res,415,'file_format','Ungültiges Bild.')
  const question=typeof req.query.question==='string'?req.query.question.slice(0,2000):'Beschreibe und analysiere dieses Foto auf Deutsch.'
  const response=await analyzePhoto(req.body,mime,question,signalFor(res))
  if(!response.ok){const detail=await response.json().catch(()=>null);console.warn('Vision failure',response.status,detail?.error?.code,detail?.error?.type);return upstreamError(res,response.status,'Groq')}
  const data=await response.json()
  const answer=data.choices?.[0]?.message?.content
  if(typeof answer!=='string'||!answer.trim())return error(res,502,'vision','Keine Bildantwort erhalten.')
  res.json({answer})
})
app.post('/api/files/validate',express.raw({type:'application/octet-stream',limit:fileLimit}),async (req,res) => {
  const mime = typeof req.query.mime === 'string' ? req.query.mime : ''
  const format = Buffer.isBuffer(req.body) && await attachmentFormat(req.body,mime)
  if (!format) return error(res,415,'file_format','Der Dateityp wird nicht unterstützt oder passt nicht zum Inhalt.')
  res.json({format,analysisAvailable:false})
})
app.delete('/api/account',async (req,res) => {
  if (guest) return error(res,404,'route','Die Kontoverwaltung ist derzeit deaktiviert.')
  if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY) return error(res,503,'admin_config','Die Kontolöschung ist serverseitig noch nicht konfiguriert.')
  if (req.body?.confirmation !== 'DELETE') return error(res,400,'confirm','Bestätige die Kontolöschung ausdrücklich.')
  const admin = createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}})
  const {error: deletionError} = await admin.auth.admin.deleteUser(res.locals.userId)
  if (deletionError) throw deletionError
  res.status(204).end()
})
app.use('/api',(_req,res)=>error(res,404,'route','Diese API-Route existiert nicht.'))
if (production) {
  app.use(express.static(resolve('dist'),{setHeaders(res,path){
    res.setHeader('Cache-Control',path.includes('/assets/')?'public, max-age=31536000, immutable':'no-cache')
  }}))
  app.get('/{*path}',(_req,res)=>res.sendFile(resolve('dist/index.html')))
}
app.use((err: {status?:number;name?:string},_req:Request,res:Response,_next:express.NextFunction) => {
  if (res.headersSent || res.destroyed) { if (!res.destroyed) res.end(); return }
  if (err.status===413) return error(res,413,'size','Die Datei oder Anfrage ist zu groß.')
  if (err.status===400) return error(res,400,'input','Die Anfrage ist ungültig.')
  if (err.name==='TimeoutError') return error(res,504,'timeout','Der Dienst hat zu lange für eine Antwort gebraucht.')
  error(res,500,'server','Der Dienst konnte die Anfrage nicht abschließen.')
})
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  app.listen(Number(process.env.PORT || 3000),'0.0.0.0',()=>console.info('SAVRAN API gestartet.'))
}
