# Inspector de Parches Pro v5

Webapp para auditar parches con celular desde GitHub Pages.

## Flujo correcto

1. Abre la página desde GitHub Pages en HTTPS.
2. Presiona **Iniciar cámara**.
3. Coloca el cuadro negro de 5 x 5 cm sobre tarjeta blanca.
4. Presiona **Calibrar auto 5×5**.
5. Si falla, usa **Calibrar manual 4 esquinas** y toca las 4 esquinas del cuadro negro.
6. Retira el cuadro sin mover celular, soporte ni zoom.
7. Coloca un parche aprobado.
8. Presiona **Tomar referencia aprobada**.
9. Activa **Auto: ON** para auditar.

## Condiciones físicas obligatorias

- Celular fijo, no en mano.
- Fondo mate y contrastante.
- Luz pareja, sin sombras fuertes.
- El cuadro y el parche deben ir sobre la misma superficie y altura.
- Si se mueve el celular después de calibrar, hay que recalibrar.

## Qué mide

- Ancho contra referencia aprobada.
- Alto contra referencia aprobada.
- Área contra referencia aprobada.
- Offset horizontal del texto respecto al centro del parche.
- Conteo de aprobados/rechazados.
- Historial exportable a CSV.

## Archivos para GitHub

Subir sueltos en la raíz del repositorio:

- index.html
- app.js
- styles.css
- plantilla_calibracion.html
- README.md
