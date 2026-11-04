/*!
 * Life City · App 3D de la sala de ventas
 * Edificio con el inventario de la sala (en vivo) → clic en una unidad disponible → entrar al apartamento:
 * caminar por espacios, medir pared a pared, probar acabados de la paleta y mandar la ficha al asesor.
 *
 *   visor.html                → demo Torre Alborada (sala publicada en Inicio-bim)
 *   visor.html?app=<key>      → app creada en el dashboard (este navegador)
 *   visor.html?c=<config>     → app publicada (la config viaja en el link)
 *   …&apto=1203               → abre con esa unidad seleccionada (&entrar=1 entra directo)
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { construirTorre } from './torre.js';
import { cargarInterior } from './interior.js';
import { resolverSala, escucharEstados, leerApp, unb64, idb, esc, DEMO_SALA } from './fuente.js';

const $ = s => document.querySelector(s);
const qs = new URLSearchParams(location.search);
if (qs.has('embed')) document.body.classList.add('embed');
const ESTADO = { disponible: 'Disponible', reservado: 'Reservado', vendido: 'Vendido' };
const m2 = v => (+v || 0).toLocaleString('es-CO', { maximumFractionDigits: 1 });
const mts = v => v.toFixed(2).replace('.', ',');

/* ---------- escena ---------- */
const cv = $('#cv');
const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
const FONDO_EXT = new THREE.Color('#1c1e1b'), FONDO_INT = new THREE.Color('#d9d3c8');
scene.background = FONDO_EXT;
scene.fog = new THREE.Fog(FONDO_EXT, 160, 420);
const cam = new THREE.PerspectiveCamera(40, 1, 0.05, 3000);
const controls = new OrbitControls(cam, cv);
controls.enableDamping = true; controls.dampingFactor = 0.08;
scene.add(new THREE.HemisphereLight(0xfff6e8, 0x30332c, 0.55));
const sol = new THREE.DirectionalLight(0xfff0dc, 1.6);
sol.position.set(60, 110, 70); sol.castShadow = true; sol.shadow.mapSize.set(2048, 2048);
Object.assign(sol.shadow.camera, { left: -70, right: 70, top: 90, bottom: -20, near: 10, far: 400 });
scene.add(sol);
const suelo = new THREE.Mesh(new THREE.CircleGeometry(400, 64), new THREE.MeshStandardMaterial({ color: '#262823', roughness: 1 }));
suelo.rotation.x = -Math.PI / 2; suelo.receiveShadow = true; scene.add(suelo);
const grid = new THREE.GridHelper(240, 48, 0x3a3c36, 0x2e302b); grid.position.y = 0.01; scene.add(grid);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

/* ---------- utilidades de animación ---------- */
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
let tt; function toast(m) { const el = $('#toast'); el.textContent = m; el.hidden = false; clearTimeout(tt); tt = setTimeout(() => { el.hidden = true; }, 3200); }
const hint = t => { $('#hint').textContent = t; };
const ray = new THREE.Raycaster();
function ndc(e) { const r = cv.getBoundingClientRect(); return new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); }

/* ---------- app ---------- */
let app = null;
try { if (qs.get('c')) app = unb64(qs.get('c')); else if (qs.get('app')) app = leerApp(qs.get('app')); } catch (e) { console.warn(e); }
if (!app) app = { fuente: { tipo: 'demo' }, salaUrl: DEMO_SALA, torre: {}, modelos: {} };
const aptoInicial = qs.get('apto') || (location.hash.match(/apto=([^&]+)/) || [])[1];

let S, T, modo = 'ext', sel = null, hover = null, filtro = 'disponible';

async function main() {
  let res;
  try { res = await resolverSala(app.fuente); }
  catch (e) { $('#ltxt').textContent = 'No se pudo cargar la sala de ventas: ' + e.message; $('.spin').hidden = true; return; }
  S = res.S;
  document.title = (app.nombre || S.proyecto || 'Sala de ventas') + ' · Recorrido 3D';
  $('#t-proy').textContent = app.nombre || S.proyecto || 'Sala de ventas';
  $('#t-sub').textContent = [S.empresa, S.ciudad].filter(Boolean).join(' · ') || 'Recorrido 3D';
  if (app.salaUrl) { $('#a-sala').href = app.salaUrl; $('#a-sala').hidden = false; }

  T = construirTorre(S, app.torre || {});
  scene.add(T.group);
  vistaExterior(false);
  dibujarLista();
  escucharEstados(app.fuente, S, res.overlayKey, () => {
    T.refrescar(sel, hover); dibujarLista(); if (sel) dibujarCard();
    toast('Inventario actualizado desde la sala de ventas');
  });
  $('#loading').hidden = true;
  if (aptoInicial) {
    const m = T.unidades.find(x => String(x.userData.unidad.id) === String(aptoInicial));
    if (m) { seleccionar(m); if (qs.get('entrar') === '1') entrar(m); }
  }
}

/* ---------- exterior ---------- */
let auto = true;
function vistaExterior(animar = true) {
  const r = T.radio, c = T.centro.clone();
  const pos = new THREE.Vector3(r * 1.55, T.alto * 0.62 + 6, r * 2.05);
  controls.minDistance = 8; controls.maxDistance = r * 6; controls.maxPolarAngle = Math.PI * 0.49;
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
if (innerWidth <= 820) { $('#ext').classList.add('collapsed'); }
$('#b-col').onclick = () => { const e = $('#ext'); e.classList.toggle('collapsed'); $('#b-col').textContent = e.classList.contains('collapsed') ? 'Ver unidades' : 'Ocultar'; };

function centroDe(m) { return new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3()); }
function seleccionar(m, enfocar = true) {
  sel = m; T.refrescar(sel, hover); dibujarLista(); dibujarCard();
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
  const C = $('#card'); if (!sel || modo !== 'ext') { C.hidden = true; return; }
  const { unidad: u, piso } = sel.userData, av = u.estado === 'disponible';
  const precio = window.SR ? SR.money(u.precio, S.moneda || 'COP') : '$' + (+u.precio).toLocaleString('es-CO');
  const sep = window.SR && SR.sepValue ? SR.money(SR.sepValue(S, u), S.moneda || 'COP') : '';
  let acts = '';
  if (av) {
    acts += '<button class="btn" data-a="entrar" type="button">Entrar al apartamento →</button>';
    if (app.salaUrl) acts += `<a class="btn ghost" href="${esc(app.salaUrl)}" target="_blank" rel="noopener">Separar en la sala de ventas ↗</a>`;
  } else {
    const alt = T.unidades.find(m => m.userData.unidad.estado === 'disponible' && m.userData.planta.id === sel.userData.planta.id && m.userData.apto.n === sel.userData.apto.n)
      || T.unidades.find(m => m.userData.unidad.estado === 'disponible' && m.userData.planta.id === sel.userData.planta.id);
    acts += `<p class="note">Esta unidad está ${u.estado}.${alt ? ' El ' + esc(alt.userData.unidad.id) + ' tiene la misma tipología y está disponible.' : ''}</p>`;
    if (alt) acts += `<button class="btn ghost" data-a="alt" data-id="${esc(alt.userData.unidad.id)}" type="button">Ver el ${esc(alt.userData.unidad.id)} →</button>`;
  }
  if (S.whatsapp) acts += `<a class="btn ghost" href="https://wa.me/${esc(String(S.whatsapp).replace(/\D/g, ''))}?text=${encodeURIComponent('Hola, me interesa el apartamento ' + u.id + ' de ' + (S.proyecto || '') + '.')}" target="_blank" rel="noopener">Preguntar por WhatsApp</a>`;
  C.innerHTML = `<button class="x" type="button" aria-label="Cerrar">×</button>
    <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;padding-right:28px"><h3>Apto ${esc(u.id)}</h3><span class="pill ${u.estado}">${ESTADO[u.estado]}</span></div>
    <div class="specs"><span>${esc(piso.nombre || 'Piso ' + piso.nivel)}</span><span>${m2(u.area)} m²</span><span>${u.alcobas || '–'} alcobas</span><span>${u.banos || '–'} baños</span></div>
    ${av ? `<div class="price">${precio}${sep ? `<small>Separas con ${S.separacion || 10} %: ${sep}</small>` : ''}</div>` : ''}
    <div class="acts">${acts}</div>`;
  C.hidden = false;
  C.querySelector('.x').onclick = () => { sel = null; T.refrescar(null, hover); C.hidden = true; dibujarLista(); };
  const be = C.querySelector('[data-a=entrar]'); if (be) be.onclick = () => entrar(sel);
  const ba = C.querySelector('[data-a=alt]'); if (ba) ba.onclick = () => seleccionar(T.unidades.find(m => String(m.userData.unidad.id) === ba.dataset.id));
}

/* picking */
let down = null;
cv.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
cv.addEventListener('pointermove', e => {
  if (modo !== 'ext' || !T) return;
  ray.setFromCamera(ndc(e), cam);
  const hit = ray.intersectObjects(T.unidades, false)[0], m = hit && hit.object, tip = $('#tip');
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
    ray.setFromCamera(ndc(e), cam);
    const hit = ray.intersectObjects(T.unidades, false)[0];
    if (hit) seleccionar(hit.object);
  } else if (modo === 'int') clicInterior(e);
});
cv.addEventListener('dblclick', e => {
  if (modo !== 'ext' || !T) return;
  ray.setFromCamera(ndc(e), cam);
  const hit = ray.intersectObjects(T.unidades, false)[0];
  if (hit && hit.object.userData.unidad.estado === 'disponible') entrar(hit.object);
});

/* ---------- entrar al apartamento ---------- */
let I = null, unidadInt = null, herramienta = 'walk', maqueta = false;
const ficha = { visitados: [], medidas: [] };
const marcas = new THREE.Group(); scene.add(marcas);
let etiquetas = [];

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
  const pl = m.userData.planta, modelo = (app.modelos || {})[pl.id] || { tipo: 'referencia' };
  const ctx = { apto: m.userData.apto, esc: T.esc, unidad: u, paleta: (S.recorrido || {}).paleta };
  try {
    if (modelo.tipo === 'archivo') ctx.blob = app.key ? await idb.get(app.key + ':' + pl.id) : null;
    I = await cargarInterior(modelo, ctx);
  } catch (err) {
    console.warn(err);
    toast('No cargó el modelo de la tipología; te mostramos el generado desde la planta.');
    I = await cargarInterior({ tipo: 'planta' }, ctx);
  }
  unidadInt = m;
  T.group.visible = false; suelo.visible = false; grid.visible = false; scene.fog = null; scene.background = FONDO_INT;
  sol.castShadow = false;
  scene.add(I.group);
  modo = 'int'; document.body.classList.add('int');
  ficha.visitados = []; ficha.medidas = []; limpiarMarcas(); dibujarFicha();
  $('#i-title').textContent = 'Apartamento ' + u.id;
  $('#i-sub').textContent = `${m2(u.area)} m² · ${u.alcobas || '–'} alcobas · ${u.banos || '–'} baños · ${I.etiqueta}`;
  $('#ibar').hidden = false; $('#rooms').hidden = false; $('#ipanel').hidden = false;
  if (innerWidth <= 820) $('#ipanel').classList.add('collapsed');
  dibujarCuartos(); dibujarAcabados(); dibujarDecisiones();
  setHerramienta('walk');
  const primera = Object.keys(I.vistas)[0];
  modoMirar(); colocarVista(I.vistas[primera]); marcarCuarto(primera);
  $('#loading').hidden = true; $('#loading').classList.remove('soft');
  $('#fade').classList.remove('on');
}

function modoMirar() {
  maqueta = false; renderer.clippingPlanes = [];
  controls.enableZoom = false; controls.enablePan = false; controls.rotateSpeed = -0.35;
  controls.minDistance = 0; controls.maxDistance = Infinity; controls.maxPolarAngle = Math.PI; controls.minPolarAngle = 0;
  controls.autoRotate = false; cam.fov = 70; cam.near = 0.05; cam.far = 120; cam.updateProjectionMatrix();
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
  return null;
}
const nombreCuarto = id => id ? ((I.vistas[id] && I.vistas[id].n) || (I.nombres && I.nombres[id]) || id) : 'el apartamento';
function marcarCuarto(id) {
  document.querySelectorAll('#rooms button').forEach(b => b.setAttribute('aria-pressed', b.dataset.id === id));
  if (id && !ficha.visitados.includes(id)) { ficha.visitados.push(id); $('#s-r').textContent = ficha.visitados.length; }
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
  if (maqueta) { modoMirar(); const v = I.vistas[Object.keys(I.vistas)[0]]; colocarVista(v); }
  herramienta = t; puntoA = null;
  document.querySelectorAll('.tools button').forEach(b => b.setAttribute('aria-pressed', b.dataset.t === t));
  hint(t === 'medir' ? 'Toca el punto inicial y luego el final de lo que quieres medir'
    : t === 'pintar' ? (pintura ? 'Toca una superficie para pintarla con ' + pintura.nombre : 'Elige un color en Acabados y toca una superficie')
      : 'Arrastra para mirar · toca el piso para caminar');
  if (t === 'pintar') abrirTab('acabados');
  if (t === 'medir') abrirTab('ficha');
}
document.querySelectorAll('.tools button').forEach(b => b.onclick = () => setHerramienta(b.dataset.t));
function verMaqueta() {
  maqueta = true; herramienta = 'maqueta';
  document.querySelectorAll('.tools button').forEach(b => b.setAttribute('aria-pressed', b.dataset.t === 'maqueta'));
  document.querySelectorAll('#rooms button').forEach(b => b.setAttribute('aria-pressed', 'false'));
  renderer.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), I.piso + 2.15)];
  const b = I.box || new THREE.Box3().setFromObject(I.group), c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
  const d = Math.max(s.x, s.z);
  controls.enableZoom = true; controls.enablePan = true; controls.rotateSpeed = 0.8; controls.minDistance = 2; controls.maxDistance = d * 4; controls.maxPolarAngle = Math.PI * 0.48;
  cam.fov = 45; cam.near = 0.1; cam.far = 300; cam.updateProjectionMatrix();
  volar(new THREE.Vector3(c.x + d * 0.55, I.piso + d * 1.05, c.z + d * 0.75), new THREE.Vector3(c.x, I.piso, c.z), 900);
  hint('Vista de maqueta sin techo · arrastra para girar · toca un espacio para volver adentro');
}

/* clics adentro: caminar, medir o pintar */
let puntoA = null, pintura = null;
const originales = new Map();
function clicInterior(e) {
  ray.setFromCamera(ndc(e), cam);
  const hit = ray.intersectObject(I.group, true).find(h => !renderer.clippingPlanes.length || h.point.y < I.piso + 2.15);
  if (!hit) return;
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
    ficha.medidas.push({ len, cuarto: nombreCuarto(cuartoEn(mid)), mueble: '', necesita: null });
    puntoA = null; dibujarFicha(); hint('Medida guardada en tu ficha · toca otro punto para medir de nuevo');
    if (innerWidth <= 820) $('#ipanel').classList.remove('collapsed');
  } else if (herramienta === 'pintar') {
    if (!pintura) { toast('Primero elige un color en Acabados'); return; }
    const o = hit.object;
    if (!originales.has(o)) originales.set(o, o.material);
    const mat = (Array.isArray(o.material) ? o.material[0] : o.material).clone();
    mat.color = new THREE.Color(pintura.hex); mat.map = null; mat.needsUpdate = true;
    o.material = mat;
  }
}
function marca(p) {
  const s = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), new THREE.MeshBasicMaterial({ color: 0xc9a45c, depthTest: false }));
  s.position.copy(p); s.renderOrder = 10; marcas.add(s);
}
function linea(a, b, len) {
  marca(b);
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: 0xc9a45c, depthTest: false }));
  l.renderOrder = 10; marcas.add(l);
  const el = document.createElement('div'); el.className = 'mlabel'; el.textContent = mts(len) + ' m';
  $('#labels').appendChild(el); etiquetas.push({ el, p: a.clone().add(b).multiplyScalar(0.5) });
}
function limpiarMarcas() { marcas.clear(); etiquetas.forEach(x => x.el.remove()); etiquetas = []; puntoA = null; }
$('#b-borrar').onclick = () => { limpiarMarcas(); toast('Borramos las líneas del modelo; las medidas siguen en tu ficha'); };

/* ficha del comprador */
const MUEBLES = ['Sofá', 'Cama', 'Comedor', 'Escritorio', 'Nevera', 'Clóset', 'Biblioteca', 'Otro'];
function veredicto(M) {
  if (!(M.necesita > 0)) return '';
  const libre = M.len - M.necesita;
  if (libre >= 0.6) return `<span class="fit ok">✓ Cabe y te sobran ${mts(libre)} m</span>`;
  if (libre >= 0) return `<span class="fit justo">✓ Cabe justo (${mts(libre)} m). Lo confirmamos en sala con el plano</span>`;
  return `<span class="fit no">✗ No cabe: faltan ${mts(-libre)} m. Tu asesor te muestra otra distribución</span>`;
}
function dibujarFicha() {
  $('#s-m').textContent = ficha.medidas.length; $('#s-r').textContent = ficha.visitados.length;
  const L = $('#mlist'); L.innerHTML = '';
  ficha.medidas.forEach((M, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<b>📏 ${mts(M.len)} m en ${esc(M.cuarto)}</b>
      <div class="row"><select aria-label="Qué mueble"><option value="">¿Qué quieres que quepa?</option>${MUEBLES.map(x => `<option${x === M.mueble ? ' selected' : ''}>${x}</option>`).join('')}</select>
      <input type="text" inputmode="decimal" placeholder="Largo en m" aria-label="Largo del mueble en metros" value="${M.necesita ? mts(M.necesita) : ''}"></div>
      <div class="v">${veredicto(M)}</div>`;
    const [s, inp] = li.querySelectorAll('select,input');
    s.onchange = () => { M.mueble = s.value; };
    inp.onchange = () => { const n = parseFloat(String(inp.value).replace(',', '.')); M.necesita = n > 0 && n < 30 ? n : null; li.querySelector('.v').innerHTML = veredicto(M); };
    L.appendChild(li);
  });
  $('#f-intro').hidden = ficha.medidas.length > 0;
}
$('#b-cita').onclick = () => {
  const u = unidadInt.userData.unidad;
  const lineas = [`Hola, recorrí en 3D el apartamento ${u.id} de ${S.proyecto || 'el proyecto'} y quiero agendar una cita en la sala.`];
  if (ficha.visitados.length) lineas.push('Espacios que vi: ' + ficha.visitados.map(nombreCuarto).join(', ') + '.');
  ficha.medidas.forEach(M => {
    let t = `• ${mts(M.len)} m en ${M.cuarto}`;
    if (M.mueble || M.necesita) t += ` → ${M.mueble || 'mueble'}${M.necesita ? ' de ' + mts(M.necesita) + ' m' : ''}${M.necesita ? (M.len >= M.necesita ? ' (cabe)' : ' (no cabe)') : ''}`;
    lineas.push(t);
  });
  const tel = String(S.whatsapp || '').replace(/\D/g, '');
  if (!tel) { toast('La sala no tiene WhatsApp configurado'); return; }
  window.open('https://wa.me/' + tel + '?text=' + encodeURIComponent(lineas.join('\n')), '_blank', 'noopener');
};

/* acabados y decisiones del proyecto (vienen del recorrido de la sala) */
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

/* salir al edificio */
$('#b-salir').onclick = async () => {
  if (modo !== 'int') return;
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

window.APP3D = { seleccionar: id => seleccionar(T.unidades.find(m => String(m.userData.unidad.id) === String(id))), entrar: id => entrar(T.unidades.find(m => String(m.userData.unidad.id) === String(id))), get S() { return S; }, get modo() { return modo; }, get interior() { return I; }, setHerramienta,
  pick(x, y) { ray.setFromCamera(new THREE.Vector2(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1), cam); return ray.intersectObject(I ? I.group : T.group, true).slice(0, 6).map(h => [h.object.name, h.object.material.name, +h.distance.toFixed(4)]); } };
main();
