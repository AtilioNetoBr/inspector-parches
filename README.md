# Inspector de Parches Pro v4.1

Webapp para auditar parches con celular desde GitHub Pages.

## Flujo de trabajo

1. Abre la página publicada en GitHub Pages.
2. Presiona **Iniciar cámara**.
3. Coloca el cuadro negro de **5 x 5 cm** sobre la mesa.
4. Presiona **Calibrar con cuadro 5×5**.
5. Cuando indique calibrado, retira el cuadro sin mover el celular.
6. Coloca un parche aprobado.
7. Presiona **Tomar referencia aprobada**.
8. Activa **Auto: ON**.
9. Coloca un parche, espera resultado, retira el parche y coloca el siguiente.

## Qué mide

- Ancho contra referencia.
- Alto contra referencia.
- Área contra referencia.
- Giro máximo permitido.
- Texto centrado contra referencia.
- Texto centrado contra centro absoluto del parche.
- Conteo de aprobados/rechazados.
- Exportación CSV.

## Recomendaciones físicas

- Celular fijo, no en mano.
- Fondo oscuro mate.
- Luz pareja y sin sombras duras.
- El cuadro de calibración debe estar en el mismo plano donde irá el parche.
- Si se mueve el celular, recalibra.
- Si cambia la altura del celular, recalibra.
- No dejes hilos, manchas o objetos dentro del campo visual.

## Archivos para GitHub Pages

Sube estos archivos sueltos a la raíz del repositorio:

- `index.html`
- `app.js`
- `styles.css`
- `plantilla_calibracion.html`
- `README.md`

No subas el ZIP ni una carpeta contenedora.

## Notas de precisión

La precisión depende más de la estación física que del código: cámara fija, buena luz y fondo controlado. Si el mismo parche medido cinco veces cambia más de 1 mm, revisa soporte, luz, calibración y contraste.


## v4.1
- Cámara con intentos automáticos: trasera alta, trasera media, cualquier cámara y frontal.
- Mensajes claros si el permiso está bloqueado, la página no está en HTTPS o la cámara está ocupada.
- Cache busting para GitHub Pages usando `?v=4.1`.
