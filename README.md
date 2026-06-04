# Inspector de Parches Pro v10 iPhone Safe

Webapp para iPhone + PC orientada a inspección visual de parches/bordados.

## Qué valida

- Calibración con tarjeta física:
  - Exterior blanco: 7 × 7 cm
  - Interior negro: 5 × 5 cm
- Corrección de perspectiva con la tarjeta.
- Detección de silueta del parche.
- Medición real:
  - Tamaño X × X cm
  - Perímetro cm
  - Área cm²
  - Giro del parche
- Detección del bloque visual del texto, sin OCR.
- Alineación del texto:
  - centro horizontal
  - posición vertical
  - ángulo
- Porcentaje mínimo editable, por default 85%.
- Monitor PC en vivo por QR con video, líneas y recuadros.

## Archivos

Sube estos archivos sueltos a la raíz del repositorio de GitHub Pages:

```text
index.html
app.js
opencv-loader.js
styles.css
monitor.html
monitor.js
plantilla_calibracion.html
README.md
```

No subas el ZIP y no subas una carpeta envolvente.

## URL de app

```text
https://TUUSUARIO.github.io/inspector-parches/?v=10
```

## URL de monitor PC

```text
https://TUUSUARIO.github.io/inspector-parches/monitor.html?v=10
```

## Flujo recomendado

1. En PC abre `monitor.html`.
2. Escanea el QR con el iPhone.
3. En iPhone abre la app.
4. Presiona **Iniciar cámara**.
5. En PC debe verse el video.
6. Coloca la tarjeta blanca 7×7 con negro 5×5.
7. Presiona **Detectar tarjeta 7×7 / 5×5**.
8. Retira la tarjeta sin mover el celular.
9. Coloca un parche bueno.
10. Presiona **Tomar referencia aprobada**.
11. Activa **Auto: ON** o usa **Medir ahora**.

## Recomendación física

- iPhone fijo en soporte.
- Tarjeta y parches en el mismo plano.
- Fondo mate, sin brillos.
- Luz pareja.
- Tarjeta impresa al 100%, no ajustada a página.
- Si el celular se mueve, recalibrar.

## Si iPhone no abre cámara

1. Abrir desde GitHub Pages, no desde github.com.
2. Revisar que la URL empiece con `https://`.
3. Safari → Configuración del sitio web → Cámara → Permitir.
4. Cerrar Cámara, WhatsApp, Instagram u otra app que use cámara.
5. Usar el botón **Analizar foto** como respaldo.

## Nota técnica

Esta versión usa OpenCV.js para visión artificial y PeerJS/WebRTC para transmitir video y datos al monitor PC. Requiere internet para cargar esas librerías desde CDN.


## Cambios v10 iPhone Safe

- Se eliminó la carga directa `async` de OpenCV desde `index.html`.
- Se agregó `opencv-loader.js`, que espera a que OpenCV esté realmente inicializado antes de permitir mediciones.
- El cargador prueba varias fuentes: `./opencv.js`, OpenCV oficial 4.10.0, OpenCV oficial 4.x y jsDelivr.
- Recomendación profesional: descarga `opencv.js` y súbelo a la raíz del repositorio para no depender del CDN en Safari iPhone.
- La cámara ahora espera `loadedmetadata` antes de capturar frames.
- `localStorage` queda protegido con `try/catch` para que Safari no mate la app si bloquea almacenamiento.
- Scripts y CSS llevan `?v=10.iphone-safe` para evitar caché vieja de GitHub Pages.

## Prueba rápida en iPhone

1. Abre la URL de GitHub Pages, no `github.com`.
2. Espera a que diga **OpenCV listo**.
3. Toca **Iniciar cámara**.
4. Si OpenCV no carga con internet inestable, sube `opencv.js` local a la misma carpeta.
5. Si Safari insiste en comportarse como impresora de oficina, borra datos del sitio: Ajustes → Safari → Avanzado → Datos de sitios web → tu dominio GitHub Pages.
