# Inspector de Parches Pro v11

Versión basada en la v9 (la que tenía mejor monitoreo en vivo) con mejoras de trabajo:

- Vinculación PC ↔ iPhone por código de 3 letras + 4 dígitos.
- Video real del iPhone en la PC mediante WebRTC.
- Overlays sobre el video en la PC: silueta, caja del parche, caja de texto, centro de parche, centro de texto, márgenes y Base a Texto.
- Control desde PC: iniciar cámara, detectar tarjeta, tomar referencia 100%, medir, activar Auto, borrar referencia, borrar calibración y reiniciar conteo.
- La referencia aprobada funciona como marco cero / 100%.
- El texto no se lee con OCR; se mide como bloque visual.
- La tarjeta 7×7 / 5×5 se usa para calibración de escala y perspectiva.

## Archivos que deben subirse a GitHub Pages

Subir estos archivos sueltos a la raíz del repositorio:

- index.html
- app.js
- styles.css
- monitor.html
- monitor.js
- plantilla_calibracion.html
- README.md

No subir el ZIP ni una carpeta contenedora.

## Uso recomendado

1. En PC abrir `monitor.html?v=11`.
2. Copiar el código generado, por ejemplo `ABC1234`.
3. En iPhone abrir `index.html?v=11` o la URL de GitHub Pages.
4. Escribir el código en el iPhone y conectar PC.
5. Iniciar cámara desde iPhone si iOS no permite iniciarla desde PC.
6. Colocar tarjeta 7×7 exterior blanco / 5×5 interior negro.
7. Detectar tarjeta.
8. Retirar tarjeta sin mover celular.
9. Colocar parche bueno y tomar referencia 100%.
10. Medir o activar Auto.

## Recomendación inicial de criterios

- Rechazar por texto no alineado: ON
- Rechazar por tamaño: OFF
- Rechazar por área/perímetro: OFF
- Mínimo aceptable: 85%

Cuando la detección sea estable, activar tamaño y área/perímetro.
