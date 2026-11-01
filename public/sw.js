const C='pvemon-v102',A=['/','/brand.js','/manifest.webmanifest','/icon.svg','/badge-96.png','/app.css','/i18n.js'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(A)))});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.pathname.startsWith('/api'))return;
if(/^\/fonts\/|\.(png|svg)$/.test(u.pathname)){e.respondWith(caches.match(e.request).then(m=>m||fetch(e.request).then(r=>{const c=r.clone();caches.open(C).then(x=>x.put(e.request,c));return r})));return}
e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(C).then(x=>x.put(e.request,c));return r}).catch(()=>caches.match(e.request)))});
// Notificaciones push (alertas)
self.addEventListener('push',e=>{let d={};try{d=e.data.json()}catch{}
e.waitUntil(self.registration.showNotification(d.title||(self.BRAND_NAME||'pvemon'),{body:d.body||'',tag:d.tag,icon:'/icon-192.png',badge:'/badge-96.png',data:{url:d.url||'/#/alertas'}}))});
self.addEventListener('notificationclick',e=>{e.notification.close();const url=(e.notification.data&&e.notification.data.url)||'/#/alertas';
e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(l=>{for(const c of l){if('focus'in c){if('navigate'in c)c.navigate(url);return c.focus()}}return self.clients.openWindow(url)}))});
