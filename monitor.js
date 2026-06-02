const $ = id => document.getElementById(id);
const PEER_PREFIX = 'mardur-inspector-v11-';
const remoteVideo = $('remoteVideo');
const overlay = $('monitorOverlay');
const ctx = overlay.getContext('2d');
let peer=null, conn=null, currentCode='', lastPayload=null;

function toast(msg){ const t=$('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove('show'),2200); }
function setBadge(id,text,cls='idle'){ const el=$(id); if(!el) return; el.textContent=text; el.className='badge '+cls; }
function fmt(n,d=1){ return Number.isFinite(+n) ? Number(n).toFixed(d) : '--'; }
function generateCode(){ const letters='ABCDEFGHJKLMNPQRSTUVWXYZ'; let s=''; for(let i=0;i<3;i++) s+=letters[Math.floor(Math.random()*letters.length)]; for(let i=0;i<4;i++) s+=Math.floor(Math.random()*10); return s; }

function startPeer(code=generateCode()){
  currentCode=code; $('bigCode').textContent=code;
  $('appUrl').textContent = new URL('./', location.href).href + '?v=11&code=' + encodeURIComponent(code);
  if(peer){ try{peer.destroy();}catch{} }
  const id=PEER_PREFIX+code.toLowerCase();
  setBadge('peerStatus','Esperando iPhone','warn'); setBadge('phoneStatus','No conectado','idle'); setBadge('videoStatus','Sin video','idle'); $('liveDot').textContent='OFF'; $('liveDot').className='live-dot off';
  peer=new Peer(id,{debug:0});
  peer.on('open',()=>{ setBadge('peerStatus','Código listo','ok'); });
  peer.on('connection', c=>{ conn=c; setupConn(); });
  peer.on('call', call=>{
    call.answer();
    call.on('stream', stream=>{
      remoteVideo.srcObject=stream;
      remoteVideo.onloadedmetadata=()=>{ remoteVideo.play().catch(()=>{}); resizeOverlay(); };
      setBadge('videoStatus','Video en vivo','ok'); $('liveDot').textContent='LIVE'; $('liveDot').className='live-dot on';
    });
  });
  peer.on('error',err=>{ console.error(err); setBadge('peerStatus','Error enlace','bad'); toast('Error PeerJS: '+(err.type||err.message||err)); });
}
function setupConn(){
  setBadge('phoneStatus','iPhone conectado','ok'); toast('iPhone vinculado');
  conn.on('data', handleMsg);
  conn.on('close',()=>{ setBadge('phoneStatus','Desconectado','bad'); });
  send({type:'hello',role:'monitor'});
  pushConfig();
}
function send(obj){ if(conn && conn.open){ try{conn.send(obj);}catch(e){console.warn(e);} } else toast('Aún no hay iPhone conectado'); }
function cmd(name,payload=null){ send({type:'command',cmd:name,payload}); }
function handleMsg(msg){
  if(!msg) return;
  if(msg.type==='analysis'){ lastPayload=msg; renderAnalysis(msg); drawOverlay(msg); }
  if(msg.type==='state'){ renderState(msg); if(msg.config) applyConfigToPC(msg.config); }
  if(msg.type==='log') renderLog(msg.log||[], msg.counts);
  if(msg.type==='hello') setBadge('phoneStatus','iPhone conectado','ok');
  if(msg.type==='error') toast((msg.scope||'Error')+': '+msg.message);
}
function renderAnalysis(p){
  $('decision').textContent=p.result||'ESPERANDO';
  $('decision').className='decision '+(p.pass?'ok':p.result==='RECHAZADO'?'bad':'neutral');
  $('reason').textContent=p.reason||'';
  $('mScore').textContent=p.score!=null?`${fmt(p.score,0)}%`:'--';
  $('mAlign').textContent=p.text?.alignmentScore!=null?`${fmt(p.text.alignmentScore,0)}%`:'--';
  $('mSize').textContent=p.patch?`${fmt(p.patch.widthCm,2)} × ${fmt(p.patch.heightCm,2)} cm`:'--';
  $('mPerimeter').textContent=p.patch?`${fmt(p.patch.perimeterCm,2)} cm`:'--';
  $('mArea').textContent=p.patch?`${fmt(p.patch.areaCm2,2)} cm²`:'--';
  $('mBaseText').textContent=p.text?.baseToTextMm!=null?`${fmt(p.text.baseToTextMm,1)} mm`:'--';
  $('mOffset').textContent=p.text?.offsetMm!=null?`${fmt(p.text.offsetMm,1)} mm`:'--';
  $('mAngle').textContent=p.text?.angleDeg!=null?`${fmt(p.text.angleDeg,1)}°`:'--';
}
function renderState(s){
  $('stCamera').textContent=s.camera?'OK':'No';
  $('stCalibration').textContent=s.calibration?'OK':'No';
  $('stReference').textContent=s.reference?'OK':'No';
  $('stAuto').textContent=s.autoMode?'ON':'OFF';
  if(s.counts) renderCounts(s.counts);
}
function renderCounts(c){ const total=c.total||0, ok=c.ok||0, bad=c.bad||0; $('okCount').textContent=ok; $('badCount').textContent=bad; $('totalCount').textContent=total; $('okPct').textContent=total?`${Math.round(ok/total*100)}%`:'--'; }
function renderLog(rows, counts){ if(counts) renderCounts(counts); $('logBody').innerHTML=rows.slice(0,80).map(r=>`<tr><td>${esc(r.time)}</td><td>${esc(r.result)}</td><td>${esc(String(r.align||''))}</td><td>${esc(r.reason||'')}</td></tr>`).join(''); }
function esc(s){ return String(s??'').replace(/[&<>]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[ch])); }

function getConfig(){ return {
  chkText:$('pcChkText').checked, chkSize:$('pcChkSize').checked, chkArea:$('pcChkArea').checked,
  minAlign:+$('pcMinAlign').value||85, maxErrX:+$('pcMaxErrX').value||3, maxErrY:+$('pcMaxErrY').value||3,
  maxTextAngle:+$('pcMaxTextAngle').value||5, textYStart:+$('pcTextYStart').value||45, textYEnd:+$('pcTextYEnd').value||92
};}
function applyConfigToPC(c){
  const map={minAlign:'pcMinAlign',maxErrX:'pcMaxErrX',maxErrY:'pcMaxErrY',maxTextAngle:'pcMaxTextAngle',textYStart:'pcTextYStart',textYEnd:'pcTextYEnd'};
  Object.entries(map).forEach(([k,id])=>{ if(c[k]!==undefined) $(id).value=c[k]; });
  if(c.chkText!==undefined) $('pcChkText').checked=!!c.chkText;
  if(c.chkSize!==undefined) $('pcChkSize').checked=!!c.chkSize;
  if(c.chkArea!==undefined) $('pcChkArea').checked=!!c.chkArea;
}
function pushConfig(){ send({type:'config',config:getConfig()}); }

function resizeOverlay(){
  const r=overlay.getBoundingClientRect(), dpr=window.devicePixelRatio||1;
  overlay.width=Math.max(1,Math.round(r.width*dpr)); overlay.height=Math.max(1,Math.round(r.height*dpr));
  ctx.setTransform(dpr,0,0,dpr,0,0); if(lastPayload) drawOverlay(lastPayload);
}
window.addEventListener('resize',resizeOverlay);
remoteVideo.addEventListener('loadedmetadata',resizeOverlay);
function drawOverlay(p){
  const cw=overlay.clientWidth, ch=overlay.clientHeight; ctx.clearRect(0,0,cw,ch);
  if(!p?.imageSize || !p?.shapes?.length) return;
  const fit=containFit(p.imageSize.w,p.imageSize.h,cw,ch);
  ctx.save(); ctx.translate(fit.x,fit.y); ctx.scale(fit.s,fit.s); p.shapes.forEach(s=>drawShape(ctx,s)); ctx.restore();
}
function containFit(iw,ih,cw,ch){ const s=Math.min(cw/iw,ch/ih); return {s,x:(cw-iw*s)/2,y:(ch-ih*s)/2}; }
function drawShape(ctx,s){
  const scale=ctx.getTransform?.().a||1; ctx.lineWidth=3/scale; ctx.strokeStyle=s.color||'#24d18f'; ctx.fillStyle=s.color||'#24d18f'; ctx.font=`${15/scale}px system-ui`;
  if(s.type==='poly' && s.pts?.length){ ctx.beginPath(); s.pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)); ctx.closePath(); ctx.stroke(); if(s.label) ctx.fillText(s.label,s.pts[0].x+5,s.pts[0].y-7); }
  if(s.type==='point'){ ctx.beginPath(); ctx.arc(s.x,s.y,6,0,Math.PI*2); ctx.fill(); if(s.label) ctx.fillText(s.label,s.x+8,s.y-8); }
  if(s.type==='cross'){ const r=12; ctx.beginPath(); ctx.moveTo(s.x-r,s.y); ctx.lineTo(s.x+r,s.y); ctx.moveTo(s.x,s.y-r); ctx.lineTo(s.x,s.y+r); ctx.stroke(); if(s.label) ctx.fillText(s.label,s.x+8,s.y-8); }
  if(s.type==='line'){ ctx.beginPath(); ctx.moveTo(s.x1,s.y1); ctx.lineTo(s.x2,s.y2); ctx.stroke(); if(s.label) ctx.fillText(s.label,s.x1+5,s.y1-7); }
}

document.querySelectorAll('[data-cmd]').forEach(btn=>btn.addEventListener('click',()=>cmd(btn.dataset.cmd)));
$('btnPushConfig').onclick=pushConfig;
$('btnNewCode').onclick=()=>startPeer(generateCode());
$('btnCopyCode').onclick=async()=>{ try{ await navigator.clipboard.writeText(currentCode); toast('Código copiado'); }catch{ toast('Código: '+currentCode); } };
['pcChkText','pcChkSize','pcChkArea','pcMinAlign','pcMaxErrX','pcMaxErrY','pcMaxTextAngle','pcTextYStart','pcTextYEnd'].forEach(id=>$(id).addEventListener('change',pushConfig));
startPeer(); resizeOverlay();
