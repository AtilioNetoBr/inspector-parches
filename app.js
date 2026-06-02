/* Inspector de Parches Pro v10
   Enfoque: iPhone analiza, PC monitorea/controla. Tarjeta 7x7/5x5 como patrón de calibración.
*/
const $ = id => document.getElementById(id);
const video = $('video');
const overlay = $('overlay');
const octx = overlay.getContext('2d');
const capture = $('captureCanvas');
const capCtx = capture.getContext('2d', { willReadFrequently: true });
const debugCanvas = $('debugCanvas');
const dctx = debugCanvas.getContext('2d', { willReadFrequently: true });

const APP_VERSION = '10.0';
const OUTER_MM = 70;
const INNER_MM = 50;
const WARP_SIZE = 700;
const PX_PER_MM = WARP_SIZE / OUTER_MM; // 10 px/mm
const PEER_PREFIX = 'mardur-inspector-v10-';

let stream = null;
let devices = [];
let currentDeviceIndex = -1;
let autoMode = false;
let lastAutoTs = 0;
let lastSendDebugTs = 0;
let stableCandidate = null;
let calibration = JSON.parse(localStorage.getItem('v10_calibration') || 'null');
let reference = JSON.parse(localStorage.getItem('v10_reference') || 'null');
let log = JSON.parse(localStorage.getItem('v10_log') || '[]');
let lastAnalysisKey = '';
let lockedUntilEmpty = false;

let peer = null;
let pcConn = null;
let pcCode = new URLSearchParams(location.search).get('code') || '';
if (pcCode) $('pairCode').value = pcCode.toUpperCase();

function toast(msg){ const t=$('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove('show'),2200); }
function setBadge(text, cls='idle'){ $('statusBadge').textContent=text; $('statusBadge').className='badge '+cls; }
function setStep(id, state, msg){ const el=$(id); el.className='step '+(state||'pending'); if(msg) el.querySelector('em').textContent=msg; }
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
function fmt(n,d=1){ return Number.isFinite(n) ? n.toFixed(d) : '--'; }
function mmToCm(mm){ return mm/10; }
function scoreFromError(err, maxErr){ if(!Number.isFinite(err) || maxErr<=0) return 0; return clamp(100 - (Math.abs(err)/maxErr)*100, 0, 100); }
function nowStr(){ return new Date().toLocaleString(); }
function cfg(){ return {
  validateText:$('validateText').checked,
  validateSize:$('validateSize').checked,
  validateShape:$('validateShape').checked,
  minScore:+$('minScore').value || 85,
  maxErrX:+$('maxErrX').value || 3,
  maxErrY:+$('maxErrY').value || 3,
  maxErrBase:+$('maxErrBase').value || 2.5,
  maxTextAngle:+$('maxTextAngle').value || 5,
  sizeTolPct:+$('sizeTolPct').value || 5,
  textZoneStart:+$('textZoneStart').value || 62,
  textZoneEnd:+$('textZoneEnd').value || 96
};}
function applyConfig(c){ if(!c) return; const map={validateText:'validateText',validateSize:'validateSize',validateShape:'validateShape',minScore:'minScore',maxErrX:'maxErrX',maxErrY:'maxErrY',maxErrBase:'maxErrBase',maxTextAngle:'maxTextAngle',sizeTolPct:'sizeTolPct',textZoneStart:'textZoneStart',textZoneEnd:'textZoneEnd'}; Object.entries(map).forEach(([k,id])=>{ if(c[k]!==undefined){ if($(id).type==='checkbox') $(id).checked=!!c[k]; else $(id).value=c[k]; }}); sendState(); }
function sendPC(obj){ if(pcConn && pcConn.open){ try{ pcConn.send(obj); }catch(e){ console.warn('sendPC',e); } } }
function sendState(){ sendPC({type:'state', version:APP_VERSION, camera:!!stream, calibration:!!calibration, reference:!!reference, autoMode, config:cfg(), counts:getCounts()}); }

function resizeOverlay(){ const r=video.getBoundingClientRect(); overlay.width=Math.max(1, Math.round(r.width*devicePixelRatio)); overlay.height=Math.max(1, Math.round(r.height*devicePixelRatio)); octx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0); }
window.addEventListener('resize', resizeOverlay);

async function listDevices(){
  if(!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  devices = all.filter(d=>d.kind==='videoinput');
  return devices;
}
async function startCamera(deviceId=null){
  if(!navigator.mediaDevices?.getUserMedia){ toast('Este navegador no permite cámara web. Usa Safari/Chrome en HTTPS.'); setBadge('Sin getUserMedia','bad'); return; }
  stopCamera();
  const attempts = [];
  if(deviceId) attempts.push({video:{deviceId:{exact:deviceId}, width:{ideal:1280}, height:{ideal:720}}, audio:false});
  attempts.push({video:{facingMode:{ideal:'environment'}, width:{ideal:1280}, height:{ideal:720}}, audio:false});
  attempts.push({video:{facingMode:{ideal:'environment'}}, audio:false});
  attempts.push({video:true, audio:false});
  let lastErr=null;
  for(const constraints of attempts){
    try{
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      await video.play();
      await listDevices();
      setBadge('Cámara activa','live'); setStep('stepCamera','ok','Cámara activa');
      resizeOverlay(); loop(); sendState(); toast('Cámara iniciada');
      if(pcConn && pcConn.open){ try { peer.call(PEER_PREFIX + $('pairCode').value.trim().toLowerCase(), stream); } catch(e){} }
      return;
    }catch(err){ lastErr=err; console.warn('camera attempt failed', constraints, err); }
  }
  setBadge('Error cámara','bad'); setStep('stepCamera','bad','No abre cámara');
  const msg = lastErr?.name || 'Error desconocido';
  $('cameraHelp').textContent = `Error cámara: ${msg}. Revisa permisos, HTTPS, apps usando cámara y caché.`;
  toast('No abre cámara: '+msg);
  sendPC({type:'error', scope:'camera', message:msg});
}
function stopCamera(){ if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; } }
async function switchCamera(){
  await listDevices();
  if(!devices.length){ toast('No encuentro lista de cámaras. Intento genérico.'); return startCamera(); }
  currentDeviceIndex = (currentDeviceIndex + 1) % devices.length;
  await startCamera(devices[currentDeviceIndex].deviceId);
}
function grabFrame(){
  const vw = video.videoWidth, vh = video.videoHeight;
  if(!vw || !vh) return false;
  capture.width=vw; capture.height=vh; capCtx.drawImage(video,0,0,vw,vh); return true;
}
function loadPhoto(file){ return new Promise((resolve,reject)=>{ const img=new Image(); img.onload=()=>{ capture.width=img.naturalWidth; capture.height=img.naturalHeight; capCtx.drawImage(img,0,0); resolve(true); }; img.onerror=reject; img.src=URL.createObjectURL(file); }); }

function requireCV(){ if(!window.cvReady || typeof cv==='undefined'){ toast('OpenCV aún está cargando. Espera unos segundos.'); return false; } return true; }
function getMatFromCapture(){ return cv.imread(capture); }
function orderPts(pts){
  pts = pts.map(p=>({x:+p.x,y:+p.y}));
  const sums=pts.map(p=>p.x+p.y), diffs=pts.map(p=>p.x-p.y);
  const tl=pts[sums.indexOf(Math.min(...sums))];
  const br=pts[sums.indexOf(Math.max(...sums))];
  const tr=pts[diffs.indexOf(Math.max(...diffs))];
  const bl=pts[diffs.indexOf(Math.min(...diffs))];
  return [tl,tr,br,bl];
}
function dist(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }
function polygonArea(pts){ let s=0; for(let i=0;i<pts.length;i++){ const a=pts[i], b=pts[(i+1)%pts.length]; s += a.x*b.y-b.x*a.y; } return Math.abs(s/2); }
function approxToPts(approx){ const data=approx.data32S; const pts=[]; for(let i=0;i<data.length;i+=2) pts.push({x:data[i],y:data[i+1]}); return pts; }
function rectPoints(rect){ return cv.RotatedRect.points(rect).map(p=>({x:p.x,y:p.y})); }
function makePerspective(srcPts, dstSize=WARP_SIZE){
  const ordered=orderPts(srcPts);
  const srcTri=cv.matFromArray(4,1,cv.CV_32FC2,[ordered[0].x,ordered[0].y,ordered[1].x,ordered[1].y,ordered[2].x,ordered[2].y,ordered[3].x,ordered[3].y]);
  const dstTri=cv.matFromArray(4,1,cv.CV_32FC2,[0,0,dstSize,0,dstSize,dstSize,0,dstSize]);
  const M=cv.getPerspectiveTransform(srcTri,dstTri);
  srcTri.delete(); dstTri.delete();
  return {M, ordered};
}
function warpWithM(src, M, size=WARP_SIZE){ const dst=new cv.Mat(); cv.warpPerspective(src,dst,M,new cv.Size(size,size),cv.INTER_LINEAR,cv.BORDER_CONSTANT,new cv.Scalar(0,0,0,255)); return dst; }
function drawDebugBackground(mat){
  try{ cv.imshow(debugCanvas, mat); }catch(e){ dctx.fillStyle='#020915'; dctx.fillRect(0,0,700,700); }
}
function drawLine(ctx,a,b,color,w=3){ ctx.strokeStyle=color; ctx.lineWidth=w; ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); }
function drawRect(ctx, r, color, w=3){ ctx.strokeStyle=color; ctx.lineWidth=w; ctx.strokeRect(r.x,r.y,r.w,r.h); }
function drawPoly(ctx, pts, color, w=3){ if(!pts?.length) return; ctx.strokeStyle=color; ctx.lineWidth=w; ctx.beginPath(); pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)); ctx.closePath(); ctx.stroke(); }
function drawText(ctx, txt, x, y, color='#fff'){ ctx.font='18px system-ui'; ctx.fillStyle='rgba(0,0,0,.65)'; ctx.fillRect(x-4,y-18,ctx.measureText(txt).width+8,24); ctx.fillStyle=color; ctx.fillText(txt,x,y); }
function createWhiteMask(src){
  const rgb=new cv.Mat(), hsv=new cv.Mat(), maskHSV=new cv.Mat(), gray=new cv.Mat(), maskGray=new cv.Mat(), mask=new cv.Mat();
  cv.cvtColor(src,rgb,cv.COLOR_RGBA2RGB);
  cv.cvtColor(rgb,hsv,cv.COLOR_RGB2HSV);
  const low=new cv.Mat(hsv.rows,hsv.cols,hsv.type(),[0,0,135,0]);
  const high=new cv.Mat(hsv.rows,hsv.cols,hsv.type(),[180,90,255,255]);
  cv.inRange(hsv,low,high,maskHSV);
  cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);
  cv.threshold(gray,maskGray,150,255,cv.THRESH_BINARY);
  cv.bitwise_or(maskHSV,maskGray,mask);
  const k1=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(7,7));
  const k2=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(15,15));
  cv.morphologyEx(mask,mask,cv.MORPH_CLOSE,k2);
  cv.morphologyEx(mask,mask,cv.MORPH_OPEN,k1);
  rgb.delete(); hsv.delete(); maskHSV.delete(); gray.delete(); maskGray.delete(); low.delete(); high.delete(); k1.delete(); k2.delete();
  return mask;
}
function findBestQuadFromMask(mask){
  const contours=new cv.MatVector(), hierarchy=new cv.Mat();
  cv.findContours(mask,contours,hierarchy,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
  const imgArea=mask.rows*mask.cols;
  let best=null;
  for(let i=0;i<contours.size();i++){
    const c=contours.get(i); const area=cv.contourArea(c); if(area<imgArea*0.015){ c.delete(); continue; }
    let candidatePts=null, approx=new cv.Mat();
    const peri=cv.arcLength(c,true);
    for(const eps of [0.015,0.02,0.03,0.04,0.055,0.07]){
      cv.approxPolyDP(c,approx,eps*peri,true);
      if(approx.rows===4 && cv.isContourConvex(approx)){ candidatePts=approxToPts(approx); break; }
    }
    if(!candidatePts){
      const rect=cv.minAreaRect(c); candidatePts=rectPoints(rect);
    }
    const pts=orderPts(candidatePts);
    const wTop=dist(pts[0],pts[1]), wBot=dist(pts[3],pts[2]), hL=dist(pts[0],pts[3]), hR=dist(pts[1],pts[2]);
    const w=(wTop+wBot)/2, h=(hL+hR)/2; const ratio=Math.max(w,h)/Math.max(1,Math.min(w,h));
    const polyArea=polygonArea(pts);
    const center={x:(pts[0].x+pts[1].x+pts[2].x+pts[3].x)/4,y:(pts[0].y+pts[1].y+pts[2].y+pts[3].y)/4};
    const centerScore=1 - Math.min(1, Math.hypot(center.x-mask.cols/2, center.y-mask.rows/2)/(Math.hypot(mask.cols,mask.rows)/2));
    const ratioScore=Math.max(0,1-(ratio-1)/0.55);
    const areaScore=Math.min(1,polyArea/(imgArea*0.20));
    const score=areaScore*45 + ratioScore*35 + centerScore*20;
    if(!best || score>best.score) best={pts,score,area,ratio,center};
    approx.delete(); c.delete();
  }
  hierarchy.delete(); contours.delete();
  return best;
}
function validateWarpedCard(warped){
  const gray=new cv.Mat(); cv.cvtColor(warped,gray,cv.COLOR_RGBA2GRAY);
  const margin=100; // 10mm * 10px/mm
  const innerRect=new cv.Rect(margin,margin,500,500);
  const top=new cv.Rect(0,0,700,90), bottom=new cv.Rect(0,610,700,90), left=new cv.Rect(0,0,90,700), right=new cv.Rect(610,0,90,700);
  const inner=gray.roi(innerRect); const rTop=gray.roi(top); const rBottom=gray.roi(bottom); const rLeft=gray.roi(left); const rRight=gray.roi(right);
  const innerMean=cv.mean(inner)[0];
  const borderMean=(cv.mean(rTop)[0]+cv.mean(rBottom)[0]+cv.mean(rLeft)[0]+cv.mean(rRight)[0])/4;
  inner.delete(); rTop.delete(); rBottom.delete(); rLeft.delete(); rRight.delete(); gray.delete();
  const contrast=borderMean-innerMean;
  const blackOk=innerMean<115;
  const whiteOk=borderMean>145;
  const confidence=clamp((contrast/130)*70 + (blackOk?15:0) + (whiteOk?15:0),0,100);
  return {innerMean,borderMean,contrast,confidence,blackOk,whiteOk};
}
function detectCard(useCurrentCapture=false){
  if(!requireCV()) return null;
  if(!useCurrentCapture && !grabFrame()) return null;
  const src=getMatFromCapture();
  let mask=null, warped=null, M=null;
  try{
    mask=createWhiteMask(src);
    const best=findBestQuadFromMask(mask);
    if(!best){ toast('No encontré tarjeta blanca. Acércala/centra y evita sombras.'); return null; }
    const pers=makePerspective(best.pts,WARP_SIZE); M=pers.M;
    warped=warpWithM(src,M,WARP_SIZE);
    const val=validateWarpedCard(warped);
    drawDebugBackground(warped);
    dctx.strokeStyle='#1fd18a'; dctx.lineWidth=5; dctx.strokeRect(0,0,700,700);
    dctx.strokeStyle='#ff4d5e'; dctx.lineWidth=4; dctx.strokeRect(100,100,500,500);
    drawText(dctx,`Tarjeta confianza ${fmt(val.confidence,0)}%`,16,28,val.confidence>=80?'#1fd18a':'#ffd166');
    drawText(dctx,`Exterior 7x7 cm / negro 5x5 cm`,16,54,'#eef6ff');
    if(val.confidence<65){ toast('Tarjeta detectada, pero baja confianza. Mejora luz/contraste.'); }
    calibration={
      version:APP_VERSION,
      ts:Date.now(),
      M:Array.from(M.data64F || M.data32F),
      confidence:val.confidence,
      cardPts:best.pts,
      width:src.cols,
      height:src.rows,
      pxPerMm:PX_PER_MM
    };
    localStorage.setItem('v10_calibration',JSON.stringify(calibration));
    setStep('stepCard',val.confidence>=75?'ok':'bad',`Confianza ${fmt(val.confidence,0)}%`);
    toast(`Calibración guardada: ${fmt(val.confidence,0)}% confianza`);
    sendPC({type:'calibration', calibration, validation:val, debugImage:debugCanvas.toDataURL('image/jpeg',0.75)});
    sendState();
    return calibration;
  }catch(e){ console.error(e); toast('Error detectando tarjeta'); sendPC({type:'error',scope:'card',message:String(e)}); return null; }
  finally{ src.delete(); if(mask)mask.delete(); if(warped)warped.delete(); if(M)M.delete(); }
}
function matFromM(arr){ return cv.matFromArray(3,3,cv.CV_64FC1,arr); }
function warpCurrentToPlane(src){ if(!calibration?.M) throw new Error('Sin calibración'); const M=matFromM(calibration.M); const warped=warpWithM(src,M,WARP_SIZE); M.delete(); return warped; }
function createPatchMask(warped){
  const gray=new cv.Mat(), mask=new cv.Mat();
  cv.cvtColor(warped,gray,cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray,gray,new cv.Size(5,5),0);
  cv.threshold(gray,mask,92,255,cv.THRESH_BINARY);
  const k1=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(9,9));
  const k2=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(23,23));
  cv.morphologyEx(mask,mask,cv.MORPH_CLOSE,k2);
  cv.morphologyEx(mask,mask,cv.MORPH_OPEN,k1);
  gray.delete(); k1.delete(); k2.delete(); return mask;
}
function findLargestContour(mask, minAreaPct=0.02){
  const contours=new cv.MatVector(), hierarchy=new cv.Mat(); cv.findContours(mask,contours,hierarchy,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
  let best=null,bestArea=0,bestIndex=-1; const minArea=mask.rows*mask.cols*minAreaPct;
  for(let i=0;i<contours.size();i++){ const c=contours.get(i); const a=cv.contourArea(c); if(a>bestArea && a>minArea){ if(best)best.delete(); best=c; bestArea=a; bestIndex=i; } else c.delete(); }
  hierarchy.delete(); contours.delete(); return best?{contour:best,area:bestArea,index:bestIndex}:null;
}
function cropPatchNormalized(warped, contour){
  const rect=cv.minAreaRect(contour);
  let pts=orderPts(rectPoints(rect));
  let w=Math.round(Math.max(dist(pts[0],pts[1]),dist(pts[3],pts[2])));
  let h=Math.round(Math.max(dist(pts[0],pts[3]),dist(pts[1],pts[2])));
  if(w<1||h<1) throw new Error('Patch rect inválido');
  // Si quedó más alto que ancho y el texto está en la parte baja, lo dejamos como viene. No forzamos giro 90.
  const srcTri=cv.matFromArray(4,1,cv.CV_32FC2,[pts[0].x,pts[0].y,pts[1].x,pts[1].y,pts[2].x,pts[2].y,pts[3].x,pts[3].y]);
  const dstTri=cv.matFromArray(4,1,cv.CV_32FC2,[0,0,w,0,w,h,0,h]);
  const M=cv.getPerspectiveTransform(srcTri,dstTri); const norm=new cv.Mat();
  cv.warpPerspective(warped,norm,M,new cv.Size(w,h),cv.INTER_LINEAR,cv.BORDER_CONSTANT,new cv.Scalar(0,0,0,255));
  srcTri.delete(); dstTri.delete(); M.delete();
  let angle=rect.angle; if(rect.size.width<rect.size.height) angle += 90; if(angle>45) angle-=90; if(angle<-45) angle+=90;
  return {norm, boxPts:pts, widthPx:w, heightPx:h, angle};
}
function detectTextAndGraphics(norm, config){
  const w=norm.cols,h=norm.rows;
  const y1=Math.round(h*clamp(config.textZoneStart,0,99)/100);
  const y2=Math.round(h*clamp(config.textZoneEnd,1,100)/100);
  const roiRect=new cv.Rect(0,y1,w,Math.max(1,y2-y1));
  const roi=norm.roi(roiRect), gray=new cv.Mat(), textMask=new cv.Mat();
  cv.cvtColor(roi,gray,cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray,gray,new cv.Size(3,3),0);
  cv.threshold(gray,textMask,115,255,cv.THRESH_BINARY_INV);
  const kh=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(Math.max(9,Math.round(w*0.035)),3));
  const kv=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(3,3));
  cv.morphologyEx(textMask,textMask,cv.MORPH_CLOSE,kh);
  cv.morphologyEx(textMask,textMask,cv.MORPH_OPEN,kv);
  const contours=new cv.MatVector(), hierarchy=new cv.Mat(); cv.findContours(textMask,contours,hierarchy,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
  let union=null; let kept=0;
  for(let i=0;i<contours.size();i++){
    const c=contours.get(i); const r=cv.boundingRect(c); const area=cv.contourArea(c);
    if(area>20 && r.width>w*0.03 && r.height>3){
      const rr={x:r.x,y:r.y+y1,w:r.width,h:r.height};
      if(!union) union={...rr}; else { const x0=Math.min(union.x,rr.x), y0=Math.min(union.y,rr.y), x1=Math.max(union.x+union.w,rr.x+rr.w), y1b=Math.max(union.y+union.h,rr.y+rr.h); union={x:x0,y:y0,w:x1-x0,h:y1b-y0}; }
      kept++;
    }
    c.delete();
  }
  contours.delete(); hierarchy.delete(); kh.delete(); kv.delete(); roi.delete(); gray.delete(); textMask.delete();

  let textAngle=0;
  // Estimación de ángulo usando zona de texto completa, si hay caja.
  if(union){
    const safe=new cv.Rect(clamp(union.x,0,w-1),clamp(union.y,0,h-1),clamp(union.w,1,w-union.x),clamp(union.h,1,h-union.y));
    const tRoi=norm.roi(safe), tg=new cv.Mat(), tm=new cv.Mat(); cv.cvtColor(tRoi,tg,cv.COLOR_RGBA2GRAY); cv.threshold(tg,tm,115,255,cv.THRESH_BINARY_INV);
    const tv=new cv.MatVector(), th=new cv.Mat(); cv.findContours(tm,tv,th,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
    let allPts=[];
    for(let i=0;i<tv.size();i++){ const c=tv.get(i); const r=cv.boundingRect(c); if(cv.contourArea(c)>8){ allPts.push({x:r.x+safe.x,y:r.y+safe.y}); allPts.push({x:r.x+r.width+safe.x,y:r.y+r.height+safe.y}); } c.delete(); }
    if(allPts.length>=4){ const mat=cv.matFromArray(allPts.length,1,cv.CV_32SC2,allPts.flatMap(p=>[Math.round(p.x),Math.round(p.y)])); const rr=cv.minAreaRect(mat); textAngle=rr.angle; if(rr.size.width<rr.size.height) textAngle+=90; if(textAngle>45) textAngle-=90; if(textAngle<-45) textAngle+=90; mat.delete(); }
    tRoi.delete(); tg.delete(); tm.delete(); tv.delete(); th.delete();
  }

  // Detectar bordado/gráfico arriba del texto: colores/saturación o zonas oscuras no blancas.
  let graphicBox=null;
  if(union){
    const gy0=Math.round(h*0.12), gy1=Math.max(gy0+1, union.y-3);
    if(gy1>gy0+10){
      const groi=norm.roi(new cv.Rect(0,gy0,w,gy1-gy0));
      const rgb=new cv.Mat(), hsv=new cv.Mat(), satMask=new cv.Mat(), darkMask=new cv.Mat(), gg=new cv.Mat(), gmask=new cv.Mat();
      cv.cvtColor(groi,rgb,cv.COLOR_RGBA2RGB); cv.cvtColor(rgb,hsv,cv.COLOR_RGB2HSV);
      const lowSat=new cv.Mat(hsv.rows,hsv.cols,hsv.type(),[0,45,40,0]);
      const highSat=new cv.Mat(hsv.rows,hsv.cols,hsv.type(),[180,255,255,255]);
      cv.inRange(hsv,lowSat,highSat,satMask);
      cv.cvtColor(groi,gg,cv.COLOR_RGBA2GRAY); cv.threshold(gg,darkMask,135,255,cv.THRESH_BINARY_INV);
      cv.bitwise_or(satMask,darkMask,gmask);
      const kg=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(13,9)); cv.morphologyEx(gmask,gmask,cv.MORPH_CLOSE,kg); cv.morphologyEx(gmask,gmask,cv.MORPH_OPEN,cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(5,5)));
      const gv=new cv.MatVector(), gh=new cv.Mat(); cv.findContours(gmask,gv,gh,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
      let gu=null;
      for(let i=0;i<gv.size();i++){ const c=gv.get(i); const r=cv.boundingRect(c); if(cv.contourArea(c)>80 && r.width>w*0.05){ const rr={x:r.x,y:r.y+gy0,w:r.width,h:r.height}; if(!gu)gu={...rr}; else{ const x0=Math.min(gu.x,rr.x), yy0=Math.min(gu.y,rr.y), x1=Math.max(gu.x+gu.w,rr.x+rr.w), yy1=Math.max(gu.y+gu.h,rr.y+rr.h); gu={x:x0,y:yy0,w:x1-x0,h:yy1-yy0}; } } c.delete(); }
      graphicBox=gu;
      groi.delete(); rgb.delete(); hsv.delete(); satMask.delete(); darkMask.delete(); gg.delete(); gmask.delete(); lowSat.delete(); highSat.delete(); kg.delete(); gv.delete(); gh.delete();
    }
  }
  return {textBox:union, textAngle, graphicBox, textFound:!!union, components:kept, zone:{y1,y2}};
}
function analyzePatch(record=false, sourceAlreadyCaptured=false){
  if(!requireCV()) return null;
  if(!calibration){ toast('Primero calibra con tarjeta 7×7 / 5×5'); return null; }
  if(!sourceAlreadyCaptured && !grabFrame()) return null;
  const config=cfg();
  const src=getMatFromCapture(); let warped=null, mask=null, patch=null, norm=null;
  try{
    warped=warpCurrentToPlane(src);
    drawDebugBackground(warped);
    mask=createPatchMask(warped);
    patch=findLargestContour(mask,0.025);
    if(!patch){ setDecision(null,'No detecté silueta del parche. Usa fondo azul/oscuro mate y parche completo.'); sendPC({type:'analysis', ok:false, reason:'No detecté silueta'}); return null; }
    const patchContour=patch.contour;
    const perimeterPx=cv.arcLength(patchContour,true);
    const areaPx=cv.contourArea(patchContour);
    const rect=cv.minAreaRect(patchContour);
    const box=orderPts(rectPoints(rect));
    const normPack=cropPatchNormalized(warped,patchContour); norm=normPack.norm;
    const text=detectTextAndGraphics(norm,config);
    const patchWmm=normPack.widthPx/PX_PER_MM, patchHmm=normPack.heightPx/PX_PER_MM;
    const sizeCm=`${fmt(mmToCm(patchWmm),2)} × ${fmt(mmToCm(patchHmm),2)} cm`;
    const perimCm=perimeterPx/PX_PER_MM/10;
    const areaCm2=areaPx/(PX_PER_MM*PX_PER_MM)/100;
    let baseToTextMm=null, offsetXmm=null, offsetYmm=null, alignScore=0, totalScore=0, pass=true, reasons=[];
    if(text.textBox){
      const tb=text.textBox;
      const textCenterX=tb.x+tb.w/2, textCenterY=tb.y+tb.h/2;
      offsetXmm=(textCenterX-norm.cols/2)/PX_PER_MM;
      offsetYmm=(textCenterY-norm.rows/2)/PX_PER_MM;
      if(text.graphicBox){ baseToTextMm=(tb.y - (text.graphicBox.y+text.graphicBox.h))/PX_PER_MM; }
      if(reference?.features){
        const ref=reference.features;
        const refX=ref.textCenterXPct*norm.cols, refY=ref.textCenterYPct*norm.rows;
        const errXmm=(textCenterX-refX)/PX_PER_MM;
        const errYmm=(textCenterY-refY)/PX_PER_MM;
        const errAngle=text.textAngle-ref.textAngleDeg;
        const errBase=(baseToTextMm!==null && ref.baseToTextMm!==null) ? baseToTextMm-ref.baseToTextMm : 0;
        const sX=scoreFromError(errXmm,config.maxErrX);
        const sY=scoreFromError(errYmm,config.maxErrY);
        const sA=scoreFromError(errAngle,config.maxTextAngle);
        const sB=(baseToTextMm!==null && ref.baseToTextMm!==null) ? scoreFromError(errBase,config.maxErrBase) : 100;
        alignScore=sX*.40+sY*.20+sA*.20+sB*.20;
        reasons.push(`Texto ΔX ${fmt(errXmm,1)} mm, ΔY ${fmt(errYmm,1)} mm, ángulo Δ ${fmt(errAngle,1)}°, Base-Texto Δ ${fmt(errBase,1)} mm`);
      }else{
        const sX=scoreFromError(offsetXmm,config.maxErrX);
        const sA=scoreFromError(text.textAngle,config.maxTextAngle);
        alignScore=sX*.70+sA*.30;
        reasons.push(`Sin referencia: centrado absoluto texto ${fmt(offsetXmm,1)} mm, ángulo ${fmt(text.textAngle,1)}°`);
      }
    }else{
      alignScore=0; reasons.push('No detecté bloque de texto');
    }
    let sizeScore=100, shapeScore=100;
    if(reference?.features){
      const ref=reference.features;
      sizeScore = Math.min(scoreFromError((patchWmm-ref.patchWmm)/ref.patchWmm*100, config.sizeTolPct), scoreFromError((patchHmm-ref.patchHmm)/ref.patchHmm*100, config.sizeTolPct));
      shapeScore = Math.min(scoreFromError((areaCm2-ref.areaCm2)/ref.areaCm2*100, config.sizeTolPct*1.5), scoreFromError((perimCm-ref.perimCm)/ref.perimCm*100, config.sizeTolPct*1.5));
    }
    const activeWeights=[];
    if(config.validateText) activeWeights.push(['text',alignScore,0.70]);
    if(config.validateSize) activeWeights.push(['size',sizeScore,0.15]);
    if(config.validateShape) activeWeights.push(['shape',shapeScore,0.15]);
    if(activeWeights.length){ const sw=activeWeights.reduce((a,x)=>a+x[2],0); totalScore=activeWeights.reduce((a,x)=>a+x[1]*x[2],0)/sw; }
    else totalScore=alignScore||100;
    if(config.validateText && alignScore<config.minScore){ pass=false; reasons.push(`Alineación ${fmt(alignScore,0)}% menor al mínimo ${config.minScore}%`); }
    if(config.validateSize && sizeScore<config.minScore){ pass=false; reasons.push(`Tamaño ${fmt(sizeScore,0)}% menor al mínimo`); }
    if(config.validateShape && shapeScore<config.minScore){ pass=false; reasons.push(`Forma/área ${fmt(shapeScore,0)}% menor al mínimo`); }
    const result={
      ok:true, pass, time:nowStr(), score:totalScore, alignScore, sizeScore, shapeScore,
      sizeCm, patchWmm, patchHmm, perimCm, areaCm2, patchAngle:normPack.angle,
      baseToTextMm, offsetXmm, offsetYmm, textAngle:text.textAngle,
      textFound:text.textFound, reason:reasons.join(' | '),
      features:{
        patchWmm, patchHmm, perimCm, areaCm2,
        textCenterXPct:text.textBox?(text.textBox.x+text.textBox.w/2)/norm.cols:null,
        textCenterYPct:text.textBox?(text.textBox.y+text.textBox.h/2)/norm.rows:null,
        textAngleDeg:text.textAngle,
        baseToTextMm,
        textBoxPct:text.textBox?{x:text.textBox.x/norm.cols,y:text.textBox.y/norm.rows,w:text.textBox.w/norm.cols,h:text.textBox.h/norm.rows}:null,
        graphicBoxPct:text.graphicBox?{x:text.graphicBox.x/norm.cols,y:text.graphicBox.y/norm.rows,w:text.graphicBox.w/norm.cols,h:text.graphicBox.h/norm.rows}:null
      }
    };
    // Dibujar vista diagnóstico sobre parche normalizado, no solo raw. Es lo que realmente se analiza.
    cv.imshow(debugCanvas,norm);
    dctx.save();
    drawRect(dctx,{x:0,y:0,w:norm.cols,h:norm.rows},'#ffd166',4);
    drawLine(dctx,{x:norm.cols/2,y:0},{x:norm.cols/2,y:norm.rows},'#38d9ff',3);
    drawLine(dctx,{x:0,y:norm.rows/2},{x:norm.cols,y:norm.rows/2},'rgba(56,217,255,.4)',2);
    // zona texto
    dctx.strokeStyle='rgba(255,255,255,.35)'; dctx.setLineDash([8,8]); dctx.strokeRect(0,text.zone.y1,norm.cols,text.zone.y2-text.zone.y1); dctx.setLineDash([]);
    if(text.graphicBox){ drawRect(dctx,text.graphicBox,'#ff9f1c',3); drawLine(dctx,{x:0,y:text.graphicBox.y+text.graphicBox.h},{x:norm.cols,y:text.graphicBox.y+text.graphicBox.h},'#ff9f1c',2); }
    if(text.textBox){
      drawRect(dctx,text.textBox,'#ff4dff',4);
      const tc={x:text.textBox.x+text.textBox.w/2,y:text.textBox.y+text.textBox.h/2};
      drawLine(dctx,{x:tc.x,y:0},{x:tc.x,y:norm.rows},'#ff4d5e',3);
      drawLine(dctx,{x:text.textBox.x,y:text.textBox.y+text.textBox.h/2},{x:0,y:text.textBox.y+text.textBox.h/2},'#fff',2);
      drawLine(dctx,{x:text.textBox.x+text.textBox.w,y:text.textBox.y+text.textBox.h/2},{x:norm.cols,y:text.textBox.y+text.textBox.h/2},'#fff',2);
    }
    drawText(dctx,`${pass?'APROBADO':'RECHAZADO'}  Score ${fmt(totalScore,0)}%`,12,28,pass?'#1fd18a':'#ff4d5e');
    drawText(dctx,`Tamaño ${sizeCm} | Perim ${fmt(perimCm,2)} cm | Área ${fmt(areaCm2,2)} cm²`,12,54,'#eef6ff');
    if(baseToTextMm!==null) drawText(dctx,`Base a Texto ${fmt(baseToTextMm,1)} mm`,12,80,'#ffd166');
    dctx.restore();
    setDecision(result);
    if(record) addLog(result);
    const debugImage = (Date.now()-lastSendDebugTs>250) ? debugCanvas.toDataURL('image/jpeg',0.72) : null;
    if(debugImage) lastSendDebugTs=Date.now();
    sendPC({type:'analysis', result, debugImage});
    setStep('stepAudit','ok','Medición activa');
    patchContour.delete();
    return result;
  }catch(e){ console.error(e); toast('Error analizando parche'); sendPC({type:'error',scope:'analysis',message:String(e)}); return null; }
  finally{ src.delete(); if(warped)warped.delete(); if(mask)mask.delete(); if(norm)norm.delete(); }
}
function takeReference(){
  const res=analyzePatch(false,false);
  if(!res?.ok || !res.textFound){ toast('No puedo guardar referencia: falta texto o parche'); return; }
  reference={version:APP_VERSION, ts:Date.now(), features:res.features, preview:debugCanvas.toDataURL('image/jpeg',0.75)};
  localStorage.setItem('v10_reference',JSON.stringify(reference));
  setStep('stepRef','ok','Referencia 100% guardada'); toast('Referencia 100% guardada'); sendPC({type:'reference', reference}); sendState();
}
function setDecision(res,msg){
  if(!res){ $('decision').textContent='ESPERANDO'; $('decision').className='decision neutral'; $('reason').textContent=msg||'Esperando.'; return; }
  $('decision').textContent=res.pass?'APROBADO':'RECHAZADO'; $('decision').className='decision '+(res.pass?'ok':'bad');
  $('mScore').textContent=fmt(res.score,0)+'%'; $('mAlign').textContent=fmt(res.alignScore,0)+'%'; $('mSize').textContent=res.sizeCm;
  $('mPerim').textContent=fmt(res.perimCm,2)+' cm'; $('mArea').textContent=fmt(res.areaCm2,2)+' cm²';
  $('mBaseText').textContent=res.baseToTextMm!==null?fmt(res.baseToTextMm,1)+' mm':'--';
  $('mOffset').textContent=res.offsetXmm!==null?fmt(res.offsetXmm,1)+' mm':'--';
  $('mTextAngle').textContent=fmt(res.textAngle,1)+'°'; $('reason').textContent=res.reason;
}
function getCounts(){ const ok=log.filter(x=>x.result==='APROBADO').length; return {ok,bad:log.length-ok,total:log.length}; }
function renderLog(){
  const c=getCounts(); $('okCount').textContent=c.ok; $('badCount').textContent=c.bad; $('totalCount').textContent=c.total;
  $('logBody').innerHTML=log.slice(0,80).map(r=>`<tr><td>${r.time}</td><td>${r.result}</td><td>${r.score}</td><td>${r.baseText}</td><td>${r.reason}</td></tr>`).join('');
  sendPC({type:'log', log:log.slice(0,80), counts:c});
}
function addLog(res){
  const row={time:res.time,result:res.pass?'APROBADO':'RECHAZADO',score:fmt(res.score,0)+'%',baseText:res.baseToTextMm!==null?fmt(res.baseToTextMm,1)+' mm':'--',reason:res.reason};
  log.unshift(row); log=log.slice(0,500); localStorage.setItem('v10_log',JSON.stringify(log)); renderLog();
}
function exportCSV(){
  const head='Hora,Resultado,Score,BaseTexto,Motivo\n'; const body=log.map(r=>[r.time,r.result,r.score,r.baseText,`"${String(r.reason).replaceAll('"','""')}"`].join(',')).join('\n');
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([head+body],{type:'text/csv'})); a.download='historial_inspector_v10.csv'; a.click();
}
function resetLog(){ log=[]; localStorage.setItem('v10_log','[]'); renderLog(); toast('Conteo reiniciado'); }

function loop(){
  if(stream){
    if(autoMode && Date.now()-lastAutoTs>900){
      const res=analyzePatch(false,false);
      if(res?.ok){
        const key = `${Math.round(res.patchWmm)}-${Math.round(res.patchHmm)}-${Math.round((res.offsetXmm||0)*10)}-${Math.round(res.score)}`;
        if(!lockedUntilEmpty && key!==lastAnalysisKey){ addLog(res); lockedUntilEmpty=true; lastAnalysisKey=key; }
        // Desbloqueo simple: si falla silueta en una lectura futura, se libera. No hacemos otra lectura extra aquí por rendimiento.
        setTimeout(()=>{ lockedUntilEmpty=false; }, 1300);
      }
      lastAutoTs=Date.now();
    }
    requestAnimationFrame(loop);
  }
}
async function connectPc(){
  const raw=$('pairCode').value.trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(!/^[A-Z]{3}\d{4}$/.test(raw)){ toast('Código inválido. Debe ser ABC1234.'); return; }
  $('pairCode').value=raw;
  const targetId=PEER_PREFIX+raw.toLowerCase();
  if(peer){ try{peer.destroy();}catch(e){} }
  peer=new Peer(undefined,{debug:0});
  peer.on('open',()=>{
    pcConn=peer.connect(targetId,{reliable:true});
    setupConn(pcConn);
    pcConn.on('open',()=>{
      $('pcStatus').textContent='PC conectado con código '+raw;
      toast('PC conectado'); sendState(); renderLog();
      if(stream){ try{ peer.call(targetId,stream); }catch(e){ console.warn(e); } }
    });
  });
  peer.on('error',err=>{ console.error(err); $('pcStatus').textContent='Error de conexión: '+err.type; toast('Error PC: '+err.type); });
}
function setupConn(conn){
  conn.on('data',msg=>{
    if(msg?.type==='command') handlePcCommand(msg.cmd,msg.payload);
    if(msg?.type==='config') { applyConfig(msg.config); toast('Configuración recibida desde PC'); }
  });
  conn.on('close',()=>{ $('pcStatus').textContent='PC desconectado'; });
}
function handlePcCommand(cmd,payload){
  switch(cmd){
    case 'detectCard': detectCard(false); break;
    case 'takeReference': takeReference(); break;
    case 'measureNow': analyzePatch(true,false); break;
    case 'toggleAuto': toggleAuto(); break;
    case 'resetLog': resetLog(); break;
    case 'startCamera': toast('Por iPhone, inicia cámara desde el celular si no abre remoto.'); startCamera(); break;
    case 'applyConfig': applyConfig(payload); break;
  }
}
function toggleAuto(){ autoMode=!autoMode; $('btnAuto').dataset.active=String(autoMode); $('btnAuto').textContent='Auto: '+(autoMode?'ON':'OFF'); toast(autoMode?'Auto activo':'Auto detenido'); sendState(); }

// Eventos UI
$('btnStart').onclick=()=>startCamera();
$('btnSwitch').onclick=()=>switchCamera();
$('btnConnectPc').onclick=()=>connectPc();
$('btnDetectCard').onclick=()=>detectCard(false);
$('btnTakeRef').onclick=()=>takeReference();
$('btnMeasure').onclick=()=>analyzePatch(true,false);
$('btnAuto').onclick=()=>toggleAuto();
$('btnReset').onclick=()=>resetLog();
$('btnExport').onclick=()=>exportCSV();
$('btnSendConfig').onclick=()=>sendState();
$('photoInput').onchange=async ev=>{ const f=ev.target.files?.[0]; if(!f) return; if(!requireCV()) return; await loadPhoto(f); toast('Foto cargada. Puedes detectar tarjeta o medir.'); };
['validateText','validateSize','validateShape','minScore','maxErrX','maxErrY','maxErrBase','maxTextAngle','sizeTolPct','textZoneStart','textZoneEnd'].forEach(id=>$(id).addEventListener('change',sendState));

// Inicialización
renderLog();
if(calibration) setStep('stepCard','ok',`Calibración guardada ${fmt(calibration.confidence,0)}%`);
if(reference) setStep('stepRef','ok','Referencia guardada');
window.addEventListener('opencv-ready',()=>toast('OpenCV listo'));
setTimeout(()=>{ if(!window.cvReady) $('cameraHelp').textContent='Cargando OpenCV... si tarda mucho, revisa internet.'; },2500);
