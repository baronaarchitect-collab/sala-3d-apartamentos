/*!
 * Apartamentos del IFC a partir de sus espacios (IfcSpace / rooms de Revit) y su conexión con la base de datos de la sala.
 *
 *   detectarAptos(espacios, S) → {metodo, orient, unidades:{<id de la sala>: {nombre, piso, nombres[], cajas[[x0,y0,z0,x1,y1,z1]]}},
 *                                 grupos:[{clave, nombre, piso, n, area, unidad}], total, conectados}
 *
 * Cómo agrupa los espacios en apartamentos (usa el primero que cubra al menos la mitad de los espacios habitables):
 *   1. zona   → IfcZone que agrupa los espacios (Revit: zonas / "Espacios" exportados como zona)
 *   2. propiedad → parámetro del espacio tipo Departamento / Apartamento / Unidad (Revit: "Departamento" del room)
 *   3. nombre → código en el nombre o número del espacio: "Apto 302 - Sala", "302-01", "A-302.3"
 *   4. planta → sin nada de lo anterior, cada espacio cae en el polígono del apto que la sala dibujó sobre la planta
 * Cómo los conecta con la sala: por número (302 ↔ unidad 302) y, si no hay número, por piso y posición en la planta
 * (prueba las 8 orientaciones posibles de la planta y se queda con la que mejor cuadra posiciones y áreas).
 */

export const CIRCULACION = /circulaci|corredor|pasillo|hall (com|de asc|de acceso|principal)|escaler|ascensor|punto fijo|lobby|shaft|ducto|buitr|cuarto t[eé]cnico|basura|shut|parqueader|garaje|porter|recepci|zona(s)? com|gimnas|piscina|bbq|sal[oó]n (social|comunal)|cuarto de m[aá]quinas|subestaci|planta el[eé]ctrica|rampa|vac[ií]o|void|\bcore\b|stair|elevator|corridor|\blift\b|lobby/i;
const RE_APTO = /(?:apto|apartamento|apartment|apart|apt|unidad|depto|dpto|departamento|vivienda|unit|ap)\.?\s*(?:n[°ºo.]?\s*)?[-#:]?\s*([a-z]?\s?-?\d{1,4}[a-z]?)\b/i;
const RE_NUM = /^\s*([a-z]{0,2}-?\d{3,4})\s*[-._/]\s*\d{1,3}\s*$/i;
const limpio = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function codigoTexto(t, libre) {
  if (!t) return '';
  const m = RE_APTO.exec(t); if (m) return limpio(m[1]);
  if (libre && /^\s*[a-z]{0,3}[-\s]?\d{1,4}[a-z]?\s*$/i.test(t)) return limpio(t);
  return '';
}
const CLAVES = {
  zona: e => e.zona ? (codigoTexto(e.zona, true) || limpio(e.zona)) : '',
  propiedad: e => e.prop ? (codigoTexto(e.prop, true) || limpio(e.prop)) : '',
  nombre: e => codigoTexto(e.numero) || codigoTexto(e.nombre) || ((RE_NUM.exec(e.numero || '') || [])[1] ? limpio(RE_NUM.exec(e.numero)[1]) : '')
};
const etiqueta = { zona: 'zonas del IFC', propiedad: 'parámetro de los espacios', nombre: 'nombres de los espacios', planta: 'polígonos de la planta de la sala' };

function areaXZ(b) { return Math.max(0, b.max.x - b.min.x) * Math.max(0, b.max.z - b.min.z); }
function centro(b) { return [(b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2]; }
function enPoly(x, y, pts) {
  let d = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) d = !d;
  }
  return d;
}
function centroPoly(p) { const n = p.length || 1; return [p.reduce((s, q) => s + q[0], 0) / n, p.reduce((s, q) => s + q[1], 0) / n]; }
function areaPoly(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; a += q[0] * r[1] - r[0] * q[1]; } return Math.abs(a) / 2; }
const ORIENT = [
  (u, v) => [u, v], (u, v) => [1 - u, v], (u, v) => [u, 1 - v], (u, v) => [1 - u, 1 - v],
  (u, v) => [v, u], (u, v) => [1 - v, u], (u, v) => [v, 1 - u], (u, v) => [1 - v, 1 - u]
];
const numPiso = s => { const m = /(-?\d{1,3})(?!.*\d)/.exec(String(s || '').replace(/[+]/g, '')); return m ? +m[1] : null; };

/* pisos del IFC que tienen espacios habitables, de abajo hacia arriba */
function pisosIFC(hab) {
  const P = {};
  hab.forEach(e => {
    const k = e.pisoId != null ? 'p' + e.pisoId : 'y' + Math.round(e.box.min.y * 2) / 2;
    (P[k] = P[k] || { k, nombre: e.piso || '', ys: [], esp: [] }).esp.push(e);
    P[k].ys.push(e.box.min.y);
  });
  return Object.values(P).map(p => { p.ys.sort((a, b) => a - b); p.y = p.ys[Math.floor(p.ys.length / 2)]; p.nivel = numPiso(p.nombre); return p; }).sort((a, b) => a.y - b.y);
}
/* pisos de la sala con planta, de abajo hacia arriba */
function pisosSala(S) {
  return (S.pisos || []).filter(p => (S.plantas || []).some(pl => pl.id === p.planta)).sort((a, b) => (+a.nivel || 0) - (+b.nivel || 0));
}
/* qué piso de la sala es cada piso del IFC: por el número del nombre o, si no, alineando por cantidad/área */
function emparejarPisos(PI, PS, S, medida) {
  const porNivel = new Map();
  const conNum = PI.filter(p => p.nivel != null && PS.some(s => +s.nivel === p.nivel));
  if (conNum.length >= Math.min(PI.length, PS.length) * 0.5) {
    conNum.forEach(p => porNivel.set(p, PS.find(s => +s.nivel === p.nivel)));
    return porNivel;
  }
  let mejor = null;
  for (let o = -PI.length + 1; o < PS.length; o++) {
    let sc = 0, n = 0;
    PI.forEach((p, i) => { const s = PS[i + o]; if (!s) return; n++; const a = medida(p), b = medida(s, true); sc += Math.min(a, b) / Math.max(a, b, 1e-6); });
    if (!mejor || sc > mejor.sc + 1e-9) mejor = { o, sc, n };
  }
  if (mejor) PI.forEach((p, i) => { const s = PS[i + mejor.o]; if (s) porNivel.set(p, s); });
  return porNivel;
}
function marco(cajas) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  cajas.forEach(b => { x0 = Math.min(x0, b.min.x); x1 = Math.max(x1, b.max.x); z0 = Math.min(z0, b.min.z); z1 = Math.max(z1, b.max.z); });
  return { x0, z0, w: Math.max(1e-6, x1 - x0), d: Math.max(1e-6, z1 - z0) };
}
function marcoPlanta(pl) {
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
  (pl.aptos || []).forEach(a => (a.poly || []).forEach(p => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }));
  return { x0, y0, w: Math.max(1e-6, x1 - x0), d: Math.max(1e-6, y1 - y0) };
}
const unidadDe = (S, piso, n) => (S.unidades || []).find(u => u.piso === piso.id && String(u.apto) === String(n));

export function detectarAptos(espacios, S) {
  const vacio = { metodo: null, unidades: {}, grupos: [], total: 0, conectados: 0 };
  if (!espacios || !espacios.length || !S) return vacio;
  const hab = espacios.filter(e => e.box && areaXZ(e.box) > 0.3);
  const todos = hab.filter(e => !CIRCULACION.test((e.nombre || '') + ' ' + (e.numero || '')));
  if (!todos.length) return vacio;

  // 1-3: agrupar por zona, propiedad o código en el nombre
  let metodo = null, clave = null;
  for (const m of ['zona', 'propiedad', 'nombre']) {
    const con = hab.filter(e => CLAVES[m](e)).length;
    if (con >= todos.length * 0.5) { metodo = m; clave = CLAVES[m]; break; }
  }
  const PS = pisosSala(S), plantaDe = id => (S.plantas || []).find(p => p.id === id);
  const unidadesId = new Map((S.unidades || []).map(u => [limpio(u.id), u]));
  let grupos = [];

  if (metodo) {
    const G = {};
    hab.forEach(e => { const k = clave(e); if (!k) return; (G[k] = G[k] || { clave: k, esp: [] }).esp.push(e); });
    grupos = Object.values(G);
  }

  const PI = pisosIFC(metodo ? grupos.flatMap(g => g.esp) : todos);
  const medida = metodo
    ? (p, sala) => sala ? (plantaDe(p.planta).aptos || []).length : new Set(p.esp.map(e => clave(e))).size
    : (p, sala) => sala ? (plantaDe(p.planta).aptos || []).reduce((s, a) => s + (+a.area || 0), 0) : p.esp.reduce((s, e) => s + areaXZ(e.box), 0);
  const pisoDe = emparejarPisos(PI, PS, S, medida);
  const pisoIFCde = new Map(); PI.forEach(p => p.esp.forEach(e => pisoIFCde.set(e, p)));

  const asignado = new Map(); // grupo → unidad
  // por número: el código del grupo es el id de la unidad (302, 1203…) o el número del apto en su piso
  if (metodo) grupos.forEach(g => {
    let u = unidadesId.get(g.clave) || unidadesId.get(g.clave.replace(/^[A-Z]+/, '')) || unidadesId.get(g.clave.replace(/^0+/, ''));
    if (!u) {
      const p = pisoDe.get(pisoIFCde.get(g.esp[0])), n = +(g.clave.match(/(\d{1,2})$/) || [])[1];
      if (p && n && g.clave.replace(/^[A-Z]+/, '').length <= 2) u = unidadDe(S, p, n);
    }
    if (u && ![...asignado.values()].includes(u)) asignado.set(g, u);
  });

  // por posición en la planta (lo que no cuadró por número, o todo si no hay grupos)
  const faltan = metodo ? grupos.filter(g => !asignado.has(g)) : null;
  let orient = null;
  if (!metodo || faltan.length) {
    const pares = PI.map(p => ({ p, s: pisoDe.get(p) })).filter(x => x.s);
    const costoCon = (f, aplicar) => {
      let costo = 0;
      pares.forEach(({ p, s }) => {
        const pl = plantaDe(s.planta), mf = marco(p.esp.map(e => e.box)), mp = marcoPlanta(pl);
        const norm = b => { const [x, z] = centro(b); return f((x - mf.x0) / mf.w, (z - mf.z0) / mf.d); };
        const aptos = (pl.aptos || []).map(a => ({ a, c: centroPoly(a.poly).map((v, i) => (v - (i ? mp.y0 : mp.x0)) / (i ? mp.d : mp.w)), poly: a.poly.map(q => [(q[0] - mp.x0) / mp.w, (q[1] - mp.y0) / mp.d]) }));
        if (metodo) {
          const gs = faltan.filter(g => pisoIFCde.get(g.esp[0]) === p);
          const libres = aptos.filter(x => { const u = unidadDe(S, s, x.a.n); return u && ![...asignado.values()].includes(u); });
          const pares2 = [];
          gs.forEach(g => {
            const caja = g.esp.reduce((b, e) => ({ min: { x: Math.min(b.min.x, e.box.min.x), z: Math.min(b.min.z, e.box.min.z) }, max: { x: Math.max(b.max.x, e.box.max.x), z: Math.max(b.max.z, e.box.max.z) } }), { min: { x: Infinity, z: Infinity }, max: { x: -Infinity, z: -Infinity } });
            const c = norm(caja), area = g.esp.reduce((t, e) => t + areaXZ(e.box), 0);
            libres.forEach(x => pares2.push({ g, x, d: Math.hypot(c[0] - x.c[0], c[1] - x.c[1]) + 0.25 * Math.abs(area - (+x.a.area || area)) / Math.max(area, 1) }));
          });
          pares2.sort((a, b) => a.d - b.d);
          const usadoG = new Set(), usadoX = new Set();
          pares2.forEach(q => {
            if (usadoG.has(q.g) || usadoX.has(q.x)) return;
            usadoG.add(q.g); usadoX.add(q.x); costo += q.d;
            if (aplicar) asignado.set(q.g, unidadDe(S, s, q.x.a.n));
          });
          costo += (gs.length - usadoG.size) * 1.5;
        } else {
          const area = new Map(aptos.map(x => [x, 0])), dentro = new Map();
          p.esp.forEach(e => {
            const [u, v] = norm(e.box);
            let x = aptos.find(q => enPoly(u, v, q.poly));
            if (!x) { const cerca = aptos.map(q => [q, Math.hypot(u - q.c[0], v - q.c[1])]).sort((a, b) => a[1] - b[1])[0]; if (cerca && cerca[1] < 0.12) x = cerca[0]; }
            if (!x) { costo += 0.3; return; }
            area.set(x, area.get(x) + areaXZ(e.box)); (dentro.get(x) || dentro.set(x, []).get(x)).push(e);
          });
          aptos.forEach(x => { const a = area.get(x), b = +x.a.area || a || 1; costo += Math.abs(a - b) / b; });
          if (aplicar) dentro.forEach((es, x) => {
            const u = unidadDe(S, s, x.a.n); if (!u) return;
            const g = { clave: limpio(u.id), esp: es }; grupos.push(g); asignado.set(g, u);
          });
        }
      });
      return costo;
    };
    let best = 0, bc = Infinity;
    ORIENT.forEach((f, i) => { const c = costoCon(f, false); if (c < bc - 1e-9) { bc = c; best = i; } });
    orient = best;
    costoCon(ORIENT[best], true);
    if (!metodo) metodo = 'planta';
  }

  const r2 = v => Math.round(v * 100) / 100;
  const unidades = {};
  const lista = grupos.map(g => {
    const u = asignado.get(g), p = pisoIFCde.get(g.esp[0]) || {};
    const area = g.esp.reduce((t, e) => t + areaXZ(e.box), 0);
    const nombre = metodo === 'zona' ? (g.esp[0].zona || g.clave) : metodo === 'propiedad' ? (g.esp[0].prop || g.clave) : (metodo === 'planta' ? 'Apto ' + (u ? u.id : '?') : g.clave);
    if (u) unidades[u.id] = {
      clave: g.clave, nombre, piso: p.nombre || '', nombres: g.esp.map(e => e.nombre || e.numero || 'Espacio'),
      cajas: g.esp.map(e => [e.box.min.x, e.box.min.y, e.box.min.z, e.box.max.x, e.box.max.y, e.box.max.z].map(r2))
    };
    return { clave: g.clave, nombre, piso: p.nombre || '', n: g.esp.length, area: Math.round(area), unidad: u ? u.id : '' };
  }).sort((a, b) => String(a.piso).localeCompare(String(b.piso), 'es', { numeric: true }) || String(a.clave).localeCompare(String(b.clave), 'es', { numeric: true }));
  // los espacios agrupados que no son de ningún apto conocido también se guardan para reasignarlos a mano
  const sueltos = {};
  grupos.forEach(g => { if (!asignado.has(g)) sueltos[g.clave] = { clave: g.clave, nombre: g.clave, nombres: g.esp.map(e => e.nombre || e.numero || 'Espacio'), piso: (pisoIFCde.get(g.esp[0]) || {}).nombre || '', cajas: g.esp.map(e => [e.box.min.x, e.box.min.y, e.box.min.z, e.box.max.x, e.box.max.y, e.box.max.z].map(r2)) }; });
  return { metodo, como: etiqueta[metodo], orient, unidades, sueltos, grupos: lista, total: (S.unidades || []).length, conectados: Object.keys(unidades).length };
}

/* reasignar a mano un grupo del IFC a otra unidad de la sala (o a ninguna) */
export function reasignar(D, clave, nuevaId) {
  let datos = null;
  const id0 = Object.keys(D.unidades).find(id => D.unidades[id].clave === clave);
  if (id0) { datos = D.unidades[id0]; delete D.unidades[id0]; }
  else if (D.sueltos && D.sueltos[clave]) { datos = D.sueltos[clave]; delete D.sueltos[clave]; }
  if (!datos) return D;
  D.sueltos = D.sueltos || {};
  if (nuevaId) {
    const prev = D.unidades[nuevaId];
    if (prev) { D.sueltos[prev.clave] = prev; const gp = D.grupos.find(x => x.clave === prev.clave); if (gp) gp.unidad = ''; }
    D.unidades[nuevaId] = datos;
  } else D.sueltos[clave] = datos;
  const g = D.grupos.find(x => x.clave === clave); if (g) g.unidad = nuevaId || '';
  D.conectados = Object.keys(D.unidades).length;
  D.manual = true;
  return D;
}
