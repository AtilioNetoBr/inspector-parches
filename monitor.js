'use strict';
const $ = id => document.getElementById(id);
const video = $('remoteVideo');
let peer = null;

function setPeerState(text, cls='warn'){
  $('peerState').textContent = text;
  $('peerState').className = `badge ${cls}`;
}
function setDecision(status, cls, reason){
  $('decision').textContent = status;
  $('decision').className = `decision ${cls}`;
  $('reason').textContent = reason || '';
}

function start(){
  if(typeof Peer === 'undefined'){
    setPeerState('PeerJS no cargó', 'bad');
    setDecision('ERROR','bad','No cargó PeerJS. Revisa internet.');
    return;
  }
  peer = new Peer();
  peer.on('open', id => {
    $('monitorId').textContent = id;
    setPeerState('Listo para conectar', 'live');
  });
  peer.on('call', call => {
    call.answer();
    call.on('stream', remoteStream => {
      video.srcObject = remoteStream;
      setPeerState('Recibiendo video', 'live');
    });
  });
  peer.on('connection', conn => {
    conn.on('data', data => {
      if(data && data.type === 'result') updateResult(data.result);
    });
  });
  peer.on('error', err => {
    console.error(err);
    setPeerState('Error de conexión', 'bad');
  });
}

function updateResult(r){
  setDecision(r.pass ? 'APROBADO' : 'RECHAZADO', r.pass ? 'ok':'bad', r.reason);
  $('alignmentScore').textContent = `${r.alignment}%`;
  $('alignmentBar').style.width = `${r.alignment || 0}%`;
  $('mSize').textContent = r.size || '--';
  $('mPerimeter').textContent = r.perimeter || '--';
  $('mArea').textContent = r.area || '--';
  $('mTextOffset').textContent = r.textOffset || '--';
  $('mTextMargins').textContent = r.margins || '--';
  $('mTime').textContent = r.time || '--';
}

start();
