const $ = id => document.getElementById(id);
const PEER_PREFIX = 'mardur-inspector-v10-';
let peer=null, conn=null, currentCode='', log=[];
function toast(msg){ const t=$('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove('show'),2200); }
function setStatus(text, cls='idle'){ $('monitorStatus').textContent=text; $('monitorStatus').className='badge '+cls; }
function fmt(n,d=1){ return Number.isFinite(n)?Number(n).toFixed(d):'--'; }
function generateCode(){ const letters='ABCDEFGHJKLMNPQRSTUVWXYZ'; let s=''; for(let i=0;i<3;i++) s+=letters[Math.floor(Math.random()*letters.length)]; for(let i=0;i<4;i++) s+=Math.floor(Math.random()*10); return s; }
function startPeer(code=generateCode()){
  currentCode=code; $('bigCode').textContent=code;
  if(peer){ try{peer.destroy();}catch(e){} }
  setStatus('Inicializando','warn');
  const id=PEER_PREFIX+code.toLowerCase();
  peer=new Peer(id,{debug:0});
  peer.on('open',()=>{ setStatus('Esperando iPhone','warn'); $('peerInfo').textContent='ID listo: '+id; });
  peer.on('connection',c=>{ conn=c; setupConn(); });
  peer.on('call',call=>{ call.answer(); call.on('stream',remoteStream=>{ $('remoteVideo').srcObject=remoteStream; setStatus('Video conectado','live'); }); });
  peer.on('error',err=>{ console.error(err); setStatus('Error enlace','bad'); $('peerInfo').textContent='Error: '+err.type+'. Genera otro código si hace falta.'; });
}
function setupConn(){
  setStatus('iPhone conectado','ok'); toast('iPhone vinculado');
  conn.on('data',handleMsg);
  conn.on('close',()=>{ setStatus('iPhone desconectado','bad'); });
  conn.send({type:'hello',role:'monitor',code:currentCode});
  pushConfig();
}
function send(obj){ if(conn && conn.open){ try{conn.send(obj);}catch(e){console.warn(e);} } else toast('Aún no hay iPhone conectado'); }
function cmd(name,payload=null){ send({type:'command',cmd:name,payload}); }
function handleMsg(msg){
  if(!msg) return;
  if(msg.type==='state') updateState(msg);
  if(msg.type==='analysis') updateAnalysis(msg);
  if(msg.type==='calibration') { if(msg.debugImage) $('debugImage').src=msg.debugImage; toast('Calibración recibida'); }
  if(msg.type==='reference') toast('Referencia 100% guardada en iPhone');
  if(msg.type==='log') { log=msg.log||[]; renderLog(msg.counts); }
  if(msg.type==='error') toast((msg.scope||'Error')+': '+msg.message);
}
function updateState(s){
  const pieces=[];
  pieces.push(s.camera?'Cámara OK':'Sin cámara');
  pieces.push(s.calibration?'Calibrado':'Sin calibrar');
  pieces.push(s.reference?'Referencia OK':'Sin referencia');
  pieces.push(s.autoMode?'Auto ON':'Auto OFF');
  $('peerInfo').textContent=pieces.join(' · ');
  if(s.config) applyConfigToPC(s.config);
  if(s.counts) renderCounts(s.counts);
}
function updateAnalysis(msg){
  if(msg.debugImage) $('debugImage').src=msg.debugImage;
  const r=msg.result;
  if(!r){ $('pcReason').textContent=msg.reason||'Sin resultado'; return; }
  $('pcDecision').textContent=r.pass?'APROBADO':'RECHAZADO';
  $('pcDecision').className='decision '+(r.pass?'ok':'bad');
  $('pcScore').textContent=fmt(r.score,0)+'%';
  $('pcAlign').textContent=fmt(r.alignScore,0)+'%';
  $('pcSize').textContent=r.sizeCm || '--';
  $('pcPerim').textContent=fmt(r.perimCm,2)+' cm';
  $('pcArea').textContent=fmt(r.areaCm2,2)+' cm²';
  $('pcBaseText').textContent=r.baseToTextMm!==null?fmt(r.baseToTextMm,1)+' mm':'--';
  $('pcOffset').textContent=r.offsetXmm!==null?fmt(r.offsetXmm,1)+' mm':'--';
  $('pcTextAngle').textContent=fmt(r.textAngle,1)+'°';
  $('pcReason').textContent=r.reason || '';
}
function renderCounts(c){ $('pcOk').textContent=c.ok||0; $('pcBad').textContent=c.bad||0; $('pcTotal').textContent=c.total||0; }
function renderLog(counts){
  if(counts) renderCounts(counts);
  $('pcLogBody').innerHTML=log.slice(0,100).map(r=>`<tr><td>${r.time}</td><td>${r.result}</td><td>${r.score}</td><td>${r.baseText}</td><td>${r.reason}</td></tr>`).join('');
}
function getPCConfig(){ return {
  validateText:$('pcValidateText').checked,
  validateSize:$('pcValidateSize').checked,
  validateShape:$('pcValidateShape').checked,
  minScore:+$('pcMinScore').value||85,
  maxErrX:+$('pcMaxErrX').value||3,
  maxErrY:+$('pcMaxErrY').value||3,
  maxErrBase:+$('pcMaxErrBase').value||2.5,
  maxTextAngle:+$('pcMaxTextAngle').value||5,
  sizeTolPct:+$('pcSizeTolPct').value||5,
  textZoneStart:+$('pcTextZoneStart').value||62,
  textZoneEnd:+$('pcTextZoneEnd').value||96
};}
function applyConfigToPC(c){ const map={validateText:'pcValidateText',validateSize:'pcValidateSize',validateShape:'pcValidateShape',minScore:'pcMinScore',maxErrX:'pcMaxErrX',maxErrY:'pcMaxErrY',maxErrBase:'pcMaxErrBase',maxTextAngle:'pcMaxTextAngle',sizeTolPct:'pcSizeTolPct',textZoneStart:'pcTextZoneStart',textZoneEnd:'pcTextZoneEnd'}; Object.entries(map).forEach(([k,id])=>{ if(c[k]!==undefined){ if($(id).type==='checkbox') $(id).checked=!!c[k]; else $(id).value=c[k]; } }); }
function pushConfig(){ send({type:'config',config:getPCConfig()}); }

document.querySelectorAll('[data-cmd]').forEach(btn=>btn.addEventListener('click',()=>cmd(btn.dataset.cmd)));
$('btnPushConfig').onclick=pushConfig;
$('btnNewCode').onclick=()=>startPeer(generateCode());
$('btnCopyCode').onclick=async()=>{ try{ await navigator.clipboard.writeText(currentCode); toast('Código copiado'); }catch(e){ toast('No pude copiar. Código: '+currentCode); } };
['pcValidateText','pcValidateSize','pcValidateShape','pcMinScore','pcMaxErrX','pcMaxErrY','pcMaxErrBase','pcMaxTextAngle','pcSizeTolPct','pcTextZoneStart','pcTextZoneEnd'].forEach(id=>$(id).addEventListener('change',()=>pushConfig()));
startPeer();
