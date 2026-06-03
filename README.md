# Inspector de Parches v11 - Ficha 7x7 / 5x5 + Base a Texto

Versión sin monitor y sin QR.

## Mejora principal

La app ya no depende únicamente de calibración manual. Ahora tiene un paso visible para calibrar con ficha:

- Exterior blanco: 7 × 7 cm
- Interior negro: 5 × 5 cm
- Borde blanco esperado: 1 cm por lado

La lógica de ficha es:

1. Buscar primero el exterior blanco 7×7.
2. Detectar sus cuatro esquinas.
3. Corregir perspectiva.
4. Validar que el negro 5×5 esté centrado.
5. Guardar escala px/mm.
6. Retirar la ficha sin mover el celular.
7. Colocar el maestro 100%.

## Flujo recomendado

1. Iniciar cámara.
2. Colocar la ficha 7×7 / 5×5 en la zona de medición.
3. Presionar **Calibrar ficha 7×7 / 5×5**.
4. Retirar la ficha sin mover el celular.
5. Colocar una pieza aprobada.
6. Presionar **Guardar maestro 100%**.
7. Medir piezas con **Medir ahora** o **Auto: ON**.

## Qué mide

- Ancho.
- Alto.
- Giro.
- Área.
- Distancia Base a Texto.
- % contra maestro 100%.

## Importante

La ficha solo calibra escala. No decide si una pieza está aprobada o rechazada.
El maestro 100% es el marco cero para aprobar/rechazar.

## Archivos a subir a GitHub

Subir sueltos en la raíz del repositorio:

- index.html
- app.js
- styles.css
- README.md

Abrir con:

https://atilionetobr.github.io/inspector-parches/?v=11
