# Inspector de Parches Pro v2.0

Webapp para GitHub Pages enfocada en inspección rápida de parches textiles desde celular.

## Archivos

Sube estos archivos directamente a la raíz del repositorio:

- `index.html`
- `app.js`
- `styles.css`
- `plantilla_calibracion.html`
- `README.md`

No subas la carpeta completa. En GitHub debe verse el archivo `index.html` en la primera pantalla del repositorio.

## Qué hace esta versión

- Abre cámara del celular.
- Calibra escala con una referencia física, por ejemplo 50 mm.
- Detecta el contorno del parche.
- Mide ancho, alto, área y giro.
- Decide APROBADO / RECHAZADO con tolerancias.
- Modo automático con bloqueo anti-duplicado: no cuenta la misma pieza varias veces.
- Guarda maestro visual y contorno maestro.
- Compara piezas contra maestro visual cuando existe.
- Exporta historial CSV por lote.
- Incluye plantilla imprimible de calibración.

## Condiciones físicas obligatorias

Para usarlo como versión de trabajo necesitas:

1. Celular fijo en soporte.
2. Cámara lo más perpendicular posible a la mesa.
3. Fondo sólido mate, preferentemente negro.
4. Buena luz pareja, sin sombras fuertes.
5. Referencia física de 50 mm dentro del campo visual.
6. Parche completo dentro de la imagen.
7. Recalibrar si se mueve el celular.

## Publicar en GitHub Pages

1. Crea repositorio público, por ejemplo `inspector-parches`.
2. Sube los archivos directamente a la raíz.
3. Ve a `Settings > Pages`.
4. En `Build and deployment`, elige:
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/root`
5. Guarda.
6. Espera 1 a 3 minutos.
7. Abre la URL desde el celular.

## Flujo recomendado en piso

1. Fijar celular.
2. Abrir webapp.
3. Iniciar cámara.
4. Calibrar escala.
5. Colocar una pieza patrón buena.
6. Presionar `Guardar maestro visual`.
7. Activar `Auto: ON`.
8. Colocar pieza, esperar resultado y retirar.
9. Exportar CSV al final del lote.

## Nota honesta

Esta versión es de trabajo ligero en navegador. Para precisión milimétrica industrial dura, conviene montar cámara fija, luz controlada, fondo mate y validar repetibilidad con 30 mediciones de la misma pieza.
