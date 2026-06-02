# Inspector de Parches Pro v8.1

Webapp para inspección con celular publicada en GitHub Pages.

## Objetivo

- Usar una tarjeta fija de calibración: exterior blanco 7 × 7 cm e interior negro 5 × 5 cm.
- Detectar la tarjeta automáticamente con threshold de blanco, rectificar perspectiva y validar el negro central.
- Retirar la tarjeta sin mover el celular.
- Detectar la silueta del parche.
- Reportar tamaño X × X cm, perímetro, área, giro del parche.
- Detectar el bloque de texto, medir márgenes izquierdo/derecho y calcular porcentaje de alineación.
- Transmitir video y resultados a una PC mediante `monitor.html`.

## Archivos para GitHub Pages

Subir estos archivos sueltos a la raíz del repositorio:

- `index.html`
- `app.js`
- `styles.css`
- `monitor.html`
- `monitor.js`
- `plantilla_calibracion.html`
- `README.md`

## Flujo de uso

1. Abrir la página en el celular.
2. Presionar **Iniciar cámara**.
3. Colocar la tarjeta 7×7 / 5×5 en la misma zona donde irá el parche.
4. Presionar **Calibrar tarjeta 7×7 / 5×5**.
5. Retirar la tarjeta sin mover el celular.
6. Colocar una pieza buena.
7. Presionar **Tomar referencia aprobada**.
8. Dejar activo inicialmente solo: **Rechazar si texto no está alineado**.
9. Auditar con **Medir ahora** o **Auto: ON**.

## Recomendaciones de piso

- Celular fijo, no en mano.
- Fondo mate oscuro.
- Buena luz uniforme.
- Tarjeta impresa al 100% y verificada con regla.
- Recalibrar si se mueve el celular, soporte o altura.

## Monitor PC

Abrir en la PC:

`monitor.html`

Copiar el ID generado y pegarlo en el celular en la sección Monitor PC.

## Nota técnica importante

La tarjeta se usa para calibración. Si se retira, la precisión depende de que el celular quede fijo y de que el parche se mida en la misma zona. Para máxima precisión metrológica, la tarjeta debería poder entrar y salir siempre al mismo plano y posición.


## v8.1
- Cámara reforzada con más respaldos de permisos, deviceId y mensajes de error.
- Carga local segura de datos guardados para evitar bloqueo por localStorage corrupto.
- Usa `?v=8.1` al abrir GitHub Pages para evitar caché.
