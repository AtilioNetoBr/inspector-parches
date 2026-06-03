# Inspector de Parches v14 Senior - Marco 7x7 / 5x5 geométrico + Base a Texto

Versión sin monitor y sin QR.

## Mejora principal

Esta versión corrige la lógica de ingeniería:

- El threshold se usa para detectar el **exterior blanco 7x7**.
- El 5x5 **no se mide por threshold**.
- El 5x5 se proyecta por geometría exacta dentro del 7x7:
  - Exterior: 70 mm
  - Interior: 50 mm
  - Borde: 10 mm por lado
- El contraste del centro solo valida que realmente hay una zona más oscura.
- La calibración guarda también homografía imagen → milímetros para medir en el plano real, no solo px/mm.

## Flujo recomendado

1. Iniciar cámara.
2. Colocar la ficha/marco 7x7 / 5x5 en la zona de medición.
3. Presionar **Calibrar marco 7x7 / 5x5**.
4. Esperar **FICHA OK**.
5. Retirar la ficha sin mover el celular.
6. Colocar una pieza aprobada.
7. Presionar **Guardar maestro 100%**.
8. Medir piezas con **Medir ahora** o **Auto: ON**.

## Qué mide

- Ancho.
- Alto.
- Giro.
- Área.
- Distancia Base a Texto.
- % contra maestro 100%.

## Mejoras técnicas v14

- Detector de ficha por jerarquía de contornos para priorizar marco exterior.
- 5x5 dibujado por geometría exacta, no por detección de manchas.
- Validación de contraste centro/borde.
- Overlay corregido con `object-fit: contain` para que las líneas no se desplacen.
- Detección de parche priorizando máscara de objeto claro sobre fondo oscuro.
- Canny queda solo como respaldo, no como método principal.
- Medición de parche usando homografía cuando existe calibración de ficha.
- Base a Texto calculada con escala vertical real del parche enderezado.

## Archivos a subir a GitHub

Subir sueltos en la raíz del repositorio:

- index.html
- app.js
- styles.css
- README.md

Abrir con:

https://atilionetobr.github.io/inspector-parches/?v=14
