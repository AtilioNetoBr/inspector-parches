# Inspector de Parches - Base a Texto

Versión sin monitor y sin QR. Mantiene la lógica original de cámara, calibración por dos puntos, medición por contorno y decisión automática, pero agrega:

- Maestro 100% como marco cero.
- Medición de distancia Base a Texto.
- Porcentaje de similitud contra maestro.
- Aceptación general editable.
- Aceptación Base a Texto editable.
- Líneas visuales: contorno del parche, caja del texto y línea Base a Texto.

## Flujo recomendado

1. Iniciar cámara.
2. Calibrar escala con una referencia conocida.
3. Colocar una pieza aprobada.
4. Presionar **Guardar maestro 100%**.
5. Auditar piezas con **Medir ahora** o **Auto: ON**.

## Definición usada

Distancia Base a Texto = distancia desde el borde inferior del parche/bordado hasta el borde inferior del bloque visual del texto detectado.

El texto no se lee con OCR. Se detecta como bloque gráfico.

## Archivos para GitHub Pages

Subir estos archivos sueltos a la raíz del repositorio:

- index.html
- app.js
- styles.css
- README.md
