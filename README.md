# Inspector de Parches Pro v7

Versión enfocada en operación seria:

- Calibración con cuadro negro de **5 x 5 cm** sobre tarjeta blanca.
- Opción automática y opción manual de **4 esquinas**.
- Medición métrica usando homografía: más confiable que solo px/mm.
- Reporta tamaño real **X x X cm**.
- Reporta **perímetro de la figura** en cm.
- Reporta área en cm².
- Detecta el texto en la zona inferior configurable.
- Compara el centro del texto contra el centro del parche.
- Muestra márgenes izquierdo/derecho del texto.
- Criterios activables: texto, tamaño, área, perímetro y giro.
- Monitor en PC con `monitor.html`.
- Exportación CSV.

## Archivos

Subir todos estos archivos sueltos a la raíz del repositorio de GitHub Pages:

```text
index.html
app.js
styles.css
monitor.html
monitor.js
plantilla_calibracion.html
README.md
```

## Flujo recomendado

1. Abrir la app en el celular desde GitHub Pages.
2. Presionar **Iniciar cámara**.
3. Colocar el cuadro negro 5 x 5 cm sobre la tarjeta blanca.
4. Usar **Calibrar 4 esquinas** como método principal de trabajo serio.
5. Tocar las cuatro esquinas del cuadro negro.
6. Retirar el cuadro sin mover el celular.
7. Colocar un parche aprobado.
8. Presionar **Tomar referencia aprobada**.
9. Activar únicamente el criterio **Texto centrado** al inicio.
10. Auditar.

## Recomendación inicial de criterios

- Texto centrado: ON
- Tamaño vs referencia: OFF
- Área vs referencia: OFF
- Perímetro vs referencia: OFF
- Giro: OFF
- Tolerancia texto: ±2.0 mm

Después de validar con piezas buenas y malas conocidas, activar tamaño/perímetro si hace falta.

## Monitor en PC

1. En la PC abrir:

```text
https://TU_USUARIO.github.io/inspector-parches/monitor.html?v=7
```

2. Copiar el ID que aparece.
3. En el celular pegarlo en el campo Monitor en PC.
4. Presionar **Transmitir a PC**.

## Condiciones físicas

- Celular fijo arriba de la mesa.
- No mover el celular después de calibrar.
- Fondo sólido mate.
- Buena luz sin sombras duras.
- La tarjeta 5 x 5 debe estar en el mismo plano donde irá el parche.
- El parche debe verse completo.

## Nota importante

La detección automática del 5 x 5 existe, pero para trabajo serio el método recomendado es **Calibrar 4 esquinas**. No es retroceder: es control metrológico. La app valida tamaño real con esos puntos y evita depender de iluminación caprichosa.
