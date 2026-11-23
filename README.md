# GPU Memory Lab

Sitio estático en español con una propuesta experimental para reducir cargas excesivas de texturas en gráficos 3D bajo presión de VRAM.

## Abrir

Abra `index.html` en un navegador. El sitio no necesita servidor, paquetes ni bibliotecas externas. La simulación corre localmente en `demo.js`.

## Páginas

- `index.html`: resumen y estado del proyecto.
- `problema.html`: diagnóstico del cuello de botella.
- `propuesta.html`: política propuesta y pseudocódigo.
- `simulador.html`: comparación ilustrativa con controles.
- `validacion.html`: plan para una prueba en motor y GPU reales.
- `revision.html`: preguntas para revisión técnica y bibliografía inicial.

## Estado

La demo es una simulación didáctica; no mide una GPU, FPS reales ni calidad visual de un juego. No se ha implementado un plugin de Unreal/Direct3D ni se han obtenido resultados experimentales. El sitio identifica esas limitaciones expresamente.

## Publicación

El contenido es estático y puede alojarse en GitHub Pages u otro hosting estático. Antes de afirmar que la propuesta funciona, hace falta implementar el planificador en un motor y publicar los datos comparativos.

