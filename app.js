(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const els = {
    video: $('video'), overlay: $('overlay'), frame: $('frameCanvas'), patch: $('patchCanvas'),
    refPreview: $('refPreview'), lastPreview: $('lastPreview'),
    opencvBadge: $('opencvBadge'), cameraBadge: $('cameraBadge'), decision: $('decision'), reason: $('reason'),
    scaleText: $('scaleText'), refText: $('refText'), autoStateText: $('autoStateText'),
    mWidth: $('mWidth'), mHeight: $('mHeight'), mArea: $('mArea'), mAngle: $('mAngle'), mTextOffset: $('mTextOffset'), mTextDelta: $('mTextDelta'),
    okCount: $('okCount'), badCount: $('badCount'), totalCount: $('totalCount'), okPct: $('okPct'), logBody: $('logBody'),
    refDetails: $('refDetails'), lastDetails: $('lastDetails'), toast: $('toast')
  };

  const ctx = els.overlay.getContext('2d');
  const frameCtx = els.frame.getContext('2d', { willReadFrequently: true });
  const refCtx = els.refPreview.getContext('2d');
  const lastCtx = els.lastPreview.getContext('2d');

  let stream = null;
  let pxPerMm = Number(localStorage.getItem('patchInspectorV4.pxPerMm') || 0);
  let reference = safeJson(localStorage.getItem('patchInspectorV4.reference'), null);
  let inspectionLog = safeJson(localStorage.getItem('patchInspectorV4.log'), []);
  let autoEnabled = false;
  let autoState = 'idle'; // idle | candidate | locked
  let stableFrames = 0;
  let lastSignature = null;
  let lastAutoProcess = 0;
  let manualCalibrationHandler = null;
  let manualCalibrationPoints = [];

  function safeJson(raw, fallback) {
    try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
  }

  function cfg() {
    return {
      lot: $('lotName').value.trim() || 'Sin lote',
      squareMm: positiveNumber($('squareMm').value, 50),
      tolSizePct: positiveNumber($('tolSizePct').value, 3),
      tolAreaPct: positiveNumber($('tolAreaPct').value, 6),
      tolTextRefMm: positiveNumber($('tolTextRefMm').value, 1.5),
      tolTextAbsMm: positiveNumber($('tolTextAbsMm').value, 2.5),
      tolAngle: positiveNumber($('tolAngle').value, 25),
      textStartPct: clamp(positiveNumber($('textStartPct').value, 62), 40, 85),
      textThreshold: clamp(positiveNumber($('textThreshold').value, 95), 20, 180),
      patchThreshold: clamp(positiveNumber($('patchThreshold').value, 55), 10, 220),
      minPatchAreaPct: clamp(positiveNumber($('minPatchAreaPct').value, 1), 0.1, 30)
    };
  }

  function positiveNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  function toast(message, ms = 2100) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => els.toast.classList.remove('show'), ms);
  }

  function setBadge(el, text, cls) {
    el.textContent = text;
    el.className = `badge ${cls || 'idle'}`;
  }

  function setDecision(type, text, reason) {
    els.decision.textContent = text;
    els.decision.className = `decision ${type}`;
    els.reason.textContent = reason || '';
  }

  function cvIsReady() { return window.cvReady && typeof cv !== 'undefined' && cv.Mat; }

  window.addEventListener('opencv-ready', () => {
    setBadge(els.opencvBadge, 'OpenCV listo', 'live');
    toast('OpenCV cargado. Ya podemos medir sin rezarle al navegador.');
  });

  if (cvIsReady()) setBadge(els.opencvBadge, 'OpenCV listo', 'live');
  else setBadge(els.opencvBadge, 'Cargando OpenCV', 'warn');

  function resizeOverlay() {
    const r = els.video.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    els.overlay.width = Math.max(1, Math.round(r.width * ratio));
    els.overlay.height = Math.max(1, Math.round(r.height * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    clearOverlay();
  }

  window.addEventListener('resize', resizeOverlay);
  window.addEventListener('orientationchange', () => setTimeout(resizeOverlay, 400));

  async function startCamera() {
    const attempts = [
      {
        name: 'cámara trasera alta',
        constraints: { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }
      },
      {
        name: 'cámara trasera media',
        constraints: { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }
      },
      {
        name: 'cualquier cámara',
        constraints: { video: true, audio: false }
      },
      {
        name: 'cámara frontal',
        constraints: { video: { facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }
      }
    ];

    try {
      if (!window.isSecureContext) {
        throw Object.assign(new Error('La página no está en HTTPS o localhost.'), { name: 'InsecureContextError' });
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw Object.assign(new Error('Este navegador no permite acceso a cámara con getUserMedia.'), { name: 'GetUserMediaMissing' });
      }

      if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
      }

      let newStream = null;
      let usedAttempt = '';
      let lastError = null;

      for (const attempt of attempts) {
        try {
          newStream = await navigator.mediaDevices.getUserMedia(attempt.constraints);
          usedAttempt = attempt.name;
          break;
        } catch (err) {
          lastError = err;
          console.warn(`Fallo ${attempt.name}:`, err);
        }
      }

      if (!newStream) throw lastError || new Error('No se pudo iniciar ninguna cámara.');

      stream = newStream;
      els.video.setAttribute('playsinline', '');
      els.video.setAttribute('webkit-playsinline', '');
      els.video.muted = true;
      els.video.autoplay = true;
      els.video.srcObject = stream;

      await waitForVideoReady(els.video);
      await els.video.play();

      const track = stream.getVideoTracks()[0];
      const settings = track && track.getSettings ? track.getSettings() : {};
      setBadge(els.cameraBadge, 'Cámara activa', 'live');
      resizeOverlay();
      setWorkflow();
      requestAnimationFrame(loop);
      toast(`Cámara iniciada (${usedAttempt}${settings.width ? ` · ${settings.width}×${settings.height}` : ''}).`, 3400);
    } catch (err) {
      console.error(err);
      setBadge(els.cameraBadge, 'Error cámara', 'bad');
      const msg = cameraErrorMessage(err);
      setDecision('bad', 'CÁMARA BLOQUEADA', msg);
      toast(msg, 5200);
    }
  }

  function waitForVideoReady(video) {
    return new Promise((resolve, reject) => {
      if (video.readyState >= 2 && video.videoWidth) return resolve();
      const timeout = setTimeout(() => resolve(), 2500);
      video.onloadedmetadata = () => { clearTimeout(timeout); resolve(); };
      video.onerror = () => { clearTimeout(timeout); reject(new Error('No se pudo cargar el video de la cámara.')); };
    });
  }

  function cameraErrorMessage(err) {
    const name = err && err.name ? err.name : 'Error';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      return 'Permiso de cámara denegado. En el navegador, toca el candado/AA de la URL y permite Cámara para este sitio.';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return 'No encontré cámara disponible. Cierra otras apps que usen cámara y vuelve a intentar.';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return 'La cámara está ocupada por otra app o el navegador se trabó. Cierra cámara/WhatsApp/Instagram y recarga.';
    }
    if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
      return 'La cámara no acepta la resolución solicitada. Esta versión ya intenta resoluciones menores; recarga e intenta otra vez.';
    }
    if (name === 'SecurityError' || name === 'InsecureContextError') {
      return 'La cámara solo funciona en HTTPS. Abre la liga de GitHub Pages, no el archivo local ni la vista de código de GitHub.';
    }
    if (name === 'GetUserMediaMissing') {
      return 'Este navegador no soporta acceso a cámara aquí. Usa Safari/Chrome actualizado desde la liga HTTPS de GitHub Pages.';
    }
    return `No pude abrir cámara (${name}). Recarga la página, revisa permisos y abre desde GitHub Pages HTTPS.`;
  }

  function grabFrame() {
    const w = els.video.videoWidth;
    const h = els.video.videoHeight;
    if (!w || !h) return false;
    els.frame.width = w;
    els.frame.height = h;
    frameCtx.drawImage(els.video, 0, 0, w, h);
    return true;
  }

  function clearOverlay() {
    ctx.clearRect(0, 0, els.overlay.clientWidth, els.overlay.clientHeight);
  }

  function drawPolygon(points, color = '#ffd166', label = '') {
    clearOverlay();
    if (!points || !points.length) return;
    const sx = els.overlay.clientWidth / els.frame.width;
    const sy = els.overlay.clientHeight / els.frame.height;
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.font = '700 16px system-ui';
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = p.x * sx;
      const y = p.y * sy;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
    if (label) ctx.fillText(label, 18, 30);
    ctx.restore();
  }

  function calibrateWithSquare() {
    if (!cvIsReady()) return toast('OpenCV aún está cargando. Espera unos segundos.', 2600);
    if (!grabFrame()) return toast('Primero inicia la cámara. Sí, la parte aburrida pero necesaria.');
    cancelManualCalibration(false);

    let src = null;
    try {
      src = cv.imread(els.frame);
      const best = findCalibrationSquare(src);

      if (!best) {
        setDecision('bad', 'NO CALIBRADO', 'No encontré el cuadro negro 5×5. Usa el botón “Calibrar manual 4 esquinas” y toca las 4 esquinas del cuadro.');
        toast('No detecté el cuadro. Usa manual 4 esquinas o mejora contraste/luz.', 4200);
        return;
      }

      const squareMm = cfg().squareMm;
      pxPerMm = best.sidePx / squareMm;
      localStorage.setItem('patchInspectorV4.pxPerMm', String(pxPerMm));
      drawPolygon(best.points, '#ffd166', `CUADRO 5×5 DETECTADO · T${best.threshold}`);
      setDecision('ok', 'CALIBRADO', `Escala guardada: ${pxPerMm.toFixed(3)} px/mm. Lado detectado: ${best.sidePx.toFixed(1)} px. Retira el cuadro sin mover el celular.`);
      toast(`Calibrado: ${pxPerMm.toFixed(3)} px/mm. Ahora retira el cuadro.`, 3600);
      updateStatus();
      setWorkflow();
    } catch (err) {
      console.error(err);
      setDecision('bad', 'ERROR CALIBRANDO', 'Falló la calibración automática. Usa “manual 4 esquinas”.');
      toast('Error calibrando automático. Usa manual 4 esquinas.', 3300);
    } finally {
      deleteAll(src);
    }
  }

  function findCalibrationSquare(src) {
    let gray = null, blur = null, mask = null, contours = null, hierarchy = null;
    let best = null;
    try {
      gray = new cv.Mat();
      blur = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);

      const thresholds = [45, 60, 75, 90, 110, 130, 155, 180];
      for (const thresholdValue of thresholds) {
        const candidate = findSquareCandidateFromThreshold(blur, thresholdValue, src.cols, src.rows);
        if (candidate && (!best || candidate.score > best.score)) best = candidate;
      }

      // Fallback con umbral adaptativo. Es útil cuando hay sombras o luz desigual.
      mask = new cv.Mat();
      contours = new cv.MatVector();
      hierarchy = new cv.Mat();
      cv.adaptiveThreshold(blur, mask, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 41, 7);
      const adaptiveCandidate = bestSquareFromMask(mask, blur, src.cols, src.rows, 'A');
      if (adaptiveCandidate && (!best || adaptiveCandidate.score > best.score)) best = adaptiveCandidate;
      return best;
    } finally {
      deleteAll(gray, blur, mask, contours, hierarchy);
    }
  }

  function findSquareCandidateFromThreshold(grayBlur, thresholdValue, width, height) {
    let mask = null;
    try {
      mask = new cv.Mat();
      cv.threshold(grayBlur, mask, thresholdValue, 255, cv.THRESH_BINARY_INV);
      return bestSquareFromMask(mask, grayBlur, width, height, thresholdValue);
    } finally {
      deleteAll(mask);
    }
  }

  function bestSquareFromMask(mask, grayBlur, width, height, thresholdLabel) {
    let work = null, contours = null, hierarchy = null, kernel3 = null, kernel5 = null;
    let best = null;
    try {
      work = new cv.Mat();
      mask.copyTo(work);
      kernel3 = cv.Mat.ones(3, 3, cv.CV_8U);
      kernel5 = cv.Mat.ones(5, 5, cv.CV_8U);
      cv.morphologyEx(work, work, cv.MORPH_OPEN, kernel3);
      cv.morphologyEx(work, work, cv.MORPH_CLOSE, kernel5);
      contours = new cv.MatVector();
      hierarchy = new cv.Mat();
      cv.findContours(work, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      const frameArea = width * height;
      const minArea = frameArea * 0.00008; // más permisivo para cuadros pequeños/lejanos
      const maxArea = frameArea * 0.30;
      const frameCenter = { x: width / 2, y: height / 2 };
      const maxDist = Math.hypot(width / 2, height / 2);

      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        try {
          const area = cv.contourArea(contour);
          if (area < minArea || area > maxArea) continue;

          const rect = cv.minAreaRect(contour);
          if (rectTouchesEdge(rect, width, height, 2)) continue;

          const rw = Math.max(rect.size.width, 1);
          const rh = Math.max(rect.size.height, 1);
          const ratio = rw > rh ? rw / rh : rh / rw;
          if (ratio > 1.45) continue;

          const rectArea = Math.max(rw * rh, 1);
          const fill = area / rectArea;
          if (fill < 0.42) continue;

          const peri = cv.arcLength(contour, true);
          const approx = new cv.Mat();
          cv.approxPolyDP(contour, approx, 0.03 * peri, true);
          const approxRows = approx.rows;
          approx.delete();
          if (approxRows < 4 || approxRows > 12) continue;

          const points = cv.RotatedRect.points(rect).map(p => ({ x: p.x, y: p.y }));
          const ordered = orderPoints(points);
          const sideTop = distance(ordered.tl, ordered.tr);
          const sideBottom = distance(ordered.bl, ordered.br);
          const sideLeft = distance(ordered.tl, ordered.bl);
          const sideRight = distance(ordered.tr, ordered.br);
          const sidePx = (sideTop + sideBottom + sideLeft + sideRight) / 4;
          if (!Number.isFinite(sidePx) || sidePx < 12) continue;

          const darkness = darknessScore(grayBlur, rect);
          if (darkness.mean > 175) continue;

          const centerDist = Math.hypot(rect.center.x - frameCenter.x, rect.center.y - frameCenter.y);
          const centerBoost = 0.75 + 0.25 * (1 - Math.min(centerDist / maxDist, 1));
          const squareScore = Math.max(0.2, 1 - Math.abs(1 - ratio));
          const darkBoost = Math.max(0.25, (220 - darkness.mean) / 220);
          const score = area * squareScore * fill * darkBoost * centerBoost;

          if (!best || score > best.score) {
            best = { rect, points, area, sidePx, score, fill, ratio, mean: darkness.mean, threshold: thresholdLabel };
          }
        } finally {
          contour.delete();
        }
      }
      return best;
    } finally {
      deleteAll(work, contours, hierarchy, kernel3, kernel5);
    }
  }

  function darknessScore(gray, rect) {
    let roi = null;
    try {
      const b = boundingRectFromRotatedRect(rect, gray.cols, gray.rows);
      roi = gray.roi(new cv.Rect(b.x, b.y, b.w, b.h));
      const mean = cv.mean(roi)[0];
      return { mean };
    } catch {
      return { mean: 255 };
    } finally {
      deleteAll(roi);
    }
  }

  function boundingRectFromRotatedRect(rect, width, height) {
    const pts = cv.RotatedRect.points(rect);
    const xs = pts.map(p => p.x);
    const ys = pts.map(p => p.y);
    const minX = Math.max(0, Math.floor(Math.min(...xs)));
    const minY = Math.max(0, Math.floor(Math.min(...ys)));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(...xs)));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(...ys)));
    return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
  }

  function calibrateManualFourCorners() {
    if (!grabFrame()) return toast('Primero inicia la cámara.');
    cancelManualCalibration(false);
    manualCalibrationPoints = [];
    setDecision('neutral', 'CALIBRACIÓN MANUAL', 'Toca las 4 esquinas del cuadro negro 5×5 cm. No toques el borde blanco.');
    toast('Toca las 4 esquinas del cuadro negro, en cualquier orden.', 3600);
    drawManualPoints();

    manualCalibrationHandler = (ev) => {
      ev.preventDefault();
      const pt = overlayPointToFrame(ev);
      if (!pt) return;
      manualCalibrationPoints.push(pt);
      drawManualPoints();
      if (manualCalibrationPoints.length >= 4) finishManualCalibration();
    };
    els.overlay.addEventListener('click', manualCalibrationHandler);
  }

  function overlayPointToFrame(ev) {
    const rect = els.overlay.getBoundingClientRect();
    const clientX = ev.clientX ?? (ev.touches && ev.touches[0] && ev.touches[0].clientX);
    const clientY = ev.clientY ?? (ev.touches && ev.touches[0] && ev.touches[0].clientY);
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
    return {
      x: (clientX - rect.left) * els.frame.width / rect.width,
      y: (clientY - rect.top) * els.frame.height / rect.height
    };
  }

  function drawManualPoints() {
    clearOverlay();
    const sx = els.overlay.clientWidth / Math.max(1, els.frame.width);
    const sy = els.overlay.clientHeight / Math.max(1, els.frame.height);
    ctx.save();
    ctx.fillStyle = '#ffd166';
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 3;
    ctx.font = '700 16px system-ui';
    ctx.fillText(`Toca esquinas: ${manualCalibrationPoints.length}/4`, 18, 30);
    manualCalibrationPoints.forEach((p, idx) => {
      const x = p.x * sx, y = p.y * sy;
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(String(idx + 1), x + 10, y - 10);
    });
    ctx.restore();
  }

  function finishManualCalibration() {
    cancelManualCalibration(false);
    if (manualCalibrationPoints.length < 4) return;
    const ordered = orderPoints(manualCalibrationPoints);
    const sideTop = distance(ordered.tl, ordered.tr);
    const sideBottom = distance(ordered.bl, ordered.br);
    const sideLeft = distance(ordered.tl, ordered.bl);
    const sideRight = distance(ordered.tr, ordered.br);
    const sidePx = (sideTop + sideBottom + sideLeft + sideRight) / 4;
    if (!Number.isFinite(sidePx) || sidePx < 10) {
      setDecision('bad', 'NO CALIBRADO', 'Los puntos quedaron demasiado cerca. Repite tocando las 4 esquinas del cuadro negro.');
      toast('Puntos inválidos. Repite la calibración manual.', 3000);
      manualCalibrationPoints = [];
      return;
    }
    pxPerMm = sidePx / cfg().squareMm;
    localStorage.setItem('patchInspectorV4.pxPerMm', String(pxPerMm));
    const polygon = [ordered.tl, ordered.tr, ordered.br, ordered.bl];
    drawPolygon(polygon, '#ffd166', 'CALIBRADO MANUAL');
    setDecision('ok', 'CALIBRADO', `Escala manual guardada: ${pxPerMm.toFixed(3)} px/mm. Lado promedio: ${sidePx.toFixed(1)} px. Retira el cuadro sin mover el celular.`);
    toast(`Calibrado manual: ${pxPerMm.toFixed(3)} px/mm. Retira el cuadro.`, 3600);
    manualCalibrationPoints = [];
    updateStatus();
    setWorkflow();
  }

  function cancelManualCalibration(clear = true) {
    if (manualCalibrationHandler) {
      els.overlay.removeEventListener('click', manualCalibrationHandler);
      manualCalibrationHandler = null;
    }
    if (clear) {
      manualCalibrationPoints = [];
      clearOverlay();
    }
  }

  function rectTouchesEdge(rect, width, height, margin) {
    const pts = cv.RotatedRect.points(rect);
    return pts.some(p => p.x < margin || p.y < margin || p.x > width - margin || p.y > height - margin);
  }

  function takeReference() {
    const res = measureCurrent(false, { requireReference: false, previewOnly: false });
    if (!res || !res.patch) return;
    if (!pxPerMm) return toast('Primero calibra con el cuadro 5×5 cm. Luego tomamos referencia.');
    if (!res.text.found) return toast('No detecté texto en la pieza referencia. Ajusta zona texto o luz.', 3200);

    reference = {
      createdAt: new Date().toISOString(),
      widthMm: res.widthMm,
      heightMm: res.heightMm,
      areaMm: res.areaMm,
      textOffsetMm: res.text.offsetMm,
      textWidthMm: res.text.widthMm,
      angleDeg: res.angleDeg,
      thumb: canvasToDataUrl(els.patch)
    };
    localStorage.setItem('patchInspectorV4.reference', JSON.stringify(reference));
    drawCanvasImage(els.refPreview, reference.thumb);
    const warn = Math.abs(reference.textOffsetMm) > cfg().tolTextAbsMm ? ' Ojo: el texto de tu referencia ya viene algo descentrado.' : '';
    setDecision('ok', 'REFERENCIA GUARDADA', `Referencia: ${fmt(reference.widthMm)} × ${fmt(reference.heightMm)} mm. Texto offset: ${fmt(reference.textOffsetMm)} mm.${warn}`);
    toast('Referencia aprobada guardada. Ahora sí, a auditar sin medir como monje copista.', 3600);
    updateStatus();
    setWorkflow();
  }

  function measureNow() {
    const res = measureCurrent(true, { requireReference: true, previewOnly: false });
    if (res) addLog(res);
  }

  function measureCurrent(draw = true, options = {}) {
    if (!cvIsReady()) { toast('OpenCV aún está cargando. Espera unos segundos.'); return null; }
    if (!grabFrame()) { toast('Primero inicia la cámara.'); return null; }
    if (!pxPerMm) {
      setDecision('bad', 'FALTA CALIBRAR', 'Coloca el cuadro 5×5 cm, calibra y retíralo sin mover el celular.');
      return null;
    }
    if (options.requireReference && !reference) {
      setDecision('bad', 'FALTA REFERENCIA', 'Coloca un parche bueno y presiona “Tomar referencia aprobada”.');
      return null;
    }

    const detected = detectPatchAndAnalyze();
    if (!detected) {
      if (!options.previewOnly) setDecision('neutral', 'ESPERANDO', 'No encuentro parche claro. Usa fondo oscuro mate y coloca la pieza completa.');
      return null;
    }

    const result = buildDecision(detected);
    if (draw) drawPolygon(detected.box, result.pass ? '#1fd18a' : '#ff4d5e', result.pass ? 'APROBADO' : 'RECHAZADO');
    updateMeasurementUI(result);
    renderLastPreview(result);
    return result;
  }

  function detectPatchAndAnalyze() {
    let src = null, gray = null, blur = null, mask = null, contours = null, hierarchy = null;
    try {
      src = cv.imread(els.frame);
      gray = new cv.Mat();
      blur = new cv.Mat();
      mask = new cv.Mat();
      contours = new cv.MatVector();
      hierarchy = new cv.Mat();
      const c = cfg();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
      cv.threshold(blur, mask, c.patchThreshold, 255, cv.THRESH_BINARY);
      const k1 = cv.Mat.ones(5, 5, cv.CV_8U);
      cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, k1);
      cv.morphologyEx(mask, mask, cv.MORPH_OPEN, k1);
      k1.delete();
      cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      const frameArea = els.frame.width * els.frame.height;
      const minArea = frameArea * (c.minPatchAreaPct / 100);
      let best = null;

      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        const area = cv.contourArea(contour);
        if (area < minArea || area > frameArea * 0.80) { contour.delete(); continue; }
        const rect = cv.minAreaRect(contour);
        if (rectTouchesEdge(rect, els.frame.width, els.frame.height, 4)) { contour.delete(); continue; }
        const rectArea = Math.max(rect.size.width * rect.size.height, 1);
        const fill = area / rectArea;
        const score = area * clamp(fill, 0.25, 1.0);
        if (!best || score > best.score) {
          if (best && best.contour) best.contour.delete();
          best = { contour, rect, area, score };
        } else {
          contour.delete();
        }
      }

      if (!best) return null;

      const warped = warpPatch(src, best.rect);
      if (!warped || !warped.mat) {
        best.contour.delete();
        return null;
      }

      const text = analyzeText(warped.mat, c);
      const angleDeg = normalizeAngle(best.rect.angle, best.rect.size.width, best.rect.size.height);
      const box = cv.RotatedRect.points(best.rect).map(p => ({ x: p.x, y: p.y }));
      const widthMm = warped.width / pxPerMm;
      const heightMm = warped.height / pxPerMm;
      const areaMm = best.area / (pxPerMm * pxPerMm);

      cv.imshow(els.patch, warped.mat);

      const result = {
        patch: true,
        widthMm,
        heightMm,
        areaMm,
        angleDeg,
        box,
        text,
        cropW: warped.width,
        cropH: warped.height,
        timestamp: new Date()
      };

      best.contour.delete();
      warped.mat.delete();
      return result;
    } catch (err) {
      console.error(err);
      return null;
    } finally {
      deleteAll(src, gray, blur, mask, contours, hierarchy);
    }
  }

  function warpPatch(src, rect) {
    const points = cv.RotatedRect.points(rect).map(p => ({ x: p.x, y: p.y }));
    const ordered = orderPoints(points);
    const widthA = distance(ordered.br, ordered.bl);
    const widthB = distance(ordered.tr, ordered.tl);
    const heightA = distance(ordered.tr, ordered.br);
    const heightB = distance(ordered.tl, ordered.bl);
    let maxWidth = Math.max(20, Math.round(Math.max(widthA, widthB)));
    let maxHeight = Math.max(20, Math.round(Math.max(heightA, heightB)));

    // Si la pieza quedó casi vertical, conserva orientación de imagen. Si quedó girada fuerte, el orden de puntos la endereza.
    const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      ordered.tl.x, ordered.tl.y,
      ordered.tr.x, ordered.tr.y,
      ordered.br.x, ordered.br.y,
      ordered.bl.x, ordered.bl.y
    ]);
    const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0,
      maxWidth - 1, 0,
      maxWidth - 1, maxHeight - 1,
      0, maxHeight - 1
    ]);
    const M = cv.getPerspectiveTransform(srcTri, dstTri);
    const dst = new cv.Mat();
    cv.warpPerspective(src, dst, M, new cv.Size(maxWidth, maxHeight), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());
    srcTri.delete(); dstTri.delete(); M.delete();
    return { mat: dst, width: maxWidth, height: maxHeight };
  }

  function orderPoints(pts) {
    const sortedByY = [...pts].sort((a, b) => a.y - b.y);
    const top = sortedByY.slice(0, 2).sort((a, b) => a.x - b.x);
    const bottom = sortedByY.slice(2).sort((a, b) => a.x - b.x);
    return { tl: top[0], tr: top[1], bl: bottom[0], br: bottom[1] };
  }

  function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function normalizeAngle(angle, w, h) {
    let a = angle;
    if (w < h) a += 90;
    if (a > 45) a -= 90;
    if (a < -45) a += 90;
    return a;
  }

  function analyzeText(crop, c) {
    let gray = null, roi = null, mask = null, contours = null, hierarchy = null;
    try {
      gray = new cv.Mat();
      cv.cvtColor(crop, gray, cv.COLOR_RGBA2GRAY);
      const startY = Math.round(crop.rows * (c.textStartPct / 100));
      const h = Math.max(8, crop.rows - startY);
      const rect = new cv.Rect(0, startY, crop.cols, h);
      roi = gray.roi(rect);
      mask = new cv.Mat();
      cv.threshold(roi, mask, c.textThreshold, 255, cv.THRESH_BINARY_INV);
      const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
      cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, kernel);
      kernel.delete();
      contours = new cv.MatVector();
      hierarchy = new cv.Mat();
      cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, totalArea = 0;
      for (let i = 0; i < contours.size(); i++) {
        const cc = contours.get(i);
        const area = cv.contourArea(cc);
        if (area < 5) { cc.delete(); continue; }
        const b = cv.boundingRect(cc);
        // Evita tomar sombras del borde inferior como texto completo.
        if (b.width > crop.cols * 0.95 && b.height < 5) { cc.delete(); continue; }
        minX = Math.min(minX, b.x);
        minY = Math.min(minY, b.y + startY);
        maxX = Math.max(maxX, b.x + b.width);
        maxY = Math.max(maxY, b.y + b.height + startY);
        totalArea += area;
        cc.delete();
      }

      if (!Number.isFinite(minX) || totalArea < 20) {
        return { found: false, offsetMm: null, widthMm: null, bbox: null, reason: 'No detecté texto oscuro en la franja inferior.' };
      }
      const textCenterX = (minX + maxX) / 2;
      const patchCenterX = crop.cols / 2;
      const offsetPx = textCenterX - patchCenterX;
      const offsetMm = offsetPx / pxPerMm;
      const widthMm = (maxX - minX) / pxPerMm;
      return {
        found: true,
        offsetMm,
        widthMm,
        bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
        areaPx: totalArea
      };
    } finally {
      deleteAll(gray, roi, mask, contours, hierarchy);
    }
  }

  function buildDecision(res) {
    const c = cfg();
    let pass = true;
    const reasons = [];
    let dwPct = null, dhPct = null, daPct = null, textDeltaMm = null;

    if (!reference) {
      pass = false;
      reasons.push('Falta tomar referencia aprobada');
    } else {
      dwPct = pctDiff(res.widthMm, reference.widthMm);
      dhPct = pctDiff(res.heightMm, reference.heightMm);
      daPct = pctDiff(res.areaMm, reference.areaMm);
      if (Math.abs(dwPct) > c.tolSizePct) { pass = false; reasons.push(`Ancho ${signed(dwPct)}% vs referencia`); }
      if (Math.abs(dhPct) > c.tolSizePct) { pass = false; reasons.push(`Alto ${signed(dhPct)}% vs referencia`); }
      if (Math.abs(daPct) > c.tolAreaPct) { pass = false; reasons.push(`Área ${signed(daPct)}% vs referencia`); }
    }

    if (Math.abs(res.angleDeg) > c.tolAngle) {
      pass = false;
      reasons.push(`Giro excesivo: ${fmt(res.angleDeg)}°`);
    }

    if (!res.text.found) {
      pass = false;
      reasons.push('No detecté texto');
    } else {
      if (reference && Number.isFinite(reference.textOffsetMm)) {
        textDeltaMm = res.text.offsetMm - reference.textOffsetMm;
        if (Math.abs(textDeltaMm) > c.tolTextRefMm) {
          pass = false;
          reasons.push(`Texto movido ${fmt(textDeltaMm)} mm contra referencia`);
        }
      }
      if (Math.abs(res.text.offsetMm) > c.tolTextAbsMm) {
        pass = false;
        reasons.push(`Texto descentrado ${fmt(res.text.offsetMm)} mm del centro`);
      }
    }

    const out = {
      ...res,
      pass,
      reason: reasons.length ? reasons.join('; ') : 'Dentro de tolerancia',
      dwPct,
      dhPct,
      daPct,
      textDeltaMm
    };
    return out;
  }

  function pctDiff(value, ref) { return ((value - ref) / ref) * 100; }
  function signed(n) { return `${n >= 0 ? '+' : ''}${n.toFixed(1)}`; }
  function fmt(n) { return Number.isFinite(n) ? Number(n).toFixed(1) : '--'; }

  function updateMeasurementUI(res) {
    setDecision(res.pass ? 'ok' : 'bad', res.pass ? 'APROBADO' : 'RECHAZADO', res.reason);
    els.mWidth.textContent = `${fmt(res.widthMm)} mm`;
    els.mHeight.textContent = `${fmt(res.heightMm)} mm`;
    els.mArea.textContent = `${fmt(res.areaMm)} mm²`;
    els.mAngle.textContent = `${fmt(res.angleDeg)}°`;
    els.mTextOffset.textContent = res.text.found ? `${fmt(res.text.offsetMm)} mm` : '--';
    els.mTextDelta.textContent = Number.isFinite(res.textDeltaMm) ? `${fmt(res.textDeltaMm)} mm` : '--';
  }

  function addLog(res) {
    const c = cfg();
    const row = {
      time: new Date().toLocaleString(),
      lot: c.lot,
      result: res.pass ? 'APROBADO' : 'RECHAZADO',
      width: fmt(res.widthMm),
      height: fmt(res.heightMm),
      area: fmt(res.areaMm),
      angle: fmt(res.angleDeg),
      textOffset: res.text.found ? fmt(res.text.offsetMm) : '',
      textDelta: Number.isFinite(res.textDeltaMm) ? fmt(res.textDeltaMm) : '',
      reason: res.reason
    };
    inspectionLog.unshift(row);
    inspectionLog = inspectionLog.slice(0, 1000);
    localStorage.setItem('patchInspectorV4.log', JSON.stringify(inspectionLog));
    renderLog();
  }

  function renderLog() {
    els.logBody.innerHTML = inspectionLog.map(r => `
      <tr>
        <td>${escapeHtml(r.time)}</td><td>${escapeHtml(r.lot)}</td><td>${escapeHtml(r.result)}</td>
        <td>${escapeHtml(r.width)}</td><td>${escapeHtml(r.height)}</td><td>${escapeHtml(r.area)}</td>
        <td>${escapeHtml(r.textOffset)}</td><td>${escapeHtml(r.textDelta)}</td><td>${escapeHtml(r.reason)}</td>
      </tr>`).join('');
    const total = inspectionLog.length;
    const ok = inspectionLog.filter(r => r.result === 'APROBADO').length;
    const bad = total - ok;
    els.okCount.textContent = ok;
    els.badCount.textContent = bad;
    els.totalCount.textContent = total;
    els.okPct.textContent = total ? `${((ok / total) * 100).toFixed(1)}%` : '--';
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[ch]));
  }

  function loop(ts) {
    if (!stream) return;
    if (autoEnabled && ts - lastAutoProcess > 450) {
      lastAutoProcess = ts;
      processAuto();
    }
    requestAnimationFrame(loop);
  }

  function processAuto() {
    const res = measureCurrent(false, { requireReference: true, previewOnly: true });
    if (!res) {
      if (autoState !== 'idle') toast('Listo para siguiente pieza.', 1200);
      autoState = 'idle';
      stableFrames = 0;
      lastSignature = null;
      els.autoStateText.textContent = 'Esperando pieza';
      clearOverlay();
      return;
    }

    drawPolygon(res.box, res.pass ? '#1fd18a' : '#ff4d5e', autoState === 'locked' ? 'RETIRA PIEZA' : 'MIDIENDO');
    const sig = signature(res);

    if (autoState === 'idle') {
      autoState = 'candidate';
      stableFrames = 1;
      lastSignature = sig;
      els.autoStateText.textContent = 'Estabilizando pieza';
      return;
    }

    if (autoState === 'candidate') {
      if (isSimilarSignature(sig, lastSignature)) stableFrames += 1;
      else stableFrames = 1;
      lastSignature = sig;
      els.autoStateText.textContent = `Estabilizando ${stableFrames}/2`;
      if (stableFrames >= 2) {
        addLog(res);
        autoState = 'locked';
        els.autoStateText.textContent = 'Registrado, retira pieza';
        toast(res.pass ? 'Pieza aprobada registrada.' : 'Pieza rechazada registrada.', 1400);
      }
      return;
    }

    if (autoState === 'locked') {
      els.autoStateText.textContent = 'Registrado, retira pieza';
    }
  }

  function signature(res) {
    const center = averagePoint(res.box);
    return {
      x: center.x,
      y: center.y,
      w: res.widthMm,
      h: res.heightMm,
      a: res.areaMm
    };
  }

  function averagePoint(points) {
    return points.reduce((acc, p) => ({ x: acc.x + p.x / points.length, y: acc.y + p.y / points.length }), { x: 0, y: 0 });
  }

  function isSimilarSignature(a, b) {
    if (!a || !b) return false;
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    const dw = Math.abs(a.w - b.w);
    const dh = Math.abs(a.h - b.h);
    return dx < 18 && dy < 18 && dw < 1.5 && dh < 1.5;
  }

  function toggleAuto() {
    if (!pxPerMm) return toast('Primero calibra con el cuadro 5×5 cm.');
    if (!reference) return toast('Primero toma una referencia aprobada.');
    autoEnabled = !autoEnabled;
    autoState = 'idle';
    stableFrames = 0;
    lastSignature = null;
    $('btnAuto').dataset.active = String(autoEnabled);
    $('btnAuto').textContent = `Auto: ${autoEnabled ? 'ON' : 'OFF'}`;
    els.autoStateText.textContent = autoEnabled ? 'Esperando pieza' : 'Inactivo';
    toast(autoEnabled ? 'Auto activo. Registrará una vez y esperará que retires la pieza.' : 'Auto apagado.');
    setWorkflow();
  }

  function exportCSV() {
    const header = ['Hora','Lote','Resultado','Ancho mm','Alto mm','Area mm2','Giro grados','Texto offset mm','Texto delta mm','Motivo'];
    const rows = inspectionLog.map(r => [r.time, r.lot, r.result, r.width, r.height, r.area, r.angle, r.textOffset, r.textDelta, r.reason]);
    const csv = [header, ...rows].map(row => row.map(csvCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `historial_inspector_parches_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function csvCell(value) {
    const s = String(value ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function clearCalibration() {
    pxPerMm = 0;
    localStorage.removeItem('patchInspectorV4.pxPerMm');
    updateStatus();
    setWorkflow();
    toast('Calibración borrada. Vuelve a medir el cuadro 5×5.');
  }

  function clearReference() {
    reference = null;
    localStorage.removeItem('patchInspectorV4.reference');
    clearPreview(els.refPreview, refCtx);
    els.refDetails.textContent = 'Sin referencia.';
    updateStatus();
    setWorkflow();
    toast('Referencia borrada. Toma una pieza aprobada nueva.');
  }

  function resetLog() {
    if (!confirm('¿Reiniciar conteo e historial?')) return;
    inspectionLog = [];
    localStorage.removeItem('patchInspectorV4.log');
    renderLog();
    toast('Conteo reiniciado. Un pequeño funeral para los datos viejos.');
  }

  function updateStatus() {
    els.scaleText.textContent = pxPerMm ? `${pxPerMm.toFixed(3)} px/mm` : 'No calibrada';
    els.refText.textContent = reference ? `${fmt(reference.widthMm)} × ${fmt(reference.heightMm)} mm` : 'No tomada';
    if (reference) {
      els.refDetails.textContent = `Ancho ${fmt(reference.widthMm)} mm · Alto ${fmt(reference.heightMm)} mm · Área ${fmt(reference.areaMm)} mm² · Texto offset ${fmt(reference.textOffsetMm)} mm`;
      if (reference.thumb) drawCanvasImage(els.refPreview, reference.thumb);
    }
  }

  function setWorkflow() {
    const hasCam = !!stream;
    const hasCal = !!pxPerMm;
    const hasRef = !!reference;
    setStep('stepCamera', hasCam, !hasCam);
    setStep('stepCal', hasCal, hasCam && !hasCal);
    setStep('stepRef', hasRef, hasCam && hasCal && !hasRef);
    setStep('stepAudit', autoEnabled, hasCam && hasCal && hasRef && !autoEnabled);
  }

  function setStep(id, done, active) {
    const el = $(id);
    el.classList.toggle('done', !!done);
    el.classList.toggle('active', !!active);
  }

  function renderLastPreview(res) {
    const data = canvasToDataUrl(els.patch);
    drawCanvasImage(els.lastPreview, data);
    els.lastDetails.textContent = `Ancho ${fmt(res.widthMm)} mm · Alto ${fmt(res.heightMm)} mm · Texto ${res.text.found ? fmt(res.text.offsetMm) + ' mm' : 'no detectado'} · ${res.pass ? 'APROBADO' : 'RECHAZADO'}`;
  }

  function canvasToDataUrl(canvas) {
    try { return canvas.toDataURL('image/jpeg', 0.86); }
    catch { return ''; }
  }

  function drawCanvasImage(canvas, dataUrl) {
    if (!dataUrl) return;
    const img = new Image();
    img.onload = () => {
      const ctx2 = canvas.getContext('2d');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx2.clearRect(0, 0, canvas.width, canvas.height);
      ctx2.drawImage(img, 0, 0);
    };
    img.src = dataUrl;
  }

  function clearPreview(canvas, ctx2) {
    canvas.width = 320;
    canvas.height = 180;
    ctx2.clearRect(0, 0, canvas.width, canvas.height);
  }

  function deleteAll(...items) {
    for (const item of items) {
      if (item && typeof item.delete === 'function') {
        try { item.delete(); } catch { /* no-op */ }
      }
    }
  }

  $('btnStart').addEventListener('click', startCamera);
  $('btnCalibrate').addEventListener('click', calibrateWithSquare);
  $('btnCalibrateManual').addEventListener('click', calibrateManualFourCorners);
  $('btnReference').addEventListener('click', takeReference);
  $('btnMeasure').addEventListener('click', measureNow);
  $('btnAuto').addEventListener('click', toggleAuto);
  $('btnExport').addEventListener('click', exportCSV);
  $('btnReset').addEventListener('click', resetLog);
  $('btnClearCalibration').addEventListener('click', clearCalibration);
  $('btnClearReference').addEventListener('click', clearReference);

  renderLog();
  updateStatus();
  setWorkflow();
  clearPreview(els.refPreview, refCtx);
  clearPreview(els.lastPreview, lastCtx);
  if (reference && reference.thumb) drawCanvasImage(els.refPreview, reference.thumb);
})();
