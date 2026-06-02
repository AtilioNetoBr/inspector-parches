const $ = id => document.getElementById(id);
let peer;
function setStatus(text, cls='idle'){
  $('statusBadge').textContent=text; $('statusBadge').className='badge '+cls;
}
function init(){
  if(typeof Peer === 'undefined'){
    $('peerId').textContent='PeerJS no cargó';
    setStatus('Sin PeerJS','bad');
    return;
  }
  peer = new Peer();
  peer.on('open', id => {
    $('peerId').textContent=id;
    setStatus('Listo','live');
  });
  peer.on('call', call => {
    call.answer();
    call.on('stream', stream => {
      $('remoteVideo').srcObject = stream;
      $('connectionText').textContent='Video conectado desde celular.';
      setStatus('Video conectado','ok');
    });
  });
  peer.on('connection', conn => {
    $('connectionText').textContent='Datos conectados desde celular.';
    conn.on('data', data => {
      if(data?.type === 'result') updateResult(data);
    });
  });
  peer.on('error', err => {
    console.error(err);
    setStatus('Error conexión','bad');
    $('connectionText').textContent='Error: '+err.type;
  });
}
function updateResult(data){
  const r=data.result;
  if(!r) return;
  $('decision').textContent=r.pass?'APROBADO':'RECHAZADO';
  $('decision').className='decision '+(r.pass?'ok':'bad');
  $('reason').textContent=r.reason || '';
  $('mSize').textContent=r.size || '--';
  $('mPerimeter').textContent=r.perimeter || '--';
  $('mArea').textContent=r.area || '--';
  $('mText').textContent=r.text || '--';
  $('totalCount').textContent=data.counts?.total ?? '0';
  $('okCount').textContent=data.counts?.ok ?? '0';
}
window.addEventListener('load', init);
