/*!
 * Dashboard: crea la app 3D de una sala de ventas, la configura, la conecta con la sala y entrega el link.
 */
import {
  cargarMotor, resolverSala, proyectosLocales, datosDeSala, keyDe, leerApp, guardarApp, borrarApp, listaApps, appPorDefecto,
  linkLocal, linkPublico, conectarSala, desconectarSala, idb, esc
} from './fuente.js';

const $ = s => document.querySelector(s);
let fuente = null, res = null, app = null;
let tt; function toast(m) { const el = $('#toast'); el.textContent = m; el.hidden = false; clearTimeout(tt); tt = setTimeout(() => { el.hidden = true; }, 3200); }
function conteo(S) {
  const c = { disponible: 0, reservado: 0, vendido: 0 };
  (S.unidades || []).forEach(u => { c[u.estado] = (c[u.estado] || 0) + 1; });
  return c;
}

/* ---------- 1 · fuentes ---------- */
async function pintarFuentes() {
  const G = $('#fuentes'); G.innerHTML = '';
  // demo publicado
  let demo = null;
  try { demo = (await resolverSala({ tipo: 'demo' })).S; } catch (e) { console.warn(e); }
  const cards = [];
  cards.push(card({ tipo: 'demo' }, 'Proyecto demo', demo ? demo.proyecto : 'Torre Alborada', demo ? [demo.empresa, demo.ciudad].filter(Boolean).join(' · ') : 'Sala publicada en Inicio-bim',
    demo ? [(demo.pisos || []).length + ' pisos', (demo.unidades || []).length + ' unidades', conteo(demo).disponible + ' disponibles'] : []));
  proyectosLocales().forEach(p => cards.push(card({ tipo: 'local', id: p.id }, 'Mi proyecto · este navegador', p.proyecto, p.empresa,
    [p.pisos + ' pisos', p.unidades + ' unidades', 'editado ' + new Date(p.actualizado).toLocaleDateString('es-CO')])));
  // sala publicada por link
  const u = document.createElement('div'); u.className = 'src';
  u.innerHTML = `<div class="tag">Sala publicada</div><h3>Conectar por link</h3><p class="muted small" style="margin:0">Pega el link de cualquier sala generada (Netlify, GitHub Pages…).</p>
    <input id="i-url" type="url" placeholder="https://mi-proyecto.netlify.app/" aria-label="Link de la sala publicada">
    <div class="acts"><button class="btn sm" type="button" id="b-url">Usar esta sala</button></div>`;
  cards.forEach(c => G.appendChild(c)); G.appendChild(u);
  $('#b-url').onclick = () => {
    const v = $('#i-url').value.trim(); if (!/^https?:\/\//.test(v)) { toast('Pega el link completo de la sala (https://…)'); return; }
    elegir({ tipo: 'url', datos: datosDeSala(v) }, v);
  };
}
function card(f, tag, nombre, sub, meta) {
  const d = document.createElement('div'); d.className = 'src'; d.dataset.key = keyDe(f);
  const existe = !!leerApp(keyDe(f));
  d.innerHTML = `<div class="tag">${esc(tag)}</div><h3>${esc(nombre || 'Proyecto sin nombre')}</h3><p class="muted small" style="margin:0">${esc(sub || '')}</p>
    <div class="meta">${meta.map(m => `<span>${esc(m)}</span>`).join('')}</div>
    <div class="acts"><button class="btn sm" type="button">${existe ? 'Editar app 3D' : 'Crear app 3D'}</button></div>`;
  d.querySelector('button').onclick = () => elegir(f);
  return d;
}

/* ---------- mis apps ---------- */
function pintarApps() {
  const L = listaApps(), G = $('#apps');
  $('#mis-apps').hidden = !L.length; G.innerHTML = '';
  L.forEach(a => {
    const d = document.createElement('div'); d.className = 'src';
    d.innerHTML = `<div class="tag">${a.fuente.tipo === 'demo' ? 'Demo' : a.fuente.tipo === 'local' ? 'Proyecto local' : 'Sala publicada'}</div><h3>${esc(a.nombre)}</h3>
      <p class="muted small" style="margin:0">Actualizada ${new Date(a.actualizada).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}</p>
      <div class="acts"><a class="btn sm" href="${esc(linkLocal(a))}" target="_blank" rel="noopener">Abrir ↗</a><button class="btn ghost sm" data-a="edit" type="button">Editar</button><button class="btn ghost sm" data-a="del" type="button">Eliminar</button></div>`;
    d.querySelector('[data-a=edit]').onclick = () => elegir(a.fuente);
    d.querySelector('[data-a=del]').onclick = async () => {
      if (!confirm('¿Eliminar la app 3D «' + a.nombre + '»? La sala de ventas no se toca.')) return;
      await borrarApp(a.key); if (app && app.key === a.key) { $('#config').hidden = true; $('#publicar').hidden = true; app = null; }
      pintarApps(); pintarFuentes();
    };
    G.appendChild(d);
  });
}

/* ---------- 2 · configurar ---------- */
async function elegir(f, salaUrl) {
  try { res = await resolverSala(f); }
  catch (e) { toast(e.message); return; }
  fuente = f;
  app = leerApp(keyDe(f)) || appPorDefecto(f, res.S);
  if (salaUrl && !app.salaUrl) app.salaUrl = salaUrl;
  (res.S.plantas || []).forEach(p => { app.modelos[p.id] = app.modelos[p.id] || { tipo: 'referencia' }; });
  guardarApp(app);
  document.querySelectorAll('#fuentes .src').forEach(c => c.setAttribute('aria-current', c.dataset.key === app.key));
  pintarForm(); $('#config').hidden = false; $('#publicar').hidden = false;
  pintarPublicar(); recargarPreview(); pintarApps();
  history.replaceState(null, '', '?app=' + encodeURIComponent(app.key));
  $('#config').scrollIntoView({ behavior: 'smooth' });
}

const OPC = [
  ['referencia', 'Apartamento tipo de referencia (modelo real exportado de Unreal)'],
  ['planta', 'Generado desde la planta de la sala (muros, alcobas, baño)'],
  ['url', 'Mi modelo GLB publicado (link)'],
  ['archivo', 'Subir GLB a este navegador (solo vista previa)']
];
function pintarForm() {
  const S = res.S, c = conteo(S);
  $('#cfg-sub').textContent = `${S.proyecto || 'Proyecto'} · ${(S.pisos || []).length} pisos · ${(S.plantas || []).length} tipologías · ${(S.unidades || []).length} unidades`;
  $('#f-nombre').value = app.nombre || '';
  $('#f-sala').value = app.salaUrl || '';
  $('#f-alto').value = (app.torre && app.torre.altoPiso) || 3;
  $('#f-losa').value = (app.torre && app.torre.losa) || '#ece6dc';
  $('#f-fachada').value = (app.torre && app.torre.fachada) || '#2b2a27';
  const vivo = window.SRNube && SRNube.on(S);
  $('#inv').innerHTML = `<span>🟢 ${c.disponible} disponibles</span><span>🟡 ${c.reservado} reservados</span><span>⚪ ${c.vendido} vendidos</span><span>${vivo ? 'Estados en vivo desde Firebase' : 'Estados del dashboard de la sala'}</span>`;
  const T = $('#tipos'); T.innerHTML = '';
  (S.plantas || []).forEach(p => {
    const m = app.modelos[p.id] || { tipo: 'referencia' };
    const n = (S.pisos || []).filter(x => x.planta === p.id).length;
    const d = document.createElement('div'); d.className = 'tipo';
    d.innerHTML = `<div class="th"><b>${esc(p.nombre || p.id)}</b><span class="muted small">${n} pisos · ${(p.aptos || []).length} aptos por piso</span></div>
      <label class="field">Qué ve el comprador al entrar<select>${OPC.map(([v, t]) => `<option value="${v}"${v === m.tipo ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="field" data-w="url"><span>Link del GLB</span><input type="url" placeholder="https://…/apto-${esc(p.id)}.glb" value="${esc(m.tipo === 'url' ? m.url || '' : '')}"><small>Expórtalo desde Unreal, 3ds Max, Revit o SketchUp a .glb y súbelo a la carpeta modelos/ de este repo.</small></label>
      <label class="field" data-w="archivo"><span>Archivo .glb</span><input type="file" accept=".glb,.gltf,model/gltf-binary"><small>${m.tipo === 'archivo' && m.nombre ? 'Cargado: ' + esc(m.nombre) + '. ' : ''}Solo funciona en este navegador; para compartir usa un link.</small></label>`;
    const sel = d.querySelector('select'), url = d.querySelector('[data-w=url] input'), file = d.querySelector('[data-w=archivo] input');
    const vis = () => { d.querySelector('[data-w=url]').hidden = sel.value !== 'url'; d.querySelector('[data-w=archivo]').hidden = sel.value !== 'archivo'; };
    sel.onchange = () => { app.modelos[p.id] = { tipo: sel.value, url: sel.value === 'url' ? url.value.trim() : undefined, nombre: m.nombre }; vis(); };
    url.onchange = () => { app.modelos[p.id] = { tipo: 'url', url: url.value.trim() }; };
    file.onchange = async () => {
      const f = file.files[0]; if (!f) return;
      if (f.size > 150 * 1024 * 1024) { toast('El archivo pasa de 150 MB. Optimízalo antes (gltf-transform).'); return; }
      await idb.put(app.key + ':' + p.id, f);
      app.modelos[p.id] = { tipo: 'archivo', nombre: f.name };
      guardarApp(app); recargarPreview(); toast('Modelo cargado: ' + f.name);
    };
    vis(); T.appendChild(d);
  });
}
$('#form').onsubmit = e => {
  e.preventDefault();
  app.nombre = $('#f-nombre').value.trim() || res.S.proyecto;
  app.salaUrl = $('#f-sala').value.trim();
  app.torre = { altoPiso: Math.min(6, Math.max(2.4, +$('#f-alto').value || 3)), losa: $('#f-losa').value, fachada: $('#f-fachada').value };
  const malos = Object.entries(app.modelos).filter(([, m]) => m.tipo === 'url' && !/^https?:\/\/.+/.test(m.url || ''));
  if (malos.length) { toast('Falta el link del GLB en una tipología'); return; }
  guardarApp(app);
  $('#saved').textContent = 'Guardado ' + new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  recargarPreview(); pintarPublicar(); pintarApps();
};
function recargarPreview() {
  const L = linkLocal(app);
  $('#pv').src = L + '&embed=1&t=' + Date.now();
  $('#a-abrir').href = L;
}

/* ---------- 3 · publicar y conectar ---------- */
function pintarPublicar() {
  const pub = linkPublico(app);
  const usa = pub || linkLocal(app);
  $('#l-pub').value = usa;
  $('#l-embed').value = `<iframe src="${usa}" style="width:100%;height:640px;border:0;border-radius:14px" allow="fullscreen" title="Recorrido 3D ${app.nombre}"></iframe>`;
  const archivo = Object.values(app.modelos).some(m => m.tipo === 'archivo');
  $('#pub-nota').innerHTML = pub
    ? 'Funciona en cualquier celular o computador.' + (archivo ? ' <b>Ojo:</b> las tipologías con GLB subido al navegador se ven con el modelo de referencia; publícalas por link.' : '')
    : '<b>Este link solo funciona en este navegador</b> porque el proyecto aún vive en el asistente. Publica la sala y pega su link en "Link de la sala de ventas publicada".';
  const actual = (res.S.recorrido || {}).url || '';
  $('#m-conectar').className = 'msg small' + (actual && actual.includes('visor.html') ? ' ok' : '');
  $('#m-conectar').textContent = actual ? (actual.includes('visor.html') ? 'La sala ya apunta a una app 3D de este dashboard.' : 'Hoy la sala apunta a: ' + actual) : 'La sala aún no tiene recorrido 3D.';
}
$('#b-conectar').onclick = async () => {
  const link = linkPublico(app) || linkLocal(app);
  const r = conectarSala(fuente, res, link), M = $('#m-conectar');
  if (r.ok) {
    M.className = 'msg small ok';
    M.innerHTML = 'Listo: guardé el link en ' + esc(r.donde) + '. ' + (fuente.tipo === 'demo' ? '<a href="https://baronaarchitect-collab.github.io/Inicio-bim/visor/renders/sala/" target="_blank" rel="noopener">Abre la sala ↗</a> y verás "Ver recorrido en 3D".' : 'Al generar el ZIP de la sala ya va incluido.');
    res = await resolverSala(fuente);
  } else {
    M.className = 'msg small warn';
    M.textContent = r.motivo;
    if (r.manual) { try { await navigator.clipboard.writeText(link); M.textContent += ' Ya copié el link.'; } catch (e) {} }
  }
};
$('#b-desconectar').onclick = async () => { desconectarSala(fuente, res); res = await resolverSala(fuente); pintarPublicar(); toast('Quitamos el recorrido 3D de la sala en este navegador'); };
document.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => {
  const i = $('#' + b.dataset.copy); i.select();
  try { await navigator.clipboard.writeText(i.value); toast('Copiado'); } catch (e) { document.execCommand('copy'); toast('Copiado'); }
});

/* ---------- arranque ---------- */
(async () => {
  try { await cargarMotor(); }
  catch (e) { $('#fuentes').innerHTML = '<p class="muted">No se pudo cargar el motor de la sala de ventas. Revisa tu conexión.</p>'; return; }
  await pintarFuentes(); pintarApps();
  const k = new URLSearchParams(location.search).get('app'), a = k && leerApp(k);
  if (a) elegir(a.fuente);
})();
