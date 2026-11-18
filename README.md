# Ranking comercial Venejugos

Sitio estático para GitHub Pages. Todos los archivos van sueltos en la raíz del repositorio.

## Archivos

- `index.html`, `styles.css`, `app.js`: la página. Tablero (ranking general, por bloque, grupos y control especial) y panel administrativo (cargas, modelo y pesos, conexión GitHub).
- `modelo.js`: reglas del ranking (pesos por facturación, Rolling en kilos, activación y otras líneas).
- `historico-core.js` y `historico-worker.js`: leen el HISTORICO (.xlsx, hoja DINAMICA) por partes, sin trabarse con archivos de 200 MB.
- `rolling.js`: lee el archivo de Rolling (hojas NESTLE y PEPSICO Y SAN DOMINGO) y detecta los subtotales de grupo.
- `github.js`: publica y trae `ranking-data.json` con la API de GitHub.
- `ranking-data.json`: datos ya procesados (histórico enero a octubre 2026 y Rolling). La página lo lee al abrir.
- `logo-venejugos.png`, `bricolage.woff2`, `hanken.woff2`: logo y tipografías del portal NEXUS, servidos desde el mismo sitio. Licencias en `OFL-bricolage.txt` y `OFL-hanken.txt`.
- `chart.umd.min.js` (Chart.js 4.4.1, licencia MIT) y `xlsx.full.min.js` (SheetJS 0.18.5, licencia Apache 2.0): librerías alojadas en el propio sitio; la página no carga nada de terceros salvo la API de GitHub al publicar.

## Diseño

Colorimetría y movimiento del portal NEXUS: fondo azul con degradado, títulos plateados, cinta azul y roja que se dibuja al abrir, superficies claras con marco plateado y rojo metálico como acento. Todos los colores están en el primer bloque de `styles.css`.

## Publicar

1. Sube todos los archivos a la raíz del repositorio.
2. En Settings, Pages, elige la rama `main` y la carpeta `/ (root)`.
3. En Panel administrativo, Conexión GitHub, guarda usuario, repositorio y un token fine-grained con permiso Contents: Read and write para ese repositorio.
4. Cada vez que cargues un histórico o un Rolling nuevo, pulsa Publicar datos ahora (o activa la publicación automática).

Si el repositorio es público, `ranking-data.json` (ventas por asesor) queda visible para cualquiera.
