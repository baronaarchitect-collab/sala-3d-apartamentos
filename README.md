# Apps 3D de sala de ventas · Life City

Dashboard para crear la **app 3D** de un proyecto inmobiliario a partir de la
[sala de ventas con renders](https://baronaarchitect-collab.github.io/Inicio-bim/visor/renders/#implementar)
(repo `Inicio-bim`). El comprador gira el edificio, ve en colores qué unidades están disponibles,
reservadas o vendidas, y **con un clic entra al apartamento disponible** para recorrerlo, medirlo y probar acabados,
como en el recorrido de La Vista de San Eduardo.

- **Dashboard:** https://baronaarchitect-collab.github.io/sala-3d-apartamentos/
- **Demo (Torre Alborada):** https://baronaarchitect-collab.github.io/sala-3d-apartamentos/visor.html

## Flujo

| Paso | Dónde | Qué pasa |
| --- | --- | --- |
| 1 · Elige la sala | `index.html` | Demo publicado, **tus proyectos del asistente de Inicio-bim** (mismo navegador) o cualquier sala publicada por link. |
| 2 · Arma el edificio | `index.html` | Los pisos de la fachada se apilan con su planta; cada apto de la planta (el mismo polígono de la sala) es un volumen 3D a escala real (sale del área en m²). |
| 3 · Asigna los apartamentos | `index.html` | Por tipología: modelo tipo de referencia (Unreal, San Eduardo), GLB propio por link, GLB subido al navegador o **generado desde la planta** (muros, ventanas, alcobas, baño y mobiliario). |
| 4 · Conecta y comparte | `index.html` | Guarda el link como *Link del recorrido 3D* de la sala → la fachada y la ficha del apto muestran **Ver recorrido en 3D**. Link público e iframe para la web. |

**Comprador** (`visor.html`): edificio → toca una unidad (color = estado) → ficha con precio y separación →
**Entrar al apartamento** → caminar por espacios, **Medir** (con "¿cabe tu mueble?"), **Pintar** con la paleta del proyecto,
**Maqueta** sin techo, decisiones arquitectónicas → **Agendar cita** por WhatsApp con la ficha (unidad, espacios y medidas).

## Conexión con la sala de ventas

La app no copia el inventario: carga el mismo motor de la sala desde `Inicio-bim/visor/renders/`:

- `sala/showroom.js` → `SR.overlay` (cambios del dashboard de la sala), `SR.syncUnits`, `SR.money`, `SR.sepValue`.
- `sala/nube.js` + `config.js` → `SRNube.watch`: estados **en vivo** desde Firestore (`salasRenders/{sala}`), lo que marca la constructora se ve en el 3D al instante.
- Proyectos del asistente: `localStorage` `lc:renders:proyectos` / `lc:renders:p:<id>` (comparten origen en `baronaarchitect-collab.github.io`).
- Conectar escribe `recorrido.url` en el proyecto (`lc:renders:p:<id>`) o en el overlay de la sala (`sr:overlay:<sala>`). Si la sala vive en otro dominio (Netlify), el dashboard copia el link para pegarlo en *Dashboard → Proyecto → Link del recorrido 3D*.

## Links del visor

| Link | Abre |
| --- | --- |
| `visor.html` | Demo Torre Alborada |
| `visor.html?app=<key>` | App guardada en este navegador (vista previa del dashboard) |
| `visor.html?c=<config>` | App publicada: la configuración viaja en el link, funciona en cualquier equipo |
| `…&apto=1203` | Abre con esa unidad elegida · `&entrar=1` entra directo al apartamento |

## Modelos 3D

- `modelos/apto-tipo.glb`: apartamento tipo real (exportado de Unreal y optimizado, 6,6 MB) con sus vistas por espacio.
- Para cada tipología propia exporta a `.glb` (Unreal, 3ds Max, Revit, SketchUp), optimiza con `gltf-transform optimize`, súbelo a `modelos/` y pega su link en el dashboard.

## Local

```bash
python -m http.server 5180
```

Abre http://localhost:5180. En local los proyectos del asistente de Inicio-bim no aparecen (otro origen) y "Conectar" da el link para pegar a mano.

## Archivos

| Archivo | Qué es |
| --- | --- |
| `index.html`, `js/dashboard.js`, `css/dashboard.css` | Dashboard para crear, configurar, conectar y compartir la app |
| `visor.html`, `js/visor.js`, `css/visor.css` | App del comprador: edificio, unidades, interior, herramientas, ficha |
| `js/fuente.js` | Conexión con la sala (motor de Inicio-bim, overlay, Firebase, proyectos locales) y apps guardadas |
| `js/torre.js` | Edificio 3D desde pisos y plantas de la sala |
| `js/interior.js` | Interior: modelo de referencia, GLB propio o generado desde la planta |

Three.js 0.160 desde jsDelivr, sin build.
