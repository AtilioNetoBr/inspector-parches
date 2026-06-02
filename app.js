/* Inspector de Parches Pro v2.0
   Funciona en GitHub Pages. Requiere HTTPS para cámara y OpenCV.js para visión.
*/
const $ = (id) => document.getElementById(id);
const video = $('video');
const overlay = $('overlay');
const ctx = overlay.getContext('2d');
const capture = $('captureCanvas');
const capCtx = capture.getContext('2d', { willReadFrequently: true });

const STORAGE = {
  scale: 'patchInspector.scalePxPerMm.v2',
  log: 'patchInspector.log.v2',
  config: 'patchInspector.config.v2',
  master: 'patchInspector.master.v2'
};

let stream = null;
let pxPerMm = Number(localStorage.getItem(STORAGE.scale) || 0);
let log = safeJSON(localStorage.getItem(STORAGE.log), []);
let master = safeJSON(localStorage.getItem(STORAGE.master), null);
let autoMode = false;
let autoState = 'WAITING';
let stableResults = [];
let missingFrames = 0;
let lastAutoTs = 0;
let lastDetection = null;
let lastRecordedSignature = null;
let opencvReady = false;

const DEFAULT_CONFIG = {
  lotName: 'Hidalgo', targetW: 65, targetH: 73, tolW: 1.5, tolH: 1.5,
  tolAngle: 22, refMm: 50, minAreaPct: 0.35, autoDelay: 850,
  visualMin: 68, shapeMin: 72, useMaster: true
};

function safeJSON(text, fallback){
  try { return text ? JSON.parse(text) : fallback; } catch { return fallback; }
}
function toast(msg, ms=1900){
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.remove('show'), ms);
}
function setBadge(el, text, cls){
  el.textContent = text;
  el.className = `badge ${cls}`;
}
function setWork(state, hint){
  $('workState').textContent = state;
  if (hint !== undefined) $('workHint').textContent = hint;
}
function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }
function cfg(){
  return {
    lotName: $('lotName').value.trim() || 'Sin lote',
    targetW: Number($('targetW').value || DEFAULT_CONFIG.targetW),
    targetH: Number($('targetH').value || DEFAULT_CONFIG.targetH),
    tolW: Number($('tolW').value || DEFAULT_CONFIG.tolW),
    tolH: Number($('tolH').value || DEFAULT_CONFIG.tolH),
    tolAngle: Number($('tolAngle').value || DEFAULT_CONFIG.tolAngle),
    refMm: Number($('refMm').value || DEFAULT_CONFIG.refMm),
    minAreaPct: Number($('minAreaPct').value || DEFAULT_CONFIG.minAreaPct),
    autoDelay: Number($('autoDelay').value || DEFAULT_CONFIG.autoDelay),
    visualMin: Number($('visualMin').value || DEFAULT_CONFIG.visualMin),
    shapeMin: Number($('shapeMin').value || DEFAULT_CONFIG.shapeMin),
    useMaster: $('useMaster').checked
  };
}
function loadConfig(){
  const saved = Object.assign({}, DEFAULT_CONFIG, safeJSON(localStorage.getItem(STORAGE.config), {}));
  Object.keys(saved).forEach(k => {
    const el = $(k);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = Boolean(saved[k]);
    else el.value = saved[k];
  });
}
function saveConfig(){
  localStorage.setItem(STORAGE.config, JSON.stringify(cfg()));
  toast('Configuración guardada');
}
function updateScaleText(){
  $('scaleText').textContent = pxPerMm ? `Escala: ${pxPerMm.toFixed(3)} px/mm guardada. Si mueves el celular, recalibra.` : 'Escala: no calibrada.';
}
function updateMasterText(){
  if (!master) {
    $('masterText').textContent = 'Maestro: no guardado.';
    return;
  }
  $('masterText').textContent = `Maestro: guardado ${master.createdAt || ''}. Visual y contorno activos.`;
}

function onOpenCvReady(){
  opencvReady = true;
  setBadge($('cvBadge'), 'OpenCV listo', 'ok');
  setWork('Motor visual listo', 'Inicia cámara, calibra y mide una pieza patrón antes de activar automático.');
}
window.addEventListener('opencv-ready', onOpenCvReady);
setTimeout(() => {
  if (window.cvReady || (window.cv && cv.Mat)) onOpenCvReady();
  else setBadge($('cvBadge'), 'OpenCV cargando...', 'warn');
}, 1600);
setTimeout(() => {
  if (!opencvReady) {
    setBadge($('cvBadge'), 'OpenCV no listo', 'bad');
    setWork('Falta cargar OpenCV', 'Revisa internet. GitHub Pages sí permite cámara, pero esta app necesita descargar OpenCV.js.');
  }
}, 9000);

async function startCamera(){
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia no disponible');
    if (stream) stopCamera();
    const constraints = {
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    };
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    await video.play();
    await waitForVideoSize();
    resizeCanvases();
    setBadge($('cameraBadge'), 'Cámara activa', 'ok');
    setWork('Cámara activa', 'Coloca el parche completo. Si cambias altura del celular, recalibra escala.');
    toast('Cámara iniciada');
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    setBadge($('cameraBadge'), 'Error cámara', 'bad');
    setWork('No se pudo abrir cámara', 'Abre desde GitHub Pages con HTTPS y concede permiso de cámara. En iPhone usa Safari.');
    toast('No se pudo abrir cámara. Revisa permisos y HTTPS.', 2600);
  }
}
function stopCamera(){
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
}
function waitForVideoSize(){
  return new Promise(resolve => {
    if (video.videoWidth && video.videoHeight) return resolve();
    video.onloadedmetadata = () => resolve();
  });
}
function resizeCanvases(){
  if (!video.videoWidth || !video.videoHeight) return;
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
  capture.width = video.videoWidth;
  capture.height = video.videoHeight;
}
window.addEventListener('resize', resizeCanvases);
video.addEventListener('loadedmetadata', resizeCanvases);

function grabFrame(){
  if (!stream || !video.videoWidth) return false;
  resizeCanvases();
  capCtx.drawImage(video, 0, 0, capture.width, capture.height);
  return true;
}
function ensureReady(){
  if (!opencvReady || typeof cv === 'undefined' || !cv.Mat) {
    toast('OpenCV todavía no está listo. Internet, ese empleado de medio tiempo.');
    return false;
  }
  if (!grabFrame()) {
    toast('Primero inicia la cámara.');
    return false;
  }
  return true;
}

function analyzeFrame({ record=false, silent=false } = {}){
  if (!ensureReady()) return null;
  const conf = cfg();
  let src = cv.imread(capture);
  let gray = new cv.Mat();
  let blur = new cv.Mat();
  let best = null;
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5,5), 0);
    best = findBestContour(blur, src.cols, src.rows, conf);
    if (!best) {
      lastDetection = null;
      clearOverlay();
      if (!silent) setDecision(null, 'No detecto un contorno confiable. Usa fondo sólido mate, sin textura y con buen contraste.');
      return null;
    }
    const result = buildResult(best, src, conf);
    lastDetection = result;
    drawResult(result);
    setDecision(result);
    if (record) recordResult(result);
    return result;
  } catch (err) {
    console.error(err);
    toast('Error de medición. Revisa fondo, luz y que el parche esté completo.');
    return null;
  } finally {
    src.delete(); gray.delete(); blur.delete();
    if (best?.contour) best.contour.delete();
  }
}

function findBestContour(gray, width, height, conf){
  const masks = [];
  const bin1 = new cv.Mat();
  const bin2 = new cv.Mat();
  const edges = new cv.Mat();
  const morphKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5,5));
  const minArea = width * height * (conf.minAreaPct / 100);
  const maxArea = width * height * 0.70;
  try {
    cv.threshold(gray, bin1, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    cv.threshold(gray, bin2, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
    cv.Canny(gray, edges, 45, 145);
    for (const m of [bin1, bin2]) {
      cv.morphologyEx(m, m, cv.MORPH_OPEN, morphKernel);
      cv.morphologyEx(m, m, cv.MORPH_CLOSE, morphKernel);
      masks.push(m);
    }
    masks.push(edges);

    let best = null;
    for (const mask of masks) {
      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();
      cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i);
        const area = cv.contourArea(c);
        if (area < minArea || area > maxArea) { c.delete(); continue; }
        const br = cv.boundingRect(c);
        if (touchesBorder(br, width, height, 6)) { c.delete(); continue; }
        const rect = cv.minAreaRect(c);
        const rw = Math.max(rect.size.width, 1), rh = Math.max(rect.size.height, 1);
        const longSide = Math.max(rw, rh), shortSide = Math.min(rw, rh);
        if (longSide < 55 || shortSide < 35) { c.delete(); continue; }
        const aspect = shortSide / longSide;
        if (aspect < 0.35 || aspect > 1.0) { c.delete(); continue; }
        const fill = area / Math.max(1, br.width * br.height);
        if (fill < 0.12 || fill > 0.98) { c.delete(); continue; }
        const centerScore = 1 - distanceFromCenter(rect.center, width, height);
        const areaScore = area / (width * height);
        const fillScore = 1 - Math.abs(fill - 0.55);
        const score = areaScore * 10 + centerScore * 0.15 + fillScore * 0.12;
        if (!best || score > best.score) {
          if (best?.contour) best.contour.delete();
          best = { contour: c, area, rect, br, score };
        } else {
          c.delete();
        }
      }
      contours.delete(); hierarchy.delete();
    }
    return best;
  } finally {
    bin1.delete(); bin2.delete(); edges.delete(); morphKernel.delete();
  }
}
function touchesBorder(br, w, h, margin){
  return br.x <= margin || br.y <= margin || (br.x + br.width) >= (w - margin) || (br.y + br.height) >= (h - margin);
}
function distanceFromCenter(center, w, h){
  const dx = (center.x - w/2) / (w/2);
  const dy = (center.y - h/2) / (h/2);
  return clamp(Math.hypot(dx, dy) / Math.SQRT2, 0, 1);
}

function buildResult(best, src, conf){
  const norm = normalizeRect(best.rect, conf.targetW, conf.targetH);
  const widthMm = pxPerMm ? norm.widthPx / pxPerMm : null;
  const heightMm = pxPerMm ? norm.heightPx / pxPerMm : null;
  const areaMm = pxPerMm ? best.area / (pxPerMm * pxPerMm) : null;
  const points = cv.RotatedRect.points(best.rect).map(p => ({ x: p.x, y: p.y }));
  const contourPts = contourToPoints(best.contour);
  const signature = shapeSignature(contourPts, best.rect, norm, 96);

  let visualScore = null;
  let shapeScore = null;
  const visual = buildVisualFingerprint(src, points, conf.targetW, conf.targetH);

  if (master && conf.useMaster) {
    if (master.visual && visual) visualScore = compareVisual(master.visual, visual);
    if (master.signature && signature) shapeScore = compareSignature(master.signature, signature);
  }

  const reasons = [];
  let pass = true;
  if (!pxPerMm) { pass = false; reasons.push('falta calibrar escala'); }
  if (pxPerMm) {
    const dw = widthMm - conf.targetW;
    const dh = heightMm - conf.targetH;
    if (Math.abs(dw) > conf.tolW) { pass = false; reasons.push(`ancho fuera: ${signed(dw)} mm`); }
    if (Math.abs(dh) > conf.tolH) { pass = false; reasons.push(`alto fuera: ${signed(dh)} mm`); }
    if (Math.abs(norm.angle) > conf.tolAngle) { pass = false; reasons.push(`giro excesivo: ${norm.angle.toFixed(1)}°`); }
  }
  if (master && conf.useMaster) {
    if (visualScore !== null && visualScore < conf.visualMin) { pass = false; reasons.push(`visual distinto: ${visualScore.toFixed(0)}%`); }
    if (shapeScore !== null && shapeScore < conf.shapeMin) { pass = false; reasons.push(`contorno distinto: ${shapeScore.toFixed(0)}%`); }
  }
  if (best.br.width < 20 || best.br.height < 20) { pass = false; reasons.push('pieza demasiado pequeña en cuadro'); }

  return {
    pass,
    reason: reasons.join('; ') || 'dentro de tolerancia',
    widthMm,
    heightMm,
    areaMm,
    angle: norm.angle,
    box: points,
    center: { x: best.rect.center.x, y: best.rect.center.y },
    areaPx: best.area,
    signature,
    visual,
    visualScore,
    shapeScore,
    timestamp: new Date()
  };
}

function normalizeRect(rect, targetW, targetH){
  let rw = rect.size.width;
  let rh = rect.size.height;
  let angle = rect.angle;
  const targetRatio = targetW / targetH;
  const ratioA = rw / rh;
  const ratioB = rh / rw;
  const scoreA = Math.abs(Math.log(Math.max(ratioA, 0.001) / targetRatio));
  const scoreB = Math.abs(Math.log(Math.max(ratioB, 0.001) / targetRatio));
  let widthPx, heightPx;
  if (scoreA <= scoreB) {
    widthPx = rw;
    heightPx = rh;
  } else {
    widthPx = rh;
    heightPx = rw;
    angle += 90;
  }
  while (angle > 45) angle -= 90;
  while (angle < -45) angle += 90;
  return { widthPx: Math.abs(widthPx), heightPx: Math.abs(heightPx), angle };
}
function signed(n){ return `${n >= 0 ? '+' : ''}${n.toFixed(1)}`; }
function contourToPoints(contour){
  const pts = [];
  const data = contour.data32S;
  for (let i = 0; i < data.length; i += 2) pts.push({ x: data[i], y: data[i+1] });
  return pts;
}
function shapeSignature(points, rect, norm, bins=96){
  if (!points || points.length < 10) return null;
  const sig = new Array(bins).fill(0);
  const angle = -norm.angle * Math.PI / 180;
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const sx = Math.max(norm.widthPx / 2, 1);
  const sy = Math.max(norm.heightPx / 2, 1);
  for (const p of points) {
    const dx = p.x - rect.center.x;
    const dy = p.y - rect.center.y;
    const x = (dx * ca - dy * sa) / sx;
    const y = (dx * sa + dy * ca) / sy;
    const theta = Math.atan2(y, x);
    const r = Math.hypot(x, y);
    const idx = Math.round(((theta + Math.PI) / (2 * Math.PI)) * bins) % bins;
    sig[idx] = Math.max(sig[idx], r);
  }
  // Rellena huecos de bins sin punto. Es tosco, pero evita que un contorno simplificado arruine la comparación.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < bins; i++) {
      if (sig[i] === 0) sig[i] = (sig[(i - 1 + bins) % bins] + sig[(i + 1) % bins]) / 2;
    }
  }
  const max = Math.max(...sig, 1);
  return sig.map(v => Number((v / max).toFixed(4)));
}
function compareSignature(a, b){
  if (!a || !b || a.length !== b.length) return null;
  const n = a.length;
  let best = Infinity;
  for (let shift = 0; shift < n; shift++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const d = a[i] - b[(i + shift) % n];
      sum += d*d;
    }
    best = Math.min(best, Math.sqrt(sum / n));
  }
  return clamp(100 * (1 - best / 0.18), 0, 100);
}

function orderBox(pts){
  const tl = pts.reduce((a,p)=> (p.x+p.y < a.x+a.y ? p : a), pts[0]);
  const br = pts.reduce((a,p)=> (p.x+p.y > a.x+a.y ? p : a), pts[0]);
  const tr = pts.reduce((a,p)=> (p.x-p.y > a.x-a.y ? p : a), pts[0]);
  const bl = pts.reduce((a,p)=> (p.x-p.y < a.x-a.y ? p : a), pts[0]);
  return [tl,tr,br,bl];
}
function buildVisualFingerprint(src, box, targetW, targetH){
  const ordered = orderBox(box);
  const outW = 72;
  const outH = Math.max(72, Math.round(outW * targetH / targetW));
  let srcTri = null, dstTri = null, M = null, warped = null, gray = null, small = null, eq = null;
  try {
    srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      ordered[0].x, ordered[0].y,
      ordered[1].x, ordered[1].y,
      ordered[2].x, ordered[2].y,
      ordered[3].x, ordered[3].y
    ]);
    dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0,0, outW,0, outW,outH, 0,outH]);
    M = cv.getPerspectiveTransform(srcTri, dstTri);
    warped = new cv.Mat();
    cv.warpPerspective(src, warped, M, new cv.Size(outW, outH), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0,0,0,255));
    gray = new cv.Mat();
    cv.cvtColor(warped, gray, cv.COLOR_RGBA2GRAY);
    small = new cv.Mat();
    cv.resize(gray, small, new cv.Size(32, 32), 0, 0, cv.INTER_AREA);
    eq = new cv.Mat();
    cv.equalizeHist(small, eq);
    return Array.from(eq.data).map(v => Math.round(v));
  } catch (err) {
    console.warn('No se pudo generar huella visual', err);
    return null;
  } finally {
    [srcTri, dstTri, M, warped, gray, small, eq].forEach(m => { if (m) m.delete(); });
  }
}
function compareVisual(a, b){
  if (!a || !b || a.length !== b.length) return null;
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let dot = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    dot += da * db;
    va += da * da;
    vb += db * db;
  }
  if (va === 0 || vb === 0) return 0;
  const corr = dot / Math.sqrt(va * vb);
  return clamp(((corr + 1) / 2) * 100, 0, 100);
}

function drawResult(res){
  clearOverlay();
  if (!res?.box) return;
  ctx.save();
  ctx.lineWidth = Math.max(4, overlay.width / 320);
  ctx.strokeStyle = res.pass ? '#20d48c' : '#ff5266';
  ctx.fillStyle = ctx.strokeStyle;
  ctx.beginPath();
  res.box.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.closePath();
  ctx.stroke();
  ctx.font = `${Math.max(22, overlay.width / 45)}px system-ui`;
  ctx.fillText(res.pass ? 'APROBADO' : 'RECHAZADO', 22, 42);
  ctx.restore();
}
function clearOverlay(){
  ctx.clearRect(0,0,overlay.width,overlay.height);
}
function setDecision(res, msg){
  if (!res) {
    $('decision').textContent = 'ESPERANDO';
    $('decision').className = 'decision neutral';
    $('reason').textContent = msg || 'Esperando parche.';
    $('mWidth').textContent = '--';
    $('mHeight').textContent = '--';
    $('mAngle').textContent = '--';
    $('mArea').textContent = '--';
    $('mVisual').textContent = '--';
    $('mShape').textContent = '--';
    return;
  }
  $('decision').textContent = res.pass ? 'APROBADO' : 'RECHAZADO';
  $('decision').className = `decision ${res.pass ? 'ok' : 'bad'}`;
  $('reason').textContent = res.reason;
  $('mWidth').textContent = res.widthMm ? `${res.widthMm.toFixed(1)} mm` : '--';
  $('mHeight').textContent = res.heightMm ? `${res.heightMm.toFixed(1)} mm` : '--';
  $('mAngle').textContent = `${res.angle.toFixed(1)}°`;
  $('mArea').textContent = res.areaMm ? `${res.areaMm.toFixed(0)} mm²` : '--';
  $('mVisual').textContent = res.visualScore === null ? '--' : `${res.visualScore.toFixed(0)}%`;
  $('mShape').textContent = res.shapeScore === null ? '--' : `${res.shapeScore.toFixed(0)}%`;
}

function recordResult(res){
  const conf = cfg();
  const row = {
    time: new Date().toLocaleString(),
    iso: new Date().toISOString(),
    lot: conf.lotName,
    result: res.pass ? 'APROBADO' : 'RECHAZADO',
    width: res.widthMm ? res.widthMm.toFixed(1) : '',
    height: res.heightMm ? res.heightMm.toFixed(1) : '',
    angle: res.angle.toFixed(1),
    area: res.areaMm ? res.areaMm.toFixed(0) : '',
    visual: res.visualScore === null ? '' : res.visualScore.toFixed(0),
    shape: res.shapeScore === null ? '' : res.shapeScore.toFixed(0),
    reason: res.reason
  };
  log.unshift(row);
  log = log.slice(0, 800);
  localStorage.setItem(STORAGE.log, JSON.stringify(log));
  renderLog();
  lastRecordedSignature = res.signature;
  if (navigator.vibrate) navigator.vibrate(res.pass ? 35 : [80,40,80]);
}
function renderLog(){
  const body = $('logBody');
  body.innerHTML = log.map(r => `
    <tr>
      <td>${escapeHtml(r.time)}</td>
      <td>${escapeHtml(r.lot)}</td>
      <td class="${r.result === 'APROBADO' ? 'ok' : 'bad'}">${escapeHtml(r.result)}</td>
      <td>${escapeHtml(r.width)}</td>
      <td>${escapeHtml(r.height)}</td>
      <td>${escapeHtml(r.angle)}</td>
      <td>${escapeHtml(r.visual || '')}</td>
      <td>${escapeHtml(r.shape || '')}</td>
      <td>${escapeHtml(r.reason)}</td>
    </tr>`).join('');
  const ok = log.filter(r => r.result === 'APROBADO').length;
  const bad = log.length - ok;
  $('okCount').textContent = ok;
  $('badCount').textContent = bad;
  $('totalCount').textContent = log.length;
  $('okPct').textContent = log.length ? `${((ok/log.length)*100).toFixed(1)}%` : '--';
}
function escapeHtml(s){
  return String(s ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}

function resultStable(results){
  if (results.length < 3) return false;
  const last = results.slice(-3);
  if (last.some(r => !r.widthMm || !r.heightMm)) return false;
  const maxW = Math.max(...last.map(r => r.widthMm));
  const minW = Math.min(...last.map(r => r.widthMm));
  const maxH = Math.max(...last.map(r => r.heightMm));
  const minH = Math.min(...last.map(r => r.heightMm));
  const maxCx = Math.max(...last.map(r => r.center.x));
  const minCx = Math.min(...last.map(r => r.center.x));
  const maxCy = Math.max(...last.map(r => r.center.y));
  const minCy = Math.min(...last.map(r => r.center.y));
  return (maxW-minW) < 0.9 && (maxH-minH) < 0.9 && (maxCx-minCx) < 18 && (maxCy-minCy) < 18;
}
function loop(ts){
  if (!stream) return;
  const conf = cfg();
  if (autoMode && opencvReady && ts - lastAutoTs > conf.autoDelay) {
    lastAutoTs = ts;
    const res = analyzeFrame({ record:false, silent:true });
    if (autoState === 'WAITING') {
      if (res && pxPerMm) {
        missingFrames = 0;
        stableResults.push(res);
        stableResults = stableResults.slice(-5);
        setWork('Auto: detectando pieza', 'Mantén la pieza quieta una fracción de segundo. El sistema registra una sola vez.');
        if (resultStable(stableResults)) {
          const finalRes = stableResults[stableResults.length - 1];
          recordResult(finalRes);
          setDecision(finalRes);
          drawResult(finalRes);
          autoState = 'COUNTED';
          stableResults = [];
          setWork(finalRes.pass ? 'Auto: pieza aprobada' : 'Auto: pieza rechazada', 'Retira la pieza para habilitar la siguiente medición.');
        }
      } else {
        stableResults = [];
        setWork('Auto: esperando pieza', 'Coloca el parche completo dentro del campo visual.');
      }
    } else if (autoState === 'COUNTED') {
      if (!res) missingFrames++;
      else missingFrames = 0;
      if (missingFrames >= 2) {
        autoState = 'WAITING';
        missingFrames = 0;
        stableResults = [];
        setDecision(null, 'Pieza retirada. Esperando la siguiente.');
        setWork('Auto: listo para siguiente', 'Coloca otra pieza. No contará duplicados mientras no retires la anterior.');
      } else {
        setWork('Auto: pieza ya registrada', 'Retira la pieza. Sí, hay que quitarla; la cámara todavía no tiene brazos.');
      }
    }
  }
  requestAnimationFrame(loop);
}

function calibrateScale(){
  if (!grabFrame()) { toast('Primero inicia cámara.'); return; }
  clearOverlay();
  const conf = cfg();
  const pts = [];
  setWork('Calibración activa', `Toca los dos extremos de una referencia real de ${conf.refMm} mm.`);
  toast(`Toca 2 puntos de la referencia de ${conf.refMm} mm`, 2400);

  const onPointer = (ev) => {
    ev.preventDefault();
    const rect = overlay.getBoundingClientRect();
    const x = (ev.clientX - rect.left) * overlay.width / rect.width;
    const y = (ev.clientY - rect.top) * overlay.height / rect.height;
    pts.push({x,y});
    ctx.save();
    ctx.fillStyle = '#ffd166';
    ctx.strokeStyle = '#08111f';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(7, overlay.width/160), 0, Math.PI*2);
    ctx.fill(); ctx.stroke();
    if (pts.length === 2) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[1].x, pts[1].y);
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    ctx.restore();
    if (pts.length === 2) {
      overlay.removeEventListener('pointerdown', onPointer);
      const d = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      pxPerMm = d / conf.refMm;
      localStorage.setItem(STORAGE.scale, String(pxPerMm));
      updateScaleText();
      setWork('Escala calibrada', `Escala guardada: ${pxPerMm.toFixed(3)} px/mm. No muevas el celular.`);
      toast('Escala calibrada');
    }
  };
  overlay.addEventListener('pointerdown', onPointer);
}
function saveMaster(){
  const res = analyzeFrame({ record:false, silent:false });
  if (!res || !res.signature || !res.visual || !pxPerMm) {
    toast('No pude guardar maestro. Calibra y coloca una pieza patrón clara.');
    return;
  }
  master = {
    createdAt: new Date().toLocaleString(),
    targetW: cfg().targetW,
    targetH: cfg().targetH,
    width: res.widthMm ? res.widthMm.toFixed(2) : '',
    height: res.heightMm ? res.heightMm.toFixed(2) : '',
    signature: res.signature,
    visual: res.visual
  };
  localStorage.setItem(STORAGE.master, JSON.stringify(master));
  updateMasterText();
  toast('Maestro visual guardado');
}
function clearMaster(){
  master = null;
  localStorage.removeItem(STORAGE.master);
  updateMasterText();
  toast('Maestro borrado');
}
function exportCSV(){
  const header = ['Hora','ISO','Lote','Resultado','Ancho mm','Alto mm','Giro grados','Area mm2','Visual maestro %','Contorno maestro %','Motivo'];
  const rows = log.map(r => [r.time,r.iso,r.lot,r.result,r.width,r.height,r.angle,r.area,r.visual,r.shape,r.reason]);
  const csv = [header, ...rows].map(row => row.map(csvCell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `historial_parches_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
function csvCell(value){
  const s = String(value ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
  return s;
}
function resetLog(){
  if (!confirm('¿Reiniciar conteo e historial de este navegador?')) return;
  log = [];
  localStorage.removeItem(STORAGE.log);
  renderLog();
  setDecision(null, 'Historial reiniciado.');
  toast('Conteo reiniciado');
}
function snapshot(){
  if (!grabFrame()) { toast('Primero inicia cámara.'); return; }
  const a = document.createElement('a');
  a.href = capture.toDataURL('image/jpeg', 0.92);
  a.download = `foto_parche_${new Date().toISOString().replace(/[:.]/g,'-')}.jpg`;
  a.click();
}
function toggleAuto(){
  if (!pxPerMm) { toast('Calibra escala antes de usar automático.'); return; }
  autoMode = !autoMode;
  autoState = 'WAITING';
  stableResults = [];
  missingFrames = 0;
  $('btnAuto').dataset.active = String(autoMode);
  $('btnAuto').textContent = `Auto: ${autoMode ? 'ON' : 'OFF'}`;
  $('btnAuto').classList.toggle('primary', autoMode);
  setWork(autoMode ? 'Auto encendido' : 'Auto apagado', autoMode ? 'Coloca una pieza, espera resultado y retírala para la siguiente.' : 'Usa medición manual o vuelve a activar automático.');
  toast(autoMode ? 'Medición automática activa' : 'Medición automática detenida');
}

$('btnStart').addEventListener('click', startCamera);
$('btnCalibrate').addEventListener('click', calibrateScale);
$('btnMeasure').addEventListener('click', () => analyzeFrame({ record:true }));
$('btnAuto').addEventListener('click', toggleAuto);
$('btnSaveMaster').addEventListener('click', saveMaster);
$('btnClearMaster').addEventListener('click', clearMaster);
$('btnSnapshot').addEventListener('click', snapshot);
$('btnExport').addEventListener('click', exportCSV);
$('btnReset').addEventListener('click', resetLog);
$('btnSaveConfig').addEventListener('click', saveConfig);

loadConfig();
updateScaleText();
updateMasterText();
renderLog();
setDecision(null, 'Inicia la cámara y calibra con una referencia real.');
