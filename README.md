# Inspector de Parches Pro v4.2

Versión de trabajo para GitHub Pages. Flujo: abrir cámara, calibrar escala con cuadro negro de 5×5 cm, retirar el cuadro sin mover el celular, tomar una referencia aprobada y auditar parches por tamaño, área, giro y texto centrado.

## Archivos
Sube estos archivos sueltos a la raíz del repositorio:

- `index.html`
- `app.js`
- `styles.css`
- `plantilla_calibracion.html`
- `README.md`

## Uso recomendado

1. Abre la página publicada en GitHub Pages desde el celular.
2. Presiona **Iniciar cámara**.
3. Coloca el cuadro negro de 5×5 cm sobre la misma mesa donde irán los parches.
4. Presiona **Calibrar automático 5×5**.
5. Si no detecta el cuadro, presiona **Calibrar manual 4 esquinas** y toca las 4 esquinas del cuadro negro.
6. Retira el cuadro sin mover el celular.
7. Coloca un parche aprobado y presiona **Tomar referencia aprobada**.
8. Usa **Medir ahora** o **Auto: ON** para auditar.

## Recomendaciones físicas

- El celular debe quedar fijo, sin moverse después de calibrar.
- El cuadro negro debe estar plano, en el mismo nivel que los parches.
- Usa buena luz pareja.
- Evita sombras fuertes.
- Si el celular se mueve, borra calibración y recalibra.

## Cambios v4.2

- Detección automática del cuadro 5×5 más tolerante a luz, sombras y tamaño.
- Umbrales múltiples para detectar el cuadro negro.
- Fallback de calibración manual tocando 4 esquinas.
- Mensajes más claros cuando no se encuentra el cuadro.
