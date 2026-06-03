# Inspector de Parches Móvil v12

Versión optimizada para celular/iPhone. Esta versión no incluye monitor PC: prioriza que el operador vea guías permanentes directamente en el celular.

## Flujo de uso

1. Abrir `index.html` desde GitHub Pages.
2. Presionar **Iniciar cámara**.
3. Colocar la tarjeta blanca **7×7 cm** con interior negro **5×5 cm**.
4. Presionar **Detectar tarjeta automáticamente**.
5. Retirar la tarjeta sin mover el celular.
6. Colocar una pieza aprobada.
7. Presionar **Tomar referencia 100%**.
8. Auditar con **Medir ahora** o **Auto: ON**.

## Qué mide

- Tamaño del parche: ancho × alto en cm.
- Perímetro del parche.
- Área del parche.
- Silueta exterior.
- Bloque visual del texto, sin OCR.
- Centro del texto contra la referencia.
- Ángulo del texto.
- Distancia **Base a Texto**.
- Score contra referencia 100%.

## Importante

La tarjeta de calibración solo sirve para escala/perspectiva. No rechaza piezas.

La referencia 100% define los parámetros buenos:
- tamaño,
- silueta,
- posición del texto,
- ángulo,
- Base a Texto.

## Recomendaciones físicas

- Celular fijo en soporte.
- Fondo mate y contrastante.
- Luz pareja.
- Tarjeta impresa al 100%, sin ajustar a página.
- Tarjeta blanca exterior 7×7 cm, negro interior 5×5 cm, borde blanco de 1 cm por lado.
- Recalibrar si se mueve el celular.

## Archivos para GitHub Pages

Subir a la raíz del repositorio:

- index.html
- app.js
- styles.css
- plantilla_calibracion.html
- README.md

Abrir con:

`https://TUUSUARIO.github.io/inspector-parches/?v=12`
