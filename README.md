# Inspector de Parches v15 Mobile First

Versión enfocada en celular, con flujo ordenado y menos configuración visible.

## Qué cambia

La lógica queda separada en cuatro pasos:

1. **Calibrar ficha 7×7 / 5×5**
   - Busca el exterior blanco 7×7.
   - Corrige perspectiva.
   - El 5×5 se calcula por geometría, no por threshold.

2. **Capturar fondo vacío**
   - Retira la ficha.
   - No pongas parche.
   - La app guarda cómo se ve la mesa/fondo.

3. **Guardar maestro 100%**
   - Coloca una pieza buena.
   - La app detecta el parche como objeto nuevo contra el fondo.
   - Guarda silueta, tamaño, Base a Texto y zona de detección aprendida.

4. **Medir / auditar**
   - Busca solo dentro de la zona aprendida del maestro.
   - Compara contra maestro 100%.
   - Puede devolver APROBADO, RECHAZADO o NO MEDIBLE.

## Archivos

Sube estos archivos sueltos a GitHub Pages:

- index.html
- app.js
- styles.css
- README.md

No subas el ZIP ni una carpeta envolvente.

## URL recomendada

```text
https://atilionetobr.github.io/inspector-parches/?v=15
```

## Configuración inicial recomendada

- Aceptación general: 85%
- Base a Texto mínima: 85%
- Margen detección: 8 mm
- Texto desde: 45%
- Texto hasta: 94%
- Tamaño contra maestro: OFF al inicio
- Área contra maestro: OFF al inicio

## Recomendación física

- iPhone fijo.
- Fondo mate.
- Luz uniforme.
- Capturar fondo después de retirar ficha y antes de poner maestro.
- Si se mueve el celular, repetir ficha + fondo + maestro.
