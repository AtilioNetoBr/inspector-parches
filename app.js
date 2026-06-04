'use strict';

const $ = id => document.getElementById(id);
const video = $('video');
const overlay = $('overlay');
const ctx = overlay.getContext('2d');
const capture = $('capture');
const capCtx = capture.getContext('2d', { willReadFrequently: true });
const bgCanvas = $('backgroundCanvas');
const bgCtx = bgCanvas.getContext('2d', { willReadFrequently: true });

const PROCESS_MAX_W = 1280;
const CARD_MM = 70;
const INNER_MM = 50;
const CARD_WARP = 700;

let stream = null;
let cameras = [];
let currentCam = -1;
let usingPhoto = false;
let photoCanvas = null;
let auto = false;
let lastAuto = 0;
let bgGray = null;
let lastResult = null;

let calibration = safeJSON(localStorage.getItem('v15_calibration'), null);
let master = safeJSON(localStorage.getItem('v15_master'), null);
let log = safeJSON(localStorage.getItem('v15_log'), []);

boot();

function boot(){
  bind();
  waitOpenCV();
  resizeOverlay();
  window.addEventListener('resize', resizeOverlay);
  renderStates();
  renderLog();
}
function bind(){
  $('btnStart').onclick = startCamera;
  $('btnSwitch').onclick = switchCamera;
  $('fileInput').onchange = loadPhoto;
  $('btnCalCard').onclick = calibrateCard;
  $('btnCaptureBg').onclick = captureBackground;
  $('btnSaveMaster').onclick = saveMaster;
  $('btnMeasure').onclick = () => measure(true);
  $('btnAuto').onclick = toggleAuto;
  $('btnClearAll').onclick = clearAll;
  $('btnExport').onclick = exportCSV;
}
function safeJSON(txt, fallback){ try { return txt ? JSON.parse(txt) : fallback; } catch { return fallback; } }
function toast(msg, ms=2300){ const t=$('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove('show'),ms); }
function setBadge(id, text, cls='idle'){ const el=$(id); el.textContent=text; el.className='badge '+cls; }
function cvReady(){ return window.cv && typeof cv.Mat === 'function' && typeof cv.imread === 'function'; }
function waitOpenCV(){
  const start=Date.now();
  const timer=setInterval(()=>{
    if(cvReady()){ clearInterval(timer); setBadge('cvBadge','OpenCV listo','ok'); }
    else if(Date.now()-start>15000){ clearInterval(timer); setBadge('cvBadge','OpenCV no cargó','bad'); }
  },250);
}
function cfg(){ return {
  lot:$('lot').value.trim() || 'Sin lote',
  minScore:+$('minScore').value || 85,
  minBaseScore:+$('minBaseScore').value || 85,
  marginMm:+$('detectMarginMm').value || 8,
  textStart:clamp((+$('textStart').value || 45)/100,0,.95),
  textEnd:clamp((+$('textEnd').value || 94)/100,.05,1),
  useSize:$('useSize').checked,
  useArea:$('useArea').checked
};}
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
function fmt(n,d=1){ return (n==null || !isFinite(n)) ? '--' : Number(n).toFixed(d); }

async function startCamera(deviceId){
  stopStream(); usingPhoto=false; photoCanvas=null;
  const trials=[];
  if(deviceId) trials.push({video:{deviceId:{exact:deviceId}, width:{ideal:1280}, height:{ideal:720}}, audio:false});
  trials.push(
    {video:{facingMode:{ideal:'environment'}, width:{ideal:1280}, height:{ideal:720}}, audio:false},
    {video:{facingMode:{ideal:'environment'}}, audio:false},
    {video:true, audio:false}
  );
  let lastErr=null;
  for(const constraints of trials){
    try{
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject=stream; await video.play();
      document.querySelector('.viewer').classList.add('live');
      setBadge('cameraBadge','Cámara activa','ok');
      $('stageMessage').querySelector('strong').textContent='Cámara activa';
      $('stageMessage').querySelector('span').textContent='Sigue los pasos: ficha → fondo → maestro → medir.';
      await refreshCameras(); resizeOverlay(); requestAnimationFrame(loop);
      return;
    }catch(e){ lastErr=e; }
  }
  setBadge('cameraBadge','Error cámara','bad');
  document.querySelector('.viewer').classList.remove('live');
  $('stageMessage').querySelector('strong').textContent='No abrió cámara';
  $('stageMessage').querySelector('span').textContent=explainCam(lastErr);
  toast(explainCam(lastErr),4200);
}
function explainCam(e){
  if(!(location.protocol==='https:' || location.hostname==='localhost')) return 'La cámara requiere HTTPS. Usa GitHub Pages.';
  if(!e) return 'No se pudo abrir cámara.';
  if(e.name==='NotAllowedError') return 'Permiso bloqueado. Permite cámara en Safari para este sitio.';
  if(e.name==='NotReadableError') return 'La cámara está ocupada por otra app.';
  return `${e.name||'Error'}: ${e.message||'No se pudo abrir cámara'}`;
}
function stopStream(){ if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; } video.srcObject=null; }
async function refreshCameras(){
  try{
    cameras=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');
    const id=stream?.getVideoTracks?.()[0]?.getSettings?.().deviceId;
    currentCam=cameras.findIndex(c=>c.deviceId===id);
  }catch{ cameras=[]; }
}
async function switchCamera(){
  await refreshCameras();
  if(!cameras.length){ toast('iPhone no entregó lista de cámaras. Reintentando.'); return startCamera(); }
  currentCam=(currentCam+1)%cameras.length;
  startCamera(cameras[currentCam].deviceId);
}
function loadPhoto(ev){
  const file=ev.target.files?.[0]; if(!file) return;
  const img=new Image();
  img.onload=()=>{
    stopStream(); usingPhoto=true; photoCanvas=document.createElement('canvas');
    photoCanvas.width=img.naturalWidth; photoCanvas.height=img.naturalHeight;
    photoCanvas.getContext('2d').drawImage(img,0,0);
    document.querySelector('.viewer').classList.remove('live');
    setBadge('cameraBadge','Foto cargada','warn');
    resizeOverlay(); drawOverlay({preview:true}); toast('Foto cargada');
  };
  img.src=URL.createObjectURL(file);
}
function resizeOverlay(){
  const r=overlay.getBoundingClientRect(); const dpr=devicePixelRatio||1;
  overlay.width=Math.max(1,Math.round(r.width*dpr)); overlay.height=Math.max(1,Math.round(r.height*dpr));
  ctx.setTransform(dpr,0,0,dpr,0,0); drawOverlay(lastResult);
}
function grabFrame(){
  const source = usingPhoto ? photoCanvas : video;
  const sw = usingPhoto ? source?.width : video.videoWidth;
  const sh = usingPhoto ? source?.height : video.videoHeight;
  if(!sw || !sh) return false;
  const scale=Math.min(1, PROCESS_MAX_W/sw);
  capture.width=Math.round(sw*scale); capture.height=Math.round(sh*scale);
  capCtx.drawImage(source,0,0,capture.width,capture.height);
  return true;
}

function loop(){
  if(auto && (stream || usingPhoto) && Date.now()-lastAuto>950){ measure(true, true); lastAuto=Date.now(); }
  if(stream) requestAnimationFrame(loop);
}
function toggleAuto(){
  auto=!auto; $('btnAuto').textContent=auto?'Auto ON':'Auto OFF'; $('btnAuto').dataset.active=String(auto); $('stateAuto').textContent=auto?'ON':'OFF'; toast(auto?'Auto activo':'Auto apagado'); if(auto) requestAnimationFrame(loop);
}

function calibrateCard(){
  if(!cvReady()) return toast('OpenCV aún está cargando.');
  if(!grabFrame()) return toast('No hay imagen. Inicia cámara.');
  const src=cv.imread(capture);
  try{
    const card=detectCard(src);
    if(!card || card.confidence<78){
      lastResult={mode:'calibration', status:'NO MEDIBLE', pass:null, reason:card?`Ficha débil ${fmt(card.confidence,0)}%`:'No detecté ficha', shapes:card?.shapes||[], image:{w:capture.width,h:capture.height}};
      drawOverlay(lastResult); renderDecision('NO MEDIBLE','no',lastResult.reason); return toast('Ficha no confiable. Ajusta luz/posición.');
    }
    calibration={...card, savedAt:new Date().toISOString(), image:{w:capture.width,h:capture.height}};
    localStorage.setItem('v15_calibration', JSON.stringify(stripTransient(calibration)));
    renderStates();
    lastResult={mode:'calibration', status:'FICHA OK', pass:true, reason:`Ficha calibrada ${fmt(card.confidence,0)}%. Retira la ficha y captura fondo.`, shapes:card.shapes, image:{w:capture.width,h:capture.height}};
    drawOverlay(lastResult); renderDecision('FICHA OK','ok',lastResult.reason); toast('Ficha OK. Ahora retira ficha y captura fondo.');
  }finally{ src.delete(); }
}
function stripTransient(obj){ return JSON.parse(JSON.stringify(obj, (k,v)=> k==='warp' ? undefined : v)); }

function detectCard(src){
  const gray=new cv.Mat(), blur=new cv.Mat(); let best=null;
  try{
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY); cv.GaussianBlur(gray, blur, new cv.Size(5,5),0);
    const thresholds=[130,145,160,175,190,205,220,235];
    for(const t of thresholds){
      const mask=new cv.Mat(), clean=new cv.Mat(), contours=new cv.MatVector(), hierarchy=new cv.Mat();
      try{
        cv.threshold(blur, mask, t, 255, cv.THRESH_BINARY);
        const k1=cv.Mat.ones(9,9,cv.CV_8U), k2=cv.Mat.ones(3,3,cv.CV_8U);
        cv.morphologyEx(mask, clean, cv.MORPH_CLOSE, k1); cv.morphologyEx(clean, clean, cv.MORPH_OPEN, k2);
        k1.delete(); k2.delete();
        cv.findContours(clean, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        for(let i=0;i<contours.size();i++){
          const c=contours.get(i); const cand=scoreCard(src,c,t); if(cand && (!best || cand.score>best.score)) best=cand; c.delete();
        }
      }finally{ mask.delete(); clean.delete(); contours.delete(); hierarchy.delete(); }
    }
  }finally{ gray.delete(); blur.delete(); }
  return best;
}
function scoreCard(src, cont, t){
  const imgArea=src.cols*src.rows, area=cv.contourArea(cont); if(area<imgArea*.015 || area>imgArea*.82) return null;
  const peri=cv.arcLength(cont,true); let approx=new cv.Mat(), quad=null, fallback=false;
  try{
    for(const e of [.014,.02,.028,.04,.055]){ cv.approxPolyDP(cont, approx, e*peri, true); if(approx.rows===4 && cv.isContourConvex(approx)){ quad=orderQuad(matPoints(approx)); break; } }
    if(!quad){ quad=orderQuad(rotatedRectPoints(cv.minAreaRect(cont))); fallback=true; }
  }finally{ approx.delete(); }
  const sides=[dist(quad[0],quad[1]),dist(quad[1],quad[2]),dist(quad[2],quad[3]),dist(quad[3],quad[0])];
  const minS=Math.min(...sides), maxS=Math.max(...sides); if(minS<70 || maxS/minS>2.35) return null;
  const warp=warpQuad(src,quad,CARD_WARP,CARD_WARP); const v=validateCardWarp(warp); warp.delete();
  const center=avgPoint(quad); const centerScore=1-clamp(Math.hypot(center.x-src.cols/2,center.y-src.rows/2)/Math.hypot(src.cols/2,src.rows/2),0,1);
  const shapeScore=minS/maxS; const areaScore=clamp(Math.sqrt(area/imgArea)*4,0,1);
  const confidence=clamp((v.score*.72 + shapeScore*.12 + centerScore*.10 + areaScore*.06)*100*(fallback?.86:1),0,100);
  const pxPerMm=sides.reduce((a,b)=>a+b,0)/4/CARD_MM;
  const H_img_to_mm=homographyArray(quad,[{x:0,y:0},{x:70,y:0},{x:70,y:70},{x:0,y:70}]);
  const H_mm_to_img=homographyArray([{x:0,y:0},{x:70,y:0},{x:70,y:70},{x:0,y:70}],quad);
  const inner=projectPoly(H_mm_to_img,[{x:10,y:10},{x:60,y:10},{x:60,y:60},{x:10,y:60}]);
  const shapes=[{type:'poly',pts:quad,color:'#22d38e',label:'ficha 7×7'},{type:'poly',pts:inner,color:'#ffd166',label:'5×5 geom.'},{type:'point',x:center.x,y:center.y,color:'#57a8ff',label:'centro'}];
  return {score:confidence, confidence, quad, inner, pxPerMm, H_img_to_mm, H_mm_to_img, threshold:t, validation:v, shapes};
}
function validateCardWarp(warp){
  const gray=new cv.Mat(); cv.cvtColor(warp,gray,cv.COLOR_RGBA2GRAY);
  const inner=gray.roi(new cv.Rect(100,100,500,500));
  const top=gray.roi(new cv.Rect(115,35,470,48)); const bottom=gray.roi(new cv.Rect(115,617,470,48));
  const left=gray.roi(new cv.Rect(35,115,48,470)); const right=gray.roi(new cv.Rect(617,115,48,470));
  const im=cv.mean(inner)[0], bm=(cv.mean(top)[0]+cv.mean(bottom)[0]+cv.mean(left)[0]+cv.mean(right)[0])/4, contrast=bm-im;
  const dark=new cv.Mat(); cv.threshold(inner,dark,Math.max(60,Math.min(190,bm-30)),255,cv.THRESH_BINARY_INV);
  const darkRatio=cv.countNonZero(dark)/(500*500);
  const contrastScore=clamp(contrast/95,0,1), darkScore=clamp((darkRatio-.22)/.58,0,1), borderScore=clamp((bm-120)/100,0,1);
  const score=contrastScore*.46 + darkScore*.28 + borderScore*.26;
  inner.delete(); top.delete(); bottom.delete(); left.delete(); right.delete(); dark.delete(); gray.delete();
  return {score, innerMean:im, borderMean:bm, contrast, darkRatio};
}

function captureBackground(){
  if(!calibration) return toast('Primero calibra ficha.');
  if(!cvReady()) return toast('OpenCV aún carga.');
  if(!grabFrame()) return toast('No hay imagen.');
  if(bgGray) bgGray.delete();
  const src=cv.imread(capture); bgGray=new cv.Mat();
  try{
    cv.cvtColor(src,bgGray,cv.COLOR_RGBA2GRAY);
    bgCanvas.width=capture.width; bgCanvas.height=capture.height; bgCtx.drawImage(capture,0,0);
    renderStates();
    lastResult={mode:'background', status:'FONDO OK', pass:true, reason:'Fondo capturado. Ahora coloca pieza buena y guarda maestro.', shapes:[inspectionRectShape()], image:{w:capture.width,h:capture.height}};
    drawOverlay(lastResult); renderDecision('FONDO OK','ok',lastResult.reason); toast('Fondo capturado. Coloca maestro.');
  }finally{ src.delete(); }
}
function saveMaster(){
  if(!calibration) return toast('Primero calibra ficha.');
  if(!bgGray) return toast('Primero captura fondo vacío.');
  const res=analyzeCurrent('master');
  if(!res || !res.patch) return toast('No detecté parche maestro.');
  if(!res.text) return toast('No detecté texto del maestro. Ajusta zona texto/luz.');
  const marginPx=mmToPx(cfg().marginMm);
  const dr=inflateRect(res.patch.bbox, marginPx, capture.width, capture.height);
  master={savedAt:new Date().toISOString(), detectRect:dr, patch:res.patch.metrics, text:res.text.metrics, image:{w:capture.width,h:capture.height}};
  localStorage.setItem('v15_master',JSON.stringify(master));
  renderStates();
  lastResult={...res,status:'MAESTRO OK',pass:true,reason:'Maestro 100% guardado. Ya puedes auditar.',shapes:[...res.shapes, rectShape(dr,'#9db0cc','zona aprendida',true)]};
  drawOverlay(lastResult); renderDecision('MAESTRO OK','ok',lastResult.reason); toast('Maestro 100% guardado');
}
function measure(record=false, silent=false){
  if(!calibration) return toast('Falta calibrar ficha.');
  if(!bgGray) return toast('Falta capturar fondo.');
  if(!master) return toast('Falta guardar maestro.');
  const res=analyzeCurrent('audit');
  if(!res){ return null; }
  evaluate(res);
  lastResult=res; drawOverlay(res); renderResult(res); if(record && !silent) addLog(res); else if(record && silent && res.status!=='NO MEDIBLE') addLog(res);
  return res;
}
function analyzeCurrent(mode){
  if(!grabFrame()) return null;
  const src=cv.imread(capture); let res=null;
  try{
    const searchRect = mode==='audit' && master?.detectRect ? master.detectRect : calibrationSearchRect();
    const patch=detectPatchWithBackground(src, searchRect, mode);
    if(!patch){
      return {mode,status:'NO MEDIBLE',pass:null,reason:'No detecté silueta del parche dentro de la zona.',shapes:[rectShape(searchRect,'#ffd166','zona búsqueda',true)],image:{w:capture.width,h:capture.height}};
    }
    const text=detectTextInPatch(src, patch);
    const shapes=[rectShape(searchRect,'#9db0cc','zona búsqueda',true), ...patch.shapes, ...(text?text.shapes:[])];
    res={mode,status: mode==='master'?'MAESTRO':'MEDIDO', pass:null, reason:'Medición lista', patch, text, shapes, image:{w:capture.width,h:capture.height}};
  }finally{ src.delete(); }
  return res;
}
function detectPatchWithBackground(src, searchRect, mode){
  const gray=new cv.Mat(), diff=new cv.Mat(), mask=new cv.Mat(), clean=new cv.Mat(), contours=new cv.MatVector(), hierarchy=new cv.Mat();
  const roiRect=toCvRect(searchRect, src.cols, src.rows);
  try{
    cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);
    if(!bgGray || bgGray.cols!==gray.cols || bgGray.rows!==gray.rows) return null;
    const curR=gray.roi(roiRect), bgR=bgGray.roi(roiRect);
    cv.absdiff(curR,bgR,diff);
    // Algo nuevo contra fondo + suficientemente claro. Si solo hay sombra, no debe mandar.
    const diffMask=new cv.Mat(), lightMask=new cv.Mat();
    cv.threshold(diff,diffMask,28,255,cv.THRESH_BINARY);
    cv.threshold(curR,lightMask,82,255,cv.THRESH_BINARY);
    cv.bitwise_and(diffMask,lightMask,mask);
    const kClose=cv.Mat.ones(13,13,cv.CV_8U), kOpen=cv.Mat.ones(5,5,cv.CV_8U);
    cv.morphologyEx(mask,clean,cv.MORPH_CLOSE,kClose); cv.morphologyEx(clean,clean,cv.MORPH_OPEN,kOpen);
    kClose.delete(); kOpen.delete(); diffMask.delete(); lightMask.delete(); curR.delete(); bgR.delete();
    cv.findContours(clean,contours,hierarchy,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
    let best=null,bestScore=-1;
    for(let i=0;i<contours.size();i++){
      const c=contours.get(i); const area=cv.contourArea(c); const roiArea=roiRect.width*roiRect.height;
      if(area<roiArea*.002 || area>roiArea*.65){ c.delete(); continue; }
      const r=cv.boundingRect(c); const global={x:r.x+roiRect.x,y:r.y+roiRect.y,w:r.width,h:r.height};
      if(touchesBorder(global, searchRect, 4) && mode==='audit'){ c.delete(); continue; }
      const rect=cv.minAreaRect(c); const fill=area/Math.max(1,r.width*r.height);
      let expectedScore=0;
      if(master?.patch && mode==='audit'){
        const wMm=pxToMm(Math.max(rect.size.width,rect.size.height));
        const hMm=pxToMm(Math.min(rect.size.width,rect.size.height));
        expectedScore=1 - clamp((Math.abs(wMm-master.patch.widthMm)/master.patch.widthMm + Math.abs(hMm-master.patch.heightMm)/master.patch.heightMm)/2,0,1);
      }
      const center=rect.center; const centerGlobal={x:center.x+roiRect.x,y:center.y+roiRect.y};
      const score=area*(.3+fill)*(mode==='audit'?(.5+expectedScore):1);
      if(score>bestScore){ if(best?.contour) best.contour.delete(); best={contour:c, area, rect, bbox:global, center:centerGlobal}; bestScore=score; }
      else c.delete();
    }
    if(!best) return null;
    const box=rotatedRectPoints(best.rect).map(p=>({x:p.x+roiRect.x,y:p.y+roiRect.y}));
    const ordered=orientBox(orderQuad(box));
    const metricBox=ordered.map(p=>transformPoint(calibration.H_img_to_mm,p.x,p.y));
    const widthMm=(dist(metricBox[0],metricBox[1])+dist(metricBox[3],metricBox[2]))/2;
    const heightMm=(dist(metricBox[0],metricBox[3])+dist(metricBox[1],metricBox[2]))/2;
    const contPts=contourPoints(best.contour,roiRect.x,roiRect.y,4).map(p=>transformPoint(calibration.H_img_to_mm,p.x,p.y));
    const areaMm2=Math.abs(polyArea(contPts)); const perimeterMm=polyPerimeter(contPts);
    const angleDeg=normalizeRectAngle(best.rect.angle,best.rect.size.width,best.rect.size.height);
    const patch={bbox:best.bbox, box:ordered, center:best.center, metrics:{widthMm,heightMm,areaMm2,perimeterMm,angleDeg}, shapes:[{type:'poly',pts:ordered,color:'#22d38e',label:'patch'}, {type:'poly',pts:contourPoints(best.contour,roiRect.x,roiRect.y,5),color:'#22d38e',label:'silueta'}]};
    best.contour.delete(); return patch;
  }finally{ gray.delete(); diff.delete(); mask.delete(); clean.delete(); contours.delete(); hierarchy.delete(); }
}
function detectTextInPatch(src, patch){
  const c=cfg();
  const wPx=Math.max(120,Math.round(mmToPx(patch.metrics.widthMm))), hPx=Math.max(120,Math.round(mmToPx(patch.metrics.heightMm)));
  const warp=warpQuad(src,patch.box,wPx,hPx);
  const gray=new cv.Mat(), roi=null, blur=new cv.Mat(), bin=new cv.Mat(), clean=new cv.Mat(), contours=new cv.MatVector(), hierarchy=new cv.Mat();
  let roiMat=null;
  try{
    cv.cvtColor(warp,gray,cv.COLOR_RGBA2GRAY);
    const y0=Math.round(hPx*Math.min(c.textStart,c.textEnd-.02)); const y1=Math.round(hPx*Math.max(c.textEnd,c.textStart+.02));
    const xPad=Math.round(wPx*.04); roiMat=gray.roi(new cv.Rect(xPad,y0,Math.max(1,wPx-xPad*2),Math.max(1,y1-y0)));
    cv.GaussianBlur(roiMat,blur,new cv.Size(3,3),0); cv.threshold(blur,bin,0,255,cv.THRESH_BINARY_INV+cv.THRESH_OTSU);
    const k1=cv.Mat.ones(2,2,cv.CV_8U), k2=cv.Mat.ones(5,15,cv.CV_8U);
    cv.morphologyEx(bin,clean,cv.MORPH_OPEN,k1); cv.morphologyEx(clean,clean,cv.MORPH_CLOSE,k2); k1.delete(); k2.delete();
    cv.findContours(clean,contours,hierarchy,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
    const boxes=[]; const minArea=wPx*hPx*.00005;
    for(let i=0;i<contours.size();i++){
      const cnt=contours.get(i); const area=cv.contourArea(cnt); const r=cv.boundingRect(cnt); cnt.delete();
      if(area<minArea || r.width<wPx*.035 || r.height<hPx*.006 || r.width/r.height<1.25 || r.width>wPx*.94) continue;
      boxes.push({x:r.x+xPad,y:r.y+y0,w:r.width,h:r.height,area});
    }
    if(!boxes.length) return null;
    const b=unionBoxes(boxes);
    const baseToTextMm=(hPx-(b.y+b.h))*(patch.metrics.heightMm/hPx);
    const centerXNorm=(b.x+b.w/2)/wPx, centerYNorm=(b.y+b.h/2)/hPx;
    const Hback=homographyArray([{x:0,y:0},{x:wPx,y:0},{x:wPx,y:hPx},{x:0,y:hPx}],patch.box);
    const textPoly=projectPoly(Hback,[{x:b.x,y:b.y},{x:b.x+b.w,y:b.y},{x:b.x+b.w,y:b.y+b.h},{x:b.x,y:b.y+b.h}]);
    const line=projectPoly(Hback,[{x:b.x+b.w/2,y:b.y+b.h},{x:b.x+b.w/2,y:hPx}]);
    return {box:b, metrics:{baseToTextMm,centerXNorm,centerYNorm,widthNorm:b.w/wPx,heightNorm:b.h/hPx}, shapes:[{type:'poly',pts:textPoly,color:'#ffd166',label:'text'}, {type:'line',p1:line[0],p2:line[1],color:'#57a8ff',label:'Base a Texto'}]};
  }finally{ warp.delete(); gray.delete(); if(roiMat) roiMat.delete(); blur.delete(); bin.delete(); clean.delete(); contours.delete(); hierarchy.delete(); }
}
function evaluate(res){
  if(!res.patch){ res.status='NO MEDIBLE'; res.pass=null; return; }
  if(!res.text){ res.status='NO MEDIBLE'; res.pass=null; res.reason='No detecté bloque de texto dentro del parche.'; return; }
  const c=cfg(); const p=res.patch.metrics, t=res.text.metrics, mp=master.patch, mt=master.text;
  const baseScore=simScore(t.baseToTextMm, mt.baseToTextMm);
  const widthScore=simScore(p.widthMm, mp.widthMm), heightScore=simScore(p.heightMm, mp.heightMm);
  const areaScore=simScore(p.areaMm2, mp.areaMm2); const perimeterScore=simScore(p.perimeterMm, mp.perimeterMm);
  const xScore=simScore(t.centerXNorm, mt.centerXNorm); const yScore=simScore(t.centerYNorm, mt.centerYNorm);
  let score=baseScore*.46 + xScore*.20 + yScore*.12 + widthScore*.08 + heightScore*.08 + areaScore*.06;
  const reasons=[]; let pass=true;
  if(score<c.minScore){ pass=false; reasons.push(`Score ${fmt(score,0)}%, mínimo ${c.minScore}%`); }
  if(baseScore<c.minBaseScore){ pass=false; reasons.push(`Base a Texto ${fmt(baseScore,0)}%, mínimo ${c.minBaseScore}%`); }
  if(c.useSize && (widthScore<92 || heightScore<92)){ pass=false; reasons.push('Tamaño fuera contra maestro'); }
  if(c.useArea && (areaScore<90 || perimeterScore<90)){ pass=false; reasons.push('Área/perímetro fuera contra maestro'); }
  res.score={total:score,baseScore,widthScore,heightScore,areaScore,xScore,yScore};
  res.status=pass?'APROBADO':'RECHAZADO'; res.pass=pass; res.reason=reasons.join('; ') || `Dentro de criterio. Base a Texto ${fmt(t.baseToTextMm,1)} mm`;
}

function renderResult(res){
  if(!res){ renderDecision('ESPERANDO','neutral','Sin medición.'); return; }
  const cls=res.status==='APROBADO'?'ok':res.status==='RECHAZADO'?'bad':'no'; renderDecision(res.status,cls,res.reason);
  $('mScore').textContent=res.score?.total!=null ? `${fmt(res.score.total,0)}%` : '--';
  $('mBase').textContent=res.text?.metrics ? `${fmt(res.text.metrics.baseToTextMm,1)} mm` : '--';
  $('mSize').textContent=res.patch?.metrics ? `${fmt(res.patch.metrics.widthMm,1)} × ${fmt(res.patch.metrics.heightMm,1)} mm` : '--';
  $('mArea').textContent=res.patch?.metrics ? `${fmt(res.patch.metrics.areaMm2,0)} mm²` : '--';
}
function renderDecision(text, cls, reason){ const d=$('decision'); d.textContent=text; d.className='decision '+cls; $('reason').textContent=reason||''; }
function renderStates(){
  setState('stateCard', calibration?`OK ${fmt(calibration.confidence,0)}%`:'Pendiente', calibration?'ok':'warn');
  setState('stateBg', bgGray?'OK':'Pendiente', bgGray?'ok':'warn');
  setState('stateMaster', master?'OK':'Pendiente', master?'ok':'warn');
  ['btnCalCard','btnCaptureBg','btnSaveMaster'].forEach(id=>$(id).classList.remove('done','wait'));
  if(calibration) $('btnCalCard').classList.add('done'); else $('btnCalCard').classList.add('wait');
  if(bgGray) $('btnCaptureBg').classList.add('done'); else if(calibration) $('btnCaptureBg').classList.add('wait');
  if(master) $('btnSaveMaster').classList.add('done'); else if(bgGray) $('btnSaveMaster').classList.add('wait');
}
function setState(id,text,cls){ const el=$(id); el.textContent=text; el.className=cls; }
function addLog(res){
  const row={time:new Date().toLocaleString(), lot:cfg().lot, result:res.status, score:res.score?.total!=null?fmt(res.score.total,0):'', base:res.text?.metrics?fmt(res.text.metrics.baseToTextMm,1):'', reason:res.reason};
  log.unshift(row); log=log.slice(0,500); localStorage.setItem('v15_log',JSON.stringify(log)); renderLog();
}
function renderLog(){
  $('logBody').innerHTML=log.map(r=>`<tr><td>${escapeHtml(r.time)}</td><td>${escapeHtml(r.result)}</td><td>${escapeHtml(r.score)}</td><td>${escapeHtml(r.base)}</td><td>${escapeHtml(r.reason)}</td></tr>`).join('');
  $('okCount').textContent=log.filter(r=>r.result==='APROBADO').length; $('badCount').textContent=log.filter(r=>r.result==='RECHAZADO').length; $('nmCount').textContent=log.filter(r=>r.result==='NO MEDIBLE').length;
}
function exportCSV(){
  const head='Hora,Lote,Resultado,Score,BaseTexto,Motivo\n';
  const body=log.map(r=>[r.time,r.lot,r.result,r.score,r.base,`"${String(r.reason).replaceAll('"','""')}"`].join(',')).join('\n');
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([head+body],{type:'text/csv'})); a.download='inspector_parches_v15.csv'; a.click();
}
function clearAll(){
  if(!confirm('¿Borrar calibración, maestro e historial?')) return;
  calibration=null; master=null; log=[]; if(bgGray){bgGray.delete(); bgGray=null;} ['v15_calibration','v15_master','v15_log'].forEach(k=>localStorage.removeItem(k)); renderStates(); renderLog(); drawOverlay(null); toast('Todo borrado');
}

function drawOverlay(res){
  const cw=overlay.clientWidth, ch=overlay.clientHeight; ctx.clearRect(0,0,cw,ch);
  const iw=capture.width || (usingPhoto?photoCanvas?.width:video.videoWidth) || 1, ih=capture.height || (usingPhoto?photoCanvas?.height:video.videoHeight) || 1;
  if(usingPhoto && photoCanvas){ const fit=containFit(photoCanvas.width,photoCanvas.height,cw,ch); ctx.drawImage(photoCanvas,fit.x,fit.y,photoCanvas.width*fit.s,photoCanvas.height*fit.s); }
  if(!res?.shapes?.length) return;
  const fit=containFit(res.image?.w||iw,res.image?.h||ih,cw,ch); ctx.save(); ctx.translate(fit.x,fit.y); ctx.scale(fit.s,fit.s);
  res.shapes.forEach(s=>drawShape(ctx,s)); ctx.restore();
}
function containFit(iw,ih,cw,ch){ const s=Math.min(cw/iw,ch/ih); return {s,x:(cw-iw*s)/2,y:(ch-ih*s)/2}; }
function drawShape(g,s){ const sc=g.getTransform().a||1; g.lineWidth=(s.dash?2:3)/sc; g.strokeStyle=s.color||'#22d38e'; g.fillStyle=s.color||'#22d38e'; g.font=`${14/sc}px system-ui`; if(s.dash) g.setLineDash([8/sc,8/sc]); else g.setLineDash([]);
  if(s.type==='poly'){ g.beginPath(); s.pts.forEach((p,i)=>i?g.lineTo(p.x,p.y):g.moveTo(p.x,p.y)); g.closePath(); g.stroke(); if(s.label) g.fillText(s.label,s.pts[0].x+5,s.pts[0].y-7); }
  if(s.type==='rect'){ g.strokeRect(s.x,s.y,s.w,s.h); if(s.label) g.fillText(s.label,s.x+5,s.y-7); }
  if(s.type==='line'){ g.beginPath(); g.moveTo(s.p1.x,s.p1.y); g.lineTo(s.p2.x,s.p2.y); g.stroke(); if(s.label) g.fillText(s.label,s.p2.x+6,s.p2.y-6); }
  if(s.type==='point'){ g.beginPath(); g.arc(s.x,s.y,5/sc,0,Math.PI*2); g.fill(); if(s.label) g.fillText(s.label,s.x+7,s.y-7); }
  g.setLineDash([]);
}
function rectShape(r,color,label,dash=false){ return {type:'rect',x:r.x,y:r.y,w:r.w,h:r.h,color,label,dash}; }
function inspectionRectShape(){ return rectShape(calibrationSearchRect(),'#9db0cc','zona calibrada',true); }

// Helpers matemáticos / OpenCV
function calibrationSearchRect(){
  if(!calibration?.quad) return {x:0,y:0,w:capture.width,h:capture.height};
  const xs=calibration.quad.map(p=>p.x), ys=calibration.quad.map(p=>p.y);
  const x=Math.max(0,Math.min(...xs)), y=Math.max(0,Math.min(...ys)); const x2=Math.min(capture.width,Math.max(...xs)), y2=Math.min(capture.height,Math.max(...ys));
  const pad=mmToPx(12); return inflateRect({x,y,w:x2-x,h:y2-y},pad,capture.width,capture.height);
}
function inflateRect(r,pad,w,h){ const x=Math.max(0,Math.floor(r.x-pad)), y=Math.max(0,Math.floor(r.y-pad)); const x2=Math.min(w,Math.ceil(r.x+r.w+pad)), y2=Math.min(h,Math.ceil(r.y+r.h+pad)); return {x,y,w:Math.max(1,x2-x),h:Math.max(1,y2-y)}; }
function toCvRect(r,w,h){ const x=clamp(Math.floor(r.x),0,w-1), y=clamp(Math.floor(r.y),0,h-1); const x2=clamp(Math.ceil(r.x+r.w),x+1,w), y2=clamp(Math.ceil(r.y+r.h),y+1,h); return new cv.Rect(x,y,x2-x,y2-y); }
function mmToPx(mm){ return calibration?.pxPerMm ? mm*calibration.pxPerMm : mm*10; }
function pxToMm(px){ return calibration?.pxPerMm ? px/calibration.pxPerMm : px/10; }
function touchesBorder(r,zone,m=3){ return r.x<=zone.x+m || r.y<=zone.y+m || r.x+r.w>=zone.x+zone.w-m || r.y+r.h>=zone.y+zone.h-m; }
function matPoints(mat){ const d=mat.data32S?.length?mat.data32S:mat.data32F; const pts=[]; for(let i=0;i<mat.rows;i++) pts.push({x:d[i*2],y:d[i*2+1]}); return pts; }
function contourPoints(c,ox=0,oy=0,step=1){ const d=c.data32S, pts=[]; for(let i=0;i<c.rows;i+=step) pts.push({x:d[i*2]+ox,y:d[i*2+1]+oy}); return pts; }
function rotatedRectPoints(rect){ try{return cv.RotatedRect.points(rect).map(p=>({x:p.x,y:p.y}));}catch{ const a=rect.angle*Math.PI/180, ca=Math.cos(a), sa=Math.sin(a), w=rect.size.width/2, h=rect.size.height/2, pts=[{x:-w,y:-h},{x:w,y:-h},{x:w,y:h},{x:-w,y:h}]; return pts.map(p=>({x:rect.center.x+p.x*ca-p.y*sa,y:rect.center.y+p.x*sa+p.y*ca})); }}
function orderQuad(pts){ const p=pts.map(q=>({x:q.x,y:q.y})); const s=p.map(q=>q.x+q.y), d=p.map(q=>q.x-q.y); return [p[s.indexOf(Math.min(...s))], p[d.indexOf(Math.max(...d))], p[s.indexOf(Math.max(...s))], p[d.indexOf(Math.min(...d))]]; }
function orientBox(q){ const top=dist(q[0],q[1]), side=dist(q[1],q[2]); return top>side ? [q[1],q[2],q[3],q[0]] : q; }
function avgPoint(pts){ return {x:pts.reduce((a,p)=>a+p.x,0)/pts.length,y:pts.reduce((a,p)=>a+p.y,0)/pts.length}; }
function dist(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }
function warpQuad(src,pts,w,h){ const sp=cv.matFromArray(4,1,cv.CV_32FC2,[pts[0].x,pts[0].y,pts[1].x,pts[1].y,pts[2].x,pts[2].y,pts[3].x,pts[3].y]); const dp=cv.matFromArray(4,1,cv.CV_32FC2,[0,0,w,0,w,h,0,h]); const M=cv.getPerspectiveTransform(sp,dp), dst=new cv.Mat(); cv.warpPerspective(src,dst,M,new cv.Size(w,h),cv.INTER_LINEAR,cv.BORDER_CONSTANT,new cv.Scalar()); sp.delete(); dp.delete(); M.delete(); return dst; }
function homographyArray(srcPts,dstPts){ const sp=cv.matFromArray(4,1,cv.CV_32FC2,[srcPts[0].x,srcPts[0].y,srcPts[1].x,srcPts[1].y,srcPts[2].x,srcPts[2].y,srcPts[3].x,srcPts[3].y]); const dp=cv.matFromArray(4,1,cv.CV_32FC2,[dstPts[0].x,dstPts[0].y,dstPts[1].x,dstPts[1].y,dstPts[2].x,dstPts[2].y,dstPts[3].x,dstPts[3].y]); const H=cv.getPerspectiveTransform(sp,dp); const arr=Array.from(H.data64F?.length?H.data64F:H.data32F); sp.delete(); dp.delete(); H.delete(); return arr; }
function transformPoint(H,x,y){ const den=H[6]*x+H[7]*y+H[8]; return {x:(H[0]*x+H[1]*y+H[2])/den,y:(H[3]*x+H[4]*y+H[5])/den}; }
function projectPoly(H,pts){ return pts.map(p=>transformPoint(H,p.x,p.y)); }
function polyArea(pts){ let s=0; for(let i=0;i<pts.length;i++){ const a=pts[i], b=pts[(i+1)%pts.length]; s+=a.x*b.y-b.x*a.y; } return s/2; }
function polyPerimeter(pts){ let s=0; for(let i=0;i<pts.length;i++) s+=dist(pts[i],pts[(i+1)%pts.length]); return s; }
function normalizeRectAngle(a,w,h){ let x=a; if(w<h) x+=90; if(x>45)x-=90; if(x<-45)x+=90; return x; }
function unionBoxes(boxes){ const x=Math.min(...boxes.map(b=>b.x)), y=Math.min(...boxes.map(b=>b.y)), x2=Math.max(...boxes.map(b=>b.x+b.w)), y2=Math.max(...boxes.map(b=>b.y+b.h)); return {x,y,w:x2-x,h:y2-y}; }
function simScore(v,ref){ if(v==null||ref==null||!isFinite(v)||!isFinite(ref)||Math.abs(ref)<1e-6) return 0; return clamp(100-(Math.abs(v-ref)/Math.abs(ref))*100,0,100); }
function escapeHtml(s){ return String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
