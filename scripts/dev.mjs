import {spawn} from 'node:child_process'
const children = [
  spawn(process.execPath,['--watch','--import','tsx','server/index.ts'],{stdio:'inherit'}),
  spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','0.0.0.0',...process.argv.slice(2)],{stdio:'inherit'}),
]
let stopping=false
function stop(code=0){
  if(stopping)return
  stopping=true
  process.exitCode=code
  for(const child of children)child.kill()
}
for(const child of children){
  child.once('exit',code=>stop(code??1))
  child.once('error',error=>{console.error(error.message);stop(1)})
}
process.once('SIGINT',()=>stop())
process.once('SIGTERM',()=>stop())
