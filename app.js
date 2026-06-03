const $ = id => document.getElementById(id);
const video = $('video');
const overlay = $('overlay');
const ctx = overlay.getContext('2d');
const capture = $('captureCanvas');
const capCtx = capture.getContext('2d');
const patchCanvas = $('patchCanvas');

let stream = null;
let autoMode = false;
let lastAutoTs = 0;
let pxPerMm = Number(localStorage.getItem('pxPerMm') || 0);
let log = safeJson(localStorage.getItem('inspectionLog'), []);
let master = safeJson(localStorage.getItem('masterPatchMetrics'), null);
let cardCalibration = safeJson(localStorage.getItem('cardCalibration7x7'), null);

function safeJson(txt, fallback){ try { return txt ? JSON.parse(txt) : fallback; } catch { return fallback; } }
function toast(msg){ const t=$('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),1800); }
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
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
function updateScaleText(){ $('scaleText').textContent = pxPerMm ? `Escala: ${pxPerMm.toFixed(3)} px/mm guardada.` : 'Escala: no calibrada. Recomendado: calibrar con ficha 7×7 / 5×5.'; }
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
  $('refArea').textContent = `${fmt(master.areaMm,0)} mm²`;
}
updateScaleText(); updateMasterText();

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
  $('cardInner').textContent=`${fmt(cardCalibration.innerWidthMm,1)} × ${fmt(cardCalibration.innerHeightMm,1)} mm`;
  $('cardScale').textContent=`${fmt(cardCalibration.pxPerMm,3)} px/mm`;
}
updateCardText();


async function startCamera(){
  try{
    stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}, width:{ideal:1920}, height:{ideal:1080}}, audio:false});
    video.srcObject = stream; await video.play(); setStatus('Cámara activa','live'); resizeCanvas(); loop(); toast('Cámara iniciada');
  }catch(e){ setStatus('Error cámara','bad'); toast('No se pudo abrir cámara. Usa HTTPS/GitHub Pages.'); console.error(e); }
}
function resizeCanvas(){ const r=video.getBoundingClientRect(); overlay.width=r.width*devicePixelRatio; overlay.height=r.height*devicePixelRatio; ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0); }
window.addEventListener('resize', resizeCanvas);

function drawResult(res){
  ctx.clearRect(0,0,overlay.width,overlay.height);
  const sx = overlay.clientWidth / capture.width, sy = overlay.clientHeight / capture.height;
  ctx.lineWidth=3; ctx.strokeStyle=res.pass?'#1fd18a':'#ff4d5e'; ctx.fillStyle=ctx.strokeStyle; ctx.font='16px system-ui';
  if(res.box){ ctx.beginPath(); res.box.forEach((p,i)=>{ const x=p.x*sx, y=p.y*sy; i?ctx.lineTo(x,y):ctx.moveTo(x,y); }); ctx.closePath(); ctx.stroke(); }
  if(res.textPoly){
    ctx.strokeStyle='#ffd166'; ctx.fillStyle='#ffd166'; ctx.beginPath();
    res.textPoly.forEach((p,i)=>{ const x=p.x*sx, y=p.y*sy; i?ctx.lineTo(x,y):ctx.moveTo(x,y); }); ctx.closePath(); ctx.stroke();
  }
  if(res.baseLine){
    ctx.strokeStyle='#58a6ff'; ctx.fillStyle='#58a6ff'; ctx.lineWidth=4;
    ctx.beginPath(); ctx.moveTo(res.baseLine[0].x*sx, res.baseLine[0].y*sy); ctx.lineTo(res.baseLine[1].x*sx, res.baseLine[1].y*sy); ctx.stroke();
    ctx.fillText('Base a Texto', res.baseLine[1].x*sx + 8, res.baseLine[1].y*sy - 8);
  }
  ctx.fillStyle=res.pass?'#1fd18a':'#ff4d5e';
  ctx.fillText(res.pass?'APROBADO':'RECHAZADO',18,30);
  if(res.masterScore!=null) ctx.fillText(`${res.masterScore.toFixed(0)}% vs maestro`,18,55);
}

function grabFrame(){
  const vw=video.videoWidth, vh=video.videoHeight; if(!vw) return false;
  capture.width=vw; capture.height=vh; capCtx.drawImage(video,0,0,vw,vh); return true;
}

function analyzeFrame(record=false, silent=false){
  if(!window.cvReady || typeof cv === 'undefined'){ toast('OpenCV aún está cargando. Internet, esa ruleta rusa.'); return null; }
  if(!grabFrame()) return null;
  let src=cv.imread(capture), gray=new cv.Mat(), blur=new cv.Mat(), edges=new cv.Mat(), contours=new cv.MatVector(), hierarchy=new cv.Mat();
  let result=null;
  try{
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5,5), 0);
    cv.Canny(blur, edges, 50, 150);
    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let best=null, bestArea=0;
    const minArea = capture.width*capture.height*0.01;
    for(let i=0;i<contours.size();i++){
      const cont=contours.get(i); const area=cv.contourArea(cont);
      if(area>bestArea && area>minArea){ if(best) best.delete(); bestArea=area; best=cont; }
      else cont.delete();
    }
    if(!best){ setDecision(null,'No encuentro contorno claro. Usa fondo sólido y contraste.'); return null; }
    const rect=cv.minAreaRect(best);
    const pts=cv.RotatedRect.points(rect).map(p=>({x:p.x,y:p.y}));
    const wpx=Math.max(rect.size.width, rect.size.height); const hpx=Math.min(rect.size.width, rect.size.height);
    const angle = normalizeAngle(rect.angle, rect.size.width, rect.size.height);
    const c=cfg();
    const widthMm = pxPerMm ? wpx/pxPerMm : null;
    const heightMm = pxPerMm ? hpx/pxPerMm : null;
    const areaMm = pxPerMm ? bestArea/(pxPerMm*pxPerMm) : null;
    const text = detectTextAndBase(src, pts, c);
    let reasons=[]; let pass=true;
    if(!pxPerMm){ pass=false; reasons.push('Falta calibrar escala'); }
    else{
      if(Math.abs(widthMm-c.targetW)>c.tolW){ pass=false; reasons.push(`Ancho fuera por ${(widthMm-c.targetW).toFixed(1)} mm`); }
      if(Math.abs(heightMm-c.targetH)>c.tolH){ pass=false; reasons.push(`Alto fuera por ${(heightMm-c.targetH).toFixed(1)} mm`); }
      if(Math.abs(angle)>c.tolAngle){ pass=false; reasons.push(`Giro excesivo: ${angle.toFixed(1)}°`); }
    }

    const scorePack = scoreAgainstMaster({widthMm,heightMm,areaMm,angle,baseToTextMm:text.baseToTextMm,textFound:text.found}, c);
    if(pxPerMm && c.useMaster && master){
      if(scorePack.masterScore < c.acceptPct){ pass=false; reasons.push(`Score general ${scorePack.masterScore.toFixed(0)}%, mínimo ${c.acceptPct}%`); }
      if(scorePack.baseScore != null && scorePack.baseScore < c.baseTextAcceptPct){ pass=false; reasons.push(`Base a Texto ${scorePack.baseScore.toFixed(0)}%, mínimo ${c.baseTextAcceptPct}%`); }
      if(scorePack.baseScore == null){ pass=false; reasons.push('No detecté texto para medir Base a Texto'); }
    }

    result={
      pass, widthMm, heightMm, angle, areaMm, box:pts,
      textFound:text.found, baseToTextMm:text.baseToTextMm,
      textPoly:text.poly, baseLine:text.baseLine,
      masterScore:scorePack.masterScore, baseScore:scorePack.baseScore,
      scoreDetail:scorePack,
      reason:reasons.join('; ')||'Dentro de tolerancia'
    };
    if(best) best.delete();
    if(!silent){ setDecision(result); drawResult(result); }
    if(record) addLog(result);
  }catch(e){ console.error(e); toast('Error midiendo. El universo eligió violencia.'); }
  finally{ src.delete(); gray.delete(); blur.delete(); edges.delete(); contours.delete(); hierarchy.delete(); }
  return result;
}

function detectTextAndBase(src, pts, c){
  const empty = {found:false, baseToTextMm:null, poly:null, baseLine:null};
  if(!pxPerMm) return empty;
  let ordered = orientPatch(orderQuad(pts), c);
  const topW = dist(ordered[0], ordered[1]);
  const rightH = dist(ordered[1], ordered[2]);
  const outW = Math.max(40, Math.round(topW));
  const outH = Math.max(40, Math.round(rightH));
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
    const kClose = cv.Mat.ones(5,13,cv.CV_8U);
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
      if(r.width > outW*.95 || r.height > outH*.45) continue;
      boxes.push({x:r.x+xPad,y:r.y+y1,w:r.width,h:r.height,area});
    }
    if(!boxes.length) return empty;
    const b = unionBoxes(boxes);
    const baseToTextPx = outH - (b.y + b.h);
    const baseToTextMm = baseToTextPx / pxPerMm;
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
  const areaScore = simScore(m.areaMm, master.areaMm);
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

function normalizeAngle(angle,w,h){ let a=angle; if(w<h) a=angle+90; if(a>45)a-=90; if(a<-45)a+=90; return a; }
function setDecision(res, msg){
  if(!res){ $('decision').textContent='ESPERANDO'; $('decision').className='decision neutral'; $('reason').textContent=msg||'Esperando parche.'; return; }
  $('decision').textContent=res.pass?'APROBADO':'RECHAZADO'; $('decision').className='decision '+(res.pass?'ok':'bad');
  $('mWidth').textContent=res.widthMm?res.widthMm.toFixed(1)+' mm':'--'; $('mHeight').textContent=res.heightMm?res.heightMm.toFixed(1)+' mm':'--';
  $('mAngle').textContent=res.angle.toFixed(1)+'°'; $('mArea').textContent=res.areaMm?res.areaMm.toFixed(0)+' mm²':'--';
  $('mBaseText').textContent=res.textFound?res.baseToTextMm.toFixed(1)+' mm':'No detectado';
  $('mScore').textContent=res.masterScore!=null?res.masterScore.toFixed(0)+'%':'--';
  $('reason').textContent=res.reason;
}
function addLog(res){ const c=cfg(); const row={time:new Date().toLocaleString(), lot:c.lot, result:res.pass?'APROBADO':'RECHAZADO', width:res.widthMm?.toFixed(1)||'', height:res.heightMm?.toFixed(1)||'', baseText:res.textFound?res.baseToTextMm.toFixed(1):'', score:res.masterScore!=null?res.masterScore.toFixed(0):'', reason:res.reason}; log.unshift(row); log=log.slice(0,500); localStorage.setItem('inspectionLog',JSON.stringify(log)); renderLog(); }
function renderLog(){ $('logBody').innerHTML=log.map(r=>`<tr><td>${r.time}</td><td>${r.lot}</td><td>${r.result}</td><td>${r.width}</td><td>${r.height}</td><td>${r.baseText||''}</td><td>${r.score||''}</td><td>${escapeHtml(r.reason)}</td></tr>`).join(''); const ok=log.filter(r=>r.result==='APROBADO').length, bad=log.length-ok; $('okCount').textContent=ok; $('badCount').textContent=bad; $('totalCount').textContent=log.length; }
renderLog();


function loop(){ if(!stream) return; if(autoMode && Date.now()-lastAutoTs>850){ const r=analyzeFrame(false); if(r && pxPerMm){ lastAutoTs=Date.now(); addLog(r); } } requestAnimationFrame(loop); }

function calibrateCardAuto(){
  if(!window.cvReady || typeof cv === 'undefined'){ toast('OpenCV aún está cargando. Espera unos segundos.'); return null; }
  if(!grabFrame()){ toast('No hay imagen. Inicia cámara primero.'); return null; }
  let src=cv.imread(capture);
  try{
    const det = detectCard7x7(src);
    if(!det || det.confidence < 72){
      setDecision(null, det ? `Ficha débil: ${det.confidence.toFixed(0)}%. Centra la ficha, mejora luz y evita sombras.` : 'No encontré ficha 7×7 / 5×5.');
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
      innerWidthMm:det.innerWidthMm,
      innerHeightMm:det.innerHeightMm,
      threshold:det.threshold
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
    const thresholds=[125,140,155,170,185,200,215,230];
    for(const t of thresholds){
      let mask=new cv.Mat(), clean=new cv.Mat(), contours=new cv.MatVector(), hierarchy=new cv.Mat();
      try{
        cv.threshold(blur, mask, t, 255, cv.THRESH_BINARY);
        const kClose=cv.Mat.ones(9,9,cv.CV_8U);
        const kOpen=cv.Mat.ones(3,3,cv.CV_8U);
        cv.morphologyEx(mask, clean, cv.MORPH_CLOSE, kClose);
        cv.morphologyEx(clean, clean, cv.MORPH_OPEN, kOpen);
        kClose.delete(); kOpen.delete();
        cv.findContours(clean, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        for(let i=0;i<contours.size();i++){
          const cont=contours.get(i);
          const cand=scoreCardCandidate7x7(cont, src, t);
          if(cand && (!best || cand.score > best.score)) best=cand;
          cont.delete();
        }
      }finally{ mask.delete(); clean.delete(); contours.delete(); hierarchy.delete(); }
    }
  }finally{ gray.delete(); blur.delete(); }
  return best;
}

function scoreCardCandidate7x7(cont, src, threshold){
  const imgArea=src.cols*src.rows;
  const area=cv.contourArea(cont);
  if(area < imgArea*0.015 || area > imgArea*0.80) return null;
  const peri=cv.arcLength(cont, true);
  let approx=new cv.Mat();
  let pts=null;
  try{
    for(const eps of [0.015,0.02,0.028,0.04,0.055]){
      cv.approxPolyDP(cont, approx, eps*peri, true);
      if(approx.rows===4 && cv.isContourConvex(approx)){ pts=matToPoints(approx); break; }
    }
    if(!pts){
      const rect=cv.minAreaRect(cont);
      pts=cv.RotatedRect.points(rect).map(p=>({x:p.x,y:p.y}));
    }
  }finally{ approx.delete(); }
  if(!pts || pts.length!==4) return null;
  const quad=orderQuad(pts);
  const sides=[dist(quad[0],quad[1]),dist(quad[1],quad[2]),dist(quad[2],quad[3]),dist(quad[3],quad[0])];
  const minSide=Math.min(...sides), maxSide=Math.max(...sides);
  if(minSide < 40 || maxSide/minSide > 2.25) return null;
  const center={x:(quad[0].x+quad[1].x+quad[2].x+quad[3].x)/4,y:(quad[0].y+quad[1].y+quad[2].y+quad[3].y)/4};
  const centerScore=1-clamp(Math.hypot(center.x-src.cols/2,center.y-src.rows/2)/Math.hypot(src.cols/2,src.rows/2),0,1);
  let warped=null;
  try{
    warped=warpQuad(src, quad, 700, 700);
    const v=validateWarpedCard7x7(warped);
    const sizeScore=clamp(Math.sqrt(area/imgArea)*4,0,1);
    const shapeScore=clamp(minSide/maxSide,0,1);
    const confidence=clamp(v.score*70 + shapeScore*15 + centerScore*8 + sizeScore*7,0,100);
    const avgSide=(sides[0]+sides[1]+sides[2]+sides[3])/4;
    const pxPerMm=avgSide/70;
    const innerPoly = projectWarpBoxToOriginal({x:100,y:100,w:500,h:500}, quad, 700, 700);
    return {score:confidence, confidence, quad, innerPoly, center, pxPerMm, threshold, innerWidthMm:v.innerWidthPx/10, innerHeightMm:v.innerHeightPx/10, borderMean:v.borderMean, innerMean:v.innerMean};
  }finally{ if(warped) warped.delete(); }
}

function validateWarpedCard7x7(warped){
  let gray=new cv.Mat(), search=null, black=new cv.Mat(), contours=new cv.MatVector(), hierarchy=new cv.Mat();
  try{
    cv.cvtColor(warped, gray, cv.COLOR_RGBA2GRAY);
    const inner = gray.roi(new cv.Rect(120,120,460,460));
    const top = gray.roi(new cv.Rect(90,25,520,50));
    const bottom = gray.roi(new cv.Rect(90,625,520,50));
    const left = gray.roi(new cv.Rect(25,90,50,520));
    const right = gray.roi(new cv.Rect(625,90,50,520));
    const innerMean=cv.mean(inner)[0];
    const borderMean=(cv.mean(top)[0]+cv.mean(bottom)[0]+cv.mean(left)[0]+cv.mean(right)[0])/4;
    inner.delete(); top.delete(); bottom.delete(); left.delete(); right.delete();
    search = gray.roi(new cv.Rect(70,70,560,560));
    const threshold=Math.max(45, Math.min(180, (innerMean+borderMean)/2));
    cv.threshold(search, black, threshold, 255, cv.THRESH_BINARY_INV);
    const k=cv.Mat.ones(5,5,cv.CV_8U);
    cv.morphologyEx(black, black, cv.MORPH_CLOSE, k); k.delete();
    cv.findContours(black, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let bestArea=0, bestRect=null;
    for(let i=0;i<contours.size();i++){
      const c=contours.get(i); const area=cv.contourArea(c); const r=cv.boundingRect(c); c.delete();
      if(area>bestArea){ bestArea=area; bestRect=r; }
    }
    const rectW=bestRect?bestRect.width:0, rectH=bestRect?bestRect.height:0;
    const cx=bestRect?70+bestRect.x+bestRect.width/2:0, cy=bestRect?70+bestRect.y+bestRect.height/2:0;
    const contrast=borderMean-innerMean;
    const contrastScore=clamp(contrast/110,0,1);
    const sizeScore=bestRect?clamp(1-(Math.abs(rectW-500)+Math.abs(rectH-500))/520,0,1):0;
    const centerScore=bestRect?clamp(1-(Math.abs(cx-350)+Math.abs(cy-350))/250,0,1):0;
    const areaScore=clamp(1-Math.abs((bestArea/(500*500))-1),0,1);
    const score=(contrastScore*.40 + sizeScore*.32 + centerScore*.18 + areaScore*.10);
    return {score, innerMean, borderMean, innerWidthPx:rectW, innerHeightPx:rectH};
  }finally{ gray.delete(); if(search) search.delete(); black.delete(); contours.delete(); hierarchy.delete(); }
}

function drawCardCalibration(det, good){
  ctx.clearRect(0,0,overlay.width,overlay.height);
  const sx=overlay.clientWidth/capture.width, sy=overlay.clientHeight/capture.height;
  ctx.lineWidth=4; ctx.strokeStyle=good?'#1fd18a':'#ff4d5e'; ctx.fillStyle=ctx.strokeStyle; ctx.font='16px system-ui';
  if(det.quad){ ctx.beginPath(); det.quad.forEach((p,i)=>{ const x=p.x*sx,y=p.y*sy; i?ctx.lineTo(x,y):ctx.moveTo(x,y); }); ctx.closePath(); ctx.stroke(); }
  if(det.innerPoly){ ctx.strokeStyle='#ffd166'; ctx.beginPath(); det.innerPoly.forEach((p,i)=>{ const x=p.x*sx,y=p.y*sy; i?ctx.lineTo(x,y):ctx.moveTo(x,y); }); ctx.closePath(); ctx.stroke(); }
  ctx.fillStyle=good?'#1fd18a':'#ff4d5e';
  ctx.fillText(good?`FICHA OK ${det.confidence.toFixed(0)}%`:`FICHA DÉBIL ${det.confidence.toFixed(0)}%`,18,30);
  ctx.fillText(`Negro: ${det.innerWidthMm.toFixed(1)} × ${det.innerHeightMm.toFixed(1)} mm`,18,55);
}

function calibrate(){ const ref=cfg().refMm; if(!grabFrame()) return; toast('Toca 2 puntos de la referencia en pantalla');
  const pts=[]; const onClick=(ev)=>{ const rect=overlay.getBoundingClientRect(); const x=(ev.clientX-rect.left)*capture.width/rect.width; const y=(ev.clientY-rect.top)*capture.height/rect.height; pts.push({x,y}); ctx.fillStyle='#ffd166'; ctx.beginPath(); ctx.arc(ev.clientX-rect.left,ev.clientY-rect.top,6,0,Math.PI*2); ctx.fill(); if(pts.length===2){ overlay.removeEventListener('click',onClick); const d=Math.hypot(pts[1].x-pts[0].x,pts[1].y-pts[0].y); pxPerMm=d/ref; localStorage.setItem('pxPerMm',pxPerMm); updateScaleText(); toast('Escala calibrada'); } };
  overlay.addEventListener('click',onClick);
}
function saveMaster(){
  const res = analyzeFrame(false, true);
  if(!res){ toast('No pude medir el maestro'); return; }
  if(!pxPerMm){ toast('Primero calibra la escala'); return; }
  if(!res.textFound){ toast('No detecté texto. Ajusta la zona de texto antes de guardar maestro.'); return; }
  master = { savedAt:new Date().toISOString(), widthMm:res.widthMm, heightMm:res.heightMm, areaMm:res.areaMm, angle:res.angle, baseToTextMm:res.baseToTextMm, textFound:res.textFound };
  localStorage.setItem('masterPatchMetrics', JSON.stringify(master));
  updateMasterText(); toast('Maestro 100% guardado');
  res.masterScore=100; res.baseScore=100; setDecision(res); drawResult(res);
}
function exportCSV(){ const head='Hora,Lote,Resultado,Ancho,Alto,BaseTexto,Score,Motivo\n'; const body=log.map(r=>[r.time,r.lot,r.result,r.width,r.height,r.baseText||'',r.score||'',`"${String(r.reason).replaceAll('"','""')}"`].join(',')).join('\n'); const blob=new Blob([head+body],{type:'text/csv'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='historial_inspector_parches.csv'; a.click(); }

function fmt(n,d=1){ return n==null || !isFinite(n) ? '--' : Number(n).toFixed(d); }
function escapeHtml(value){ return String(value ?? '').replace(/[&<>"']/g, s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }
function dist(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }
function matToPoints(mat){ const data = mat.data32S && mat.data32S.length ? mat.data32S : mat.data32F; const pts=[]; for(let i=0;i<mat.rows;i++){ pts.push({x:data[i*2], y:data[i*2+1]}); } return pts; }
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
