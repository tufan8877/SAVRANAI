import {test} from 'node:test'
import {strict as assert} from 'node:assert'
import {startWakeListener,wakePrompt,wakeRecognition} from '../src/wake'

test('wake phrase accepts punctuation and preserves an optional question',()=>{
  assert.equal(wakePrompt(' Hey, S.A.V.R.A.N.! '),'')
  assert.equal(wakePrompt('Hey Savran, wie spät ist es?'),'wie spät ist es?')
  assert.equal(wakePrompt('Hey Savrano'),undefined)
  assert.equal(wakePrompt('Ich sage Hey Savran'),undefined)
})

test('wake listener ignores unrelated speech, restarts after silence and stops after activation',t=>{
  t.mock.timers.enable({apis:['setTimeout']})
  let recognition!:FakeRecognition
  type Recognition=InstanceType<NonNullable<ReturnType<typeof wakeRecognition>>>
  class FakeRecognition implements Recognition {
    lang=''
    continuous=false
    onstart:Recognition['onstart']=null
    onend:Recognition['onend']=null
    onerror:Recognition['onerror']=null
    onresult:Recognition['onresult']=null
    starts=0
    aborts=0
    constructor(){recognition=this}
    start(){this.starts++;this.onstart?.()}
    abort(){this.aborts++}
    say(transcript:string,isFinal=true){
      this.onresult?.({resultIndex:0,results:[{isFinal,0:{transcript}}]})
    }
  }
  const prompts:string[]=[]
  const stop=startWakeListener(FakeRecognition,{
    ready:()=>undefined,
    blocked:()=>assert.fail('Recognition was blocked'),
    wake:text=>prompts.push(text),
  })
  assert.equal(recognition.continuous,true)
  recognition.say('Guten Morgen')
  recognition.say('Hey Savran',false)
  assert.deepEqual(prompts,[])
  recognition.onend?.()
  t.mock.timers.tick(300)
  assert.equal(recognition.starts,2)
  recognition.say('Hey Savran, Hallo!')
  recognition.say('Hey Savran')
  assert.deepEqual(prompts,['Hallo!'])
  stop()
  assert.equal(recognition.aborts,1)

  const stopQuestion=startWakeListener(FakeRecognition,{
    question:true,
    ready:()=>undefined,
    blocked:()=>assert.fail('Recognition was blocked'),
    wake:text=>prompts.push(text),
  })
  assert.equal(recognition.continuous,false)
  recognition.say('Wie geht es dir?')
  assert.deepEqual(prompts,['Hallo!','Wie geht es dir?'])
  stopQuestion()
})
