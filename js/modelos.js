/*!
 * Carga de modelos 3D para el edificio completo y para cada tipología:
 *   IFC (web-ifc, con espacios IfcSpace y pisos IfcBuildingStorey) · GLB/glTF · OBJ · FBX
 * cargarModelo({url | blob, nombre}) → {scene, formato, espacios:[{nombre, box}], pisos:[{nombre, y}]}
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const WEBIFC = 'https://cdn.jsdelivr.net/npm/web-ifc@0.0.77/';
export const FORMATOS = '.ifc,.glb,.gltf,.obj,.fbx';

export function formatoDe(nombre) {
  const m = /\.(ifc|glb|gltf|obj|fbx)(\?|#|$)/i.exec(String(nombre || ''));
  return m ? m[1].toLowerCase() : 'glb';
}

let api = null, W = null;
async function ifcApi() {
  if (!api) {
    W = await import(WEBIFC + 'web-ifc-api.js');
    api = new W.IfcAPI();
    api.SetWasmPath(WEBIFC, true);
    await api.Init();
  }
  return api;
}

async function bytes(src) {
  if (src.blob) return new Uint8Array(await src.blob.arrayBuffer());
  const r = await fetch(src.url); if (!r.ok) throw new Error('No se pudo descargar el modelo (' + r.status + ')');
  return new Uint8Array(await r.arrayBuffer());
}

async function cargarIFC(src) {
  const A = await ifcApi();
  const id = A.OpenModel(await bytes(src), { COORDINATE_TO_ORIGIN: true });
  const ids = v => { const out = []; for (let i = 0; i < v.size(); i++) out.push(v.get(i)); return out; };
  const espaciosId = new Set(ids(A.GetLineIDsWithType(id, W.IFCSPACE)));
  const group = new THREE.Group(); group.name = 'IFC';
  const mats = {}, cajas = {};
  const m4 = new THREE.Matrix4();
  const leer = mesh => {
    const pgs = mesh.geometries, esEspacio = espaciosId.has(mesh.expressID);
    for (let i = 0; i < pgs.size(); i++) {
      const pg = pgs.get(i), g = A.GetGeometry(id, pg.geometryExpressID);
      const v = A.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize()).slice();
      const ix = A.GetIndexArray(g.GetIndexData(), g.GetIndexDataSize()).slice();
      g.delete();
      if (!ix.length) continue;
      const geo = new THREE.BufferGeometry(), ib = new THREE.InterleavedBuffer(v, 6);
      geo.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, 0));
      geo.setAttribute('normal', new THREE.InterleavedBufferAttribute(ib, 3, 3));
      geo.setIndex(new THREE.BufferAttribute(ix, 1));
      geo.applyMatrix4(m4.fromArray(pg.flatTransformation));
      if (esEspacio) {
        geo.computeBoundingBox();
        (cajas[mesh.expressID] = cajas[mesh.expressID] || new THREE.Box3()).union(geo.boundingBox);
        geo.dispose(); continue;
      }
      const c = pg.color, k = [c.x, c.y, c.z, c.w].map(n => n.toFixed(2)).join();
      const mat = mats[k] || (mats[k] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(c.x, c.y, c.z), roughness: 0.75, metalness: 0,
        transparent: c.w < 0.99, opacity: c.w, side: THREE.DoubleSide, depthWrite: c.w >= 0.99
      }));
      const me = new THREE.Mesh(geo, mat); me.userData.expressID = mesh.expressID;
      group.add(me);
    }
  };
  A.StreamAllMeshes(id, leer);
  // web-ifc deja los IfcSpace por fuera de StreamAllMeshes: se piden aparte (solo para sus cajas)
  if (espaciosId.size) { try { A.StreamAllMeshesWithTypes(id, [W.IFCSPACE], leer); } catch (e) { console.warn('IfcSpace:', e); } }
  const txt = x => (x && x.value != null ? String(x.value) : '');
  const linea = n => { try { return A.GetLine(id, n); } catch (e) { return null; } };
  const ref = v => (v && typeof v === 'object' ? (v.value != null ? v.value : v.expressID) : v);
  const lista = v => (Array.isArray(v) ? v : v ? [v] : []);
  const todos = T => { try { return ids(A.GetLineIDsWithType(id, T)); } catch (e) { return []; } };
  // pisos y en qué piso está cada espacio (IfcRelAggregates / IfcRelContainedInSpatialStructure)
  const pisos = [], pisoNombre = {}, espacioPiso = {};
  todos(W.IFCBUILDINGSTOREY).forEach(sid => { const L = linea(sid); if (!L) return; pisoNombre[sid] = txt(L.LongName) || txt(L.Name); pisos.push({ id: sid, nombre: pisoNombre[sid], elev: +txt(L.Elevation) || 0 }); });
  [W.IFCRELAGGREGATES, W.IFCRELCONTAINEDINSPATIALSTRUCTURE].forEach(T => todos(T).forEach(r => {
    const L = linea(r); if (!L) return;
    const padre = ref(L.RelatingObject || L.RelatingStructure); if (!(padre in pisoNombre)) return;
    lista(L.RelatedObjects || L.RelatedElements).forEach(o => { const k = ref(o); if (espaciosId.has(k)) espacioPiso[k] = padre; });
  }));
  // zonas que agrupan espacios (IfcZone vía IfcRelAssignsToGroup)
  const zona = {};
  todos(W.IFCRELASSIGNSTOGROUP).forEach(r => {
    const L = linea(r); if (!L) return;
    const gid = ref(L.RelatingGroup); let tipo; try { tipo = A.GetLineType(id, gid); } catch (e) {}
    if (tipo !== W.IFCZONE) return;
    const G = linea(gid), nom = G ? (txt(G.Name) || txt(G.LongName)) : '';
    lista(L.RelatedObjects).forEach(o => { const k = ref(o); if (espaciosId.has(k) && nom) zona[k] = nom; });
  });
  // parámetros del espacio que dicen a qué apartamento pertenece (Revit: Departamento del room)
  const prop = {}, RE_P = /apart|unidad|^unit|apto|depto|dpto|department|departamento|vivienda|inmueble|dwelling/i;
  todos(W.IFCRELDEFINESBYPROPERTIES).forEach(r => {
    const L = linea(r); if (!L) return;
    const objs = lista(L.RelatedObjects).map(ref).filter(k => espaciosId.has(k)); if (!objs.length) return;
    const ps = linea(ref(L.RelatingPropertyDefinition)); if (!ps || !ps.HasProperties) return;
    lista(ps.HasProperties).forEach(pr => {
      const P = linea(ref(pr)); if (!P || !P.Name || !RE_P.test(txt(P.Name))) return;
      const v = P.NominalValue && P.NominalValue.value != null ? String(P.NominalValue.value).trim() : '';
      if (v) objs.forEach(k => { if (!prop[k]) prop[k] = v; });
    });
  });
  const espacios = Object.entries(cajas).map(([sid, box]) => {
    const L = linea(+sid) || {}, k = +sid;
    const largo = txt(L.LongName), corto = txt(L.Name);
    return { id: k, nombre: largo || corto || 'Espacio ' + sid, numero: largo ? corto : '', piso: pisoNombre[espacioPiso[k]] || '', pisoId: espacioPiso[k], zona: zona[k] || '', prop: prop[k] || '', box };
  });
  A.CloseModel(id);
  return { scene: group, formato: 'ifc', espacios, pisos };
}

export async function cargarModelo(src) {
  const formato = formatoDe(src.nombre || src.url);
  if (formato === 'ifc') return cargarIFC(src);
  const url = src.blob ? URL.createObjectURL(src.blob) : src.url;
  try {
    if (formato === 'obj') {
      const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
      return { scene: await new OBJLoader().loadAsync(url), formato, espacios: [], pisos: [] };
    }
    if (formato === 'fbx') {
      const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
      return { scene: await new FBXLoader().loadAsync(url), formato, espacios: [], pisos: [] };
    }
    const g = await new GLTFLoader().loadAsync(url);
    return { scene: g.scene, formato, espacios: [], pisos: [] };
  } finally { if (src.blob) setTimeout(() => URL.revokeObjectURL(url), 4000); }
}

/* limpia materiales exportados (normal maps sin textura dan ruido) y sombras */
export function limpiar(scene) {
  scene.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = false; o.receiveShadow = false;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
      if (m && m.normalMap && !m.map) { m.normalMap = null; m.needsUpdate = true; }
    });
  });
  return scene;
}

/* unidades del modelo: si la caja mide cientos o miles, viene en cm o mm */
export function escalaSugerida(scene, altoEsperado) {
  const s = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
  const max = Math.max(s.x, s.y, s.z);
  if (altoEsperado) return s.y > 0 ? altoEsperado / s.y : 1;
  if (max > 2000) return 0.001;
  if (max > 200) return 0.01;
  return 1;
}
