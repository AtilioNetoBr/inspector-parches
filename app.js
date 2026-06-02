/* Inspector de Parches Pro v6
   Flujo: cámara -> calibrar 5x5 -> tomar referencia -> auditar texto centrado.
*/
const $ = (id) => document.getElementById(id);
const video = $('video');
const overlay = $('overlay');
const ctx = overlay.getContext('2d');
const capture = $('captureCanvas');
const capCtx = capture.getContext('2d', { willReadFrequently: true });
const patchPreview = $('patchPreview');
const patchPreviewCtx = patchPreview.getContext('2d');
const textPreview = $('textPreview');
const textPreviewCtx = textPreview.getContext('2d');

let stream = null;
let autoMode = false;
let pxPerMm = Number(localStorage.getItem('v6_pxPerMm') || 0);
let reference = JSON.parse(localStorage.getItem('v6_reference') || 'null');
let log = JSON.parse(localStorage.getItem('v6_log') || '[]');
let lastAutoTs = 0;
let measuredLocked = false;
let missingFrames = 0;
let latestResult = null;
let peer = null;
let dataConn = null;
let mediaCall = null;

const AUTOCAPTURE_MS = 650;
const SQUARE_MM = 50;

function toast(msg, ms = 2200) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), ms);
}

function setBadge(text, cls = 'idle') {
  $('statusBadge').textContent = text;
  $('statusBadge').className = `badge ${cls}`;
}

function setStep(id, state) {
  const el = $(id);
  el.className = `step ${state}`;
}

function setDecision(kind, title, reason) {
  const d = $('decision');
  d.textContent = title;
  d.className = `decision ${kind}`;
  $('reason').textContent = reason || '';
}

function getRules() {
  return {
    textCenter: $('ruleTextCenter').checked,
    size: $('ruleSize').checked,
    area: $('ruleArea').checked,
    angle: $('ruleAngle').checked,
    tolText: Number($('tolText').value || 2),
    tolSizePct: Number($('tolSizePct').value || 3),
    tolAreaPct: Number($('tolAreaPct').value || 6),
    tolAngle: Number($('tolAngle').value || 25)
  };
}

function updateStatus() {
  $('scaleText').textContent = pxPerMm ? `${pxPerMm.toFixed(3)} px/mm` : 'No calibrada';
  $('refText').textContent = reference ? `${reference.widthMm.toFixed(1)}×${reference.heightMm.toFixed(1)} mm` : 'No tomada';
  $('autoState').textContent = autoMode ? 'ON' : 'OFF';
  if (!stream) $('modeText').textContent = 'Preparación';
  else if (!pxPerMm) $('modeText').textContent = 'Calibrar 5×5';
  else if (!reference) $('modeText').textContent = 'Tomar referencia';
  else $('modeText').textContent = autoMode ? 'Auditando' : 'Listo';

  setStep('stepCamera', stream ? 'ok' : 'pending');
  setStep('stepCal', pxPerMm ? 'ok' : 'pending');
  setStep('stepRef', reference ? 'ok' : 'pending');
  setStep('stepAudit', reference && pxPerMm ? 'ok' : 'pending');
}

function waitForOpenCv() {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (window.cvReady && typeof cv !== 'undefined' && cv.Mat) {
        clearInterval(timer);
        resolve(true);
      } else if (Date.now() - start > 15000) {
        clearInterval(timer);
        reject(new Error('OpenCV no cargó. Revisa internet.'));
      }
    }, 100);
  });
}

async function startCamera() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Este navegador no permite cámara.');
    }
    const attempts = [
      { video: { facingMode: { exact: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
      { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: true, audio: false }
    ];
    let err;
    for (const constraints of attempts) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        break;
      } catch (e) { err = e; }
    }
    if (!stream) throw err || new Error('No se pudo abrir cámara.');
    video.srcObject = stream;
    await video.play();
    resizeCanvas();
    setBadge('Cámara activa', 'live');
    $('guideText').textContent = pxPerMm ? 'Coloca parche' : 'Coloca cuadro 5×5';
    updateStatus();
    toast('Cámara iniciada');
    requestAnimationFrame(loop);
  } catch (e) {
    console.error(e);
    setBadge('Error cámara', 'bad');
    toast('No abrió cámara. Usa HTTPS/GitHub Pages y permiso de cámara.', 4000);
  }
}

function resizeCanvas() {
  const rect = video.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width * devicePixelRatio));
  const h = Math.max(1, Math.round(rect.height * devicePixelRatio));
  overlay.width = w;
  overlay.height = h;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}
window.addEventListener('resize', resizeCanvas);

function grabFrame() {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return false;
  capture.width = vw;
  capture.height = vh;
  capCtx.drawImage(video, 0, 0, vw, vh);
  return true;
}

function clearOverlay() {
  ctx.clearRect(0, 0, overlay.clientWidth, overlay.clientHeight);
}

function drawBox(box, color = '#1fd18a', label = '') {
  if (!box || !box.length) return;
  const sx = overlay.clientWidth / capture.width;
  const sy = overlay.clientHeight / capture.height;
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.font = '16px system-ui';
  ctx.beginPath();
  box.forEach((p, i) => {
    const x = p.x * sx;
    const y = p.y * sy;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  });
  ctx.closePath();
  ctx.stroke();
  if (label) ctx.fillText(label, box[0].x * sx + 6, box[0].y * sy + 20);
}

function matMeanGray(gray, rect) {
  const x = Math.max(0, Math.min(gray.cols - 1, Math.round(rect.x)));
  const y = Math.max(0, Math.min(gray.rows - 1, Math.round(rect.y)));
  const w = Math.max(1, Math.min(gray.cols - x, Math.round(rect.width)));
  const h = Math.max(1, Math.min(gray.rows - y, Math.round(rect.height)));
  const roi = gray.roi(new cv.Rect(x, y, w, h));
  const mean = cv.mean(roi)[0];
  roi.delete();
  return mean;
}

function rotatedRectPoints(rect) {
  return cv.RotatedRect.points(rect).map(p => ({ x: p.x, y: p.y }));
}

function sortCorners(points) {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  const sorted = [...points].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  const topLeftIndex = sorted.reduce((best, p, i) => (p.x + p.y < sorted[best].x + sorted[best].y ? i : best), 0);
  return [...sorted.slice(topLeftIndex), ...sorted.slice(0, topLeftIndex)];
}

function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function avgSide(points) {
  const p = sortCorners(points);
  return (distance(p[0], p[1]) + distance(p[1], p[2]) + distance(p[2], p[3]) + distance(p[3], p[0])) / 4;
}

async function calibrateAutoSquare() {
  try {
    await waitForOpenCv();
    if (!grabFrame()) return toast('Primero inicia cámara.');
    const readings = [];
    let bestBox = null;
    for (let i = 0; i < 5; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 110));
      grabFrame();
      const found = findBlackSquare();
      if (found) {
        readings.push(found.sidePx);
        bestBox = found.box;
      }
    }
    if (readings.length < 3) {
      setDecision('bad', 'NO CALIBRADO', 'No detecté estable el cuadro 5×5. Usa manual 4 esquinas.');
      return toast('No detecté suficiente estabilidad. Usa manual 4 esquinas.', 3500);
    }
    readings.sort((a, b) => a - b);
    const median = readings[Math.floor(readings.length / 2)];
    const spread = (readings[readings.length - 1] - readings[0]) / median;
    if (spread > 0.08) {
      setDecision('bad', 'NO CALIBRADO', `Lecturas inestables (${(spread * 100).toFixed(1)}%). Usa manual.`);
      return toast('Lectura inestable. Fija mejor el cuadro o calibra manual.', 3500);
    }
    pxPerMm = median / SQUARE_MM;
    localStorage.setItem('v6_pxPerMm', String(pxPerMm));
    clearOverlay();
    drawBox(bestBox, '#ffd166', '5×5 calibrado');
    setDecision('ok', 'ESCALA LISTA', `Cuadro 5×5 detectado. Escala: ${pxPerMm.toFixed(3)} px/mm.`);
    $('guideText').textContent = 'Retira cuadro y toma referencia';
    updateStatus();
    toast('Escala calibrada con cuadro 5×5');
  } catch (e) {
    console.error(e);
    toast(e.message || 'Error calibrando.', 4000);
  }
}

function findBlackSquare() {
  let src = cv.imread(capture);
  let gray = new cv.Mat();
  let blur = new cv.Mat();
  let best = null;
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
    const minArea = capture.width * capture.height * 0.002;
    const maxArea = capture.width * capture.height * 0.45;
    const thresholds = [45, 60, 75, 90, 110, 130, 150];
    for (const th of thresholds) {
      let mask = new cv.Mat();
      let contours = new cv.MatVector();
      let hierarchy = new cv.Mat();
      try {
        cv.threshold(blur, mask, th, 255, cv.THRESH_BINARY_INV);
        const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
        cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, k);
        k.delete();
        cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        for (let i = 0; i < contours.size(); i++) {
          const cnt = contours.get(i);
          const area = cv.contourArea(cnt);
          if (area < minArea || area > maxArea) { cnt.delete(); continue; }
          const rect = cv.minAreaRect(cnt);
          const rw = Math.max(rect.size.width, rect.size.height);
          const rh = Math.min(rect.size.width, rect.size.height);
          if (!rw || !rh) { cnt.delete(); continue; }
          const aspect = rw / rh;
          if (aspect < 0.78 || aspect > 1.28) { cnt.delete(); continue; }
          const fill = area / (rw * rh);
          if (fill < 0.65) { cnt.delete(); continue; }
          const br = cv.boundingRect(cnt);
          const inside = matMeanGray(gray, br);
          const pad = Math.round(Math.max(br.width, br.height) * 0.18);
          const ringRect = {
            x: br.x - pad,
            y: br.y - pad,
            width: br.width + pad * 2,
            height: br.height + pad * 2
          };
          const outside = matMeanGray(gray, ringRect);
          const contrast = outside - inside;
          const score = contrast * 4 + fill * 80 - Math.abs(1 - aspect) * 120 + Math.min(area / 1000, 200);
          if (inside < 120 && contrast > 25 && (!best || score > best.score)) {
            best = { score, sidePx: (rw + rh) / 2, box: rotatedRectPoints(rect), area, inside, outside, contrast };
          }
          cnt.delete();
        }
      } finally {
        mask.delete(); contours.delete(); hierarchy.delete();
      }
    }
  } finally {
    src.delete(); gray.delete(); blur.delete();
  }
  return best;
}

function calibrateManualSquare() {
  if (!grabFrame()) return toast('Primero inicia cámara.');
  clearOverlay();
  const points = [];
  setDecision('neutral', 'CALIBRACIÓN MANUAL', 'Toca las 4 esquinas del cuadro negro 5×5, en cualquier orden.');
  toast('Toca las 4 esquinas del cuadro negro.', 3500);
  const onClick = (ev) => {
    const rect = overlay.getBoundingClientRect();
    const xScreen = ev.clientX - rect.left;
    const yScreen = ev.clientY - rect.top;
    const x = xScreen * capture.width / rect.width;
    const y = yScreen * capture.height / rect.height;
    points.push({ x, y });
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.arc(xScreen, yScreen, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(String(points.length), xScreen + 10, yScreen - 10);
    if (points.length === 4) {
      overlay.removeEventListener('click', onClick);
      const sidePx = avgSide(points);
      pxPerMm = sidePx / SQUARE_MM;
      localStorage.setItem('v6_pxPerMm', String(pxPerMm));
      clearOverlay();
      drawBox(sortCorners(points), '#ffd166', '5×5 manual');
      setDecision('ok', 'ESCALA LISTA', `Escala manual: ${pxPerMm.toFixed(3)} px/mm.`);
      $('guideText').textContent = 'Retira cuadro y toma referencia';
      updateStatus();
      toast('Escala manual guardada. Ahora retira el cuadro.');
    }
  };
  overlay.addEventListener('click', onClick);
}

function findPatchContour() {
  let src = cv.imread(capture);
  let gray = new cv.Mat();
  let blur = new cv.Mat();
  let edges = new cv.Mat();
  let contours = new cv.MatVector();
  let hierarchy = new cv.Mat();
  let best = null;
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
    cv.Canny(blur, edges, 35, 120);
    const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
    cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, k);
    k.delete();
    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    const minArea = capture.width * capture.height * 0.01;
    const maxArea = capture.width * capture.height * 0.75;
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      if (area < minArea || area > maxArea) { cnt.delete(); continue; }
      const rect = cv.minAreaRect(cnt);
      const rw = Math.max(rect.size.width, rect.size.height);
      const rh = Math.min(rect.size.width, rect.size.height);
      if (!rw || !rh) { cnt.delete(); continue; }
      const aspect = rw / rh;
      if (aspect > 2.2 || aspect < 1.0) { cnt.delete(); continue; }
      const fill = area / (rw * rh);
      if (fill < 0.35) { cnt.delete(); continue; }
      const score = area * fill;
      if (!best || score > best.score) best = { score, contour: cnt, rect, area, box: rotatedRectPoints(rect) };
      else cnt.delete();
    }
  } finally {
    src.delete(); gray.delete(); blur.delete(); edges.delete(); contours.delete(); hierarchy.delete();
  }
  return best;
}

function warpPatch(box) {
  const pts = sortCorners(box);
  const sideA = distance(pts[0], pts[1]);
  const sideB = distance(pts[1], pts[2]);
  const sideC = distance(pts[2], pts[3]);
  const sideD = distance(pts[3], pts[0]);
  let w = Math.round(Math.max(sideA, sideC));
  let h = Math.round(Math.max(sideB, sideD));
  if (w < 10 || h < 10) return null;
  let src = cv.imread(capture);
  let dst = new cv.Mat();
  let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    pts[0].x, pts[0].y,
    pts[1].x, pts[1].y,
    pts[2].x, pts[2].y,
    pts[3].x, pts[3].y
  ]);
  let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]);
  let M = cv.getPerspectiveTransform(srcTri, dstTri);
  try {
    cv.warpPerspective(src, dst, M, new cv.Size(w, h), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());
    // Mantener orientación retrato cuando aplique.
    if (dst.cols > dst.rows) {
      let rotated = new cv.Mat();
      cv.rotate(dst, rotated, cv.ROTATE_90_CLOCKWISE);
      dst.delete();
      dst = rotated;
    }
    const oriented = orientByTextBottom(dst);
    if (oriented !== dst) dst.delete();
    return oriented;
  } finally {
    src.delete(); srcTri.delete(); dstTri.delete(); M.delete();
  }
}

function darkScoreInBand(mat, fromY, toY) {
  let gray = new cv.Mat();
  let roi = null;
  try {
    cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);
    const y = Math.max(0, Math.round(mat.rows * fromY));
    const h = Math.max(1, Math.round(mat.rows * (toY - fromY)));
    roi = gray.roi(new cv.Rect(0, y, mat.cols, Math.min(h, mat.rows - y)));
    const data = roi.data;
    let count = 0;
    for (let i = 0; i < data.length; i++) if (data[i] < 115) count++;
    return count / data.length;
  } finally {
    if (roi) roi.delete(); gray.delete();
  }
}

function rotateMat(mat, code) {
  const out = new cv.Mat();
  cv.rotate(mat, out, code);
  return out;
}

function orientByTextBottom(mat) {
  // Compara dos orientaciones verticales: normal vs 180°. El texto debería estar abajo.
  const scoreBottom = darkScoreInBand(mat, 0.58, 0.95) - darkScoreInBand(mat, 0.05, 0.42);
  const rot = rotateMat(mat, cv.ROTATE_180);
  const scoreRot = darkScoreInBand(rot, 0.58, 0.95) - darkScoreInBand(rot, 0.05, 0.42);
  if (scoreRot > scoreBottom * 1.15) return rot;
  rot.delete();
  return mat;
}

function detectTextCenter(warped) {
  let gray = new cv.Mat();
  let roi = null;
  let mask = new cv.Mat();
  let contours = new cv.MatVector();
  let hierarchy = new cv.Mat();
  try {
    cv.cvtColor(warped, gray, cv.COLOR_RGBA2GRAY);
    const y = Math.round(warped.rows * 0.52);
    const h = Math.max(1, warped.rows - y - Math.round(warped.rows * 0.04));
    roi = gray.roi(new cv.Rect(0, y, warped.cols, h));

    // Umbral adaptativo invertido: texto oscuro sobre parche claro.
    cv.adaptiveThreshold(roi, mask, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, 31, 12);
    let k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 3));
    cv.morphologyEx(mask, mask, cv.MORPH_OPEN, k);
    k.delete();
    k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(13, 5));
    cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, k);
    k.delete();
    cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    let boxes = [];
    const minArea = Math.max(12, warped.cols * warped.rows * 0.0003);
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      const r = cv.boundingRect(cnt);
      cnt.delete();
      if (area < minArea) continue;
      if (r.width < warped.cols * 0.025 || r.height < warped.rows * 0.015) continue;
      if (r.width > warped.cols * 0.95 || r.height > warped.rows * 0.40) continue;
      // Prioriza lo que está en la zona media-baja del ROI; evita mugre de orillas.
      if (r.y < h * 0.06 || r.y > h * 0.88) continue;
      boxes.push(r);
    }
    if (!boxes.length) return { found: false, offsetMm: null, confidence: 0, box: null };

    // Agrupa candidatos cercanos al renglón dominante.
    const centerYs = boxes.map(b => b.y + b.height / 2).sort((a, b) => a - b);
    const medianY = centerYs[Math.floor(centerYs.length / 2)];
    boxes = boxes.filter(b => Math.abs((b.y + b.height / 2) - medianY) < h * 0.22);
    const x1 = Math.min(...boxes.map(b => b.x));
    const y1 = Math.min(...boxes.map(b => b.y));
    const x2 = Math.max(...boxes.map(b => b.x + b.width));
    const y2 = Math.max(...boxes.map(b => b.y + b.height));
    const textCx = (x1 + x2) / 2;
    const patchCx = warped.cols / 2;
    const offsetPx = textCx - patchCx;
    const offsetMm = pxPerMm ? offsetPx / pxPerMm : null;
    const widthRatio = (x2 - x1) / warped.cols;
    const confidence = Math.max(0, Math.min(100, Math.round((widthRatio * 170) + Math.min(boxes.length, 5) * 8)));

    drawPreview(warped, { x: x1, y: y1 + y, width: x2 - x1, height: y2 - y1 }, textCx, patchCx);
    return { found: true, offsetMm, confidence, box: { x: x1, y: y1 + y, width: x2 - x1, height: y2 - y1 } };
  } finally {
    gray.delete(); if (roi) roi.delete(); mask.delete(); contours.delete(); hierarchy.delete();
  }
}

function drawPreview(mat, textBox, textCx, patchCx) {
  cv.imshow(patchPreview, mat);
  patchPreviewCtx.lineWidth = 3;
  patchPreviewCtx.strokeStyle = '#58a6ff';
  patchPreviewCtx.beginPath();
  patchPreviewCtx.moveTo(patchCx, 0);
  patchPreviewCtx.lineTo(patchCx, patchPreview.height);
  patchPreviewCtx.stroke();
  if (textBox) {
    patchPreviewCtx.strokeStyle = '#1fd18a';
    patchPreviewCtx.strokeRect(textBox.x, textBox.y, textBox.width, textBox.height);
    patchPreviewCtx.strokeStyle = '#ffd166';
    patchPreviewCtx.beginPath();
    patchPreviewCtx.moveTo(textCx, 0);
    patchPreviewCtx.lineTo(textCx, patchPreview.height);
    patchPreviewCtx.stroke();
  }

  textPreview.width = Math.max(1, Math.round(mat.cols));
  textPreview.height = Math.max(1, Math.round(mat.rows * 0.48));
  const tmp = new cv.Mat();
  const y = Math.round(mat.rows * 0.52);
  const roi = mat.roi(new cv.Rect(0, y, mat.cols, mat.rows - y));
  cv.imshow(textPreview, roi);
  roi.delete(); tmp.delete();
  if (textBox) {
    textPreviewCtx.strokeStyle = '#1fd18a';
    textPreviewCtx.lineWidth = 3;
    textPreviewCtx.strokeRect(textBox.x, Math.max(0, textBox.y - y), textBox.width, textBox.height);
    textPreviewCtx.strokeStyle = '#58a6ff';
    textPreviewCtx.beginPath();
    textPreviewCtx.moveTo(patchCx, 0);
    textPreviewCtx.lineTo(patchCx, textPreview.height);
    textPreviewCtx.stroke();
    textPreviewCtx.strokeStyle = '#ffd166';
    textPreviewCtx.beginPath();
    textPreviewCtx.moveTo(textCx, 0);
    textPreviewCtx.lineTo(textCx, textPreview.height);
    textPreviewCtx.stroke();
  }
}

function analyzeFrame(record = false) {
  if (!window.cvReady || typeof cv === 'undefined') {
    toast('OpenCV todavía está cargando. Espera unos segundos.');
    return null;
  }
  if (!pxPerMm) {
    setDecision('bad', 'FALTA ESCALA', 'Calibra primero con el cuadro negro 5×5.');
    return null;
  }
  if (!grabFrame()) return null;
  const patch = findPatchContour();
  clearOverlay();
  if (!patch) {
    setDecision('neutral', 'SIN PARCHE', 'No encuentro un contorno claro. Usa fondo oscuro mate y parche completo.');
    latestResult = null;
    missingFrames++;
    if (missingFrames >= 3) measuredLocked = false;
    return null;
  }
  missingFrames = 0;
  drawBox(patch.box, '#58a6ff', 'parche');

  const rect = patch.rect;
  const wPx = Math.min(rect.size.width, rect.size.height);
  const hPx = Math.max(rect.size.width, rect.size.height);
  const widthMm = wPx / pxPerMm;
  const heightMm = hPx / pxPerMm;
  const areaMm = patch.area / (pxPerMm * pxPerMm);
  const angle = normalizeAngle(rect.angle, rect.size.width, rect.size.height);
  const warped = warpPatch(patch.box);
  const text = warped ? detectTextCenter(warped) : { found: false, offsetMm: null, confidence: 0 };
  if (warped) warped.delete();

  const rules = getRules();
  const checks = [];
  let pass = true;

  if (rules.textCenter) {
    if (!text.found) {
      pass = false;
      checks.push('Texto no detectado');
    } else if (Math.abs(text.offsetMm) > rules.tolText) {
      pass = false;
      checks.push(`Texto descentrado ${text.offsetMm > 0 ? 'derecha' : 'izquierda'} ${Math.abs(text.offsetMm).toFixed(1)} mm`);
    } else {
      checks.push(`Texto centrado OK (${text.offsetMm.toFixed(1)} mm)`);
    }
  }

  if (reference && rules.size) {
    const dw = pctDiff(widthMm, reference.widthMm);
    const dh = pctDiff(heightMm, reference.heightMm);
    if (Math.abs(dw) > rules.tolSizePct || Math.abs(dh) > rules.tolSizePct) {
      pass = false;
      checks.push(`Medida fuera: ancho ${dw.toFixed(1)}%, alto ${dh.toFixed(1)}%`);
    } else checks.push('Medida OK');
  }

  if (reference && rules.area) {
    const da = pctDiff(areaMm, reference.areaMm);
    if (Math.abs(da) > rules.tolAreaPct) {
      pass = false;
      checks.push(`Área fuera ${da.toFixed(1)}%`);
    } else checks.push('Área OK');
  }

  if (rules.angle) {
    if (Math.abs(angle) > rules.tolAngle) {
      pass = false;
      checks.push(`Giro excesivo ${angle.toFixed(1)}°`);
    } else checks.push('Giro OK');
  }

  if (!rules.textCenter && !rules.size && !rules.area && !rules.angle) {
    checks.push('Sin criterios activos: solo lectura');
  }

  const result = {
    time: new Date().toLocaleString(),
    pass,
    widthMm,
    heightMm,
    areaMm,
    angle,
    textOffsetMm: text.offsetMm,
    textFound: text.found,
    confidence: text.confidence,
    reason: checks.join('; ')
  };
  latestResult = result;
  updateResultUI(result);
  if (record) addLog(result);
  sendResultToPc(result);
  return result;
}

function normalizeAngle(angle, w, h) {
  let a = angle;
  if (w < h) a = angle + 90;
  if (a > 45) a -= 90;
  if (a < -45) a += 90;
  return a;
}

function pctDiff(value, base) { return ((value - base) / base) * 100; }

function updateResultUI(res) {
  setDecision(res.pass ? 'ok' : 'bad', res.pass ? 'APROBADO' : 'RECHAZADO', res.reason);
  $('mWidth').textContent = `${res.widthMm.toFixed(1)} mm`;
  $('mHeight').textContent = `${res.heightMm.toFixed(1)} mm`;
  $('mArea').textContent = `${res.areaMm.toFixed(0)} mm²`;
  $('mAngle').textContent = `${res.angle.toFixed(1)}°`;
  $('mText').textContent = res.textFound ? `${res.textOffsetMm.toFixed(1)} mm` : 'No detectado';
  $('mConfidence').textContent = `${res.confidence}%`;
}

function takeReference() {
  if (!pxPerMm) return toast('Primero calibra con el cuadro 5×5.');
  const res = analyzeFrame(false);
  if (!res) return;
  reference = {
    widthMm: res.widthMm,
    heightMm: res.heightMm,
    areaMm: res.areaMm,
    textOffsetMm: res.textFound ? res.textOffsetMm : 0,
    createdAt: new Date().toISOString()
  };
  localStorage.setItem('v6_reference', JSON.stringify(reference));
  setDecision('ok', 'REFERENCIA GUARDADA', `Referencia: ${reference.widthMm.toFixed(1)}×${reference.heightMm.toFixed(1)} mm. Texto: ${reference.textOffsetMm.toFixed(1)} mm.`);
  $('guideText').textContent = 'Activa Auto o mide ahora';
  updateStatus();
  toast('Referencia aprobada guardada.');
}

function addLog(res) {
  log.unshift({
    time: res.time,
    result: res.pass ? 'APROBADO' : 'RECHAZADO',
    width: res.widthMm.toFixed(1),
    height: res.heightMm.toFixed(1),
    area: res.areaMm.toFixed(0),
    text: res.textFound ? res.textOffsetMm.toFixed(1) : 'ND',
    reason: res.reason
  });
  log = log.slice(0, 1000);
  localStorage.setItem('v6_log', JSON.stringify(log));
  renderLog();
}

function renderLog() {
  $('logBody').innerHTML = log.map(r => `
    <tr>
      <td>${escapeHtml(r.time)}</td><td>${escapeHtml(r.result)}</td><td>${escapeHtml(r.width)}</td><td>${escapeHtml(r.height)}</td><td>${escapeHtml(r.area)}</td><td>${escapeHtml(r.text)}</td><td>${escapeHtml(r.reason)}</td>
    </tr>`).join('');
  const ok = log.filter(r => r.result === 'APROBADO').length;
  const bad = log.length - ok;
  $('okCount').textContent = ok;
  $('badCount').textContent = bad;
  $('totalCount').textContent = log.length;
  $('okPct').textContent = log.length ? `${((ok / log.length) * 100).toFixed(1)}%` : '0%';
}

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

function exportCSV() {
  const head = 'Hora,Resultado,Ancho,Alto,Area,TextoOffset,Motivo\n';
  const body = log.map(r => [r.time, r.result, r.width, r.height, r.area, r.text, `"${String(r.reason).replace(/"/g, '""')}"`].join(',')).join('\n');
  const blob = new Blob([head + body], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'historial_inspector_parches_v6.csv';
  a.click();
}

function loop() {
  if (!stream) return;
  if (autoMode && Date.now() - lastAutoTs > AUTOCAPTURE_MS) {
    const res = analyzeFrame(false);
    if (res && !measuredLocked && reference) {
      addLog(res);
      measuredLocked = true;
      lastAutoTs = Date.now();
    }
  }
  requestAnimationFrame(loop);
}

function toggleAuto() {
  if (!pxPerMm) return toast('Primero calibra escala.');
  if (!reference) return toast('Primero toma referencia aprobada.');
  autoMode = !autoMode;
  measuredLocked = false;
  missingFrames = 0;
  $('btnAuto').dataset.active = String(autoMode);
  $('btnAuto').textContent = `Auto: ${autoMode ? 'ON' : 'OFF'}`;
  $('guideText').textContent = autoMode ? 'Auditando: coloca y retira pieza' : 'Auto detenido';
  updateStatus();
}

async function connectToPc() {
  const target = $('peerTarget').value.trim();
  if (!target) return toast('Pega el ID que aparece en el monitor PC.');
  if (!stream) return toast('Primero inicia cámara.');
  try {
    if (!peer) peer = new Peer(undefined, { debug: 1 });
    await new Promise((resolve, reject) => {
      if (peer.open) return resolve();
      peer.once('open', resolve);
      peer.once('error', reject);
      setTimeout(() => reject(new Error('PeerJS tardó demasiado.')), 7000);
    });
    dataConn = peer.connect(target, { reliable: true });
    dataConn.on('open', () => {
      $('pcStatus').textContent = 'Conectado a PC. Enviando resultados.';
      toast('Monitor PC conectado.');
      sendResultToPc(latestResult);
    });
    dataConn.on('close', () => $('pcStatus').textContent = 'Conexión PC cerrada.');
    dataConn.on('error', e => $('pcStatus').textContent = `Error PC: ${e.message || e}`);
    mediaCall = peer.call(target, stream);
    $('pcStatus').textContent = 'Conectando a PC...';
  } catch (e) {
    console.error(e);
    $('pcStatus').textContent = 'No se pudo conectar a PC.';
    toast('No se pudo conectar a PC. Revisa ID e internet.', 3500);
  }
}

function stopPc() {
  if (mediaCall) mediaCall.close();
  if (dataConn) dataConn.close();
  mediaCall = null;
  dataConn = null;
  $('pcStatus').textContent = 'Sin conexión a PC.';
}

function sendResultToPc(res) {
  if (!dataConn || !dataConn.open) return;
  dataConn.send({
    type: 'result',
    result: res ? {
      pass: res.pass,
      width: res.widthMm?.toFixed(1),
      height: res.heightMm?.toFixed(1),
      text: res.textFound ? res.textOffsetMm.toFixed(1) : 'ND',
      reason: res.reason,
      total: log.length
    } : null
  });
}

$('btnStart').onclick = startCamera;
$('btnCalAuto').onclick = calibrateAutoSquare;
$('btnCalManual').onclick = calibrateManualSquare;
$('btnReference').onclick = takeReference;
$('btnMeasure').onclick = () => analyzeFrame(true);
$('btnAuto').onclick = toggleAuto;
$('btnExport').onclick = exportCSV;
$('btnReset').onclick = () => {
  if (!confirm('¿Reiniciar conteo?')) return;
  log = [];
  localStorage.removeItem('v6_log');
  renderLog();
};
$('btnConnectPc').onclick = connectToPc;
$('btnStopPc').onclick = stopPc;

['ruleTextCenter', 'ruleSize', 'ruleArea', 'ruleAngle', 'tolText', 'tolSizePct', 'tolAreaPct', 'tolAngle'].forEach(id => {
  $(id).addEventListener('change', () => {
    localStorage.setItem(`v6_${id}`, $(id).type === 'checkbox' ? String($(id).checked) : $(id).value);
  });
});

function loadSettings() {
  ['ruleTextCenter', 'ruleSize', 'ruleArea', 'ruleAngle'].forEach(id => {
    const v = localStorage.getItem(`v6_${id}`);
    if (v !== null) $(id).checked = v === 'true';
  });
  ['tolText', 'tolSizePct', 'tolAreaPct', 'tolAngle'].forEach(id => {
    const v = localStorage.getItem(`v6_${id}`);
    if (v !== null) $(id).value = v;
  });
}
loadSettings();
renderLog();
updateStatus();
