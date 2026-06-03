/* Inspector de Parches Móvil v12
   Enfoque: iPhone primero, guías siempre visibles, tarjeta 7x7/5x5, referencia 100%, texto alineado sin OCR. */
const $ = (id) => document.getElementById(id);
const video = $('video');
const overlay = $('overlay');
const octx = overlay.getContext('2d');
const capture = $('captureCanvas');
const cctx = capture.getContext('2d', { willReadFrequently: true });
const diagnosticCanvas = $('diagnosticCanvas');
const dctx = diagnosticCanvas.getContext('2d');

const OUTER_MM = 70;
const INNER_MM = 50;
const CARD_WARP = 700;
const CARD_INNER_A = 100;
const CARD_INNER_B = 600;

let state = {
  cvReady: false,
  stream: null,
  devices: [],
  deviceIndex: 0,
  usingPhoto: false,
  pxPerMm: Number(localStorage.getItem('v12_pxPerMm') || 0),
  calibration: loadJSON('v12_calibration'),
  reference: loadJSON('v12_reference'),
  lastResult: null,
  lastCard: null,
  lastPatchWarp: null,
  lastTextMask: null,
  auto: false,
  autoLatch: false,
  lastAutoTs: 0,
  log: loadJSON('v12_log') || [],
};

function loadJSON(key){ try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } }
function saveJSON(key, value){ localStorage.setItem(key, JSON.stringify(value)); }
function clamp(n,a,b){ return Math.max(a, Math.min(b, n)); }
function fmt(n, dec=1){ return Number.isFinite(n) ? n.toFixed(dec) : '--'; }
function now(){ return new Date().toLocaleString(); }
function toast(msg){ const t=$('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2200); }
function setReason(msg){ $('reason').textContent = msg; }
function setCvState(text, cls='warn'){ $('cvState').textContent=text; $('cvState').className='pill '+cls; }

window.addEventListener('opencv-ready', () => {
  state.cvReady = true;
  setCvState('Visión lista', 'ok');
  toast('OpenCV listo');
});
setTimeout(() => { if(window.cvReady && !state.cvReady){ state.cvReady=true; setCvState('Visión lista','ok'); } }, 1200);

function updateUI(){
  $('cameraStatus').textContent = state.stream ? 'activa' : (state.usingPhoto ? 'foto' : 'apagada');
  $('calStatus').textContent = state.pxPerMm ? 'OK' : 'pendiente';
  $('refStatus').textContent = state.reference ? '100% cargada' : 'pendiente';
  $('scoreStatus').textContent = state.lastResult?.score != null ? Math.round(state.lastResult.score)+'%' : '--';
  $('scaleStatus').textContent = state.pxPerMm ? `${state.pxPerMm.toFixed(2)} px/mm` : '--';
  $('cardConfidence').textContent = state.calibration?.confidence ? `${Math.round(state.calibration.confidence)}%` : '--';
  $('innerStatus').textContent = state.calibration?.innerOk ? 'OK' : '--';
  $('calTime').textContent = state.calibration?.time || '--';
  $('refBaseText').textContent = state.reference?.baseTextMm != null ? `${fmt(state.reference.baseTextMm)} mm` : '--';
  $('refText').textContent = state.reference?.text ? `${fmt(state.reference.text.wMm)}×${fmt(state.reference.text.hMm)} mm` : '--';
  $('refPatch').textContent = state.reference ? `${fmt(state.reference.widthMm/10,2)}×${fmt(state.reference.heightMm/10,2)} cm` : '--';
  $('refTime').textContent = state.reference?.time || '--';
  $('okCount').textContent = state.log.filter(x=>x.result==='APROBADO').length;
  $('badCount').textContent = state.log.filter(x=>x.result==='RECHAZADO').length;
  renderLog();
}

function resizeOverlay(){
  const r = overlay.getBoundingClientRect();
  overlay.width = Math.max(1, Math.round(r.width * devicePixelRatio));
  overlay.height = Math.max(1, Math.round(r.height * devicePixelRatio));
  octx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
}
window.addEventListener('resize', resizeOverlay);
resizeOverlay();

async function startCamera(){
  stopCamera();
  state.usingPhoto = false;
  const attempts = [];
  if(state.devices.length){
    const d = state.devices[state.deviceIndex % state.devices.length];
    attempts.push({ video:{ deviceId:{ exact:d.deviceId }, width:{ ideal:1280 }, height:{ ideal:720 } }, audio:false });
  }
  attempts.push({ video:{ facingMode:{ ideal:'environment' }, width:{ ideal:1280 }, height:{ ideal:720 } }, audio:false });
  attempts.push({ video:{ facingMode:'environment' }, audio:false });
  attempts.push({ video:true, audio:false });

  let lastErr = null;
  for(const constraints of attempts){
    try{
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      state.stream = stream;
      video.srcObject = stream;
      video.style.display = 'block';
      await video.play();
      await refreshDevices();
      updateUI();
      toast('Cámara activa');
      setReason('Cámara activa. Las guías del celular deben permanecer visibles.');
      return;
    }catch(e){ lastErr = e; }
  }
  console.error(lastErr);
  toast('No abrió cámara. Prueba Safari normal, HTTPS y permisos.');
  setReason('No se pudo abrir la cámara. En iPhone abre desde GitHub Pages HTTPS, permite cámara y cierra apps que la usen.');
  updateUI();
}
function stopCamera(){
  if(state.stream){ state.stream.getTracks().forEach(t=>t.stop()); state.stream=null; }
}
async function refreshDevices(){
  try{
    const all = await navigator.mediaDevices.enumerateDevices();
    state.devices = all.filter(d=>d.kind==='videoinput');
  }catch(e){ console.warn(e); }
}
async function switchCamera(){
  await refreshDevices();
  if(!state.devices.length){ toast('No hay lista de cámaras aún'); return; }
  state.deviceIndex = (state.deviceIndex + 1) % state.devices.length;
  await startCamera();
}

function grabFrame(){
  if(state.usingPhoto && capture.width && capture.height) return true;
  const vw = video.videoWidth, vh = video.videoHeight;
  if(!vw || !vh) return false;
  capture.width = vw; capture.height = vh;
  cctx.drawImage(video, 0, 0, vw, vh);
  return true;
}
function setPhotoFile(file){
  const img = new Image();
  img.onload = () => {
    stopCamera();
    state.usingPhoto = true;
    const maxSide = 1600;
    let w = img.naturalWidth, h = img.naturalHeight;
    const scale = Math.min(1, maxSide / Math.max(w,h));
    w = Math.round(w*scale); h = Math.round(h*scale);
    capture.width = w; capture.height = h;
    cctx.drawImage(img,0,0,w,h);
    video.style.display = 'none';
    showCanvasOnDiagnostic(capture);
    updateUI();
    toast('Foto cargada para análisis');
    setReason('Foto cargada. Puedes calibrar, tomar referencia o medir desde esta imagen.');
  };
  img.src = URL.createObjectURL(file);
}

function imgToOverlay(pt){
  if(!capture.width || !capture.height) return {x:0,y:0};
  const w = overlay.clientWidth, h = overlay.clientHeight;
  return { x: pt.x * w / capture.width, y: pt.y * h / capture.height };
}
function drawPoly(points, color, width=3, label=''){
  if(!points || !points.length) return;
  octx.save(); octx.strokeStyle=color; octx.lineWidth=width; octx.fillStyle=color; octx.font='13px system-ui';
  octx.beginPath();
  points.forEach((p,i)=>{ const q=imgToOverlay(p); i?octx.lineTo(q.x,q.y):octx.moveTo(q.x,q.y); });
  octx.closePath(); octx.stroke();
  if(label){ const q=imgToOverlay(points[0]); octx.fillText(label, q.x+6, q.y-6); }
  octx.restore();
}
function drawLine(p1,p2,color,width=2,label=''){
  const a=imgToOverlay(p1), b=imgToOverlay(p2);
  octx.save(); octx.strokeStyle=color; octx.fillStyle=color; octx.lineWidth=width; octx.font='13px system-ui';
  octx.beginPath(); octx.moveTo(a.x,a.y); octx.lineTo(b.x,b.y); octx.stroke();
  if(label) octx.fillText(label, (a.x+b.x)/2+6, (a.y+b.y)/2-6);
  octx.restore();
}
function drawGuides(){
  resizeOverlay();
  const w = overlay.clientWidth, h = overlay.clientHeight;
  octx.clearRect(0,0,w,h);

  // Guías permanentes: retícula, zona tarjeta y zona de texto.
  octx.save();
  octx.lineWidth = 1.4;
  octx.strokeStyle = 'rgba(255,255,255,.35)';
  octx.setLineDash([8,8]);
  octx.beginPath(); octx.moveTo(w/2,0); octx.lineTo(w/2,h); octx.moveTo(0,h/2); octx.lineTo(w,h/2); octx.stroke();
  octx.setLineDash([]);

  const size = Math.min(w,h)*0.58;
  const x = (w-size)/2, y = (h-size)/2;
  octx.strokeStyle = 'rgba(255,255,255,.55)'; octx.lineWidth=2;
  roundRect(octx,x,y,size,size,14); octx.stroke();
  octx.fillStyle='rgba(255,255,255,.85)'; octx.font='12px system-ui'; octx.fillText('GUÍA TARJETA 7×7',x+10,y+18);
  const inner = size*(INNER_MM/OUTER_MM); const ix = x+(size-inner)/2, iy = y+(size-inner)/2;
  octx.strokeStyle = 'rgba(85,229,255,.55)'; octx.lineWidth=2; roundRect(octx,ix,iy,inner,inner,10); octx.stroke();
  octx.fillStyle='rgba(85,229,255,.92)'; octx.fillText('zona 5×5',ix+10,iy+18);

  // Banda sugerida para texto (permanente)
  octx.strokeStyle='rgba(255,209,102,.45)'; octx.lineWidth=2; octx.setLineDash([5,5]);
  const ty = h*0.67, th = h*0.16; roundRect(octx,w*.16,ty,w*.68,th,10); octx.stroke();
  octx.fillStyle='rgba(255,209,102,.9)'; octx.fillText('zona texto',w*.16+8,ty+18);
  octx.setLineDash([]);
  octx.restore();

  // Capas de análisis dinámicas.
  const r = state.lastResult;
  if(state.lastCard?.points) drawPoly(state.lastCard.points, 'rgba(34,209,143,.95)', 4, 'tarjeta');
  if(r?.patch?.box) drawPoly(r.patch.box, r.pass ? 'rgba(34,209,143,.98)' : 'rgba(255,77,99,.98)', 4, 'silueta');
  if(r?.patch?.center && r?.patch?.axis){
    drawLine(r.patch.axis[0], r.patch.axis[1], 'rgba(180,110,255,.95)', 2, 'eje');
  }
  if(r?.text?.boxOnImage) drawPoly(r.text.boxOnImage, 'rgba(255,209,102,.98)', 3, 'texto');
  if(r?.lines){
    if(r.lines.patchCenter) drawLine(r.lines.patchCenter[0], r.lines.patchCenter[1], 'rgba(88,166,255,.95)', 2, 'centro parche');
    if(r.lines.textCenter) drawLine(r.lines.textCenter[0], r.lines.textCenter[1], 'rgba(255,77,99,.95)', 2, 'centro texto');
    if(r.lines.baseText) drawLine(r.lines.baseText[0], r.lines.baseText[1], 'rgba(85,229,255,.95)', 3, 'Base a Texto');
  }

  requestAnimationFrame(drawGuides);
}
requestAnimationFrame(drawGuides);
function roundRect(ctx,x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }

function orderPts(pts){
  const arr = pts.map(p=>({x:p.x,y:p.y}));
  const sum = arr.map(p=>p.x+p.y), diff = arr.map(p=>p.x-p.y);
  return [
    arr[sum.indexOf(Math.min(...sum))],
    arr[diff.indexOf(Math.max(...diff))],
    arr[sum.indexOf(Math.max(...sum))],
    arr[diff.indexOf(Math.min(...diff))]
  ];
}
function dist(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }
function normalizeAngle(angle,w,h){ let a=angle; if(w<h) a=angle+90; if(a>45)a-=90; if(a<-45)a+=90; return a; }
function matFromPoints(points){ return cv.matFromArray(4,1,cv.CV_32FC2, points.flatMap(p=>[p.x,p.y])); }
function warpByPoints(src, points, w, h){
  const ordered = orderPts(points);
  const srcTri = matFromPoints(ordered);
  const dstTri = cv.matFromArray(4,1,cv.CV_32FC2,[0,0,w,0,w,h,0,h]);
  const M = cv.getPerspectiveTransform(srcTri, dstTri);
  const dst = new cv.Mat();
  cv.warpPerspective(src, dst, M, new cv.Size(w,h), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());
  srcTri.delete(); dstTri.delete(); M.delete();
  return {mat:dst, ordered};
}
function meanGrayInRect(gray, x0,y0,x1,y1){
  x0=clamp(Math.round(x0),0,gray.cols-1); x1=clamp(Math.round(x1),0,gray.cols);
  y0=clamp(Math.round(y0),0,gray.rows-1); y1=clamp(Math.round(y1),0,gray.rows);
  let sum=0, count=0;
  for(let y=y0;y<y1;y++){
    const off = y*gray.cols;
    for(let x=x0;x<x1;x++){ sum += gray.data[off+x]; count++; }
  }
  return count ? sum/count : 0;
}
function showMat(mat){ try{ cv.imshow(diagnosticCanvas, mat); }catch(e){ console.warn(e); } }
function showCanvasOnDiagnostic(canvas){
  diagnosticCanvas.width = canvas.width; diagnosticCanvas.height = canvas.height;
  dctx.drawImage(canvas,0,0);
}

function detectCard(){
  if(!state.cvReady || typeof cv==='undefined'){ toast('OpenCV aún no carga'); return null; }
  if(!grabFrame()){ toast('No hay imagen para calibrar'); return null; }
  const src = cv.imread(capture);
  const gray = new cv.Mat(), blur = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray, blur, new cv.Size(5,5), 0);
  let best = null;
  const thresholds = [120,135,150,165,180,195,210];
  const totalArea = src.cols * src.rows;

  for(const th of thresholds){
    const mask = new cv.Mat();
    const kernel = cv.Mat.ones(9,9,cv.CV_8U);
    const contours = new cv.MatVector(), hierarchy = new cv.Mat();
    try{
      cv.threshold(blur, mask, th, 255, cv.THRESH_BINARY);
      cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, kernel);
      cv.morphologyEx(mask, mask, cv.MORPH_OPEN, kernel);
      cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      for(let i=0;i<contours.size();i++){
        const c = contours.get(i);
        const area = cv.contourArea(c);
        if(area < totalArea*0.015 || area > totalArea*0.85){ c.delete(); continue; }
        const peri = cv.arcLength(c,true);
        const approx = new cv.Mat();
        cv.approxPolyDP(c, approx, 0.025*peri, true);
        if(approx.rows === 4 && cv.isContourConvex(approx)){
          const pts=[];
          for(let j=0;j<4;j++) pts.push({x:approx.data32S[j*2], y:approx.data32S[j*2+1]});
          const ordered = orderPts(pts);
          const sides = [dist(ordered[0],ordered[1]),dist(ordered[1],ordered[2]),dist(ordered[2],ordered[3]),dist(ordered[3],ordered[0])];
          const avgSide = sides.reduce((a,b)=>a+b,0)/4;
          const minSide = Math.min(...sides), maxSide=Math.max(...sides);
          if(minSide/maxSide < 0.45){ approx.delete(); c.delete(); continue; }
          const warped = warpByPoints(src, ordered, CARD_WARP, CARD_WARP);
          const wg = new cv.Mat(); cv.cvtColor(warped.mat, wg, cv.COLOR_RGBA2GRAY);
          const innerMean = meanGrayInRect(wg, CARD_INNER_A+25, CARD_INNER_A+25, CARD_INNER_B-25, CARD_INNER_B-25);
          const topMean = meanGrayInRect(wg, 35, 35, CARD_WARP-35, 90);
          const bottomMean = meanGrayInRect(wg, 35, CARD_WARP-90, CARD_WARP-35, CARD_WARP-35);
          const leftMean = meanGrayInRect(wg, 35, 35, 90, CARD_WARP-35);
          const rightMean = meanGrayInRect(wg, CARD_WARP-90, 35, CARD_WARP-35, CARD_WARP-35);
          const whiteMean = (topMean+bottomMean+leftMean+rightMean)/4;
          const contrast = whiteMean - innerMean;
          const centerBonus = 100 - Math.min(100, Math.hypot((ordered[0].x+ordered[2].x)/2-src.cols/2,(ordered[0].y+ordered[2].y)/2-src.rows/2) / Math.hypot(src.cols,src.rows) * 130);
          const shapeScore = clamp((minSide/maxSide)*100,0,100);
          const contrastScore = clamp((contrast-35)*1.3,0,100);
          const whiteScore = clamp((whiteMean-120)*1.2,0,100);
          const blackScore = clamp((150-innerMean)*1.1,0,100);
          const score = contrastScore*.35 + whiteScore*.20 + blackScore*.20 + shapeScore*.15 + centerBonus*.10;
          if(!best || score>best.score){
            if(best?.warp) best.warp.delete();
            best = { score, points: ordered, avgSide, pxPerMm: avgSide/OUTER_MM, innerMean, whiteMean, contrast, warp: warped.mat };
          } else warped.mat.delete();
          wg.delete();
        }
        approx.delete(); c.delete();
      }
    } finally {
      mask.delete(); kernel.delete(); contours.delete(); hierarchy.delete();
    }
  }
  src.delete(); gray.delete(); blur.delete();
  return best;
}
function calibrateCard(){
  const res = detectCard();
  if(!res){ toast('No encontré la tarjeta'); setReason('No detecté la tarjeta. Acércala al centro, evita brillos y usa fondo oscuro.'); return; }
  const innerOk = res.score >= 65 && res.contrast > 45;
  state.pxPerMm = res.pxPerMm;
  state.calibration = { pxPerMm: state.pxPerMm, confidence: res.score, innerOk, time: now(), points: res.points, innerMean: res.innerMean, whiteMean: res.whiteMean };
  state.lastCard = { points: res.points, confidence: res.score };
  localStorage.setItem('v12_pxPerMm', String(state.pxPerMm)); saveJSON('v12_calibration', state.calibration);
  showMat(res.warp);
  res.warp.delete();
  updateUI();
  toast(`Tarjeta detectada ${Math.round(state.calibration.confidence)}%`);
  setReason(`Tarjeta OK. Escala ${state.pxPerMm.toFixed(2)} px/mm. Retira la tarjeta sin mover el celular.`);
}

function detectPatch(){
  if(!state.cvReady || typeof cv==='undefined'){ toast('OpenCV aún no carga'); return null; }
  if(!state.pxPerMm){ toast('Primero calibra la tarjeta'); return null; }
  if(!grabFrame()){ toast('No hay imagen'); return null; }
  const src = cv.imread(capture);
  const gray = new cv.Mat(), blur = new cv.Mat(), edges = new cv.Mat(), closed = new cv.Mat();
  const contours = new cv.MatVector(), hierarchy = new cv.Mat();
  let bestContour = null, bestScore = -Infinity;
  try{
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5,5), 0);
    cv.Canny(blur, edges, 35, 120);
    const kernel = cv.Mat.ones(7,7,cv.CV_8U);
    cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, kernel);
    cv.findContours(closed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    const total = src.cols*src.rows;
    const cx = src.cols/2, cy = src.rows/2;
    for(let i=0;i<contours.size();i++){
      const c = contours.get(i);
      const area = cv.contourArea(c);
      if(area < total*.008 || area > total*.75){ c.delete(); continue; }
      const rect = cv.boundingRect(c);
      const centerDist = Math.hypot(rect.x+rect.width/2-cx, rect.y+rect.height/2-cy);
      const centerPenalty = centerDist / Math.hypot(src.cols,src.rows) * total*.08;
      const score = area - centerPenalty;
      if(score > bestScore){ if(bestContour) bestContour.delete(); bestContour = c; bestScore = score; }
      else c.delete();
    }
    kernel.delete();
    if(!bestContour){ setReason('No detecté silueta de parche. Usa fondo contrastante y evita que toque la tarjeta o manos.'); return null; }
    const rect = cv.minAreaRect(bestContour);
    const pts = cv.RotatedRect.points(rect).map(p=>({x:p.x,y:p.y}));
    const ordered = orderPts(pts);
    const widthPx = Math.max(rect.size.width, rect.size.height);
    const heightPx = Math.min(rect.size.width, rect.size.height);
    const widthMm = widthPx / state.pxPerMm;
    const heightMm = heightPx / state.pxPerMm;
    const areaMm2 = cv.contourArea(bestContour) / (state.pxPerMm*state.pxPerMm);
    const perimeterMm = cv.arcLength(bestContour,true) / state.pxPerMm;
    const angle = normalizeAngle(rect.angle, rect.size.width, rect.size.height);

    const dstW = clamp(Math.round(widthPx), 280, 900);
    const dstH = clamp(Math.round(heightPx), 220, 900);
    const warp = warpByPoints(src, ordered, dstW, dstH);
    const pxPerMmWarpX = dstW / widthMm;
    const pxPerMmWarpY = dstH / heightMm;
    const pxPerMmWarp = (pxPerMmWarpX + pxPerMmWarpY)/2;
    const text = detectTextBlock(warp.mat, pxPerMmWarp);
    const lineData = buildLines(ordered, text, dstW, dstH, warp.ordered);
    const result = {
      patch:{ box: ordered, widthMm, heightMm, areaMm2, perimeterMm, angle, center:{x:(ordered[0].x+ordered[2].x)/2,y:(ordered[0].y+ordered[2].y)/2}, axis: mainAxisLine(ordered) },
      text,
      lines: lineData.lines,
      warpSize:{w:dstW,h:dstH},
      pxPerMmWarp,
    };
    state.lastPatchWarp = matToCanvasData(warp.mat);
    if(text?.maskMat){ state.lastTextMask = matToCanvasData(text.maskMat); text.maskMat.delete(); }
    warp.mat.delete();
    bestContour.delete();
    return result;
  } finally {
    src.delete(); gray.delete(); blur.delete(); edges.delete(); closed.delete(); contours.delete(); hierarchy.delete();
  }
}
function mainAxisLine(ordered){
  const midL = {x:(ordered[0].x+ordered[3].x)/2, y:(ordered[0].y+ordered[3].y)/2};
  const midR = {x:(ordered[1].x+ordered[2].x)/2, y:(ordered[1].y+ordered[2].y)/2};
  return [midL, midR];
}
function matToCanvasData(mat){
  const cnv = document.createElement('canvas'); cnv.width=mat.cols; cnv.height=mat.rows;
  cv.imshow(cnv, mat);
  return cnv.toDataURL('image/jpeg', .85);
}
function drawDataURLToDiagnostic(dataUrl){
  const img = new Image();
  img.onload = ()=>{ diagnosticCanvas.width=img.width; diagnosticCanvas.height=img.height; dctx.drawImage(img,0,0); };
  img.src = dataUrl;
}

function detectTextBlock(patchMat, pxPerMmWarp){
  const gray = new cv.Mat(), blur = new cv.Mat(), roi = new cv.Mat(), mask = new cv.Mat();
  const clean = new cv.Mat();
  const contours = new cv.MatVector(), hierarchy = new cv.Mat();
  try{
    cv.cvtColor(patchMat, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(3,3), 0);
    const startY = Math.round(patchMat.rows * 0.38);
    const endY = Math.round(patchMat.rows * 0.96);
    const rect = new cv.Rect(0, startY, patchMat.cols, endY-startY);
    roi.delete?.(); // harmless in modern browsers if undefined; original roi not allocated? kept for code symmetry
  }catch(e){ /* ignored */ }
  // Rehacer de forma explícita porque OpenCV.js no permite reasignar ROI Mat constante con delete bonito.
  gray.delete(); blur.delete(); roi.delete(); mask.delete(); clean.delete(); contours.delete(); hierarchy.delete();
  return detectTextBlock2(patchMat, pxPerMmWarp);
}
function detectTextBlock2(patchMat, pxPerMmWarp){
  const gray = new cv.Mat(), blur = new cv.Mat();
  const maskFull = cv.Mat.zeros(patchMat.rows, patchMat.cols, cv.CV_8UC1);
  const contours = new cv.MatVector(), hierarchy = new cv.Mat();
  let maskForDebug = null;
  try{
    cv.cvtColor(patchMat, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(3,3), 0);
    const y0 = Math.round(patchMat.rows * 0.38), y1 = Math.round(patchMat.rows * 0.96);
    const roiRect = new cv.Rect(0, y0, patchMat.cols, y1-y0);
    const roiBlur = blur.roi(roiRect);
    const roiMask = new cv.Mat();
    cv.threshold(roiBlur, roiMask, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
    const k1 = cv.Mat.ones(3,3,cv.CV_8U);
    const k2 = cv.Mat.ones(5,17,cv.CV_8U); // une letras horizontalmente
    cv.morphologyEx(roiMask, roiMask, cv.MORPH_OPEN, k1);
    cv.morphologyEx(roiMask, roiMask, cv.MORPH_CLOSE, k2);
    const target = maskFull.roi(roiRect);
    roiMask.copyTo(target);
    target.delete(); roiBlur.delete(); k1.delete(); k2.delete(); roiMask.delete();

    cv.findContours(maskFull, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let best = null, bestArea = 0;
    for(let i=0;i<contours.size();i++){
      const c = contours.get(i);
      const area = cv.contourArea(c);
      const r = cv.boundingRect(c);
      const aspect = r.width / Math.max(1,r.height);
      const valid = area > patchMat.cols*patchMat.rows*.002 && r.width > patchMat.cols*.12 && aspect > 1.5 && r.y > patchMat.rows*.35;
      if(valid && area > bestArea){ bestArea = area; best = {x:r.x,y:r.y,w:r.width,h:r.height, contour:c}; }
      else c.delete();
    }
    // Bordado/base: mayor componente oscuro arriba del texto.
    let emblemBaseY = null;
    if(best){
      for(let i=0;i<contours.size();i++){
        // Algunos contornos ya fueron borrados; OpenCV.js no permite revisar fácil. En vez de reutilizar, hacemos una pasada más abajo.
      }
      emblemBaseY = detectEmblemBase(gray, best.y);
      const textCx = best.x + best.w/2, textCy = best.y + best.h/2;
      const centerXmm = textCx / pxPerMmWarp;
      const centerYmm = textCy / pxPerMmWarp;
      const angle = estimateTextAngle(maskFull, best);
      const baseTextMm = emblemBaseY != null ? (best.y - emblemBaseY) / pxPerMmWarp : null;
      maskForDebug = maskFull.clone();
      if(best.contour) best.contour.delete();
      return {
        found:true,
        x:best.x,y:best.y,w:best.w,h:best.h,
        wMm:best.w/pxPerMmWarp, hMm:best.h/pxPerMmWarp,
        centerXmm, centerYmm,
        angle,
        baseTextMm,
        emblemBaseY,
        maskMat: maskForDebug
      };
    }
    return {found:false, reason:'No detecté bloque de texto'};
  } finally {
    gray.delete(); blur.delete(); maskFull.delete(); contours.delete(); hierarchy.delete();
  }
}
function detectEmblemBase(grayPatch, textY){
  const mask = new cv.Mat(), contours = new cv.MatVector(), hierarchy = new cv.Mat();
  try{
    cv.threshold(grayPatch, mask, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
    const k = cv.Mat.ones(9,9,cv.CV_8U);
    cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, k); k.delete();
    cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let bestBase = null, bestArea = 0;
    for(let i=0;i<contours.size();i++){
      const c = contours.get(i); const r = cv.boundingRect(c); const area = cv.contourArea(c);
      if(r.y + r.height < textY - 2 && area > bestArea && r.y > grayPatch.rows*.05){ bestArea=area; bestBase = r.y + r.height; }
      c.delete();
    }
    return bestBase;
  } finally { mask.delete(); contours.delete(); hierarchy.delete(); }
}
function estimateTextAngle(mask, box){
  const roi = mask.roi(new cv.Rect(box.x, box.y, box.w, box.h));
  const contours = new cv.MatVector(), hierarchy = new cv.Mat();
  try{
    cv.findContours(roi, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let best=null, area=0;
    for(let i=0;i<contours.size();i++){
      const c=contours.get(i), a=cv.contourArea(c);
      if(a>area){ if(best) best.delete(); best=c; area=a; } else c.delete();
    }
    if(best){ const rect=cv.minAreaRect(best); best.delete(); return normalizeAngle(rect.angle, rect.size.width, rect.size.height); }
    return 0;
  } finally { roi.delete(); contours.delete(); hierarchy.delete(); }
}
function buildLines(ordered, text, dstW, dstH){
  const lines = {};
  const topMid = interp(ordered[0], ordered[1], .5), botMid = interp(ordered[3], ordered[2], .5);
  lines.patchCenter = [topMid, botMid];
  if(text?.found){
    // Convertir puntos del warp a aproximación sobre la imagen original mediante interpolación bilinear sobre el cuadrilátero.
    const box = [
      warpToImage(text.x, text.y, ordered, dstW, dstH),
      warpToImage(text.x+text.w, text.y, ordered, dstW, dstH),
      warpToImage(text.x+text.w, text.y+text.h, ordered, dstW, dstH),
      warpToImage(text.x, text.y+text.h, ordered, dstW, dstH),
    ];
    text.boxOnImage = box;
    const tcTop = warpToImage(text.x+text.w/2, 0, ordered, dstW, dstH);
    const tcBot = warpToImage(text.x+text.w/2, dstH, ordered, dstW, dstH);
    lines.textCenter = [tcTop, tcBot];
    if(text.emblemBaseY != null){
      const b1 = warpToImage(text.x+text.w/2, text.emblemBaseY, ordered, dstW, dstH);
      const b2 = warpToImage(text.x+text.w/2, text.y, ordered, dstW, dstH);
      lines.baseText = [b1,b2];
    }
  }
  return {lines};
}
function interp(a,b,t){ return {x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t}; }
function warpToImage(x,y,q,w,h){
  const u=x/w, v=y/h;
  const top=interp(q[0],q[1],u), bottom=interp(q[3],q[2],u);
  return interp(top,bottom,v);
}

function saveReference(){
  const res = detectPatch();
  if(!res) return;
  if(!res.text?.found){ toast('No detecté texto en referencia'); setReason('No detecté el bloque de texto. Ajusta iluminación/fondo y vuelve a tomar la referencia.'); return; }
  state.reference = {
    time: now(),
    widthMm: res.patch.widthMm, heightMm: res.patch.heightMm, areaMm2: res.patch.areaMm2, perimeterMm: res.patch.perimeterMm,
    text:{ xMm:res.text.centerXmm, yMm:res.text.centerYmm, wMm:res.text.wMm, hMm:res.text.hMm, angle:res.text.angle },
    baseTextMm: res.text.baseTextMm,
  };
  saveJSON('v12_reference', state.reference);
  state.lastResult = scoreResult(res, true);
  displayResult(state.lastResult, false);
  updateDiagnostic(); updateUI();
  toast('Referencia 100% guardada');
  setReason('Referencia 100% guardada. Cada pieza nueva se comparará contra esta.');
}
function measure(record=true){
  const res = detectPatch();
  if(!res) return null;
  const scored = scoreResult(res, false);
  state.lastResult = scored;
  displayResult(scored, record);
  updateDiagnostic(); updateUI();
  return scored;
}
function cfg(){ return {
  minScore:+$('minScore').value || 85,
  maxTextX:+$('maxTextX').value || 3,
  maxTextY:+$('maxTextY').value || 3,
  maxBaseText:+$('maxBaseText').value || 2.5,
  maxTextAngle:+$('maxTextAngle').value || 5,
  maxSizePct:+$('maxSizePct').value || 8,
  chkText:$('chkText').checked,
  chkBaseText:$('chkBaseText').checked,
  chkSize:$('chkSize').checked,
  chkShape:$('chkShape').checked,
}; }
function scorePart(error, maxError){ return clamp(100 - Math.abs(error)/Math.max(.001,maxError)*100, 0, 100); }
function scoreResult(res, asReference=false){
  const c = cfg();
  const ref = state.reference;
  const details = [];
  let activeScores = [];
  if(asReference || !ref){
    return {...res, score:100, pass:true, status:'REFERENCIA', details:['Referencia tomada como 100%']};
  }
  if(c.chkText){
    if(!res.text?.found){ activeScores.push(0); details.push('No detecté bloque de texto'); }
    else{
      const errX = res.text.centerXmm - ref.text.xMm;
      const errY = res.text.centerYmm - ref.text.yMm;
      const errA = res.text.angle - ref.text.angle;
      const sx=scorePart(errX,c.maxTextX), sy=scorePart(errY,c.maxTextY), sa=scorePart(errA,c.maxTextAngle);
      const textScore = sx*.50 + sy*.30 + sa*.20;
      activeScores.push(textScore);
      details.push(`Texto ${Math.round(textScore)}% · X ${fmt(errX)} mm · Y ${fmt(errY)} mm · Ángulo ${fmt(errA)}°`);
    }
  }
  if(c.chkBaseText){
    if(res.text?.baseTextMm == null || ref.baseTextMm == null){ activeScores.push(50); details.push('Base a Texto no disponible'); }
    else{
      const errB = res.text.baseTextMm - ref.baseTextMm;
      const sb = scorePart(errB,c.maxBaseText);
      activeScores.push(sb);
      details.push(`Base a Texto ${Math.round(sb)}% · ${fmt(res.text.baseTextMm)} mm vs ref ${fmt(ref.baseTextMm)} mm`);
    }
  }
  if(c.chkSize){
    const pctW = (res.patch.widthMm-ref.widthMm)/ref.widthMm*100;
    const pctH = (res.patch.heightMm-ref.heightMm)/ref.heightMm*100;
    const sW = scorePart(pctW,c.maxSizePct), sH=scorePart(pctH,c.maxSizePct);
    activeScores.push((sW+sH)/2);
    details.push(`Tamaño ${Math.round((sW+sH)/2)}% · W ${fmt(pctW)}% · H ${fmt(pctH)}%`);
  }
  if(c.chkShape){
    const pctA = (res.patch.areaMm2-ref.areaMm2)/ref.areaMm2*100;
    const pctP = (res.patch.perimeterMm-ref.perimeterMm)/ref.perimeterMm*100;
    const sA = scorePart(pctA,c.maxSizePct*1.2), sP=scorePart(pctP,c.maxSizePct*1.2);
    activeScores.push((sA+sP)/2);
    details.push(`Forma ${Math.round((sA+sP)/2)}% · Área ${fmt(pctA)}% · Perímetro ${fmt(pctP)}%`);
  }
  if(!activeScores.length){ activeScores=[100]; details.push('Sin criterios activos'); }
  const score = activeScores.reduce((a,b)=>a+b,0)/activeScores.length;
  const pass = score >= c.minScore;
  return {...res, score, pass, status: pass?'APROBADO':'RECHAZADO', details};
}
function displayResult(r, record){
  $('resultText').textContent = r.status || (r.pass?'APROBADO':'RECHAZADO');
  $('alignScore').textContent = `${Math.round(r.score)}%`;
  $('scoreStatus').textContent = `${Math.round(r.score)}%`;
  $('bigDecision').textContent = r.status || (r.pass?'APROBADO':'RECHAZADO');
  $('bigDecision').className = 'big-decision ' + (r.status==='REFERENCIA' ? 'idle' : (r.pass?'ok':'bad'));
  const patchSize = `${fmt(r.patch.widthMm/10,2)}×${fmt(r.patch.heightMm/10,2)} cm`;
  const base = r.text?.baseTextMm != null ? `${fmt(r.text.baseTextMm)} mm` : '--';
  const angle = r.text?.angle != null ? `${fmt(r.text.angle)}°` : '--';
  setReason(`${r.status || ''} · Score ${Math.round(r.score)}%. ${r.details.join(' | ')}. Parche ${patchSize}. Perímetro ${fmt(r.patch.perimeterMm/10,2)} cm. Área ${fmt(r.patch.areaMm2/100,2)} cm². Base a Texto ${base}. Texto ° ${angle}.`);
  if(record && r.status !== 'REFERENCIA') addLog(r);
}
function addLog(r){
  const row = {
    time: now(), result:r.pass?'APROBADO':'RECHAZADO', score:Math.round(r.score),
    base:r.text?.baseTextMm!=null?fmt(r.text.baseTextMm):'',
    tx:r.text?.centerXmm!=null?fmt(r.text.centerXmm - (state.reference?.text?.xMm||0)):'',
    angle:r.text?.angle!=null?fmt(r.text.angle):'',
    size:`${fmt(r.patch.widthMm/10,2)}×${fmt(r.patch.heightMm/10,2)}`,
    reason:r.details.join(' | ')
  };
  state.log.unshift(row); state.log = state.log.slice(0,500); saveJSON('v12_log', state.log);
}
function renderLog(){
  $('logBody').innerHTML = state.log.map(r=>`<tr><td>${r.time}</td><td class="${r.result==='APROBADO'?'okText':'badText'}">${r.result}</td><td>${r.score}%</td><td>${r.base}</td><td>${r.tx}</td><td>${r.angle}</td><td>${r.size}</td><td>${escapeHtml(r.reason)}</td></tr>`).join('');
}
function escapeHtml(s){ return String(s).replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }
function updateDiagnostic(){
  const mode = $('debugMode').value;
  if(mode==='patchWarp' && state.lastPatchWarp) drawDataURLToDiagnostic(state.lastPatchWarp);
  else if(mode==='textMask' && state.lastTextMask) drawDataURLToDiagnostic(state.lastTextMask);
  else if(mode==='cardWarp' && state.lastCard){ showCanvasOnDiagnostic(capture); }
  else showCanvasOnDiagnostic(capture);
}
function autoLoop(){
  if(state.auto && Date.now()-state.lastAutoTs > 900){
    const r = measure(false);
    state.lastAutoTs = Date.now();
    if(r){
      const visible = r.patch.areaMm2 > 50;
      if(visible && !state.autoLatch){ addLog(r); state.autoLatch=true; updateUI(); }
      if(!visible) state.autoLatch=false;
    } else state.autoLatch=false;
  }
  requestAnimationFrame(autoLoop);
}
requestAnimationFrame(autoLoop);
function exportCSV(){
  const head = 'Hora,Resultado,Score,Base a Texto,Texto X,Texto angulo,Tamano cm,Motivo\n';
  const body = state.log.map(r=>[r.time,r.result,r.score,r.base,r.tx,r.angle,r.size,`"${String(r.reason).replaceAll('"','""')}"`].join(',')).join('\n');
  const blob = new Blob([head+body],{type:'text/csv;charset=utf-8'});
  const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='historial_inspector_parches.csv'; a.click();
}

$('btnCamera').onclick = startCamera;
$('btnSwitchCam').onclick = switchCamera;
$('photoInput').onchange = (e)=>{ const f=e.target.files?.[0]; if(f) setPhotoFile(f); };
$('btnCalibrate').onclick = calibrateCard;
$('btnClearCal').onclick = ()=>{ state.pxPerMm=0; state.calibration=null; localStorage.removeItem('v12_pxPerMm'); localStorage.removeItem('v12_calibration'); updateUI(); toast('Calibración borrada'); };
$('btnReference').onclick = saveReference;
$('btnClearRef').onclick = ()=>{ state.reference=null; localStorage.removeItem('v12_reference'); updateUI(); toast('Referencia borrada'); };
$('btnMeasure').onclick = ()=>measure(true);
$('btnAuto').onclick = ()=>{ state.auto=!state.auto; $('btnAuto').dataset.active=String(state.auto); $('btnAuto').textContent='Auto: '+(state.auto?'ON':'OFF'); toast(state.auto?'Auto activo':'Auto detenido'); };
$('btnExport').onclick = exportCSV;
$('btnReset').onclick = ()=>{ state.log=[]; saveJSON('v12_log',state.log); updateUI(); toast('Conteo reiniciado'); };
$('debugMode').onchange = updateDiagnostic;
['minScore','maxTextX','maxTextY','maxBaseText','maxTextAngle','maxSizePct','chkText','chkBaseText','chkSize','chkShape'].forEach(id=>$(id).addEventListener('change',()=>{ if(state.lastResult) displayResult(scoreResult(state.lastResult,false), false); }));

updateUI();
setReason('Flujo: inicia cámara → detecta tarjeta 7×7/5×5 → retira tarjeta sin mover celular → toma referencia 100% → audita. Las guías del celular se dibujan siempre.');
