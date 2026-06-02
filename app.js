/* Inspector de Parches Pro v9
   Enfoque: tarjeta 7x7/5x5 -> perspectiva -> silueta -> bloque de texto -> monitor PC QR.
   Sin OCR. El texto se mide como bloque visual. */

const $ = id => document.getElementById(id);
const video = $('video');
const overlay = $('overlay');
const octx = overlay.getContext('2d');
const capture = $('captureCanvas');
const capCtx = capture.getContext('2d', { willReadFrequently: true });
const workCanvas = $('workCanvas');
const workCtx = workCanvas.getContext('2d', { willReadFrequently: true });

let stream = null;
let devices = [];
let currentDeviceIndex = -1;
let usingPhoto = false;
let autoMode = false;
let lastAutoTs = 0;
let lastLoggedSignature = '';
let peer = null, monitorConn = null, monitorCall = null;

const STORE_KEYS = {
  cal: 'ip_v9_calibration',
  ref: 'ip_v9_reference',
  log: 'ip_v9_log'
};

let calibration = safeParse(localStorage.getItem(STORE_KEYS.cal), null);
let reference = safeParse(localStorage.getItem(STORE_KEYS.ref), null);
let log = safeParse(localStorage.getItem(STORE_KEYS.log), []);
let lastAnalysis = null;
let lastDebug = {};

const CARD = { OUTER_MM: 70, INNER_MM: 50, WARP_PX: 700, INNER_START: 100, INNER_END: 600 };

init();

function init(){
  bindUI();
  renderLog();
  renderCalibrationState();
  renderReferenceState();
  waitForOpenCV();
  resizeOverlay();
  window.addEventListener('resize', resizeOverlay);

  const params = new URLSearchParams(location.search);
  const monitorId = params.get('monitor');
  if(monitorId){
    $('monitorId').value = monitorId;
    toast('ID de monitor recibido por QR. Inicia cámara y conecta PC.');
  }
}

function bindUI(){
  $('btnStart').onclick = startCamera;
  $('btnSwitchCam').onclick = switchCamera;
  $('btnDetectCard').onclick = () => calibrateFromCard(true);
  $('btnRecalibrate').onclick = () => { calibration=null; localStorage.removeItem(STORE_KEYS.cal); renderCalibrationState(); toast('Calibración borrada'); };
  $('btnSaveReference').onclick = saveReference;
  $('btnClearReference').onclick = () => { reference=null; localStorage.removeItem(STORE_KEYS.ref); renderReferenceState(); toast('Referencia borrada'); };
  $('btnMeasure').onclick = () => analyzeAndMaybeRecord(true);
  $('btnAuto').onclick = toggleAuto;
  $('btnExport').onclick = exportCSV;
  $('btnReset').onclick = () => { log=[]; localStorage.removeItem(STORE_KEYS.log); renderLog(); toast('Conteo reiniciado'); };
  $('btnConnectMonitor').onclick = connectMonitor;
  $('btnReconnectMonitor').onclick = connectMonitor;
  $('fileInput').onchange = handleFileInput;
}

function safeParse(txt, fallback){ try{return txt?JSON.parse(txt):fallback;}catch{return fallback;} }
function toast(msg){ const el=$('toast'); el.textContent=msg; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),2400); }
function setBadge(id, text, cls='idle'){ const el=$(id); el.textContent=text; el.className='badge '+cls; }
function setStep(step){ ['stepCam','stepCal','stepRef','stepAudit'].forEach(id=>$(id).className='step'); $(step).className='step on'; }
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
function cfg(){ return {
  lot: $('lotName').value.trim() || 'Sin lote',
  minAlign:+$('minAlign').value || 85,
  maxErrX:+$('maxErrX').value || 3,
  maxErrY:+$('maxErrY').value || 3,
  maxTextAngle:+$('maxTextAngle').value || 5,
  textYStart:clamp((+$('textYStart').value || 45)/100,0,0.95),
  textYEnd:clamp((+$('textYEnd').value || 92)/100,0.05,1),
  chkText:$('chkText').checked,
  chkSize:$('chkSize').checked,
  chkArea:$('chkArea').checked
};}

async function waitForOpenCV(){
  const start = Date.now();
  const timer = setInterval(()=>{
    if(window.cv && typeof cv.Mat === 'function' && typeof cv.imread === 'function'){
      clearInterval(timer); setBadge('cvStatus','OpenCV listo','ok'); toast('Motor de visión listo');
    } else if(Date.now()-start>15000){
      clearInterval(timer); setBadge('cvStatus','OpenCV no cargó','bad'); toast('OpenCV no cargó. Revisa internet o recarga.');
    }
  },250);
}
function cvReady(){ return window.cv && typeof cv.Mat === 'function' && typeof cv.imread === 'function'; }

async function startCamera(deviceId=null){
  if(stream) stopStream();
  usingPhoto = false;
  const constraintsList = [];
  if(deviceId) constraintsList.push({video:{deviceId:{exact:deviceId}, width:{ideal:1280}, height:{ideal:720}}, audio:false});
  constraintsList.push(
    {video:{facingMode:{ideal:'environment'}, width:{ideal:1280}, height:{ideal:720}}, audio:false},
    {video:{facingMode:{ideal:'environment'}}, audio:false},
    {video:{width:{ideal:1280}, height:{ideal:720}}, audio:false},
    {video:true, audio:false}
  );
  let lastErr=null;
  for(const constraints of constraintsList){
    try{
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      await video.play();
      document.querySelector('.video-wrap').classList.add('video-live');
      setBadge('cameraStatus','Cámara activa','ok');
      $('guideTitle').textContent = 'Cámara activa';
      $('guideSub').textContent = 'Coloca tarjeta o parche dentro del campo.';
      await refreshDevices();
      resizeOverlay();
      loop();
      if($('monitorId').value.trim()) connectMonitor();
      return true;
    }catch(e){ lastErr=e; }
  }
  setBadge('cameraStatus','Cámara bloqueada','bad');
  document.querySelector('.video-wrap').classList.remove('video-live');
  $('guideTitle').textContent = 'No abrió cámara';
  $('guideSub').textContent = explainCameraError(lastErr);
  toast(explainCameraError(lastErr));
  console.error(lastErr);
  return false;
}
function explainCameraError(e){
  if(!location.protocol.startsWith('https') && location.hostname !== 'localhost') return 'La cámara requiere HTTPS. Abre desde GitHub Pages, no desde archivo local.';
  if(!navigator.mediaDevices?.getUserMedia) return 'Este navegador no permite cámara web aquí.';
  if(!e) return 'No se pudo abrir cámara. Prueba Analizar foto.';
  if(e.name==='NotAllowedError') return 'Permiso de cámara bloqueado. En Safari permite cámara para este sitio.';
  if(e.name==='NotFoundError') return 'No se encontró cámara disponible.';
  if(e.name==='NotReadableError') return 'La cámara está ocupada por otra app. Cierra Cámara/WhatsApp/Instagram.';
  if(e.name==='OverconstrainedError') return 'El iPhone rechazó la configuración. Probando modo simple falló también.';
  return `${e.name || 'Error'}: ${e.message || 'No se pudo abrir cámara'}`;
}
function stopStream(){
  if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; }
}
async function refreshDevices(){
  try{
    const all = await navigator.mediaDevices.enumerateDevices();
    devices = all.filter(d=>d.kind==='videoinput');
    const active = stream?.getVideoTracks?.()[0]?.getSettings?.().deviceId;
    currentDeviceIndex = devices.findIndex(d=>d.deviceId===active);
  }catch{ devices=[]; }
}
async function switchCamera(){
  await refreshDevices();
  if(!devices.length){ toast('No hay lista de cámaras. iOS a veces la oculta.'); return startCamera(); }
  currentDeviceIndex = (currentDeviceIndex + 1) % devices.length;
  return startCamera(devices[currentDeviceIndex].deviceId);
}
function resizeOverlay(){
  const r = overlay.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  overlay.width = Math.max(1, Math.round(r.width*dpr)); overlay.height = Math.max(1, Math.round(r.height*dpr));
  octx.setTransform(dpr,0,0,dpr,0,0);
  drawOverlay(lastAnalysis);
}
function grabFrame(){
  const vw = video.videoWidth || workCanvas.width;
  const vh = video.videoHeight || workCanvas.height;
  if(!vw || !vh) return false;
  capture.width = vw; capture.height = vh;
  if(usingPhoto){ capCtx.drawImage(workCanvas,0,0,vw,vh); }
  else capCtx.drawImage(video,0,0,vw,vh);
  return true;
}
function handleFileInput(ev){
  const file = ev.target.files?.[0]; if(!file) return;
  const img = new Image();
  img.onload = () => {
    usingPhoto = true;
    stopStream();
    video.srcObject = null;
    workCanvas.width = img.naturalWidth; workCanvas.height = img.naturalHeight;
    workCtx.drawImage(img,0,0);
    capture.width = img.naturalWidth; capture.height = img.naturalHeight;
    capCtx.drawImage(img,0,0);
    document.querySelector('.video-wrap').classList.add('video-live');
    setBadge('cameraStatus','Foto cargada','warn');
    drawImageToOverlayPreview();
    toast('Foto cargada. Ya puedes calibrar o medir.');
  };
  img.src = URL.createObjectURL(file);
}
function drawImageToOverlayPreview(){
  octx.clearRect(0,0,overlay.clientWidth,overlay.clientHeight);
  octx.drawImage(workCanvas,0,0,overlay.clientWidth,overlay.clientHeight);
}

function loop(){
  if(!stream && !usingPhoto) return;
  if(autoMode && Date.now()-lastAutoTs>900){
    const res = analyzeAndMaybeRecord(false);
    if(res){ lastAutoTs = Date.now(); }
  }
  requestAnimationFrame(loop);
}

function calibrateFromCard(record=true){
  if(!cvReady()){ toast('OpenCV aún no está listo'); return null; }
  if(!grabFrame()){ toast('No hay imagen para analizar'); return null; }
  let src = cv.imread(capture);
  let result=null;
  try{
    result = detectCard(src);
    if(!result || !result.ok){
      setBadge('cvStatus','Tarjeta no confiable','warn');
      toast(result?.message || 'No detecté tarjeta confiable. Acerca la tarjeta y evita brillos.');
      drawOverlay({shapes: result?.shapes || [], stage:'card-fail'});
      return null;
    }
    calibration = {
      createdAt: new Date().toISOString(),
      h: result.h,
      quad: result.quad,
      confidence: result.confidence,
      pxPerMm: CARD.WARP_PX / CARD.OUTER_MM,
      inner: result.inner,
      imageSize:{w:capture.width,h:capture.height}
    };
    localStorage.setItem(STORE_KEYS.cal, JSON.stringify(calibration));
    renderCalibrationState();
    setStep('stepRef');
    setBadge('cvStatus','Tarjeta calibrada','ok');
    toast(`Tarjeta OK. Confianza ${result.confidence.toFixed(0)}%. Retira la tarjeta sin mover el celular.`);
    drawOverlay({stage:'card-ok', shapes: result.shapes, card: result});
    sendMonitor({type:'analysis', stage:'calibration', result:'CALIBRADO', shapes:result.shapes, imageSize:{w:capture.width,h:capture.height}, calibration});
    return calibration;
  }catch(e){ console.error(e); toast('Error calibrando tarjeta'); }
  finally{ src.delete(); }
  return null;
}

function detectCard(src){
  const W = src.cols, H = src.rows;
  let gray=new cv.Mat(), blur=new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray, blur, new cv.Size(5,5), 0);
  const thresholds = [145,160,175,190,205];
  let best=null;
  for(const t of thresholds){
    let mask=new cv.Mat(), clean=new cv.Mat(), contours=new cv.MatVector(), hierarchy=new cv.Mat();
    try{
      cv.threshold(blur, mask, t, 255, cv.THRESH_BINARY);
      const k1 = cv.Mat.ones(7,7,cv.CV_8U);
      cv.morphologyEx(mask, clean, cv.MORPH_CLOSE, k1);
      cv.morphologyEx(clean, clean, cv.MORPH_OPEN, k1);
      k1.delete();
      drawMatToCanvas(clean, 'debugWhite');
      cv.findContours(clean, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      for(let i=0;i<contours.size();i++){
        const c = contours.get(i);
        const cand = scoreCardCandidate(c, src, clean, t);
        if(cand && (!best || cand.score > best.score)) best=cand;
        c.delete();
      }
    } finally { mask.delete(); clean.delete(); contours.delete(); hierarchy.delete(); }
  }
  // adaptive threshold fallback
  let adap=new cv.Mat(), contours=new cv.MatVector(), hierarchy=new cv.Mat();
  try{
    cv.adaptiveThreshold(blur, adap, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 51, -4);
    const k = cv.Mat.ones(7,7,cv.CV_8U);
    cv.morphologyEx(adap, adap, cv.MORPH_CLOSE, k); k.delete();
    cv.findContours(adap, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    for(let i=0;i<contours.size();i++){
      const c=contours.get(i);
      const cand=scoreCardCandidate(c, src, adap, 'adaptive');
      if(cand && (!best || cand.score>best.score)) best=cand;
      c.delete();
    }
  }finally{ adap.delete(); contours.delete(); hierarchy.delete(); gray.delete(); blur.delete(); }
  if(!best) return {ok:false, message:'No encontré candidato de tarjeta blanca exterior.', shapes:[]};
  const ok = best.confidence >= 72;
  return {...best, ok, message: ok?'OK':'Candidato débil. Centra la tarjeta y aumenta contraste.'};
}
function scoreCardCandidate(contour, src, mask, thresholdName){
  const imgArea = src.cols*src.rows;
  const area = cv.contourArea(contour);
  if(area < imgArea*0.015 || area > imgArea*0.85) return null;
  const peri = cv.arcLength(contour, true);
  if(peri <= 0) return null;
  let approx=new cv.Mat();
  cv.approxPolyDP(contour, approx, 0.025*peri, true);
  let pts=null, method='approx4';
  if(approx.rows === 4){ pts = matPoints(approx); }
  else{
    const rect=cv.minAreaRect(contour);
    pts = cv.RotatedRect.points(rect).map(p=>({x:p.x,y:p.y}));
    method='minAreaRectFallback';
  }
  approx.delete();
  if(!pts || pts.length!==4) return null;
  pts = orderQuad(pts);
  if(!quadInBounds(pts, src.cols, src.rows)) return null;
  const side = sideStats(pts);
  if(side.min < 20) return null;
  const aspectPenalty = Math.min(1, side.min/side.max);
  const center = quadCenter(pts);
  const centerDist = Math.hypot(center.x-src.cols/2, center.y-src.rows/2) / Math.hypot(src.cols/2, src.rows/2);

  const warp = warpQuad(src, pts, CARD.WARP_PX, CARD.WARP_PX);
  const inner = validateInnerBlack(warp);
  drawMatToCanvas(warp, 'debugWarp');
  warp.delete();

  const areaScore = clamp(area/(imgArea*0.12),0,1)*18;
  const aspectScore = aspectPenalty*18;
  const centerScore = (1-clamp(centerDist,0,1))*10;
  const innerScore = inner.score*45;
  const methodScore = method==='approx4'?9:2;
  const score = areaScore + aspectScore + centerScore + innerScore + methodScore;
  const confidence = clamp(score,0,100);
  const shapes = [
    {type:'poly', pts, color:'#24d18f', label:`Tarjeta exterior ${Math.round(confidence)}%`},
    {type:'point', x:center.x, y:center.y, color:'#5da9ff', label:'Centro tarjeta'}
  ];
  return {score, confidence, quad:pts, h:homographyArray(pts, [{x:0,y:0},{x:70,y:0},{x:70,y:70},{x:0,y:70}]), inner, thresholdName, shapes};
}
function validateInnerBlack(warp){
  let gray=new cv.Mat(); cv.cvtColor(warp, gray, cv.COLOR_RGBA2GRAY);
  const roiInner = gray.roi(new cv.Rect(CARD.INNER_START, CARD.INNER_START, CARD.INNER_END-CARD.INNER_START, CARD.INNER_END-CARD.INNER_START));
  const top = gray.roi(new cv.Rect(40,40,620,55));
  const bottom = gray.roi(new cv.Rect(40,605,620,55));
  const left = gray.roi(new cv.Rect(40,40,55,620));
  const right = gray.roi(new cv.Rect(605,40,55,620));
  const innerMean = cv.mean(roiInner)[0];
  const borderMean = (cv.mean(top)[0]+cv.mean(bottom)[0]+cv.mean(left)[0]+cv.mean(right)[0])/4;
  let darkMask=new cv.Mat(); cv.threshold(roiInner, darkMask, Math.max(70, (innerMean+borderMean)/2), 255, cv.THRESH_BINARY_INV);
  let contours=new cv.MatVector(), hierarchy=new cv.Mat();
  cv.findContours(darkMask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  let bestRect=null, bestArea=0;
  for(let i=0;i<contours.size();i++){
    const c=contours.get(i), area=cv.contourArea(c);
    if(area>bestArea){ bestArea=area; bestRect=cv.boundingRect(c); }
    c.delete();
  }
  const contrast = borderMean - innerMean;
  const expectedArea = 500*500;
  const areaRatio = bestArea ? bestArea/expectedArea : 0;
  const sizeW = bestRect ? bestRect.width : 0;
  const sizeH = bestRect ? bestRect.height : 0;
  const sizeScore = bestRect ? (1 - clamp((Math.abs(sizeW-500)+Math.abs(sizeH-500))/500,0,1)) : 0;
  const contrastScore = clamp(contrast/120,0,1);
  const areaScore = clamp(1-Math.abs(areaRatio-1),0,1);
  const score = clamp((contrastScore*.45 + sizeScore*.35 + areaScore*.20),0,1);
  const mmW = sizeW/10, mmH = sizeH/10;
  roiInner.delete(); top.delete(); bottom.delete(); left.delete(); right.delete(); darkMask.delete(); contours.delete(); hierarchy.delete(); gray.delete();
  return {score, contrast, innerMean, borderMean, widthMm:mmW, heightMm:mmH, areaRatio};
}

function saveReference(){
  if(!calibration){ toast('Primero calibra tarjeta 7×7 / 5×5'); return; }
  const res = analyzePatch(false);
  if(!res || !res.patch){ toast('No detecté parche para referencia'); return; }
  if(!res.text){ toast('No detecté bloque de texto. Ajusta zona de texto o luz.'); return; }
  reference = {
    createdAt:new Date().toISOString(),
    patch:{ widthMm:res.patch.widthMm, heightMm:res.patch.heightMm, areaMm2:res.patch.areaMm2, perimeterMm:res.patch.perimeterMm },
    text:{ centerXNorm:res.text.centerXNorm, centerYNorm:res.text.centerYNorm, angleDeg:res.text.angleDeg, widthNorm:res.text.widthNorm, heightNorm:res.text.heightNorm, marginLeftNorm:res.text.marginLeftNorm, marginRightNorm:res.text.marginRightNorm }
  };
  localStorage.setItem(STORE_KEYS.ref, JSON.stringify(reference));
  renderReferenceState();
  setStep('stepAudit');
  toast('Referencia aprobada guardada');
}

function analyzeAndMaybeRecord(record){
  if(!calibration){ toast('Primero calibra con la tarjeta 7×7 / 5×5'); return null; }
  const res = analyzePatch(true);
  if(!res) return null;
  lastAnalysis = res;
  drawOverlay(res);
  renderResult(res);
  sendMonitorPayload(res);
  if(record) addLog(res);
  else if(autoMode && res.patch){
    const sig = `${Math.round(res.patch.center.x/8)}-${Math.round(res.patch.center.y/8)}-${res.result}`;
    if(sig !== lastLoggedSignature){ addLog(res); lastLoggedSignature=sig; }
  }
  return res;
}
function analyzePatch(updateDebug=true){
  if(!cvReady()){ toast('OpenCV aún no está listo'); return null; }
  if(!grabFrame()){ toast('No hay imagen'); return null; }
  let src=cv.imread(capture);
  let result=null;
  try{
    const patch = detectPatch(src);
    if(!patch){
      result = {stage:'audit', result:'ESPERANDO', pass:false, reason:'No detecté silueta del parche.', imageSize:{w:capture.width,h:capture.height}, shapes:[]};
      return result;
    }
    const text = detectTextInPatch(patch.patchWarp, patch.widthMm, patch.heightMm, patch.box);
    const evalRes = evaluatePatchAndText(patch, text);
    result = {stage:'audit', result:evalRes.pass?'APROBADO':'RECHAZADO', pass:evalRes.pass, reason:evalRes.reason, imageSize:{w:capture.width,h:capture.height}, patch, text, shapes:[...patch.shapes, ...(text?.shapesOriginal || [])], score:evalRes.score};
    if(updateDebug){ drawMatToCanvas(patch.patchWarp, 'debugPatch'); if(text?.mask) drawMatToCanvas(text.mask, 'debugText'); }
    if(text?.mask) text.mask.delete?.();
    patch.patchWarp.delete?.();
  }catch(e){ console.error(e); toast('Error analizando parche'); }
  finally{ src.delete(); }
  return result;
}

function detectPatch(src){
  const roiRect = calibrationROI(src.cols, src.rows);
  let roi = src.roi(roiRect);
  let gray=new cv.Mat(), blur=new cv.Mat(), edges=new cv.Mat(), closed=new cv.Mat(), contours=new cv.MatVector(), hierarchy=new cv.Mat();
  try{
    cv.cvtColor(roi, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5,5), 0);
    cv.Canny(blur, edges, 35, 120);
    const k=cv.Mat.ones(5,5,cv.CV_8U);
    cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, k);
    k.delete();
    cv.findContours(closed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let best=null, bestScore=0;
    for(let i=0;i<contours.size();i++){
      const c=contours.get(i);
      const area=cv.contourArea(c);
      if(area < roiRect.width*roiRect.height*0.015 || area > roiRect.width*roiRect.height*0.82){ c.delete(); continue; }
      const rect=cv.minAreaRect(c);
      const pts = cv.RotatedRect.points(rect).map(p=>({x:p.x+roiRect.x,y:p.y+roiRect.y}));
      const bbox=cv.boundingRect(c);
      const center={x:roiRect.x + bbox.x + bbox.width/2, y:roiRect.y + bbox.y + bbox.height/2};
      const rectArea = Math.max(1, rect.size.width*rect.size.height);
      const fill = area/rectArea;
      const centerScore = 1 - clamp(Math.hypot(center.x-src.cols/2, center.y-src.rows/2)/Math.hypot(src.cols/2,src.rows/2),0,1);
      const score = area * (0.35+fill) * (0.6+centerScore);
      if(score>bestScore){ bestScore=score; best={contour:c, rect, pts, center, areaPx:area}; }
      else c.delete();
    }
    if(!best) return null;
    const boxOrdered = orderQuad(best.pts);
    const metricPts = boxOrdered.map(p=>transformPoint(calibration.h,p.x,p.y));
    const w1=dist(metricPts[0],metricPts[1]), w2=dist(metricPts[3],metricPts[2]), h1=dist(metricPts[0],metricPts[3]), h2=dist(metricPts[1],metricPts[2]);
    const widthMm=(w1+w2)/2, heightMm=(h1+h2)/2;
    const contourPts = contourToPoints(best.contour, roiRect.x, roiRect.y).map(p=>transformPoint(calibration.h,p.x,p.y));
    const perimeterMm = polygonPerimeter(contourPts);
    const areaMm2 = Math.abs(polygonArea(contourPts));
    const angleDeg = normalizeRectAngle(best.rect.angle, best.rect.size.width, best.rect.size.height);
    const patchWarp = warpQuad(src, boxOrdered, Math.max(120, Math.round(widthMm*10)), Math.max(120, Math.round(heightMm*10)));
    const shapes=[
      {type:'poly', pts:contourToPoints(best.contour, roiRect.x, roiRect.y, 3), color:'#24d18f', label:'Silueta parche'},
      {type:'poly', pts:boxOrdered, color:'#ffd166', label:'Caja parche'},
      {type:'cross', x:best.center.x, y:best.center.y, color:'#5da9ff', label:'Centro parche'}
    ];
    best.contour.delete();
    return {widthMm,heightMm,perimeterMm,areaMm2,angleDeg,box:boxOrdered,center:best.center,patchWarp,shapes};
  } finally { roi.delete(); gray.delete(); blur.delete(); edges.delete(); closed.delete(); contours.delete(); hierarchy.delete(); }
}
function calibrationROI(w,h){
  if(!calibration?.quad) return new cv.Rect(0,0,w,h);
  const xs=calibration.quad.map(p=>p.x), ys=calibration.quad.map(p=>p.y);
  const minX=Math.max(0, Math.min(...xs)), maxX=Math.min(w, Math.max(...xs));
  const minY=Math.max(0, Math.min(...ys)), maxY=Math.min(h, Math.max(...ys));
  const bw=maxX-minX, bh=maxY-minY;
  const pad=Math.max(bw,bh)*0.45;
  const x=Math.max(0, Math.floor(minX-pad)), y=Math.max(0, Math.floor(minY-pad));
  const x2=Math.min(w, Math.ceil(maxX+pad)), y2=Math.min(h, Math.ceil(maxY+pad));
  return new cv.Rect(x,y,Math.max(1,x2-x),Math.max(1,y2-y));
}

function detectTextInPatch(patchWarp, patchWmm, patchHmm, patchBoxOriginal){
  const c = cfg();
  const W=patchWarp.cols, H=patchWarp.rows;
  const y0=Math.floor(H*Math.min(c.textYStart,c.textYEnd-0.02));
  const y1=Math.floor(H*Math.max(c.textYEnd,c.textYStart+0.02));
  const roiRect=new cv.Rect(0, y0, W, Math.max(1,y1-y0));
  let roi=patchWarp.roi(roiRect), gray=new cv.Mat(), eq=new cv.Mat();
  cv.cvtColor(roi, gray, cv.COLOR_RGBA2GRAY);
  cv.equalizeHist(gray, eq);
  const candidates=[];
  const modes=[cv.THRESH_BINARY_INV, cv.THRESH_BINARY];
  for(const mode of modes){
    let mask=new cv.Mat(), close=new cv.Mat(), contours=new cv.MatVector(), hierarchy=new cv.Mat();
    try{
      cv.adaptiveThreshold(eq, mask, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, mode, 31, 5);
      const kH=cv.Mat.ones(5,17,cv.CV_8U);
      const kO=cv.Mat.ones(2,2,cv.CV_8U);
      cv.morphologyEx(mask, close, cv.MORPH_CLOSE, kH);
      cv.morphologyEx(close, close, cv.MORPH_OPEN, kO);
      kH.delete(); kO.delete();
      cv.findContours(close, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      const boxes=[];
      for(let i=0;i<contours.size();i++){
        const cnt=contours.get(i); const area=cv.contourArea(cnt); const r=cv.boundingRect(cnt);
        cnt.delete();
        if(area < W*H*0.00012) continue;
        if(r.width < W*0.03 || r.height < H*0.006) continue;
        if(r.width/r.height < 1.2) continue;
        boxes.push({x:r.x,y:r.y+y0,w:r.width,h:r.height,area});
      }
      const union = unionBoxes(boxes);
      if(union){
        const areaRatio=(union.w*union.h)/(W*H);
        const shapeScore = clamp((union.w/Math.max(1,union.h))/8,0,1);
        const sizeScore = areaRatio>0.001 && areaRatio<0.38 ? 1 : 0.2;
        candidates.push({mode, union, score:shapeScore*45+sizeScore*35+boxes.length*2, mask:close.clone()});
      }
    } finally { mask.delete(); close.delete(); contours.delete(); hierarchy.delete(); }
  }
  roi.delete(); gray.delete(); eq.delete();
  if(!candidates.length) return null;
  candidates.sort((a,b)=>b.score-a.score);
  const best=candidates[0]; candidates.slice(1).forEach(x=>x.mask.delete());
  const b=best.union;
  const centerX=b.x+b.w/2, centerY=b.y+b.h/2;
  // Angle: approximate via minAreaRect on selected ROI mask translated into patch coords
  let angleDeg=0;
  try{
    let contours=new cv.MatVector(), hierarchy=new cv.Mat();
    cv.findContours(best.mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let pts=[];
    for(let i=0;i<contours.size();i++){
      const cnt=contours.get(i); const r=cv.boundingRect(cnt);
      if(r.width>W*0.03 && r.height>2) pts.push({x:r.x+r.width/2, y:r.y+y0+r.height/2});
      cnt.delete();
    }
    if(pts.length>=2){
      const lr = linearRegressionAngle(pts);
      angleDeg = lr;
    }
    contours.delete(); hierarchy.delete();
  }catch{}
  const patchWpx=W, patchHpx=H;
  const mmPerPxX = patchWmm / patchWpx;
  const mmPerPxY = patchHmm / patchHpx;
  const marginLeftMm = b.x * mmPerPxX;
  const marginRightMm = (W - (b.x+b.w)) * mmPerPxX;
  const marginTopMm = b.y * mmPerPxY;
  const marginBottomMm = (H - (b.y+b.h)) * mmPerPxY;
  const offsetXmm = (centerX - W/2) * mmPerPxX;
  const offsetYmm = (centerY - H/2) * mmPerPxY;
  const shapesOriginal = projectTextBoxToOriginal(b, patchBoxOriginal, W, H);
  return {
    x:b.x,y:b.y,w:b.w,h:b.h, centerX, centerY,
    centerXNorm:centerX/W, centerYNorm:centerY/H, widthNorm:b.w/W, heightNorm:b.h/H,
    marginLeftNorm:b.x/W, marginRightNorm:(W-b.x-b.w)/W,
    marginLeftMm, marginRightMm, marginTopMm, marginBottomMm, offsetXmm, offsetYmm, angleDeg,
    widthMm:b.w*mmPerPxX, heightMm:b.h*mmPerPxY,
    mask:best.mask, shapesOriginal
  };
}
function projectTextBoxToOriginal(b, patchBoxOriginal, W, H){
  if(!patchBoxOriginal) return [];
  const Hback = homographyArray([{x:0,y:0},{x:W,y:0},{x:W,y:H},{x:0,y:H}], patchBoxOriginal);
  const box = [
    transformPoint(Hback,b.x,b.y),
    transformPoint(Hback,b.x+b.w,b.y),
    transformPoint(Hback,b.x+b.w,b.y+b.h),
    transformPoint(Hback,b.x,b.y+b.h)
  ];
  const patchCenterTop = transformPoint(Hback,W/2,0);
  const patchCenterBottom = transformPoint(Hback,W/2,H);
  const textCenterTop = transformPoint(Hback,b.x+b.w/2,b.y);
  const textCenterBottom = transformPoint(Hback,b.x+b.w/2,b.y+b.h);
  const textLeftTop = transformPoint(Hback,b.x,b.y);
  const textLeftBottom = transformPoint(Hback,b.x,b.y+b.h);
  const textRightTop = transformPoint(Hback,b.x+b.w,b.y);
  const textRightBottom = transformPoint(Hback,b.x+b.w,b.y+b.h);
  return [
    {type:'poly', pts:box, color:'#ffd166', label:'Bloque texto'},
    {type:'line', x1:patchCenterTop.x, y1:patchCenterTop.y, x2:patchCenterBottom.x, y2:patchCenterBottom.y, color:'#5da9ff', label:'Centro parche'},
    {type:'line', x1:textCenterTop.x, y1:textCenterTop.y, x2:textCenterBottom.x, y2:textCenterBottom.y, color:'#ff5265', label:'Centro texto'},
    {type:'line', x1:textLeftTop.x, y1:textLeftTop.y, x2:textLeftBottom.x, y2:textLeftBottom.y, color:'#ffffff', label:'Margen izq'},
    {type:'line', x1:textRightTop.x, y1:textRightTop.y, x2:textRightBottom.x, y2:textRightBottom.y, color:'#ffffff', label:'Margen der'}
  ];
}
function unionBoxes(boxes){
  if(!boxes.length) return null;
  const x1=Math.min(...boxes.map(b=>b.x)); const y1=Math.min(...boxes.map(b=>b.y));
  const x2=Math.max(...boxes.map(b=>b.x+b.w)); const y2=Math.max(...boxes.map(b=>b.y+b.h));
  return {x:x1,y:y1,w:x2-x1,h:y2-y1};
}
function linearRegressionAngle(points){
  const n=points.length; let sx=0,sy=0,sxx=0,sxy=0;
  points.forEach(p=>{sx+=p.x;sy+=p.y;sxx+=p.x*p.x;sxy+=p.x*p.y;});
  const den=n*sxx-sx*sx; if(Math.abs(den)<1e-6) return 0;
  const m=(n*sxy-sx*sy)/den;
  return Math.atan(m)*180/Math.PI;
}

function evaluatePatchAndText(patch, text){
  const c=cfg(); let reasons=[], pass=true, score=0;
  if(!text){
    if(c.chkText){ pass=false; reasons.push('No detecté bloque de texto'); }
    return {pass, reason:reasons.join('; ')||'Sin texto detectado', score:0};
  }
  let targetX=0.5, targetY=0.5, targetAngle=0;
  if(reference?.text){ targetX=reference.text.centerXNorm; targetY=reference.text.centerYNorm; targetAngle=reference.text.angleDeg || 0; }
  const errXmm = (text.centerXNorm-targetX)*patch.widthMm;
  const errYmm = (text.centerYNorm-targetY)*patch.heightMm;
  const errAng = Math.abs(normalizeAngleDelta(text.angleDeg-targetAngle));
  const scoreX = 100*(1-clamp(Math.abs(errXmm)/c.maxErrX,0,1));
  const scoreY = 100*(1-clamp(Math.abs(errYmm)/c.maxErrY,0,1));
  const scoreA = 100*(1-clamp(errAng/c.maxTextAngle,0,1));
  score = Math.round(scoreX*0.50 + scoreY*0.30 + scoreA*0.20);
  text.alignmentScore=score; text.errXmm=errXmm; text.errYmm=errYmm; text.errAngleDeg=errAng;
  if(c.chkText && score < c.minAlign){ pass=false; reasons.push(`Texto alineado ${score}%, mínimo ${c.minAlign}%`); }
  if(c.chkText && Math.abs(errXmm)>c.maxErrX){ reasons.push(`Texto corrido ${errXmm>0?'derecha':'izquierda'} ${Math.abs(errXmm).toFixed(1)} mm`); }
  if(c.chkText && errAng>c.maxTextAngle){ reasons.push(`Texto inclinado ${errAng.toFixed(1)}°`); }
  if(c.chkSize && reference?.patch){
    const dw = Math.abs(patch.widthMm-reference.patch.widthMm)/reference.patch.widthMm;
    const dh = Math.abs(patch.heightMm-reference.patch.heightMm)/reference.patch.heightMm;
    if(dw>0.035 || dh>0.035){ pass=false; reasons.push('Tamaño fuera de referencia ±3.5%'); }
  }
  if(c.chkArea && reference?.patch){
    const da = Math.abs(patch.areaMm2-reference.patch.areaMm2)/reference.patch.areaMm2;
    const dp = Math.abs(patch.perimeterMm-reference.patch.perimeterMm)/reference.patch.perimeterMm;
    if(da>0.06 || dp>0.04){ pass=false; reasons.push('Área/perímetro fuera de referencia'); }
  }
  return {pass, reason:reasons.join('; ') || `Texto alineado ${score}%`, score};
}

function renderResult(res){
  if(!res || !res.patch){
    $('decision').textContent='ESPERANDO'; $('decision').className='decision neutral'; $('reason').textContent=res?.reason || 'Esperando parche.'; return;
  }
  $('decision').textContent=res.pass?'APROBADO':'RECHAZADO'; $('decision').className='decision '+(res.pass?'ok':'bad');
  $('reason').textContent=res.reason;
  $('mAlign').textContent=res.text?.alignmentScore!=null ? `${res.text.alignmentScore}%` : '--';
  $('mSize').textContent=`${(res.patch.widthMm/10).toFixed(2)} × ${(res.patch.heightMm/10).toFixed(2)} cm`;
  $('mPerimeter').textContent=`${(res.patch.perimeterMm/10).toFixed(2)} cm`;
  $('mArea').textContent=`${(res.patch.areaMm2/100).toFixed(2)} cm²`;
  $('mTextOffset').textContent=res.text ? `${res.text.errXmm?.toFixed(1) ?? res.text.offsetXmm.toFixed(1)} mm` : '--';
  $('mTextAngle').textContent=res.text ? `${(res.text.errAngleDeg ?? Math.abs(res.text.angleDeg)).toFixed(1)}°` : '--';
}
function renderCalibrationState(){
  if(!calibration){
    $('calState').textContent='Sin calibrar'; $('calConfidence').textContent='--'; $('calScale').textContent='--'; $('innerSize').textContent='--';
    setStep('stepCal');
    return;
  }
  $('calState').textContent='Calibrada';
  $('calConfidence').textContent=`${Math.round(calibration.confidence)}%`;
  $('calScale').textContent=`${calibration.pxPerMm.toFixed(2)} px/mm`;
  $('innerSize').textContent=`${calibration.inner.widthMm.toFixed(1)} × ${calibration.inner.heightMm.toFixed(1)} mm`;
}
function renderReferenceState(){
  $('refState').textContent = reference ? `Referencia guardada: ${(reference.patch.widthMm/10).toFixed(2)}×${(reference.patch.heightMm/10).toFixed(2)} cm, texto ideal X ${(reference.text.centerXNorm*100).toFixed(1)}%.` : 'Referencia: no guardada.';
}
function addLog(res){
  if(!res?.patch) return;
  const row={
    time:new Date().toLocaleString(), lot:cfg().lot, result:res.result,
    align:res.text?.alignmentScore ?? '', size:`${(res.patch.widthMm/10).toFixed(2)}x${(res.patch.heightMm/10).toFixed(2)}`,
    perimeter:(res.patch.perimeterMm/10).toFixed(2), area:(res.patch.areaMm2/100).toFixed(2), reason:res.reason
  };
  log.unshift(row); log=log.slice(0,1000); localStorage.setItem(STORE_KEYS.log, JSON.stringify(log)); renderLog();
}
function renderLog(){
  $('logBody').innerHTML = log.map(r=>`<tr><td>${escapeHtml(r.time)}</td><td>${escapeHtml(r.lot)}</td><td>${escapeHtml(r.result)}</td><td>${escapeHtml(String(r.align))}</td><td>${escapeHtml(r.size)}</td><td>${escapeHtml(r.perimeter)}</td><td>${escapeHtml(r.area)}</td><td>${escapeHtml(r.reason)}</td></tr>`).join('');
  const ok=log.filter(r=>r.result==='APROBADO').length, bad=log.filter(r=>r.result==='RECHAZADO').length, total=log.length;
  $('okCount').textContent=ok; $('badCount').textContent=bad; $('totalCount').textContent=total; $('okPct').textContent=total?`${Math.round(ok/total*100)}%`:'--';
}
function exportCSV(){
  const head='Hora,Lote,Resultado,Alineacion,Tamano_cm,Perimetro_cm,Area_cm2,Motivo\n';
  const body=log.map(r=>[r.time,r.lot,r.result,r.align,r.size,r.perimeter,r.area,`"${String(r.reason).replaceAll('"','""')}"`].join(',')).join('\n');
  const blob=new Blob([head+body],{type:'text/csv;charset=utf-8'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='historial_inspector_parches_v9.csv'; a.click();
}
function escapeHtml(s){ return String(s).replace(/[&<>"]/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch])); }

function toggleAuto(){
  autoMode=!autoMode; $('btnAuto').dataset.active=String(autoMode); $('btnAuto').textContent='Auto: '+(autoMode?'ON':'OFF');
  toast(autoMode?'Auto activo: registra cuando cambie la pieza':'Auto detenido');
  lastLoggedSignature='';
}

// Monitor PC via PeerJS
async function connectMonitor(){
  const id = $('monitorId').value.trim();
  if(!id){ toast('Primero abre monitor.html en PC y escanea el QR'); return; }
  if(typeof Peer === 'undefined'){ toast('PeerJS no cargó. Revisa internet.'); return; }
  try{
    if(!peer) peer = new Peer();
    peer.on('error', e=>{ console.error(e); setBadge('monitorStatus','Error PC','bad'); });
    await peerReady(peer);
    if(monitorConn?.open) monitorConn.close();
    monitorConn = peer.connect(id, {reliable:true});
    monitorConn.on('open', ()=>{ setBadge('monitorStatus','PC conectado','ok'); toast('Monitor PC conectado'); sendMonitor({type:'hello', from:'phone', imageSize:{w:capture.width,h:capture.height}}); });
    monitorConn.on('close', ()=> setBadge('monitorStatus','PC desconectado','warn'));
    if(stream){
      try{ monitorCall = peer.call(id, stream); }catch(e){ console.warn(e); }
    }
  }catch(e){ console.error(e); setBadge('monitorStatus','Error PC','bad'); toast('No conectó con PC'); }
}
function peerReady(p){ return new Promise(resolve=>{ if(p.open) resolve(); else p.on('open', resolve); }); }
function sendMonitor(obj){ if(monitorConn?.open) monitorConn.send(obj); }
function sendMonitorPayload(res){
  const payload={
    type:'analysis', stage:res.stage, result:res.result, pass:res.pass, reason:res.reason,
    imageSize:res.imageSize, shapes:res.shapes,
    patch: res.patch?{widthCm:res.patch.widthMm/10,heightCm:res.patch.heightMm/10,perimeterCm:res.patch.perimeterMm/10,areaCm2:res.patch.areaMm2/100,angleDeg:res.patch.angleDeg}:null,
    text: res.text?{alignmentScore:res.text.alignmentScore, offsetMm:res.text.errXmm ?? res.text.offsetXmm, verticalMm:res.text.errYmm ?? res.text.offsetYmm, angleDeg:res.text.errAngleDeg ?? res.text.angleDeg, margins:{leftMm:res.text.marginLeftMm,rightMm:res.text.marginRightMm}}:null
  };
  sendMonitor(payload);
}

// Overlay drawing
function drawOverlay(res){
  const cw=overlay.clientWidth, ch=overlay.clientHeight;
  octx.clearRect(0,0,cw,ch);
  if(usingPhoto && workCanvas.width){ octx.drawImage(workCanvas,0,0,cw,ch); }
  if(!res?.shapes?.length) return;
  const imgW=res.imageSize?.w || capture.width || video.videoWidth || 1;
  const imgH=res.imageSize?.h || capture.height || video.videoHeight || 1;
  const fit = containFit(imgW,imgH,cw,ch);
  octx.save();
  octx.translate(fit.x,fit.y); octx.scale(fit.s,fit.s);
  res.shapes.forEach(s=>drawShape(octx,s));
  octx.restore();
}
function containFit(iw,ih,cw,ch){ const s=Math.min(cw/iw,ch/ih); return {s,x:(cw-iw*s)/2,y:(ch-ih*s)/2}; }
function drawShape(ctx,s){
  ctx.lineWidth=3/((ctx.getTransform?.().a)||1); ctx.strokeStyle=s.color||'#24d18f'; ctx.fillStyle=s.color||'#24d18f'; ctx.font=`${15/((ctx.getTransform?.().a)||1)}px system-ui`;
  if(s.type==='poly' && s.pts?.length){ ctx.beginPath(); s.pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)); ctx.closePath(); ctx.stroke(); if(s.label) ctx.fillText(s.label, s.pts[0].x+5, s.pts[0].y-7); }
  if(s.type==='point'){ ctx.beginPath(); ctx.arc(s.x,s.y,6,0,Math.PI*2); ctx.fill(); if(s.label) ctx.fillText(s.label,s.x+8,s.y-8); }
  if(s.type==='cross'){ const r=12; ctx.beginPath(); ctx.moveTo(s.x-r,s.y); ctx.lineTo(s.x+r,s.y); ctx.moveTo(s.x,s.y-r); ctx.lineTo(s.x,s.y+r); ctx.stroke(); if(s.label) ctx.fillText(s.label,s.x+8,s.y-8); }
  if(s.type==='line'){ ctx.beginPath(); ctx.moveTo(s.x1,s.y1); ctx.lineTo(s.x2,s.y2); ctx.stroke(); if(s.label) ctx.fillText(s.label,s.x1+5,s.y1-7); }
}

// OpenCV helpers
function matPoints(mat){
  const pts=[]; const data = mat.data32S?.length ? mat.data32S : mat.data32F;
  for(let i=0;i<mat.rows;i++) pts.push({x:data[i*2], y:data[i*2+1]});
  return pts;
}
function contourToPoints(contour, ox=0, oy=0, step=1){
  const pts=[]; const data=contour.data32S;
  for(let i=0;i<contour.rows;i+=step) pts.push({x:data[i*2]+ox,y:data[i*2+1]+oy});
  return pts;
}
function orderQuad(pts){
  const c=quadCenter(pts);
  const arr=pts.map(p=>({...p, a:Math.atan2(p.y-c.y,p.x-c.x)})).sort((a,b)=>a.a-b.a);
  // sorted around center; choose top-left first
  let ordered=[arr[0],arr[1],arr[2],arr[3]].map(({x,y})=>({x,y}));
  const sums=ordered.map(p=>p.x+p.y); const idx=sums.indexOf(Math.min(...sums));
  ordered=[...ordered.slice(idx),...ordered.slice(0,idx)];
  // Ensure order is TL,TR,BR,BL clockwise
  if(cross(ordered[0],ordered[1],ordered[2])<0) ordered=[ordered[0],ordered[3],ordered[2],ordered[1]];
  return ordered;
}
function cross(a,b,c){ return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x); }
function quadCenter(pts){ return {x:pts.reduce((s,p)=>s+p.x,0)/pts.length, y:pts.reduce((s,p)=>s+p.y,0)/pts.length}; }
function quadInBounds(pts,w,h){ return pts.every(p=>p.x>=-10&&p.y>=-10&&p.x<=w+10&&p.y<=h+10); }
function sideStats(pts){ const sides=[dist(pts[0],pts[1]),dist(pts[1],pts[2]),dist(pts[2],pts[3]),dist(pts[3],pts[0])]; return {sides,min:Math.min(...sides),max:Math.max(...sides)}; }
function dist(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }
function warpQuad(src, pts, w, h){
  const srcTri=cv.matFromArray(4,1,cv.CV_32FC2,[pts[0].x,pts[0].y, pts[1].x,pts[1].y, pts[2].x,pts[2].y, pts[3].x,pts[3].y]);
  const dstTri=cv.matFromArray(4,1,cv.CV_32FC2,[0,0, w,0, w,h, 0,h]);
  const M=cv.getPerspectiveTransform(srcTri,dstTri); const dst=new cv.Mat();
  cv.warpPerspective(src,dst,M,new cv.Size(w,h),cv.INTER_LINEAR,cv.BORDER_CONSTANT,new cv.Scalar());
  srcTri.delete(); dstTri.delete(); M.delete(); return dst;
}
function homographyArray(srcPts, dstPts){
  const src=cv.matFromArray(4,1,cv.CV_32FC2,[srcPts[0].x,srcPts[0].y, srcPts[1].x,srcPts[1].y, srcPts[2].x,srcPts[2].y, srcPts[3].x,srcPts[3].y]);
  const dst=cv.matFromArray(4,1,cv.CV_32FC2,[dstPts[0].x,dstPts[0].y, dstPts[1].x,dstPts[1].y, dstPts[2].x,dstPts[2].y, dstPts[3].x,dstPts[3].y]);
  const M=cv.getPerspectiveTransform(src,dst); const arr=Array.from(M.data64F?.length?M.data64F:M.data32F);
  src.delete(); dst.delete(); M.delete(); return arr;
}
function transformPoint(h,x,y){ const den=h[6]*x+h[7]*y+h[8]; return {x:(h[0]*x+h[1]*y+h[2])/den, y:(h[3]*x+h[4]*y+h[5])/den}; }
function polygonArea(pts){ let s=0; for(let i=0;i<pts.length;i++){ const a=pts[i], b=pts[(i+1)%pts.length]; s += a.x*b.y-b.x*a.y; } return s/2; }
function polygonPerimeter(pts){ let s=0; for(let i=0;i<pts.length;i++) s+=dist(pts[i],pts[(i+1)%pts.length]); return s; }
function normalizeRectAngle(angle,w,h){ let a=angle; if(w<h) a=angle+90; if(a>45)a-=90; if(a<-45)a+=90; return a; }
function normalizeAngleDelta(a){ while(a>90)a-=180; while(a<-90)a+=180; return a; }
function drawMatToCanvas(mat, canvasId){
  const canvas=$(canvasId); if(!canvas) return;
  try{ cv.imshow(canvas, mat); }catch(e){ console.warn('debug draw fail', canvasId, e); }
}
