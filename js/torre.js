/*!
 * Edificio 3D a partir de la sala de ventas: cada piso de la fachada se apila con su planta,
 * y cada apartamento de la planta (el mismo polígono que el comprador toca en la sala) se vuelve un volumen.
 * El color de cada volumen es su estado del inventario (disponible / reservado / vendido).
 */
import * as THREE from 'three';

export const COLORES = { disponible: 0x2f9e5f, reservado: 0xd39b2a, vendido: 0x8d8780 };
const RATIO = 1.5; // proporción de la planta en la sala (ancho : fondo)

function areaPoly(poly) {
  let a = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(a) / 2;
}
/* escala real de la planta: el área de cada apto en m² contra el área de su polígono */
export function escalaPlantas(S) {
  const k = [];
  (S.plantas || []).forEach(pl => (pl.aptos || []).forEach(a => {
    const ap = areaPoly(a.poly || []); if (ap > 0.002 && +a.area > 0) k.push(+a.area / (ap * RATIO));
  }));
  k.sort((a, b) => a - b);
  const m = k.length ? k[Math.floor(k.length / 2)] : 280;
  const D = Math.min(60, Math.max(8, Math.sqrt(m)));
  return { W: D * RATIO, D };
}
export function aMundo(p, esc) { return [(p[0] - 0.5) * esc.W, (p[1] - 0.5) * esc.D]; }
export function plantaDe(S, id) { return (S.plantas || []).find(p => p.id === id); }

function forma(poly, esc, inset) {
  const pts = poly.map(p => aMundo(p, esc));
  // encoge un poco el polígono hacia su centro para que se lean las juntas entre aptos
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const sh = new THREE.Shape();
  pts.forEach((p, i) => {
    const dx = p[0] - cx, dz = p[1] - cz, L = Math.hypot(dx, dz) || 1, f = Math.max(0, (L - inset) / L);
    const x = cx + dx * f, z = cz + dz * f;
    i ? sh.lineTo(x, -z) : sh.moveTo(x, -z);
  });
  return sh;
}
function bbox(polys) {
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
  polys.forEach(poly => poly.forEach(p => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }));
  return { x0, x1, y0, y1 };
}

/* devuelve {group, unidades:[mesh], refrescar(), centro, alto, radio} */
export function construirTorre(S, opts = {}) {
  const esc = escalaPlantas(S);
  const alto = +opts.altoPiso || 3;
  const g = new THREE.Group(); g.name = 'torre';
  const pisos = [...(S.pisos || [])].sort((a, b) => (+a.nivel || 0) - (+b.nivel || 0));
  const base = pisos.length ? Math.min(...pisos.map(p => +p.nivel || 0)) : 1;
  const lobby = alto * 1.35;
  const losaMat = new THREE.MeshStandardMaterial({ color: opts.losa || '#ece6dc', roughness: 0.85 });
  const nucleoMat = new THREE.MeshStandardMaterial({ color: opts.fachada || '#2b2a27', roughness: 0.6, metalness: 0.1 });
  const vidrioMat = new THREE.MeshStandardMaterial({ color: 0x9fb7c4, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.35 });
  const unidades = [];
  let topY = lobby, bAll = null;

  // primer piso / lobby con el área de la primera planta
  const pl0 = plantaDe(S, pisos[0] && pisos[0].planta);
  if (pl0) {
    const b = bbox(pl0.aptos.map(a => a.poly)); bAll = b;
    const w = (b.x1 - b.x0) * esc.W, d = (b.y1 - b.y0) * esc.D;
    const cx = ((b.x0 + b.x1) / 2 - 0.5) * esc.W, cz = ((b.y0 + b.y1) / 2 - 0.5) * esc.D;
    const lb = new THREE.Mesh(new THREE.BoxGeometry(w * 0.96, lobby - 0.3, d * 0.96), vidrioMat); lb.position.set(cx, (lobby - 0.3) / 2, cz); g.add(lb);
    const lf = new THREE.Mesh(new THREE.BoxGeometry(w * 0.4, lobby - 0.3, d * 0.4), nucleoMat); lf.position.set(cx, (lobby - 0.3) / 2, cz); g.add(lf);
  }

  pisos.forEach(piso => {
    const pl = plantaDe(S, piso.planta); if (!pl) return;
    const y = lobby + ((+piso.nivel || 0) - base) * alto;
    const b = bbox(pl.aptos.map(a => a.poly));
    const w = (b.x1 - b.x0) * esc.W, d = (b.y1 - b.y0) * esc.D;
    const cx = ((b.x0 + b.x1) / 2 - 0.5) * esc.W, cz = ((b.y0 + b.y1) / 2 - 0.5) * esc.D;
    const losa = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.28, d + 0.5), losaMat);
    losa.position.set(cx, y - 0.14, cz); losa.receiveShadow = true; losa.castShadow = true; g.add(losa);
    // núcleo de circulación (lo que queda entre aptos)
    const nc = new THREE.Mesh(new THREE.BoxGeometry(w * 0.3, alto - 0.3, d * 0.3), nucleoMat);
    nc.position.set(cx, y + (alto - 0.3) / 2, cz); g.add(nc);

    pl.aptos.forEach(a => {
      const u = (S.unidades || []).find(x => x.piso === piso.id && String(x.apto) === String(a.n));
      if (!u) return;
      const geo = new THREE.ExtrudeGeometry(forma(a.poly, esc, 0.18), { depth: alto - 0.32, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({ color: COLORES[u.estado] || COLORES.vendido, roughness: 0.45, metalness: 0.05, transparent: true, opacity: 0.92 });
      const m = new THREE.Mesh(geo, mat);
      m.position.y = y; m.castShadow = true;
      m.userData = { unidad: u, piso, planta: pl, apto: a };
      const ed = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
      m.add(ed);
      g.add(m); unidades.push(m);
    });
    topY = Math.max(topY, y + alto);
  });
  // cubierta
  const plU = plantaDe(S, pisos.length && pisos[pisos.length - 1].planta);
  if (plU) {
    const b = bbox(plU.aptos.map(a => a.poly));
    const w = (b.x1 - b.x0) * esc.W, d = (b.y1 - b.y0) * esc.D;
    const cub = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.35, d + 0.5), losaMat);
    cub.position.set(((b.x0 + b.x1) / 2 - 0.5) * esc.W, topY + 0.02, ((b.y0 + b.y1) / 2 - 0.5) * esc.D); g.add(cub);
  }

  function refrescar(seleccion, hover) {
    unidades.forEach(m => {
      const u = m.userData.unidad, mat = m.material;
      mat.color.setHex(COLORES[u.estado] || COLORES.vendido);
      mat.opacity = u.estado === 'vendido' ? 0.55 : 0.92;
      const on = m === seleccion, hv = m === hover;
      mat.emissive.setHex(on ? 0xffffff : hv ? 0xffffff : 0x000000);
      mat.emissiveIntensity = on ? 0.32 : hv ? 0.16 : 0;
      m.children[0].material.opacity = on ? 1 : 0.35;
    });
  }
  refrescar();
  const radio = Math.max(esc.W, esc.D, topY) * 0.75;
  return { group: g, unidades, refrescar, esc, alto: topY, radio, centro: new THREE.Vector3(0, topY / 2, 0) };
}
