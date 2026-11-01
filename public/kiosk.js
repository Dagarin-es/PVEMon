/* ───────── Modo kiosko: paneles por dispositivo ─────────
 * Se carga bajo demanda (index.html: kioskLoad). Usa los helpers globales de index.html.
 * Cada panel guarda sus fichas en % del lienzo, así se adapta a la pantalla donde se muestre.
 */
const KDEV=(()=>{let d=null;try{d=localStorage.getItem('pvemon.device')}catch{}
if(!d||!/^[A-Za-z0-9_-]{8,64}$/.test(d)){d='d'+[...crypto.getRandomValues(new Uint8Array(12))].map(b=>b.toString(16).padStart(2,'0')).join('');try{localStorage.setItem('pvemon.device',d)}catch{}}return d})();
const KAUTO={get:()=>{try{return localStorage.getItem('pvemon.autokiosk')==='1'}catch{return false}},set:v=>{try{v?localStorage.setItem('pvemon.autokiosk','1'):localStorage.removeItem('pvemon.autokiosk')}catch{}}};
let KFLASH='';
const KASP=[[16/9,T('16:9 (apaisada)')],[16/10,'16:10'],[4/3,'4:3'],[3/2,'3:2'],[21/9,T('21:9 (panorámica)')],[9/16,T('9:16 (vertical)')],[10/16,T('10:16 (vertical)')],[3/4,T('3:4 (vertical)')]];
const kSelfAspect=()=>Math.round(innerWidth/innerHeight*100)/100;
const kDevName=()=>{const p=(navigator.userAgentData&&navigator.userAgentData.platform)||navigator.platform||T('Dispositivo');return p+' · '+innerWidth+'×'+innerHeight};
const KKINDS=['node','vm','lxc','docker','backup'];
function kFlat(tree){const out=[];const walk=(l,path)=>{for(const n of l){if(KKINDS.includes(n.kind)&&n.accessible&&!n.missing)out.push({n,path:path.join(' › ')});walk(n.children||[],n.kind==='server'||n.kind==='node'?[...path,n.name]:path)}};walk(tree,[]);return out}
/* Valor de un indicador del elemento: {pct, sub} o null si no está disponible */
function kMetric(n,L,key){const l=L[n.id]||{},i=n.info||{};
if(key==='cpu'){const v=l['cpu.usage'];return v==null?null:{pct:v,sub:i.cpuCores?T('{0} hilos', i.cpuCores):''}}
if(key==='mem'){const t=i.memoryTotal,u=l['mem.used'];let p=l['mem.usage'];if(p==null&&u!=null&&t)p=u/t*100;if(p==null)return null;return{pct:p,sub:t?'de '+GB(t):(u!=null?T('{0} usados', GB(u)):'')}}
if(key==='disk'){if(n.kind==='docker')return null;if(l['storage.total']){return{pct:l['storage.used']/l['storage.total']*100,sub:'de '+GB(l['storage.total'])}}
if(l['disk.fs.total']){return{pct:l['disk.fs.used']/l['disk.fs.total']*100,sub:'de '+GB(l['disk.fs.total'])}}
if(l['disk.usage']!=null)return{pct:l['disk.usage'],sub:i.diskTotal?'de '+GB(i.diskTotal):''};return null}
return null}
const KLAB={cpu:'CPU',mem:T('Memoria'),disk:T('Disco')};
const kPt=(p,r)=>{const a=Math.PI*(1-p/100);return[(50+r*Math.cos(a)).toFixed(2),(50-r*Math.sin(a)).toFixed(2)]};
const kArc=(a,b,r)=>{const[x0,y0]=kPt(a,r),[x1,y1]=kPt(b,r);return`M${x0} ${y0}A${r} ${r} 0 0 1 ${x1} ${y1}`};
/* Semicírculo con zonas verde/ámbar/rojo y una aguja que marca el nivel de uso */
function kGauge(key,m){const pct=Math.min(100,Math.max(0,m.pct)),w=key==='cpu'?75:80,c=90,col=pct>=c?'cr':pct>=w?'wa':'ok';
const g=h('div',{class:'kg'});
g.append(svg(`<svg viewBox="0 0 100 62" aria-hidden="true"><path d="${kArc(0,w,40)}" class="z ok"/><path d="${kArc(w,c,40)}" class="z wa"/><path d="${kArc(c,100,40)}" class="z cr"/>
<g class="nd" style="transform:rotate(${(-90+pct*1.8).toFixed(1)}deg)"><path d="M47.6 50L50 11L52.4 50Z"/></g><circle cx="50" cy="50" r="4.2" class="hub"/></svg>`),
h('div',{class:'kv-p '+col},Math.round(pct)+' %'),h('div',{class:'kv-l'},KLAB[key]),...(m.sub?[h('div',{class:'kv-s'},m.sub)]:[]));
g.setAttribute('role','img');g.setAttribute('aria-label',KLAB[key]+' '+Math.round(pct)+' %'+(m.sub?' '+m.sub:''));return g}
/* Tema propio del panel (auto = el del dispositivo) */
const kTheme=v=>{if(v==='light'||v==='dark')document.documentElement.setAttribute('data-theme',v);else THEME.apply()};
const kDesc=n=>(n.children||[]).flatMap(c=>[c,...kDesc(c)]);
const KSPEC={systems:T('Estado de los sistemas'),backups:T('Estado de los backups'),text:T('Cuadro de texto')};
const kRun=n=>n.status==='running';
function kNodes(tree){return tree.filter(s=>s.kind==='server'&&s.origin!=='mail').flatMap(sv=>(sv.children||[]).filter(c=>c.kind==='node'&&!c.missing).map(nd=>({nd,off:sv.server?.status==='offline'})))}
function kBackups(tree){const out=[],seen=new Set();const walk=l=>{for(const n of l){if(!seen.has(n.id)&&n.accessible!==false&&!n.missing&&n.backup&&(n.kind==='backup'||(['vm','lxc','docker'].includes(n.kind)&&n.monitored!==false))){seen.add(n.id);out.push(n)}walk(n.children||[])}};walk(tree);return out}
const kBkTxt=b=>!b||b.state==='none'?T('Sin copias'):b.state==='ok'?T('Correcta'):b.state==='error'?T('Con error'):T('Antigua');
/* Fichas de resumen: estado de los sistemas / de los backups */
const KFS=[1.6,2.4,3.4,4.8,6.8,10];
function kSpecial(t,e,tree,live,mini){const ty=t.type;let led,rows,sum;
if(ty==='text'){e.classList.add('txt');if(t.bg)e.classList.add('bg');e.style.setProperty('--f',String(KFS[Math.min(5,Math.max(0,(t.fs||3)-1))]));e.style.textAlign=t.al||'left';e.append(h('div',{class:'kt-tx'},t.text||T('Texto')));return e}
if(ty==='systems'){const ns=kNodes(tree),act=ns.filter(x=>kRun(x.nd)&&!x.off).length;led=ns.length&&act===ns.length?'on':'off';
sum=ns.length+(ns.length===1?T(' nodo'):T(' nodos'))+' · '+act+(act===1?T(' activo'):T(' activos'));
rows=ns.map(({nd,off})=>{const g=kDesc(nd),c=k=>{const a=g.filter(x=>x.kind===k);return[a.filter(kRun).length,a.length]},[v,l,d]=['vm','lxc','docker'].map(c),run=kRun(nd)&&!off;
return h('div',{class:'ks-r'+(run?'':' dn')},h('span',{class:T('led ')+(run?'on':'off')}),h('span',{class:'ks-n',title:nd.name},nd.name),h('span',{class:'ks-c'},run?T('VM {0}/{1} · LXC {2}/{3} · Docker {4}/{5}', v[0], v[1], l[0], l[1], d[0], d[1]):T('Apagado')))})}
else{const bs=kBackups(tree),bad=bs.filter(n=>bkBad(n.backup)).length,ok=bs.filter(n=>n.backup.state==='ok').length;led=!bs.length?'na':bad?'off':'on';
sum=bs.length+(bs.length===1?T(' backup'):T(' backups'))+' · '+ok+(ok===1?T(' correcto'):T(' correctos'))+(bad?' · '+bad+(bad===1?T(' con problema'):T(' con problemas')):'');
rows=bs.map(n=>{const b=n.backup,bd=bkBad(b),na=b.state==='none';return h('div',{class:'ks-r'+(bd?' dn':'')},h('span',{class:T('led ')+(na?'na':bd?'off':'on')}),h('span',{class:'ks-n',title:n.name},n.name),h('span',{class:'ks-c'},kBkTxt(b)+(b.lastOkAt&&!bd?' · '+BD(b.lastOkAt):'')))})}
e.classList.add('spec');if(mini)e.classList.add('mini');
if(live){e.classList.add('go');e.setAttribute('role','link');e.tabIndex=0;e.setAttribute('aria-label',T('Ir al panel principal'));e.addEventListener('click',()=>location.hash='#/');e.addEventListener('keydown',ev=>{if(ev.key==='Enter')location.hash='#/'})}
e.append(h('div',{class:'kt-h'},h('span',{class:'kt-n'},KSPEC[ty]),h('span',{class:T('led ')+led,role:'img','aria-label':led==='on'?T('Todo correcto'):T('Hay problemas')})));
if(mini)return e;
e.style.setProperty('--r',String(1.55*Math.max(1,rows.length)+1.9));
e.append(h('div',{class:'kt-b ks-b'},h('div',{class:'ks-s'},sum),...(rows.length?rows:[h('div',{class:'kv-s'},ty==='systems'?T('No hay nodos.'):T('No hay backups.'))])));return e}
/* Una ficha del lienzo: nombre, LED arriba a la derecha y los indicadores elegidos */
function kTile(t,n,L,live,TR){const e=h('div',{class:'kt','data-id':t.id,style:`left:${t.x}%;top:${t.y}%;width:${t.w}%;height:${t.h}%`});
if(t.type)return kSpecial(t,e,TR||[],live,t.mini);
if(live&&n){e.classList.add('go');e.setAttribute('role','link');e.tabIndex=0;e.setAttribute('aria-label',T('Abrir {0}', n.name));e.addEventListener('click',()=>location.hash='#/e/'+n.id);e.addEventListener('keydown',ev=>{if(ev.key==='Enter')location.hash='#/e/'+n.id})}
if(!n){e.append(h('div',{class:'kt-h'},h('span',{class:'kt-n'},T('Elemento no disponible')),h('span',{class:'led na'})));return e}
if(t.mini)e.classList.add('mini');const bk=n.kind==='backup',run=bk?!bkBad(n.backup):n.status==='running',na=bk&&(!n.backup||n.backup.state==='none');
e.append(h('div',{class:'kt-h'},KI(bk?(n.info&&n.info.fileCheck?'filebk':'mailbk'):n.kind),h('span',{class:'kt-n',title:n.name},n.name),h('span',{class:T('led ')+(na?'na':run?'on':'off'),role:'img','aria-label':run?T('En marcha'):T('Parado'),title:bk?(run?T('Copia correcta'):T('Copia con problema')):run?T('En marcha'):T('Parado')})));
if(t.mini){return e}const b=h('div',{class:'kt-b'});
if(bk){const k=n.backup||{};b.append(h('div',{class:'kt-bk'},h('div',{class:'kv-p '+(na?'':run?'ok':'cr')},k.state==='ok'?T('Correcta'):k.state==='error'?T('CON ERROR'):k.state==='stale'?T('ANTIGUA'):T('Sin copias')),
k.lastOkAt?h('div',{class:'kv-s'},T('Última correcta: {0}', BD(k.lastOkAt))):null,k.lastOkSize?h('div',{class:'kv-s'},bytes(k.lastOkSize)):null,bkBad(k)&&k.message?h('div',{class:'kv-s bad'},k.message):null))}
else if(!run)b.append(h('div',{class:'kt-off'},T('Parado')));
else{const gs=['cpu','mem','disk'].filter(k=>t[k]).map(k=>[k,kMetric(n,L,k)]).filter(x=>x[1]);
if(gs.length)b.append(...gs.map(([k,m])=>kGauge(k,m)));else b.append(h('div',{class:'kv-s'},T('Sin indicadores')))}
e.append(b);return e}
/* Avisos que aparecen en la banda de arriba: cada uno lleva a su elemento */
function kBand(list){if(!list.length)return null;const sh=list.slice(0,6);
return h('div',{class:'kbanner',role:'alert',style:'cursor:pointer',title:T('Ir al primer problema'),onclick:e=>{if(!e.target.closest('a'))location.hash=list[0].h}},h('span',{class:'big'},'⛔'),h('div',{class:'kb-t'},h('b',{},list.length===1?T('Hay 1 problema'):T('Hay {0} problemas', list.length)),
h('div',{class:'kb-l'},...sh.map(i=>h('a',{href:i.h},i.t)),list.length>6?h('a',{href:'#/alertas'},T('y {0} más…', list.length-6)):null)))}
async function kLoad(){const[{tree},ov,{active}]=await Promise.all([api('/tree'),api('/overview').catch(()=>({latest:{}})),api('/alerts').catch(()=>({active:[]}))]);return{tree,L:ov.latest||{},active}}
/* Transición entre paneles: el nuevo se dibuja debajo y el anterior (una copia) se va retirando a la vez.
 * pixels = el anterior se deshace en cuadros al azar; blur = el anterior se desenfoca mientras el nuevo se enfoca. */
async function kFade(canvas,secs,kind,swap){const r=canvas.getBoundingClientRect(),W=r.width,H=r.height,ms=secs*1000;
const old=canvas.cloneNode(true);old.classList.add('kold');Object.assign(old.style,{position:'fixed',left:r.left+'px',top:r.top+'px',width:W+'px',height:H+'px',zIndex:'40',pointerEvents:'none'});document.body.append(old);
try{await swap();
if(kind==='blur'){const o={duration:ms,easing:'ease-in-out',fill:'forwards'};
await Promise.all([old.animate([{filter:'blur(0px)',opacity:1},{filter:'blur(28px)',opacity:0}],o).finished,canvas.animate([{filter:'blur(28px)',opacity:0},{filter:'blur(0px)',opacity:1}],o).finished]);canvas.getAnimations().forEach(x=>x.cancel())}
else await new Promise(res=>{const cs=Math.max(24,Math.round(Math.max(W,H)/44)),cols=Math.ceil(W/cs),n=cols*Math.ceil(H/cs),a=Array.from({length:n},(_,i)=>i);
for(let i=n-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}const rank=new Uint32Array(n);a.forEach((c,i)=>rank[c]=i);
const t0=performance.now(),step=t=>{const p=Math.min(1,(t-t0)/ms);if(p>=1)return res();const lim=Math.floor(p*n);let d='';
for(let i=0;i<n;i++)if(rank[i]>=lim)d+=T('M{0} {1}h{2}v{3}h-{4}z', (i%cols)*cs, Math.floor(i/cols)*cs, cs, cs, cs);old.style.clipPath="path('"+d+"')";requestAnimationFrame(step)};requestAnimationFrame(step)})}
finally{old.remove()}}
/* ───── Vista del kiosko ───── */
async function kioskView(id){document.body.classList.add('kiosk');
let k=null,steps=null,playUrl='',pv=false,fx=2,fxk='pixels';const playOf=async gid=>{playUrl='/kiosk-groups/'+gid+'/play';const r=await api(playUrl);steps=r.steps;fx=r.group.fx==null?2:r.group.fx;fxk=r.group.fxKind||'pixels';k=steps.length?steps[0].kiosk:null;return r};
let none='';
if(id==='principal'){const r=await api('/kiosks');if(r.main&&r.main.kind==='group')await playOf(r.main.id);else if(r.main)k=r.kiosks.find(x=>x.id===r.main.id)||null;
else{const d=await api('/kiosks/device/'+KDEV);if(d.group)await playOf(d.group.id);else k=d.kiosk;if(!k&&!steps)none=T('Aún no has elegido un kiosko principal. Pulsa «Hacer principal» en uno de tus kioscos o paneles.')}}
else if(id&&id.startsWith('g/'))await playOf(id.slice(2));
else if(id&&id.startsWith('p/'))k=(await api('/kiosks')).kiosks.find(x=>x.id===id.slice(2));
else if(id){k=(await api('/kiosks')).kiosks.find(x=>x.id===id);pv=true}
else{const d=await api('/kiosks/device/'+KDEV);if(d.group)await playOf(d.group.id);else k=d.kiosk}
if(steps&&!steps.length){k=null;none=T('Ese kiosko no tiene ningún panel todavía.')}
if(!k){document.body.classList.remove('kiosk');KFLASH=none||(id&&id!=='principal'?T('Ese panel ya no existe.'):T('Este dispositivo todavía no tiene un panel de kiosko. Elige uno de la lista o crea uno nuevo.'));location.hash='#/kioscos';return}
kTheme(k.theme);const root=h('div',{class:'kv'}),canvas=h('div',{class:'kcanvas live'}),band=h('div',{class:'kband'});root.append(band,canvas);
const menu=h('div',{class:'kxm'},h('button',{onclick:()=>{(document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen?.())?.catch?.(()=>{});menu.classList.remove('open')}},T('Pantalla completa')),
...(steps&&steps.length>1?[h('button',{onclick:()=>{menu.classList.remove('open');next()}},T('Siguiente panel')),h('button',{onclick:()=>{menu.classList.remove('open');next(-1)}},T('Panel anterior'))]:[]),h('button',{onclick:()=>location.hash='#/kioscos'},T('Mis kioscos y paneles')),h('button',{onclick:()=>{try{sessionStorage.setItem('pvemon.kexit','1')}catch{}location.hash='#/'}},T('Salir del kiosko')));
const kx=h('button',{class:'kx','aria-label':T('Opciones del kiosko'),title:T('Opciones'),onclick:e=>{e.stopPropagation();menu.classList.toggle('open')}},'⋯');
root.addEventListener('click',()=>menu.classList.remove('open'));
kioskOptions().then(o=>{if(o.length<2)return;const at=menu.querySelector('button:nth-last-child(2)');menu.insertBefore(h('div',{class:'mu',style:'padding:6px 10px 2px'},T('Cambiar de kiosko')),at);o.forEach(x=>menu.insertBefore(h('button',{onclick:()=>{menu.classList.remove('open');kioskGo(x.ref)}},(x.star?'★ ':'')+x.name),at))}).catch(()=>{});
let tx=null;root.addEventListener('touchstart',e=>{tx=e.touches.length===1?{x:e.touches[0].clientX,y:e.touches[0].clientY}:null},{passive:true});root.addEventListener('touchend',e=>{if(!tx||!steps||steps.length<2)return;const t=e.changedTouches[0],dx=t.clientX-tx.x,dy=t.clientY-tx.y;tx=null;if(Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)*1.5)next(dx<0?1:-1)},{passive:true});root.append(kx,menu);
const dots=h('div',{class:'kdots','aria-hidden':'true'});if(steps&&steps.length>1)root.append(dots);let idx=0,rt=null;
const paintDots=()=>dots.replaceChildren(...steps.map((_,i)=>h('i',{class:i===idx?'on':''})));
const arm=()=>{clearTimeout(rt);if(!dead&&steps&&steps.length>1){paintDots();rt=setTimeout(next,steps[idx].secs*1000)}};
let busy=false,dead=false;
async function next(dir){dir=dir===-1?-1:1;if(busy||dead)return;busy=true;clearTimeout(rt);try{let ni=(idx+dir+steps.length)%steps.length;if(dir>0&&ni===0&&playUrl){try{const r=await api(playUrl);if(r.steps.length){steps=r.steps;fx=r.group.fx==null?2:r.group.fx;fxk=r.group.fxKind||'pixels'}}catch{}}
ni%=steps.length;const f=Math.min(fx,steps[idx].secs*.8),sw=async()=>{if(dead)return;idx=ni;k=steps[idx].kiosk;kTheme(k.theme);await draw()};
if(f>0&&fxk!=='none'&&!document.hidden)await kFade(canvas,f,fxk,sw);else await sw()}catch{}busy=false;arm()}
if(pv){let from=null;try{from=sessionStorage.getItem('pvemon.kprev')}catch{}root.append(h('button',{class:'kprev p',onclick:()=>{try{sessionStorage.removeItem('pvemon.kprev')}catch{}location.hash=from===id?'#/kiosko/editar/'+id:'#/kioscos'}},T('✕ Salir de la vista previa')))}$.replaceChildren(root);
const fit=()=>{const bh=band.offsetHeight,W=innerWidth,H=innerHeight-bh;canvas.style.width=W+'px';canvas.style.height=H+'px'};
let wl=null;const lock=async()=>{try{if('wakeLock'in navigator&&!document.hidden)wl=await navigator.wakeLock.request('screen')}catch{}};lock();
const vis=()=>{if(!document.hidden)lock()};document.addEventListener('visibilitychange',vis);
const draw=async()=>{try{const{tree,L,active}=await kLoad(),els=new Map(kFlat(tree).map(x=>[x.n.id,x.n]));
band.replaceChildren(...[kBand(kIssues(tree,active))].filter(Boolean));fit();
canvas.replaceChildren(...k.layout.map(t=>kTile(t,els.get(t.elementId),L,true,tree)));if(!k.layout.length)canvas.append(h('div',{class:'kempty'},T('Este panel está vacío. Añade elementos desde Mis paneles → Editar.')))}catch(x){if(x)canvas.replaceChildren(h('div',{class:'kempty err'},String(x.message||x)))}};
addEventListener('resize',fit);kClean=()=>{dead=true;clearTimeout(rt);document.querySelectorAll('.kold').forEach(x=>x.remove());THEME.apply();document.removeEventListener('visibilitychange',vis);removeEventListener('resize',fit);try{wl&&wl.release()}catch{}};await draw();arm();timer=setInterval(draw,10000)}
/* ───── Carpeta de paneles ───── */
async function kioskPanels(){document.body.classList.remove('kiosk');
const[{kiosks,main},dev,{groups}]=await Promise.all([api('/kiosks'),api('/kiosks/device/'+KDEV),api('/kiosk-groups')]);const mine=dev.kiosk,mineG=dev.group,msg=h('div',{class:'mu',role:'status'},KFLASH);KFLASH='';
const reload=()=>route();
const go=async(f,ok)=>{msg.className='mu';msg.textContent='…';try{await f();if(ok)ok()}catch(x){if(x){msg.className='err';msg.textContent=x.message}}};
const devLabel=h('input',{value:((mine||mineG)&&((mine||mineG).devices.find(d=>d.deviceId===KDEV)||{}).label)||kDevName(),maxlength:'60','aria-label':T('Nombre de este dispositivo'),autocomplete:'off'});
const auto=h('input',{type:'checkbox',checked:KAUTO.get()?'':null,onchange:e=>KAUTO.set(e.target.checked)});
const here=h('div',{class:'card'},h('b',{class:'bigt'},T('Este dispositivo')),
h('div',{class:'mu'},mine?T('Abre el panel «{0}».', mine.name):mineG?T('Abre el kiosko «{0}».', mineG.name):T('Todavía no tiene ningún panel asignado.')),
h('label',{class:'f'},h('span',{class:'mu'},T('Nombre')),devLabel),
h('label',{class:'f ck'},auto,h('span',{},T('Abrir el kiosko directamente al entrar desde este dispositivo'))),
h('div',{class:'chips'},mine||mineG?h('button',{class:'p',onclick:()=>location.hash='#/kiosko'},T('Abrir kiosko')):null,mine||mineG?h('button',{onclick:()=>go(()=>api('/kiosks/device/'+KDEV,{method:'DELETE'}),reload)},T('Quitar la asignación')):null));
const isMain=(kind,id)=>main&&main.kind===kind&&main.id===id;
const mainBtn=(kind,id)=>isMain(kind,id)?h('button',{class:'on',title:T('Es el que abre el botón «Kiosko»'),onclick:()=>go(()=>api('/kiosks-main',{method:'PUT',body:{kind:'none'}}),reload)},T('★ Principal')):h('button',{title:T('Lo abrirá el botón «Kiosko» de arriba, en pantalla completa'),onclick:()=>go(()=>api('/kiosks-main',{method:'PUT',body:{kind:kind,id:id}}),reload)},T('Hacer principal'));
const rowOf=k=>{const name=h('span',{class:'kn'},k.name),here1=k.devices.some(d=>d.deviceId===KDEV),others=k.devices.filter(d=>d.deviceId!==KDEV);
const info=h('div',{class:'mu'},k.layout.length+(k.layout.length===1?T(' elemento'):T(' elementos'))+' · '+(k.aspect>=1?T('apaisado'):T('vertical'))+' '+k.aspect.toFixed(2),here1?T(' · en uso en este dispositivo'):'',main&&main.kind==='panel'&&main.id===k.id?T(' · ★ principal'):'',others.length?T(' · asignado a: {0}', others.map(d=>d.label||T('otro dispositivo')).join(', ')):'');
const head=h('div',{class:'grow'},name,info);
const ren=()=>{const i=h('input',{value:k.name,maxlength:'60','aria-label':T('Nuevo nombre del panel')}),ok=()=>{const v=i.value.trim();if(!v){return}go(()=>api('/kiosks/'+k.id,{method:'PUT',body:{name:v}}),reload)};i.addEventListener('keydown',e=>{if(e.key==='Enter')ok();if(e.key==='Escape')reload()});
head.replaceChildren(h('div',{class:'chips'},i,h('button',{class:'p',onclick:ok},T('Guardar')),h('button',{onclick:reload},T('Cancelar'))));i.focus();i.select()};
return h('div',{class:T('row kp')+(here1?T(' cur'):'')},KI('node'),head,h('div',{class:'chips'},
h('button',{onclick:()=>location.hash='#/kiosko/'+k.id},'Ver'),h('button',{onclick:()=>location.hash='#/kiosko/editar/'+k.id},T('Editar')),
here1?null:h('button',{class:'p',onclick:()=>go(()=>api('/kiosks/'+k.id+'/device',{method:'PUT',body:{deviceId:KDEV,label:devLabel.value.trim()||kDevName()}}),reload)},T('Usar aquí')),
h('button',{onclick:ren},T('Renombrar')),mainBtn('panel',k.id),
h('button',{onclick:()=>go(async()=>{const c=await api('/kiosks',{method:'POST',body:{name:k.name+T(' (copia)'),aspect:k.aspect}});await api('/kiosks/'+c.id,{method:'PUT',body:{layout:k.layout}})},reload)},T('Duplicar')),
h('button',{class:'danger',onclick:()=>{if(confirm(T('¿Eliminar el panel «{0}»?', k.name)))go(()=>api('/kiosks/'+k.id,{method:'DELETE'}),reload)}},T('Eliminar'))))};
const grow_=g=>{const secs=g.items.reduce((a,i)=>a+i.secs,0),here1=g.devices.some(d=>d.deviceId===KDEV);
return h('div',{class:T('row kp')+(here1?T(' cur'):'')},KI('node'),h('div',{class:'grow'},h('span',{class:'kn'},g.name),h('div',{class:'mu'},g.items.length+(g.items.length===1?T(' panel'):T(' paneles'))+(g.items.length?T(' · vuelta completa de {0} s', secs):'')+(here1?T(' · en uso en este dispositivo'):'')+(isMain('group',g.id)?T(' · ★ principal'):''))),
h('div',{class:'chips'},h('button',{onclick:()=>location.hash='#/kiosko/g/'+g.id},'Ver'),h('button',{onclick:()=>kGroupEdit(g,kiosks,reload)},T('Editar')),
here1?null:h('button',{class:'p',onclick:()=>go(()=>api('/kiosk-groups/'+g.id+'/device',{method:'PUT',body:{deviceId:KDEV,label:devLabel.value.trim()||kDevName()}}),reload)},T('Usar aquí')),
mainBtn('group',g.id),h('button',{class:'danger',onclick:()=>{if(confirm(T('¿Eliminar el kiosko «{0}»? Los paneles no se borran.', g.name)))go(()=>api('/kiosk-groups/'+g.id,{method:'DELETE'}),reload)}},T('Eliminar'))))};
const gn=h('input',{placeholder:T('Nombre del kiosko (ej. Salón)'),maxlength:'60','aria-label':T('Nombre del nuevo kiosko'),autocomplete:'off'});
const gcreate=()=>{const v=gn.value.trim();if(!v){msg.className='err';msg.textContent=T('Ponle un nombre al kiosko.');return}go(async()=>{const c=await api('/kiosk-groups',{method:'POST',body:{name:v}});const g={...c,items:[]};kGroupEdit(g,kiosks,reload)})};
gn.addEventListener('keydown',e=>{if(e.key==='Enter')gcreate()});
const nn=h('input',{placeholder:T('Nombre del panel (ej. Tablet del salón)'),maxlength:'60','aria-label':T('Nombre del nuevo panel'),autocomplete:'off'});
const create=()=>{const v=nn.value.trim();if(!v){msg.className='err';msg.textContent=T('Ponle un nombre al panel.');return}go(async()=>{const c=await api('/kiosks',{method:'POST',body:{name:v,aspect:kSelfAspect()}});await api('/kiosks/'+c.id+'/device',{method:'PUT',body:{deviceId:KDEV,label:devLabel.value.trim()||kDevName()}}).catch(()=>{});location.hash='#/kiosko/editar/'+c.id})};
nn.addEventListener('keydown',e=>{if(e.key==='Enter')create()});
shell(T('Kioscos'),true,h('div',{class:'mu',style:'max-width:62ch;margin:-4px 0 12px'},T('Un panel es una pantalla diseñada con las fichas que elijas; un kiosko es lo que se muestra en pantalla completa, sin menús: uno o varios paneles. Puedes tener varios kioscos y PVEMon recuerda cuál abre cada dispositivo.')),
here,h('div',{class:'card'},h('b',{class:'bigt'},T('Mis paneles (las pantallas que se diseñan)')),...(kiosks.length?kiosks.map(rowOf):[h('div',{class:'mu'},T('Aún no tienes ningún panel.'))]),
h('div',{class:'chips kn-new'},nn,h('button',{class:'p',onclick:create},T('Crear panel')))),
h('div',{class:'card'},h('b',{class:'bigt'},T('Mis kioscos')),h('div',{class:'mu'},T('Un kiosko reúne los paneles que quieras (un panel puede estar en varios kioscos). Si tiene más de uno, va pasando de uno a otro solo, en el orden y con el tiempo que elijas. Al pulsar «Kiosko» arriba podrás elegir cuál abrir.')),...(groups.length?groups.map(grow_):[]),h('div',{class:'chips kn-new'},gn,h('button',{class:'p',onclick:gcreate},T('Crear kiosko')))),msg)}
/* Editor de un grupo rotativo: orden y segundos de cada panel */
function kGroupEdit(g,kiosks,done){const bk=h('div',{class:'modalbk',role:'dialog','aria-modal':'true','aria-label':T('Kiosko')}),close=()=>bk.remove();
let items=g.items.filter(i=>kiosks.some(k=>k.id===i.kioskId)).map(i=>({...i}));
let fx=g.fx==null?2:g.fx,fxk=g.fxKind||'pixels';const fxs=h('select',{'aria-label':T('Efecto de transición'),onchange:e=>{fxk=e.target.value}},...[['pixels',T('Difusión de píxeles')],['blur',T('Desenfoque')],['none',T('Sin efecto (cambio directo)')]].map(([v,l])=>h('option',{value:v,selected:v===fxk?'':null},l)));const fxi=h('input',{type:'number',min:'0',max:'10',step:'0.5',value:String(fx),'aria-label':T('Segundos de la transición'),onchange:e=>{fx=Math.min(10,Math.max(0,+e.target.value||0));e.target.value=fx}});
const nm=h('input',{value:g.name,maxlength:'60','aria-label':T('Nombre del kiosko')}),list=h('div',{class:'kgl'}),err=h('div',{class:'err',role:'alert'});
const paint=()=>{list.replaceChildren(...(items.length?items.map((it,i)=>h('div',{class:'kgr'},h('span',{class:'mu kgn'},String(i+1)),
h('select',{'aria-label':T('Panel'),onchange:e=>{it.kioskId=e.target.value}},...kiosks.map(k=>h('option',{value:k.id,selected:k.id===it.kioskId?'':null},k.name))),
h('label',{class:'mu kgs'},h('input',{type:'number',min:'3',max:'3600',value:String(it.secs),'aria-label':T('Segundos'),onchange:e=>{it.secs=Math.min(3600,Math.max(3,Math.round(+e.target.value)||15));e.target.value=it.secs}}),' s'),
h('button',{'aria-label':T('Subir'),title:T('Subir'),disabled:i?null:'',onclick:()=>{[items[i-1],items[i]]=[items[i],items[i-1]];paint()}},'↑'),
h('button',{'aria-label':T('Bajar'),title:T('Bajar'),disabled:i<items.length-1?null:'',onclick:()=>{[items[i+1],items[i]]=[items[i],items[i+1]];paint()}},'↓'),
h('button',{class:'danger','aria-label':T('Quitar'),title:T('Quitar'),onclick:()=>{items.splice(i,1);paint()}},'✕'))):[h('div',{class:'mu'},kiosks.length?T('Añade los paneles de este kiosko. Un mismo panel puede estar en varios kioscos.'):T('Primero crea algún panel.'))]))};paint();
const save=async()=>{const v=nm.value.trim();if(!v){err.textContent=T('Ponle un nombre al kiosko.');return}try{await api('/kiosk-groups/'+g.id,{method:'PUT',body:{name:v,fx,fxKind:fxk,items:items.map(i=>({kioskId:i.kioskId,secs:i.secs}))}});close();done()}catch(x){if(x)err.textContent=x.message}};
bk.append(h('div',{class:'modal kpm'},h('b',{},T('Kiosko')),h('label',{class:'f'},h('span',{class:'mu'},T('Nombre')),nm),h('div',{class:'kcust'},h('label',{class:'mu'},T('Transición '),fxs),h('label',{class:'mu kgs'},T('Duración '),fxi,' s'),h('span',{class:'mu'},T('0 s = cambio directo'))),list,
h('div',{class:'chips'},h('button',{disabled:kiosks.length?null:'',onclick:()=>{items.push({kioskId:(kiosks.find(k=>!items.some(i=>i.kioskId===k.id))||kiosks[0]).id,secs:15});paint()}},T('＋ Añadir panel'))),err,
h('div',{class:'chips'},h('button',{class:'p',onclick:save},T('Guardar')),h('button',{onclick:()=>{close();done()}},T('Cancelar')))));bk.addEventListener('click',e=>{if(e.target===bk){close();done()}});document.body.append(bk)}

/* ───── Editor de lienzo ───── */
async function kioskEdit(id){document.body.classList.add('kiosk','kedit');
const k=(await api('/kiosks')).kiosks.find(x=>x.id===id);if(!k){document.body.classList.remove('kiosk','kedit');location.hash='#/kioscos';return}
let layout=k.layout.map(t=>({...t})),aspect=k.aspect,theme=k.theme||'auto',S=[],data=await kLoad(),drag=false,saveT=null;
const snap=()=>JSON.stringify({layout,aspect});let cur=snap(),hist=[],redo=[],lastPush=0;
const status=h('span',{class:'mu ks'},'');
const save=(now)=>{const sn=snap();if(sn!==cur){const t0=Date.now();if(t0-lastPush>900){hist.push(cur);if(hist.length>100)hist.shift();redo=[]}lastPush=t0;cur=sn}clearTimeout(saveT);status.textContent=T('Guardando…');const run=async()=>{try{await api('/kiosks/'+k.id,{method:'PUT',body:{layout,aspect}});status.textContent=T('Guardado ✔')}catch(x){if(x)status.textContent=T('No se pudo guardar: {0}', x.message)}};if(now)run();else saveT=setTimeout(run,700)};
const canvas=h('div',{class:'kcanvas edit'}),stage=h('div',{class:'kstage'},canvas);
const els=()=>new Map(kFlat(data.tree).map(x=>[x.n.id,x.n]));
const fit=()=>{const w=stage.clientWidth-24,hh=stage.clientHeight-24;if(w<=0||hh<=0)return;const cw=Math.min(w,hh*aspect);canvas.style.width=cw+'px';canvas.style.height=(cw/aspect)+'px'};
const selbar=h('div',{class:'ksel'});
let sizeW=null,sizeH=null;
const fitText=t=>{const x=canvas.querySelector(`.kt[data-id="${t.id}"]`),tx=x&&x.querySelector('.kt-tx');if(!tx)return;const r=canvas.getBoundingClientRect();t.h=Math.min(100-t.y,Math.max(4,Math.ceil((tx.offsetHeight+6)/r.height*200)/2));x.style.height=t.h+'%';if(sizeH)sizeH.value=t.h};
const delSel=()=>{layout=layout.filter(x=>!S.includes(x.id));S=[];redraw();save()};
const paintSel=()=>{canvas.querySelectorAll('.kt').forEach(e=>e.classList.toggle('sel',S.includes(e.dataset.id)));const ae=document.activeElement;if(ae&&selbar.contains(ae)&&ae.tagName!=='TEXTAREA')ae.blur();selbar.replaceChildren();sizeW=sizeH=null;setTimeout(fit,0);
if(!S.length){selbar.append(h('span',{class:'mu'},T('Toca una ficha para elegir sus indicadores. Arrastra para moverla; para varias a la vez, traza un cuadro sobre ellas (o Mayús + clic).')));return}
if(S.length>1){selbar.append(h('b',{},T('{0} fichas seleccionadas', S.length)),h('span',{class:'mu'},T('Arrastra cualquiera para moverlas juntas')),h('button',{class:'danger',onclick:delSel},T('Quitar')));return}
const t=layout.find(x=>x.id===S[0]);if(!t){S=[];return paintSel()}const n=els().get(t.elementId);
const mn=t.mini?5:4;sizeW=h('input',{type:'number',class:'kn2',min:String(mn),max:'100',step:'0.5',value:String(t.w),'aria-label':T('Ancho en % de la pantalla')});sizeH=h('input',{type:'number',class:'kn2',min:String(mn),max:'100',step:'0.5',value:String(t.h),'aria-label':T('Alto en % de la pantalla')});
const applySize=()=>{const w=+sizeW.value,hh=+sizeH.value;if(!(w>0&&hh>0))return;t.w=Math.min(100-t.x,Math.max(mn,Math.round(w*2)/2));t.h=Math.min(100-t.y,Math.max(mn,Math.round(hh*2)/2));sizeW.value=t.w;sizeH.value=t.h;redraw(t.id);save()};
sizeW.addEventListener('change',applySize);sizeH.addEventListener('change',applySize);
const sz=h('label',{class:'mu',title:T('Tamaño de la ficha en % de la pantalla: ancho × alto')},T('Tamaño '),sizeW,' × ',sizeH,' %');
if(t.type==='text'){const upd=()=>{const x=canvas.querySelector(`.kt[data-id="${t.id}"]`);if(x){const nt=mk(t,els());x.replaceWith(nt)}save()};
const ta=h('textarea',{'data-nolbl':'',rows:'2','aria-label':T('Texto'),placeholder:T('Escribe el texto…'),oninput:e=>{t.text=e.target.value;const x=canvas.querySelector(`.kt[data-id="${t.id}"] .kt-tx`);if(x)x.textContent=t.text||T('Texto');fitText(t);save()}});ta.value=t.text||'';
selbar.append(h('b',{},T('Texto')),ta,h('select',{'aria-label':T('Tamaño de la letra'),onchange:e=>{t.fs=+e.target.value;upd();fitText(t);save()}},...[T('Muy pequeña'),T('Pequeña'),T('Mediana'),T('Grande'),T('Muy grande'),T('Enorme')].map((l,i)=>h('option',{value:String(i+1),selected:(t.fs||3)===i+1?'':null},l))),
...[['left',T('Izq.')],['center',T('Centro')],['right',T('Der.')]].map(([v,l])=>h('button',{class:'tg'+((t.al||'left')===v?' on':''),'aria-pressed':String((t.al||'left')===v),onclick:()=>{t.al=v;upd();paintSel()}},l)),
h('button',{class:'tg'+(t.bg?' on':''),'aria-pressed':String(!!t.bg),title:T('Fondo de tarjeta'),onclick:()=>{t.bg=!t.bg;upd();paintSel()}},T('Fondo')),sz,h('button',{title:T('Ajusta el alto de la ficha al texto'),onclick:()=>{fitText(t);save()}},T('Ajustar alto')),h('button',{class:'danger',onclick:delSel},T('Quitar')));return}
selbar.append(h('b',{},t.type?KSPEC[t.type]:n?n.name:T('Elemento no disponible')),...(t.type?[]:['cpu','mem','disk']).map(key=>{const av=n&&n.kind!=='backup'&&kMetric(n,data.L,key);return h('button',{class:'tg'+(t[key]&&av?' on':''),disabled:av?null:'',title:av?null:T('No disponible para este elemento'),'aria-pressed':String(!!(t[key]&&av)),onclick:()=>{t[key]=!t[key];redraw(t.id);save()}},KLAB[key])}),
h('button',{class:'tg'+(t.mini?' on':''),'aria-pressed':String(!!t.mini),title:T('Solo icono, nombre y LED'),onclick:()=>{if(t.mini){t.mini=false;t.h=t.ph||34;delete t.ph}else{t.mini=true;t.ph=t.h;t.h=Math.min(t.h,10);t.w=Math.min(t.w,30)}redraw(t.id);save();paintSel()}},'MINI'),sz,h('button',{class:'danger',onclick:delSel},T('Quitar')))};
const redraw=(only)=>{const m=els();if(only){const t=layout.find(x=>x.id===only),old=canvas.querySelector(`.kt[data-id="${only}"]`);if(t&&old){const ne=mk(t,m);old.replaceWith(ne)}}else canvas.replaceChildren(...layout.map(t=>mk(t,m)));
if(!layout.length&&!only)canvas.append(h('div',{class:'kempty'},T('Lienzo en blanco. Pulsa «＋ Elemento» para añadir el primero.')));paintSel()};
const mk=(t,m)=>{const e=kTile(t,m.get(t.elementId),data.L,false,data.tree);e.append(...['n','s','e','w','se'].map(r=>h('span',{class:r==='se'?'krs':T('kre kre-{0}', r),'data-rs':r,title:r==='se'?T('Cambiar tamaño'):r==='n'||r==='s'?T('Cambiar el alto'):T('Cambiar el ancho')})));e.addEventListener('pointerdown',ev=>{if(ev.button>0)return;ev.preventDefault();const rs=ev.target.dataset&&ev.target.dataset.rs,mod=ev.shiftKey||ev.ctrlKey||ev.metaKey;
if(mod&&!rs){S=S.includes(t.id)?S.filter(x=>x!==t.id):[...S,t.id];paintSel();return}
if(rs||!S.includes(t.id)){S=[t.id];paintSel()}
const grp=!rs&&S.length>1?S.map(i2=>layout.find(x=>x.id===i2)).filter(Boolean):null;
const r=canvas.getBoundingClientRect(),mode=rs||'mv',sx=ev.clientX,sy=ev.clientY,o={...t},os=grp?grp.map(g=>({g,x:g.x,y:g.y})):null;let moved=false;drag=true;e.setPointerCapture(ev.pointerId);
const put=(g)=>{const x=canvas.querySelector(`.kt[data-id="${g.id}"]`);if(x){x.style.left=g.x+'%';x.style.top=g.y+'%';x.style.width=g.w+'%';x.style.height=g.h+'%'}};
const mv=q=>{const dx=(q.clientX-sx)/r.width*100,dy=(q.clientY-sy)/r.height*100,s=v=>Math.round(v*2)/2;if(Math.abs(q.clientX-sx)+Math.abs(q.clientY-sy)>3)moved=true;
const mn=t.mini?5:8,cl=(v,a,b)=>Math.min(b,Math.max(a,v));
if(os){const x0=Math.min(...os.map(z=>z.x)),x1=Math.max(...os.map(z=>z.x+z.g.w)),y0=Math.min(...os.map(z=>z.y)),y1=Math.max(...os.map(z=>z.y+z.g.h)),ddx=cl(s(dx),-x0,100-x1),ddy=cl(s(dy),-y0,100-y1);for(const z of os){z.g.x=z.x+ddx;z.g.y=z.y+ddy;put(z.g)}return}
if(mode==='mv'){t.x=cl(s(o.x+dx),0,100-t.w);t.y=cl(s(o.y+dy),0,100-t.h)}else{
if(mode.includes('e')){t.w=cl(s(o.w+dx),mn,100-o.x)}
if(mode==='w'){const nx=cl(s(o.x+dx),0,o.x+o.w-mn);t.w=o.w+(o.x-nx);t.x=nx}
if(mode.includes('s')){t.h=cl(s(o.h+dy),mn,100-o.y)}
if(mode==='n'){const ny=cl(s(o.y+dy),0,o.y+o.h-mn);t.h=o.h+(o.y-ny);t.y=ny}}
put(t);if(sizeW){sizeW.value=t.w;sizeH.value=t.h}};
const up=()=>{e.removeEventListener('pointermove',mv);e.removeEventListener('pointerup',up);e.removeEventListener('pointercancel',up);drag=false;if(grp&&!moved){S=[t.id];paintSel()}if(t.type==='text'&&(mode==='e'||mode==='w'||mode==='se'))fitText(t);save()};
e.addEventListener('pointermove',mv);e.addEventListener('pointerup',up);e.addEventListener('pointercancel',up)});
e.classList.toggle('sel',S.includes(t.id));return e};
const free=(w,hh)=>{for(let y=2;y<=100-hh;y+=2)for(let x=2;x<=100-w;x+=2)if(!layout.some(t=>x<t.x+t.w&&x+w>t.x&&y<t.y+t.h&&y+hh>t.y))return[x,y];const c=layout.length*3%20;return[Math.min(100-w,2+c),Math.min(100-hh,2+c)]};
const add=ent=>{const n=ent.n,bk=n.kind==='backup',av=k2=>!bk&&!!kMetric(n,data.L,k2),ng=['cpu','mem','disk'].filter(av).length,w=bk?24:Math.min(48,Math.max(22,ng*16)),hh=bk?20:34,[x,y]=free(w,hh);
const t={id:'t'+Date.now().toString(36)+Math.floor(Math.random()*1e3),elementId:n.id,x,y,w,h:hh,cpu:av('cpu'),mem:av('mem'),disk:av('disk')};layout.push(t);S=[t.id];redraw();save()};
const addSpec=ty=>{const w=ty==='text'?30:44,hh=ty==='text'?16:ty==='systems'?36:40,[x,y]=free(w,hh);const t={id:'t'+Date.now().toString(36)+Math.floor(Math.random()*1e3),elementId:'',type:ty,x,y,w,h:hh,cpu:false,mem:false,disk:false,...(ty==='text'?{text:T('Texto'),fs:4,al:'left'}:{})};layout.push(t);S=[t.id];redraw();save();if(ty==='text')setTimeout(()=>{fitText(t);save();const ta=selbar.querySelector('textarea');if(ta){ta.focus();ta.select()}},50)};
const picker=()=>{const bk=h('div',{class:'modalbk',role:'dialog','aria-modal':'true','aria-label':T('Añadir un elemento')}),close=()=>bk.remove(),q=h('input',{'data-nolbl':'',placeholder:T('Buscar…'),'aria-label':T('Buscar'),autocomplete:'off'}),list=h('div',{class:'kpick'});
const used=new Set(layout.map(t=>t.type||t.elementId));
const paint=()=>{const f=q.value.trim().toLowerCase(),all=kFlat(data.tree).filter(x=>!f||(x.n.name+' '+x.path).toLowerCase().includes(f));let last=null;const rows=[];
if(!f||/estado|resumen|sistema|backup|texto|cuadro|otro/.test(f)){rows.push(h('div',{class:'kpg mu'},T('Resúmenes y texto')));for(const ty of['systems','backups','text']){const u=ty!=='text'&&used.has(ty);rows.push(h('button',{class:'kpr',disabled:u?'':null,onclick:()=>{addSpec(ty);close()}},h('span',{class:'grow'},KSPEC[ty]),h('span',{class:'mu'},u?T('ya añadido'):ty==='text'?T('Texto libre'):T('Resumen'))))}}
for(const x of all){if(x.path!==last){rows.push(h('div',{class:'kpg mu'},x.path||T('Copias por correo y archivos')));last=x.path}
const u=used.has(x.n.id);rows.push(h('button',{class:'kpr',disabled:u?'':null,onclick:()=>{add(x);close()}},x.n.kind==='backup'?KI(x.n.info&&x.n.info.fileCheck?'filebk':'mailbk'):KI(x.n.kind),h('span',{class:'grow'},x.n.name),h('span',{class:'mu'},u?T('ya añadido'):KIND[x.n.kind]||'')))}
list.replaceChildren(...(rows.length?rows:[h('div',{class:'mu'},T('No hay elementos que coincidan.'))]))};q.addEventListener('input',paint);paint();
bk.append(h('div',{class:'modal kpm'},h('b',{},T('Añadir un elemento')),q,list,h('div',{class:'chips'},h('button',{onclick:close},T('Cerrar')))));bk.addEventListener('click',e=>{if(e.target===bk)close()});document.body.append(bk);q.focus()};
const nm=h('input',{class:'kname',value:k.name,maxlength:'60','aria-label':T('Nombre del panel'),onchange:e=>{const v=e.target.value.trim();if(v){k.name=v;api('/kiosks/'+k.id,{method:'PUT',body:{name:v}}).then(()=>status.textContent=T('Guardado ✔')).catch(x=>{if(x)status.textContent=x.message})}else e.target.value=k.name}});
const self=kSelfAspect();
const aspOpts=()=>{const o=[[self,T('Esta pantalla ({0}×{1})', innerWidth, innerHeight)],...KASP];if(!o.some(x=>Math.abs(x[0]-aspect)<.01))o.push([aspect,T('Personalizada ({0})', aspect.toFixed(2))]);return o};
const asp=h('select',{'aria-label':T('Forma de la pantalla del dispositivo')});
const fillAsp=()=>asp.replaceChildren(...aspOpts().map(([v,l])=>h('option',{value:String(v),selected:Math.abs(v-aspect)<.01?'':null},l)),h('option',{value:'custom'},T('Personalizar…')));
const custom=()=>{const bk=h('div',{class:'modalbk',role:'dialog','aria-modal':'true','aria-label':T('Tamaño personalizado')}),close=()=>{bk.remove();fillAsp()};
const hh0=1080,ww0=Math.round(hh0*aspect),wi=h('input',{type:'number',min:'100',max:'10000',value:String(ww0),'aria-label':T('Ancho')}),hi=h('input',{type:'number',min:'100',max:'10000',value:String(hh0),'aria-label':T('Alto')}),er=h('div',{class:'err',role:'alert'});
const ok=()=>{const w=+wi.value,hh=+hi.value;if(!(w>=100&&hh>=100)||w/hh<.3||w/hh>4){er.textContent=T('Pon un ancho y un alto razonables (la proporción debe estar entre 0,3 y 4).');return}aspect=Math.round(w/hh*1000)/1000;bk.remove();fillAsp();fit();save()};
[wi,hi].forEach(i2=>i2.addEventListener('keydown',e=>{if(e.key==='Enter')ok()}));
bk.append(h('div',{class:'modal kpm'},h('b',{},T('Tamaño de la pantalla')),h('div',{class:'mu'},T('Escribe el ancho y el alto de la pantalla donde se verá este panel (en píxeles, p. ej. 1920 × 1080). Solo cuenta la proporción: las fichas se adaptan a cualquier resolución.')),
h('div',{class:'kcust'},h('label',{},T('Ancho '),wi),' × ',h('label',{},T('Alto '),hi),' px'),er,
h('div',{class:'chips'},h('button',{class:'p',onclick:ok},T('Aplicar')),h('button',{onclick:()=>{wi.value=innerWidth;hi.value=innerHeight}},T('Usar esta pantalla')),h('button',{onclick:close},T('Cancelar')))));bk.addEventListener('click',e=>{if(e.target===bk)close()});document.body.append(bk);wi.focus();wi.select()};
asp.addEventListener('change',e=>{if(e.target.value==='custom'){custom();return}aspect=+e.target.value;fillAsp();fit();save()});fillAsp();
const thm=h('select',{'aria-label':T('Tema del panel'),title:T('Tema del panel'),onchange:e=>{theme=e.target.value;kTheme(theme);status.textContent=T('Guardando…');api('/kiosks/'+k.id,{method:'PUT',body:{theme}}).then(()=>status.textContent=T('Guardado ✔')).catch(x=>{if(x)status.textContent=x.message})}},...[['auto',T('Auto')],['light',T('Claro')],['dark',T('Oscuro')]].map(([v,l])=>h('option',{value:v,selected:v===theme?'':null},l)));kTheme(theme);
const tb=h('div',{class:'ktb'},h('button',{class:'back',onclick:()=>location.hash='#/kioscos','aria-label':T('Volver a Mis paneles')},'←'),nm,h('label',{class:'ka mu'},T('Pantalla'),asp),h('label',{class:'ka mu'},T('Tema'),thm),h('button',{class:'p',onclick:picker},T('＋ Elemento')),h('button',{onclick:()=>{save(true);try{sessionStorage.setItem('pvemon.kprev',k.id)}catch{}setTimeout(()=>location.hash='#/kiosko/'+k.id,150)}},T('Vista previa')),status);
const root=h('div',{class:'ke'},tb,selbar,stage);$.replaceChildren(root);
canvas.addEventListener('pointerdown',e=>{if(!(e.target===canvas||e.target.classList.contains('kempty'))||e.button>0)return;e.preventDefault();
const sx=e.clientX,sy=e.clientY,add=e.shiftKey||e.ctrlKey||e.metaKey,base=add?[...S]:[],q=h('div',{class:'kmq'});if(!add){S=[];paintSel()}const r=canvas.getBoundingClientRect();drag=true;canvas.append(q);canvas.setPointerCapture(e.pointerId);
const mv=ev=>{const x0=Math.min(sx,ev.clientX),x1=Math.max(sx,ev.clientX),y0=Math.min(sy,ev.clientY),y1=Math.max(sy,ev.clientY);
q.style.cssText=`left:${x0-r.left}px;top:${y0-r.top}px;width:${x1-x0}px;height:${y1-y0}px`;
const hit=layout.filter(t=>{const l=r.left+t.x/100*r.width,tp=r.top+t.y/100*r.height,rr=l+t.w/100*r.width,b=tp+t.h/100*r.height;return l<x1&&rr>x0&&tp<y1&&b>y0}).map(t=>t.id);
S=[...new Set([...base,...hit])];canvas.querySelectorAll('.kt').forEach(x=>x.classList.toggle('sel',S.includes(x.dataset.id)))};
const up=()=>{canvas.removeEventListener('pointermove',mv);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',up);q.remove();drag=false;paintSel()};
canvas.addEventListener('pointermove',mv);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',up)});
const inField=()=>/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
const restore=str=>{const o=JSON.parse(str);layout=o.layout;aspect=o.aspect;cur=str;lastPush=0;S=S.filter(i=>layout.some(t=>t.id===i));fillAsp();fit();redraw();save(true)};
const undo=()=>{if(!hist.length)return;redo.push(cur);restore(hist.pop())},rdo=()=>{if(!redo.length)return;hist.push(cur);restore(redo.pop())};
const nudge=(dx,dy)=>{const g=S.map(i=>layout.find(t=>t.id===i)).filter(Boolean);if(!g.length)return;
const x0=Math.min(...g.map(t=>t.x)),x1=Math.max(...g.map(t=>t.x+t.w)),y0=Math.min(...g.map(t=>t.y)),y1=Math.max(...g.map(t=>t.y+t.h)),ax=Math.min(100-x1,Math.max(-x0,dx)),ay=Math.min(100-y1,Math.max(-y0,dy));
if(!ax&&!ay)return;for(const t of g){t.x=Math.round((t.x+ax)*2)/2;t.y=Math.round((t.y+ay)*2)/2;const x=canvas.querySelector(`.kt[data-id="${t.id}"]`);if(x){x.style.left=t.x+'%';x.style.top=t.y+'%'}}save()};
const AR={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
const kd=e=>{if(document.querySelector('.modalbk'))return;const z=(e.metaKey||e.ctrlKey)&&!e.altKey&&e.key.toLowerCase()==='z',y=(e.ctrlKey&&!e.metaKey&&e.key.toLowerCase()==='y');
if((z||y)&&!inField()){e.preventDefault();(y||(z&&e.shiftKey))?rdo():undo();return}
if(AR[e.key]&&S.length&&!inField()&&!e.metaKey&&!e.ctrlKey&&!e.altKey){e.preventDefault();const st=e.shiftKey?5:.5;nudge(AR[e.key][0]*st,AR[e.key][1]*st);return}
if((e.key==='Delete'||e.key==='Backspace')&&S.length&&!inField()){delSel()}};document.addEventListener('keydown',kd);
addEventListener('resize',fit);fit();redraw();
kClean=()=>{THEME.apply();removeEventListener('resize',fit);document.removeEventListener('keydown',kd);clearTimeout(saveT)};
timer=setInterval(async()=>{if(drag||document.querySelector('.modalbk'))return;try{data=await kLoad();if(document.activeElement&&document.activeElement.tagName==='TEXTAREA')return;const s=S;redraw();S=s;paintSel()}catch{}},15000)}
