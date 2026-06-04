# Inspector de Parches Pro v9

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
styles.css
monitor.html
monitor.js
plantilla_calibracion.html
README.md
```

No subas el ZIP y no subas una carpeta envolvente.

## URL de app

```text
https://TUUSUARIO.github.io/inspector-parches/?v=9
```

## URL de monitor PC

```text
https://TUUSUARIO.github.io/inspector-parches/monitor.html?v=9
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


## Fix OpenCV v17.1

OpenCV ahora se carga desde `app.js` con varios CDN de respaldo. Abre la app con `?v=17.1` para evitar caché. Si aparece `OpenCV no cargó`, toca la etiqueta roja para reintentar.
