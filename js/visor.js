/*!
 * Life City · App 3D de la sala de ventas
 * Edificio con el inventario de la sala (en vivo), opcionalmente encima del modelo real del edificio (IFC/GLB)
 * → clic en una unidad disponible → entrar al apartamento (modelo de su tipología) → caminar, medir, probar acabados,
 * chatear con el asistente → agendar la cita: la sala recibe el recorrido y las respuestas (CRM, HubSpot, webhook, WhatsApp).
 *
 *   visor.html                     → demo Torre Alborada
 *   visor.html?app=<key>           → app creada en el dashboard (este navegador)
 *   visor.html?c=<config>          → app publicada (la config viaja en el link)
 *   visor.html?cfg=<carpeta/app.json> → app publicada como carpeta en el repo (con sus modelos)
 *   …&apto=1203 [&entrar=1]        → abre con esa unidad elegida (y entra)
 *   …&ajustar=1                    → (dashboard) encajar el modelo del edificio con los volúmenes de la sala
 *   …&recorrido=<plantaId>         → (dashboard) preguntas para configurar el recorrido de una tipología
 *   visor.html?sala=<link de la sala>&apto=302&entrar=1[&modelo=<url>]
 *                                  → desde la sala de renders: entra al apto con su modelo (o el automático)
 * Con un IFC del edificio que trae espacios (rooms), los apartamentos se detectan solos y se conectan con las unidades de la sala.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { construirTorre } from './torre.js';
import { cargarInterior } from './interior.js';
import { cargarModelo, limpiar } from './modelos.js';
import { detectarAptos, reasignar } from './aptos.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { resolverSala, escucharEstados, leerApp, guardarApp, unb64, idb, esc, DEMO_SALA, completarApp, cargarAppJson, claveEspacio, datosDeSala, leerSalaDB, appDeSala, listaApps } from './fuente.js';
import { enviarCita, resumenTexto, linkWhatsApp } from './crm.js';

const $ = s => document.querySelector(s);
const qs = new URLSearchParams(location.search);
if (qs.has('embed')) document.body.classList.add('embed');
const ESTADO = { disponible: 'Disponible', reservado: 'Reservado', vendido: 'Vendido' };
const m2 = v => (+v || 0).toLocaleString('es-CO', { maximumFractionDigits: 1 });
const mts = v => (+v).toFixed(2).replace('.', ',');
const avisar = () => { try { parent !== window && parent.postMessage({ tipo: 'lc3d-guardado' }, location.origin); } catch (e) {} };

/* ---------- escena ---------- */
const cv = $('#cv');
const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, preserveDrawingBuffer: true });
renderer.localClippingEnabled = true; // recorte del apartamento dentro del modelo del edificio
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
const FONDO_EXT = new THREE.Color('#1c1e1b'), FONDO_INT = new THREE.Color('#d9d3c8');
scene.background = FONDO_EXT;
scene.fog = new THREE.Fog(FONDO_EXT, 160, 420);
const cam = new THREE.PerspectiveCamera(40, 1, 0.5, 3000);
const controls = new OrbitControls(cam, cv);
controls.enableDamping = true; controls.dampingFactor = 0.08;
scene.add(new THREE.HemisphereLight(0xfff6e8, 0x30332c, 0.55));
const sol = new THREE.DirectionalLight(0xfff0dc, 1.6);
sol.position.set(60, 110, 70); sol.castShadow = true; sol.shadow.mapSize.set(2048, 2048);
Object.assign(sol.shadow.camera, { left: -70, right: 70, top: 90, bottom: -20, near: 10, far: 400 });
scene.add(sol);
const suelo = new THREE.Mesh(new THREE.CircleGeometry(400, 64), new THREE.MeshStandardMaterial({ color: '#262823', roughness: 1 }));
suelo.rotation.x = -Math.PI / 2; suelo.position.y = -0.02; suelo.receiveShadow = true; scene.add(suelo);
const grid = new THREE.GridHelper(240, 48, 0x3a3c36, 0x2e302b); grid.position.y = 0.0; scene.add(grid);

function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

/* ---------- utilidades ---------- */
function tween(ms, fn) {
  return new Promise(r => {
    const t0 = performance.now();
    (function f() {
      // en una pestaña oculta requestAnimationFrame se pausa: termina la animación de una vez
      const k = document.hidden ? 1 : Math.min(1, (performance.now() - t0) / ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      fn(e); k < 1 ? requestAnimationFrame(f) : r();
    })();
  });
}
function volar(pos, target, ms = 900) {
  const p0 = cam.position.clone(), t0 = controls.target.clone();
  return tween(ms, e => { cam.position.lerpVectors(p0, pos, e); controls.target.lerpVectors(t0, target, e); });
}
let tt; function toast(m) { const el = $('#toast'); el.textContent = m; el.hidden = false; clearTimeout(tt); tt = setTimeout(() => { el.hidden = true; }, 3400); }
const hint = t => { $('#hint').textContent = t; };
const ray = new THREE.Raycaster();
function ndc(e) { const r = cv.getBoundingClientRect(); return new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); }
const precioDe = u => window.SR ? SR.money(u.precio, S.moneda || 'COP') : '$' + (+u.precio || 0).toLocaleString('es-CO');

/* ---------- app ---------- */
let app = null, base = location.href, editable = false;
try {
  if (qs.get('cfg')) ({ app, base } = await cargarAppJson(qs.get('cfg')));
  else if (qs.get('c')) app = unb64(qs.get('c'));
  else if (qs.get('app')) { app = leerApp(qs.get('app')); editable = !!app; }
  else if (qs.get('sala')) {
    // abierto desde la sala de renders: si este navegador ya tiene la app 3D de esa sala se usa; si no, la sala sola
    const salaUrl = new URL(qs.get('sala'), location.href).href;
    app = appDeSala(salaUrl) || { fuente: { tipo: 'url', datos: datosDeSala(salaUrl) }, salaUrl, modelos: {} };
  }
  else if (qs.get('local')) {
    // vista previa del asistente de la sala: el proyecto vive en este navegador (mismo origen en GitHub Pages)
    const id = qs.get('local');
    app = listaApps().find(x => x.fuente && x.fuente.tipo === 'local' && x.fuente.id === id) || { fuente: { tipo: 'local', id }, salaUrl: '', modelos: {} };
  }
} catch (e) { console.warn(e); }
if (!app) app = { fuente: { tipo: 'demo' }, salaUrl: DEMO_SALA, modelos: {} };
completarApp(app);
const aptoInicial = qs.get('apto') || (location.hash.match(/apto=([^&]+)/) || [])[1];

let S, T, modo = 'ext', sel = null, hover = null, filtro = 'disponible';
let modeloEd = null; // {cont, off, raw, r}

async function main() {
  let res;
  try { res = await resolverSala(app.fuente); }
  catch (e) { $('#ltxt').textContent = 'No se pudo cargar la sala de ventas: ' + e.message; $('.spin').hidden = true; return; }
  S = res.S;
  document.title = (app.nombre || S.proyecto || 'Sala de ventas') + ' · Recorrido 3D';
  $('#t-proy').textContent = app.nombre || S.proyecto || 'Sala de ventas';
  $('#t-sub').textContent = [S.empresa, S.ciudad].filter(Boolean).join(' · ') || 'Recorrido 3D';
  // abierto desde la sala (encima de ella): "Renders y plantas" la cierra con el botón de la sala, no se navega adentro
  const dentroDeSala = (qs.has('sala') || qs.has('local')) && qs.has('embed');
  if (app.salaUrl && !dentroDeSala) { $('#a-sala').href = app.salaUrl; $('#a-sala').hidden = false; $('#a-renders').href = app.salaUrl; $('#a-renders').hidden = false; }

  if (qs.get('recorrido') && editable) { await asistenteRecorrido(qs.get('recorrido')); return; }

  T = construirTorre(S, app.torre);
  scene.add(T.group);
  await cargarEdificio().catch(e => { console.warn(e); toast('No se pudo cargar el modelo del edificio: ' + e.message); });
  vistaExterior(false);
  dibujarLista();
  escucharEstados(app.fuente, S, res.overlayKey, () => {
    T.refrescar(sel, hover); dibujarLista(); if (sel) dibujarCard();
    toast('Inventario actualizado desde la sala de ventas');
  });
  $('#loading').hidden = true;
  if (qs.get('ajustar') && editable) panelAjuste();
  else if (aptoInicial) {
    const m = T.unidades.find(x => String(x.userData.unidad.id) === String(aptoInicial));
    if (m) { seleccionar(m); if (qs.get('entrar') === '1') entrar(m); }
  }
}

/* ---------- modelo real del edificio ---------- */
async function cargarEdificio() {
  const E = app.edificio; if (!E || !E.tipo || E.tipo === 'ninguno') return;
  let src;
  if (E.tipo === 'archivo') {
    const blob = app.key ? await idb.get(app.key + ':edificio') : null;
    if (!blob) { toast('El modelo del edificio está en otro navegador; publícalo por link.'); return; }
    src = { blob, nombre: E.nombre };
  } else src = { url: new URL(E.url, base).href, nombre: E.nombre || E.url };
  $('#ltxt').textContent = 'Cargando el modelo del edificio' + (/\.ifc/i.test(src.nombre || '') ? ' (IFC)' : '') + '…';
  const r = await cargarModelo(src); limpiar(r.scene);
  r.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const raw = new THREE.Box3().setFromObject(r.scene);
  const off = new THREE.Group(), cont = new THREE.Group(); off.add(r.scene); cont.add(off); cont.name = 'modeloEdificio';
  T.group.add(cont);
  modeloEd = { cont, off, raw, r, vols: [] };
  if (!E.ajuste) E.ajuste = autoAjuste();
  // apartamentos a partir de los espacios (rooms) del IFC, conectados con las unidades de la sala
  if ((r.espacios || []).length && !(E.aptos && E.aptos.manual)) {
    E.aptos = detectarAptos(r.espacios, S);
    console.info('Apartamentos del IFC:', E.aptos.conectados, 'de', E.aptos.total, 'por', E.aptos.como);
  }
  aplicarAjuste();
  volumenesIFC();
  T.modoModelo(true, E.volumenes); T.refrescar(sel, hover);
}
/* cada unidad de la sala toma la forma de sus espacios en el IFC (y se mueve con el modelo) */
const aptosIFC = () => (modeloEd && app.edificio.aptos && Object.keys(app.edificio.aptos.unidades || {}).length) ? app.edificio.aptos : null;
function volumenesIFC() {
  if (!modeloEd) return;
  modeloEd.vols.forEach(m => m.parent && m.parent.remove(m)); modeloEd.vols = [];
  const D = aptosIFC(); if (!D) return;
  T.unidades.forEach(m => {
    const a = D.unidades[m.userData.unidad.id];
    if (!a || !(a.cajas || []).length) { m.visible = false; return; }
    const geos = a.cajas.map(c => {
      // un poco más grande que el espacio para que asome por fuera de muros y fachada
      const w = c[3] - c[0], h = c[4] - c[1], d = c[5] - c[2], k = 0.7;
      const g = new THREE.BoxGeometry(w + k, Math.max(0.05, h - 0.1), d + k);
      g.translate((c[0] + c[3]) / 2, (c[1] + c[4]) / 2, (c[2] + c[5]) / 2); return g;
    });
    const geo = mergeGeometries(geos); geos.forEach(g => g.dispose());
    m.geometry.dispose(); m.geometry = geo;
    m.children[0].geometry.dispose(); m.children[0].geometry = new THREE.EdgesGeometry(geo, 30);
    m.position.set(0, 0, 0); m.rotation.set(0, 0, 0); m.scale.set(1, 1, 1); m.visible = true;
    m.userData.ifc = a;
    modeloEd.off.add(m); modeloEd.vols.push(m);
  });
}
const tocables = () => T.unidades.filter(m => m.visible);
function autoAjuste() {
  const s = modeloEd.raw.getSize(new THREE.Vector3());
  const escala = s.y > 0 ? T.alto / s.y : 1;
  return { esc: +escala.toPrecision(4), rot: 0, x: 0, y: 0, z: 0 };
}
function aplicarAjuste() {
  const a = app.edificio.ajuste, { cont, off, raw } = modeloEd;
  const c = raw.getCenter(new THREE.Vector3());
  off.scale.setScalar(a.esc);
  off.position.set(-c.x * a.esc, -raw.min.y * a.esc, -c.z * a.esc);
  cont.rotation.y = THREE.MathUtils.degToRad(a.rot || 0);
  cont.position.set(a.x || 0, a.y || 0, a.z || 0);
}
function reconstruirTorre() {
  scene.remove(T.group);
  T = construirTorre(S, app.torre); scene.add(T.group);
  if (modeloEd) { T.group.add(modeloEd.cont); volumenesIFC(); T.modoModelo(true, app.edificio.volumenes); }
  sel = null; hover = null; T.refrescar(); dibujarLista(); $('#card').hidden = true;
}
function panelAjuste() {
  document.body.classList.add('ajustando');
  const P = $('#ajuste'); P.hidden = false;
  if (!modeloEd) {
    $('#aj-info').textContent = 'Este proyecto aún no tiene modelo del edificio. Súbelo en el dashboard (IFC, GLB, OBJ o FBX) y vuelve aquí para encajarlo.';
    P.querySelectorAll('input,select,button').forEach(x => { x.disabled = x.id !== 'aj-ap' && x.id !== 'aj-lb' && x.id !== 'aj-guardar' && x.id !== 'aj-planta' && x.id !== 'aj-frente'; });
  } else {
    const s = modeloEd.raw.getSize(new THREE.Vector3()), r = modeloEd.r;
    $('#aj-info').textContent = `${app.edificio.nombre || 'Modelo'} · ${r.formato.toUpperCase()} · ${s.x.toFixed(1)} × ${s.z.toFixed(1)} × ${s.y.toFixed(1)} (unidades del archivo)` +
      (r.pisos && r.pisos.length ? ` · ${r.pisos.length} pisos en el IFC` : '') + '. Mueve el modelo hasta que los volúmenes de colores queden sobre cada apartamento.';
  }
  const A = () => app.edificio.ajuste || (app.edificio.ajuste = { esc: 1, rot: 0, x: 0, y: 0, z: 0 });
  const enlaces = [['aj-x', 'x', 'o-x', v => mts(v) + ' m'], ['aj-z', 'z', 'o-z', v => mts(v) + ' m'], ['aj-y', 'y', 'o-y', v => mts(v) + ' m'], ['aj-r', 'rot', 'o-r', v => (+v).toFixed(1) + '°']];
  function pintar() {
    const a = A();
    enlaces.forEach(([id, k, o, f]) => { $('#' + id).value = a[k] || 0; $('#' + o).textContent = f(a[k] || 0); });
    $('#aj-esc').value = a.esc;
    $('#aj-ap').value = app.torre.altoPiso; $('#o-ap').textContent = mts(app.torre.altoPiso) + ' m';
    const lb = app.torre.lobby || T.lobby; $('#aj-lb').value = lb; $('#o-lb').textContent = mts(lb) + ' m';
    $('#aj-vol').value = app.edificio.volumenes || 'siempre';
  }
  enlaces.forEach(([id, k, o, f]) => { $('#' + id).oninput = e => { A()[k] = +e.target.value; $('#' + o).textContent = f(+e.target.value); if (modeloEd) aplicarAjuste(); }; });
  $('#aj-esc').onchange = e => { const v = +e.target.value; if (v > 0) { A().esc = v; aplicarAjuste(); } };
  P.querySelectorAll('[data-esc]').forEach(b => b.onclick = () => { A().esc = +(A().esc * +b.dataset.esc).toPrecision(4); pintar(); aplicarAjuste(); });
  $('#aj-ap').oninput = e => { app.torre.altoPiso = +e.target.value; $('#o-ap').textContent = mts(+e.target.value) + ' m'; reconstruirTorre(); };
  $('#aj-lb').oninput = e => { app.torre.lobby = +e.target.value; $('#o-lb').textContent = mts(+e.target.value) + ' m'; reconstruirTorre(); };
  $('#aj-vol').onchange = e => { app.edificio.volumenes = e.target.value; T.modoModelo(!!modeloEd, e.target.value); T.refrescar(sel, hover); };
  $('#aj-auto').onclick = () => { app.edificio.ajuste = autoAjuste(); pintar(); aplicarAjuste(); };
  $('#aj-planta').onclick = () => { auto = false; controls.autoRotate = false; controls.maxPolarAngle = Math.PI; volar(T.centro.clone().setY(T.radio * 3.2), T.centro.clone().setY(0)); };
  $('#aj-frente').onclick = () => { auto = false; controls.autoRotate = false; volar(new THREE.Vector3(0, T.alto * 0.5, T.radio * 3), T.centro.clone()); };
  $('#aj-guardar').onclick = () => { guardarApp(app); avisar(); toast('Ajuste guardado. El comprador verá el modelo así.'); };
  $('#aj-detectar').onclick = () => {
    if (!modeloEd) return;
    app.edificio.aptos = detectarAptos(modeloEd.r.espacios || [], S); volumenesIFC(); T.refrescar(sel, hover); pintarAptos();
    toast(app.edificio.aptos.conectados ? 'Apartamentos detectados de nuevo' : 'El modelo no trae espacios (rooms) para detectar apartamentos');
  };
  pintar(); pintarAptos(); hint('Mueve, gira y escala el modelo hasta que coincida con los volúmenes de la sala');
}

/* lista de apartamentos del IFC ↔ unidades de la sala, para corregir a mano */
function pintarAptos() {
  const box = $('#aj-aptos'), D = app.edificio.aptos;
  if (!modeloEd || !(modeloEd.r.espacios || []).length) {
    box.innerHTML = '<p class="small muted">' + (modeloEd ? 'Este modelo no trae espacios (IfcSpace / rooms de Revit). Expórtalo con los rooms para que los apartamentos se detecten solos.' : '') + '</p>';
    $('#aj-detectar').hidden = !modeloEd; return;
  }
  const ids = (S.unidades || []).map(u => u.id);
  const ok = D ? D.conectados : 0;
  let html = `<p class="small"><b>${ok} de ${ids.length}</b> unidades de la sala conectadas con su apartamento en el IFC` + (D && D.como ? ` (por ${esc(D.como)})` : '') + `. ${(modeloEd.r.espacios || []).length} espacios leídos.</p>`;
  if (D && D.grupos.length) {
    html += '<div class="aj-lista">' + D.grupos.map(g => `<label><span><b>${esc(g.nombre)}</b><small>${esc(g.piso || '')} · ${g.n} espacios · ${g.area} m²</small></span><select data-clave="${esc(g.clave)}" aria-label="Unidad de la sala para ${esc(g.nombre)}"><option value="">— sin unidad</option>${ids.map(id => `<option${id === g.unidad ? ' selected' : ''}>${esc(id)}</option>`).join('')}</select></label>`).join('') + '</div>';
    const sin = ids.filter(id => !D.unidades[id]);
    if (sin.length) html += `<p class="small muted">Sin apartamento en el IFC: ${sin.slice(0, 30).map(esc).join(', ')}${sin.length > 30 ? '…' : ''}. Siguen en la lista de unidades pero no se ven sobre el modelo.</p>`;
  }
  box.innerHTML = html;
  box.querySelectorAll('select[data-clave]').forEach(s => s.onchange = () => {
    reasignar(app.edificio.aptos, s.dataset.clave, s.value); volumenesIFC(); T.refrescar(sel, hover); pintarAptos();
    const m = T.unidades.find(x => x.userData.unidad.id === s.value); if (m) seleccionar(m);
  });
}

/* ---------- exterior ---------- */
let auto = !qs.get('ajustar');
function vistaExterior(animar = true) {
  const r = T.radio, c = T.centro.clone();
  const pos = new THREE.Vector3(r * 1.55, T.alto * 0.62 + 6, r * 2.05);
  controls.minDistance = 8; controls.maxDistance = r * 6; controls.maxPolarAngle = Math.PI * 0.49; controls.minPolarAngle = 0;
  controls.enablePan = true; controls.enableZoom = true; controls.rotateSpeed = 1;
  controls.autoRotate = auto; controls.autoRotateSpeed = 0.5;
  cam.fov = 40; cam.near = 0.5; cam.far = 3000; cam.updateProjectionMatrix();
  return animar ? volar(pos, c) : (cam.position.copy(pos), controls.target.copy(c), Promise.resolve());
}
controls.addEventListener('start', () => { auto = false; controls.autoRotate = false; });

function unidadesOrdenadas() {
  const nv = m => +m.userData.piso.nivel || 0;
  return [...T.unidades].sort((a, b) => (a.userData.unidad.estado === 'disponible' ? 0 : 1) - (b.userData.unidad.estado === 'disponible' ? 0 : 1) || nv(a) - nv(b) || a.userData.apto.n - b.userData.apto.n);
}
function dibujarLista() {
  const c = { disponible: 0, reservado: 0, vendido: 0 };
  T.unidades.forEach(m => { c[m.userData.unidad.estado] = (c[m.userData.unidad.estado] || 0) + 1; });
  $('#counts').innerHTML = `<span><b>${c.disponible}</b> disponibles</span><span><b>${c.reservado}</b> reservados</span><span><b>${c.vendido}</b> vendidos</span>`;
  const L = $('#ulist'); L.innerHTML = '';
  unidadesOrdenadas().filter(m => filtro === 'todas' || m.userData.unidad.estado === 'disponible').forEach(m => {
    const u = m.userData.unidad, b = document.createElement('button');
    b.type = 'button'; b.className = 'unit'; b.setAttribute('aria-current', m === sel);
    b.innerHTML = `<span class="code">${esc(u.id)}</span><span>${esc(m.userData.piso.nombre || 'Piso ' + m.userData.piso.nivel)}<small>${m2(u.area)} m² · ${u.alcobas || '–'} alc · ${u.banos || '–'} b</small></span><span class="pill ${u.estado}">${ESTADO[u.estado]}</span>`;
    b.onclick = () => seleccionar(m, true);
    L.appendChild(b);
  });
  if (!L.children.length) L.innerHTML = '<p class="muted small">No hay unidades disponibles en este momento.</p>';
}
document.querySelectorAll('#ext .chips button').forEach(b => b.onclick = () => {
  filtro = b.dataset.f; document.querySelectorAll('#ext .chips button').forEach(x => x.setAttribute('aria-pressed', x === b)); dibujarLista();
});
if (innerWidth <= 820) $('#ext').classList.add('collapsed');
$('#b-col').onclick = () => { const e = $('#ext'); e.classList.toggle('collapsed'); $('#b-col').textContent = e.classList.contains('collapsed') ? 'Ver unidades' : 'Ocultar'; };

function centroDe(m) { return new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3()); }
function seleccionar(m, enfocar = true) {
  if (!m) return;
  sel = m; T.refrescar(sel, hover); dibujarLista(); dibujarCard();
  if (!ficha.unidadesVistas.includes(m.userData.unidad.id)) ficha.unidadesVistas.push(m.userData.unidad.id);
  if (enfocar) {
    const c = centroDe(m), dir = new THREE.Vector3(c.x, 0, c.z);
    if (dir.lengthSq() < 0.01) dir.set(0, 0, 1); dir.normalize();
    const d = Math.max(24, T.radio * 1.1);
    auto = false; controls.autoRotate = false;
    volar(c.clone().add(dir.multiplyScalar(d)).add(new THREE.Vector3(0, d * 0.35, 0)), c, 800);
  }
  hint(m.userData.unidad.estado === 'disponible' ? 'Toca "Entrar al apartamento" o haz doble clic en la unidad' : 'Gira el edificio y toca una unidad disponible');
}
function dibujarCard() {
  const C = $('#card'); if (!sel || modo !== 'ext' || document.body.classList.contains('ajustando')) { C.hidden = true; return; }
  const { unidad: u, piso } = sel.userData, av = u.estado === 'disponible';
  const sep = window.SR && SR.sepValue ? SR.money(SR.sepValue(S, u), S.moneda || 'COP') : '';
  let acts = '';
  if (av) {
    acts += '<button class="btn" data-a="entrar" type="button">Entrar al apartamento →</button>';
    acts += '<button class="btn ghost" data-a="cita" type="button">Agendar cita en la sala</button>';
    if (app.salaUrl) acts += `<a class="btn ghost" href="${esc(app.salaUrl)}" target="_blank" rel="noopener">Ver renders y plantas ↗</a>`;
  } else {
    const alt = T.unidades.find(m => m.userData.unidad.estado === 'disponible' && m.userData.planta.id === sel.userData.planta.id && m.userData.apto.n === sel.userData.apto.n)
      || T.unidades.find(m => m.userData.unidad.estado === 'disponible' && m.userData.planta.id === sel.userData.planta.id);
    acts += `<p class="note">Esta unidad está ${u.estado}.${alt ? ' El ' + esc(alt.userData.unidad.id) + ' tiene la misma tipología y está disponible.' : ''}</p>`;
    if (alt) acts += `<button class="btn ghost" data-a="alt" data-id="${esc(alt.userData.unidad.id)}" type="button">Ver el ${esc(alt.userData.unidad.id)} →</button>`;
  }
  C.innerHTML = `<button class="x" type="button" aria-label="Cerrar">×</button>
    <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;padding-right:28px"><h3>Apto ${esc(u.id)}</h3><span class="pill ${u.estado}">${ESTADO[u.estado]}</span></div>
    <div class="specs"><span>${esc(piso.nombre || 'Piso ' + piso.nivel)}</span><span>${m2(u.area)} m²</span><span>${u.alcobas || '–'} alcobas</span><span>${u.banos || '–'} baños</span></div>
    ${av ? `<div class="price">${precioDe(u)}${sep ? `<small>Separas con ${S.separacion || 10} %: ${sep}</small>` : ''}</div>` : ''}
    <div class="acts">${acts}</div>`;
  C.hidden = false;
  C.querySelector('.x').onclick = () => { sel = null; T.refrescar(null, hover); C.hidden = true; dibujarLista(); };
  const be = C.querySelector('[data-a=entrar]'); if (be) be.onclick = () => entrar(sel);
  const bc = C.querySelector('[data-a=cita]'); if (bc) bc.onclick = () => abrirCita(sel);
  const ba = C.querySelector('[data-a=alt]'); if (ba) ba.onclick = () => seleccionar(T.unidades.find(m => String(m.userData.unidad.id) === ba.dataset.id));
}

/* picking */
let down = null;
cv.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
cv.addEventListener('pointermove', e => {
  if (modo !== 'ext' || !T) return;
  ray.setFromCamera(ndc(e), cam);
  const hit = ray.intersectObjects(tocables(), false)[0], m = hit && hit.object, tip = $('#tip');
  if (m !== hover) { hover = m || null; T.refrescar(sel, hover); }
  if (m && e.pointerType === 'mouse') {
    const u = m.userData.unidad;
    tip.textContent = `Apto ${u.id} · ${ESTADO[u.estado]}${u.estado === 'disponible' ? ' · ' + m2(u.area) + ' m²' : ''}`;
    tip.style.left = (e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 12) + 'px'; tip.hidden = false; cv.style.cursor = 'pointer';
  } else { tip.hidden = true; cv.style.cursor = ''; }
});
cv.addEventListener('pointerup', e => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
  down = null;
  if (modo === 'ext' && T) {
    if (document.body.classList.contains('ajustando')) return;
    ray.setFromCamera(ndc(e), cam);
    const hit = ray.intersectObjects(tocables(), false)[0];
    if (hit) seleccionar(hit.object);
  } else if (modo === 'int') clicInterior(e);
});
cv.addEventListener('dblclick', e => {
  if (modo !== 'ext' || !T || document.body.classList.contains('ajustando')) return;
  ray.setFromCamera(ndc(e), cam);
  const hit = ray.intersectObjects(tocables(), false)[0];
  if (hit && hit.object.userData.unidad.estado === 'disponible') entrar(hit.object);
});

/* ---------- ficha del recorrido (todo lo que la sala recibe con la cita) ---------- */
const ficha = { inicio: Date.now(), perfil: '', unidadesVistas: [], visitados: [], respuestas: [], medidas: [], acabados: [], notas: [], preguntadas: new Set() };

/* ---------- entrar al apartamento ---------- */
let I = null, unidadInt = null, herramienta = 'walk', maqueta = false, wiz = null;
const marcas = new THREE.Group(); scene.add(marcas);
let etiquetas = [];

/* qué modelo se abre al entrar: el que mandó la sala en el link → el elegido en el dashboard →
   el modelo que la sala le puso al apto o a su planta → el apto recortado del IFC del edificio → el de referencia */
const ES_MODELO = /\.(ifc|glb|gltf|obj|fbx)(\?|#|$)/i;
function modeloDe(planta, apto, unidad) {
  const q = qs.get('modelo');
  if (q && String(unidad.id) === String(aptoInicial)) return { tipo: 'url', url: q, nombre: q.split(/[?#]/)[0].split('/').pop(), srdb: qs.get('srdb') };
  const m = app.modelos[planta.id];
  if (m && m.tipo && m.tipo !== 'auto') return m;
  const rec = (apto && apto.recorrido) || planta.recorrido;
  if (rec && ES_MODELO.test(rec)) return { tipo: 'url', url: new URL(rec, app.salaUrl || base).href, nombre: rec.split(/[?#]/)[0].split('/').pop() };
  if (aptosIFC() && aptosIFC().unidades[unidad.id]) return { tipo: 'edificio' };
  return { tipo: 'referencia' };
}
/* el apartamento dentro del modelo del edificio: se recorta con 6 planos alrededor de sus espacios */
function recorteEdificio(unidad) {
  const a = aptosIFC().unidades[unidad.id];
  const caja = new THREE.Box3();
  a.cajas.forEach(c => caja.union(new THREE.Box3(new THREE.Vector3(c[0], c[1], c[2]), new THREE.Vector3(c[3], c[4], c[5]))));
  const s = caja.getSize(new THREE.Vector3()), mg = Math.max(0.3, Math.min(s.x, s.z) * 0.04);
  const clip = caja.clone(); clip.min.x -= mg; clip.min.z -= mg; clip.max.x += mg; clip.max.z += mg; clip.min.y -= 0.3; clip.max.y += 0.45;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const planos = [new THREE.Plane(V(1, 0, 0), -clip.min.x), new THREE.Plane(V(-1, 0, 0), clip.max.x), new THREE.Plane(V(0, 1, 0), -clip.min.y),
    new THREE.Plane(V(0, -1, 0), clip.max.y), new THREE.Plane(V(0, 0, 1), -clip.min.z), new THREE.Plane(V(0, 0, -1), clip.max.z)];
  const g = new THREE.Group(), mats = new Map();
  modeloEd.r.scene.traverse(o => {
    if (!o.isMesh) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    if (!o.geometry.boundingBox.intersectsBox(clip)) return;
    let mt = mats.get(o.material);
    if (!mt) { mt = o.material.clone(); mt.clippingPlanes = planos; mats.set(o.material, mt); }
    const c = new THREE.Mesh(o.geometry, mt); c.userData.expressID = o.userData.expressID; g.add(c);
  });
  const vistas = {}, cuartos = {}, nombres = {};
  a.cajas.forEach((c, i) => {
    const w = c[3] - c[0], d = c[5] - c[2]; if (w < 0.8 || d < 0.8) return;
    const cx = (c[0] + c[3]) / 2, cz = (c[2] + c[5]) / 2, y = c[1], n = a.nombres[i] || 'Espacio ' + (i + 1), id = 'e' + i;
    vistas[id] = { n, eye: [cx, y + 1.6, cz], look: w >= d ? [c[3], y + 1.2, cz] : [cx, y + 1.2, c[5]] };
    cuartos[id] = [c[0], c[3], c[2], c[5]]; nombres[id] = n;
  });
  // la sala primero, como en el recorrido de referencia
  const orden = Object.keys(vistas).sort((x, y) => (claveEspacio(vistas[x].n) === 'sala' ? 0 : 1) - (claveEspacio(vistas[y].n) === 'sala' ? 0 : 1));
  const vOrd = {}; orden.forEach(k => { vOrd[k] = vistas[k]; });
  if (!orden.length) { const c = caja.getCenter(V(0, 0, 0)); vOrd.centro = { n: 'Centro', eye: [c.x, caja.min.y + 1.6, c.z], look: [caja.max.x, caja.min.y + 1.3, c.z] }; }
  return { group: g, vistas: vOrd, cuartos, nombres, piso: caja.min.y, techo: caja.max.y, etiqueta: 'Del modelo del edificio (IFC)', box: caja.clone(), recorte: clip, espacios: [] };
}

async function cargarTipologia(planta, apto, unidad) {
  const modelo = modeloDe(planta, apto, unidad);
  if (modelo.tipo === 'edificio') { try { return recorteEdificio(unidad); } catch (e) { console.warn(e); } }
  if (modelo.srdb) {
    // modelo subido en el asistente de la sala (mismo navegador): vive en la IndexedDB de la sala
    const b = await leerSalaDB(modelo.srdb).catch(() => null);
    if (b) return cargarInterior({ tipo: 'archivo', nombre: modelo.nombre }, { apto, unidad, blob: b, base, esc: T ? T.esc : null });
  }
  const ctx = { apto, esc: T ? T.esc : null, unidad, paleta: (S.recorrido || {}).paleta, base };
  if (modelo.tipo === 'archivo') ctx.blob = app.key ? await idb.get(app.key + ':' + planta.id) : null;
  if (!ctx.esc) { const { escalaPlantas } = await import('./torre.js'); ctx.esc = escalaPlantas(S); }
  try { return await cargarInterior(modelo, ctx); }
  catch (err) {
    console.warn(err);
    toast('No cargó el modelo de la tipología; te mostramos el generado desde la planta.');
    return cargarInterior({ tipo: 'planta' }, ctx);
  }
}
function mostrarInterior() {
  if (T) T.group.visible = false;
  suelo.visible = false; grid.visible = false; scene.fog = null; scene.background = FONDO_INT; sol.castShadow = false;
  scene.add(I.group);
  modo = 'int'; document.body.classList.add('int');
}

async function entrar(m) {
  if (!m || modo !== 'ext') return;
  const u = m.userData.unidad;
  if (u.estado !== 'disponible') { toast('Esa unidad no está disponible'); return; }
  modo = 'trans'; sel = m; T.refrescar(sel, null);
  $('#card').hidden = true; $('#ext').hidden = true; $('#tip').hidden = true;
  const c = centroDe(m), dir = new THREE.Vector3(c.x, 0, c.z); if (dir.lengthSq() < 0.01) dir.set(0, 0, 1); dir.normalize();
  await volar(c.clone().add(dir.multiplyScalar(7)).add(new THREE.Vector3(0, 1.2, 0)), c, 850);
  $('#fade').classList.add('on');
  $('#loading').classList.add('soft'); $('#loading').hidden = false; $('#ltxt').textContent = 'Entrando al apartamento ' + u.id + '…';
  I = await cargarTipologia(m.userData.planta, m.userData.apto, u);
  unidadInt = m;
  mostrarInterior();
  limpiarMarcas();
  $('#i-title').textContent = 'Apartamento ' + u.id;
  $('#i-sub').textContent = `${m2(u.area)} m² · ${u.alcobas || '–'} alcobas · ${u.banos || '–'} baños · ${I.etiqueta}`;
  $('#ibar').hidden = false; $('#rooms').hidden = false; $('#ipanel').hidden = false;
  if (innerWidth <= 820) $('#ipanel').classList.add('collapsed');
  dibujarCuartos(); dibujarAcabados(); dibujarDecisiones(); dibujarFicha();
  setHerramienta('walk');
  const primera = Object.keys(I.vistas)[0];
  modoMirar(); colocarVista(I.vistas[primera]);
  $('#loading').hidden = true; $('#loading').classList.remove('soft');
  $('#fade').classList.remove('on');
  bienvenida(u);
  marcarCuarto(primera);
}

function modoMirar() {
  maqueta = false; renderer.clippingPlanes = [];
  controls.enableZoom = false; controls.enablePan = false; controls.rotateSpeed = -0.35;
  controls.minDistance = 0; controls.maxDistance = Infinity; controls.maxPolarAngle = Math.PI; controls.minPolarAngle = 0;
  controls.autoRotate = false; cam.fov = 70; cam.near = 0.05; cam.far = 160; cam.updateProjectionMatrix();
}
function colocarVista(v) {
  const eye = new THREE.Vector3(...v.eye), look = new THREE.Vector3(...v.look);
  cam.position.copy(eye); controls.target.copy(eye.clone().add(look.sub(eye).normalize().multiplyScalar(0.1)));
}
function caminarA(eyeV, lookV, ms = 700) {
  const p0 = cam.position.clone(), d0 = controls.target.clone().sub(cam.position).normalize();
  const d1 = lookV ? lookV.clone().sub(eyeV).normalize() : d0.clone();
  return tween(ms, e => {
    cam.position.lerpVectors(p0, eyeV, e);
    const d = d0.clone().lerp(d1, e).normalize();
    controls.target.copy(cam.position).add(d.multiplyScalar(0.1));
  });
}
function cuartoEn(p) {
  for (const [id, r] of Object.entries(I.cuartos || {})) if (p.x >= r[0] && p.x <= r[1] && p.z >= r[2] && p.z <= r[3]) return id;
  // sin recintos: el espacio cuya vista quede más cerca
  let best = null, d = 4;
  Object.entries(I.vistas).forEach(([id, v]) => { const k = Math.hypot(p.x - v.eye[0], p.z - v.eye[2]); if (k < d) { d = k; best = id; } });
  return best;
}
const nombreCuarto = id => id ? ((I.vistas[id] && I.vistas[id].n) || (I.nombres && I.nombres[id]) || id) : 'el apartamento';
function marcarCuarto(id) {
  document.querySelectorAll('#rooms button').forEach(b => b.setAttribute('aria-pressed', b.dataset.id === id));
  if (!id || wiz) return;
  const uid = unidadInt.userData.unidad.id, n = nombreCuarto(id);
  if (!ficha.visitados.some(v => v.unidad === uid && v.espacio === n)) {
    ficha.visitados.push({ unidad: uid, espacio: n, t: Date.now() }); dibujarFicha();
    preguntarEspacio(n);
    const vistos = ficha.visitados.filter(v => v.unidad === uid).length;
    if (vistos === 3 && !ficha.ofrecida) { ficha.ofrecida = true; encolar(() => say('Ya conoces buena parte del apartamento. ¿Quieres que te agendemos una cita en la sala para verlo con un asesor?', () => chips(['Agendar cita', 'Sigo recorriendo'], v => { out(v); if (v === 'Agendar cita') abrirCita(unidadInt); else say('Perfecto, sigue recorriendo. Cuando quieras, toca "Agendar cita" arriba.'); }))); }
  }
}
function dibujarCuartos() {
  const R = $('#rooms'); R.innerHTML = '';
  Object.entries(I.vistas).forEach(([id, v]) => {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.id = id; b.textContent = v.n;
    b.onclick = async () => {
      if (maqueta) { modoMirar(); colocarVista(v); setHerramienta('walk'); }
      else await caminarA(new THREE.Vector3(...v.eye), new THREE.Vector3(...v.look), 900);
      marcarCuarto(id);
    };
    R.appendChild(b);
  });
}

function setHerramienta(t) {
  if (t === 'maqueta') { verMaqueta(); return; }
  if (maqueta) { modoMirar(); colocarVista(I.vistas[Object.keys(I.vistas)[0]]); }
  herramienta = t; puntoA = null;
  document.querySelectorAll('.tools button').forEach(b => b.setAttribute('aria-pressed', b.dataset.t === t));
  hint(t === 'medir' ? 'Toca el punto inicial y luego el final de lo que quieres medir'
    : t === 'pintar' ? (pintura ? 'Toca una superficie para pintarla con ' + pintura.nombre : 'Elige un color en Acabados y toca una superficie')
      : 'Arrastra para mirar · toca el piso para caminar');
  if (t === 'pintar') abrirTab('acabados');
}
document.querySelectorAll('.tools button').forEach(b => b.onclick = () => setHerramienta(b.dataset.t));
function verMaqueta(sinAnim) {
  maqueta = true; herramienta = 'maqueta';
  document.querySelectorAll('.tools button').forEach(b => b.setAttribute('aria-pressed', b.dataset.t === 'maqueta'));
  document.querySelectorAll('#rooms button').forEach(b => b.setAttribute('aria-pressed', 'false'));
  renderer.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), I.piso + 2.15)];
  const b = I.box || new THREE.Box3().setFromObject(I.group), c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
  const d = Math.max(s.x, s.z, 4);
  controls.enableZoom = true; controls.enablePan = true; controls.rotateSpeed = 0.8; controls.minDistance = 1; controls.maxDistance = d * 4; controls.maxPolarAngle = Math.PI * 0.48;
  cam.fov = 45; cam.near = 0.05; cam.far = Math.max(300, d * 10); cam.updateProjectionMatrix();
  const pos = new THREE.Vector3(c.x + d * 0.45, I.piso + d * 1.15, c.z + d * 0.6), tg = new THREE.Vector3(c.x, I.piso, c.z);
  if (sinAnim) { cam.position.copy(pos); controls.target.copy(tg); } else volar(pos, tg, 900);
  if (!wiz) hint('Vista de maqueta sin techo · arrastra para girar · toca un espacio para volver adentro');
}

/* clics adentro: caminar, medir, pintar o responder el asistente de configuración */
let puntoA = null, pintura = null;
const originales = new Map();
function clicInterior(e) {
  ray.setFromCamera(ndc(e), cam);
  const hit = ray.intersectObject(I.group, true).find(h => (!renderer.clippingPlanes.length || h.point.y < I.piso + 2.15) && (!I.recorte || I.recorte.containsPoint(h.point)));
  if (!hit) return;
  if (wiz && wiz.clic) { wiz.clic(hit); return; }
  if (herramienta === 'walk' && !maqueta) {
    const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
    if (n.y < 0.6 || hit.point.y > I.piso + 0.6) { hint('Toca el piso para caminar hasta ese punto'); return; }
    const dest = new THREE.Vector3(hit.point.x, I.piso + 1.6, hit.point.z);
    caminarA(dest, null, 650);
    marcarCuarto(cuartoEn(dest));
  } else if (herramienta === 'medir') {
    if (!puntoA) { puntoA = hit.point.clone(); marca(puntoA); hint('Ahora toca el punto final'); return; }
    const b = hit.point.clone(), len = puntoA.distanceTo(b);
    if (len < 0.05) return;
    linea(puntoA, b, len);
    const mid = puntoA.clone().add(b).multiplyScalar(0.5);
    const M = { unidad: unidadInt.userData.unidad.id, metros: len, espacio: nombreCuarto(cuartoEn(mid)), mueble: '', necesita: null, cabe: null };
    ficha.medidas.push(M);
    puntoA = null; dibujarFicha(); hint('Medida guardada en tu ficha · toca otro punto para medir de nuevo');
    preguntarMedida(M);
  } else if (herramienta === 'pintar') {
    if (!pintura) { toast('Primero elige un color en Acabados'); return; }
    const o = hit.object;
    if (!originales.has(o)) originales.set(o, o.material);
    const mat = (Array.isArray(o.material) ? o.material[0] : o.material).clone();
    mat.color = new THREE.Color(pintura.hex); mat.map = null; mat.needsUpdate = true;
    o.material = mat;
    const sup = (o.name || mat.name || 'Superficie').replace(/_\d+$/, '').replace(/_/g, ' ');
    ficha.acabados.push({ unidad: unidadInt.userData.unidad.id, superficie: sup, color: pintura.nombre + ' ' + pintura.hex });
  }
}
function marca(p) {
  const s = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), new THREE.MeshBasicMaterial({ color: 0xc9a45c, depthTest: false }));
  s.position.copy(p); s.renderOrder = 10; marcas.add(s); return s;
}
function linea(a, b, len) {
  marca(b);
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: 0xc9a45c, depthTest: false }));
  l.renderOrder = 10; marcas.add(l);
  if (len != null) {
    const el = document.createElement('div'); el.className = 'mlabel'; el.textContent = mts(len) + ' m';
    $('#labels').appendChild(el); etiquetas.push({ el, p: a.clone().add(b).multiplyScalar(0.5) });
  }
}
function limpiarMarcas() { marcas.clear(); etiquetas.forEach(x => x.el.remove()); etiquetas = []; puntoA = null; }
$('#b-borrar').onclick = () => { limpiarMarcas(); toast('Borramos las líneas del modelo; las medidas siguen en tu ficha'); };

/* ---------- asistente (chat) ---------- */
const log = $('#log'), Q = $('#q');
let ocupado = false; const cola = [];
function scr() { log.scrollTop = log.scrollHeight; }
function say(t, after) { const d = document.createElement('div'); d.className = 'm in'; d.textContent = t; log.appendChild(d); scr(); if (after) { ocupado = true; after(); } else siguiente(); }
function out(t) { const d = document.createElement('div'); d.className = 'm out'; d.textContent = t; log.appendChild(d); scr(); }
function chips(op, cb) {
  Q.innerHTML = '<div class="chips"></div>';
  op.forEach(x => { const b = document.createElement('button'); b.type = 'button'; b.textContent = x; b.onclick = () => { Q.innerHTML = ''; ocupado = false; cb(x); }; Q.firstChild.appendChild(b); });
}
function pedir(ph, cb) {
  Q.innerHTML = `<form class="inline"><input type="text" inputmode="decimal" placeholder="${esc(ph)}" aria-label="Respuesta"><button class="btn sm">Enviar</button></form>`;
  const f = Q.querySelector('form'); f.querySelector('input').focus();
  f.onsubmit = e => { e.preventDefault(); const v = f.querySelector('input').value; if (cb(v) !== false) { Q.innerHTML = ''; ocupado = false; } };
}
function encolar(fn) { if (ocupado) cola.push(fn); else fn(); }
function siguiente() { if (!ocupado && cola.length) cola.shift()(); }

function bienvenida(u) {
  log.innerHTML = ''; Q.innerHTML = ''; ocupado = false; cola.length = 0;
  say(`Bienvenido al apartamento ${u.id}: ${m2(u.area)} m², ${u.alcobas || '–'} alcobas y ${u.banos || '–'} baños. Arrastra para mirar, toca el piso para caminar o elige un espacio abajo. Yo voy anotando lo que me cuentes para tu asesor.`);
  const P = app.preguntas.perfil;
  if (P && P.q && !ficha.perfil) encolar(() => say(P.q, () => chips(P.op, v => { ficha.perfil = v; out(v); ficha.respuestas.push({ unidad: u.id, espacio: 'Perfil', pregunta: P.q, respuesta: v }); dibujarFicha(); say('Anotado.'); })));
}
function preguntarEspacio(nombre) {
  const k = claveEspacio(nombre), L = (app.preguntas.espacios[k] || []);
  const uid = unidadInt.userData.unidad.id;
  const p = L.find(x => !ficha.preguntadas.has(k + '|' + x.q)); if (!p) return;
  ficha.preguntadas.add(k + '|' + p.q);
  encolar(() => say(`${nombre}: ${p.q}`, () => chips(p.op && p.op.length ? p.op : ['Sí', 'No'], v => {
    out(v); ficha.respuestas.push({ unidad: uid, espacio: nombre, pregunta: p.q, respuesta: v }); dibujarFicha();
    if (/cama/i.test(p.q) && /(\d+,\d+) m/.test(v)) say('Con esa cama te recomiendo medir la pared del espaldar con "Medir": te digo cuánto queda para las mesas de noche.');
    else say('Anotado, se lo paso a tu asesor.');
  })));
}
const MUEBLES = ['Sofá', 'Cama', 'Comedor', 'Escritorio', 'Nevera', 'Clóset', 'Biblioteca', 'Otro'];
function veredicto(M) {
  if (!(M.necesita > 0)) return '';
  const libre = M.metros - M.necesita;
  if (libre >= 0.6) return `<span class="fit ok">✓ Cabe y te sobran ${mts(libre)} m</span>`;
  if (libre >= 0) return `<span class="fit justo">✓ Cabe justo (${mts(libre)} m). Lo confirmamos en sala con el plano</span>`;
  return `<span class="fit no">✗ No cabe: faltan ${mts(-libre)} m. Tu asesor te muestra otra distribución</span>`;
}
function preguntarMedida(M) {
  abrirTab('chat');
  if (innerWidth <= 820) $('#ipanel').classList.remove('collapsed');
  encolar(() => say(`📏 ${mts(M.metros)} m en ${M.espacio}. ¿Qué necesitas que quepa ahí?`, () => chips([...MUEBLES, 'Solo estaba midiendo'], u => {
    out(u); if (u === 'Solo estaba midiendo') { say('Listo, queda en tu ficha.'); return; }
    M.mueble = u; dibujarFicha();
    say(`¿Qué largo tiene tu ${u.toLowerCase()}? Escríbelo en metros.`, () => pedir('Ej. 2,20', val => {
      const n = parseFloat(String(val).replace(',', '.'));
      if (!(n > 0 && n < 30)) { toast('Escribe una medida en metros, por ejemplo 2,20'); return false; }
      M.necesita = n; M.cabe = M.metros >= n; out(mts(n) + ' m'); dibujarFicha();
      const libre = M.metros - n;
      say(libre >= 0.6 ? `✓ Cabe y te sobran ${mts(libre)} m.` : libre >= 0 ? `✓ Cabe justo: quedan ${mts(libre)} m. Lo confirmamos en sala con el plano a escala.` : `✗ No cabe: faltan ${mts(-libre)} m. Tu asesor te muestra otra distribución.`);
    }));
  })));
}
$('#f-chat').onsubmit = e => {
  e.preventDefault(); const i = $('#i-chat'), t = i.value.trim(); if (!t) return;
  i.value = ''; out(t); ficha.notas.push({ unidad: unidadInt ? unidadInt.userData.unidad.id : '', texto: t }); dibujarFicha();
  say('Anotado: tu asesor lo recibe con la cita. ¿Quieres agendarla ahora?', () => chips(['Agendar cita', 'Sigo recorriendo'], v => { out(v); if (v === 'Agendar cita') abrirCita(unidadInt); }));
};

/* ---------- mi ficha ---------- */
function dibujarFicha() {
  $('#s-m').textContent = ficha.medidas.length; $('#s-r').textContent = ficha.visitados.length; $('#s-a').textContent = ficha.respuestas.length;
  $('#f-resp').innerHTML = ficha.respuestas.length || ficha.notas.length ? '<div class="resp">' +
    ficha.respuestas.map(r => `<div><small>${esc(r.unidad)} · ${esc(r.espacio)} · ${esc(r.pregunta)}</small>${esc(r.respuesta)}</div>`).join('') +
    ficha.notas.map(n => `<div><small>Comentario${n.unidad ? ' · ' + esc(n.unidad) : ''}</small>${esc(n.texto)}</div>`).join('') + '</div>' : '';
  const L = $('#mlist'); L.innerHTML = '';
  ficha.medidas.forEach(M => {
    const li = document.createElement('li');
    li.innerHTML = `<b>📏 ${mts(M.metros)} m en ${esc(M.espacio)} · ${esc(M.unidad)}</b>
      <div class="row"><select aria-label="Qué mueble"><option value="">¿Qué quieres que quepa?</option>${MUEBLES.map(x => `<option${x === M.mueble ? ' selected' : ''}>${x}</option>`).join('')}</select>
      <input type="text" inputmode="decimal" placeholder="Largo en m" aria-label="Largo del mueble en metros" value="${M.necesita ? mts(M.necesita) : ''}"></div>
      <div class="v">${veredicto(M)}</div>`;
    const [s, inp] = li.querySelectorAll('select,input');
    s.onchange = () => { M.mueble = s.value; };
    inp.onchange = () => { const n = parseFloat(String(inp.value).replace(',', '.')); M.necesita = n > 0 && n < 30 ? n : null; M.cabe = M.necesita ? M.metros >= M.necesita : null; li.querySelector('.v').innerHTML = veredicto(M); };
    L.appendChild(li);
  });
  $('#f-intro').hidden = ficha.medidas.length > 0;
}

/* ---------- agendar cita: la sala recibe el recorrido y las respuestas ---------- */
let unidadCita = null;
function hhmm(s) { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); }
function abrirCita(m) {
  unidadCita = m || unidadInt || sel;
  const A = app.agenda, F = $('#f-cita');
  const u = unidadCita && unidadCita.userData.unidad;
  $('#c-unidad').textContent = u ? `${app.nombre || S.proyecto} · Apto ${u.id} · ${m2(u.area)} m² · ${precioDe(u)}` : (app.nombre || S.proyecto);
  const dias = [], hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  for (let i = 1; dias.length < 14 && i < 40; i++) { const d = new Date(hoy); d.setDate(d.getDate() + i); if ((A.dias || []).includes(d.getDay())) dias.push(d); }
  F.fecha.innerHTML = dias.map(d => `<option value="${d.toISOString().slice(0, 10)}">${d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}</option>`).join('');
  const horas = []; for (let t = hhmm(A.desde); t + (+A.cada || 60) <= hhmm(A.hasta); t += (+A.cada || 60)) horas.push(String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'));
  F.hora.innerHTML = horas.map(h => `<option>${h}</option>`).join('');
  $('#c-mod').hidden = !A.modalidad;
  try { const c = JSON.parse(localStorage.getItem('lc:3d:cliente') || 'null'); if (c) { F.nombre.value = F.nombre.value || c.nombre || ''; F.celular.value = F.celular.value || c.celular || ''; F.correo.value = F.correo.value || c.correo || ''; } } catch (e) {}
  const n = ficha.visitados.length, r = ficha.respuestas.length, me = ficha.medidas.length;
  $('#c-incluye').textContent = `Tu asesor recibe tu recorrido: ${n} espacios vistos, ${r} respuestas, ${me} medidas${ficha.notas.length ? ', ' + ficha.notas.length + ' comentarios' : ''}${ficha.acabados.length ? ' y los acabados que probaste' : ''}.`;
  $('#c-err').textContent = ''; F.hidden = false; $('#c-ok').hidden = true; $('#c-enviar').disabled = false;
  $('#m-cita').hidden = false; setTimeout(() => F.nombre.focus(), 30);
}
$('#b-agendar').onclick = () => abrirCita(unidadInt);
$('#b-cita').onclick = () => abrirCita(unidadInt);
$('#m-cita').addEventListener('click', e => { if (e.target.id === 'm-cita' || e.target.closest('[data-close]')) $('#m-cita').hidden = true; });
addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#m-cita').hidden) $('#m-cita').hidden = true; });

function payloadCita(F) {
  const u = unidadCita && unidadCita.userData.unidad, piso = unidadCita && unidadCita.userData.piso;
  const fecha = new Date(F.fecha.value + 'T' + F.hora.value + ':00');
  return {
    origen: 'App 3D sala de ventas', app: app.nombre || S.proyecto, proyecto: S.proyecto || app.nombre, empresa: S.empresa || '', link: location.href.split('#')[0],
    cliente: { nombre: F.nombre.value.trim(), celular: F.celular.value.trim(), correo: F.correo.value.trim() },
    cita: { fecha: F.fecha.value, hora: F.hora.value, iso: fecha.toISOString(), fechaTexto: fecha.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }), modalidad: app.agenda.modalidad ? F.modalidad.value : '', nota: F.nota.value.trim(), asesor: app.agenda.asesor || '', direccion: app.agenda.direccion || '' },
    unidad: u ? { id: u.id, piso: piso.nombre || 'Piso ' + piso.nivel, area: u.area, alcobas: u.alcobas, banos: u.banos, precio: u.precio, precioTexto: precioDe(u), estado: u.estado } : null,
    recorrido: {
      inicio: new Date(ficha.inicio).toISOString(), minutos: Math.max(1, Math.round((Date.now() - ficha.inicio) / 60000)), perfil: ficha.perfil,
      unidadesVistas: ficha.unidadesVistas.slice(), espacios: ficha.visitados.map(v => ({ unidad: v.unidad, espacio: v.espacio })),
      respuestas: ficha.respuestas.slice(), medidas: ficha.medidas.map(m => ({ unidad: m.unidad, espacio: m.espacio, metros: +m.metros.toFixed(2), mueble: m.mueble, necesita: m.necesita, cabe: m.cabe })),
      acabados: ficha.acabados.slice(), notas: ficha.notas.slice()
    }
  };
}
$('#f-cita').onsubmit = async e => {
  e.preventDefault();
  const F = e.target, err = $('#c-err');
  if (!F.nombre.value.trim()) { err.textContent = 'Escribe tu nombre.'; F.nombre.focus(); return; }
  if (String(F.celular.value).replace(/\D/g, '').length < 7) { err.textContent = 'Escribe un celular válido.'; F.celular.focus(); return; }
  if (F.correo.value && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(F.correo.value)) { err.textContent = 'Revisa el correo.'; F.correo.focus(); return; }
  if (!F.fecha.value || !F.hora.value) { err.textContent = 'Elige día y hora.'; return; }
  if (!F.ok.checked) { err.textContent = 'Necesitamos tu autorización para agendar la cita.'; return; }
  err.textContent = ''; $('#c-enviar').disabled = true; $('#c-enviar').textContent = 'Enviando tu recorrido…';
  const p = payloadCita(F);
  try { localStorage.setItem('lc:3d:cliente', JSON.stringify(p.cliente)); } catch (x) {}
  const { texto, canales } = await enviarCita(app, p);
  try { localStorage.setItem('lc:3d:ultima-cita', JSON.stringify({ p, canales, t: Date.now() })); } catch (x) {}
  const tel = app.crm.whatsapp ? (app.agenda.whatsapp || S.whatsapp) : '';
  const wa = linkWhatsApp(tel, 'Hola, agendé una cita desde el recorrido 3D.\n' + texto);
  const okCanales = canales.filter(c => c.ok).length;
  $('#c-ok').innerHTML = `<div class="eyebrow">Cita agendada</div><h3>¡Listo, ${esc(p.cliente.nombre.split(' ')[0])}!</h3>
    <p class="small">Te esperamos el <b>${esc(p.cita.fechaTexto)}</b> a las <b>${esc(p.cita.hora)}</b>${p.cita.modalidad ? ' · ' + esc(p.cita.modalidad) : ''}${p.cita.direccion ? ' en ' + esc(p.cita.direccion) : ''}.</p>
    <p class="muted small">${okCanales ? 'La sala de ventas ya recibió tu recorrido y tus respuestas.' : canales.length ? 'No pudimos enviar tu recorrido automáticamente; mándalo por WhatsApp para confirmar.' : 'Confirma por WhatsApp para que tu asesor reciba tu recorrido.'}</p>
    ${canales.length ? '<ul class="canales">' + canales.map(c => `<li class="${c.ok ? 'ok' : 'no'}">${c.ok ? '✓' : '✗'} ${esc(c.canal)}${c.ok ? '' : ' · ' + esc(c.error || 'no respondió')}</li>`).join('') + '</ul>' : ''}
    <div class="acts" style="display:flex;flex-direction:column;gap:8px">${wa ? `<a class="btn" href="${esc(wa)}" target="_blank" rel="noopener">Enviar mi ficha por WhatsApp</a>` : ''}
    <button class="btn ghost" type="button" data-close>Seguir recorriendo</button>
    ${app.salaUrl ? `<a class="btn ghost" href="${esc(app.salaUrl)}" target="_blank" rel="noopener">Ver renders y plantas ↗</a>` : ''}</div>`;
  F.hidden = true; $('#c-ok').hidden = false;
  $('#c-enviar').textContent = 'Confirmar cita';
  if (modo === 'int') say(`Tu cita quedó para el ${p.cita.fechaTexto} a las ${p.cita.hora}. Tu asesor ya tiene tu recorrido.`);
};

/* ---------- acabados y decisiones ---------- */
function dibujarAcabados() {
  const pal = ((S.recorrido || {}).paleta || []).length ? S.recorrido.paleta
    : [{ nombre: 'Blanco hueso', hex: '#efe7da' }, { nombre: 'Madera', hex: '#a77c55' }, { nombre: 'Grafito', hex: '#2f2924' }, { nombre: 'Verde', hex: '#56844a' }];
  const W = $('#swatches'); W.innerHTML = ''; pintura = null;
  pal.forEach(p => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'sw'; b.setAttribute('aria-pressed', 'false');
    b.innerHTML = `<i style="background:${esc(p.hex)}"></i><span>${esc(p.nombre)}<br><small class="muted">${esc(p.hex)}</small></span>`;
    b.onclick = () => { pintura = p; W.querySelectorAll('.sw').forEach(x => x.setAttribute('aria-pressed', x === b)); setHerramienta('pintar'); };
    W.appendChild(b);
  });
}
$('#b-orig').onclick = () => { originales.forEach((mat, o) => { o.material = mat; }); originales.clear(); toast('Acabados originales'); };
function dibujarDecisiones() {
  const D = (S.recorrido || {}).decisiones || [];
  $('#decisiones').innerHTML = (D.length ? D.map(d => `<div class="dec"><small>${esc(d.cat)}</small><b>${esc(d.titulo)}</b><p>${esc(d.texto)}</p></div>`).join('') : '<p class="muted small">El proyecto aún no tiene decisiones arquitectónicas cargadas en el dashboard de la sala.</p>')
    + `<p class="muted small" style="margin-top:10px">Modelo: ${esc(I.etiqueta)}</p>`;
}
function abrirTab(t) {
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t));
  document.querySelectorAll('#ipanel section').forEach(s => { s.hidden = s.dataset.pane !== t; });
}
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { abrirTab(b.dataset.tab); $('#ipanel').classList.remove('collapsed'); });

/* ---------- volver al 3D general ---------- */
$('#b-salir').onclick = async () => {
  if (modo !== 'int' || !T) return;
  $('#fade').classList.add('on'); await new Promise(r => setTimeout(r, 420));
  limpiarMarcas(); originales.clear();
  scene.remove(I.group); I = null; renderer.clippingPlanes = [];
  T.group.visible = true; suelo.visible = true; grid.visible = true; scene.background = FONDO_EXT; scene.fog = new THREE.Fog(FONDO_EXT, 160, 420); sol.castShadow = true;
  $('#ibar').hidden = true; $('#rooms').hidden = true; $('#ipanel').hidden = true; document.body.classList.remove('int');
  modo = 'ext'; $('#ext').hidden = false;
  await vistaExterior(false);
  $('#fade').classList.remove('on');
  seleccionar(unidadInt);
};
addEventListener('keydown', e => { if (e.key === 'Escape' && modo === 'int' && puntoA) { puntoA = null; marcas.children.length && marcas.remove(marcas.children[marcas.children.length - 1]); hint('Medida cancelada'); } });

/* ---------- preguntas para configurar el recorrido de una tipología (desde el dashboard) ---------- */
async function asistenteRecorrido(plantaId) {
  document.body.classList.add('wizard');
  const pl = (S.plantas || []).find(p => p.id === plantaId);
  if (!pl) { $('#ltxt').textContent = 'No encontré esa tipología en la sala.'; return; }
  const apto = pl.aptos[0];
  const unidad = (S.unidades || []).find(u => S.pisos.some(p => p.id === u.piso && p.planta === pl.id)) || { id: 'tipo', alcobas: apto.alcobas, banos: apto.banos, area: apto.area };
  const M = app.modelos[pl.id] = app.modelos[pl.id] || { tipo: 'referencia' };
  async function cargar() {
    if (I) scene.remove(I.group);
    $('#loading').hidden = false; $('#ltxt').textContent = 'Cargando el modelo de ' + (pl.nombre || pl.id) + '…';
    I = await cargarTipologia(pl, apto, unidad);
    unidadInt = { userData: { unidad } };
    mostrarInterior(); $('#loading').hidden = true;
    verMaqueta(true);
  }
  await cargar();
  $('#wiz').hidden = false;
  const B = $('#wz-body'), paso = t => { $('#wz-paso').textContent = (pl.nombre || pl.id) + ' · ' + t; };
  wiz = { clic: null };
  const box = () => new THREE.Box3().setFromObject(I.group);

  const efectiva = () => { const c = I.group.children[0]; return c && c.scale ? +c.scale.x.toPrecision(4) : 1; };
  // 1. escala
  function p1() {
    const s = box().getSize(new THREE.Vector3());
    paso('1 de 4 · Tamaño');
    B.innerHTML = `<p class="wz-q">¿El apartamento se ve de su tamaño real?</p>
      <p class="small muted">Lo medimos en ${mts(s.x)} × ${mts(s.z)} m de planta y ${mts(s.y)} m de alto. Un apto de ${m2(apto.area)} m² suele medir unos ${mts(Math.sqrt(+apto.area || 60) * 1.15)} m de lado.</p>
      <div class="wz-acts"><button class="btn sm" data-e="ok" type="button">Sí, está bien</button><button class="btn ghost sm" data-e="1" type="button">El archivo está en metros</button><button class="btn ghost sm" data-e="0.01" type="button">En centímetros</button><button class="btn ghost sm" data-e="0.001" type="button">En milímetros</button><button class="btn ghost sm" data-e="0.0254" type="button">En pulgadas</button></div>
      <div class="aj-row"><span>Escala exacta</span><input id="wz-esc" type="number" step="any" value="${efectiva()}"><button class="btn ghost sm" id="wz-apl" type="button">Aplicar</button></div>
      <p class="wz-q" style="font-size:16px;margin-top:6px">¿A qué altura está el piso del apartamento?</p>
      <p class="small muted">Detectamos el piso a ${mts(I.piso - box().min.y)} m sobre la base del modelo. Si la maqueta no muestra los muros cortados, ajústalo.</p>
      <label class="aj">Nivel del piso <output id="wz-po">${mts(I.piso - box().min.y)} m</output><input id="wz-piso" type="range" min="0" max="${box().getSize(new THREE.Vector3()).y.toFixed(2)}" step="0.05" value="${(I.piso - box().min.y).toFixed(2)}"></label>`;
    B.querySelectorAll('[data-e]').forEach(b => b.onclick = async () => {
      if (b.dataset.e === 'ok') { M.escala = efectiva(); M.piso = +I.piso.toFixed(3); p2(); return; }
      M.escala = +b.dataset.e; delete M.vistas; delete M.piso; lista = []; await cargar(); p1();
    });
    $('#wz-piso').oninput = e => {
      const v = +e.target.value; I.piso = box().min.y + v; M.piso = +I.piso.toFixed(3);
      $('#wz-po').textContent = mts(v) + ' m'; renderer.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), I.piso + 2.15)];
    };
    $('#wz-apl').onclick = async () => { const v = +$('#wz-esc').value; if (v > 0) { M.escala = v; delete M.vistas; delete M.piso; lista = []; await cargar(); p1(); } };
  }
  // 2. espacios
  let lista = [];
  function p2() {
    paso('2 de 4 · Espacios');
    if (!lista.length) {
      const prev = M.vistas && Object.values(M.vistas);
      if (prev && prev.length && M.tipo !== 'referencia') lista = prev.map(v => ({ n: v.n, eye: v.eye, look: v.look }));
      else if ((I.espacios || []).length) lista = Object.values(I.vistas).map(v => ({ n: v.n, eye: v.eye, look: v.look }));
      else {
        lista = [{ n: 'Sala-comedor' }, { n: 'Cocina' }, { n: 'Habitación principal' }];
        for (let i = 2; i <= (+apto.alcobas || 1); i++) lista.push({ n: 'Habitación ' + i });
        lista.push({ n: 'Baño' }); lista.push({ n: 'Balcón' });
      }
    }
    B.innerHTML = `<p class="wz-q">¿Qué espacios va a recorrer el comprador?</p>
      <p class="small muted">${(I.espacios || []).length ? 'Los tomamos de los espacios (IfcSpace) del modelo. ' : ''}Quita los que no apliquen, cambia nombres o agrega. El primero es por donde entra.</p>
      <div class="wz-list" id="wz-l"></div>
      <form class="inline" id="wz-add"><input placeholder="Agregar espacio (ej. Estudio)" aria-label="Nuevo espacio"><button class="btn ghost sm">Agregar</button></form>
      <div class="wz-acts"><button class="btn ghost sm" id="wz-atras" type="button">← Tamaño</button><button class="btn sm" id="wz-sig" type="button">Siguiente: ubicar cada espacio →</button></div>`;
    const L = $('#wz-l');
    const pintar = () => {
      L.innerHTML = '';
      lista.forEach((e, i) => {
        const d = document.createElement('div'); d.className = 'wz-item';
        d.innerHTML = `<b>${i + 1}</b><input type="text" value="${esc(e.n)}" aria-label="Nombre del espacio"><button class="btn ghost sm" data-up type="button" aria-label="Subir">↑</button><button class="btn ghost sm" data-x type="button" aria-label="Quitar">×</button>`;
        d.querySelector('input').onchange = ev => { e.n = ev.target.value.trim() || e.n; };
        d.querySelector('[data-x]').onclick = () => { lista.splice(i, 1); pintar(); };
        d.querySelector('[data-up]').onclick = () => { if (i) { lista.splice(i - 1, 0, lista.splice(i, 1)[0]); pintar(); } };
        L.appendChild(d);
      });
    };
    pintar();
    $('#wz-add').onsubmit = ev => { ev.preventDefault(); const v = ev.target.querySelector('input').value.trim(); if (v) { lista.push({ n: v }); ev.target.reset(); pintar(); } };
    $('#wz-atras').onclick = p1;
    $('#wz-sig').onclick = () => { if (!lista.length) { toast('Deja al menos un espacio'); return; } p3(0); };
  }
  // 3. ubicar cada espacio en la maqueta
  const tmp = new THREE.Group(); scene.add(tmp);
  function dibujarPuntos(cur) {
    tmp.clear();
    lista.forEach((e, i) => {
      if (!e.eye) return;
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), new THREE.MeshBasicMaterial({ color: i === cur ? 0xc9a45c : 0x2f9e5f, depthTest: false }));
      s.position.set(e.eye[0], I.piso + 0.2, e.eye[2]); s.renderOrder = 11; tmp.add(s);
      if (e.look) {
        const a = new THREE.Vector3(e.eye[0], I.piso + 0.2, e.eye[2]), b = new THREE.Vector3(e.look[0], I.piso + 0.2, e.look[2]);
        const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: i === cur ? 0xc9a45c : 0x2f9e5f, depthTest: false }));
        l.renderOrder = 11; tmp.add(l);
      }
    });
  }
  function p3(i) {
    const e = lista[i]; paso(`3 de 4 · ${i + 1}/${lista.length} ${e.n}`);
    if (!maqueta) verMaqueta();
    let fase = e.eye ? 'listo' : 'pie';
    const render = () => {
      B.innerHTML = `<p class="wz-q">${fase === 'pie' ? `¿Dónde se para el comprador en «${esc(e.n)}»?` : fase === 'mira' ? `¿Hacia dónde mira al llegar a «${esc(e.n)}»?` : `«${esc(e.n)}» quedó ubicado`}</p>
        <p class="small muted">${fase === 'pie' ? 'Toca el piso de ese espacio en la maqueta. Gira y acerca con el mouse si lo necesitas.' : fase === 'mira' ? 'Toca un punto del espacio hacia donde quieres que mire (una ventana, la cocina, la cama…).' : 'Pruébalo desde adentro o sigue con el siguiente espacio.'}</p>
        <div class="wz-list">${lista.map((x, k) => `<div class="wz-item ${k === i ? 'cur' : x.eye && x.look ? 'done' : ''}"><b>${k + 1}</b><span>${esc(x.n)}</span>${x.eye && x.look ? '✓' : ''}</div>`).join('')}</div>
        <div class="wz-acts">${fase === 'listo' ? '<button class="btn ghost sm" id="wz-ver" type="button">Verlo desde adentro</button><button class="btn ghost sm" id="wz-rep" type="button">Volver a ubicar</button>' : ''}
        ${i > 0 ? '<button class="btn ghost sm" id="wz-ant" type="button">← Anterior</button>' : '<button class="btn ghost sm" id="wz-ant" type="button">← Espacios</button>'}
        ${fase === 'listo' ? `<button class="btn sm" id="wz-sig" type="button">${i + 1 < lista.length ? 'Siguiente →' : 'Terminar →'}</button>` : ''}</div>`;
      dibujarPuntos(i);
      const ver = $('#wz-ver'); if (ver) ver.onclick = () => { if (maqueta) { modoMirar(); colocarVista(e); ver.textContent = 'Volver a la maqueta'; } else { verMaqueta(); ver.textContent = 'Verlo desde adentro'; } };
      const rep = $('#wz-rep'); if (rep) rep.onclick = () => { delete e.eye; delete e.look; fase = 'pie'; if (!maqueta) verMaqueta(); render(); };
      $('#wz-ant').onclick = () => { wiz.clic = null; i > 0 ? p3(i - 1) : p2(); };
      const sig = $('#wz-sig'); if (sig) sig.onclick = () => { wiz.clic = null; i + 1 < lista.length ? p3(i + 1) : p4(); };
    };
    wiz.clic = hit => {
      if (!maqueta) return;
      if (fase === 'pie' || fase === 'listo') { e.eye = [hit.point.x, I.piso + 1.6, hit.point.z]; delete e.look; fase = 'mira'; render(); }
      else if (fase === 'mira') {
        const d = Math.hypot(hit.point.x - e.eye[0], hit.point.z - e.eye[2]); if (d < 0.3) { toast('Toca un punto un poco más lejos'); return; }
        e.look = [hit.point.x, Math.max(I.piso + 0.9, Math.min(I.piso + 1.5, hit.point.y)), hit.point.z]; fase = 'listo'; render();
      }
    };
    render();
  }
  // 4. guardar
  function p4() {
    paso('4 de 4 · Listo');
    const faltan = lista.filter(x => !(x.eye && x.look));
    if (faltan.length) { toast('Falta ubicar: ' + faltan.map(x => x.n).join(', ')); p3(lista.indexOf(faltan[0])); return; }
    const vistas = {};
    lista.forEach((x, k) => { vistas['v' + k] = { n: x.n, eye: x.eye.map(n => +n.toFixed(3)), look: x.look.map(n => +n.toFixed(3)) }; });
    M.vistas = vistas; M.cuartos = {}; M.escala = +M.escala || undefined;
    guardarApp(app); avisar(); tmp.clear();
    I.vistas = vistas; I.cuartos = {};
    B.innerHTML = `<p class="wz-q">El recorrido de ${esc(pl.nombre || pl.id)} quedó listo</p>
      <p class="small muted">El comprador entra por «${esc(lista[0].n)}» y puede ir a ${lista.length} espacios. Las preguntas de cada espacio se configuran en el dashboard.</p>
      <div class="wz-acts"><button class="btn sm" id="wz-probar" type="button">Probar como comprador</button><button class="btn ghost sm" id="wz-otra" type="button">Ajustar otra vez</button></div>`;
    $('#wz-probar').onclick = () => {
      wiz = null; $('#wiz').hidden = true; document.body.classList.remove('wizard');
      $('#ibar').hidden = false; $('#rooms').hidden = false; $('#ipanel').hidden = false; $('#b-salir').hidden = true;
      $('#i-title').textContent = pl.nombre || 'Tipología'; $('#i-sub').textContent = I.etiqueta;
      dibujarCuartos(); dibujarAcabados(); dibujarDecisiones(); dibujarFicha(); setHerramienta('walk');
      modoMirar(); colocarVista(vistas.v0); bienvenida(unidad); marcarCuarto('v0');
    };
    $('#wz-otra').onclick = () => p3(0);
  }
  if (M.tipo === 'referencia' || M.tipo === 'planta') {
    paso('Recorrido incluido');
    B.innerHTML = `<p class="wz-q">Esta tipología ya trae su recorrido</p><p class="small muted">${M.tipo === 'referencia' ? 'El apartamento de referencia tiene sus espacios ubicados.' : 'El apartamento generado desde la planta ubica solo sus espacios.'} Si subes tu propio modelo (IFC, GLB, OBJ o FBX) te haremos las preguntas para ubicar cada espacio.</p>`;
    return;
  }
  p1();
}

/* ---------- loop ---------- */
const v3 = new THREE.Vector3();
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, cam);
  if (etiquetas.length) {
    etiquetas.forEach(({ el, p }) => {
      v3.copy(p).project(cam);
      const vis = v3.z < 1 && Math.abs(v3.x) < 1.1 && Math.abs(v3.y) < 1.1;
      el.style.display = vis ? '' : 'none';
      el.style.left = ((v3.x + 1) / 2 * innerWidth) + 'px'; el.style.top = ((1 - v3.y) / 2 * innerHeight) + 'px';
    });
  }
});

window.APP3D = {
  seleccionar: id => seleccionar(T.unidades.find(m => String(m.userData.unidad.id) === String(id))),
  entrar: id => entrar(T.unidades.find(m => String(m.userData.unidad.id) === String(id))),
  get S() { return S; }, get modo() { return modo; }, get interior() { return I; }, get ficha() { return ficha; }, get app() { return app; }, setHerramienta, abrirCita
};
main();
