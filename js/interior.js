/*!
 * Interior del apartamento. Tres fuentes por tipología (planta) de la sala:
 *   referencia → apartamento tipo real exportado de Unreal (La Vista de San Eduardo) con sus vistas por espacio
 *   url / archivo → GLB propio de la tipología (link publicado o subido al navegador desde el dashboard)
 *   planta     → se genera desde el polígono del apto en la planta: muros, ventanas, alcobas, baño y mobiliario
 * Devuelve {group, vistas:{id:{n, eye, look}}, cuartos:{id:[x0,x1,z0,z1]}, piso, techo}
 */
import * as THREE from 'three';
import { cargarModelo, limpiar, escalaSugerida } from './modelos.js';
import { aMundo } from './torre.js';

export const REFERENCIA = {
  url: 'modelos/apto-tipo.glb',
  nombre: 'Apartamento tipo (modelo de referencia)',
  vistas: {
    sala: { n: 'Sala-comedor', eye: [-4.6, 1.6, 0.1], look: [-8.6, 1.3, -3.4] },
    balcon: { n: 'Balcón', eye: [-8.4, 1.6, -3.6], look: [-8.6, 1.2, 0.4] },
    cocina: { n: 'Cocina', eye: [-2.75, 1.6, 1.0], look: [-2.75, 1.15, -2.6] },
    hab2: { n: 'Habitación 2', eye: [-5.6, 1.6, 1.2], look: [-8.9, 1.2, 2.3] },
    principal: { n: 'Habitación principal', eye: [-5.2, 1.6, 7.0], look: [-7.4, 1.0, 10.6] },
    vestier: { n: 'Vestier', eye: [-2.4, 1.6, 8.2], look: [-3.4, 1.2, 10.6] }
  },
  cuartos: { sala: [-7.7, -4.15, -3.94, 0.41], balcon: [-9.2, -7.7, -3.94, 0.41], cocina: [-4.15, -1.3, -2.9, 3.4], hab2: [-8.9, -5.3, 0.41, 3.2], bano: [-4.0, -2.6, 3.5, 7.7], bano2: [-8.4, -5.8, 3.2, 4.8], principal: [-8.5, -4.2, 6.4, 10.8], vestier: [-4.15, -1.7, 7.8, 10.8] },
  nombres: { bano: 'Baño', bano2: 'Baño social' }
};

const cache = {};
function cargarCache(src) {
  const k = src.blob ? null : src.url;
  if (!k) return cargarModelo(src);
  if (!cache[k]) cache[k] = cargarModelo(src);
  return cache[k].then(r => Object.assign({}, r, { scene: r.scene.clone(true) }));
}

/* modelo: {tipo:'referencia'|'planta'|'url'|'archivo', url, nombre, escala, vistas, cuartos}
   ctx: {apto, esc, unidad, paleta, blob, base} */
export async function cargarInterior(modelo, ctx) {
  const tipo = (modelo && modelo.tipo) || 'referencia';
  if (tipo === 'planta') return generarDesdePlanta(ctx);
  if (tipo === 'referencia') {
    const r = await cargarCache({ url: new URL(REFERENCIA.url, location.href).href, nombre: 'apto.glb' });
    return envolver(r, 1, REFERENCIA.vistas, REFERENCIA.cuartos, REFERENCIA.nombres, REFERENCIA.nombre);
  }
  let src;
  if (tipo === 'archivo') {
    if (!ctx.blob) throw new Error('El modelo subido no está en este navegador.');
    src = { blob: ctx.blob, nombre: modelo.nombre || 'modelo.glb' };
  } else {
    if (!modelo.url) throw new Error('La tipología no tiene modelo 3D.');
    src = { url: new URL(modelo.url, ctx.base || location.href).href, nombre: modelo.nombre || modelo.url };
  }
  const r = await cargarCache(src);
  const esc = +modelo.escala || escalaSugerida(r.scene);
  const I = envolver(r, esc, modelo.vistas, modelo.cuartos, modelo.nombres, modelo.nombre ? 'Modelo ' + modelo.nombre : 'Modelo 3D de la tipología');
  I.piso = modelo.piso != null ? +modelo.piso : detectarPiso(I.group, I.box);
  if (!modelo.vistas && !(r.espacios || []).length) Object.values(I.vistas).forEach(v => { v.eye[1] = I.piso + 1.6; v.look[1] = I.piso + 1.3; });
  return I;
}

/* nivel del piso habitable: la superficie horizontal más baja que cubre buena parte de la planta
   (así no se toma una zapata o un foso como piso) */
export function detectarPiso(group, box) {
  const rc = new THREE.Raycaster(), s = box.getSize(new THREE.Vector3()), n = 9, cuenta = {};
  let rayos = 0;
  for (let i = 1; i < n; i++) for (let j = 1; j < n; j++) {
    const x = box.min.x + s.x * i / n, z = box.min.z + s.z * j / n;
    rc.set(new THREE.Vector3(x, box.max.y + 1, z), new THREE.Vector3(0, -1, 0));
    const hits = rc.intersectObject(group, true); if (!hits.length) continue;
    rayos++;
    const vistos = new Set();
    hits.forEach(h => {
      const nm = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : null;
      if (!nm || Math.abs(nm.y) < 0.8) return;
      const k = Math.round(h.point.y * 10) / 10; if (vistos.has(k)) return; vistos.add(k);
      cuenta[k] = (cuenta[k] || 0) + 1;
    });
  }
  const niveles = Object.keys(cuenta).map(Number).sort((a, b) => a - b);
  const bueno = niveles.find(y => cuenta[y] >= rayos * 0.3 && y < box.min.y + s.y * 0.6);
  return bueno != null ? bueno : box.min.y;
}

/* vistas automáticas: una por espacio del IFC, o centro y extremos del modelo */
export function vistasAuto(r, esc, box) {
  const vistas = {}, cuartos = {}, nombres = {};
  const piso = box.min.y;
  (r.espacios || []).forEach((e, i) => {
    const b = e.box.clone(); b.min.multiplyScalar(esc); b.max.multiplyScalar(esc);
    const c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
    if (s.x < 0.8 || s.z < 0.8) return;
    const id = 'e' + i, lx = s.x >= s.z;
    vistas[id] = { n: e.nombre, eye: [c.x, b.min.y + 1.6, c.z], look: lx ? [b.max.x, b.min.y + 1.2, c.z] : [c.x, b.min.y + 1.2, b.max.z] };
    cuartos[id] = [b.min.x, b.max.x, b.min.z, b.max.z]; nombres[id] = e.nombre;
  });
  if (!Object.keys(vistas).length) {
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3()), y = piso + 1.6, lx = s.x >= s.z;
    vistas.centro = { n: 'Centro', eye: [c.x, y, c.z], look: lx ? [box.max.x, y - 0.3, c.z] : [c.x, y - 0.3, box.max.z] };
    vistas.a = { n: 'Extremo A', eye: lx ? [box.min.x + s.x * 0.2, y, c.z] : [c.x, y, box.min.z + s.z * 0.2], look: [c.x, y - 0.3, c.z] };
    vistas.b = { n: 'Extremo B', eye: lx ? [box.max.x - s.x * 0.2, y, c.z] : [c.x, y, box.max.z - s.z * 0.2], look: [c.x, y - 0.3, c.z] };
  }
  return { vistas, cuartos, nombres };
}

function envolver(r, esc, vistas, cuartos, nombres, etiqueta) {
  const g = new THREE.Group(), cont = new THREE.Group();
  limpiar(r.scene); cont.add(r.scene); cont.scale.setScalar(esc); g.add(cont);
  g.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g);
  if (!vistas || !Object.keys(vistas).length) ({ vistas, cuartos, nombres } = vistasAuto(r, esc, box));
  return { group: g, vistas, cuartos: cuartos || {}, nombres: nombres || {}, piso: box.min.y, techo: box.max.y, etiqueta, box, espacios: r.espacios || [] };
}

/* ---------------- generado desde la planta ---------------- */
const ALTO = 2.5;
function enPoly(x, z, pts) {
  let d = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) d = !d;
  }
  return d;
}
function color(paleta, re, def) { const p = (paleta || []).find(c => re.test(c.nombre || '')); return p ? p.hex : def; }

function generarDesdePlanta(ctx) {
  const { apto, esc, unidad, paleta } = ctx;
  const raw = apto.poly.map(p => aMundo(p, esc));
  const cx = raw.reduce((s, p) => s + p[0], 0) / raw.length, cz = raw.reduce((s, p) => s + p[1], 0) / raw.length;
  const pts = raw.map(([x, z]) => [x - cx, z - cz]);
  const g = new THREE.Group();
  const M = {
    muro: new THREE.MeshStandardMaterial({ color: color(paleta, /muro|pared/i, '#efe7da'), roughness: 0.9 }),
    piso: new THREE.MeshStandardMaterial({ color: color(paleta, /piso|madera/i, '#a77c55'), roughness: 0.7 }),
    bano: new THREE.MeshStandardMaterial({ color: color(paleta, /cer[aá]mica|ba[ñn]o/i, '#cfc3ad'), roughness: 0.5 }),
    mueble: new THREE.MeshStandardMaterial({ color: color(paleta, /carpinter|mueble/i, '#2f2924'), roughness: 0.6 }),
    acento: new THREE.MeshStandardMaterial({ color: color(paleta, /acento|verde/i, '#56844a'), roughness: 0.8 }),
    blanco: new THREE.MeshStandardMaterial({ color: '#f7f4ef', roughness: 0.4 }),
    techo: new THREE.MeshStandardMaterial({ color: '#f4f1ec', roughness: 1, side: THREE.DoubleSide }),
    vidrio: new THREE.MeshStandardMaterial({ color: 0xa9c6d6, roughness: 0.05, transparent: true, opacity: 0.25 })
  };
  const sh = new THREE.Shape(); pts.forEach(([x, z], i) => i ? sh.lineTo(x, -z) : sh.moveTo(x, -z));
  const piso = new THREE.Mesh(new THREE.ShapeGeometry(sh), M.piso); piso.rotation.x = -Math.PI / 2; piso.receiveShadow = true; piso.name = 'Piso'; g.add(piso);
  const techo = new THREE.Mesh(new THREE.ShapeGeometry(sh), M.techo); techo.rotation.x = -Math.PI / 2; techo.position.y = ALTO; techo.name = 'Techo'; g.add(techo);

  function caja(w, h, d, mat, x, y, z, ry, nombre) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); if (ry) m.rotation.y = ry; m.name = nombre || ''; g.add(m); return m;
  }
  function muro(a, b, h0, h1, mat, t) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.05) return;
    caja(L, h1 - h0, t || 0.14, mat || M.muro, (a[0] + b[0]) / 2, (h0 + h1) / 2, (a[1] + b[1]) / 2, -Math.atan2(b[1] - a[1], b[0] - a[0]), 'Muro');
  }
  // fachada: ventanas en los lados largos
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L > 3.2) {
      const t0 = 0.22, t1 = 0.78, p0 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0], p1 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
      muro(a, p0, 0, ALTO); muro(p1, b, 0, ALTO);
      muro(p0, p1, 0, 0.45); muro(p0, p1, 2.25, ALTO); muro(p0, p1, 0.45, 2.25, M.vidrio, 0.03);
    } else muro(a, b, 0, ALTO);
  });

  // muro interior que corre por la recta a→b solo donde está dentro del apto, con puertas en "puertas" (posiciones 0..1)
  function tabique(a, b, puertas) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(2, Math.ceil(L / 0.1));
    let ini = null;
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
      const hueco = puertas.some(p => Math.abs(t - p) * L < 0.45);
      const ok = enPoly(x, z, pts) && !hueco && i < n;
      if (ok && ini === null) ini = [x, z];
      if ((!ok || i === n) && ini) { muro(ini, [x, z], 0, ALTO, M.muro, 0.1); ini = null; }
      if (hueco && enPoly(x, z, pts)) { /* dintel */ }
    }
    puertas.forEach(p => { const x = a[0] + (b[0] - a[0]) * p, z = a[1] + (b[1] - a[1]) * p; if (enPoly(x, z, pts)) caja(0.9, ALTO - 2.1, 0.1, M.muro, x, 2.1 + (ALTO - 2.1) / 2, z, -Math.atan2(b[1] - a[1], b[0] - a[0])); });
  }

  // zonas: mitad social y mitad privada sobre el eje largo
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  pts.forEach(([x, z]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); });
  const largoX = (x1 - x0) >= (z1 - z0);
  // coordenadas locales: u a lo largo, v a lo ancho
  const U0 = largoX ? x0 : z0, U1 = largoX ? x1 : z1, V0 = largoX ? z0 : x0, V1 = largoX ? z1 : x1;
  const P = (u, v) => largoX ? [u, v] : [v, u];
  const alcobas = Math.max(1, +unidad.alcobas || 1), banos = Math.max(1, +unidad.banos || 1);
  const corte = U0 + (U1 - U0) * (alcobas >= 3 ? 0.42 : 0.5);
  // zona privada en [U0, corte]: alcobas + franja de baños
  const partes = []; const wB = 0.55;
  for (let i = 0; i < alcobas; i++) partes.push({ tipo: 'alcoba', w: 1 });
  partes.push({ tipo: 'bano', w: wB * Math.min(2, banos) });
  const tot = partes.reduce((s, p) => s + p.w, 0);
  let v = V0; partes.forEach(p => { p.v0 = v; v += (V1 - V0) * p.w / tot; p.v1 = v; });
  // muro social|privado con una puerta por recinto
  const puertas = partes.map(p => (((p.v0 + p.v1) / 2) - V0) / (V1 - V0));
  tabique(P(corte, V0), P(corte, V1), puertas);
  partes.slice(0, -1).forEach(p => tabique(P(U0, p.v1), P(corte, p.v1), []));

  const vistas = {}, cuartos = {}, nombres = {};
  const rect = (u0, u1, v0, v1) => { const a = P(u0, v0), b = P(u1, v1); return [Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[1], b[1])]; };
  // social
  const uS = (corte + U1) / 2, vS = (V0 + V1) / 2;
  cuartos.sala = rect(corte, U1, V0, V1);
  const W3 = (u, v, y) => { const [x, z] = P(u, v); return [x, y, z]; };
  vistas.sala = { n: 'Sala-comedor', eye: W3(corte + 0.8, vS, 1.6), look: W3(U1, V0 + (V1 - V0) * 0.3, 1.2) };
  // mobiliario social
  const yaw = largoX ? 0 : Math.PI / 2;
  { const [sx, , sz] = W3(U1 - 1.4, vS, 0); caja(2.1, 0.45, 0.9, M.acento, sx, 0.22, sz, yaw + Math.PI / 2, 'Sofá');
    const [rx, , rz] = W3(U1 - 1.0, vS, 0); caja(2.1, 0.45, 0.2, M.acento, rx, 0.67, rz, yaw + Math.PI / 2, 'Sofá'); }
  { const [tx, tz] = P(uS - 0.3, V0 + (V1 - V0) * 0.28); caja(1.6, 0.05, 0.9, M.mueble, tx, 0.75, tz, yaw, 'Comedor'); caja(0.1, 0.72, 0.1, M.mueble, tx, 0.36, tz, 0); }
  { const [kx, kz] = P(corte + 1.6, V1 - 0.35); caja(2.4, 0.9, 0.6, M.mueble, kx, 0.45, kz, yaw, 'Cocina'); caja(2.4, 0.04, 0.62, M.blanco, kx, 0.92, kz, yaw, 'Mesón'); cuartos.cocina = rect(corte, corte + 3, V1 - 1.4, V1); }
  vistas.cocina = { n: 'Cocina', eye: (([x, z]) => [x, 1.6, z])(P(corte + 1.6, V1 - 1.6)), look: (([x, z]) => [x, 1.0, z])(P(corte + 1.6, V1)) };
  // privada
  let nA = 0;
  partes.forEach(p => {
    const vm = (p.v0 + p.v1) / 2, um = (U0 + corte) / 2;
    if (p.tipo === 'alcoba') {
      nA++; const id = nA === 1 ? 'principal' : 'hab' + nA;
      cuartos[id] = rect(U0, corte, p.v0, p.v1);
      nombres[id] = nA === 1 ? 'Habitación principal' : 'Habitación ' + nA;
      vistas[id] = { n: nombres[id], eye: (([x, z]) => [x, 1.6, z])(P(corte - 0.6, vm)), look: (([x, z]) => [x, 0.9, z])(P(U0, vm)) };
      const ancho = nA === 1 ? 1.6 : 1.2; const [bx, bz] = P(U0 + 1.15, vm);
      caja(2.0, 0.5, ancho, M.blanco, bx, 0.25, bz, largoX ? 0 : Math.PI / 2, 'Cama');
      const [hx, hz] = P(U0 + 0.1, vm); caja(0.08, 1.1, ancho + 0.2, M.mueble, hx, 0.55, hz, largoX ? 0 : Math.PI / 2, 'Espaldar');
    } else {
      cuartos.bano = rect(U0, corte, p.v0, p.v1); nombres.bano = 'Baño';
      const [bx, bz] = P(U0 + 0.6, vm); caja(1.0, 0.85, 0.5, M.bano, bx, 0.42, bz, largoX ? Math.PI / 2 : 0, 'Lavamanos');
      const piso2 = rect(U0, corte, p.v0, p.v1);
      const pb = new THREE.Mesh(new THREE.PlaneGeometry(piso2[1] - piso2[0], piso2[3] - piso2[2]), M.bano);
      pb.rotation.x = -Math.PI / 2; pb.position.set((piso2[0] + piso2[1]) / 2, 0.005, (piso2[2] + piso2[3]) / 2); pb.name = 'Piso baño'; g.add(pb);
    }
  });
  g.traverse(o => { if (o.isMesh) o.receiveShadow = false; });
  const box = new THREE.Box3().setFromObject(g);
  return { group: g, vistas, cuartos, nombres, piso: 0, techo: ALTO, etiqueta: 'Generado desde la planta de la sala', box };
}
