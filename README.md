# Inspector de Parches v17 - Texto Centrado

Versión enfocada en el criterio real de calidad:

1. Texto centrado lo más cercano posible al 100%.
2. Altura Base a Texto comparada contra la muestra maestra.

## Qué conserva

- Detector limpio estilo v9/v16 para encontrar el parche.
- Ficha 7×7 / 5×5 solo para escala.
- Maestro 100% para aprender zona, tamaño y Base a Texto.
- Estado NO_MEDIBLE cuando no encuentra bien parche o texto.

## Qué cambia

El score ya no trata todo igual. Ahora la decisión se calcula así:

- Centrado del texto: 70%
- Base a Texto: 30%
- Tamaño y área/perímetro: solo si se activan, como secundarios.

## Flujo

1. Iniciar cámara.
2. Colocar ficha 7×7 / 5×5.
3. Calibrar ficha.
4. Retirar ficha sin mover el celular.
5. Colocar parche bueno.
6. Guardar maestro 100%.
7. Medir piezas.

## Configuración recomendada

- Aceptación final: 85%
- Centrado texto: 90%
- Base-Texto: 85%
- Error centro 0% mm: 5
- Margen detector: 8 mm
- Zona texto inicio: 45%
- Zona texto fin: 94%
- Validar tamaño: OFF al inicio
- Validar área/perímetro: OFF al inicio

## Cómo interpretar

- Centrado texto 100% = centro del bloque de texto coincide con centro del parche.
- Base a Texto 100% = distancia del borde inferior del parche al borde inferior del texto igual a la maestra.
- NO_MEDIBLE = no se encontró bien parche o texto; no es rechazo de pieza.

## Archivos para GitHub Pages

Subir sueltos a la raíz:

- index.html
- app.js
- styles.css
- README.md

Abrir con:

https://atilionetobr.github.io/inspector-parches/?v=17
