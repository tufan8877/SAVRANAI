const CACHE = 'savran-shell-__VERSION__'
const SHELL = __SHELL_FILES__
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(()=>self.skipWaiting()))
})
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys=>Promise.all(
    keys.filter(key=>key.startsWith('savran-shell-') && key!==CACHE).map(key=>caches.delete(key))
  )).then(()=>self.clients.claim()))
})
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if(event.request.method!=='GET' || url.origin!==self.location.origin || url.pathname.startsWith('/api/') ||
      event.request.headers.has('Authorization'))return
  if(event.request.mode==='navigate'){
    event.respondWith(fetch(event.request).catch(()=>caches.open(CACHE).then(cache=>cache.match('/'))))
    return
  }
  if(SHELL.includes(url.pathname)&&!url.search){
    event.respondWith(caches.open(CACHE).then(cache=>cache.match(url.pathname)).then(hit=>hit||fetch(event.request)))
  }
})
