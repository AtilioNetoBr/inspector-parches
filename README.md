# Inspector de Parches Pro v6

Versión orientada a trabajo real: separa claramente la calibración de escala 5×5 de los criterios de rechazo. Por defecto, la decisión se basa en texto centrado, no en tamaño.

## Flujo recomendado

1. Abre `index.html` desde GitHub Pages en el celular.
2. Presiona **Iniciar cámara**.
3. Coloca el cuadro negro de 5×5 cm sobre la tarjeta blanca.
4. Presiona **Calibrar auto 5×5**.
5. Si no detecta estable, usa **Calibrar manual 4 esquinas**.
6. Retira el cuadro sin mover el celular.
7. Coloca un parche aprobado.
8. Presiona **Tomar referencia aprobada**.
9. Activa **Auto: ON**.
10. Coloca un parche, espera resultado, retira el parche y continúa.

## Criterios de rechazo

Por defecto solo está activo:

- Rechazar si el texto no está centrado.

Opcionales:

- Rechazar por medida contra referencia.
- Rechazar por área/forma contra referencia.
- Rechazar por giro excesivo.

La escala 5×5 solo sirve para convertir pixeles a milímetros. No debe forzar por sí sola un rechazo.

## Monitor en PC

1. Abre `monitor.html` en la PC.
2. Copia el ID que aparece.
3. En el celular, pega ese ID en la sección **Monitor en PC**.
4. Presiona **Transmitir a PC**.

Notas:

- Esta función usa PeerJS público para conectar celular y PC. Requiere internet.
- Para producción cerrada, conviene montar un servidor local propio de señalización/WebRTC.

## Estación física recomendada

- Celular fijo arriba de la mesa.
- Fondo negro mate.
- Luz pareja y fija.
- Cuadro de calibración sobre el mismo plano que el parche.
- Recalibrar si el celular o la mesa se mueven.

## Archivos

Subir a la raíz del repositorio:

- `index.html`
- `app.js`
- `styles.css`
- `monitor.html`
- `monitor.js`
- `plantilla_calibracion.html`
- `README.md`
