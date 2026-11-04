/*!
 * Envío de la cita con el recorrido del comprador a los canales que el dashboard tenga activos:
 *   · CRM de Life City (Firestore, colección "leads" vía lead.js del repo proyectos-LIFECITY/crm)
 *   · HubSpot (Forms API pública: portalId + formId, sin llaves privadas en el navegador)
 *   · Webhook (Make, Zapier, n8n, Pipedrive, Google Apps Script…): recibe el JSON completo
 *   · WhatsApp del asesor (link con el resumen; lo abre el comprador)
 */
const LC_CRM = 'https://proyectos-lifecity.github.io/crm/lead.js';
const mts = v => (+v).toFixed(2).replace('.', ',');

export function resumenTexto(p) {
  const L = [];
  L.push(`Cita: ${p.cita.fechaTexto} a las ${p.cita.hora}${p.cita.modalidad ? ' · ' + p.cita.modalidad : ''}`);
  L.push(`Cliente: ${p.cliente.nombre} · ${p.cliente.celular}${p.cliente.correo ? ' · ' + p.cliente.correo : ''}`);
  const u = p.unidad;
  if (u) L.push(`Proyecto: ${p.proyecto} · Apto ${u.id} (${u.piso}, ${u.area} m², ${u.alcobas} alc, ${u.banos} baños) · ${u.precioTexto} · ${u.estado}`);
  else L.push(`Proyecto: ${p.proyecto}`);
  const r = p.recorrido;
  if (r.perfil) L.push(`Busca: ${r.perfil}`);
  if (r.unidadesVistas.length) L.push(`Unidades que miró: ${r.unidadesVistas.join(', ')}`);
  if (r.espacios.length) L.push(`Recorrido 3D (${r.minutos} min): ${r.espacios.map(e => e.unidad + ' ' + e.espacio).join(', ')}`);
  if (r.respuestas.length) { L.push('Respuestas:'); r.respuestas.forEach(x => L.push(`- [${x.unidad} · ${x.espacio}] ${x.pregunta} → ${x.respuesta}`)); }
  if (r.medidas.length) {
    L.push('Medidas:');
    r.medidas.forEach(m => L.push(`- ${mts(m.metros)} m en ${m.espacio} (${m.unidad})${m.mueble || m.necesita ? ' → ' + (m.mueble || 'mueble') + (m.necesita ? ' de ' + mts(m.necesita) + ' m: ' + (m.cabe ? 'cabe' : 'no cabe') : '') : ''}`));
  }
  if (r.acabados.length) L.push('Acabados que probó: ' + r.acabados.map(a => a.superficie + ' → ' + a.color).join(', '));
  if (r.notas.length) { L.push('Comentarios:'); r.notas.forEach(n => L.push('- ' + n.texto)); }
  if (p.cita.nota) L.push('Nota: ' + p.cita.nota);
  return L.join('\n');
}

function separar(nombre) { const p = String(nombre || '').trim().split(/\s+/); return [p.shift() || '', p.join(' ')]; }

async function lifecity(p, texto) {
  const { guardarLead } = await import(LC_CRM);
  await guardarLead({
    nombre: p.cliente.nombre, celular: p.cliente.celular, correo: p.cliente.correo,
    monto: p.unidad ? p.unidad.precio : undefined, mensaje: texto,
    proyecto: p.proyecto + (p.unidad ? ' · Apto ' + p.unidad.id : ''), origen: 'App 3D sala de ventas · ' + p.proyecto
  });
}
async function hubspot(cfg, p, texto) {
  const [nom, ape] = separar(p.cliente.nombre);
  const fields = [
    { name: 'firstname', value: nom }, { name: 'lastname', value: ape },
    { name: 'phone', value: p.cliente.celular }, { name: 'message', value: texto }
  ];
  if (p.cliente.correo) fields.push({ name: 'email', value: p.cliente.correo });
  const r = await fetch(`https://api.hsforms.com/submissions/v3/integration/submit/${encodeURIComponent(cfg.portalId)}/${encodeURIComponent(cfg.formId)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields, context: { pageUri: location.href, pageName: document.title } })
  });
  if (!r.ok) { let m = ''; try { m = (await r.json()).message || ''; } catch (e) {} throw new Error('HubSpot respondió ' + r.status + (m ? ': ' + m : '')); }
}
async function webhook(url, p, texto) {
  const body = JSON.stringify(Object.assign({ evento: 'cita_sala_ventas', resumen: texto }, p));
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    if (!r.ok) throw new Error('El webhook respondió ' + r.status);
  } catch (e) {
    if (/respondió/.test(e.message)) throw e;
    // muchos webhooks (Apps Script, algunos n8n) no aceptan CORS: se manda igual sin leer la respuesta
    await fetch(url, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body });
  }
}
export function linkWhatsApp(tel, texto) {
  tel = String(tel || '').replace(/\D/g, '');
  return tel ? 'https://wa.me/' + tel + '?text=' + encodeURIComponent(texto) : '';
}

/* → [{canal, ok, error}] */
export async function enviarCita(app, p) {
  const texto = resumenTexto(p), crm = app.crm || {}, out = [];
  const tareas = [];
  if (crm.lifecity) tareas.push(['CRM Life City', () => lifecity(p, texto)]);
  if (crm.hubspot && crm.hubspot.portalId && crm.hubspot.formId) tareas.push(['HubSpot', () => hubspot(crm.hubspot, p, texto)]);
  if (crm.webhook && /^https:\/\//.test(crm.webhook.url || '')) tareas.push(['Webhook', () => webhook(crm.webhook.url, p, texto)]);
  await Promise.all(tareas.map(async ([canal, fn]) => {
    try { await fn(); out.push({ canal, ok: true }); } catch (e) { console.warn(canal, e); out.push({ canal, ok: false, error: e.message }); }
  }));
  return { texto, canales: out };
}
