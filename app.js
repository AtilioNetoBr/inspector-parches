/* Inspector de Parches Pro v7
   Enfoque: calibración confiable con cuadro 5x5, medición métrica por homografía,
   perímetro real, tamaño X x X cm y validación de texto centrado contra bordes. */

const $ = (id) => document.getElementById(id);
const video = $('video');
const overlay = $('overlay');
const ctx = overlay.getContext('2d');
const capture = $('captureCanvas');
const capCtx = capture.getContext('2d', { willReadFrequently: true });
const debugCanvas = $('debugCanvas');
const debugCtx = debugCanvas.getContext('2d');

const MM_SCALE = 10;       // pixeles canónicos por milímetro para homografía
const PATCH_SCALE = 8;     // pixeles por milímetro para mostrar parche enderezado
const CALIB_MM = 50;       // cuadro negro real: 50 mm x 50 mm

let stream = null;
let cvReady = false;
let autoMode = false;
let overlayMode = null;
let manualCalibPts = [];
let Hdata = loadJSON('calibrationH', null);
let pxPerMm = Number(localStorage.getItem('pxPerMm') || 0);
let calibQuality = localStorage.getItem('calibQuality') || '';
let reference = loadJSON('patchReference', null);
let log = loadJSON('inspectionLogV7', []);
let peer = null;
let dataConn = null;
let mediaCall = null;
let lastAnalyzeTs = 0;
let pieceState = 'empty';
let stableCandidate = null;
let emptyFrames = 0;
let lastResult = null;

function loadJSON(key, fallback){
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
  catch { return fallback; }
}
function saveJSON(key, value){ localStorage.setItem(key, JSON.stringify(value)); }
function toast(msg, ms=2200){
  const t=$('toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(toast._timer); toast._timer=setTimeout(()=>t.classList.remove('show'),ms);
}
function setStatus(text, cls='idle'){
  $('statusBadge').textContent=text; $('statusBadge').className='badge '+cls;
}
function setCalibStatus(){
  if(Hdata && pxPerMm){
    $('calibBadge').textContent='Calibrado'; $('calibBadge').className='badge ok';
    $('scaleText').textContent = `${pxPerMm.toFixed(2)} px/mm`;
    $('calibQuality').textContent = calibQuality || 'OK';
  }else{
    $('calibBadge').textContent='Sin calibrar'; $('calibBadge').className='badge warn';
    $('scaleText').textContent='No calibrada'; $('calibQuality').textContent='--';
  }
  $('refText').textContent = reference ? `${reference.widthCm} × ${reference.heightCm} cm` : 'No tomada';
  updateSteps();
}
function updateSteps(){
  $('stepCamera').className = 'step ' + (stream ? 'done' : 'active');
  $('stepCalib').className = 'step ' + (Hdata ? 'done' : (stream ? 'active' : ''));
  $('stepRef').className = 'step ' + (reference ? 'done' : (Hdata ? 'active' : ''));
  $('stepAudit').className = 'step ' + (reference ? 'active' : '');
}
function cfg(){
  return {
    critText:$('critText').checked,
    critSize:$('critSize').checked,
    critArea:$('critArea').checked,
    critPerimeter:$('critPerimeter').checked,
    critAngle:$('critAngle').checked,
    tolText:+$('tolText').value || 2,
    tolSizePct:+$('tolSizePct').value || 3,
    tolAreaPct:+$('tolAreaPct').value || 6,
    tolPerimPct:+$('tolPerimPct').value || 4,
    tolAngle:+$('tolAngle').value || 25,
    textZoneStart:clamp((+$('textZoneStart').value || 55)/100, 0, .98),
    textZoneEnd:clamp((+$('textZoneEnd').value || 96)/100, .02, 1),
    sideIgnore:clamp((+$('sideIgnore').value || 4)/100, 0, .25)
  };
}
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
function round(n,d=2){ return Number.isFinite(n) ? Number(n).toFixed(d) : '--'; }
function pctDiff(a,b){ return b ? Math.abs((a-b)/b*100) : 999; }
function now(){ return new Date().toLocaleString(); }

window.addEventListener('load', () => {
  setCalibStatus(); renderLog(); bindEvents(); waitForOpenCv(); resizeCanvas();
});
function waitForOpenCv(){
  const timer = setInterval(()=>{
    if(window.__opencvReady && typeof cv !== 'undefined'){
      cvReady = true; clearInterval(timer); toast('OpenCV listo. Por fin alguien llegó a trabajar.');
    }
  }, 250);
}
function bindEvents(){
  $('btnStart').onclick=startCamera;
  $('btnCalibAuto').onclick=calibrateAuto5x5;
  $('btnCalibManual').onclick=startManualCalibration;
  $('btnReference').onclick=takeReference;
  $('btnMeasure').onclick=()=>{ const r=analyzeFrame(true); if(r) addLog(r); };
  $('btnAuto').onclick=toggleAuto;
  $('btnClearCalib').onclick=clearCalibration;
  $('btnClearRef').onclick=clearReference;
  $('btnExport').onclick=exportCSV;
  $('btnReset').onclick=resetLog;
  $('btnConnectMonitor').onclick=connectMonitor;
  window.addEventListener('resize', resizeCanvas);
  overlay.addEventListener('click', onOverlayClick);
}

async function startCamera(){
  if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; }
  const constraints = [
    {video:{facingMode:{exact:'environment'}, width:{ideal:1920}, height:{ideal:1080}}, audio:false},
    {video:{facingMode:{ideal:'environment'}, width:{ideal:1280}, height:{ideal:720}}, audio:false},
    {video:{width:{ideal:1280}, height:{ideal:720}}, audio:false},
    {video:true, audio:false}
  ];
  let lastErr = null;
  for(const c of constraints){
    try{
      stream = await navigator.mediaDevices.getUserMedia(c);
      video.srcObject = stream;
      await video.play();
      setStatus('Cámara activa','live'); resizeCanvas(); loop(); updateSteps();
      toast('Cámara iniciada');
      return;
    }catch(e){ lastErr = e; }
  }
  console.error(lastErr);
  setStatus('Error cámara','bad');
  toast('No se pudo abrir cámara. Revisa HTTPS, permisos y que otra app no la esté usando.', 4200);
}
function resizeCanvas(){
  const r = video.getBoundingClientRect();
  overlay.width = Math.max(1, Math.round(r.width * devicePixelRatio));
  overlay.height = Math.max(1, Math.round(r.height * devicePixelRatio));
  ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
  drawOverlay(lastResult);
}
function grabFrame(){
  const vw = video.videoWidth, vh = video.videoHeight;
  if(!vw || !vh) return false;
  capture.width = vw; capture.height = vh;
  capCtx.drawImage(video,0,0,vw,vh);
  return true;
}

function getHMat(){
  if(!Hdata) return null;
  return cv.matFromArray(3,3,cv.CV_64F,Hdata);
}
function transformPoint(pt){
  if(!Hdata) return null;
  const h=Hdata, x=pt.x, y=pt.y;
  const w = h[6]*x + h[7]*y + h[8];
  if(Math.abs(w) < 1e-9) return null;
  return {
    x:(h[0]*x + h[1]*y + h[2]) / w / MM_SCALE,
    y:(h[3]*x + h[4]*y + h[5]) / w / MM_SCALE
  };
}
function dist(a,b){ return Math.hypot(a.x-b.x, a.y-b.y); }
function polygonPerimeter(points){
  if(points.length < 2) return 0;
  let p=0; for(let i=0;i<points.length;i++) p += dist(points[i], points[(i+1)%points.length]);
  return p;
}
function polygonArea(points){
  let sum=0; for(let i=0;i<points.length;i++){ const a=points[i], b=points[(i+1)%points.length]; sum += a.x*b.y - b.x*a.y; }
  return Math.abs(sum)/2;
}
function orderQuad(pts){
  const p = pts.map(q=>({x:q.x,y:q.y}));
  const sum = p.map(q=>q.x+q.y), diff = p.map(q=>q.x-q.y);
  const tl = p[sum.indexOf(Math.min(...sum))];
  const br = p[sum.indexOf(Math.max(...sum))];
  const tr = p[diff.indexOf(Math.max(...diff))];
  const bl = p[diff.indexOf(Math.min(...diff))];
  return [tl,tr,br,bl];
}
function matContourToPoints(contour, step=1){
  const pts=[];
  const data = contour.data32S;
  for(let i=0;i<data.length;i+=2*step) pts.push({x:data[i], y:data[i+1]});
  return pts;
}
function matFromPoints32F(points){
  const arr=[]; points.forEach(p=>{ arr.push(p.x, p.y); });
  return cv.matFromArray(points.length, 1, cv.CV_32FC2, arr);
}
function safeDelete(...mats){ mats.forEach(m=>{ try{ if(m && typeof m.delete==='function') m.delete(); }catch{} }); }

function applyCalibration(corners, source='manual'){
  if(!cvReady){ toast('OpenCV aún no está listo. Qué sorpresa: la web también llega tarde.'); return false; }
  const ordered = orderQuad(corners);
  const sides = [dist(ordered[0],ordered[1]), dist(ordered[1],ordered[2]), dist(ordered[2],ordered[3]), dist(ordered[3],ordered[0])];
  const avgSide = sides.reduce((a,b)=>a+b,0)/4;
  const minSide = Math.min(...sides), maxSide = Math.max(...sides);
  const diag1 = dist(ordered[0],ordered[2]);
  const diag2 = dist(ordered[1],ordered[3]);
  const sideErr = (maxSide-minSide)/avgSide*100;
  const diagErr = Math.abs(diag1-diag2)/((diag1+diag2)/2)*100;
  if(avgSide < 80){ toast('El cuadro se ve muy pequeño. Acerca la cámara o usa más resolución.', 4200); return false; }
  pxPerMm = avgSide / CALIB_MM;
  const src = cv.matFromArray(4,1,cv.CV_32FC2, [
    ordered[0].x,ordered[0].y, ordered[1].x,ordered[1].y, ordered[2].x,ordered[2].y, ordered[3].x,ordered[3].y
  ]);
  const dst = cv.matFromArray(4,1,cv.CV_32FC2, [
    0,0, CALIB_MM*MM_SCALE,0, CALIB_MM*MM_SCALE,CALIB_MM*MM_SCALE, 0,CALIB_MM*MM_SCALE
  ]);
  const H = cv.getPerspectiveTransform(src,dst);
  Hdata = Array.from(H.data64F && H.data64F.length ? H.data64F : H.data32F);
  calibQuality = `${source}: lado ${round(avgSide,0)}px, error lados ${round(sideErr,1)}%, diag ${round(diagErr,1)}%`;
  localStorage.setItem('pxPerMm', String(pxPerMm));
  localStorage.setItem('calibQuality', calibQuality);
  saveJSON('calibrationH', Hdata);
  setCalibStatus();
  safeDelete(src,dst,H);
  drawCalibrationCorners(ordered, true);
  toast(`Calibración guardada: ${round(pxPerMm,2)} px/mm. Retira el cuadro sin mover el celular.`, 4200);
  return true;
}
function clearCalibration(){
  Hdata=null; pxPerMm=0; calibQuality=''; localStorage.removeItem('pxPerMm'); localStorage.removeItem('calibQuality'); localStorage.removeItem('calibrationH');
  setCalibStatus(); toast('Calibración borrada');
}
function clearReference(){
  reference=null; localStorage.removeItem('patchReference'); setCalibStatus(); toast('Referencia borrada');
}

function calibrateAuto5x5(){
  if(!cvReady) return toast('OpenCV aún está cargando.');
  if(!grabFrame()) return toast('Primero inicia cámara.');
  const found = findBlackSquareOnWhiteCard();
  if(found){
    applyCalibration(found.corners, `auto confianza ${found.score.toFixed(0)}`);
  }else{
    toast('No lo detecté con confianza. Usa “Calibrar 4 esquinas”: es el método serio cuando la luz se pone payasa.', 5200);
    overlayMode=null;
    drawOverlay(null);
  }
}

function findBlackSquareOnWhiteCard(){
  const src=cv.imread(capture), gray=new cv.Mat(), blur=new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray, blur, new cv.Size(5,5), 0);
  const frameArea = capture.width*capture.height;
  let candidates=[];
  const thresholds = ['otsu', 35, 50, 65, 80, 95, 110, 125, 140];
  for(const th of thresholds){
    const bin=new cv.Mat(), morph=new cv.Mat(), contours=new cv.MatVector(), hierarchy=new cv.Mat();
    if(th === 'otsu') cv.threshold(blur, bin, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
    else cv.threshold(blur, bin, th, 255, cv.THRESH_BINARY_INV);
    const kernel = cv.Mat.ones(5,5,cv.CV_8U);
    cv.morphologyEx(bin, morph, cv.MORPH_CLOSE, kernel);
    cv.morphologyEx(morph, morph, cv.MORPH_OPEN, kernel);
    cv.findContours(morph, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    for(let i=0;i<contours.size();i++){
      const c=contours.get(i);
      const area=cv.contourArea(c);
      if(area < frameArea*0.002 || area > frameArea*0.55){ c.delete(); continue; }
      const peri=cv.arcLength(c,true);
      const approx=new cv.Mat();
      cv.approxPolyDP(c, approx, Math.max(3, peri*0.025), true);
      if(approx.rows === 4 && cv.isContourConvex(approx)){
        const pts=[]; const d=approx.data32S;
        for(let k=0;k<d.length;k+=2) pts.push({x:d[k],y:d[k+1]});
        const ordered=orderQuad(pts);
        const sides=[dist(ordered[0],ordered[1]),dist(ordered[1],ordered[2]),dist(ordered[2],ordered[3]),dist(ordered[3],ordered[0])];
        const avg=sides.reduce((a,b)=>a+b,0)/4;
        const ratio=Math.min(...sides)/Math.max(...sides);
        const diagA=dist(ordered[0],ordered[2]), diagB=dist(ordered[1],ordered[3]);
        const diagRatio=Math.min(diagA,diagB)/Math.max(diagA,diagB);
        const rect=cv.boundingRect(approx);
        const blackMean = meanGrayInRect(gray, rect.x+rect.width*.18, rect.y+rect.height*.18, rect.width*.64, rect.height*.64);
        const outerMean = meanRingAround(gray, rect);
        const contrast = outerMean - blackMean;
        if(ratio > .72 && diagRatio > .78 && contrast > 35 && blackMean < 135){
          const score = area*ratio*diagRatio + contrast*500;
          candidates.push({corners:ordered, score, area, contrast, blackMean, outerMean});
        }
        approx.delete();
      }
      c.delete();
    }
    safeDelete(bin,morph,contours,hierarchy,kernel);
  }
  safeDelete(src,gray,blur);
  if(!candidates.length) return null;
  candidates.sort((a,b)=>b.score-a.score);
  drawCalibrationCorners(candidates[0].corners, false);
  return candidates[0];
}
function meanGrayInRect(gray, x,y,w,h){
  x=Math.max(0,Math.floor(x)); y=Math.max(0,Math.floor(y));
  w=Math.min(gray.cols-x, Math.max(1,Math.floor(w))); h=Math.min(gray.rows-y, Math.max(1,Math.floor(h)));
  const roi=gray.roi(new cv.Rect(x,y,w,h));
  const m=cv.mean(roi)[0]; roi.delete(); return m;
}
function meanRingAround(gray, rect){
  const pad = Math.max(8, Math.round(Math.min(rect.width,rect.height)*.18));
  const x=Math.max(0, rect.x-pad), y=Math.max(0, rect.y-pad);
  const x2=Math.min(gray.cols, rect.x+rect.width+pad), y2=Math.min(gray.rows, rect.y+rect.height+pad);
  const outer=meanGrayInRect(gray,x,y,x2-x,y2-y);
  const inner=meanGrayInRect(gray,rect.x,rect.y,rect.width,rect.height);
  return Math.max(outer, inner);
}
function startManualCalibration(){
  if(!stream) return toast('Primero inicia cámara.');
  if(!grabFrame()) return toast('No pude capturar imagen.');
  overlayMode='manualCalib'; manualCalibPts=[];
  $('instructions').innerHTML = '<strong>Calibración manual:</strong> toca las 4 esquinas del cuadro negro 5×5. Orden libre. Esta es la opción confiable para producción.';
  drawOverlay(null);
  toast('Toca las 4 esquinas del cuadro negro. Orden libre.', 4500);
}
function onOverlayClick(ev){
  if(overlayMode !== 'manualCalib') return;
  const rect=overlay.getBoundingClientRect();
  const x=(ev.clientX-rect.left)*capture.width/rect.width;
  const y=(ev.clientY-rect.top)*capture.height/rect.height;
  manualCalibPts.push({x,y});
  drawCalibrationCorners(manualCalibPts, false);
  if(manualCalibPts.length === 4){
    overlayMode=null;
    applyCalibration(manualCalibPts, 'manual 4 esquinas');
    $('instructions').innerHTML = '<strong>Calibración lista:</strong> retira el cuadro sin mover el celular. Ahora coloca una pieza buena y toma referencia aprobada.';
  }
}
function drawCalibrationCorners(pts, final=false){
  ctx.clearRect(0,0,overlay.clientWidth, overlay.clientHeight);
  const sx=overlay.clientWidth/capture.width, sy=overlay.clientHeight/capture.height;
  ctx.lineWidth=3; ctx.strokeStyle=final?'#1fd18a':'#ffd166'; ctx.fillStyle=ctx.strokeStyle; ctx.font='18px system-ui';
  pts.forEach((p,i)=>{
    const x=p.x*sx, y=p.y*sy;
    ctx.beginPath(); ctx.arc(x,y,8,0,Math.PI*2); ctx.fill(); ctx.fillText(String(i+1),x+10,y-10);
  });
  if(pts.length>=2){
    const q = pts.length===4 ? orderQuad(pts) : pts;
    ctx.beginPath(); q.forEach((p,i)=>{ const x=p.x*sx,y=p.y*sy; i?ctx.lineTo(x,y):ctx.moveTo(x,y); }); if(pts.length===4) ctx.closePath(); ctx.stroke();
  }
}

function detectPatchContour(src){
  const gray=new cv.Mat(), blur=new cv.Mat(), edges=new cv.Mat(), morph=new cv.Mat(), contours=new cv.MatVector(), hierarchy=new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray, blur, new cv.Size(5,5), 0);
  cv.Canny(blur, edges, 35, 120);
  const kernel=cv.Mat.ones(7,7,cv.CV_8U);
  cv.dilate(edges, morph, kernel);
  cv.morphologyEx(morph, morph, cv.MORPH_CLOSE, kernel);
  cv.findContours(morph, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  const frameArea = src.cols*src.rows;
  let best=null, bestArea=0;
  for(let i=0;i<contours.size();i++){
    const c=contours.get(i);
    const area=cv.contourArea(c);
    if(area > frameArea*0.006 && area < frameArea*0.85 && area > bestArea){
      if(best) best.delete();
      best=c; bestArea=area;
    }else c.delete();
  }
  safeDelete(gray,blur,edges,morph,contours,hierarchy,kernel);
  return best;
}

function analyzeFrame(record=false){
  if(!cvReady){ toast('OpenCV aún no está listo.'); return null; }
  if(!Hdata){ setDecision(null,'Primero calibra con el cuadro negro 5×5.'); return null; }
  if(!grabFrame()) return null;
  const src=cv.imread(capture);
  let contour=null, result=null;
  try{
    contour = detectPatchContour(src);
    if(!contour){ setDecision(null,'No encuentro el contorno del parche. Usa fondo sólido y separa objetos.'); drawOverlay(null); return null; }
    result = measurePatch(src, contour);
    result = evaluateResult(result);
    lastResult = result;
    setDecision(result);
    drawOverlay(result);
    drawDebug(result);
    $('lastText').textContent = new Date().toLocaleTimeString();
    sendMonitorData(result);
    return result;
  }catch(e){
    console.error(e); toast('Error midiendo. Revisa iluminación/fondo y vuelve a intentar.', 3500); return null;
  }finally{ safeDelete(src, contour); }
}

function measurePatch(src, contour){
  const rawPts = matContourToPoints(contour, 1);
  const metricPts = rawPts.map(transformPoint).filter(Boolean);
  if(metricPts.length < 8) throw new Error('No hay puntos métricos suficientes');
  const perimMm = polygonPerimeter(metricPts);
  const areaMm2 = polygonArea(metricPts);
  const metricMat = matFromPoints32F(metricPts);
  const mrect = cv.minAreaRect(metricMat);
  safeDelete(metricMat);
  let widthMm = Math.max(mrect.size.width, mrect.size.height);
  let heightMm = Math.min(mrect.size.width, mrect.size.height);
  const angle = normalizeAngle(mrect.angle, mrect.size.width, mrect.size.height);

  const patchImg = extractUprightPatch(src, contour, widthMm, heightMm);
  const text = detectTextInPatch(patchImg.canvas, widthMm, heightMm);

  return {
    found:true,
    widthMm, heightMm,
    widthCm:round(widthMm/10,2), heightCm:round(heightMm/10,2),
    perimeterMm:perimMm, perimeterCm:round(perimMm/10,2),
    areaMm2, areaCm2:round(areaMm2/100,2),
    angle,
    text,
    patchQuad: patchImg.originalQuad,
    reason:'Medición realizada'
  };
}
function normalizeAngle(angle,w,h){
  let a=angle;
  if(w<h) a=angle+90;
  if(a>45) a-=90;
  if(a<-45) a+=90;
  return a;
}
function extractUprightPatch(src, contour, widthMm, heightMm){
  const rect=cv.minAreaRect(contour);
  const pts=cv.RotatedRect.points(rect).map(p=>({x:p.x,y:p.y}));
  const q=orderQuad(pts);
  const outW=clamp(Math.round(widthMm*PATCH_SCALE),120,1200);
  const outH=clamp(Math.round(heightMm*PATCH_SCALE),120,1200);
  const srcTri=cv.matFromArray(4,1,cv.CV_32FC2,[q[0].x,q[0].y,q[1].x,q[1].y,q[2].x,q[2].y,q[3].x,q[3].y]);
  const dstTri=cv.matFromArray(4,1,cv.CV_32FC2,[0,0,outW,0,outW,outH,0,outH]);
  const M=cv.getPerspectiveTransform(srcTri,dstTri);
  const dst=new cv.Mat();
  cv.warpPerspective(src,dst,M,new cv.Size(outW,outH),cv.INTER_LINEAR,cv.BORDER_CONSTANT,new cv.Scalar(0,0,0,255));
  const canvas=document.createElement('canvas'); canvas.width=outW; canvas.height=outH;
  cv.imshow(canvas,dst);
  safeDelete(srcTri,dstTri,M,dst);
  return {canvas, originalQuad:q};
}
function detectTextInPatch(canvas, widthMm, heightMm){
  const c=cfg();
  const src=cv.imread(canvas), gray=new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  const W=gray.cols, H=gray.rows;
  const x0=Math.round(W*c.sideIgnore);
  const x1=Math.round(W*(1-c.sideIgnore));
  const y0=Math.round(H*c.textZoneStart);
  const y1=Math.round(H*c.textZoneEnd);
  const roiRect=new cv.Rect(x0,y0,Math.max(1,x1-x0),Math.max(1,y1-y0));
  const roi=gray.roi(roiRect);
  const bin=new cv.Mat(), morph=new cv.Mat(), contours=new cv.MatVector(), hierarchy=new cv.Mat();
  cv.GaussianBlur(roi, roi, new cv.Size(3,3), 0);
  cv.threshold(roi, bin, 0,255,cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
  const kernel=cv.Mat.ones(3,5,cv.CV_8U);
  cv.morphologyEx(bin, morph, cv.MORPH_OPEN, kernel);
  cv.morphologyEx(morph, morph, cv.MORPH_CLOSE, kernel);
  cv.findContours(morph, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  let boxes=[]; const roiArea=roiRect.width*roiRect.height;
  for(let i=0;i<contours.size();i++){
    const cnt=contours.get(i), area=cv.contourArea(cnt), r=cv.boundingRect(cnt);
    // Filtra polvo, bordes enormes y manchas. No es poesía: son números.
    if(area > roiArea*0.00015 && r.width > 3 && r.height > 3 && r.width < roiRect.width*.95 && r.height < roiRect.height*.75){
      boxes.push({x:r.x+x0,y:r.y+y0,w:r.width,h:r.height,area});
    }
    cnt.delete();
  }
  safeDelete(src,gray,roi,bin,morph,contours,hierarchy,kernel);
  if(!boxes.length){
    return {found:false, offsetMm:null, leftMm:null, rightMm:null, bbox:null, confidence:0, message:'No detecté texto en la zona configurada'};
  }
  // Unión de cajas relevantes: prioriza componentes de texto, no todo el ruido.
  const minX=Math.min(...boxes.map(b=>b.x));
  const minY=Math.min(...boxes.map(b=>b.y));
  const maxX=Math.max(...boxes.map(b=>b.x+b.w));
  const maxY=Math.max(...boxes.map(b=>b.y+b.h));
  const bbox={x:minX,y:minY,w:maxX-minX,h:maxY-minY};
  const centerX=bbox.x + bbox.w/2;
  const offsetMm=(centerX - W/2) / PATCH_SCALE;
  const leftMm=bbox.x / PATCH_SCALE;
  const rightMm=(W - bbox.x - bbox.w) / PATCH_SCALE;
  const coverage=boxes.reduce((a,b)=>a+b.area,0)/roiArea;
  return {found:true, offsetMm, leftMm, rightMm, bbox, confidence:clamp(coverage*1000,0,100), message:'Texto detectado'};
}

function evaluateResult(r){
  const c=cfg();
  const reasons=[];
  let pass=true;
  if(c.critText){
    if(!r.text.found){ pass=false; reasons.push('No detecté texto'); }
    else if(Math.abs(r.text.offsetMm) > c.tolText){
      pass=false; reasons.push(`Texto descentrado ${round(r.text.offsetMm,1)} mm`);
    }
  }
  if(c.critSize){
    if(!reference){ pass=false; reasons.push('No hay referencia para tamaño'); }
    else{
      const dw=pctDiff(r.widthMm, reference.widthMm), dh=pctDiff(r.heightMm, reference.heightMm);
      if(dw > c.tolSizePct || dh > c.tolSizePct){ pass=false; reasons.push(`Tamaño fuera: ancho ${round(dw,1)}%, alto ${round(dh,1)}%`); }
    }
  }
  if(c.critArea){
    if(!reference){ pass=false; reasons.push('No hay referencia para área'); }
    else{
      const da=pctDiff(r.areaMm2, reference.areaMm2);
      if(da > c.tolAreaPct){ pass=false; reasons.push(`Área fuera ${round(da,1)}%`); }
    }
  }
  if(c.critPerimeter){
    if(!reference){ pass=false; reasons.push('No hay referencia para perímetro'); }
    else{
      const dp=pctDiff(r.perimeterMm, reference.perimeterMm);
      if(dp > c.tolPerimPct){ pass=false; reasons.push(`Perímetro fuera ${round(dp,1)}%`); }
    }
  }
  if(c.critAngle && Math.abs(r.angle) > c.tolAngle){
    pass=false; reasons.push(`Giro excesivo ${round(r.angle,1)}°`);
  }
  r.pass=pass;
  r.reason = reasons.length ? reasons.join('; ') : 'Dentro de criterios activos';
  return r;
}
function setDecision(res, msg){
  if(!res){
    $('decision').textContent='ESPERANDO'; $('decision').className='decision neutral'; $('reason').textContent=msg || 'Esperando pieza.';
    $('mSize').textContent='--'; $('mPerimeter').textContent='--'; $('mArea').textContent='--'; $('mAngle').textContent='--'; $('mTextOffset').textContent='--'; $('mTextMargins').textContent='--';
    return;
  }
  $('decision').textContent=res.pass?'APROBADO':'RECHAZADO';
  $('decision').className='decision '+(res.pass?'ok':'bad');
  $('reason').textContent=res.reason;
  $('mSize').textContent=`${res.widthCm} × ${res.heightCm} cm`;
  $('mPerimeter').textContent=`${res.perimeterCm} cm`;
  $('mArea').textContent=`${res.areaCm2} cm²`;
  $('mAngle').textContent=`${round(res.angle,1)}°`;
  $('mTextOffset').textContent=res.text.found ? `${round(res.text.offsetMm,1)} mm` : 'No detectado';
  $('mTextMargins').textContent=res.text.found ? `${round(res.text.leftMm,1)} / ${round(res.text.rightMm,1)} mm` : '--';
}
function drawOverlay(res){
  ctx.clearRect(0,0,overlay.clientWidth,overlay.clientHeight);
  if(overlayMode === 'manualCalib'){
    drawCalibrationCorners(manualCalibPts,false);
    return;
  }
  if(!res || !res.patchQuad) return;
  const sx=overlay.clientWidth/capture.width, sy=overlay.clientHeight/capture.height;
  ctx.lineWidth=3; ctx.strokeStyle=res.pass?'#1fd18a':'#ff4d5e'; ctx.fillStyle=ctx.strokeStyle; ctx.font='17px system-ui';
  ctx.beginPath(); res.patchQuad.forEach((p,i)=>{ const x=p.x*sx,y=p.y*sy; i?ctx.lineTo(x,y):ctx.moveTo(x,y); }); ctx.closePath(); ctx.stroke();
  ctx.fillText(res.pass?'APROBADO':'RECHAZADO',18,30);
  ctx.fillText(`${res.widthCm} × ${res.heightCm} cm`,18,55);
}
function drawDebug(res){
  if(!res || !res.text || !res.text.bbox){
    debugCanvas.width=500; debugCanvas.height=260; debugCtx.clearRect(0,0,500,260); debugCtx.fillStyle='#9db0cc'; debugCtx.fillText('Sin vista de texto detectado',18,40); return;
  }
  // Reanaliza una copia visual desde el último frame para mostrar parche enderezado.
  if(!grabFrame()) return;
  const src=cv.imread(capture), contour=detectPatchContour(src);
  if(!contour){ safeDelete(src); return; }
  try{
    const patch=extractUprightPatch(src,contour,res.widthMm,res.heightMm).canvas;
    debugCanvas.width=patch.width; debugCanvas.height=patch.height;
    debugCtx.drawImage(patch,0,0);
    const W=patch.width, H=patch.height, b=res.text.bbox;
    debugCtx.lineWidth=3;
    debugCtx.strokeStyle='#58a6ff'; debugCtx.beginPath(); debugCtx.moveTo(W/2,0); debugCtx.lineTo(W/2,H); debugCtx.stroke();
    debugCtx.strokeStyle='#ffd166'; debugCtx.strokeRect(b.x,b.y,b.w,b.h);
    const textCenter=b.x+b.w/2;
    debugCtx.strokeStyle=res.pass?'#1fd18a':'#ff4d5e'; debugCtx.beginPath(); debugCtx.moveTo(textCenter,0); debugCtx.lineTo(textCenter,H); debugCtx.stroke();
  }finally{ safeDelete(src,contour); }
}

function takeReference(){
  const r=analyzeFrame(false);
  if(!r) return;
  reference={...r, time:now()};
  saveJSON('patchReference', reference);
  setCalibStatus();
  toast(`Referencia guardada: ${r.widthCm} × ${r.heightCm} cm, perímetro ${r.perimeterCm} cm`, 3600);
}
function addLog(r){
  const row={
    time:now(), result:r.pass?'APROBADO':'RECHAZADO', size:`${r.widthCm} × ${r.heightCm}`,
    perimeter:r.perimeterCm, area:r.areaCm2, text:r.text.found?round(r.text.offsetMm,1):'No detectado', reason:r.reason
  };
  log.unshift(row); log=log.slice(0,1000); saveJSON('inspectionLogV7',log); renderLog(); sendMonitorData(r);
}
function renderLog(){
  $('logBody').innerHTML=log.map(r=>`<tr><td>${escapeHtml(r.time)}</td><td>${escapeHtml(r.result)}</td><td>${escapeHtml(r.size)}</td><td>${escapeHtml(r.perimeter)}</td><td>${escapeHtml(r.area)}</td><td>${escapeHtml(r.text)}</td><td>${escapeHtml(r.reason)}</td></tr>`).join('');
  const ok=log.filter(r=>r.result==='APROBADO').length, bad=log.length-ok;
  $('okCount').textContent=ok; $('badCount').textContent=bad; $('totalCount').textContent=log.length; $('okPct').textContent=log.length?`${round(ok/log.length*100,1)}%`:'0%';
}
function escapeHtml(s){ return String(s).replace(/[&<>"]/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch])); }
function exportCSV(){
  const head='Hora,Resultado,Tamano_cm,Perimetro_cm,Area_cm2,Texto_offset_mm,Motivo\n';
  const body=log.map(r=>[r.time,r.result,r.size,r.perimeter,r.area,r.text,`"${String(r.reason).replaceAll('"','""')}"`].join(',')).join('\n');
  const blob=new Blob([head+body],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='historial_inspector_parches_v7.csv'; a.click();
}
function resetLog(){ log=[]; localStorage.removeItem('inspectionLogV7'); renderLog(); toast('Conteo reiniciado'); }

function toggleAuto(){
  autoMode=!autoMode;
  $('btnAuto').dataset.active=String(autoMode);
  $('btnAuto').textContent='Auto: '+(autoMode?'ON':'OFF');
  pieceState='empty'; stableCandidate=null; emptyFrames=0;
  toast(autoMode?'Modo automático activo':'Modo automático detenido');
}
function loop(){
  if(!stream) return;
  if(autoMode && Date.now()-lastAnalyzeTs > 420){
    lastAnalyzeTs = Date.now();
    const r=analyzeFrame(false);
    if(!r){
      emptyFrames++;
      if(emptyFrames >= 2){ pieceState='empty'; stableCandidate=null; }
    }else{
      emptyFrames=0;
      if(pieceState === 'empty'){
        if(!stableCandidate){ stableCandidate={r, n:1}; }
        else if(isStable(stableCandidate.r, r)){
          stableCandidate.r=r; stableCandidate.n++;
          if(stableCandidate.n >= 2){ addLog(r); pieceState='seen'; }
        }else stableCandidate={r,n:1};
      }
    }
  }
  requestAnimationFrame(loop);
}
function isStable(a,b){
  if(!a || !b) return false;
  const w=pctDiff(a.widthMm,b.widthMm), h=pctDiff(a.heightMm,b.heightMm), p=pctDiff(a.perimeterMm,b.perimeterMm);
  return w<2.5 && h<2.5 && p<3.5;
}

function connectMonitor(){
  const remoteId=$('monitorId').value.trim();
  if(!remoteId) return toast('Pega el ID del monitor de la PC.');
  if(!stream) return toast('Primero inicia la cámara.');
  if(typeof Peer === 'undefined') return toast('PeerJS no cargó. Revisa internet.');
  try{
    if(!peer) peer = new Peer();
    peer.on('open',()=>{
      dataConn = peer.connect(remoteId);
      dataConn.on('open',()=>{ $('monitorStatus').textContent='Datos conectados a PC.'; sendMonitorData(lastResult); });
      mediaCall = peer.call(remoteId, stream);
      $('monitorStatus').textContent='Transmitiendo a PC...';
      toast('Transmisión enviada a PC');
    });
    if(peer.open){
      dataConn = peer.connect(remoteId);
      dataConn.on('open',()=>{ $('monitorStatus').textContent='Datos conectados a PC.'; sendMonitorData(lastResult); });
      mediaCall = peer.call(remoteId, stream);
    }
  }catch(e){ console.error(e); toast('No se pudo conectar al monitor.'); }
}
function sendMonitorData(r){
  if(dataConn && dataConn.open){
    dataConn.send({type:'result', result:r ? {
      pass:r.pass, reason:r.reason, size:`${r.widthCm} × ${r.heightCm} cm`, perimeter:`${r.perimeterCm} cm`, area:`${r.areaCm2} cm²`, text:r.text?.found ? `${round(r.text.offsetMm,1)} mm` : 'No detectado', time:new Date().toLocaleTimeString()
    } : null, counts:{total:log.length, ok:log.filter(x=>x.result==='APROBADO').length}});
  }
}

setCalibStatus();
