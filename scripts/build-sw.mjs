import {readFile,readdir,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
const assets = (await readdir('dist/assets')).map(file=>'/assets/'+file)
const shell = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png', ...assets]
const template = await readFile('scripts/service-worker.js','utf8')
const hash = createHash('sha256')
for(const path of shell)hash.update(await readFile(path==='/'?'dist/index.html':'dist'+path))
const version = hash.update(template).digest('hex').slice(0,16)
await writeFile('dist/sw.js',template.replace('__SHELL_FILES__',JSON.stringify(shell)).replace('__VERSION__',version))
