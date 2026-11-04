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
| 2 · Modelo del edificio | `index.html` → *Encajar* | Opcional: sube el **IFC** (o GLB, OBJ, FBX) del edificio completo. Se encaja solo por altura y luego lo mueves, giras y escalas, y ajustas la altura de piso y del primer piso hasta que cada volumen de la sala quede sobre su apartamento. Las unidades se ven translúcidas encima del modelo (o solo al tocarlas). |
| 2b · Apartamentos del IFC | `index.html` → *Encajar* | Si el IFC trae espacios (IfcSpace / rooms de Revit), **los apartamentos se detectan solos** y se conectan con las unidades de la sala: por zona IfcZone, por el parámetro *Departamento/Apartamento* del room, por el código en el nombre (`302-01`, `Apto 302 · Sala`) o, sin nada de eso, por la posición de cada room en los polígonos de la planta de la sala (prueba las 8 orientaciones). Cada unidad toma la forma de sus rooms sobre el modelo, con el color de su estado en vivo, y al entrar se recorre **el apto recortado del IFC** con un espacio por room. La lista del panel deja corregir a mano qué apto del IFC es qué unidad. |
| 3 · Modelo por tipología | `index.html` → *Configurar recorrido* | Cada planta de la sala es una tipología: modelo de referencia, generado desde la planta o **tu modelo** (IFC, GLB, OBJ, FBX). Con tu modelo el asistente pregunta: ¿tamaño real (m, cm, mm, pulgadas)?, ¿a qué altura está el piso?, ¿qué espacios tiene? y, para cada uno, dónde se para el comprador y hacia dónde mira. Con IfcSpace los espacios salen solos. |
| 4 · Preguntas, agenda y CRM | `index.html` | Preguntas del chat por tipo de espacio (`Pregunta = opción / opción`), días y horas de la sala, asesor y WhatsApp. CRM: **Life City** (Firestore), **HubSpot** (Portal ID + Form ID) y **webhook** para cualquier otro (Pipedrive, Salesforce, Zoho, Sheets, Make, Zapier, n8n). Botón de cita de prueba. |
| 5 · Conecta y publica | `index.html` | Guarda el link como *Link del recorrido 3D* de la sala. Link público, iframe, o **carpeta .zip** (`app.json` + `sala.json` + `modelos/`) para subir a `apps/` cuando hay modelos subidos. |

**Comprador** (`visor.html`): edificio (con el modelo real si lo hay) → toca una unidad → ficha con precio y separación →
**Entrar al apartamento** (modelo de su tipología) → caminar por espacios, **Medir** (con "¿cabe tu mueble?"), **Pintar** con la paleta,
**Maqueta** sin techo. El **asistente (chat)** pregunta para qué busca, hace la pregunta de cada espacio que visita y recibe comentarios libres.
Desde adentro: **← 3D general**, **Renders y plantas ↗** (la sala) y **Agendar cita**. La cita envía a los CRM activos la unidad,
los espacios visitados, las respuestas, las medidas, los acabados probados y los comentarios; el comprador puede mandarla también por WhatsApp.

## Desde la sala de renders

La sala (`Inicio-bim/visor/renders/sala`) abre esta app encima de ella:

- **Render frontal → Ver el edificio en 3D**: `visor.html?sala=<link de la sala>&embed=1`.
- **Planta → apto → Entrar al apartamento en 3D**: `…&apto=302&entrar=1`. Si en *Zonas* el apto (o su planta) tiene un
  **recorrido 3D** —link de un modelo `.glb/.ifc` o modelo subido— se abre ese modelo (`&modelo=`); si es el link de una página publicada, se abre esa página.
  Sin nada, entra en automático: el apto del IFC del edificio si existe, o el de referencia.
- **Agendar cita en la sala de ventas**, además de separar: la cita va al CRM de Life City (si la sala lo tiene activo) y por WhatsApp al asesor.

Prioridad del modelo al entrar: el que manda la sala en el link → el que elegiste en el dashboard para la tipología → el que la sala le puso al apto o a su planta → el apto recortado del IFC → el de referencia.

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
| `visor.html?cfg=apps/<proyecto>/app.json` | App publicada como carpeta (con sus modelos IFC/GLB) |
| `…&apto=1203` | Abre con esa unidad elegida · `&entrar=1` entra directo al apartamento |

## Datos que recibe el CRM

Webhook: `POST` JSON con `evento: "cita_sala_ventas"`, `resumen` (texto), `cliente {nombre, celular, correo}`, `cita {fecha, hora, iso, modalidad, nota}`,
`unidad {id, piso, area, alcobas, banos, precio, estado}` y `recorrido {perfil, minutos, unidadesVistas, espacios[], respuestas[], medidas[], acabados[], notas[]}`.
HubSpot recibe `firstname`, `lastname`, `email`, `phone` y el resumen en `message`. Life City recibe el lead en `leads` con el resumen en `mensaje`.

## Modelos 3D

- `modelos/ejemplo-torre-alborada.ifc`: IFC de prueba de la demo (14 pisos, 48 aptos, rooms `302-01 · Sala-comedor`). Pégalo como link del edificio (`modelos/ejemplo-torre-alborada.ifc`) para ver la detección.
- `modelos/apto-tipo.glb`: apartamento tipo real (exportado de Unreal y optimizado, 6,6 MB) con sus vistas por espacio.
- IFC se lee en el navegador con web-ifc 0.0.77 (geometría, colores, IfcSpace y pisos). Un IFC de 30 MB tarda ~30 s en abrir: para compradores en celular publica mejor un GLB.
- Revit: para una tipología exporta solo el apartamento (vista 3D con caja de sección → IFC). Unreal, 3ds Max, SketchUp → GLB; optimiza con `gltf-transform optimize`.

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
| `js/interior.js` | Interior: modelo de referencia, modelo propio (con vistas y nivel de piso) o generado desde la planta |
| `js/modelos.js` | Carga IFC (web-ifc: geometría, IfcSpace con piso, zona y parámetros), GLB/glTF, OBJ y FBX |
| `js/aptos.js` | Detecta los apartamentos a partir de los rooms del IFC y los conecta con las unidades de la sala |
| `js/crm.js` | Envío de la cita: Life City, HubSpot, webhook y resumen para WhatsApp |

Three.js 0.160 desde jsDelivr, sin build.
