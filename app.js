// Inspector de Parches - v14 Senior
// Corrección clave: el 5×5 ya NO se mide por threshold.
// 1) threshold solo busca el exterior blanco 7×7
// 2) se corrige perspectiva
// 3) el 5×5 se proyecta por geometría exacta: 10mm..60mm
// 4) el contraste interno solo valida, no manda la medida

const $ = id => document.getElementById(id);
const video = $('video');
const overlay = $('overlay');
const ctx = overlay.getContext('2d');
const capture = $('captureCanvas');
const capCtx = capture.getContext('2d', { willReadFrequently:true });
const patchCanvas = $('patchCanvas');

const CARD_MM = 70;
const INNER_MM = 50;
const BORDER_MM = 10;
const CARD_WARP = 700;
const PX_PER_MM_CARD = CARD_WARP / CARD_MM; // 10
const INNER_EXPECTED = { x:100, y:100, w:500, h:500 };

let stream = null;
let autoMode = false;
let lastAutoTs = 0;
let pxPerMm = Number(localStorage.getItem('pxPerMm') || 0);
let log = safeJson(localStorage.getItem('inspectionLog'), []);
let master = safeJson(localStorage.getItem('masterPatchMetrics'), null);
let cardCalibration = safeJson(localStorage.getItem('cardCalibration7x7'), null);
let lastFrameW = 0;
let lastFrameH = 0;

function safeJson(txt, fallback){ try { return txt ? JSON.parse(txt) : fallback; } catch { return fallback; } }
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
function fmt(n,d=1){ return n==null || !isFinite(n) ? '--' : Number(n).toFixed(d); }
function escapeHtml(value){ return String(value ?? '').replace(/[&<>"']/g, s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }
function toast(msg){ const t=$('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2200); }
function setStatus(text, cls='idle'){ $('statusBadge').textContent=text; $('statusBadge').className='badge '+cls; }

function cfg(){ return {
  lot:$('lotName').value.trim() || 'Sin lote',
  targetW:+$('targetW').value,
  targetH:+$('targetH').value,
  tolW:+$('tolW').value,
  tolH:+$('tolH').value,
  tolAngle:+$('tolAngle').value,
  refMm:+$('refMm').value,
  acceptPct:+$('acceptPct').value || 85,
  baseTextAcceptPct:+$('baseTextAcceptPct').value || 85,
  textStartPct:clamp((+$('textStartPct').value || 42)/100, 0, .95),
  textEndPct:clamp((+$('textEndPct').value || 92)/100, .05, 1),
  useMaster:$('useMaster').checked
};}

function updateScaleText(){
  const hOk = !!(cardCalibration && cardCalibration.H_img_to_mm);
  $('scaleText').textContent = pxPerMm
    ? `Escala: ${pxPerMm.toFixed(3)} px/mm guardada${hOk ? ' + perspectiva de ficha.' : '.'}`
    : 'Escala: no calibrada. Recomendado: calibrar con ficha 7×7 / 5×5.';
}
function updateMasterText(){
  if(!master){
    $('masterText').textContent='Maestro: no guardado.';
    $('refWidth').textContent='--'; $('refHeight').textContent='--'; $('refBaseText').textContent='--'; $('refArea').textContent='--';
    return;
  }
  $('masterText').textContent = `Maestro guardado: ${new Date(master.savedAt).toLocaleString()}. Ese marco es 100%.`;
  $('refWidth').textContent = `${fmt(master.widthMm)} mm`;
  $('refHeight').textContent = `${fmt(master.heightMm)} mm`;
  $('refBaseText').textContent = master.textFound ? `${fmt(master.baseToTextMm)} mm` : 'No detectado';
  $('refArea').textContent = `${fmt(master.areaMm2,0)} mm²`;
}
function updateCardText(){
  if(!cardCalibration){
    $('cardState').textContent='No calibrada';
    $('cardConfidence').textContent='--';
    $('cardInner').textContent='--';
    $('cardScale').textContent='--';
    return;
  }
  $('cardState').textContent='Calibrada';
  $('cardConfidence').textContent=`${fmt(cardCalibration.confidence,0)}%`;
  $('cardInner').textContent=`50.0 × 50.0 mm geom.`;
  $('cardScale').textContent=`${fmt(cardCalibration.pxPerMm,3)} px/mm`;
}
updateScaleText(); updateMasterText(); updateCardText();

async function startCamera(){
  const attempts = [
    { video:{ facingMode:{ ideal:'environment' }, width:{ ideal:1920 }, height:{ ideal:1080 } }, audio:false },
    { video:{ facingMode:{ ideal:'environment' }, width:{ ideal:1280 }, height:{ ideal:720 } }, audio:false },
    { video:{ facingMode:{ ideal:'environment' } }, audio:false },
    { video:true, audio:false }
  ];
  let lastErr = null;
  for(const constraints of attempts){
    try{
      if(stream) stream.getTracks().forEach(t=>t.stop());
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      video.setAttribute('playsinline','');
      video.setAttribute('webkit-playsinline','');
      video.muted = true;
      await video.play();
      setStatus('Cámara activa','live');
      resizeCanvas();
      loop();
      toast('Cámara iniciada');
      return;
    }catch(e){ lastErr = e; }
  }
  setStatus('Error cámara','bad');
  toast(explainCameraError(lastErr));
  console.error(lastErr);
}
function explainCameraError(e){
  if(!(window.isSecureContext || location.hostname === 'localhost')) return 'La cámara requiere HTTPS/GitHub Pages.';
  if(e && e.name === 'NotAllowedError') return 'Permiso de cámara bloqueado. Permite cámara en Safari.';
  if(e && e.name === 'NotReadableError') return 'Cámara ocupada por otra app. Cierra Cámara/WhatsApp/Instagram.';
  return 'No se pudo abrir cámara. Revisa permisos o usa Safari/Chrome actualizado.';
}
function resizeCanvas(){
  const r=overlay.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  overlay.width=Math.max(1,Math.round(r.width*dpr));
  overlay.height=Math.max(1,Math.round(r.height*dpr));
  ctx.setTransform(dpr,0,0,dpr,0,0);
}
window.addEventListener('resize', resizeCanvas);

function grabFrame(){
  const vw=video.videoWidth, vh=video.videoHeight;
  if(!vw || !vh) return false;
  capture.width=vw; capture.height=vh;
  capCtx.drawImage(video,0,0,vw,vh);
  lastFrameW = vw; lastFrameH = vh;
  return true;
}

// Mapeo correcto imagen -> pantalla. Evita recuadros corridos por object-fit.
function containFit(iw, ih, cw, ch){
  const s = Math.min(cw/iw, ch/ih);
  return { s, x:(cw-iw*s)/2, y:(ch-ih*s)/2 };
}
function imagePointToCanvas(p){
  const fit = containFit(capture.width || lastFrameW || 1, capture.height || lastFrameH || 1, overlay.clientWidth, overlay.clientHeight);
  return { x: fit.x + p.x*fit.s, y: fit.y + p.y*fit.s };
}
function drawPoly(points, color, close=true, width=3){
  if(!points || !points.length) return;
  ctx.strokeStyle=color; ctx.lineWidth=width; ctx.beginPath();
  points.forEach((p,i)=>{ const q=imagePointToCanvas(p); i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y); });
  if(close) ctx.closePath();
  ctx.stroke();
}
function drawLine(a,b,color,width=3){
  const p=imagePointToCanvas(a), q=imagePointToCanvas(b);
  ctx.strokeStyle=color; ctx.lineWidth=width; ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(q.x,q.y); ctx.stroke();
}
function drawLabel(text, p, color){
  const q=imagePointToCanvas(p);
  ctx.fillStyle=color; ctx.font='16px system-ui'; ctx.fillText(text, q.x+8, q.y-8);
}

function drawResult(res){
  ctx.clearRect(0,0,overlay.clientWidth,overlay.clientHeight);
  if(res.box) drawPoly(res.box, res.pass?'#1fd18a':'#ff4d5e', true, 3);
  if(res.textPoly) drawPoly(res.textPoly, '#ffd166', true, 3);
  if(res.baseLine){
    drawLine(res.baseLine[0], res.baseLine[1], '#58a6ff', 4);
    drawLabel('Base a Texto', res.baseLine[1], '#58a6ff');
  }
  ctx.fillStyle=res.pass?'#1fd18a':'#ff4d5e';
  ctx.font='16px system-ui';
  ctx.fillText(res.pass?'APROBADO':'RECHAZADO',18,30);
  if(res.masterScore!=null) ctx.fillText(`${res.masterScore.toFixed(0)}% vs maestro`,18,55);
}

function analyzeFrame(record=false, silent=false){
  if(!window.cvReady || typeof cv === 'undefined'){ toast('OpenCV aún está cargando. La paciencia también es herramienta, por desgracia.'); return null; }
  if(!grabFrame()) return null;
  let src=cv.imread(capture);
  let result=null;
  try{
    const patch = detectPatchCandidate(src);
    if(!patch){ setDecision(null,'No encuentro silueta clara del parche. Usa fondo sólido y contraste.'); return null; }

    const c=cfg();
    const metric = measurePatchMetric(patch.contour, patch.box, patch.areaPx);
    const text = detectTextAndBase(src, patch.box, metric.widthMm, metric.heightMm, c);

    let reasons=[]; let pass=true;
    if(!pxPerMm && !(cardCalibration && cardCalibration.H_img_to_mm)){ pass=false; reasons.push('Falta calibrar escala'); }
    else{
      if(Math.abs(metric.widthMm-c.targetW)>c.tolW){ pass=false; reasons.push(`Ancho fuera por ${(metric.widthMm-c.targetW).toFixed(1)} mm`); }
      if(Math.abs(metric.heightMm-c.targetH)>c.tolH){ pass=false; reasons.push(`Alto fuera por ${(metric.heightMm-c.targetH).toFixed(1)} mm`); }
      if(Math.abs(metric.angle)>c.tolAngle){ pass=false; reasons.push(`Giro excesivo: ${metric.angle.toFixed(1)}°`); }
    }

    const scorePack = scoreAgainstMaster({widthMm:metric.widthMm,heightMm:metric.heightMm,areaMm2:metric.areaMm2,angle:metric.angle,baseToTextMm:text.baseToTextMm,textFound:text.found}, c);
    if((pxPerMm || cardCalibration) && c.useMaster && master){
      if(scorePack.masterScore < c.acceptPct){ pass=false; reasons.push(`Score general ${scorePack.masterScore.toFixed(0)}%, mínimo ${c.acceptPct}%`); }
      if(scorePack.baseScore != null && scorePack.baseScore < c.baseTextAcceptPct){ pass=false; reasons.push(`Base a Texto ${scorePack.baseScore.toFixed(0)}%, mínimo ${c.baseTextAcceptPct}%`); }
      if(scorePack.baseScore == null){ pass=false; reasons.push('No detecté texto para medir Base a Texto'); }
    }

    result={
      pass,
      widthMm:metric.widthMm,
      heightMm:metric.heightMm,
      angle:metric.angle,
      areaMm2:metric.areaMm2,
      areaMm:metric.areaMm2,
      box:patch.box,
      textFound:text.found,
      baseToTextMm:text.baseToTextMm,
      textPoly:text.poly,
      baseLine:text.baseLine,
      masterScore:scorePack.masterScore,
      baseScore:scorePack.baseScore,
      scoreDetail:scorePack,
      reason:reasons.join('; ')||'Dentro de tolerancia'
    };
    patch.contour.delete();
    if(!silent){ setDecision(result); drawResult(result); }
    if(record) addLog(result);
  }catch(e){ console.error(e); toast('Error midiendo. Ya bastante hacía falta otro villano.'); }
  finally{ src.delete(); }
  return result;
}

function detectPatchCandidate(src){
  const imgArea = src.cols * src.rows;
  let gray=new cv.Mat(), blur=new cv.Mat();
  let best=null, bestScore=0;
  try{
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5,5), 0);
    const thresholds=[70,85,100,115,130,145,160,175,190,205];
    for(const t of thresholds){
      let mask=new cv.Mat(), clean=new cv.Mat(), contours=new cv.MatVector(), hierarchy=new cv.Mat();
      try{
        // Parche claro sobre fondo oscuro: segmentación por brillo, no solo bordes.
        cv.threshold(blur, mask, t, 255, cv.THRESH_BINARY);
        const kClose=cv.Mat.ones(7,7,cv.CV_8U);
        const kOpen=cv.Mat.ones(3,3,cv.CV_8U);
        cv.morphologyEx(mask, clean, cv.MORPH_CLOSE, kClose);
        cv.morphologyEx(clean, clean, cv.MORPH_OPEN, kOpen);
        kClose.delete(); kOpen.delete();
        cv.findContours(clean, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        for(let i=0;i<contours.size();i++){
          const cont=contours.get(i);
          const area=cv.contourArea(cont);
          if(area < imgArea*0.004 || area > imgArea*0.65){ cont.delete(); continue; }
          const rect=cv.minAreaRect(cont);
          const rectArea=Math.max(1, rect.size.width*rect.size.height);
          const fill=area/rectArea;
          const center=rect.center;
          const centerScore=1-clamp(Math.hypot(center.x-src.cols/2,center.y-src.rows/2)/Math.hypot(src.cols/2,src.rows/2),0,1);
          const score=area*(0.45+fill)*(0.5+centerScore);
          if(score>bestScore){ if(best) best.contour.delete(); bestScore=score; best={contour:cont, rect, areaPx:area, threshold:t}; }
          else cont.delete();
        }
      }finally{ mask.delete(); clean.delete(); contours.delete(); hierarchy.delete(); }
    }

    // Respaldo con Canny solo si brillo no encontró nada. El bordado de antes sí lo quería; aquí es plan B.
    if(!best){
      let edges=new cv.Mat(), contours=new cv.MatVector(), hierarchy=new cv.Mat();
      try{
        cv.Canny(blur, edges, 45, 145);
        const k=cv.Mat.ones(5,5,cv.CV_8U);
        cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, k); k.delete();
        cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        for(let i=0;i<contours.size();i++){
          const cont=contours.get(i); const area=cv.contourArea(cont);
          if(area>bestScore && area>imgArea*0.006){ if(best) best.contour.delete(); const rect=cv.minAreaRect(cont); bestScore=area; best={contour:cont,rect,areaPx:area,threshold:'canny'}; }
          else cont.delete();
        }
      }finally{ edges.delete(); contours.delete(); hierarchy.delete(); }
    }

    if(!best) return null;
    best.box = orderQuad(rotatedRectPoints(best.rect));
    return best;
  }finally{ gray.delete(); blur.delete(); }
}

function measurePatchMetric(contour, box, areaPx){
  if(cardCalibration && cardCalibration.H_img_to_mm){
    const imgPts = contourToPoints(contour, 2);
    const metricPts = imgPts.map(p=>transformPoint(cardCalibration.H_img_to_mm, p.x, p.y));
    const metricMat = matFromPoints32F(metricPts);
    const rr = cv.minAreaRect(metricMat);
    metricMat.delete();
    const widthMm = Math.max(rr.size.width, rr.size.height);
    const heightMm = Math.min(rr.size.width, rr.size.height);
    const angle = normalizeAngle(rr.angle, rr.size.width, rr.size.height);
    const areaMm2 = Math.abs(polygonArea(metricPts));
    return {widthMm, heightMm, angle, areaMm2};
  }
  const wpx = Math.max(dist(box[0],box[1]), dist(box[1],box[2]));
  const hpx = Math.min(dist(box[0],box[1]), dist(box[1],box[2]));
  const rectAngle = 0;
  return { widthMm:wpx/pxPerMm, heightMm:hpx/pxPerMm, angle:rectAngle, areaMm2:areaPx/(pxPerMm*pxPerMm) };
}

function detectTextAndBase(src, pts, widthMm, heightMm, c){
  const empty = {found:false, baseToTextMm:null, poly:null, baseLine:null};
  if(!(pxPerMm || cardCalibration)) return empty;
  let ordered = orientPatch(orderQuad(pts), c);
  const topW = dist(ordered[0], ordered[1]);
  const rightH = dist(ordered[1], ordered[2]);
  const outW = Math.max(80, Math.round(topW));
  const outH = Math.max(80, Math.round(rightH));
  let warped=null, gray=new cv.Mat(), roi=null, blur=new cv.Mat(), bin=new cv.Mat(), morph=new cv.Mat(), contours=new cv.MatVector(), hierarchy=new cv.Mat();
  try{
    warped = warpQuad(src, ordered, outW, outH);
    cv.cvtColor(warped, gray, cv.COLOR_RGBA2GRAY);
    const y1 = Math.round(outH * Math.min(c.textStartPct, c.textEndPct - .02));
    const y2 = Math.round(outH * Math.max(c.textEndPct, c.textStartPct + .02));
    const xPad = Math.round(outW * .04);
    roi = gray.roi(new cv.Rect(xPad, y1, Math.max(1,outW-xPad*2), Math.max(1,y2-y1)));
    cv.GaussianBlur(roi, blur, new cv.Size(3,3), 0);
    cv.threshold(blur, bin, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
    const kOpen = cv.Mat.ones(2,2,cv.CV_8U);
    const kClose = cv.Mat.ones(5,15,cv.CV_8U);
    cv.morphologyEx(bin, morph, cv.MORPH_OPEN, kOpen);
    cv.morphologyEx(morph, morph, cv.MORPH_CLOSE, kClose);
    kOpen.delete(); kClose.delete();
    cv.findContours(morph, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    const boxes=[];
    const minArea = Math.max(10, outW*outH*0.00005);
    for(let i=0;i<contours.size();i++){
      const cont=contours.get(i); const area=cv.contourArea(cont); const r=cv.boundingRect(cont); cont.delete();
      if(area < minArea) continue;
      if(r.width < outW*.025 || r.height < outH*.008) continue;
      if(r.width > outW*.95 || r.height > outH*.48) continue;
      boxes.push({x:r.x+xPad,y:r.y+y1,w:r.width,h:r.height,area});
    }
    if(!boxes.length) return empty;
    const b = unionBoxes(boxes);
    const baseToTextPx = outH - (b.y + b.h);
    const mmPerPxY = heightMm && isFinite(heightMm) ? heightMm / outH : 1/pxPerMm;
    const baseToTextMm = baseToTextPx * mmPerPxY;
    const textPoly = projectWarpBoxToOriginal(b, ordered, outW, outH);
    const cx = b.x + b.w/2;
    const baseLine = projectWarpLineToOriginal({x:cx, y:b.y+b.h}, {x:cx, y:outH}, ordered, outW, outH);
    return {found:true, baseToTextMm, poly:textPoly, baseLine};
  }catch(e){ console.warn('Texto no detectado:', e); return empty; }
  finally{ if(warped) warped.delete(); gray.delete(); if(roi) roi.delete(); blur.delete(); bin.delete(); morph.delete(); contours.delete(); hierarchy.delete(); }
}

function scoreAgainstMaster(m, c){
  if(!master) return {masterScore:null, baseScore:null};
  const widthScore = simScore(m.widthMm, master.widthMm);
  const heightScore = simScore(m.heightMm, master.heightMm);
  const areaScore = simScore(m.areaMm2, master.areaMm2);
  const angleScore = clamp(100 - (Math.abs((m.angle||0) - (master.angle||0)) / Math.max(1,c.tolAngle)) * 100, 0, 100);
  const baseScore = (m.textFound && master.textFound) ? simScore(m.baseToTextMm, master.baseToTextMm) : null;
  const safeBase = baseScore == null ? 0 : baseScore;
  const masterScore = widthScore*.15 + heightScore*.15 + areaScore*.10 + angleScore*.10 + safeBase*.50;
  return {masterScore, baseScore, widthScore, heightScore, areaScore, angleScore};
}
function simScore(value, ref){
  if(value == null || ref == null || !isFinite(value) || !isFinite(ref) || Math.abs(ref)<0.0001) return 0;
  return clamp(100 - (Math.abs(value-ref)/Math.abs(ref))*100, 0, 100);
}
function setDecision(res, msg){
  if(!res){ $('decision').textContent='ESPERANDO'; $('decision').className='decision neutral'; $('reason').textContent=msg||'Esperando parche.'; return; }
  $('decision').textContent=res.pass?'APROBADO':'RECHAZADO'; $('decision').className='decision '+(res.pass?'ok':'bad');
  $('mWidth').textContent=res.widthMm?res.widthMm.toFixed(1)+' mm':'--'; $('mHeight').textContent=res.heightMm?res.heightMm.toFixed(1)+' mm':'--';
  $('mAngle').textContent=res.angle.toFixed(1)+'°'; $('mArea').textContent=res.areaMm2?res.areaMm2.toFixed(0)+' mm²':'--';
  $('mBaseText').textContent=res.textFound?res.baseToTextMm.toFixed(1)+' mm':'No detectado';
  $('mScore').textContent=res.masterScore!=null?res.masterScore.toFixed(0)+'%':'--';
  $('reason').textContent=res.reason;
}
function addLog(res){ const c=cfg(); const row={time:new Date().toLocaleString(), lot:c.lot, result:res.pass?'APROBADO':'RECHAZADO', width:res.widthMm?.toFixed(1)||'', height:res.heightMm?.toFixed(1)||'', baseText:res.textFound?res.baseToTextMm.toFixed(1):'', score:res.masterScore!=null?res.masterScore.toFixed(0):'', reason:res.reason}; log.unshift(row); log=log.slice(0,500); localStorage.setItem('inspectionLog',JSON.stringify(log)); renderLog(); }
function renderLog(){ $('logBody').innerHTML=log.map(r=>`<tr><td>${escapeHtml(r.time)}</td><td>${escapeHtml(r.lot)}</td><td>${escapeHtml(r.result)}</td><td>${escapeHtml(r.width)}</td><td>${escapeHtml(r.height)}</td><td>${escapeHtml(r.baseText||'')}</td><td>${escapeHtml(r.score||'')}</td><td>${escapeHtml(r.reason)}</td></tr>`).join(''); const ok=log.filter(r=>r.result==='APROBADO').length, bad=log.length-ok; $('okCount').textContent=ok; $('badCount').textContent=bad; $('totalCount').textContent=log.length; }
renderLog();

function loop(){ if(!stream) return; if(autoMode && Date.now()-lastAutoTs>850){ const r=analyzeFrame(false); if(r && (pxPerMm || cardCalibration)){ lastAutoTs=Date.now(); addLog(r); } } requestAnimationFrame(loop); }

function calibrateCardAuto(){
  if(!window.cvReady || typeof cv === 'undefined'){ toast('OpenCV aún está cargando. Espera unos segundos.'); return null; }
  if(!grabFrame()){ toast('No hay imagen. Inicia cámara primero.'); return null; }
  let src=cv.imread(capture);
  try{
    const det = detectCard7x7(src);
    if(!det || det.confidence < 82){
      setDecision(null, det ? `Ficha débil: ${det.confidence.toFixed(0)}%. El exterior 7×7 o el contraste centro/borde no son confiables.` : 'No encontré ficha 7×7 / 5×5.');
      if(det) drawCardCalibration(det, false);
      toast('No calibré: ficha no confiable');
      return null;
    }
    pxPerMm = det.pxPerMm;
    localStorage.setItem('pxPerMm', pxPerMm);
    cardCalibration = {
      savedAt:new Date().toISOString(),
      pxPerMm:det.pxPerMm,
      confidence:det.confidence,
      innerWidthMm:50,
      innerHeightMm:50,
      threshold:det.threshold,
      contrast:det.contrast,
      H_img_to_mm:det.H_img_to_mm,
      H_mm_to_img:det.H_mm_to_img,
      quad:det.quad,
      validation:det.validation
    };
    localStorage.setItem('cardCalibration7x7', JSON.stringify(cardCalibration));
    updateScaleText(); updateCardText();
    drawCardCalibration(det, true);
    setDecision(null, `Ficha calibrada ${det.confidence.toFixed(0)}%. Retira la ficha sin mover el celular y coloca el maestro 100%.`);
    toast('Ficha 7×7 / 5×5 calibrada');
    return det;
  }catch(e){ console.error(e); toast('Error calibrando ficha'); }
  finally{ src.delete(); }
  return null;
}

function detectCard7x7(src){
  let gray=new cv.Mat(), blur=new cv.Mat();
  let best=null;
  try{
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5,5), 0);
    const thresholds=[115,130,145,160,175,190,205,220,235];
    for(const t of thresholds){
      let mask=new cv.Mat(), clean=new cv.Mat(), contours=new cv.MatVector(), hierarchy=new cv.Mat();
      try{
        cv.threshold(blur, mask, t, 255, cv.THRESH_BINARY);
        const kClose=cv.Mat.ones(11,11,cv.CV_8U);
        const kOpen=cv.Mat.ones(3,3,cv.CV_8U);
        cv.morphologyEx(mask, clean, cv.MORPH_CLOSE, kClose);
        cv.morphologyEx(clean, clean, cv.MORPH_OPEN, kOpen);
        kClose.delete(); kOpen.delete();
        // RETR_TREE: queremos marco/ring blanco con posible hueco, no solo un contorno bonito.
        cv.findContours(clean, contours, hierarchy, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE);
        for(let i=0;i<contours.size();i++){
          const h = hierarchy.data32S ? hierarchy.data32S.slice(i*4, i*4+4) : [-1,-1,-1,-1];
          // Preferimos contornos externos. Si tiene hijo/hueco, suma confianza.
          if(h[3] !== -1) continue;
          const cont=contours.get(i);
          const cand=scoreCardCandidate7x7(cont, src, t, h[2] !== -1);
          if(cand && (!best || cand.score > best.score)) best=cand;
          cont.delete();
        }
      }finally{ mask.delete(); clean.delete(); contours.delete(); hierarchy.delete(); }
    }
  }finally{ gray.delete(); blur.delete(); }
  return best;
}

function scoreCardCandidate7x7(cont, src, threshold, hasHole){
  const imgArea = src.cols * src.rows;
  const area = cv.contourArea(cont);
  if(area < imgArea * 0.012 || area > imgArea * 0.82) return null;
  const peri = cv.arcLength(cont, true);
  let approx = new cv.Mat();
  let pts = null;
  let usedFallback = false;
  try{
    for(const eps of [0.010,0.014,0.020,0.028,0.040,0.055,0.070]){
      cv.approxPolyDP(cont, approx, eps * peri, true);
      if(approx.rows === 4 && cv.isContourConvex(approx)){ pts = matToPoints(approx); break; }
    }
    if(!pts){ const rect = cv.minAreaRect(cont); pts = rotatedRectPoints(rect); usedFallback = true; }
  }finally{ approx.delete(); }
  if(!pts || pts.length !== 4) return null;
  const quad = orderQuad(pts);
  const sides = [dist(quad[0],quad[1]),dist(quad[1],quad[2]),dist(quad[2],quad[3]),dist(quad[3],quad[0])];
  const minSide = Math.min(...sides), maxSide = Math.max(...sides);
  const sideRatio = minSide / maxSide;
  if(minSide < 45 || maxSide / minSide > 2.45) return null;

  const center = {x:(quad[0].x+quad[1].x+quad[2].x+quad[3].x)/4, y:(quad[0].y+quad[1].y+quad[2].y+quad[3].y)/4};
  const centerScore = 1 - clamp(Math.hypot(center.x-src.cols/2, center.y-src.rows/2)/Math.hypot(src.cols/2, src.rows/2),0,1);
  let warped=null;
  try{
    warped = warpQuad(src, quad, CARD_WARP, CARD_WARP);
    const v = validateWarpedCard7x7(warped);

    const H_img_to_mm = homographyArray(quad, [{x:0,y:0},{x:70,y:0},{x:70,y:70},{x:0,y:70}]);
    const H_mm_to_img = homographyArray([{x:0,y:0},{x:70,y:0},{x:70,y:70},{x:0,y:70}], quad);
    const expectedInnerPoly = projectMmBoxToOriginal(H_mm_to_img, {x:10,y:10,w:50,h:50});
    const avgSide = sides.reduce((a,b)=>a+b,0)/4;
    const pxScale = avgSide/70;

    const sizeScore = clamp(Math.sqrt(area / imgArea) * 4, 0, 1);
    const shapeScore = clamp(sideRatio, 0, 1);
    const holeScore = hasHole ? 1 : 0.68;
    const fallbackPenalty = usedFallback ? 0.84 : 1;

    const confidence = clamp((v.score*76 + shapeScore*8 + centerScore*6 + sizeScore*5 + holeScore*5) * fallbackPenalty, 0, 100);
    return { score:confidence, confidence, quad, innerPoly:expectedInnerPoly, expectedInnerPoly, center, pxPerMm:pxScale, threshold, innerWidthMm:50, innerHeightMm:50, borderMean:v.borderMean, innerMean:v.innerMean, contrast:v.contrast, validation:v, usedFallback, hasHole, H_img_to_mm, H_mm_to_img };
  }finally{ if(warped) warped.delete(); }
}

function validateWarpedCard7x7(warped){
  let gray = new cv.Mat();
  try{
    cv.cvtColor(warped, gray, cv.COLOR_RGBA2GRAY);
    // Geometría esperada del 5×5. No se detecta. Se valida.
    const inner = gray.roi(new cv.Rect(100,100,500,500));
    const top = gray.roi(new cv.Rect(120,35,460,45));
    const bottom = gray.roi(new cv.Rect(120,620,460,45));
    const left = gray.roi(new cv.Rect(35,120,45,460));
    const right = gray.roi(new cv.Rect(620,120,45,460));
    const innerMean=cv.mean(inner)[0];
    const topMean=cv.mean(top)[0], bottomMean=cv.mean(bottom)[0], leftMean=cv.mean(left)[0], rightMean=cv.mean(right)[0];
    const borderMean=(topMean+bottomMean+leftMean+rightMean)/4;
    const contrast=borderMean-innerMean;

    const darkInner=new cv.Mat(), whiteTop=new cv.Mat(), whiteBottom=new cv.Mat(), whiteLeft=new cv.Mat(), whiteRight=new cv.Mat();
    const darkThreshold = Math.max(55, Math.min(185, borderMean - 35));
    const whiteThreshold = Math.max(115, Math.min(230, innerMean + 35));
    cv.threshold(inner, darkInner, darkThreshold, 255, cv.THRESH_BINARY_INV);
    cv.threshold(top, whiteTop, whiteThreshold, 255, cv.THRESH_BINARY);
    cv.threshold(bottom, whiteBottom, whiteThreshold, 255, cv.THRESH_BINARY);
    cv.threshold(left, whiteLeft, whiteThreshold, 255, cv.THRESH_BINARY);
    cv.threshold(right, whiteRight, whiteThreshold, 255, cv.THRESH_BINARY);
    const innerDarkRatio = cv.countNonZero(darkInner)/(500*500);
    const borderWhiteRatio = (
      cv.countNonZero(whiteTop)/(460*45) + cv.countNonZero(whiteBottom)/(460*45) + cv.countNonZero(whiteLeft)/(45*460) + cv.countNonZero(whiteRight)/(45*460)
    )/4;
    const borderMeans=[topMean,bottomMean,leftMean,rightMean];
    const symmetryScore = clamp(1 - ((Math.max(...borderMeans)-Math.min(...borderMeans))/120), 0, 1);
    const contrastScore = clamp(contrast/95, 0, 1);
    const innerScore = clamp((innerDarkRatio - 0.22)/0.55, 0, 1);
    const borderScore = clamp((borderWhiteRatio - 0.40)/0.48, 0, 1);
    const score = clamp(contrastScore*.42 + innerScore*.24 + borderScore*.24 + symmetryScore*.10, 0, 1);

    inner.delete(); top.delete(); bottom.delete(); left.delete(); right.delete(); darkInner.delete(); whiteTop.delete(); whiteBottom.delete(); whiteLeft.delete(); whiteRight.delete();
    return {score, innerMean, borderMean, contrast, innerDarkRatio, borderWhiteRatio, symmetryScore, innerWidthPx:500, innerHeightPx:500};
  }finally{ gray.delete(); }
}

function drawCardCalibration(det, good){
  ctx.clearRect(0,0,overlay.clientWidth,overlay.clientHeight);
  if(det.quad) drawPoly(det.quad, good?'#1fd18a':'#ff4d5e', true, 4);
  if(det.innerPoly) drawPoly(det.innerPoly, '#ffd166', true, 4);
  if(det.expectedInnerPoly) drawPoly(det.expectedInnerPoly, '#58a6ff', true, 2);
  ctx.fillStyle=good?'#1fd18a':'#ff4d5e'; ctx.font='16px system-ui';
  ctx.fillText(good?`FICHA OK ${det.confidence.toFixed(0)}%`:`FICHA DÉBIL ${det.confidence.toFixed(0)}%`,18,30);
  ctx.fillText(`5×5 geométrico: 50.0 × 50.0 mm`,18,55);
  if(det.contrast != null) ctx.fillText(`Contraste centro/borde: ${det.contrast.toFixed(0)}`,18,80);
}

function calibrate(){
  const ref=cfg().refMm;
  if(!grabFrame()) return;
  toast('Toca 2 puntos de la referencia en pantalla');
  const pts=[];
  const onClick=(ev)=>{
    const rect=overlay.getBoundingClientRect();
    const fit = containFit(capture.width, capture.height, overlay.clientWidth, overlay.clientHeight);
    const cx = ev.clientX-rect.left;
    const cy = ev.clientY-rect.top;
    const x=(cx-fit.x)/fit.s;
    const y=(cy-fit.y)/fit.s;
    pts.push({x,y});
    ctx.fillStyle='#ffd166'; ctx.beginPath(); ctx.arc(cx,cy,6,0,Math.PI*2); ctx.fill();
    if(pts.length===2){
      overlay.removeEventListener('click',onClick);
      const d=Math.hypot(pts[1].x-pts[0].x,pts[1].y-pts[0].y);
      pxPerMm=d/ref;
      cardCalibration=null;
      localStorage.setItem('pxPerMm',pxPerMm);
      localStorage.removeItem('cardCalibration7x7');
      updateScaleText(); updateCardText(); toast('Escala manual calibrada');
    }
  };
  overlay.addEventListener('click',onClick);
}
function saveMaster(){
  const res = analyzeFrame(false, true);
  if(!res){ toast('No pude medir el maestro'); return; }
  if(!pxPerMm && !cardCalibration){ toast('Primero calibra la escala'); return; }
  if(!res.textFound){ toast('No detecté texto. Ajusta la zona de texto antes de guardar maestro.'); return; }
  master = { savedAt:new Date().toISOString(), widthMm:res.widthMm, heightMm:res.heightMm, areaMm2:res.areaMm2, angle:res.angle, baseToTextMm:res.baseToTextMm, textFound:res.textFound };
  localStorage.setItem('masterPatchMetrics', JSON.stringify(master));
  updateMasterText(); toast('Maestro 100% guardado');
  res.masterScore=100; res.baseScore=100; setDecision(res); drawResult(res);
}
function exportCSV(){
  const head='Hora,Lote,Resultado,Ancho,Alto,BaseTexto,Score,Motivo\n';
  const body=log.map(r=>[r.time,r.lot,r.result,r.width,r.height,r.baseText||'',r.score||'',`"${String(r.reason).replaceAll('"','""')}"`].join(',')).join('\n');
  const blob=new Blob([head+body],{type:'text/csv'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='historial_inspector_parches.csv'; a.click();
}

function normalizeAngle(angle,w,h){ let a=angle; if(w<h) a=angle+90; if(a>45)a-=90; if(a<-45)a+=90; return a; }
function dist(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }
function matToPoints(mat){ const data = mat.data32S && mat.data32S.length ? mat.data32S : mat.data32F; const pts=[]; for(let i=0;i<mat.rows;i++){ pts.push({x:data[i*2], y:data[i*2+1]}); } return pts; }
function rotatedRectPoints(rect){
  try{ return cv.RotatedRect.points(rect).map(p=>({x:p.x,y:p.y})); }
  catch{
    const a=(rect.angle||0)*Math.PI/180, ca=Math.cos(a), sa=Math.sin(a), w=rect.size.width/2, h=rect.size.height/2, cx=rect.center.x, cy=rect.center.y;
    return [{x:-w,y:-h},{x:w,y:-h},{x:w,y:h},{x:-w,y:h}].map(p=>({x:cx+p.x*ca-p.y*sa,y:cy+p.x*sa+p.y*ca}));
  }
}
function orderQuad(pts){
  const p=pts.map(q=>({x:q.x,y:q.y}));
  const sums=p.map(q=>q.x+q.y), diffs=p.map(q=>q.x-q.y);
  const tl=p[sums.indexOf(Math.min(...sums))], br=p[sums.indexOf(Math.max(...sums))], tr=p[diffs.indexOf(Math.max(...diffs))], bl=p[diffs.indexOf(Math.min(...diffs))];
  return [tl,tr,br,bl];
}
function orientPatch(quad, c){
  let q = quad.slice();
  const top=dist(q[0],q[1]), side=dist(q[1],q[2]);
  const targetPortrait = c.targetH >= c.targetW;
  if(targetPortrait && top > side) q = [q[1],q[2],q[3],q[0]];
  if(!targetPortrait && top < side) q = [q[3],q[0],q[1],q[2]];
  return q;
}
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
  const M=cv.getPerspectiveTransform(src,dst); const arr=Array.from(M.data64F && M.data64F.length ? M.data64F : M.data32F);
  src.delete(); dst.delete(); M.delete(); return arr;
}
function transformPoint(h,x,y){ const den=h[6]*x+h[7]*y+h[8]; return {x:(h[0]*x+h[1]*y+h[2])/den, y:(h[3]*x+h[4]*y+h[5])/den}; }
function projectWarpBoxToOriginal(b, ordered, outW, outH){
  const H=homographyArray([{x:0,y:0},{x:outW,y:0},{x:outW,y:outH},{x:0,y:outH}], ordered);
  return [transformPoint(H,b.x,b.y), transformPoint(H,b.x+b.w,b.y), transformPoint(H,b.x+b.w,b.y+b.h), transformPoint(H,b.x,b.y+b.h)];
}
function projectWarpLineToOriginal(a,b,ordered,outW,outH){
  const H=homographyArray([{x:0,y:0},{x:outW,y:0},{x:outW,y:outH},{x:0,y:outH}], ordered);
  return [transformPoint(H,a.x,a.y), transformPoint(H,b.x,b.y)];
}
function projectMmBoxToOriginal(HmmToImg, b){
  return [
    transformPoint(HmmToImg,b.x,b.y),
    transformPoint(HmmToImg,b.x+b.w,b.y),
    transformPoint(HmmToImg,b.x+b.w,b.y+b.h),
    transformPoint(HmmToImg,b.x,b.y+b.h)
  ];
}
function contourToPoints(contour, step=1){
  const data=contour.data32S; const pts=[];
  for(let i=0;i<contour.rows;i+=step) pts.push({x:data[i*2],y:data[i*2+1]});
  return pts;
}
function matFromPoints32F(points){
  const arr=[]; points.forEach(p=>{ arr.push(p.x,p.y); });
  return cv.matFromArray(points.length,1,cv.CV_32FC2,arr);
}
function polygonArea(pts){
  let s=0; for(let i=0;i<pts.length;i++){ const a=pts[i], b=pts[(i+1)%pts.length]; s += a.x*b.y - b.x*a.y; }
  return s/2;
}
function unionBoxes(boxes){ const x1=Math.min(...boxes.map(b=>b.x)), y1=Math.min(...boxes.map(b=>b.y)), x2=Math.max(...boxes.map(b=>b.x+b.w)), y2=Math.max(...boxes.map(b=>b.y+b.h)); return {x:x1,y:y1,w:x2-x1,h:y2-y1}; }

$('btnStart').onclick=startCamera;
$('btnCardCalibrate').onclick=calibrateCardAuto;
$('btnCardCalibrateSide').onclick=calibrateCardAuto;
$('btnMeasure').onclick=()=>analyzeFrame(true);
$('btnAuto').onclick=()=>{ autoMode=!autoMode; $('btnAuto').dataset.active=String(autoMode); $('btnAuto').textContent='Auto: '+(autoMode?'ON':'OFF'); toast(autoMode?'Medición automática activa':'Medición automática detenida'); };
$('btnCalibrate').onclick=calibrate;
$('btnExport').onclick=exportCSV;
$('btnReset').onclick=()=>{ log=[]; localStorage.removeItem('inspectionLog'); renderLog(); toast('Conteo reiniciado'); };
$('btnSaveMaster').onclick=saveMaster;
$('btnClearMaster').onclick=()=>{ master=null; localStorage.removeItem('masterPatchMetrics'); updateMasterText(); toast('Maestro borrado'); };
$('btnClearCard').onclick=()=>{ cardCalibration=null; pxPerMm=0; localStorage.removeItem('cardCalibration7x7'); localStorage.removeItem('pxPerMm'); updateCardText(); updateScaleText(); toast('Ficha y escala borradas'); };
