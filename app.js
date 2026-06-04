// Inspector de Parches v17 Texto Centrado
// Objetivo: detectar parche como V9, detectar texto como bloque visual,
// y decidir principalmente por centrado del texto + Base a Texto contra maestro.

const $ = (id) => document.getElementById(id);
const video = $('video');
const overlay = $('overlay');
const ctx = overlay.getContext('2d');
const capture = $('capture');
const capCtx = capture.getContext('2d', { willReadFrequently:true });
const scratch = $('scratch');

const CARD_MM = 70;
const CARD_WARP = 700;
const INNER_START = 100;
const INNER_SIZE = 500;
const STORAGE = {
  cal:'ip_v17_calibration',
  master:'ip_v17_master',
  log:'ip_v17_log'
};

let stream = null;
let autoMode = false;
let lastAuto = 0;
let calibration = safeJson(localStorage.getItem(STORAGE.cal), null);
let master = safeJson(localStorage.getItem(STORAGE.master), null);
let log = safeJson(localStorage.getItem(STORAGE.log), []);
let lastOverlay = null;

init();

function init(){
  bind();
  waitForOpenCV();
  resizeOverlay();
  renderState();
  renderLog();
  window.addEventListener('resize', resizeOverlay);
}

function bind(){
  $('btnCamera').onclick = startCamera;
  $('btnCard').onclick = calibrateCard;
  $('btnMaster').onclick = saveMaster;
  $('btnMeasure').onclick = () => measure(true);
  $('btnAuto').onclick = toggleAuto;
  $('btnClearAll').onclick = clearAll;
  $('btnReset').onclick = () => { log=[]; localStorage.removeItem(STORAGE.log); renderLog(); toast('Conteo reiniciado'); };
  $('btnExport').onclick = exportCSV;
}

function safeJson(txt, fallback){ try{return txt?JSON.parse(txt):fallback;}catch{return fallback;} }
function toast(msg, ms=2200){ const t=$('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),ms); }
function cvReady(){ return !!(window.cv && cv.Mat && cv.imread); }
function waitForOpenCV(){
  const start = Date.now();
  const timer = setInterval(()=>{
    if(cvReady()){ $('cvBadge').textContent='OpenCV listo'; $('cvBadge').className='badge ok'; clearInterval(timer); }
    else if(Date.now()-start>15000){ $('cvBadge').textContent='OpenCV no cargó'; $('cvBadge').className='badge bad'; clearInterval(timer); }
  },250);
}
function cfg(){ return {
  lot:$('lot').value.trim() || 'Sin lote',
  accept:+$('acceptPct').value || 85,
  baseAccept:+$('baseAcceptPct').value || 85,
  centerAccept:+$('centerAcceptPct').value || 90,
  centerZeroMm:+$('centerZeroMm').value || 5,
  marginMm:+$('detMarginMm').value || 8,
  textY1:clamp((+$('textY1').value || 45)/100,0,0.95),
  textY2:clamp((+$('textY2').value || 94)/100,0.05,1),
  textSensitivity:+$('textSensitivity').value || 5,
  useSize:$('useSize').checked,
  useShape:$('useShape').checked
};}
function clamp(v,min,max){ return Math.max(min, Math.min(max,v)); }
function fmt(n,d=1){ return n==null || !Number.isFinite(n) ? '--' : Number(n).toFixed(d); }

async function startCamera(){
  if(stream) stream.getTracks().forEach(t=>t.stop());
  const attempts = [
    {video:{facingMode:{ideal:'environment'}, width:{ideal:1280}, height:{ideal:720}}, audio:false},
    {video:{facingMode:{ideal:'environment'}}, audio:false},
    {video:true, audio:false}
  ];
  let lastErr=null;
  for(const constraints of attempts){
    try{
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      await video.play();
      $('videoBox').classList.add('videoLive');
      $('camBadge').textContent='Cámara activa'; $('camBadge').className='badge ok';
      setStep(1);
      resizeOverlay();
      requestAnimationFrame(loop);
      toast('Cámara iniciada');
      return;
    }catch(e){ lastErr=e; }
  }
  console.error(lastErr);
  $('camBadge').textContent='Cámara bloqueada'; $('camBadge').className='badge bad';
  setDecision('NO CÁMARA','warn', explainCameraError(lastErr));
}
function explainCameraError(e){
  if(location.protocol !== 'https:' && location.hostname !== 'localhost') return 'La cámara requiere HTTPS. Abre desde GitHub Pages.';
  if(e?.name==='NotAllowedError') return 'Permiso bloqueado. En Safari permite cámara para este sitio.';
  if(e?.name==='NotReadableError') return 'Cámara ocupada por otra app. Cierra Cámara/WhatsApp/Instagram.';
  return 'No se pudo abrir cámara.';
}

function grabFrame(){
  if(!video.videoWidth || !video.videoHeight) return false;
  capture.width = video.videoWidth;
  capture.height = video.videoHeight;
  capCtx.drawImage(video,0,0,capture.width,capture.height);
  return true;
}
function resizeOverlay(){
  const r=overlay.getBoundingClientRect(); const dpr=window.devicePixelRatio || 1;
  overlay.width = Math.max(1,Math.round(r.width*dpr));
  overlay.height = Math.max(1,Math.round(r.height*dpr));
  ctx.setTransform(dpr,0,0,dpr,0,0);
  drawOverlay(lastOverlay);
}
function loop(){
  if(autoMode && Date.now()-lastAuto>900){
    const r = measure(false);
    if(r && (r.status==='APROBADO' || r.status==='RECHAZADO')) lastAuto=Date.now();
  }
  if(stream) requestAnimationFrame(loop);
}
function toggleAuto(){
  autoMode=!autoMode;
  $('btnAuto').textContent='Auto: '+(autoMode?'ON':'OFF');
  toast(autoMode?'Auto activo':'Auto detenido');
}
function setStep(n){
  [1,2,3,4].forEach(i=>{ const el=$('s'+i); el.className='step'+(i<n?' done':i===n?' active':''); });
}

// ===================== CALIBRACIÓN FICHA =====================
function calibrateCard(){
  if(!cvReady()){ toast('OpenCV aún carga'); return; }
  if(!grabFrame()){ toast('Primero inicia cámara'); return; }
  const src=cv.imread(capture);
  let det=null;
  try{
    det = detectCard7x7(src);
    if(!det || det.confidence<76){
      const msg = det ? `Ficha débil ${det.confidence.toFixed(0)}%. Ajusta luz/posición.` : 'No detecté la ficha 7×7.';
      setDecision('NO MEDIBLE','no',msg);
      drawOverlay(det ? {imageSize:{w:capture.width,h:capture.height}, shapes:det.shapes} : null);
      toast(msg);
      return;
    }
    calibration = {
      createdAt:new Date().toISOString(),
      hImgToMm: det.hImgToMm,
      hMmToImg: det.hMmToImg,
      quad: det.quad,
      pxPerMm: det.pxPerMm,
      confidence: det.confidence,
      innerContrast: det.validation.contrast,
      imageSize:{w:capture.width,h:capture.height}
    };
    localStorage.setItem(STORAGE.cal, JSON.stringify(calibration));
    setDecision('FICHA OK','ok',`Confianza ${det.confidence.toFixed(0)}%. Retira ficha sin mover celular y coloca el maestro.`);
    drawOverlay({imageSize:{w:capture.width,h:capture.height}, shapes:det.shapes});
    renderState();
    setStep(3);
    toast('Ficha calibrada');
  }finally{ src.delete(); }
}

function detectCard7x7(src){
  const W=src.cols, H=src.rows;
  let gray=new cv.Mat(), blur=new cv.Mat();
  cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray,blur,new cv.Size(5,5),0);
  let best=null;
  const thresholds=[120,135,150,165,180,195,210,225];
  for(const t of thresholds){
    let mask=new cv.Mat(), clean=new cv.Mat(), contours=new cv.MatVector(), hierarchy=new cv.Mat();
    try{
      cv.threshold(blur,mask,t,255,cv.THRESH_BINARY);
      const k1=cv.Mat.ones(9,9,cv.CV_8U), k2=cv.Mat.ones(3,3,cv.CV_8U);
      cv.morphologyEx(mask,clean,cv.MORPH_CLOSE,k1);
      cv.morphologyEx(clean,clean,cv.MORPH_OPEN,k2);
      k1.delete(); k2.delete();
      cv.findContours(clean,contours,hierarchy,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
      for(let i=0;i<contours.size();i++){
        const c=contours.get(i);
        const cand=scoreCardCandidate(src,c,t);
        if(cand && (!best || cand.score>best.score)) best=cand;
        c.delete();
      }
    }finally{ mask.delete(); clean.delete(); contours.delete(); hierarchy.delete(); }
  }
  gray.delete(); blur.delete();
  return best;
}
function scoreCardCandidate(src, contour, threshold){
  const imgArea=src.cols*src.rows;
  const area=cv.contourArea(contour);
  if(area<imgArea*0.015 || area>imgArea*0.80) return null;
  const peri=cv.arcLength(contour,true);
  let approx=new cv.Mat();
  let pts=null;
  try{
    for(const eps of [0.015,0.022,0.030,0.042,0.055]){
      cv.approxPolyDP(contour,approx,peri*eps,true);
      if(approx.rows===4 && cv.isContourConvex(approx)){ pts=matToPoints(approx); break; }
    }
  }finally{ approx.delete(); }
  if(!pts) return null;
  const quad=orderQuad(pts);
  const sides=sideLengths(quad); const sideRatio=Math.min(...sides)/Math.max(...sides);
  if(sideRatio<0.46) return null;
  const warp=warpQuad(src,quad,CARD_WARP,CARD_WARP);
  const validation=validateCardWarp(warp);
  drawMat(warp,'debugPatchMask');
  warp.delete();
  const areaScore=clamp(Math.sqrt(area/imgArea)*4,0,1);
  const shapeScore=clamp(sideRatio,0,1);
  const center=polyCenter(quad);
  const centerScore=1-clamp(Math.hypot(center.x-src.cols/2,center.y-src.rows/2)/Math.hypot(src.cols/2,src.rows/2),0,1);
  const confidence=clamp(validation.score*72 + shapeScore*12 + areaScore*8 + centerScore*8,0,100);
  const hImgToMm=homographyArray(quad,[{x:0,y:0},{x:70,y:0},{x:70,y:70},{x:0,y:70}]);
  const hMmToImg=homographyArray([{x:0,y:0},{x:70,y:0},{x:70,y:70},{x:0,y:70}],quad);
  const innerGeom=[{x:10,y:10},{x:60,y:10},{x:60,y:60},{x:10,y:60}].map(p=>transformPoint(hMmToImg,p.x,p.y));
  const pxPerMm = sides.reduce((a,b)=>a+b,0)/sides.length/70;
  return {score:confidence, confidence, quad, hImgToMm, hMmToImg, pxPerMm, validation, threshold, shapes:[
    {type:'poly', pts:quad, color:'#21d18b', label:'Ficha 7×7'},
    {type:'poly', pts:innerGeom, color:'#ffd166', label:'5×5 geométrico'}
  ]};
}
function validateCardWarp(warp){
  let gray=new cv.Mat(); cv.cvtColor(warp,gray,cv.COLOR_RGBA2GRAY);
  const inner=gray.roi(new cv.Rect(INNER_START,INNER_START,INNER_SIZE,INNER_SIZE));
  const top=gray.roi(new cv.Rect(120,35,460,45));
  const bottom=gray.roi(new cv.Rect(120,620,460,45));
  const left=gray.roi(new cv.Rect(35,120,45,460));
  const right=gray.roi(new cv.Rect(620,120,45,460));
  const innerMean=cv.mean(inner)[0];
  const borderMean=(cv.mean(top)[0]+cv.mean(bottom)[0]+cv.mean(left)[0]+cv.mean(right)[0])/4;
  const contrast=borderMean-innerMean;
  const contrastScore=clamp(contrast/90,0,1);
  const borderScore=clamp((borderMean-120)/100,0,1);
  const innerScore=clamp((180-innerMean)/120,0,1);
  const score=contrastScore*.48 + borderScore*.28 + innerScore*.24;
  inner.delete(); top.delete(); bottom.delete(); left.delete(); right.delete(); gray.delete();
  return {score, innerMean, borderMean, contrast};
}

// ===================== DETECCIÓN PATCH =====================
function saveMaster(){
  if(!calibration){ toast('Primero calibra ficha'); return; }
  const res = analyzePatch({forMaster:true});
  if(!res || res.status==='NO_MEDIBLE'){ toast(res?.reason || 'No detecté parche maestro'); return; }
  if(!res.text?.found){ toast('No detecté texto. Ajusta zona texto antes de guardar maestro.'); return; }
  const marginPx = mmToApproxPx(cfg().marginMm);
  const detectionRect = expandRect(res.patch.imageRect, marginPx, capture.width, capture.height);
  master = {
    createdAt:new Date().toISOString(),
    patch:{widthMm:res.patch.widthMm,heightMm:res.patch.heightMm,areaMm2:res.patch.areaMm2,perimeterMm:res.patch.perimeterMm},
    text:{baseToTextMm:res.text.baseToTextMm, centerXNorm:res.text.centerXNorm, centerYNorm:res.text.centerYNorm, centerOffsetMm:(res.text.centerXNorm-0.5)*res.patch.widthMm, angleDeg:res.text.angleDeg},
    detectionRect,
    imageSize:{w:capture.width,h:capture.height}
  };
  localStorage.setItem(STORAGE.master, JSON.stringify(master));
  renderState();
  setStep(4);
  setDecision('MAESTRO OK','ok','Zona aprendida guardada. Ahora mide piezas dentro de esa zona.');
  drawOverlay(res.overlay);
  toast('Maestro 100% guardado');
}
function measure(record){
  const res = analyzePatch({forMaster:false});
  if(!res){ return null; }
  renderResult(res);
  drawOverlay(res.overlay);
  if(record) addLog(res);
  return res;
}
function analyzePatch({forMaster=false}={}){
  if(!cvReady()){ toast('OpenCV aún carga'); return null; }
  if(!calibration){ setDecision('NO MEDIBLE','no','Falta calibrar ficha 7×7.'); return {status:'NO_MEDIBLE',reason:'Falta calibrar ficha'}; }
  if(!grabFrame()){ toast('No hay imagen'); return null; }
  const src=cv.imread(capture);
  let output=null;
  try{
    const roi = choosePatchROI(capture.width,capture.height,forMaster);
    const det = detectPatchClean(src, roi, forMaster);
    if(!det){
      output = noMedible('No encontré silueta clara del parche.', roi);
      return output;
    }
    if(det.touchesRoi && !forMaster){
      output = noMedible('Parche fuera de zona o tocando el borde del detector aprendido.', roi, det.overlayShapes);
      return output;
    }
    const text = detectTextBlock(src, det);
    if(det.patchWarp){ det.patchWarp.delete(); det.patchWarp = null; }
    const evaluation = evaluate(det, text, forMaster);
    const shapes = [
      {type:'rect', rect:roi, color:'rgba(180,190,210,.9)', label: forMaster?'Zona búsqueda maestro':'Zona aprendida'},
      ...det.overlayShapes,
      ...(text?.shapes || [])
    ];
    output = {status:evaluation.status, pass:evaluation.pass, reason:evaluation.reason, masterScore:evaluation.masterScore, baseScore:evaluation.baseScore, patch:det, text, overlay:{imageSize:{w:capture.width,h:capture.height}, shapes}};
    return output;
  }finally{ src.delete(); }
}
function noMedible(reason, roi=null, moreShapes=[]){
  return {status:'NO_MEDIBLE', pass:false, reason, overlay:{imageSize:{w:capture.width,h:capture.height}, shapes:[...(roi?[{type:'rect',rect:roi,color:'#ffd166',label:'Zona de búsqueda'}]:[]), ...moreShapes]}};
}
function choosePatchROI(w,h,forMaster){
  if(!forMaster && master?.detectionRect){
    return clampRect(master.detectionRect,w,h);
  }
  // Antes de tener maestro, buscamos en una zona cercana a donde estuvo la ficha.
  const b = rectFromPoints(calibration.quad);
  return expandRect(b, Math.max(b.w,b.h)*0.65, w, h);
}
function detectPatchClean(src, roi, forMaster){
  const roiMat = src.roi(new cv.Rect(roi.x,roi.y,roi.w,roi.h));
  const candidates=[];
  try{
    // Método A: objeto claro sobre fondo oscuro. Es el principal.
    candidates.push(...patchCandidatesByWhiteMask(roiMat, roi, src));
    // Método B: bordes tipo V9. Respaldo cuando el blanco no es uniforme.
    candidates.push(...patchCandidatesByCanny(roiMat, roi, src));
  }finally{ roiMat.delete(); }
  if(!candidates.length) return null;
  candidates.sort((a,b)=>b.score-a.score);
  const best=candidates[0];
  drawMat(best.debugMask,'debugPatchMask');
  candidates.forEach((c,i)=>{
    if(i!==0){
      if(c.debugMask) c.debugMask.delete();
      if(c.contour) c.contour.delete();
    }
  });
  // Mantener debug del ganador hasta dibujar, luego borrar.
  const result = buildPatchResult(src,best,roi,forMaster);
  if(best.debugMask) best.debugMask.delete();
  return result;
}
function patchCandidatesByWhiteMask(roiMat, roi, src){
  const out=[];
  let gray=new cv.Mat(), blur=new cv.Mat(), eq=new cv.Mat();
  cv.cvtColor(roiMat,gray,cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray,blur,new cv.Size(5,5),0);
  try{ cv.equalizeHist(blur,eq); }catch{ blur.copyTo(eq); }
  const thresholds=[80,95,110,125,140,155,170,185,200];
  for(const t of thresholds){
    let mask=new cv.Mat(), clean=new cv.Mat(), contours=new cv.MatVector(), hierarchy=new cv.Mat();
    try{
      cv.threshold(eq,mask,t,255,cv.THRESH_BINARY);
      const kClose=cv.Mat.ones(13,13,cv.CV_8U);
      const kOpen=cv.Mat.ones(3,3,cv.CV_8U);
      cv.morphologyEx(mask,clean,cv.MORPH_CLOSE,kClose);
      cv.morphologyEx(clean,clean,cv.MORPH_OPEN,kOpen);
      kClose.delete(); kOpen.delete();
      cv.findContours(clean,contours,hierarchy,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
      extractPatchCandidates(contours, roi, src, out, clean, 'white', t);
    }finally{ mask.delete(); clean.delete(); contours.delete(); hierarchy.delete(); }
  }
  gray.delete(); blur.delete(); eq.delete();
  return out;
}
function patchCandidatesByCanny(roiMat, roi, src){
  const out=[];
  let gray=new cv.Mat(), blur=new cv.Mat(), edges=new cv.Mat(), clean=new cv.Mat(), contours=new cv.MatVector(), hierarchy=new cv.Mat();
  try{
    cv.cvtColor(roiMat,gray,cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray,blur,new cv.Size(5,5),0);
    cv.Canny(blur,edges,35,130);
    const k=cv.Mat.ones(7,7,cv.CV_8U);
    cv.morphologyEx(edges,clean,cv.MORPH_CLOSE,k);
    k.delete();
    cv.findContours(clean,contours,hierarchy,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
    extractPatchCandidates(contours, roi, src, out, clean, 'canny', 0);
  }finally{ gray.delete(); blur.delete(); edges.delete(); clean.delete(); contours.delete(); hierarchy.delete(); }
  return out;
}
function extractPatchCandidates(contours, roi, src, out, debugMask, method, threshold){
  const roiArea=roi.w*roi.h;
  for(let i=0;i<contours.size();i++){
    const c=contours.get(i);
    const area=cv.contourArea(c);
    if(area<roiArea*0.006 || area>roiArea*0.72){ c.delete(); continue; }
    const r=cv.boundingRect(c);
    if(r.width<roi.w*0.08 || r.height<roi.h*0.08){ c.delete(); continue; }
    const touches = r.x<=2 || r.y<=2 || (r.x+r.width)>=roi.w-2 || (r.y+r.height)>=roi.h-2;
    const rect=cv.minAreaRect(c);
    const fill=area/Math.max(1,rect.size.width*rect.size.height);
    const center={x:roi.x+r.x+r.width/2,y:roi.y+r.y+r.height/2};
    const masterScore = master ? scoreCandidateVsMaster(r, roi, area, rect, center) : 50;
    const centerScore = 1 - clamp(Math.hypot(center.x-(roi.x+roi.w/2),center.y-(roi.y+roi.h/2))/Math.hypot(roi.w/2,roi.h/2),0,1);
    const touchPenalty = touches ? 0.45 : 1;
    const methodBonus = method==='white'?1.15:0.95;
    const score = (area/roiArea*80 + fill*45 + centerScore*25 + masterScore) * touchPenalty * methodBonus;
    const cloned = new cv.Mat(); c.copyTo(cloned);
    out.push({contour:cloned, area, rect, roiRect:r, fill, center, score, method, threshold, touchesRoi:touches, debugMask:debugMask.clone()});
    c.delete();
  }
}
function scoreCandidateVsMaster(r, roi, area, rect, center){
  if(!master) return 50;
  const wRatio = Math.min(r.width, master.detectionRect.w)/Math.max(r.width, master.detectionRect.w);
  const hRatio = Math.min(r.height, master.detectionRect.h)/Math.max(r.height, master.detectionRect.h);
  const mc={x:master.detectionRect.x+master.detectionRect.w/2,y:master.detectionRect.y+master.detectionRect.h/2};
  const distNorm = Math.hypot(center.x-mc.x,center.y-mc.y)/Math.hypot(master.detectionRect.w/2,master.detectionRect.h/2);
  return clamp((wRatio+hRatio)/2*60 + (1-clamp(distNorm,0,1))*40,0,100);
}
function buildPatchResult(src, cand, roi, forMaster){
  const contourPts = contourToPoints(cand.contour, roi.x, roi.y, 2);
  const rrPts = rotatedRectPoints(cand.rect).map(p=>({x:p.x+roi.x,y:p.y+roi.y}));
  const box = orientPatchBox(orderQuad(rrPts));
  const mmPts = contourPts.map(p=>transformPoint(calibration.hImgToMm,p.x,p.y)).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
  const areaMm2 = Math.abs(polygonArea(mmPts));
  const perimeterMm = polygonPerimeter(mmPts);
  const mmBox = box.map(p=>transformPoint(calibration.hImgToMm,p.x,p.y));
  const widthMm=(dist(mmBox[0],mmBox[1])+dist(mmBox[3],mmBox[2]))/2;
  const heightMm=(dist(mmBox[0],mmBox[3])+dist(mmBox[1],mmBox[2]))/2;
  const angleDeg = normalizeRectAngle(cand.rect.angle,cand.rect.size.width,cand.rect.size.height);
  const outW=Math.max(100,Math.round((dist(box[0],box[1])+dist(box[3],box[2]))/2));
  const outH=Math.max(100,Math.round((dist(box[0],box[3])+dist(box[1],box[2]))/2));
  const patchWarp=warpQuad(src,box,outW,outH);
  drawMat(patchWarp,'debugPatchWarp');
  const imageRect = rectFromPoints(box);
  const shapes=[
    {type:'poly', pts:contourPts, color:'#21d18b', label:'PATCH silueta'},
    {type:'poly', pts:box, color:'#ffd166', label:'PATCH box'},
    {type:'cross', x:cand.center.x, y:cand.center.y, color:'#58a6ff', label:'centro'}
  ];
  cand.contour.delete();
  return {widthMm,heightMm,areaMm2,perimeterMm,angleDeg,box,contourPts,center:cand.center,imageRect,patchWarp,outW,outH,overlayShapes:shapes,touchesRoi:cand.touchesRoi,method:cand.method};
}
function orientPatchBox(box){
  // Queremos una pieza vertical cuando aplique. El texto se espera hacia la parte baja.
  const w=dist(box[0],box[1]);
  const h=dist(box[1],box[2]);
  if(w>h) return [box[1],box[2],box[3],box[0]];
  return box;
}

// ===================== TEXTO / BASE A TEXTO =====================
function detectTextBlock(src, patch){
  const c=cfg();
  const W=patch.outW, H=patch.outH;
  const y1=Math.floor(H*Math.min(c.textY1,c.textY2-0.02));
  const y2=Math.floor(H*Math.max(c.textY2,c.textY1+0.02));
  const roiRect=new cv.Rect(0,y1,W,Math.max(1,y2-y1));
  let roi=patch.patchWarp.roi(roiRect), gray=new cv.Mat(), blur=new cv.Mat();
  let best=null;
  try{
    cv.cvtColor(roi,gray,cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray,blur,new cv.Size(3,3),0);
    const modes=[cv.THRESH_BINARY_INV, cv.THRESH_BINARY];
    for(const mode of modes){
      let bin=new cv.Mat(), morph=new cv.Mat(), contours=new cv.MatVector(), hierarchy=new cv.Mat();
      try{
        // C ajustado por sensibilidad: sensibilidad alta detecta más tinta.
        const C = 11 - c.textSensitivity;
        cv.adaptiveThreshold(blur,bin,255,cv.ADAPTIVE_THRESH_GAUSSIAN_C,mode,31,C);
        const kClose=cv.Mat.ones(5,19,cv.CV_8U);
        const kOpen=cv.Mat.ones(2,2,cv.CV_8U);
        cv.morphologyEx(bin,morph,cv.MORPH_CLOSE,kClose);
        cv.morphologyEx(morph,morph,cv.MORPH_OPEN,kOpen);
        kClose.delete(); kOpen.delete();
        cv.findContours(morph,contours,hierarchy,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
        const boxes=[];
        for(let i=0;i<contours.size();i++){
          const cnt=contours.get(i); const area=cv.contourArea(cnt); const r=cv.boundingRect(cnt); cnt.delete();
          if(area<W*H*0.00008) continue;
          if(r.width<W*0.04 || r.height<H*0.006) continue;
          if(r.width/r.height<1.15) continue;
          if(r.width>W*0.96 || r.height>H*0.40) continue;
          boxes.push({x:r.x,y:r.y+y1,w:r.width,h:r.height,area});
        }
        const u=unionBoxes(boxes);
        if(u){
          const score = (u.w/W)*45 + (boxes.length*5) + ((u.y/H)>0.45?20:0) - (u.h/H)*15;
          if(!best || score>best.score){ if(best?.mask) best.mask.delete(); best={box:u,score,mask:morph.clone(),mode}; }
        }
      }finally{ bin.delete(); morph.delete(); contours.delete(); hierarchy.delete(); }
    }
  }finally{ roi.delete(); gray.delete(); blur.delete(); }
  if(!best) return {found:false};
  drawMat(best.mask,'debugTextMask');
  const b=best.box;
  const baseToTextMm = (H - (b.y+b.h)) * (patch.heightMm / H);
  const centerXNorm=(b.x+b.w/2)/W, centerYNorm=(b.y+b.h/2)/H;
  const textPoly=projectWarpRectToImage(b, patch.box, W, H);
  const baseLine=projectWarpLineToImage({x:b.x+b.w/2,y:b.y+b.h},{x:b.x+b.w/2,y:H},patch.box,W,H);
  best.mask.delete();
  const patchCenterLine=projectWarpLineToImage({x:W/2,y:0},{x:W/2,y:H},patch.box,W,H);
  const textCenterLine=projectWarpLineToImage({x:b.x+b.w/2,y:b.y},{x:b.x+b.w/2,y:b.y+b.h},patch.box,W,H);
  const centerOffsetMm = (centerXNorm - 0.5) * patch.widthMm;
  return {found:true,baseToTextMm,centerXNorm,centerYNorm,centerOffsetMm,box:b,poly:textPoly,baseLine,patchCenterLine,textCenterLine,shapes:[
    {type:'poly', pts:textPoly, color:'#ffb000', label:'TEXT box'},
    {type:'line', x1:patchCenterLine[0].x,y1:patchCenterLine[0].y,x2:patchCenterLine[1].x,y2:patchCenterLine[1].y,color:'#58a6ff',label:'centro parche'},
    {type:'line', x1:textCenterLine[0].x,y1:textCenterLine[0].y,x2:textCenterLine[1].x,y2:textCenterLine[1].y,color:'#ff5263',label:'centro texto'},
    {type:'line', x1:baseLine[0].x,y1:baseLine[0].y,x2:baseLine[1].x,y2:baseLine[1].y,color:'#9d7cff',label:'Base a Texto'}
  ]};
}

// ===================== EVALUACIÓN =====================
function evaluate(patch,text,forMaster){
  if(forMaster) return {status:'MAESTRO', pass:true, reason:'Maestro detectado', masterScore:100, baseScore:100, centerScore:100, centerErrMm:0};
  if(!master) return {status:'NO_MEDIBLE', pass:false, reason:'Falta guardar maestro 100%.', masterScore:null, baseScore:null, centerScore:null, centerErrMm:null};
  if(!text?.found) return {status:'NO_MEDIBLE', pass:false, reason:'No detecté el bloque de texto.', masterScore:0, baseScore:null, centerScore:null, centerErrMm:null};
  const c=cfg();

  // Prioridad 1: texto centrado. El ideal NO depende de que el maestro haya quedado chueco:
  // el centro del texto debe acercarse al centro real del parche = 50%.
  const centerErrMm = (text.centerXNorm - 0.5) * patch.widthMm;
  const centerScore = clamp(100 - (Math.abs(centerErrMm) / Math.max(0.1, c.centerZeroMm)) * 100, 0, 100);

  // Prioridad 2: altura Base a Texto contra la muestra maestra.
  const baseScore=similarity(text.baseToTextMm, master.text.baseToTextMm);

  // Secundarios: solo entran si el usuario los activa. No deben mandar sobre el texto.
  const widthScore=similarity(patch.widthMm, master.patch.widthMm);
  const heightScore=similarity(patch.heightMm, master.patch.heightMm);
  const areaScore=similarity(patch.areaMm2, master.patch.areaMm2);
  const perimScore=similarity(patch.perimeterMm, master.patch.perimeterMm);

  let weighted = centerScore*0.70 + baseScore*0.30;
  let weight = 1.0;
  if(c.useSize){ weighted += (widthScore*0.5 + heightScore*0.5)*0.08; weight += 0.08; }
  if(c.useShape){ weighted += (areaScore*0.5 + perimScore*0.5)*0.06; weight += 0.06; }
  const masterScore = Math.round(weighted / weight);

  const reasons=[];
  let pass=true;
  if(centerScore < c.centerAccept){ pass=false; reasons.push(`Texto centrado ${centerScore.toFixed(0)}%, mínimo ${c.centerAccept}% (${centerErrMm>0?'derecha':'izquierda'} ${Math.abs(centerErrMm).toFixed(1)} mm)`); }
  if(baseScore < c.baseAccept){ pass=false; reasons.push(`Base a Texto ${baseScore.toFixed(0)}%, mínimo ${c.baseAccept}%`); }
  if(masterScore < c.accept){ pass=false; reasons.push(`Score final ${masterScore.toFixed(0)}%, mínimo ${c.accept}%`); }
  if(c.useSize && (widthScore<70 || heightScore<70)){ pass=false; reasons.push('Tamaño muy diferente al maestro'); }
  if(c.useShape && (areaScore<70 || perimScore<70)){ pass=false; reasons.push('Área/perímetro diferente al maestro'); }

  return {
    status:pass?'APROBADO':'RECHAZADO',
    pass,
    reason:reasons.join('; ') || `Centrado ${centerScore.toFixed(0)}%, Base a Texto ${baseScore.toFixed(0)}%`,
    masterScore,
    baseScore,
    centerScore,
    centerErrMm,
    widthScore,
    heightScore,
    areaScore,
    perimScore
  };
}
function renderResult(res){
  const ev = res.patch ? evaluate(res.patch,res.text,false) : {status:res.status, reason:res.reason};
  setDecision(ev.status, ev.status==='APROBADO'?'ok':ev.status==='RECHAZADO'?'bad':'no', ev.reason);
  if(res.patch){
    $('mSize').textContent=`${fmt(res.patch.widthMm/10,2)} × ${fmt(res.patch.heightMm/10,2)} cm`;
    $('mPerimeter').textContent=`${fmt(res.patch.perimeterMm/10,2)} cm`;
    $('mArea').textContent=`${fmt(res.patch.areaMm2/100,2)} cm²`;
    $('mBaseText').textContent=res.text?.found ? `${fmt(res.text.baseToTextMm,1)} mm` : '--';
    $('mTextScore').textContent=ev.centerScore!=null?`${fmt(ev.centerScore,0)}% (${fmt(ev.centerErrMm,1)} mm)`:'--';
    if($('mBaseScore')) $('mBaseScore').textContent=ev.baseScore!=null?`${fmt(ev.baseScore,0)}%`:'--';
    $('mMasterScore').textContent=ev.masterScore!=null?`${fmt(ev.masterScore,0)}%`:'--';
    res.status=ev.status; res.pass=ev.pass; res.reason=ev.reason; res.masterScore=ev.masterScore; res.baseScore=ev.baseScore; res.centerScore=ev.centerScore; res.centerErrMm=ev.centerErrMm;
  }
}
function setDecision(title,cls,reason){
  const d=$('decision'); d.textContent=title; d.className='statusTitle '+cls;
  $('reason').textContent=reason || '';
}
function similarity(a,b){ if(a==null || b==null || Math.abs(b)<1e-6) return 0; return clamp(100 - Math.abs(a-b)/Math.abs(b)*100,0,100); }

// ===================== LOG / STATE =====================
function renderState(){
  $('cardState').textContent = calibration ? `OK ${fmt(calibration.confidence,0)}%` : 'No calibrada';
  $('scaleState').textContent = calibration ? `${fmt(calibration.pxPerMm,2)} px/mm` : '--';
  $('masterState').textContent = master ? `OK ${new Date(master.createdAt).toLocaleTimeString()}` : 'No guardado';
  if(!calibration) setStep(2); else if(!master) setStep(3); else setStep(4);
}
function addLog(res){
  const row={
    time:new Date().toLocaleString(), lot:cfg().lot, result:res.status || 'NO_MEDIBLE', score:res.masterScore ?? '',
    base:res.text?.found ? fmt(res.text.baseToTextMm,1) : '',
    center:res.centerScore!=null ? fmt(res.centerScore,0) : '',
    size:res.patch ? `${fmt(res.patch.widthMm/10,2)}x${fmt(res.patch.heightMm/10,2)}` : '', reason:res.reason || ''
  };
  log.unshift(row); log=log.slice(0,800); localStorage.setItem(STORAGE.log,JSON.stringify(log)); renderLog();
}
function renderLog(){
  $('logBody').innerHTML = log.map(r=>`<tr><td>${escapeHtml(r.time)}</td><td>${escapeHtml(r.lot)}</td><td>${escapeHtml(r.result)}</td><td>${escapeHtml(r.score)}</td><td>${escapeHtml(r.center||'')}</td><td>${escapeHtml(r.base)}</td><td>${escapeHtml(r.size)}</td><td>${escapeHtml(r.reason)}</td></tr>`).join('');
  $('okCount').textContent=log.filter(r=>r.result==='APROBADO').length;
  $('badCount').textContent=log.filter(r=>r.result==='RECHAZADO').length;
  $('noCount').textContent=log.filter(r=>r.result==='NO_MEDIBLE').length;
  $('totalCount').textContent=log.length;
}
function clearAll(){
  calibration=null; master=null; localStorage.removeItem(STORAGE.cal); localStorage.removeItem(STORAGE.master); renderState(); toast('Ficha y maestro borrados'); drawOverlay(null);
}
function exportCSV(){
  const head='Hora,Lote,Resultado,ScoreFinal,CentroTexto,BaseTexto,Tamano,Motivo\n';
  const body=log.map(r=>[r.time,r.lot,r.result,r.score,r.center||'',r.base,r.size,`"${String(r.reason).replaceAll('\"','\"\"')}"`].join(',')).join('\n');
  const blob=new Blob([head+body],{type:'text/csv;charset=utf-8'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='historial_parches_v17_texto.csv'; a.click();
}
function escapeHtml(v){ return String(v??'').replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }

// ===================== OVERLAY =====================
function drawOverlay(payload){
  lastOverlay=payload;
  const cw=overlay.clientWidth, ch=overlay.clientHeight;
  ctx.clearRect(0,0,cw,ch);
  if(!payload?.shapes?.length || !payload.imageSize) return;
  const fit=containFit(payload.imageSize.w,payload.imageSize.h,cw,ch);
  ctx.save(); ctx.translate(fit.x,fit.y); ctx.scale(fit.s,fit.s);
  payload.shapes.forEach(s=>drawShape(ctx,s));
  ctx.restore();
}
function containFit(iw,ih,cw,ch){ const s=Math.min(cw/iw,ch/ih); return {s,x:(cw-iw*s)/2,y:(ch-ih*s)/2}; }
function drawShape(c,s){
  const scale=c.getTransform().a || 1;
  c.lineWidth=3/scale; c.strokeStyle=s.color || '#21d18b'; c.fillStyle=s.color || '#21d18b'; c.font=`${15/scale}px system-ui`;
  if(s.type==='poly'){
    c.beginPath(); s.pts.forEach((p,i)=> i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y)); c.closePath(); c.stroke(); if(s.label) c.fillText(s.label,s.pts[0].x+6,s.pts[0].y-8);
  }
  if(s.type==='rect'){
    c.save(); c.setLineDash([8/scale,6/scale]); c.strokeRect(s.rect.x,s.rect.y,s.rect.w,s.rect.h); c.restore(); if(s.label) c.fillText(s.label,s.rect.x+8,s.rect.y+18);
  }
  if(s.type==='line'){
    c.beginPath(); c.moveTo(s.x1,s.y1); c.lineTo(s.x2,s.y2); c.stroke(); if(s.label) c.fillText(s.label,s.x2+6,s.y2-6);
  }
  if(s.type==='cross'){
    const r=12/scale; c.beginPath(); c.moveTo(s.x-r,s.y); c.lineTo(s.x+r,s.y); c.moveTo(s.x,s.y-r); c.lineTo(s.x,s.y+r); c.stroke(); if(s.label) c.fillText(s.label,s.x+8,s.y-8);
  }
}
function drawMat(mat,id){ try{ cv.imshow($(id),mat); }catch(e){} }

// ===================== GEOMETRÍA / CV HELPERS =====================
function matToPoints(mat){ const data=mat.data32S && mat.data32S.length ? mat.data32S : mat.data32F; const pts=[]; for(let i=0;i<mat.rows;i++) pts.push({x:data[i*2],y:data[i*2+1]}); return pts; }
function orderQuad(pts){
  const p=pts.map(q=>({x:q.x,y:q.y})); const sums=p.map(q=>q.x+q.y), diffs=p.map(q=>q.x-q.y);
  const tl=p[sums.indexOf(Math.min(...sums))], br=p[sums.indexOf(Math.max(...sums))], tr=p[diffs.indexOf(Math.max(...diffs))], bl=p[diffs.indexOf(Math.min(...diffs))];
  return [tl,tr,br,bl];
}
function sideLengths(q){ return [dist(q[0],q[1]),dist(q[1],q[2]),dist(q[2],q[3]),dist(q[3],q[0])]; }
function dist(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }
function polyCenter(pts){ return {x:pts.reduce((s,p)=>s+p.x,0)/pts.length, y:pts.reduce((s,p)=>s+p.y,0)/pts.length}; }
function rectFromPoints(pts){ const xs=pts.map(p=>p.x), ys=pts.map(p=>p.y); const x=Math.min(...xs), y=Math.min(...ys), x2=Math.max(...xs), y2=Math.max(...ys); return {x,y,w:x2-x,h:y2-y}; }
function expandRect(r,pad,w,h){ return clampRect({x:r.x-pad,y:r.y-pad,w:r.w+pad*2,h:r.h+pad*2},w,h); }
function clampRect(r,w,h){ const x=clamp(Math.floor(r.x),0,w-1), y=clamp(Math.floor(r.y),0,h-1); const x2=clamp(Math.ceil(r.x+r.w),x+1,w), y2=clamp(Math.ceil(r.y+r.h),y+1,h); return {x,y,w:x2-x,h:y2-y}; }
function mmToApproxPx(mm){ return calibration?.pxPerMm ? mm*calibration.pxPerMm : mm*10; }
function rotatedRectPoints(rect){ return cv.RotatedRect.points(rect).map(p=>({x:p.x,y:p.y})); }
function contourToPoints(contour,ox=0,oy=0,step=1){ const pts=[]; const data=contour.data32S; for(let i=0;i<contour.rows;i+=step) pts.push({x:data[i*2]+ox,y:data[i*2+1]+oy}); return pts; }
function warpQuad(src,pts,w,h){
  const srcTri=cv.matFromArray(4,1,cv.CV_32FC2,[pts[0].x,pts[0].y,pts[1].x,pts[1].y,pts[2].x,pts[2].y,pts[3].x,pts[3].y]);
  const dstTri=cv.matFromArray(4,1,cv.CV_32FC2,[0,0,w,0,w,h,0,h]);
  const M=cv.getPerspectiveTransform(srcTri,dstTri); const dst=new cv.Mat();
  cv.warpPerspective(src,dst,M,new cv.Size(w,h),cv.INTER_LINEAR,cv.BORDER_CONSTANT,new cv.Scalar());
  srcTri.delete(); dstTri.delete(); M.delete(); return dst;
}
function homographyArray(srcPts,dstPts){
  const src=cv.matFromArray(4,1,cv.CV_32FC2,[srcPts[0].x,srcPts[0].y,srcPts[1].x,srcPts[1].y,srcPts[2].x,srcPts[2].y,srcPts[3].x,srcPts[3].y]);
  const dst=cv.matFromArray(4,1,cv.CV_32FC2,[dstPts[0].x,dstPts[0].y,dstPts[1].x,dstPts[1].y,dstPts[2].x,dstPts[2].y,dstPts[3].x,dstPts[3].y]);
  const M=cv.getPerspectiveTransform(src,dst); const arr=Array.from(M.data64F?.length?M.data64F:M.data32F); src.delete(); dst.delete(); M.delete(); return arr;
}
function transformPoint(h,x,y){ const den=h[6]*x+h[7]*y+h[8]; return {x:(h[0]*x+h[1]*y+h[2])/den,y:(h[3]*x+h[4]*y+h[5])/den}; }
function polygonArea(pts){ let s=0; for(let i=0;i<pts.length;i++){ const a=pts[i], b=pts[(i+1)%pts.length]; s+=a.x*b.y-b.x*a.y; } return s/2; }
function polygonPerimeter(pts){ let s=0; for(let i=0;i<pts.length;i++) s+=dist(pts[i],pts[(i+1)%pts.length]); return s; }
function normalizeRectAngle(angle,w,h){ let a=angle; if(w<h) a+=90; if(a>45)a-=90; if(a<-45)a+=90; return a; }
function unionBoxes(boxes){ if(!boxes.length)return null; const x=Math.min(...boxes.map(b=>b.x)), y=Math.min(...boxes.map(b=>b.y)), x2=Math.max(...boxes.map(b=>b.x+b.w)), y2=Math.max(...boxes.map(b=>b.y+b.h)); return {x,y,w:x2-x,h:y2-y}; }
function projectWarpRectToImage(b,box,W,H){ const Hm=homographyArray([{x:0,y:0},{x:W,y:0},{x:W,y:H},{x:0,y:H}],box); return [transformPoint(Hm,b.x,b.y),transformPoint(Hm,b.x+b.w,b.y),transformPoint(Hm,b.x+b.w,b.y+b.h),transformPoint(Hm,b.x,b.y+b.h)]; }
function projectWarpLineToImage(a,b,box,W,H){ const Hm=homographyArray([{x:0,y:0},{x:W,y:0},{x:W,y:H},{x:0,y:H}],box); return [transformPoint(Hm,a.x,a.y),transformPoint(Hm,b.x,b.y)]; }
