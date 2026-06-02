const $ = (id) => document.getElementById(id);
function toast(msg, ms = 2200) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), ms);
}
function setStatus(text, cls='idle') {
  $('monitorStatus').textContent = text;
  $('monitorStatus').className = `badge ${cls}`;
}
function makeId() {
  return 'inspector-pc-' + Math.random().toString(36).slice(2, 8);
}
const peer = new Peer(makeId(), { debug: 1 });
peer.on('open', id => {
  $('myPeerId').textContent = id;
  setStatus('Esperando celular', 'idle');
});
peer.on('connection', conn => {
  $('connText').textContent = 'Celular conectado para datos.';
  setStatus('Datos conectados', 'live');
  conn.on('data', data => {
    if (!data || data.type !== 'result') return;
    const r = data.result;
    if (!r) return;
    $('remoteDecision').textContent = r.pass ? 'APROBADO' : 'RECHAZADO';
    $('remoteDecision').className = 'decision ' + (r.pass ? 'ok' : 'bad');
    $('remoteReason').textContent = r.reason || '';
    $('rWidth').textContent = r.width ? `${r.width} mm` : '--';
    $('rHeight').textContent = r.height ? `${r.height} mm` : '--';
    $('rText').textContent = r.text ? `${r.text} mm` : '--';
    $('rTotal').textContent = r.total ?? '--';
  });
});
peer.on('call', call => {
  call.answer();
  call.on('stream', stream => {
    $('remoteVideo').srcObject = stream;
    $('connText').textContent = 'Video del celular recibido.';
    setStatus('Video en vivo', 'live');
  });
  call.on('close', () => setStatus('Video cerrado', 'idle'));
});
peer.on('error', e => {
  console.error(e);
  setStatus('Error conexión', 'bad');
  $('connText').textContent = 'Error de conexión PeerJS. Recarga esta página.';
});
$('btnCopy').onclick = async () => {
  const text = $('myPeerId').textContent;
  try {
    await navigator.clipboard.writeText(text);
    toast('ID copiado.');
  } catch {
    toast('No se pudo copiar. Selecciónalo manualmente.');
  }
};
