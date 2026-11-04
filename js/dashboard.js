/*!
 * Dashboard: crea la app 3D de una sala de ventas, sube el modelo del edificio y de cada tipología,
 * configura las preguntas, la agenda y el CRM, la conecta con la sala y la publica.
 */
import {
  cargarMotor, resolverSala, proyectosLocales, datosDeSala, keyDe, leerApp, guardarApp, borrarApp, listaApps, appPorDefecto, completarApp,
  linkLocal, linkPublico, conectarSala, desconectarSala, idb, esc, ls, baseApp, ESPACIOS, PREGUNTAS
} from './fuente.js';
import { FORMATOS, formatoDe } from './modelos.js';
import { enviarCita } from './crm.js';

const $ = s => document.querySelector(s);
let fuente = null, res = null, app = null;
let tt; function toast(m) { const el = $('#toast'); el.textContent = m; el.hidden = false; clearTimeout(tt); tt = setTimeout(() => { el.hidden = true; }, 3400); }
function conteo(S) { const c = { disponible: 0, reservado: 0, vendido: 0 }; (S.unidades || []).forEach(u => { c[u.estado] = (c[u.estado] || 0) + 1; }); return c; }
const slug = s => String(s || 'proyecto').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'proyecto';
const MB = b => (b / 1048576).toFixed(1).replace('.', ',') + ' MB';

/* ---------- 1 · fuentes ---------- */
async function pintarFuentes() {
  const G = $('#fuentes'); G.innerHTML = '';
  let demo = null;
  try { demo = (await resolverSala({ tipo: 'demo' })).S; } catch (e) { console.warn(e); }
  const cards = [];
  cards.push(card({ tipo: 'demo' }, 'Proyecto demo', demo ? demo.proyecto : 'Torre Alborada', demo ? [demo.empresa, demo.ciudad].filter(Boolean).join(' · ') : 'Sala publicada en Inicio-bim',
    demo ? [(demo.pisos || []).length + ' pisos', (demo.unidades || []).length + ' unidades', conteo(demo).disponible + ' disponibles'] : []));
  proyectosLocales().forEach(p => cards.push(card({ tipo: 'local', id: p.id }, 'Mi proyecto · este navegador', p.proyecto, p.empresa,
    [p.pisos + ' pisos', p.unidades + ' unidades', 'editado ' + new Date(p.actualizado).toLocaleDateString('es-CO')])));
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
      if (!confirm('¿Eliminar la app 3D «' + a.nombre + '» y sus modelos subidos? La sala de ventas no se toca.')) return;
      await borrarApp(a.key); if (app && app.key === a.key) { ['#config', '#crm', '#publicar'].forEach(s => { $(s).hidden = true; }); app = null; }
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
  app = completarApp(leerApp(keyDe(f)) || appPorDefecto(f, res.S));
  if (salaUrl && !app.salaUrl) app.salaUrl = salaUrl;
  (res.S.plantas || []).forEach(p => { app.modelos[p.id] = app.modelos[p.id] || { tipo: 'auto' }; });
  guardarApp(app);
  document.querySelectorAll('#fuentes .src').forEach(c => c.setAttribute('aria-current', c.dataset.key === app.key));
  pintarForm(); pintarCRM();
  ['#config', '#crm', '#publicar'].forEach(s => { $(s).hidden = false; });
  pintarPublicar(); recargarPreview(); pintarApps();
  history.replaceState(null, '', '?app=' + encodeURIComponent(app.key));
  $('#config').scrollIntoView({ behavior: 'smooth' });
}

const OPC = [
  ['auto', 'Automático: el apto del IFC del edificio o el modelo que puso la sala'],
  ['referencia', 'Apartamento tipo de referencia (modelo real de Unreal)'],
  ['planta', 'Generado desde la planta de la sala'],
  ['archivo', 'Mi modelo: subir archivo (IFC, GLB, OBJ, FBX)'],
  ['url', 'Mi modelo: link publicado']
];
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const pqTexto = L => (L || []).map(p => p.q + (p.op && p.op.length ? ' = ' + p.op.join(' / ') : '')).join('\n');
function pqLeer(t) {
  return String(t || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const [q, o] = l.split('='); return { q: q.trim(), op: (o || '').split('/').map(x => x.trim()).filter(Boolean) };
  });
}

function pintarForm() {
  const S = res.S, c = conteo(S);
  $('#cfg-sub').textContent = `${S.proyecto || 'Proyecto'} · ${(S.pisos || []).length} pisos · ${(S.plantas || []).length} tipologías · ${(S.unidades || []).length} unidades`;
  $('#f-nombre').value = app.nombre || '';
  $('#f-sala').value = app.salaUrl || '';
  $('#f-alto').value = app.torre.altoPiso || 3;
  $('#f-losa').value = app.torre.losa || '#ece6dc';
  $('#f-fachada').value = app.torre.fachada || '#2b2a27';
  const vivo = window.SRNube && SRNube.on(S);
  $('#inv').innerHTML = `<span>🟢 ${c.disponible} disponibles</span><span>🟡 ${c.reservado} reservados</span><span>⚪ ${c.vendido} vendidos</span><span>${vivo ? 'Estados en vivo desde Firebase' : 'Estados del dashboard de la sala'}</span>`;

  // edificio
  const E = app.edificio;
  $('#f-ed-tipo').value = E.tipo || 'ninguno';
  $('#f-ed-url').value = E.tipo === 'url' ? E.url || '' : '';
  $('#f-ed-nota').textContent = E.tipo === 'archivo' && E.nombre ? `Cargado: ${E.nombre}${E.peso ? ' (' + MB(E.peso) + ')' : ''}. Solo en este navegador hasta que lo publiques.` : 'Un IFC grande puede tardar en abrir en celulares; si puedes, publica una versión GLB.';
  visEd();
  const D = E.aptos;
  $('#ed-estado').innerHTML = E.tipo === 'ninguno' ? '' : D && D.conectados
    ? `<b class="ok-t">✓ ${D.conectados} de ${D.total} apartamentos</b> del IFC conectados con la sala (por ${esc(D.como || '')}). Se recorren desde el modelo del edificio.`
    : (E.ajuste ? `Encajado · escala ${E.ajuste.esc} · giro ${(E.ajuste.rot || 0)}°. ` : '') + 'Si el IFC trae espacios (rooms), al abrir "Encajar" se detectan los apartamentos.';

  // tipologías
  const T = $('#tipos'); T.innerHTML = '';
  (S.plantas || []).forEach(p => {
    const m = app.modelos[p.id] = app.modelos[p.id] || { tipo: 'auto' };
    const n = (S.pisos || []).filter(x => x.planta === p.id).length;
    const nv = m.vistas ? Object.keys(m.vistas).length : 0;
    const propio = m.tipo === 'url' || m.tipo === 'archivo';
    const d = document.createElement('div'); d.className = 'tipo';
    d.innerHTML = `<div class="th"><b>${esc(p.nombre || p.id)}</b><span class="muted small">${n} pisos · ${(p.aptos || []).length} aptos por piso</span></div>
      <label class="field">Modelo que se abre al entrar<select>${OPC.map(([v, t]) => `<option value="${v}"${v === m.tipo ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="field" data-w="url"><span>Link del modelo (.ifc, .glb, .obj, .fbx)</span><input type="url" placeholder="https://…/apto-${esc(p.id)}.glb" value="${esc(m.tipo === 'url' ? m.url || '' : '')}"></label>
      <label class="field" data-w="archivo"><span>Archivo del apartamento</span><input type="file" accept="${FORMATOS}"><small>${m.tipo === 'archivo' && m.nombre ? 'Cargado: ' + esc(m.nombre) + '. ' : ''}Exporta solo el apartamento (Revit: vista 3D con caja de sección → IFC; Unreal/3ds Max/SketchUp → GLB).</small></label>
      <div class="actions" data-w="propio"><button class="btn ghost sm" type="button" data-rec>Configurar recorrido (preguntas)</button>
        <span class="estado-rec ${nv ? 'ok' : 'falta'}">${nv ? '✓ ' + nv + ' espacios ubicados' : 'Falta: dinos dónde está cada espacio'}</span></div>
      <div class="actions" data-w="incluido"><button class="btn ghost sm" type="button" data-ver>Ver este apartamento</button><span class="muted small">${m.tipo === 'auto' ? autoTexto(p) : 'El recorrido ya viene incluido.'}</span></div>`;
    const sel = d.querySelector('select'), url = d.querySelector('[data-w=url] input'), file = d.querySelector('[data-w=archivo] input');
    const vis = () => {
      const t = sel.value;
      d.querySelector('[data-w=url]').hidden = t !== 'url'; d.querySelector('[data-w=archivo]').hidden = t !== 'archivo';
      d.querySelector('[data-w=propio]').hidden = !(t === 'url' || t === 'archivo'); d.querySelector('[data-w=incluido]').hidden = t === 'url' || t === 'archivo';
    };
    sel.onchange = () => { app.modelos[p.id] = { tipo: sel.value, url: sel.value === 'url' ? url.value.trim() : undefined, nombre: sel.value === 'archivo' ? m.nombre : undefined }; guardarApp(app); vis(); pintarForm(); };
    url.onchange = () => { const v = url.value.trim(); app.modelos[p.id] = { tipo: 'url', url: v, nombre: v.split('/').pop() }; guardarApp(app); pintarForm(); };
    file.onchange = async () => {
      const f = file.files[0]; if (!f) return;
      if (f.size > 200 * 1024 * 1024) { toast('El archivo pasa de 200 MB. Expórtalo solo con el apartamento.'); return; }
      await idb.put(app.key + ':' + p.id, f);
      app.modelos[p.id] = { tipo: 'archivo', nombre: f.name, formato: formatoDe(f.name), peso: f.size };
      guardarApp(app); pintarForm(); toast('Modelo cargado: ' + f.name + '. Ahora configura su recorrido.');
      abrirHerramienta('recorrido', p.id, 'Recorrido de ' + (p.nombre || p.id));
    };
    d.querySelector('[data-rec]').onclick = () => {
      if (sel.value === 'url' && !/^https?:\/\//.test(url.value.trim())) { toast('Pega primero el link del modelo'); return; }
      abrirHerramienta('recorrido', p.id, 'Recorrido de ' + (p.nombre || p.id));
    };
    d.querySelector('[data-ver]').onclick = () => {
      if (sel.value !== 'auto') return abrirHerramienta('recorrido', p.id, (p.nombre || p.id));
      // automático: se entra a un apto real de esa planta, con el modelo del edificio cargado
      const u = (S.unidades || []).find(x => (S.pisos || []).some(q => q.id === x.piso && q.planta === p.id));
      abrirHerramienta('entrar', u ? u.id : '', (p.nombre || p.id));
    };
    vis(); T.appendChild(d);
  });

  // preguntas
  const P = app.preguntas;
  $('#f-perfil').value = P.perfil && P.perfil.q ? pqTexto([P.perfil]) : '';
  $('#preguntas').innerHTML = ESPACIOS.map(([k, n]) => `<label class="pq">${n}<textarea data-pq="${k}" rows="2" placeholder="Pregunta = opción / opción">${esc(pqTexto(P.espacios[k]))}</textarea></label>`).join('')
    + '<button class="btn ghost sm" type="button" id="b-pq-def">Volver a las preguntas sugeridas</button>';
  $('#b-pq-def').onclick = () => { if (confirm('¿Reemplazar tus preguntas por las sugeridas?')) { app.preguntas = JSON.parse(JSON.stringify(PREGUNTAS)); guardarApp(app); pintarForm(); } };

  // agenda
  const A = app.agenda;
  $('#f-dias').innerHTML = DIAS.map((d, i) => `<label><input type="checkbox" value="${i}"${A.dias.includes(i) ? ' checked' : ''}> ${d}</label>`).join('');
  $('#f-desde').value = A.desde; $('#f-hasta').value = A.hasta; $('#f-cada').value = String(A.cada);
  $('#f-asesor').value = A.asesor || ''; $('#f-wa').value = A.whatsapp || S.whatsapp || ''; $('#f-dir').value = A.direccion || '';
  $('#f-mod').checked = !!A.modalidad;
}
function visEd() {
  const t = $('#f-ed-tipo').value;
  document.querySelectorAll('[data-ed]').forEach(el => { el.hidden = el.dataset.ed === 'modelo' ? t === 'ninguno' : el.dataset.ed !== t; });
}

/* todo cambio del formulario se guarda solo */
function leerForm() {
  app.nombre = $('#f-nombre').value.trim() || res.S.proyecto;
  app.salaUrl = $('#f-sala').value.trim();
  app.torre.altoPiso = Math.min(6, Math.max(2.4, +$('#f-alto').value || 3));
  app.torre.losa = $('#f-losa').value; app.torre.fachada = $('#f-fachada').value;
  const pf = pqLeer($('#f-perfil').value)[0];
  app.preguntas.perfil = pf || { q: '', op: [] };
  document.querySelectorAll('[data-pq]').forEach(t => { app.preguntas.espacios[t.dataset.pq] = pqLeer(t.value); });
  const A = app.agenda;
  A.dias = [...document.querySelectorAll('#f-dias input:checked')].map(i => +i.value);
  A.desde = $('#f-desde').value || '09:00'; A.hasta = $('#f-hasta').value || '18:00'; A.cada = +$('#f-cada').value || 60;
  A.asesor = $('#f-asesor').value.trim(); A.whatsapp = $('#f-wa').value.replace(/[^\d]/g, ''); A.direccion = $('#f-dir').value.trim(); A.modalidad = $('#f-mod').checked;
}
function guardado() { $('#saved').textContent = 'Guardado ' + new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }); }
$('#form').addEventListener('change', e => {
  if (e.target.type === 'file' || e.target.closest('.tipo') || e.target.closest('[data-ed]') || e.target.id === 'f-ed-tipo') return;
  leerForm(); guardarApp(app); guardado(); pintarPublicar();
});
$('#form').onsubmit = e => {
  e.preventDefault(); leerForm();
  const malos = Object.entries(app.modelos).filter(([, m]) => m.tipo === 'url' && !/^https?:\/\/.+/.test(m.url || ''));
  if (malos.length) { toast('Falta el link del modelo en una tipología'); return; }
  if (!app.agenda.dias.length) { toast('Elige al menos un día de atención'); return; }
  guardarApp(app); guardado(); recargarPreview(); pintarPublicar(); pintarApps();
};

/* modelo del edificio */
$('#f-ed-tipo').onchange = () => {
  const t = $('#f-ed-tipo').value;
  if (t === 'ninguno') app.edificio = { tipo: 'ninguno', volumenes: app.edificio.volumenes };
  else if (t !== app.edificio.tipo) app.edificio = { tipo: t, volumenes: app.edificio.volumenes || 'siempre' };
  guardarApp(app); visEd(); pintarForm(); recargarPreview(); pintarPublicar();
};
$('#f-ed-url').onchange = () => {
  const v = $('#f-ed-url').value.trim(); if (!/^https?:\/\//.test(v)) { toast('Pega el link completo del modelo'); return; }
  app.edificio = { tipo: 'url', url: v, nombre: v.split('/').pop(), formato: formatoDe(v), volumenes: app.edificio.volumenes || 'siempre' };
  guardarApp(app); pintarForm(); abrirHerramienta('ajustar', null, 'Encajar el modelo del edificio');
};
$('#f-ed-file').onchange = async () => {
  const f = $('#f-ed-file').files[0]; if (!f) return;
  if (f.size > 300 * 1024 * 1024) { toast('El archivo pasa de 300 MB. Exporta una versión más liviana.'); return; }
  await idb.put(app.key + ':edificio', f);
  app.edificio = { tipo: 'archivo', nombre: f.name, formato: formatoDe(f.name), peso: f.size, volumenes: app.edificio.volumenes || 'siempre' };
  guardarApp(app); pintarForm(); toast('Modelo cargado: ' + f.name);
  abrirHerramienta('ajustar', null, 'Encajar el modelo del edificio');
};
$('#b-encajar').onclick = () => abrirHerramienta('ajustar', null, 'Encajar el modelo del edificio');

/* herramientas 3D a pantalla completa (encajar edificio · preguntas del recorrido) */
function autoTexto(p) {
  const D = app.edificio.aptos, S = res.S;
  const us = (S.unidades || []).filter(u => (S.pisos || []).some(q => q.id === u.piso && q.planta === p.id));
  const conIFC = D ? us.filter(u => D.unidades && D.unidades[u.id]).length : 0;
  const sala = (p.aptos || []).filter(a => a.recorrido).length || (p.recorrido ? (p.aptos || []).length : 0);
  if (conIFC) return `${conIFC} de ${us.length} aptos se recorren desde el IFC del edificio.`;
  if (sala) return 'Usa el recorrido que la sala le puso a estos aptos.';
  return 'Sin IFC con espacios ni modelo en la sala: abre el apto de referencia.';
}
function abrirHerramienta(tipo, planta, titulo) {
  const L = linkLocal(app) + (tipo === 'ajustar' ? '&ajustar=1' : tipo === 'entrar' ? '&apto=' + encodeURIComponent(planta) + '&entrar=1' : '&recorrido=' + encodeURIComponent(planta)) + '&t=' + Date.now();
  $('#tool-t').textContent = titulo; $('#tool-f').src = L; $('#tool').hidden = false;
}
function cerrarHerramienta() {
  $('#tool').hidden = true; $('#tool-f').src = 'about:blank';
  app = completarApp(leerApp(app.key) || app); pintarForm(); recargarPreview(); pintarPublicar();
}
$('#tool-x').onclick = cerrarHerramienta;
addEventListener('message', e => {
  if (e.origin !== location.origin || !e.data || e.data.tipo !== 'lc3d-guardado' || !app) return;
  app = completarApp(leerApp(app.key) || app); pintarForm(); pintarPublicar(); guardado();
});
addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#tool').hidden) cerrarHerramienta(); });

function recargarPreview() {
  const L = linkLocal(app);
  $('#pv').src = L + '&embed=1&t=' + Date.now();
  $('#a-abrir').href = L;
}

/* ---------- 3 · CRM ---------- */
function pintarCRM() {
  const C = app.crm;
  $('#c-lc').checked = !!C.lifecity; $('#c-wa').checked = !!C.whatsapp;
  $('#c-hs-p').value = C.hubspot.portalId || ''; $('#c-hs-f').value = C.hubspot.formId || '';
  $('#c-wh').value = C.webhook.url || '';
}
$('#crm').addEventListener('change', () => {
  const C = app.crm;
  C.lifecity = $('#c-lc').checked; C.whatsapp = $('#c-wa').checked;
  C.hubspot = { portalId: $('#c-hs-p').value.trim(), formId: $('#c-hs-f').value.trim() };
  const wh = $('#c-wh').value.trim();
  if (wh && !/^https:\/\//.test(wh)) toast('El webhook debe empezar por https://');
  C.webhook = { url: wh };
  guardarApp(app); pintarPublicar(); toast('Conexiones guardadas');
});
$('#b-prueba').onclick = async () => {
  const M = $('#m-prueba'); M.className = 'small'; M.textContent = 'Enviando…';
  const u = (res.S.unidades || []).find(x => x.estado === 'disponible') || {};
  const p = {
    origen: 'App 3D sala de ventas (PRUEBA)', app: app.nombre, proyecto: res.S.proyecto || app.nombre, link: linkLocal(app),
    cliente: { nombre: 'PRUEBA Dashboard App 3D', celular: '3000000000', correo: '' },
    cita: { fecha: new Date().toISOString().slice(0, 10), hora: '10:00', iso: new Date().toISOString(), fechaTexto: 'hoy (prueba)', modalidad: 'Presencial', nota: 'Cita de prueba enviada desde el dashboard', asesor: app.agenda.asesor },
    unidad: { id: u.id || '—', piso: u.piso || '', area: u.area || 0, alcobas: u.alcobas || 0, banos: u.banos || 0, precio: u.precio || 0, precioTexto: window.SR ? SR.money(u.precio || 0, res.S.moneda || 'COP') : '', estado: u.estado || '' },
    recorrido: { inicio: new Date().toISOString(), minutos: 6, perfil: 'Para vivir', unidadesVistas: [u.id || '—'], espacios: [{ unidad: u.id, espacio: 'Sala-comedor' }, { unidad: u.id, espacio: 'Cocina' }],
      respuestas: [{ unidad: u.id, espacio: 'Sala-comedor', pregunta: '¿Cuántas personas se sentarían normalmente en la sala?', respuesta: '3 a 4' }],
      medidas: [{ unidad: u.id, espacio: 'Sala-comedor', metros: 3.55, mueble: 'Sofá', necesita: 2.2, cabe: true }], acabados: [], notas: [{ unidad: u.id, texto: 'Esto es una prueba' }] }
  };
  const { canales } = await enviarCita(app, p);
  if (!canales.length) { M.className = 'small no'; M.textContent = 'No hay ningún CRM activo: activa Life City, HubSpot o un webhook.'; return; }
  const ok = canales.filter(c => c.ok).length;
  M.className = 'small ' + (ok === canales.length ? 'ok' : 'no');
  M.textContent = canales.map(c => (c.ok ? '✓ ' : '✗ ') + c.canal + (c.ok ? '' : ' (' + c.error + ')')).join(' · ');
};

/* ---------- 4 · publicar y conectar ---------- */
function carpeta() { return 'apps/' + slug(app.nombre || res.S.proyecto) + '/'; }
function pintarPublicar() {
  const pub = linkPublico(app);
  const usa = pub || linkLocal(app);
  $('#l-pub').value = usa;
  $('#l-embed').value = `<iframe src="${usa}" style="width:100%;height:640px;border:0;border-radius:14px" allow="fullscreen" title="Recorrido 3D ${app.nombre}"></iframe>`;
  $('#l-cfg').value = baseApp() + 'visor.html?cfg=' + carpeta() + 'app.json';
  const subidos = Object.values(app.modelos).some(m => m.tipo === 'archivo') || app.edificio.tipo === 'archivo';
  $('#pub-nota').innerHTML = pub
    ? 'Funciona en cualquier celular o computador.' + (subidos ? ' <b>Ojo:</b> los modelos subidos al navegador no viajan en este link; usa "Publicar como carpeta".' : '')
    : '<b>Este link solo funciona en este navegador</b> porque el proyecto aún vive en el asistente. Usa "Publicar como carpeta" o pega el link de la sala publicada.';
  const actual = (res.S.recorrido || {}).url || '';
  $('#m-conectar').className = 'msg small' + (actual && actual.includes('visor.html') ? ' ok' : '');
  $('#m-conectar').textContent = actual ? (actual.includes('visor.html') ? 'La sala ya apunta a una app 3D de este dashboard.' : 'Hoy la sala apunta a: ' + actual) : 'La sala aún no tiene recorrido 3D.';
}
$('#b-conectar').onclick = async () => {
  const subidos = Object.values(app.modelos).some(m => m.tipo === 'archivo') || app.edificio.tipo === 'archivo';
  const link = subidos ? $('#l-cfg').value : (linkPublico(app) || linkLocal(app));
  const r = conectarSala(fuente, res, link), M = $('#m-conectar');
  if (r.ok) {
    M.className = 'msg small ok';
    M.innerHTML = 'Listo: guardé el link en ' + esc(r.donde) + '. ' + (fuente.tipo === 'demo' ? '<a href="https://baronaarchitect-collab.github.io/Inicio-bim/visor/renders/sala/" target="_blank" rel="noopener">Abre la sala ↗</a> y verás "Ver recorrido en 3D".' : 'Al generar el ZIP de la sala ya va incluido.') + (subidos ? ' Usa el link de la carpeta: sube primero el ZIP a apps/.' : '');
    res = await resolverSala(fuente);
  } else {
    M.className = 'msg small warn'; M.textContent = r.motivo;
    if (r.manual) { try { await navigator.clipboard.writeText(link); M.textContent += ' Ya copié el link.'; } catch (e) {} }
  }
};
$('#b-desconectar').onclick = async () => { desconectarSala(fuente, res); res = await resolverSala(fuente); pintarPublicar(); toast('Quitamos el recorrido 3D de la sala en este navegador'); };
document.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => {
  const i = $('#' + b.dataset.copy); i.select();
  try { await navigator.clipboard.writeText(i.value); toast('Copiado'); } catch (e) { document.execCommand('copy'); toast('Copiado'); }
});

/* carpeta lista para subir al repo: app.json + sala.json (si hace falta) + modelos/ */
$('#b-zip').onclick = async () => {
  if (!window.JSZip) { toast('No cargó el empaquetador. Revisa tu conexión.'); return; }
  const b = $('#b-zip'); b.disabled = true; b.textContent = 'Armando la carpeta…';
  try {
    const zip = new JSZip(), dir = carpeta(), C = JSON.parse(JSON.stringify(app));
    delete C.key; delete C.creada; delete C.actualizada;
    if (fuente.tipo === 'local') {
      zip.file(dir + 'sala.json', JSON.stringify(ls('lc:renders:p:' + fuente.id) || res.S, null, 1));
      C.fuente = { tipo: 'json', url: 'sala.json' };
    }
    const faltan = [];
    for (const [pid, m] of Object.entries(C.modelos || {})) {
      if (m.tipo !== 'archivo') continue;
      const blob = await idb.get(app.key + ':' + pid);
      if (!blob) { faltan.push(m.nombre || pid); m.tipo = 'referencia'; continue; }
      const f = 'modelos/' + slug(pid) + '.' + formatoDe(m.nombre);
      zip.file(dir + f, blob); m.tipo = 'url'; m.url = f;
    }
    if (C.edificio && C.edificio.tipo === 'archivo') {
      const blob = await idb.get(app.key + ':edificio');
      if (blob) { const f = 'modelos/edificio.' + formatoDe(C.edificio.nombre); zip.file(dir + f, blob); C.edificio.tipo = 'url'; C.edificio.url = f; }
      else { faltan.push(C.edificio.nombre || 'edificio'); C.edificio = { tipo: 'ninguno' }; }
    }
    zip.file(dir + 'app.json', JSON.stringify(C, null, 1));
    zip.file(dir + 'LEEME.txt', [
      'App 3D · ' + (app.nombre || ''), '',
      '1. Sube la carpeta "' + dir + '" a la raíz del repo sala-3d-apartamentos (GitHub → Add file → Upload files, arrastra la carpeta apps).',
      '2. Espera 1 minuto a que GitHub Pages publique.',
      '3. Link para compradores y para la sala de ventas:', '   ' + $('#l-cfg').value, '',
      'Los modelos de más de 100 MB no caben en GitHub: exporta una versión más liviana o usa un link externo.'
    ].join('\n'));
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = slug(app.nombre) + '-app3d.zip'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(faltan.length ? 'Ojo: no encontré en este navegador ' + faltan.join(', ') : 'Carpeta lista: súbela a apps/ en el repo');
  } catch (e) { console.error(e); toast('No se pudo armar la carpeta: ' + e.message); }
  b.disabled = false; b.textContent = 'Descargar carpeta (.zip)';
};

/* ---------- arranque ---------- */
(async () => {
  try { await cargarMotor(); }
  catch (e) { $('#fuentes').innerHTML = '<p class="muted">No se pudo cargar el motor de la sala de ventas. Revisa tu conexión.</p>'; return; }
  await pintarFuentes(); pintarApps();
  const k = new URLSearchParams(location.search).get('app'), a = k && leerApp(k);
  if (a) elegir(a.fuente);
})();
