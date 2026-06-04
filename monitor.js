const $ = id => document.getElementById(id);
const remoteVideo = $('remoteVideo');
const overlay = $('monitorOverlay');
const ctx = overlay.getContext('2d');
let peer=null;
let lastPayload=null;

initMonitor();

function initMonitor(){
  resizeOverlay(); window.addEventListener('resize', resizeOverlay);
  if(typeof Peer === 'undefined'){
    setBadge('peerStatus','PeerJS no cargó','bad');
    $('appUrl').textContent='No cargó PeerJS. Revisa internet.';
    return;
  }
  peer = new Peer();
  peer.on('open', id=>{
    setBadge('peerStatus','QR listo','ok');
    const appUrl = new URL('./', location.href).href + '?monitor=' + encodeURIComponent(id);
    $('appUrl').textContent = appUrl;
    try{ new QRCode($('qrcode'), {text:appUrl, width:240, height:240, correctLevel:QRCode.CorrectLevel.M}); }
    catch{ $('qrcode').textContent='QR no disponible. Copia la URL.'; }
  });
  peer.on('call', call=>{
    call.answer();
    call.on('stream', stream=>{
      remoteVideo.srcObject = stream;
      setBadge('phoneStatus','Video recibido','ok');
      remoteVideo.onloadedmetadata=()=>{ remoteVideo.play(); resizeOverlay(); };
    });
  });
  peer.on('connection', conn=>{
    setBadge('phoneStatus','Celular conectado','ok');
    conn.on('data', data=>{
      lastPayload=data;
      renderPayload(data);
      drawOverlay(data);
    });
    conn.on('close',()=>setBadge('phoneStatus','Celular desconectado','warn'));
  });
  peer.on('error', e=>{ console.error(e); setBadge('peerStatus','Error Peer','bad'); $('dataLog').textContent=e.message || String(e); });
}
function setBadge(id,text,cls='idle'){ const el=$(id); el.textContent=text; el.className='badge '+cls; }
function resizeOverlay(){
  const r=overlay.getBoundingClientRect(); const dpr=window.devicePixelRatio||1;
  overlay.width=Math.max(1,Math.round(r.width*dpr)); overlay.height=Math.max(1,Math.round(r.height*dpr));
  ctx.setTransform(dpr,0,0,dpr,0,0); if(lastPayload) drawOverlay(lastPayload);
}
function renderPayload(p){
  $('dataLog').textContent=JSON.stringify(p,null,2);
  if(p.type!=='analysis') return;
  $('decision').textContent=p.result || 'ESPERANDO';
  $('decision').className='decision '+(p.pass?'ok':p.result==='RECHAZADO'?'bad':'neutral');
  $('reason').textContent=p.reason || '';
  $('mAlign').textContent=p.text?.alignmentScore!=null ? `${p.text.alignmentScore}%` : '--';
  $('mSize').textContent=p.patch ? `${p.patch.widthCm.toFixed(2)} × ${p.patch.heightCm.toFixed(2)} cm` : '--';
  $('mPerimeter').textContent=p.patch ? `${p.patch.perimeterCm.toFixed(2)} cm` : '--';
  $('mArea').textContent=p.patch ? `${p.patch.areaCm2.toFixed(2)} cm²` : '--';
  $('mOffset').textContent=p.text?.offsetMm!=null ? `${p.text.offsetMm.toFixed(1)} mm` : '--';
  $('mAngle').textContent=p.text?.angleDeg!=null ? `${p.text.angleDeg.toFixed(1)}°` : '--';
}
function drawOverlay(p){
  const cw=overlay.clientWidth, ch=overlay.clientHeight; ctx.clearRect(0,0,cw,ch);
  if(!p?.imageSize || !p?.shapes) return;
  const fit=containFit(p.imageSize.w,p.imageSize.h,cw,ch);
  ctx.save(); ctx.translate(fit.x,fit.y); ctx.scale(fit.s,fit.s);
  p.shapes.forEach(s=>drawShape(ctx,s));
  ctx.restore();
}
function containFit(iw,ih,cw,ch){ const s=Math.min(cw/iw,ch/ih); return {s,x:(cw-iw*s)/2,y:(ch-ih*s)/2}; }
function drawShape(ctx,s){
  const scale=ctx.getTransform?.().a || 1; ctx.lineWidth=3/scale; ctx.strokeStyle=s.color||'#24d18f'; ctx.fillStyle=s.color||'#24d18f'; ctx.font=`${15/scale}px system-ui`;
  if(s.type==='poly' && s.pts?.length){ ctx.beginPath(); s.pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)); ctx.closePath(); ctx.stroke(); if(s.label) ctx.fillText(s.label,s.pts[0].x+5,s.pts[0].y-7); }
  if(s.type==='point'){ ctx.beginPath(); ctx.arc(s.x,s.y,6,0,Math.PI*2); ctx.fill(); if(s.label) ctx.fillText(s.label,s.x+8,s.y-8); }
  if(s.type==='cross'){ const r=12; ctx.beginPath(); ctx.moveTo(s.x-r,s.y); ctx.lineTo(s.x+r,s.y); ctx.moveTo(s.x,s.y-r); ctx.lineTo(s.x,s.y+r); ctx.stroke(); if(s.label) ctx.fillText(s.label,s.x+8,s.y-8); }
  if(s.type==='line'){ ctx.beginPath(); ctx.moveTo(s.x1,s.y1); ctx.lineTo(s.x2,s.y2); ctx.stroke(); if(s.label) ctx.fillText(s.label,s.x1+5,s.y1-7); }
}
