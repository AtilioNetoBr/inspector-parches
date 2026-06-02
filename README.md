# Inspector de Parches Pro v10

Versión con vinculación PC mediante código de 3 letras + 4 dígitos. El iPhone captura y analiza; la PC monitorea, muestra líneas/recuadros y puede manipular parámetros.

## Archivos para GitHub Pages
Subir a la raíz del repositorio:

- index.html
- app.js
- styles.css
- monitor.html
- monitor.js
- plantilla_calibracion.html
- README.md

## Flujo

1. Abrir `monitor.html` en PC.
2. Copiar el código generado, ejemplo `ABC1234`.
3. Abrir `index.html` en iPhone desde GitHub Pages.
4. Escribir el código y conectar.
5. Iniciar cámara en iPhone.
6. Detectar tarjeta 7×7 exterior blanco / 5×5 interior negro.
7. Retirar tarjeta sin mover el celular.
8. Colocar parche bueno y tomar referencia 100%.
9. Auditar. La PC muestra video, diagnóstico y resultados.

## Conceptos

- La tarjeta 7×7 / 5×5 solo calibra escala y perspectiva.
- La referencia 100% define el patrón maestro.
- El texto no se lee con OCR: se mide como bloque gráfico.
- Base a Texto = distancia entre la base inferior del bordado/gráfico y el borde superior del bloque de texto.

## Recomendación inicial

- Texto alineado: ON
- Tamaño: OFF
- Área/perímetro: OFF
- Mínimo aceptable: 85%
- Error horizontal máx.: 3 mm
- Error vertical máx.: 3 mm
- Error Base a Texto máx.: 2.5 mm
- Ángulo texto máx.: 5°
