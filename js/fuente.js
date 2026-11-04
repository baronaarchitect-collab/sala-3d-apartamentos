/*!
 * Life City · App 3D de la sala de ventas — conexión con la sala de ventas con renders (repo Inicio-bim)
 * -----------------------------------------------------------------------------------------------
 * La app 3D NO copia el inventario: usa el mismo motor de la sala (showroom.js + nube.js + config.js de Inicio-bim).
 *   · Proyecto demo:   datos.js publicado de la sala (Torre Alborada).
 *   · Sala publicada:  el datos.js de cualquier sala generada (Netlify, GitHub Pages…).
 *   · Mis proyectos:   los proyectos del asistente de Inicio-bim guardados en este navegador
 *                      (localStorage "lc:renders:p:<id>"; comparten origen en baronaarchitect-collab.github.io).
 * Encima se aplican los cambios del dashboard de la sala (SR.overlay) y los estados en vivo de Firebase (SRNube).
 */
export const INICIO = 'https://baronaarchitect-collab.github.io/Inicio-bim/visor/renders/';
export const DEMO_DATOS = INICIO + 'sala/datos.js';
export const DEMO_SALA = INICIO + 'sala/';
export const DEMO_DASHBOARD = INICIO + 'sala/dashboard.html';
export const GENERADOR = INICIO + '#implementar';

/* ---------- utilidades ---------- */
export function ls(k, v) {
  try {
    if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null');
    if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v));
    return true;
  } catch (e) { return v === undefined ? null : false; }
}
export function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
export function hash(s) { let h = 5381; for (const c of String(s)) h = ((h << 5) + h + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); }
export function b64(o) { return btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
export function unb64(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(decodeURIComponent(escape(atob(s)))); }
function script(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.async = false;
    s.onload = () => res(); s.onerror = () => rej(new Error('No se pudo cargar ' + src));
    document.head.appendChild(s);
  });
}

/* ---------- motor de la sala (Inicio-bim) ---------- */
let motor = null;
export function cargarMotor() {
  if (!motor) motor = (async () => {
    await script(INICIO + 'config.js').catch(() => {});      // Firebase de las salas (lifecity-salas-renders)
    await script(INICIO + 'sala/showroom.js');                // SR: overlay, syncUnits, money, slug
    await script(INICIO + 'sala/nube.js').catch(() => {});    // SRNube: estados en vivo
  })();
  return motor;
}

/* ---------- proyectos de la sala ---------- */
export function proyectosLocales() {
  return (ls('lc:renders:proyectos') || []).filter(p => ls('lc:renders:p:' + p.id)).sort((a, b) => b.actualizado - a.actualizado);
}
async function cargarDatosUrl(url) {
  delete window.SALA;
  await script(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now());
  if (!window.SALA) throw new Error('Ese link no tiene el datos.js de una sala de ventas.');
  return JSON.parse(JSON.stringify(window.SALA));
}
/* link de la sala publicada → su datos.js */
export function datosDeSala(url) {
  url = String(url || '').trim(); if (!url) return '';
  if (/datos\.js(\?|$)/.test(url)) return url;
  url = url.split('#')[0].split('?')[0];
  if (/\.html$/.test(url)) url = url.replace(/[^/]*$/, '');
  if (!url.endsWith('/')) url += '/';
  return url + 'datos.js';
}

/* fuente: {tipo:'demo'} | {tipo:'url', datos} | {tipo:'local', id}
   → {S, original, overlayKey} con overlay del dashboard y unidades sincronizadas */
export async function resolverSala(fuente) {
  await cargarMotor();
  const SR = window.SR;
  let original;
  if (fuente.tipo === 'local') {
    original = ls('lc:renders:p:' + fuente.id);
    if (!original) throw new Error('Ese proyecto ya no está guardado en este navegador.');
  } else {
    original = await cargarDatosUrl(fuente.tipo === 'url' ? fuente.datos : DEMO_DATOS);
  }
  window.SALA = JSON.parse(JSON.stringify(original));     // overlay.key usa window.SALA.proyecto cuando no hay id
  const S = SR.overlay.apply(JSON.parse(JSON.stringify(original)));
  if (!(S.unidades || []).length) SR.syncUnits(S);
  const overlayKey = 'sr:overlay:' + (S.id || SR.slug(original.proyecto));
  return { S, original, overlayKey };
}

/* estados en vivo: Firebase (lo que marca la constructora) + cambios del dashboard en otra pestaña */
export function escucharEstados(fuente, S, overlayKey, onCambio) {
  const N = window.SRNube;
  if (N && N.on(S)) N.watch(S, d => { if (d && N.aplicar(S, d.estados)) onCambio(); }).catch(e => console.warn('Nube:', e.message));
  window.addEventListener('storage', e => {
    if (e.key !== overlayKey && e.key !== 'lc:renders:p:' + fuente.id) return;
    const src = e.key === overlayKey ? ls(overlayKey) : ls(e.key);
    if (!src || !src.unidades) return;
    const map = {}; src.unidades.forEach(u => { map[u.id] = u.estado; });
    let ch = false;
    S.unidades.forEach(u => { if (map[u.id] && map[u.id] !== u.estado) { u.estado = map[u.id]; ch = true; } });
    if (ch) onCambio();
  });
}

/* escribe el link del recorrido en la sala → aparece "Ver recorrido en 3D" en la fachada y en la ficha del apto */
export function conectarSala(fuente, res, link) {
  if (fuente.tipo === 'local') {
    const P = ls('lc:renders:p:' + fuente.id); if (!P) return { ok: false, motivo: 'No encontré el proyecto.' };
    P.recorrido = Object.assign({}, P.recorrido, { url: link });
    return { ok: ls('lc:renders:p:' + fuente.id, P), donde: 'el proyecto «' + (P.proyecto || 'sin nombre') + '» del asistente de la sala' };
  }
  const datos = fuente.tipo === 'url' ? fuente.datos : DEMO_DATOS;
  if (new URL(datos, location.href).origin !== location.origin) {
    return { ok: false, manual: true, motivo: 'Esa sala vive en otro dominio. Pega el link en su dashboard → Proyecto → Link del recorrido 3D.' };
  }
  const o = ls(res.overlayKey) || {};
  o.recorrido = Object.assign({}, res.original.recorrido, o.recorrido, { url: link });
  return { ok: ls(res.overlayKey, o), donde: 'el dashboard de la sala «' + (res.S.proyecto || '') + '» en este navegador' };
}
export function desconectarSala(fuente, res) {
  if (fuente.tipo === 'local') {
    const P = ls('lc:renders:p:' + fuente.id); if (!P) return;
    P.recorrido = Object.assign({}, P.recorrido, { url: '' }); ls('lc:renders:p:' + fuente.id, P); return;
  }
  const o = ls(res.overlayKey); if (!o || !o.recorrido) return;
  delete o.recorrido; ls(res.overlayKey, Object.keys(o).length ? o : null);
}

/* ---------- apps 3D guardadas ---------- */
/* app: {key, nombre, fuente, salaUrl, torre:{altoPiso, losa, fachada}, modelos:{plantaId:{tipo, url}}, creada, actualizada} */
export function keyDe(fuente) { return fuente.tipo === 'local' ? 'l-' + fuente.id : fuente.tipo === 'demo' ? 'demo' : 'u-' + hash(fuente.datos); }
export function listaApps() { return (ls('lc:3d:apps') || []).map(k => ls('lc:3d:app:' + k)).filter(Boolean).sort((a, b) => b.actualizada - a.actualizada); }
export function leerApp(key) { return ls('lc:3d:app:' + key); }
export function guardarApp(app) {
  app.actualizada = Date.now(); app.creada = app.creada || app.actualizada;
  ls('lc:3d:app:' + app.key, app);
  const L = (ls('lc:3d:apps') || []).filter(k => k !== app.key); L.push(app.key); ls('lc:3d:apps', L);
}
export async function borrarApp(key) {
  const app = leerApp(key);
  ls('lc:3d:app:' + key, null); ls('lc:3d:apps', (ls('lc:3d:apps') || []).filter(k => k !== key));
  if (app) for (const id of Object.keys(app.modelos || {})) await idb.del(key + ':' + id).catch(() => {});
}
export function appPorDefecto(fuente, S) {
  const modelos = {}; (S.plantas || []).forEach(p => { modelos[p.id] = { tipo: 'referencia' }; });
  return { v: 1, key: keyDe(fuente), nombre: S.proyecto || 'Mi proyecto', fuente, salaUrl: fuente.tipo === 'demo' ? DEMO_SALA : '', torre: { altoPiso: 3, losa: '#ece6dc', fachada: '#2b2a27' }, modelos };
}

/* la app viaja en el link (?c=…) para que el comprador la abra en cualquier equipo;
   los modelos subidos al navegador no viajan: hay que publicarlos y usar su link */
export function configPublica(app) {
  const c = JSON.parse(JSON.stringify(app));
  delete c.key; delete c.creada; delete c.actualizada;
  if (c.fuente.tipo === 'local') {
    if (!c.salaUrl) return null;
    c.fuente = { tipo: 'url', datos: datosDeSala(c.salaUrl) };
  }
  Object.values(c.modelos || {}).forEach(m => { if (m.tipo === 'archivo') { m.tipo = 'referencia'; } });
  return c;
}
export function baseApp() { return location.href.split('#')[0].split('?')[0].replace(/[^/]*$/, ''); }
export function linkLocal(app) { return baseApp() + 'visor.html?app=' + encodeURIComponent(app.key); }
export function linkPublico(app) { const c = configPublica(app); return c ? baseApp() + 'visor.html?c=' + b64(c) : null; }

/* ---------- modelos GLB subidos (IndexedDB de este navegador) ---------- */
export const idb = (() => {
  let p;
  function open() {
    if (!p) p = new Promise((res, rej) => {
      const rq = indexedDB.open('lc-3d-modelos', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('files');
      rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
    });
    return p;
  }
  function run(mode, fn) {
    return open().then(d => new Promise((res, rej) => {
      const tx = d.transaction('files', mode), out = fn(tx.objectStore('files'));
      tx.oncomplete = () => res(out && 'result' in out ? out.result : undefined); tx.onerror = () => rej(tx.error);
    }));
  }
  return {
    put: (k, b) => run('readwrite', s => { s.put(b, k); }),
    get: k => run('readonly', s => s.get(k)),
    del: k => run('readwrite', s => { s.delete(k); })
  };
})();
