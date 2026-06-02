'use strict';

const $ = (id) => document.getElementById(id);
const video = $('video');
const overlay = $('overlay');
const ctx = overlay.getContext('2d');
const capture = $('captureCanvas');
const capCtx = capture.getContext('2d');
const cardCanvas = $('cardCanvas');
const patchCanvas = $('patchCanvas');
const silhouetteCanvas = $('silhouetteCanvas');

const OUTER_MM = 70;      // tarjeta blanca exterior 7 x 7 cm
const INNER_MM = 50;      // cuadro negro interior 5 x 5 cm
const WARP_SIZE = 700;    // 10 px por mm en tarjeta rectificada
const MAX_PROCESS_W = 1280;

let stream = null;
let autoMode = false;
let lastAutoTs = 0;
let waitingRemoval = false;
function safeJson(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  }catch(e){
    console.warn('Dato local corrupto:', key, e);
    localStorage.removeItem(key);
    return fallback;
  }
}
let calibration = safeJson('patchCalV81', null) || safeJson('patchCalV8', null);
let reference = safeJson('patchRefV81', null) || safeJson('patchRefV8', null);
let log = safeJson('patchLogV81', []) || [];
let lastResult = null;
let peer = null;
let monitorCall = null;
let monitorConn = null;

window.addEventListener('cv-ready', () => {
  $('cvBadge').textContent = 'OpenCV listo';
  $('cvBadge').className = 'badge live';
});

window.addEventListener('error', (ev) => {
  console.error('Error JS:', ev.error || ev.message);
  try{
    setStatus('Error sistema','bad');
    setDecision('ERROR', 'bad', 'Hubo un error de JavaScript. Recarga con ?v=8.1 y revisa que subiste todos los archivos nuevos.');
  }catch(e){}
});
window.addEventListener('unhandledrejection', (ev) => {
  console.error('Promesa rechazada:', ev.reason);
});

function toast(msg, ms = 2100){
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), ms);
}
function setStatus(text, cls='idle'){
  $('statusBadge').textContent = text;
  $('statusBadge').className = `badge ${cls}`;
}
function setDecision(status, cls, reason){
  $('decision').textContent = status;
  $('decision').className = `decision ${cls}`;
  $('reason').textContent = reason || '';
}
function nowText(){ return new Date().toLocaleString(); }
function isCvReady(){ return !!(window.cvReady && typeof cv !== 'undefined' && cv.Mat); }

function updateState(){
  if(calibration){
    $('cardState').textContent = `Calibrada (${Math.round(calibration.quality)}% confianza)`;
    $('scaleState').textContent = `${calibration.pxPerMm.toFixed(3)} px/mm`;
  } else {
    $('cardState').textContent = 'No calibrada';
    $('scaleState').textContent = '--';
  }
  if(reference){
    $('refState').textContent = `${reference.widthCm.toFixed(2)} × ${reference.heightCm.toFixed(2)} cm`;
  } else {
    $('refState').textContent = 'No tomada';
  }
  renderLog();
}
updateState();

function describeCameraError(err){
  const name = err && err.name ? err.name : 'Error desconocido';
  const secure = window.isSecureContext || location.hostname === 'localhost';
  if(!secure) return 'La cámara requiere HTTPS. Abre la página publicada en GitHub Pages, no el archivo local.';
  if(name === 'NotAllowedError' || name === 'SecurityError') return 'Permiso de cámara bloqueado. En Safari/Chrome permite cámara para este sitio y recarga.';
  if(name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No se encontró cámara disponible.';
  if(name === 'NotReadableError' || name === 'TrackStartError') return 'La cámara está ocupada por otra app o el navegador no la pudo iniciar.';
  if(name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') return 'La cámara no aceptó esa configuración. Intentando con configuración simple.';
  return `${name}: ${err && err.message ? err.message : 'no se pudo abrir cámara.'}`;
}
function waitForVideoReady(timeoutMs=5000){
  return new Promise((resolve, reject) => {
    if(video.videoWidth && video.videoHeight) return resolve();
    const t = setTimeout(() => { cleanup(); reject(new Error('La cámara abrió, pero no entregó video.')); }, timeoutMs);
    function cleanup(){ clearTimeout(t); video.removeEventListener('loadedmetadata', onReady); video.removeEventListener('canplay', onReady); }
    function onReady(){ cleanup(); resolve(); }
    video.addEventListener('loadedmetadata', onReady, {once:true});
    video.addEventListener('canplay', onReady, {once:true});
  });
}
function stopCurrentStream(){
  try{ if(stream) stream.getTracks().forEach(t => t.stop()); }catch(e){}
  stream = null;
  video.srcObject = null;
}
async function openWithConstraints(constraints){
  const s = await navigator.mediaDevices.getUserMedia(constraints);
  stopCurrentStream();
  stream = s;
  video.setAttribute('playsinline','');
  video.setAttribute('webkit-playsinline','');
  video.muted = true;
  video.autoplay = true;
  video.srcObject = stream;
  await waitForVideoReady(6000).catch(()=>{});
  try{ await video.play(); }catch(e){ console.warn('video.play', e); }
  if(!video.videoWidth || !video.videoHeight) await waitForVideoReady(3000);
  resizeCanvas();
  return stream;
}
async function startCamera(){
  $('btnStart').disabled = true;
  setStatus('Abriendo cámara...','warn');
  setDecision('CÁMARA', 'neutral', 'Solicitando permiso de cámara.');
  try{
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      throw new Error('Este navegador no soporta acceso a cámara. Usa Safari/Chrome actualizado.');
    }
    if(!(window.isSecureContext || location.hostname === 'localhost')){
      throw new Error('La cámara solo funciona en HTTPS. Usa la URL de GitHub Pages.');
    }

    const attempts = [
      { label:'trasera simple', constraints:{ video:{ facingMode:{ ideal:'environment' } }, audio:false } },
      { label:'trasera 1280', constraints:{ video:{ facingMode:{ ideal:'environment' }, width:{ ideal:1280 }, height:{ ideal:720 } }, audio:false } },
      { label:'cualquier cámara', constraints:{ video:true, audio:false } }
    ];
    let lastErr = null;
    for(const a of attempts){
      try{
        await openWithConstraints(a.constraints);
        setStatus('Cámara activa','live');
        setDecision('LISTO', 'neutral', `Cámara activa: ${video.videoWidth}×${video.videoHeight}. Ahora calibra la tarjeta.`);
        toast(`Cámara iniciada (${a.label})`);
        requestAnimationFrame(loop);
        $('btnStart').disabled = false;
        return;
      }catch(err){ lastErr = err; console.warn('Fallo cámara', a.label, err); }
    }

    // Respaldo: pedir permisos, enumerar cámaras y probar una por una.
    try{
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter(d => d.kind === 'videoinput');
      for(const cam of cams.reverse()){
        try{
          await openWithConstraints({ video:{ deviceId:{ exact: cam.deviceId } }, audio:false });
          setStatus('Cámara activa','live');
          setDecision('LISTO', 'neutral', `Cámara activa: ${video.videoWidth}×${video.videoHeight}. Ahora calibra la tarjeta.`);
          toast('Cámara iniciada por deviceId');
          requestAnimationFrame(loop);
          $('btnStart').disabled = false;
          return;
        }catch(err){ lastErr = err; console.warn('Fallo deviceId', cam.label, err); }
      }
    }catch(e){ console.warn('enumerateDevices falló', e); }

    throw lastErr || new Error('No se pudo abrir ninguna cámara.');
  }catch(err){
    console.error(err);
    setStatus('Error cámara','bad');
    setDecision('ERROR CÁMARA', 'bad', describeCameraError(err));
    toast(describeCameraError(err), 5200);
  }finally{
    $('btnStart').disabled = false;
  }
}

function resizeCanvas(){
  const r = video.getBoundingClientRect();
  overlay.width = Math.max(1, Math.floor(r.width * devicePixelRatio));
  overlay.height = Math.max(1, Math.floor(r.height * devicePixelRatio));
  ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
}
window.addEventListener('resize', resizeCanvas);

function grabFrame(){
  if(!video.videoWidth || !video.videoHeight) return false;
  const scale = Math.min(1, MAX_PROCESS_W / video.videoWidth);
  capture.width = Math.round(video.videoWidth * scale);
  capture.height = Math.round(video.videoHeight * scale);
  capCtx.drawImage(video, 0, 0, capture.width, capture.height);
  return true;
}

function cfg(){
  return {
    critText: $('critText').checked,
    critSize: $('critSize').checked,
    critPerimeter: $('critPerimeter').checked,
    critArea: $('critArea').checked,
    critPatchAngle: $('critPatchAngle').checked,
    minAlignment: +$('minAlignment').value || 85,
    maxTextOffset: +$('maxTextOffset').value || 3,
    maxMarginDiff: +$('maxMarginDiff').value || 4,
    maxTextAngle: +$('maxTextAngle').value || 5,
    tolSizePct: +$('tolSizePct').value || 4,
    tolPerimPct: +$('tolPerimPct').value || 5,
    tolAreaPct: +$('tolAreaPct').value || 8,
    maxPatchAngle: +$('maxPatchAngle').value || 20,
  };
}

function matToCanvas(mat, canvas){
  try { cv.imshow(canvas, mat); } catch(e){ console.warn('imshow error', e); }
}
function clearSmallCanvas(canvas){
  const c = canvas.getContext('2d');
  c.clearRect(0,0,canvas.width,canvas.height);
  c.fillStyle = '#020611';
  c.fillRect(0,0,canvas.width,canvas.height);
}

function distance(a,b){ return Math.hypot(a.x-b.x, a.y-b.y); }
function polygonArea(pts){
  let s = 0;
  for(let i=0;i<pts.length;i++){
    const p = pts[i], q = pts[(i+1)%pts.length];
    s += p.x*q.y - q.x*p.y;
  }
  return Math.abs(s/2);
}
function orderPoints(pts){
  const arr = pts.map(p => ({x:p.x, y:p.y}));
  const sums = arr.map(p => p.x + p.y);
  const diffs = arr.map(p => p.y - p.x);
  const tl = arr[sums.indexOf(Math.min(...sums))];
  const br = arr[sums.indexOf(Math.max(...sums))];
  const tr = arr[diffs.indexOf(Math.min(...diffs))];
  const bl = arr[diffs.indexOf(Math.max(...diffs))];
  return [tl,tr,br,bl];
}
function pointsFromMat(mat){
  const pts = [];
  for(let i=0;i<mat.rows;i++){
    pts.push({x: mat.data32S[i*2], y: mat.data32S[i*2+1]});
  }
  return pts;
}
function rotatedRectPoints(rect){
  return cv.RotatedRect.points(rect).map(p => ({x:p.x, y:p.y}));
}
function normalizeAngle(angle,w,h){
  let a = angle;
  if(w < h) a += 90;
  if(a > 45) a -= 90;
  if(a < -45) a += 90;
  return a;
}
function pctDiff(a,b){ return b ? Math.abs(a-b)/b*100 : 0; }
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
function scoreFromError(error, maxError){
  if(maxError <= 0) return 0;
  return clamp(100 - (Math.abs(error)/maxError)*100, 0, 100);
}

function warpQuadrilateral(src, pts, size=WARP_SIZE){
  const ordered = orderPoints(pts);
  const srcTri = cv.matFromArray(4,1,cv.CV_32FC2,[
    ordered[0].x, ordered[0].y,
    ordered[1].x, ordered[1].y,
    ordered[2].x, ordered[2].y,
    ordered[3].x, ordered[3].y
  ]);
  const dstTri = cv.matFromArray(4,1,cv.CV_32FC2,[0,0, size-1,0, size-1,size-1, 0,size-1]);
  const M = cv.getPerspectiveTransform(srcTri, dstTri);
  const dst = new cv.Mat();
  cv.warpPerspective(src, dst, M, new cv.Size(size,size), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());
  srcTri.delete(); dstTri.delete(); M.delete();
  return dst;
}

function validateWarpedCard(warped){
  const gray = new cv.Mat(), blur = new cv.Mat(), dark = new cv.Mat(), contours = new cv.MatVector(), hierarchy = new cv.Mat();
  let result = { ok:false, score:0, bbox:null, darkRatio:0, borderDarkRatio:1 };
  try{
    cv.cvtColor(warped, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(3,3), 0);
    cv.threshold(blur, dark, 90, 255, cv.THRESH_BINARY_INV);
    const expected = dark.roi(new cv.Rect(90,90,520,520));
    const darkCenter = cv.countNonZero(expected) / (520*520);
    expected.delete();

    // En borde blanco no debería haber demasiado negro.
    const top = dark.roi(new cv.Rect(0,0,WARP_SIZE,80));
    const bottom = dark.roi(new cv.Rect(0,WARP_SIZE-80,WARP_SIZE,80));
    const left = dark.roi(new cv.Rect(0,0,80,WARP_SIZE));
    const right = dark.roi(new cv.Rect(WARP_SIZE-80,0,80,WARP_SIZE));
    const borderDark = (cv.countNonZero(top)+cv.countNonZero(bottom)+cv.countNonZero(left)+cv.countNonZero(right))/(WARP_SIZE*80*4);
    top.delete(); bottom.delete(); left.delete(); right.delete();

    cv.findContours(dark, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let best = null, bestArea = 0;
    for(let i=0;i<contours.size();i++){
      const c = contours.get(i);
      const area = cv.contourArea(c);
      const r = cv.boundingRect(c);
      const cx = r.x + r.width/2, cy = r.y + r.height/2;
      const centered = Math.abs(cx-350) < 100 && Math.abs(cy-350) < 100;
      const expectedSize = r.width > 390 && r.width < 620 && r.height > 390 && r.height < 620;
      if(area > bestArea && centered && expectedSize){ bestArea = area; best = r; }
      c.delete();
    }
    const sizeScore = best ? 100 - Math.min(100, (Math.abs(best.width-500)+Math.abs(best.height-500))/4) : 0;
    const centerScore = best ? 100 - Math.min(100, (Math.abs((best.x+best.width/2)-350)+Math.abs((best.y+best.height/2)-350))/2) : 0;
    const ratioScore = clamp((darkCenter - 0.55) / 0.35 * 100, 0, 100);
    const borderScore = clamp((0.28 - borderDark) / 0.28 * 100, 0, 100);
    const score = best ? (sizeScore*0.35 + centerScore*0.25 + ratioScore*0.25 + borderScore*0.15) : (ratioScore*0.45 + borderScore*0.25);
    result = { ok: score >= 60, score, bbox: best, darkRatio: darkCenter, borderDarkRatio: borderDark };
  } finally {
    gray.delete(); blur.delete(); dark.delete(); contours.delete(); hierarchy.delete();
  }
  return result;
}

function findQuadCandidatesFromWhite(src){
  const gray = new cv.Mat(), blur = new cv.Mat(), eq = new cv.Mat();
  const masks = [];
  const candidates = [];
  try{
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5,5), 0);
    try { cv.equalizeHist(blur, eq); } catch(e){ blur.copyTo(eq); }

    const thresholds = [120,135,150,165,180,195,210,225];
    for(const t of thresholds){
      const mask = new cv.Mat();
      cv.threshold(eq, mask, t, 255, cv.THRESH_BINARY);
      const kernelClose = cv.Mat.ones(9,9,cv.CV_8U);
      const kernelOpen = cv.Mat.ones(3,3,cv.CV_8U);
      cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, kernelClose);
      cv.morphologyEx(mask, mask, cv.MORPH_OPEN, kernelOpen);
      kernelClose.delete(); kernelOpen.delete();
      masks.push({t, mask});
    }

    for(const item of masks){
      const contours = new cv.MatVector(), hierarchy = new cv.Mat();
      cv.findContours(item.mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      for(let i=0;i<contours.size();i++){
        const c = contours.get(i);
        const area = cv.contourArea(c);
        const imgArea = src.cols * src.rows;
        if(area < imgArea*0.015 || area > imgArea*0.75){ c.delete(); continue; }
        const peri = cv.arcLength(c, true);
        const approx = new cv.Mat();
        // probamos varios epsilon, porque el marco impreso puede tener bordes imperfectos
        let quad = null;
        for(const eps of [0.015,0.02,0.03,0.04,0.055]){
          cv.approxPolyDP(c, approx, eps*peri, true);
          if(approx.rows === 4 && cv.isContourConvex(approx)){
            quad = pointsFromMat(approx);
            break;
          }
        }
        if(quad){
          const ord = orderPoints(quad);
          const sideLengths = [distance(ord[0],ord[1]), distance(ord[1],ord[2]), distance(ord[2],ord[3]), distance(ord[3],ord[0])];
          const minSide = Math.min(...sideLengths), maxSide = Math.max(...sideLengths);
          const skew = maxSide / Math.max(1,minSide);
          const polyA = polygonArea(ord);
          const center = ord.reduce((a,p)=>({x:a.x+p.x/4,y:a.y+p.y/4}),{x:0,y:0});
          const centerDist = Math.hypot(center.x-src.cols/2, center.y-src.rows/2) / Math.hypot(src.cols/2, src.rows/2);
          if(skew < 2.1 && polyA > imgArea*0.015){
            candidates.push({points:ord, area:polyA, threshold:item.t, skew, centerDist, sideLengths});
          }
        }
        approx.delete(); c.delete();
      }
      contours.delete(); hierarchy.delete();
    }
  } finally {
    masks.forEach(m => m.mask.delete());
    gray.delete(); blur.delete(); eq.delete();
  }
  return candidates;
}

function detectCalibrationCard(src){
  const candidates = findQuadCandidatesFromWhite(src);
  if(!candidates.length) return null;
  let best = null;
  for(const cand of candidates){
    let warped = null;
    try{
      warped = warpQuadrilateral(src, cand.points, WARP_SIZE);
      const val = validateWarpedCard(warped);
      const areaScore = clamp((cand.area/(src.cols*src.rows))*220, 0, 100);
      const centerScore = clamp(100 - cand.centerDist*85, 0, 100);
      const skewScore = clamp(100 - (cand.skew-1)*75, 0, 100);
      const total = val.score*0.58 + areaScore*0.12 + centerScore*0.15 + skewScore*0.15;
      const pxPerMm = cand.sideLengths.reduce((a,b)=>a+b,0) / 4 / OUTER_MM;
      const item = { ...cand, warped, validation: val, quality: total, pxPerMm };
      if(!best || item.quality > best.quality){
        if(best && best.warped) best.warped.delete();
        best = item;
      } else {
        warped.delete();
      }
    } catch(e){ if(warped) warped.delete(); }
  }
  if(!best || best.quality < 42) {
    if(best && best.warped) best.warped.delete();
    return null;
  }
  return best;
}

async function calibrateCardStable(){
  if(!isCvReady()){ toast('OpenCV aún no está listo. La tecnología tomando café.', 2600); return; }
  if(!stream){ toast('Primero inicia cámara.'); return; }
  setDecision('CALIBRANDO','neutral','Coloca la tarjeta 7×7 con negro 5×5 en la misma zona donde irá el parche.');
  const readings = [];
  const detections = [];
  for(let i=0;i<8;i++){
    await new Promise(r => setTimeout(r, 130));
    if(!grabFrame()) continue;
    const src = cv.imread(capture);
    let det = null;
    try { det = detectCalibrationCard(src); } finally { src.delete(); }
    if(det){
      readings.push(det.pxPerMm);
      detections.push(det);
    }
  }
  if(readings.length < 3){
    detections.forEach(d => d.warped && d.warped.delete());
    setDecision('NO CALIBRADO','bad','No se detectó estable la tarjeta. Acércala, centra más el blanco 7×7, evita brillo y vuelve a intentar.');
    toast('Tarjeta no detectada estable.');
    return;
  }
  readings.sort((a,b)=>a-b);
  const median = readings[Math.floor(readings.length/2)];
  const dev = readings.reduce((a,v)=>a+Math.abs(v-median)/median,0)/readings.length*100;
  const best = detections.sort((a,b)=>b.quality-a.quality)[0];
  detections.forEach(d => { if(d !== best && d.warped) d.warped.delete(); });
  if(dev > 4.5){
    best.warped && best.warped.delete();
    setDecision('NO CALIBRADO','bad',`Lecturas inestables (${dev.toFixed(1)}%). Fija el celular o mejora luz.`);
    return;
  }
  calibration = {
    pxPerMm: median,
    quality: clamp(best.quality - dev*2, 0, 100),
    skew: best.skew,
    threshold: best.threshold,
    timestamp: nowText(),
    note: 'Tarjeta exterior 70mm / interior 50mm detectada automáticamente'
  };
  localStorage.setItem('patchCalV81', JSON.stringify(calibration));
  matToCanvas(best.warped, cardCanvas);
  drawCardOverlay(best.points, true);
  best.warped.delete();
  $('lastState').textContent = `Calibración ${calibration.timestamp}`;
  updateState();
  setDecision('CALIBRADO','ok',`Escala guardada: ${calibration.pxPerMm.toFixed(3)} px/mm. Retira la tarjeta sin mover el celular.`);
  toast('Tarjeta calibrada. Retira tarjeta sin mover celular.');
}

function drawCardOverlay(points, good){
  const scaleX = overlay.clientWidth / capture.width;
  const scaleY = overlay.clientHeight / capture.height;
  ctx.clearRect(0,0,overlay.clientWidth,overlay.clientHeight);
  ctx.lineWidth = 4;
  ctx.strokeStyle = good ? '#19d17f' : '#ff5263';
  ctx.fillStyle = ctx.strokeStyle;
  ctx.beginPath();
  points.forEach((p,i)=>{ const x=p.x*scaleX, y=p.y*scaleY; i?ctx.lineTo(x,y):ctx.moveTo(x,y); });
  ctx.closePath(); ctx.stroke();
  points.forEach((p,i)=>{ const x=p.x*scaleX, y=p.y*scaleY; ctx.beginPath(); ctx.arc(x,y,6,0,Math.PI*2); ctx.fill(); ctx.fillText(String(i+1),x+8,y-8); });
}

function detectPatch(src){
  const gray = new cv.Mat(), blur = new cv.Mat(), eq = new cv.Mat();
  const candidates = [];
  try{
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5,5), 0);
    try { cv.equalizeHist(blur, eq); } catch(e){ blur.copyTo(eq); }
    const thresholds = [60,75,90,105,120,135,150,170];
    for(const t of thresholds){
      const mask = new cv.Mat();
      cv.threshold(eq, mask, t, 255, cv.THRESH_BINARY);
      const k1 = cv.Mat.ones(7,7,cv.CV_8U);
      const k2 = cv.Mat.ones(3,3,cv.CV_8U);
      cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, k1);
      cv.morphologyEx(mask, mask, cv.MORPH_OPEN, k2);
      k1.delete(); k2.delete();
      const contours = new cv.MatVector(), hierarchy = new cv.Mat();
      cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      const imgArea = src.cols * src.rows;
      for(let i=0;i<contours.size();i++){
        const c = contours.get(i);
        const area = cv.contourArea(c);
        if(area < imgArea*0.01 || area > imgArea*0.78){ c.delete(); continue; }
        const peri = cv.arcLength(c, true);
        const rect = cv.minAreaRect(c);
        const w = Math.max(rect.size.width, rect.size.height);
        const h = Math.min(rect.size.width, rect.size.height);
        if(w < 50 || h < 30){ c.delete(); continue; }
        const fill = area / Math.max(1, w*h);
        const center = rect.center;
        const centerDist = Math.hypot(center.x-src.cols/2, center.y-src.rows/2)/Math.hypot(src.cols/2,src.rows/2);
        const score = area*0.0005 + fill*55 + (1-centerDist)*22;
        candidates.push({ contour:c, area, peri, rect, fill, score, threshold:t, mask });
      }
      contours.delete(); hierarchy.delete();
      // No borramos mask aquí si algún candidato la usa; borramos abajo las no usadas de forma simple.
      if(!candidates.some(c=>c.mask === mask)) mask.delete();
    }
  } finally {
    gray.delete(); blur.delete(); eq.delete();
  }
  if(!candidates.length) return null;
  candidates.sort((a,b)=>b.score-a.score);
  const best = candidates[0];
  // Limpieza de candidatos no usados
  for(let i=1;i<candidates.length;i++){
    candidates[i].contour.delete();
    if(candidates[i].mask && candidates[i].mask !== best.mask) candidates[i].mask.delete();
  }
  return best;
}

function cropRotatedPatch(src, rect){
  let pts = rotatedRectPoints(rect);
  // orden por perspectiva del rectángulo rotado
  pts = orderPoints(pts);
  const w1 = distance(pts[0], pts[1]), w2 = distance(pts[3], pts[2]);
  const h1 = distance(pts[0], pts[3]), h2 = distance(pts[1], pts[2]);
  let outW = Math.max(30, Math.round(Math.max(w1,w2)));
  let outH = Math.max(30, Math.round(Math.max(h1,h2)));
  const srcTri = cv.matFromArray(4,1,cv.CV_32FC2,[pts[0].x,pts[0].y, pts[1].x,pts[1].y, pts[2].x,pts[2].y, pts[3].x,pts[3].y]);
  const dstTri = cv.matFromArray(4,1,cv.CV_32FC2,[0,0, outW-1,0, outW-1,outH-1, 0,outH-1]);
  const M = cv.getPerspectiveTransform(srcTri, dstTri);
  const dst = new cv.Mat();
  cv.warpPerspective(src, dst, M, new cv.Size(outW,outH), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());
  srcTri.delete(); dstTri.delete(); M.delete();
  return {mat: dst, widthPx: outW, heightPx: outH, points: pts};
}

function detectTextInPatch(patchMat, pxPerMm){
  const gray = new cv.Mat(), roi = new cv.Mat(), blur = new cv.Mat(), bin = new cv.Mat(), morph = new cv.Mat();
  const contours = new cv.MatVector(), hierarchy = new cv.Mat();
  let text = null;
  try{
    cv.cvtColor(patchMat, gray, cv.COLOR_RGBA2GRAY);
    const W = patchMat.cols, H = patchMat.rows;
    // buscamos principalmente la mitad inferior, pero sin comernos bordes
    const rx = Math.round(W*0.05), rw = Math.round(W*0.90);
    const ry = Math.round(H*0.42), rh = Math.round(H*0.50);
    const rectRoi = new cv.Rect(rx, ry, rw, rh);
    const grayRoi = gray.roi(rectRoi);
    grayRoi.copyTo(roi); grayRoi.delete();
    cv.GaussianBlur(roi, blur, new cv.Size(3,3), 0);
    // Texto oscuro sobre tela clara. Otsu invierte para tomar letras oscuras.
    cv.threshold(blur, bin, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
    const kOpen = cv.Mat.ones(2,2,cv.CV_8U);
    const kClose = cv.Mat.ones(5,3,cv.CV_8U);
    cv.morphologyEx(bin, morph, cv.MORPH_OPEN, kOpen);
    cv.morphologyEx(morph, morph, cv.MORPH_CLOSE, kClose);
    kOpen.delete(); kClose.delete();
    cv.findContours(morph, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let boxes = [];
    for(let i=0;i<contours.size();i++){
      const c = contours.get(i);
      const area = cv.contourArea(c);
      const r = cv.boundingRect(c);
      const minArea = Math.max(6, W*H*0.00008);
      const tooTall = r.height > rh*0.85;
      const tooWide = r.width > rw*0.95;
      // descartamos polvo, borde enorme y ruido
      if(area >= minArea && !tooTall && !tooWide && r.width >= 2 && r.height >= 2){
        boxes.push({x:r.x+rx, y:r.y+ry, width:r.width, height:r.height, area});
      }
      c.delete();
    }
    if(!boxes.length){
      return {found:false, score:0, reason:'No se detectó bloque de texto'};
    }
    // une componentes cercanos. Letras separadas terminan como un solo bloque.
    boxes.sort((a,b)=>a.x-b.x);
    let minX = Math.min(...boxes.map(b=>b.x));
    let minY = Math.min(...boxes.map(b=>b.y));
    let maxX = Math.max(...boxes.map(b=>b.x+b.width));
    let maxY = Math.max(...boxes.map(b=>b.y+b.height));
    // evitar que un punto suelto arrastre demasiado: recalcula con boxes dentro del núcleo
    const totalArea = boxes.reduce((a,b)=>a+b.area,0);
    const textBox = {x:minX, y:minY, width:maxX-minX, height:maxY-minY};
    const textCenterX = textBox.x + textBox.width/2;
    const textCenterY = textBox.y + textBox.height/2;
    const offsetMm = (textCenterX - W/2) / pxPerMm;
    const leftMm = textBox.x / pxPerMm;
    const rightMm = (W - (textBox.x + textBox.width)) / pxPerMm;
    const marginDiffMm = leftMm - rightMm;

    // Ángulo del texto estimado por minAreaRect de todos los contornos filtrados en máscara global
    let angle = 0;
    try{
      const ptsMat = new cv.MatVector();
      // creamos una máscara de los boxes para extraer contorno conjunto
      const textMask = cv.Mat.zeros(H, W, cv.CV_8UC1);
      boxes.forEach(b => cv.rectangle(textMask, new cv.Point(b.x,b.y), new cv.Point(b.x+b.width,b.y+b.height), new cv.Scalar(255), -1));
      const conts = new cv.MatVector(), hier = new cv.Mat();
      cv.findContours(textMask, conts, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      let merged = null, bestA = 0;
      for(let i=0;i<conts.size();i++){
        const c = conts.get(i), a = cv.contourArea(c);
        if(a > bestA){ if(merged) merged.delete(); merged = c; bestA = a; } else { c.delete(); }
      }
      if(merged){
        const rr = cv.minAreaRect(merged);
        angle = normalizeAngle(rr.angle, rr.size.width, rr.size.height);
        merged.delete();
      }
      conts.delete(); hier.delete(); textMask.delete(); ptsMat.delete();
    } catch(e){ angle = 0; }

    const c = cfg();
    const scoreCenter = scoreFromError(offsetMm, c.maxTextOffset);
    const scoreMargins = scoreFromError(marginDiffMm, c.maxMarginDiff);
    const scoreAngle = scoreFromError(angle, c.maxTextAngle);
    const score = Math.round(scoreCenter*0.55 + scoreMargins*0.30 + scoreAngle*0.15);
    text = {
      found:true,
      box:textBox,
      offsetMm,
      leftMm,
      rightMm,
      marginDiffMm,
      angle,
      score,
      scoreCenter,
      scoreMargins,
      scoreAngle,
      widthMm:textBox.width/pxPerMm,
      heightMm:textBox.height/pxPerMm,
      centerYmm:textCenterY/pxPerMm,
      componentCount:boxes.length,
      inkAreaPx:totalArea,
      reason:'Texto detectado'
    };
  } finally {
    gray.delete(); roi.delete(); blur.delete(); bin.delete(); morph.delete(); contours.delete(); hierarchy.delete();
  }
  return text;
}

function drawPatchDiagnostics(patchMat, textInfo){
  matToCanvas(patchMat, patchCanvas);
  const pc = patchCanvas.getContext('2d');
  const sx = patchCanvas.width / patchMat.cols;
  const sy = patchCanvas.height / patchMat.rows;
  pc.save();
  pc.lineWidth = 2;
  pc.strokeStyle = '#19d17f';
  pc.beginPath(); pc.moveTo(patchCanvas.width/2,0); pc.lineTo(patchCanvas.width/2,patchCanvas.height); pc.stroke();
  if(textInfo && textInfo.found){
    const b = textInfo.box;
    pc.strokeStyle = '#ffd166';
    pc.strokeRect(b.x*sx, b.y*sy, b.width*sx, b.height*sy);
    pc.strokeStyle = '#ff5263';
    const cx = (b.x + b.width/2)*sx;
    pc.beginPath(); pc.moveTo(cx,0); pc.lineTo(cx,patchCanvas.height); pc.stroke();
  }
  pc.restore();
}

function drawSilhouette(src, contour){
  clearSmallCanvas(silhouetteCanvas);
  try{
    const mask = cv.Mat.zeros(src.rows, src.cols, cv.CV_8UC1);
    const vec = new cv.MatVector();
    vec.push_back(contour);
    cv.drawContours(mask, vec, 0, new cv.Scalar(255), -1);
    // crop a bounding rect for better view
    const r = cv.boundingRect(contour);
    const pad = 20;
    const x = Math.max(0, r.x-pad), y = Math.max(0, r.y-pad);
    const w = Math.min(src.cols-x, r.width+pad*2), h = Math.min(src.rows-y, r.height+pad*2);
    const roi = mask.roi(new cv.Rect(x,y,w,h));
    const rgba = new cv.Mat();
    cv.cvtColor(roi, rgba, cv.COLOR_GRAY2RGBA);
    matToCanvas(rgba, silhouetteCanvas);
    roi.delete(); rgba.delete(); vec.delete(); mask.delete();
  }catch(e){ console.warn(e); }
}

function analyzeFrame(record=false, referenceMode=false){
  if(!isCvReady()){ toast('OpenCV todavía no está listo.'); return null; }
  if(!calibration){ setDecision('SIN CALIBRAR','bad','Primero calibra con la tarjeta 7×7 / 5×5.'); return null; }
  if(!grabFrame()) return null;
  const src = cv.imread(capture);
  let patch = null, crop = null, result = null;
  try{
    patch = detectPatch(src);
    if(!patch){
      setDecision('SIN PARCHE','neutral','No detecto silueta clara del parche. Usa fondo mate oscuro y pieza completa.');
      $('lastState').textContent = 'Parche no detectado';
      return null;
    }
    const pxPerMm = calibration.pxPerMm;
    const rect = patch.rect;
    const widthPx = Math.max(rect.size.width, rect.size.height);
    const heightPx = Math.min(rect.size.width, rect.size.height);
    const widthMm = widthPx / pxPerMm;
    const heightMm = heightPx / pxPerMm;
    const areaMm2 = patch.area / (pxPerMm*pxPerMm);
    const perimeterMm = patch.peri / pxPerMm;
    const patchAngle = normalizeAngle(rect.angle, rect.size.width, rect.size.height);

    crop = cropRotatedPatch(src, rect);
    const textInfo = detectTextInPatch(crop.mat, pxPerMm);
    drawPatchDiagnostics(crop.mat, textInfo);
    drawSilhouette(src, patch.contour);
    drawPatchOverlay(crop.points, patch.contour, textInfo ? textInfo.score : null);

    const widthCm = widthMm/10;
    const heightCm = heightMm/10;
    const areaCm2 = areaMm2/100;
    const perimeterCm = perimeterMm/10;

    const c = cfg();
    const reasons = [];
    let pass = true;

    if(c.critText){
      if(!textInfo || !textInfo.found){ pass=false; reasons.push('Texto no detectado'); }
      else if(textInfo.score < c.minAlignment){ pass=false; reasons.push(`Alineación texto ${textInfo.score}%, mínimo ${c.minAlignment}%`); }
    }

    if(reference && c.critSize){
      const dw = pctDiff(widthCm, reference.widthCm);
      const dh = pctDiff(heightCm, reference.heightCm);
      if(dw > c.tolSizePct || dh > c.tolSizePct){ pass=false; reasons.push(`Tamaño fuera: ΔW ${dw.toFixed(1)}%, ΔH ${dh.toFixed(1)}%`); }
    }
    if(reference && c.critPerimeter){
      const dp = pctDiff(perimeterCm, reference.perimeterCm);
      if(dp > c.tolPerimPct){ pass=false; reasons.push(`Perímetro fuera: Δ${dp.toFixed(1)}%`); }
    }
    if(reference && c.critArea){
      const da = pctDiff(areaCm2, reference.areaCm2);
      if(da > c.tolAreaPct){ pass=false; reasons.push(`Área fuera: Δ${da.toFixed(1)}%`); }
    }
    if(c.critPatchAngle && Math.abs(patchAngle) > c.maxPatchAngle){
      pass=false; reasons.push(`Giro parche ${patchAngle.toFixed(1)}°, máximo ${c.maxPatchAngle}°`);
    }

    result = {
      time: nowText(), pass,
      widthCm, heightCm, areaCm2, perimeterCm, patchAngle,
      text: textInfo,
      alignmentScore: textInfo && textInfo.found ? textInfo.score : 0,
      confidence: Math.round(Math.min(100, calibration.quality*0.55 + (patch.fill*100)*0.2 + ((textInfo&&textInfo.found)?textInfo.score:0)*0.25)),
      reason: reasons.length ? reasons.join('; ') : 'Dentro de criterio activo',
      raw: { threshold: patch.threshold, fill: patch.fill }
    };

    if(referenceMode){
      reference = {
        widthCm, heightCm, areaCm2, perimeterCm,
        textScore: result.alignmentScore,
        textOffsetMm: textInfo && textInfo.found ? textInfo.offsetMm : null,
        timestamp: nowText()
      };
      localStorage.setItem('patchRefV81', JSON.stringify(reference));
      updateState();
      setDecision('REFERENCIA OK','ok',`Referencia guardada: ${widthCm.toFixed(2)} × ${heightCm.toFixed(2)} cm, perímetro ${perimeterCm.toFixed(2)} cm.`);
      toast('Referencia aprobada guardada');
    } else {
      updateMetrics(result);
      setDecision(result.pass ? 'APROBADO':'RECHAZADO', result.pass ? 'ok':'bad', result.reason);
      if(record) addLog(result);
      sendMonitorData(result);
    }
  } catch(e){
    console.error(e);
    toast('Error analizando imagen. Revisa consola.');
  } finally {
    if(crop && crop.mat) crop.mat.delete();
    if(patch){
      patch.contour.delete();
      if(patch.mask) patch.mask.delete();
    }
    src.delete();
  }
  lastResult = result;
  return result;
}

function drawPatchOverlay(points, contour, score){
  const scaleX = overlay.clientWidth / capture.width;
  const scaleY = overlay.clientHeight / capture.height;
  ctx.clearRect(0,0,overlay.clientWidth,overlay.clientHeight);
  ctx.lineWidth = 3;
  ctx.strokeStyle = score !== null && score >= (+$('minAlignment').value || 85) ? '#19d17f' : '#ff5263';
  ctx.beginPath();
  points.forEach((p,i)=>{ const x=p.x*scaleX, y=p.y*scaleY; i?ctx.lineTo(x,y):ctx.moveTo(x,y); });
  ctx.closePath(); ctx.stroke();
  ctx.fillStyle = ctx.strokeStyle;
  ctx.font = '16px system-ui';
  ctx.fillText(score !== null ? `Texto ${score}%` : 'Parche', 18, 28);
}

function updateMetrics(r){
  $('mSize').textContent = `${r.widthCm.toFixed(2)} × ${r.heightCm.toFixed(2)} cm`;
  $('mPerimeter').textContent = `${r.perimeterCm.toFixed(2)} cm`;
  $('mArea').textContent = `${r.areaCm2.toFixed(2)} cm²`;
  $('mPatchAngle').textContent = `${r.patchAngle.toFixed(1)}°`;
  if(r.text && r.text.found){
    $('mTextOffset').textContent = `${r.text.offsetMm.toFixed(1)} mm`;
    $('mTextMargins').textContent = `${r.text.leftMm.toFixed(1)} / ${r.text.rightMm.toFixed(1)} mm`;
    $('mTextAngle').textContent = `${r.text.angle.toFixed(1)}°`;
  } else {
    $('mTextOffset').textContent = '--'; $('mTextMargins').textContent = '--'; $('mTextAngle').textContent = '--';
  }
  $('mConfidence').textContent = `${r.confidence}%`;
  $('alignmentScore').textContent = r.text && r.text.found ? `${r.alignmentScore}%` : '--';
  $('alignmentBar').style.width = `${r.text && r.text.found ? r.alignmentScore : 0}%`;
  $('lastState').textContent = r.time;
}

function addLog(r){
  const row = {
    time:r.time,
    result:r.pass?'APROBADO':'RECHAZADO',
    size:`${r.widthCm.toFixed(2)}×${r.heightCm.toFixed(2)}`,
    perimeter:r.perimeterCm.toFixed(2),
    area:r.areaCm2.toFixed(2),
    alignment:r.alignmentScore,
    textOffset:r.text && r.text.found ? r.text.offsetMm.toFixed(1) : '',
    reason:r.reason
  };
  log.unshift(row);
  log = log.slice(0, 1000);
  localStorage.setItem('patchLogV81', JSON.stringify(log));
  renderLog();
}
function renderLog(){
  $('logBody').innerHTML = log.map(r => `<tr><td>${r.time}</td><td>${r.result}</td><td>${r.size}</td><td>${r.perimeter}</td><td>${r.area}</td><td>${r.alignment}</td><td>${r.textOffset}</td><td>${escapeHtml(r.reason)}</td></tr>`).join('');
  const ok = log.filter(r=>r.result==='APROBADO').length;
  const bad = log.length - ok;
  $('okCount').textContent = ok;
  $('badCount').textContent = bad;
  $('totalCount').textContent = log.length;
  $('okPct').textContent = log.length ? `${(ok/log.length*100).toFixed(1)}%` : '--';
}
function escapeHtml(s){ return String(s||'').replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch])); }
function exportCSV(){
  const head = 'Hora,Resultado,Tamano_cm,Perimetro_cm,Area_cm2,Alineacion_pct,Texto_offset_mm,Motivo\n';
  const body = log.map(r => [r.time,r.result,r.size,r.perimeter,r.area,r.alignment,r.textOffset,`"${String(r.reason).replace(/"/g,'""')}"`].join(',')).join('\n');
  const blob = new Blob([head+body], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'historial_inspector_parches_v8.csv';
  a.click();
}

function loop(){
  if(!stream) return;
  if(autoMode && Date.now() - lastAutoTs > 900){
    const r = analyzeFrame(false, false);
    if(r){
      if(!waitingRemoval){ addLog(r); waitingRemoval = true; lastAutoTs = Date.now(); }
    } else {
      waitingRemoval = false;
    }
  }
  requestAnimationFrame(loop);
}

function toggleAuto(){
  autoMode = !autoMode;
  waitingRemoval = false;
  $('btnAuto').dataset.active = String(autoMode);
  $('btnAuto').textContent = `Auto: ${autoMode ? 'ON':'OFF'}`;
  toast(autoMode ? 'Modo automático activo: medirá una vez por pieza.' : 'Modo automático detenido.');
}

function connectMonitor(){
  const id = $('monitorId').value.trim();
  if(!id){ toast('Pega el ID del monitor de la PC.'); return; }
  if(typeof Peer === 'undefined'){ toast('PeerJS no cargó. Revisa internet.'); return; }
  if(!stream){ toast('Primero inicia cámara.'); return; }
  try{
    peer = peer || new Peer();
    peer.on('open', () => {
      monitorCall = peer.call(id, stream);
      monitorConn = peer.connect(id);
      monitorConn.on('open', () => {
        $('monitorState').textContent = 'Monitor: transmitiendo a PC.';
        toast('Transmitiendo a PC');
      });
      monitorConn.on('error', e => { console.warn(e); $('monitorState').textContent = 'Monitor: error de conexión.'; });
    });
    // si ya estaba abierto, llamar directo
    if(peer.open){
      monitorCall = peer.call(id, stream);
      monitorConn = peer.connect(id);
      monitorConn.on('open', () => { $('monitorState').textContent = 'Monitor: transmitiendo a PC.'; });
    }
  }catch(e){ console.error(e); toast('No se pudo conectar monitor.'); }
}
function stopMonitor(){
  try{ if(monitorCall) monitorCall.close(); if(monitorConn) monitorConn.close(); }catch(e){}
  monitorCall = null; monitorConn = null;
  $('monitorState').textContent = 'Monitor: desconectado.';
}
function sendMonitorData(result){
  if(monitorConn && monitorConn.open){
    monitorConn.send({type:'result', result:{
      pass:result.pass, reason:result.reason, time:result.time,
      size:`${result.widthCm.toFixed(2)} × ${result.heightCm.toFixed(2)} cm`,
      perimeter:`${result.perimeterCm.toFixed(2)} cm`,
      area:`${result.areaCm2.toFixed(2)} cm²`,
      alignment: result.alignmentScore,
      textOffset: result.text && result.text.found ? `${result.text.offsetMm.toFixed(1)} mm` : '--',
      margins: result.text && result.text.found ? `${result.text.leftMm.toFixed(1)} / ${result.text.rightMm.toFixed(1)} mm` : '--'
    }});
  }
}

$('btnStart').onclick = startCamera;
$('btnCalibrate').onclick = calibrateCardStable;
$('btnReference').onclick = () => analyzeFrame(false, true);
$('btnMeasure').onclick = () => analyzeFrame(true, false);
$('btnAuto').onclick = toggleAuto;
$('btnExport').onclick = exportCSV;
$('btnReset').onclick = () => { log=[]; localStorage.removeItem('patchLogV81'); renderLog(); toast('Historial reiniciado'); };
$('btnConnectMonitor').onclick = connectMonitor;
$('btnStopMonitor').onclick = stopMonitor;

clearSmallCanvas(cardCanvas); clearSmallCanvas(patchCanvas); clearSmallCanvas(silhouetteCanvas);
renderLog();
