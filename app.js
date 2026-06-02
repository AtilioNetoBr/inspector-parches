/* Inspector de Parches Pro v5
   Objetivo: estación de trabajo real con calibración robusta 5x5, referencia aprobada,
   texto centrado y anti-duplicado en modo automático. */

const $ = (id) => document.getElementById(id);
const video = $('video');
const videoWrap = $('videoWrap');
const overlay = $('overlay');
const ctx = overlay.getContext('2d');
const capture = $('captureCanvas');
const capCtx = capture.getContext('2d');

let stream = null;
let autoMode = false;
let autoLocked = false;
let absentFrames = 0;
let manualMode = null;
let manualPoints = [];
let lastDetectionBox = null;

let pxPerMm = Number(localStorage.getItem('ipp_v5_pxPerMm') || 0);
let calibration = JSON.parse(localStorage.getItem('ipp_v5_calibration') || 'null');
let reference = JSON.parse(localStorage.getItem('ipp_v5_reference') || 'null');
let log = JSON.parse(localStorage.getItem('ipp_v5_log') || '[]');

function toast(msg, ms = 2400) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), ms);
}

function setStatus(text, cls = 'idle') {
  $('statusBadge').textContent = text;
  $('statusBadge').className = `badge ${cls}`;
}

function setCvStatus() {
  if (window.cvReady && typeof cv !== 'undefined' && cv.Mat) {
    $('cvBadge').textContent = 'Visión lista';
    $('cvBadge').className = 'badge live';
  } else {
    $('cvBadge').textContent = 'Cargando visión...';
    $('cvBadge').className = 'badge warn';
  }
}
window.addEventListener('opencv-ready', () => {
  setCvStatus();
  toast('Motor de visión listo');
});
setCvStatus();
setInterval(setCvStatus, 1200);

function cfg() {
  const textStart = Math.max(35, Math.min(85, Number($('textStartPct').value || 60))) / 100;
  const textEnd = Math.max(textStart + 0.05, Math.min(99, Number($('textEndPct').value || 94))) / 100;
  return {
    lot: $('lotName').value.trim() || 'Sin lote',
    squareMm: Number($('squareMm').value || 50),
    tolSizePct: Number($('tolSizePct').value || 3),
    tolAreaPct: Number($('tolAreaPct').value || 6),
    tolTextMm: Number($('tolTextMm').value || 2),
    textStart,
    textEnd
  };
}

function updateStateUI() {
  $('scaleText').textContent = pxPerMm ? `${pxPerMm.toFixed(3)} px/mm` : 'No calibrada';
  $('calibConfidence').textContent = calibration ? `${calibration.confidence}% (${calibration.method})` : '--';
  $('referenceText').textContent = reference ? `${reference.widthMm.toFixed(1)}×${reference.heightMm.toFixed(1)} mm` : 'No tomada';
  $('lockText').textContent = autoLocked ? 'Esperando retiro' : 'Libre';
}
updateStateUI();

function renderLog() {
  $('logBody').innerHTML = log.map(r => `
    <tr>
      <td>${escapeHtml(r.time)}</td><td>${escapeHtml(r.lot)}</td><td>${escapeHtml(r.result)}</td>
      <td>${escapeHtml(r.width)}</td><td>${escapeHtml(r.height)}</td><td>${escapeHtml(r.area)}</td>
      <td>${escapeHtml(r.textOffset)}</td><td>${escapeHtml(r.reason)}</td>
    </tr>`).join('');
  const ok = log.filter(r => r.result === 'APROBADO').length;
  const bad = log.length - ok;
  $('okCount').textContent = ok;
  $('badCount').textContent = bad;
  $('totalCount').textContent = log.length;
  $('okPct').textContent = log.length ? `${((ok / log.length) * 100).toFixed(1)}%` : '0%';
}
renderLog();

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[s]));
}

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus('Sin soporte cámara', 'bad');
    toast('Este navegador no permite cámara. Usa Safari/Chrome desde HTTPS.');
    return;
  }

  if (stream) stopCamera();

  const attempts = [
    { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
    { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
    { video: { facingMode: 'environment' }, audio: false },
    { video: true, audio: false }
  ];

  let lastErr = null;
  for (const constraints of attempts) {
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      await video.play();
      resizeOverlay();
      setStatus('Cámara activa', 'live');
      toast('Cámara iniciada');
      requestAnimationFrame(loop);
      return;
    } catch (err) {
      lastErr = err;
    }
  }

  setStatus('Error cámara', 'bad');
  let msg = 'No se pudo abrir cámara.';
  if (lastErr && lastErr.name === 'NotAllowedError') msg = 'Permiso de cámara bloqueado. Permite cámara en el navegador.';
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') msg = 'La cámara necesita HTTPS. Abre desde GitHub Pages.';
  toast(msg, 4200);
  console.error(lastErr);
}

function stopCamera() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
}

function resizeOverlay() {
  const rect = videoWrap.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  overlay.width = Math.round(rect.width * dpr);
  overlay.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  clearOverlay();
}
window.addEventListener('resize', resizeOverlay);

function clearOverlay() {
  ctx.clearRect(0, 0, overlay.clientWidth, overlay.clientHeight);
}

function getVideoRect() {
  const cw = overlay.clientWidth;
  const ch = overlay.clientHeight;
  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;
  const cr = cw / ch;
  const vr = vw / vh;
  let w, h, x, y;
  if (vr > cr) {
    w = cw;
    h = cw / vr;
    x = 0;
    y = (ch - h) / 2;
  } else {
    h = ch;
    w = ch * vr;
    x = (cw - w) / 2;
    y = 0;
  }
  return { x, y, w, h, vw, vh };
}

function imageToView(pt) {
  const r = getVideoRect();
  return { x: r.x + (pt.x / r.vw) * r.w, y: r.y + (pt.y / r.vh) * r.h };
}

function viewToImage(clientX, clientY) {
  const b = overlay.getBoundingClientRect();
  const x = clientX - b.left;
  const y = clientY - b.top;
  const r = getVideoRect();
  return { x: ((x - r.x) / r.w) * r.vw, y: ((y - r.y) / r.h) * r.vh };
}

function grabFrame() {
  if (!video.videoWidth || !video.videoHeight) return false;
  capture.width = video.videoWidth;
  capture.height = video.videoHeight;
  capCtx.drawImage(video, 0, 0, capture.width, capture.height);
  return true;
}

function requireVision() {
  if (!window.cvReady || typeof cv === 'undefined' || !cv.Mat) {
    toast('OpenCV todavía no está listo. Espera unos segundos y vuelve a intentar.');
    return false;
  }
  if (!grabFrame()) {
    toast('La cámara todavía no entrega imagen.');
    return false;
  }
  return true;
}

function withSrcMat(fn) {
  if (!requireVision()) return null;
  const src = cv.imread(capture);
  try { return fn(src); }
  finally { src.delete(); }
}

function drawBox(points, color = '#1fd18a', label = '') {
  if (!points || !points.length) return;
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.font = '16px system-ui';
  ctx.beginPath();
  points.forEach((p, i) => {
    const v = imageToView(p);
    if (i) ctx.lineTo(v.x, v.y); else ctx.moveTo(v.x, v.y);
  });
  ctx.closePath();
  ctx.stroke();
  if (label) {
    const first = imageToView(points[0]);
    ctx.fillText(label, first.x + 8, first.y - 8);
  }
}

function drawPoint(pt, index, color = '#ffd166') {
  const v = imageToView(pt);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(v.x, v.y, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = '15px system-ui';
  ctx.fillText(String(index), v.x + 9, v.y - 9);
}

function matDownscale(src, maxSide = 960) {
  const maxDim = Math.max(src.cols, src.rows);
  if (maxDim <= maxSide) return { mat: src.clone(), scale: 1 };
  const scale = maxSide / maxDim;
  const dst = new cv.Mat();
  cv.resize(src, dst, new cv.Size(Math.round(src.cols * scale), Math.round(src.rows * scale)), 0, 0, cv.INTER_AREA);
  return { mat: dst, scale };
}

function detectBlackSquare(src) {
  const ds = matDownscale(src, 960);
  const small = ds.mat;
  const scale = ds.scale;
  const gray = new cv.Mat();
  const blur = new cv.Mat();
  const masks = [];
  let best = null;

  try {
    cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);

    // Umbrales fijos: cubren luz fuerte, luz media y negro no tan negro.
    [45, 60, 75, 90, 110, 130, 150, 170].forEach(t => {
      const m = new cv.Mat();
      cv.threshold(blur, m, t, 255, cv.THRESH_BINARY_INV);
      masks.push(m);
    });

    // Otsu automático.
    const otsu = new cv.Mat();
    cv.threshold(blur, otsu, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
    masks.push(otsu);

    // Adaptive para sombras.
    const adaptive = new cv.Mat();
    cv.adaptiveThreshold(blur, adaptive, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 51, 5);
    masks.push(adaptive);

    for (const mask of masks) {
      const candidate = evaluateSquareMask(mask, gray, scale);
      if (candidate && (!best || candidate.score > best.score)) best = candidate;
    }
  } finally {
    masks.forEach(m => m.delete());
    gray.delete();
    blur.delete();
    small.delete();
  }

  return best;
}

function evaluateSquareMask(mask, gray, scale) {
  const work = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const kernelOpen = cv.Mat.ones(3, 3, cv.CV_8U);
  const kernelClose = cv.Mat.ones(7, 7, cv.CV_8U);
  let best = null;
  try {
    cv.morphologyEx(mask, work, cv.MORPH_OPEN, kernelOpen);
    cv.morphologyEx(work, work, cv.MORPH_CLOSE, kernelClose);
    cv.findContours(work, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const imgArea = gray.cols * gray.rows;
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const area = cv.contourArea(c);
      if (area < imgArea * 0.003 || area > imgArea * 0.55) { c.delete(); continue; }

      const rect = cv.minAreaRect(c);
      const rw = Math.max(rect.size.width, 1);
      const rh = Math.max(rect.size.height, 1);
      const longSide = Math.max(rw, rh);
      const shortSide = Math.min(rw, rh);
      const ratio = longSide / shortSide;
      const rectArea = rw * rh;
      const rectangularity = area / rectArea;
      if (ratio > 1.38 || rectangularity < 0.52 || rectangularity > 1.18) { c.delete(); continue; }

      const br = cv.boundingRect(c);
      const pad = Math.round(Math.max(br.width, br.height) * 0.18);
      const ex = Math.max(0, br.x - pad);
      const ey = Math.max(0, br.y - pad);
      const ew = Math.min(gray.cols - ex, br.width + pad * 2);
      const eh = Math.min(gray.rows - ey, br.height + pad * 2);
      if (ew <= br.width || eh <= br.height) { c.delete(); continue; }

      const roiInner = gray.roi(new cv.Rect(br.x, br.y, br.width, br.height));
      const roiOuter = gray.roi(new cv.Rect(ex, ey, ew, eh));
      const innerMean = cv.mean(roiInner)[0];
      const outerMean = cv.mean(roiOuter)[0];
      roiInner.delete();
      roiOuter.delete();

      // Para cuadro negro sobre tarjeta blanca, la zona externa debe ser más clara.
      const contrast = outerMean - innerMean;
      if (innerMean > 175 || contrast < 18) { c.delete(); continue; }

      const ptsSmall = cv.RotatedRect.points(rect).map(p => ({ x: p.x / scale, y: p.y / scale }));
      const ordered = orderPoints(ptsSmall);
      const sides = sideLengths(ordered);
      const sideAvg = avg(sides);
      const sideRatio = Math.max(...sides) / Math.max(1, Math.min(...sides));
      if (sideRatio > 1.45) { c.delete(); continue; }

      const ratioScore = 1 / ratio;
      const rectScore = Math.min(1, rectangularity);
      const contrastScore = Math.min(1, Math.max(0, contrast) / 90);
      const sizeScore = Math.min(1, area / (imgArea * 0.04));
      const score = (ratioScore * 35) + (rectScore * 25) + (contrastScore * 30) + (sizeScore * 10);

      const candidate = {
        kind: 'square',
        box: ordered,
        sidePx: sideAvg,
        sidesPx: sides,
        confidence: Math.round(Math.min(99, score)),
        score,
        contrast: Math.round(contrast),
        innerMean: Math.round(innerMean),
        outerMean: Math.round(outerMean)
      };
      if (!best || candidate.score > best.score) best = candidate;
      c.delete();
    }
  } finally {
    work.delete();
    contours.delete();
    hierarchy.delete();
    kernelOpen.delete();
    kernelClose.delete();
  }
  return best;
}

async function calibrateAutoSquare() {
  if (!stream) { toast('Primero inicia la cámara.'); return; }
  if (!window.cvReady) { toast('Espera a que diga Visión lista.'); return; }

  $('operatorMessage').textContent = 'Calibrando: deja el cuadro negro 5×5 completo y quieto sobre la mesa.';
  clearOverlay();
  const detections = [];

  for (let i = 0; i < 10; i++) {
    const det = withSrcMat(src => detectBlackSquare(src));
    if (det) {
      detections.push(det);
      clearOverlay();
      drawBox(det.box, '#ffd166', `Cuadro ${i + 1}/10`);
    }
    await wait(120);
  }

  if (detections.length < 4) {
    $('operatorMessage').textContent = 'No se detectó el cuadro con suficiente confianza. Usa “Calibrar manual 4 esquinas”.';
    toast('No tengo suficientes lecturas del cuadro. Pruébalo manual con 4 esquinas.', 4200);
    return;
  }

  const sides = detections.map(d => d.sidePx).sort((a, b) => a - b);
  const medianSide = sides[Math.floor(sides.length / 2)];
  const sd = stddev(sides);
  const stabilityPct = (sd / medianSide) * 100;
  const confidence = Math.max(50, Math.min(99, Math.round(100 - stabilityPct * 12)));
  const squareMm = cfg().squareMm;

  pxPerMm = medianSide / squareMm;
  calibration = {
    method: 'auto 5x5',
    pxPerMm,
    confidence,
    sidePx: medianSide,
    stabilityPct: Number(stabilityPct.toFixed(2)),
    at: new Date().toISOString()
  };
  localStorage.setItem('ipp_v5_pxPerMm', String(pxPerMm));
  localStorage.setItem('ipp_v5_calibration', JSON.stringify(calibration));
  updateStateUI();

  const best = detections.sort((a, b) => b.score - a.score)[0];
  clearOverlay();
  drawBox(best.box, '#1fd18a', 'Calibrado 5×5');
  $('operatorMessage').textContent = `Escala guardada: ${pxPerMm.toFixed(3)} px/mm. Estabilidad: ${stabilityPct.toFixed(2)}%. Retira el cuadro SIN mover el celular.`;
  toast('Calibración guardada. Retira el cuadro sin mover el celular.', 4200);
}

function startManualCalibration() {
  if (!stream) { toast('Primero inicia la cámara.'); return; }
  if (!grabFrame()) { toast('No hay imagen de cámara.'); return; }
  manualMode = 'calib4';
  manualPoints = [];
  clearOverlay();
  $('operatorMessage').textContent = 'Toca las 4 esquinas del cuadro negro 5×5. No importa el orden.';
  toast('Toca las 4 esquinas del cuadro negro.', 3200);
}

overlay.addEventListener('click', (ev) => {
  if (manualMode !== 'calib4') return;
  const pt = viewToImage(ev.clientX, ev.clientY);
  if (pt.x < 0 || pt.y < 0 || pt.x > video.videoWidth || pt.y > video.videoHeight) return;
  manualPoints.push(pt);
  drawPoint(pt, manualPoints.length);
  $('operatorMessage').textContent = `Esquina marcada ${manualPoints.length}/4.`;
  if (manualPoints.length === 4) finishManualCalibration();
});

function finishManualCalibration() {
  const ordered = orderPoints(manualPoints);
  const sides = sideLengths(ordered);
  const sideAvg = avg(sides);
  const sideRatio = Math.max(...sides) / Math.max(1, Math.min(...sides));
  const squareMm = cfg().squareMm;
  pxPerMm = sideAvg / squareMm;

  const confidence = Math.max(55, Math.min(98, Math.round(100 - Math.abs(sideRatio - 1) * 120)));
  calibration = {
    method: 'manual 4 esquinas',
    pxPerMm,
    confidence,
    sidePx: sideAvg,
    sideRatio: Number(sideRatio.toFixed(3)),
    at: new Date().toISOString()
  };
  localStorage.setItem('ipp_v5_pxPerMm', String(pxPerMm));
  localStorage.setItem('ipp_v5_calibration', JSON.stringify(calibration));
  manualMode = null;
  manualPoints = [];
  updateStateUI();
  clearOverlay();
  drawBox(ordered, '#1fd18a', 'Calibrado manual');
  $('operatorMessage').textContent = `Escala guardada: ${pxPerMm.toFixed(3)} px/mm. Retira el cuadro SIN mover el celular.`;
  toast('Calibración manual guardada.', 3200);
}

function detectPatch(src) {
  const ds = matDownscale(src, 1100);
  const small = ds.mat;
  const scale = ds.scale;
  const gray = new cv.Mat();
  const blur = new cv.Mat();
  const edges = new cv.Mat();
  const work = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const kernel = cv.Mat.ones(7, 7, cv.CV_8U);
  let best = null;

  try {
    cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
    cv.Canny(blur, edges, 45, 140);
    cv.morphologyEx(edges, work, cv.MORPH_CLOSE, kernel);
    cv.findContours(work, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const imgArea = gray.cols * gray.rows;
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const area = cv.contourArea(c);
      if (area < imgArea * 0.008 || area > imgArea * 0.75) { c.delete(); continue; }

      const rect = cv.minAreaRect(c);
      const rw = Math.max(rect.size.width, 1);
      const rh = Math.max(rect.size.height, 1);
      const rectArea = rw * rh;
      if (rectArea < imgArea * 0.01) { c.delete(); continue; }

      const pts = cv.RotatedRect.points(rect).map(p => ({ x: p.x / scale, y: p.y / scale }));
      const ordered = orderPoints(pts);
      const sides = sideLengths(ordered);
      let widthPx = Math.min(avg([sides[0], sides[2]]), avg([sides[1], sides[3]]));
      let heightPx = Math.max(avg([sides[0], sides[2]]), avg([sides[1], sides[3]]));
      const score = area + Math.min(rectArea, imgArea * 0.4) * 0.2;

      const candidate = { box: ordered, areaPx: area / (scale * scale), widthPx: widthPx / scale, heightPx: heightPx / scale, score };
      if (!best || candidate.score > best.score) best = candidate;
      c.delete();
    }
  } finally {
    small.delete(); gray.delete(); blur.delete(); edges.delete(); work.delete(); contours.delete(); hierarchy.delete(); kernel.delete();
  }

  return best;
}

function measureCurrentPatch() {
  return withSrcMat(src => {
    const det = detectPatch(src);
    if (!det) return { error: 'No encuentro el parche. Usa fondo mate contrastante y evita sombras.' };
    const text = detectTextCenter(src, det.box);
    const widthMm = det.widthPx / pxPerMm;
    const heightMm = det.heightPx / pxPerMm;
    const areaMm = det.areaPx / (pxPerMm * pxPerMm);
    return { det, widthMm, heightMm, areaMm, text };
  });
}

function takeReference() {
  if (!pxPerMm) { toast('Primero calibra con el cuadro 5×5.'); return; }
  const m = measureCurrentPatch();
  if (!m || m.error) { toast(m?.error || 'No pude medir la referencia.', 4200); return; }
  reference = {
    widthMm: m.widthMm,
    heightMm: m.heightMm,
    areaMm: m.areaMm,
    textOffsetMm: m.text && Number.isFinite(m.text.offsetMm) ? m.text.offsetMm : null,
    at: new Date().toISOString()
  };
  localStorage.setItem('ipp_v5_reference', JSON.stringify(reference));
  updateStateUI();
  clearOverlay();
  drawBox(m.det.box, '#1fd18a', 'Referencia');
  $('operatorMessage').textContent = `Referencia tomada: ${reference.widthMm.toFixed(1)}×${reference.heightMm.toFixed(1)} mm. Ya puedes auditar.`;
  toast('Referencia aprobada guardada.', 3200);
}

function auditCurrentPatch(record = true) {
  if (!pxPerMm) { toast('Primero calibra con el cuadro 5×5.'); return null; }
  if (!reference) { toast('Primero toma una referencia aprobada.'); return null; }

  const m = measureCurrentPatch();
  if (!m || m.error) {
    setDecision(null, m?.error || 'No se pudo medir.');
    return null;
  }

  const c = cfg();
  const reasons = [];
  const widthDiffPct = ((m.widthMm - reference.widthMm) / reference.widthMm) * 100;
  const heightDiffPct = ((m.heightMm - reference.heightMm) / reference.heightMm) * 100;
  const areaDiffPct = ((m.areaMm - reference.areaMm) / reference.areaMm) * 100;

  if (Math.abs(widthDiffPct) > c.tolSizePct) reasons.push(`Ancho ${signed(widthDiffPct)}%`);
  if (Math.abs(heightDiffPct) > c.tolSizePct) reasons.push(`Alto ${signed(heightDiffPct)}%`);
  if (Math.abs(areaDiffPct) > c.tolAreaPct) reasons.push(`Área ${signed(areaDiffPct)}%`);

  let textOffset = null;
  if (!m.text || !Number.isFinite(m.text.offsetMm)) {
    reasons.push('Texto no detectado');
  } else {
    textOffset = m.text.offsetMm;
    if (Math.abs(textOffset) > c.tolTextMm) {
      reasons.push(`Texto descentrado ${textOffset > 0 ? 'derecha' : 'izquierda'} ${Math.abs(textOffset).toFixed(1)} mm`);
    }
  }

  const pass = reasons.length === 0;
  const result = {
    pass,
    widthMm: m.widthMm,
    heightMm: m.heightMm,
    areaMm: m.areaMm,
    textOffsetMm: textOffset,
    reason: pass ? 'Dentro de tolerancia' : reasons.join('; '),
    box: m.det.box
  };
  setDecision(result);
  clearOverlay();
  drawBox(m.det.box, pass ? '#1fd18a' : '#ff4d5e', pass ? 'APROBADO' : 'RECHAZADO');
  if (record) addLog(result);
  return result;
}

function detectTextCenter(src, box) {
  if (!pxPerMm) return null;
  const ordered = orderPoints(box);
  const s = sideLengths(ordered);
  let w = Math.round(Math.max(s[0], s[2]));
  let h = Math.round(Math.max(s[1], s[3]));
  if (w < 20 || h < 20) return null;

  // Forzamos orientación vertical cuando el parche es más alto que ancho.
  let srcPts = ordered;
  if (w > h) {
    srcPts = [ordered[1], ordered[2], ordered[3], ordered[0]];
    const temp = w; w = h; h = temp;
  }

  // Limitar tamaño de warp para rendimiento sin perder proporción. Mantiene escala aproximada si no excede.
  const maxH = 900;
  let scaleOut = 1;
  if (h > maxH) scaleOut = maxH / h;
  const outW = Math.max(40, Math.round(w * scaleOut));
  const outH = Math.max(40, Math.round(h * scaleOut));

  const srcData = [srcPts[0].x, srcPts[0].y, srcPts[1].x, srcPts[1].y, srcPts[2].x, srcPts[2].y, srcPts[3].x, srcPts[3].y];
  const dstData = [0, 0, outW - 1, 0, outW - 1, outH - 1, 0, outH - 1];
  const srcMat = cv.matFromArray(4, 1, cv.CV_32FC2, srcData);
  const dstMat = cv.matFromArray(4, 1, cv.CV_32FC2, dstData);
  const M = cv.getPerspectiveTransform(srcMat, dstMat);
  const warped = new cv.Mat();
  const gray = new cv.Mat();
  const roi = new cv.Mat();
  const bin = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const kernel = cv.Mat.ones(2, 2, cv.CV_8U);

  try {
    cv.warpPerspective(src, warped, M, new cv.Size(outW, outH), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());
    cv.cvtColor(warped, gray, cv.COLOR_RGBA2GRAY);
    const c = cfg();
    const y1 = Math.round(outH * c.textStart);
    const y2 = Math.round(outH * c.textEnd);
    const roiRect = new cv.Rect(Math.round(outW * 0.04), y1, Math.round(outW * 0.92), Math.max(5, y2 - y1));
    const roiGray = gray.roi(roiRect);
    roiGray.copyTo(roi);
    roiGray.delete();

    cv.GaussianBlur(roi, roi, new cv.Size(3, 3), 0);
    cv.threshold(roi, bin, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
    cv.morphologyEx(bin, bin, cv.MORPH_OPEN, kernel);
    cv.findContours(bin, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const roiArea = roi.rows * roi.cols;
    let used = 0;
    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);
      const br = cv.boundingRect(contour);
      contour.delete();
      if (area < Math.max(3, roiArea * 0.00025)) continue;
      if (br.width > roi.cols * 0.88 && br.height < roi.rows * 0.18) continue; // probablemente borde/línea
      if (br.height > roi.rows * 0.8 || br.width > roi.cols * 0.95) continue; // borde grande
      minX = Math.min(minX, br.x);
      maxX = Math.max(maxX, br.x + br.width);
      minY = Math.min(minY, br.y);
      maxY = Math.max(maxY, br.y + br.height);
      used++;
    }

    if (!used || !isFinite(minX)) return null;
    const textCenterX = roiRect.x + (minX + maxX) / 2;
    const patchCenterX = outW / 2;
    const pxOffsetInWarp = (textCenterX - patchCenterX) / scaleOut;
    const offsetMm = pxOffsetInWarp / pxPerMm;
    return {
      offsetMm,
      textBox: { x: (roiRect.x + minX) / scaleOut, y: (roiRect.y + minY) / scaleOut, w: (maxX - minX) / scaleOut, h: (maxY - minY) / scaleOut },
      usedContours: used
    };
  } finally {
    srcMat.delete(); dstMat.delete(); M.delete(); warped.delete(); gray.delete(); roi.delete(); bin.delete(); contours.delete(); hierarchy.delete(); kernel.delete();
  }
}

function setDecision(res, msg = '') {
  if (!res) {
    $('decision').textContent = 'ESPERANDO';
    $('decision').className = 'decision neutral';
    $('reason').textContent = msg || 'Esperando parche.';
    return;
  }
  $('decision').textContent = res.pass ? 'APROBADO' : 'RECHAZADO';
  $('decision').className = `decision ${res.pass ? 'ok' : 'bad'}`;
  $('mWidth').textContent = `${res.widthMm.toFixed(1)} mm`;
  $('mHeight').textContent = `${res.heightMm.toFixed(1)} mm`;
  $('mArea').textContent = `${res.areaMm.toFixed(0)} mm²`;
  $('mText').textContent = Number.isFinite(res.textOffsetMm) ? `${res.textOffsetMm.toFixed(1)} mm` : '--';
  $('reason').textContent = res.reason;
}

function addLog(res) {
  const c = cfg();
  const row = {
    time: new Date().toLocaleString(),
    lot: c.lot,
    result: res.pass ? 'APROBADO' : 'RECHAZADO',
    width: res.widthMm.toFixed(1),
    height: res.heightMm.toFixed(1),
    area: res.areaMm.toFixed(0),
    textOffset: Number.isFinite(res.textOffsetMm) ? res.textOffsetMm.toFixed(1) : '',
    reason: res.reason
  };
  log.unshift(row);
  log = log.slice(0, 1000);
  localStorage.setItem('ipp_v5_log', JSON.stringify(log));
  renderLog();
}

function loop() {
  if (!stream) return;
  if (autoMode && window.cvReady && pxPerMm && reference) {
    const m = measureCurrentPatch();
    const present = m && !m.error;
    if (present && !autoLocked) {
      // Medimos una vez y bloqueamos hasta que retiren el parche.
      const result = auditCurrentPatch(true);
      if (result) {
        autoLocked = true;
        absentFrames = 0;
        updateStateUI();
      }
    } else if (!present && autoLocked) {
      absentFrames++;
      if (absentFrames >= 4) {
        autoLocked = false;
        absentFrames = 0;
        setDecision(null, 'Listo para siguiente parche.');
        clearOverlay();
        updateStateUI();
      }
    }
  }
  setTimeout(() => requestAnimationFrame(loop), autoMode ? 550 : 120);
}

function exportCSV() {
  const head = 'Hora,Lote,Resultado,Ancho,Alto,Area,TextoOffset,Motivo\n';
  const body = log.map(r => [r.time, r.lot, r.result, r.width, r.height, r.area, r.textOffset, `"${String(r.reason).replaceAll('"', '""')}"`].join(',')).join('\n');
  const blob = new Blob([head + body], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `historial_inspector_parches_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function clearCalibration() {
  pxPerMm = 0;
  calibration = null;
  reference = null;
  localStorage.removeItem('ipp_v5_pxPerMm');
  localStorage.removeItem('ipp_v5_calibration');
  localStorage.removeItem('ipp_v5_reference');
  updateStateUI();
  setDecision(null, 'Calibración y referencia borradas.');
  toast('Calibración y referencia borradas.');
}

function orderPoints(points) {
  const pts = points.map(p => ({ x: p.x, y: p.y }));
  const sums = pts.map(p => p.x + p.y);
  const diffs = pts.map(p => p.x - p.y);
  const tl = pts[sums.indexOf(Math.min(...sums))];
  const br = pts[sums.indexOf(Math.max(...sums))];
  const tr = pts[diffs.indexOf(Math.max(...diffs))];
  const bl = pts[diffs.indexOf(Math.min(...diffs))];
  return [tl, tr, br, bl];
}

function sideLengths(pts) {
  return [dist(pts[0], pts[1]), dist(pts[1], pts[2]), dist(pts[2], pts[3]), dist(pts[3], pts[0])];
}
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function avg(arr) { return arr.reduce((s, v) => s + v, 0) / arr.length; }
function stddev(arr) { const a = avg(arr); return Math.sqrt(avg(arr.map(v => (v - a) ** 2))); }
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function signed(n) { return `${n >= 0 ? '+' : ''}${n.toFixed(1)}`; }

$('btnStart').addEventListener('click', startCamera);
$('btnCalibrateAuto').addEventListener('click', calibrateAutoSquare);
$('btnCalibrateManual').addEventListener('click', startManualCalibration);
$('btnReference').addEventListener('click', takeReference);
$('btnMeasure').addEventListener('click', () => auditCurrentPatch(true));
$('btnAuto').addEventListener('click', () => {
  if (!pxPerMm || !reference) { toast('Necesitas calibración y referencia antes de Auto.'); return; }
  autoMode = !autoMode;
  autoLocked = false;
  absentFrames = 0;
  $('btnAuto').dataset.active = String(autoMode);
  $('btnAuto').textContent = `Auto: ${autoMode ? 'ON' : 'OFF'}`;
  $('operatorMessage').textContent = autoMode ? 'Auto activo: coloca parche, espera resultado, retira parche, siguiente.' : 'Auto detenido.';
  updateStateUI();
});
$('btnExport').addEventListener('click', exportCSV);
$('btnReset').addEventListener('click', () => {
  log = [];
  localStorage.removeItem('ipp_v5_log');
  renderLog();
  toast('Conteo reiniciado.');
});
$('btnClearCalibration').addEventListener('click', clearCalibration);

// Redibuja si el usuario cambia orientación.
setInterval(() => {
  if (overlay.clientWidth !== Math.round(videoWrap.getBoundingClientRect().width)) resizeOverlay();
}, 1000);
