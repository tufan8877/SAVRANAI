export async function consumeChat(response:Response, onDelta:(piece:string)=>void) {
  if(!response.body) throw new Error('Antwortstream nicht verfügbar.')
  const reader=response.body.pipeThrough(new TextDecoderStream()).getReader()
  let pending='', done=false
  try {
    for(;;){
      const chunk=await reader.read()
      if(chunk.done)break
      pending+=chunk.value
      const lines=pending.split('\n')
      pending=lines.pop() || ''
      for(const line of lines){
        if(!line)continue
        const event=JSON.parse(line)
        if(event.error)throw new Error(event.error)
        if(event.delta)onDelta(event.delta)
        if(event.done)done=true
      }
    }
    if(!done)throw new Error('Die Verbindung wurde vor dem Ende der Antwort unterbrochen.')
  } finally { await reader.cancel().catch(()=>undefined); reader.releaseLock() }
}
