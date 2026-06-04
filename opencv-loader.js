/* OpenCV Loader robusto para GitHub Pages + Safari iPhone
   - Intenta cargar ./opencv.js local si existe.
   - Si no existe, usa fuentes remotas con fallback.
   - No declara listo con el evento onload: espera cv.Mat + cv.imread + prueba real de Mat.
*/
(function(){
  'use strict';

  const SOURCES = [
    {label:'local ./opencv.js', src:'./opencv.js'},
    {label:'OpenCV oficial 4.10.0', src:'https://docs.opencv.org/4.10.0/opencv.js'},
    {label:'OpenCV oficial 4.x', src:'https://docs.opencv.org/4.x/opencv.js'},
    {label:'jsDelivr @techstark/opencv-js 4.10', src:'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js'}
  ];

  const state = {
    ready:false,
    loading:false,
    source:null,
    error:null,
    tried:[],
    startedAt:0,
    finishedAt:0
  };

  let promise = null;
  const listeners = new Set();

  function emit(update){
    Object.assign(state, update || {});
    listeners.forEach(fn=>{ try{ fn(getState()); }catch(e){ console.warn(e); } });
  }

  function getState(){ return {...state, tried:[...state.tried]}; }

  function isReady(){
    if(!window.cv || typeof window.cv.Mat !== 'function' || typeof window.cv.imread !== 'function') return false;
    try{
      const m = new window.cv.Mat(1, 1, window.cv.CV_8UC1);
      m.delete();
      return true;
    }catch(e){
      return false;
    }
  }

  function waitForRuntime(label, timeoutMs){
    return new Promise((resolve, reject)=>{
      const start = Date.now();
      let settled = false;
      let interval = null;
      let timeout = null;

      function done(ok, value){
        if(settled) return;
        settled = true;
        clearInterval(interval);
        clearTimeout(timeout);
        ok ? resolve(value) : reject(value);
      }

      function tryReady(){
        if(isReady()) return done(true, window.cv);
        const elapsed = Math.round((Date.now() - start) / 1000);
        emit({message:`Inicializando OpenCV (${label})… ${elapsed}s`});

        if(window.cv && typeof window.cv.then === 'function'){
          window.cv.then(()=>{ if(isReady()) done(true, window.cv); }).catch(err=>done(false, err));
        }
        if(window.cv && !window.cv.__mardurRuntimeHooked){
          try{
            const previous = window.cv.onRuntimeInitialized;
            window.cv.onRuntimeInitialized = function(){
              try{ if(typeof previous === 'function') previous(); }catch(e){ console.warn(e); }
              if(isReady()) done(true, window.cv);
            };
            window.cv.__mardurRuntimeHooked = true;
          }catch(e){}
        }
      }

      tryReady();
      interval = setInterval(tryReady, 300);
      timeout = setTimeout(()=>done(false, new Error(`Timeout inicializando ${label}`)), timeoutMs);
    });
  }

  function loadScript(entry){
    return new Promise((resolve, reject)=>{
      emit({message:`Cargando ${entry.label}…`, source:entry.label});

      // Limpiar restos de intentos anteriores que no quedaron listos.
      if(!isReady()){
        try{ delete window.cv; }catch(e){ window.cv = undefined; }
      }

      const previousModule = window.Module && typeof window.Module === 'object' ? window.Module : {};
      window.Module = Object.assign({}, previousModule, {
        onRuntimeInitialized(){
          try{ if(typeof previousModule.onRuntimeInitialized === 'function') previousModule.onRuntimeInitialized(); }catch(e){ console.warn(e); }
          if(isReady()) resolve(window.cv);
        }
      });

      const script = document.createElement('script');
      script.async = true;
      script.defer = true;
      script.src = entry.src;
      script.dataset.opencvLoader = 'mardur-v10';

      let settled = false;
      function finish(ok, val){
        if(settled) return;
        settled = true;
        ok ? resolve(val) : reject(val);
      }

      script.onload = async () => {
        try{
          const cvObj = await waitForRuntime(entry.label, 45000);
          finish(true, cvObj);
        }catch(err){ finish(false, err); }
      };
      script.onerror = () => finish(false, new Error(`No se pudo descargar ${entry.src}`));
      document.head.appendChild(script);
    });
  }

  async function load(onUpdate){
    if(typeof onUpdate === 'function') listeners.add(onUpdate);
    if(isReady()){
      emit({ready:true, loading:false, error:null, finishedAt:Date.now(), message:'OpenCV listo'});
      return window.cv;
    }
    if(promise) return promise;

    state.startedAt = Date.now();
    state.loading = true;
    state.error = null;
    emit({message:'Preparando motor de visión…'});

    promise = (async()=>{
      let lastError = null;
      for(const entry of SOURCES){
        state.tried.push(entry.label);
        try{
          const cvObj = await loadScript(entry);
          emit({ready:true, loading:false, source:entry.label, error:null, finishedAt:Date.now(), message:`OpenCV listo desde ${entry.label}`});
          return cvObj;
        }catch(err){
          lastError = err;
          console.warn('[OpenCVLoader]', entry.label, err);
          emit({ready:false, loading:true, error:String(err && err.message ? err.message : err), message:`Falló ${entry.label}; probando respaldo…`});
        }
      }
      emit({ready:false, loading:false, error:String(lastError && lastError.message ? lastError.message : lastError), finishedAt:Date.now(), message:'OpenCV no cargó'});
      throw lastError || new Error('OpenCV no cargó');
    })();

    return promise;
  }

  window.OpenCVLoader = {load, isReady, getState, SOURCES};
})();
