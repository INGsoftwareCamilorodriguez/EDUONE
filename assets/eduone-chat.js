/* =====================================================================
   EduOne - eduone-chat.js  (chat privado compartido entre paneles)
   - Agrega la sección "Chat" al menú del panel (barra lateral y menú
     superior del diseño 2026) y la pinta dentro de #contentArea.
   - Aplica las limitaciones de chat por rol (CHAT_BLOQUEOS). Las mismas
     reglas están en firestore.rules, así que no se pueden saltar.
   - La lógica (permisos, envío) está en eduone-comun.js.
   Se carga con: <script type="module" src="../assets/eduone-chat.js"></script>
   ===================================================================== */
import {
    getDocs, collection, query, where, orderBy, limit, onSnapshot, doc, getDoc
} from 'https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js';
import { el, agregarEstilos, agregarSeccion, marcarSeccion } from './eduone-secciones.js?v=20261105';
import { obtenerContexto, chatPermitido, enviarMensajeDirecto, ROL_LABEL, CHAT_BLOQUEOS, nombreDe, uidDe } from './eduone-comun.js?v=20261105';

let ctx = null;
const fecha = t => t?.toDate ? t.toDate().toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '';

// ---------------------------------------------------------------------
// Interfaz
// ---------------------------------------------------------------------
const CSS = `
.edu-chat2{display:grid;grid-template-columns:320px 1fr;gap:16px;min-height:560px;height:calc(100vh - 260px);max-height:760px}
.edu-chat2-lista,.edu-chat2-conv{background:var(--card-bg,#fff);border:1px solid var(--border,#e2e8f0);border-radius:16px;display:flex;flex-direction:column;min-height:0;overflow:hidden}
.edu-chat2-lista{padding:14px;gap:10px}
.edu-chat2-lista h4{font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:var(--text-secondary,#64748b);margin:6px 2px 0}
.edu-chat2-scroll{overflow-y:auto;display:flex;flex-direction:column;gap:4px;min-height:0}
.edu-chat2-scroll.historial{max-height:40%;flex-shrink:0}
.edu-chat2-scroll.contactos{flex:1}
.edu-chat2-item{display:flex;align-items:center;gap:10px;width:100%;padding:9px 10px;border:0;border-radius:12px;background:transparent;text-align:left;cursor:pointer;font:inherit;color:inherit}
.edu-chat2-item:hover,.edu-chat2-item.activo{background:var(--primary-bg,#eff6ff)}
.edu-chat2-avatar{width:38px;height:38px;border-radius:50%;flex-shrink:0;display:grid;place-items:center;background:var(--primary,#2563eb);color:#fff;font-weight:600;overflow:hidden}
.edu-chat2-avatar img{width:100%;height:100%;object-fit:cover}
.edu-chat2-item .info{min-width:0;flex:1}
.edu-chat2-item strong{display:block;font-size:.88rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.edu-chat2-item small{display:block;font-size:.74rem;color:var(--text-secondary,#64748b);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.edu-chat2-dot{min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:#dc2626;color:#fff;font-size:.7rem;display:grid;place-items:center}
.edu-chat2-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--border,#e2e8f0);min-height:64px}
.edu-chat2-head .volver{display:none;border:0;background:transparent;font-size:1.1rem;cursor:pointer;color:inherit;padding:6px}
.edu-chat2-mensajes{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px;background:var(--bg,#f8fafc)}
.edu-chat2-burbuja{max-width:78%;padding:9px 12px;border-radius:14px;background:#fff;border:1px solid var(--border,#e2e8f0);align-self:flex-start;word-wrap:break-word;white-space:pre-wrap}
.edu-chat2-burbuja.propia{align-self:flex-end;background:var(--primary,#2563eb);color:#fff;border-color:transparent}
.edu-chat2-burbuja small{display:block;font-size:.68rem;opacity:.75;margin-top:4px}
.edu-chat2-form{display:flex;gap:8px;padding:12px;border-top:1px solid var(--border,#e2e8f0);align-items:center}
.edu-chat2-form input{flex:1;min-width:0}
.edu-chat2-vacio{margin:auto;text-align:center;color:var(--text-secondary,#64748b);padding:20px}
.edu-chat2-aviso{font-size:.78rem;color:var(--text-secondary,#64748b);background:var(--primary-bg,#eff6ff);border-radius:10px;padding:8px 10px}
@media (max-width:860px){
 .edu-chat2{grid-template-columns:1fr;height:calc(100vh - 200px);min-height:480px}
 .edu-chat2 .edu-chat2-conv{display:none}
 .edu-chat2.abierto .edu-chat2-conv{display:flex}
 .edu-chat2.abierto .edu-chat2-lista{display:none}
 .edu-chat2-head .volver{display:inline-block}
 .edu-chat2-burbuja{max-width:90%}
}`;

function avatar(u) {
    const a = el('span', { class: 'edu-chat2-avatar' });
    const foto = u?.fotoPerfilUrl || u?.fotoUrl || '';
    if (/^https:\/\//.test(foto)) a.append(el('img', { src: foto, alt: '', loading: 'lazy' }));
    else a.textContent = nombreDe(u).charAt(0).toUpperCase();
    return a;
}

const CLAVE_LEIDO = uid => 'eduone_chat_leido_' + uid;
function leidos() { try { return JSON.parse(localStorage.getItem(CLAVE_LEIDO(ctx.uid)) || '{}'); } catch { return {}; } }
function marcarLeido(chatId) {
    try { const l = leidos(); l[chatId] = Date.now(); localStorage.setItem(CLAVE_LEIDO(ctx.uid), JSON.stringify(l)); } catch { /* */ }
}

let contactos = [];
let chats = [];
let destino = null;
let offMensajes = null;

function montarUI() {
    const seccion = agregarSeccion({ id: 'chat', icono: 'fas fa-comments', texto: 'Chat' });
    if (!seccion) return null;
    agregarEstilos('eduChatCss', CSS);

    const buscar = el('input', { type: 'search', class: 'form-control', id: 'eduChatBuscar', placeholder: 'Buscar persona por nombre o rol...', 'aria-label': 'Buscar persona', maxlength: '60' });
    const filtroRol = el('select', { class: 'form-control', id: 'eduChatFiltroRol', 'aria-label': 'Filtrar por rol' }, el('option', { value: '', text: 'Todos los roles' }));
    const historial = el('div', { class: 'edu-chat2-scroll historial', id: 'eduChatHistorial' });
    const lista = el('div', { class: 'edu-chat2-scroll contactos', id: 'eduChatContactos' });
    const aviso = el('div', { class: 'edu-chat2-aviso', id: 'eduChatAviso' });
    const cabecera = el('div', { class: 'edu-chat2-head' },
        el('button', { type: 'button', class: 'volver', 'aria-label': 'Volver a la lista', onclick: () => raiz.classList.remove('abierto') }, el('i', { class: 'fas fa-arrow-left' })),
        el('div', { id: 'eduChatCabecera', class: 'info' }, el('strong', { text: 'Selecciona una conversación' })));
    const mensajes = el('div', { class: 'edu-chat2-mensajes', id: 'eduChatMensajes' }, el('p', { class: 'edu-chat2-vacio', text: 'Elige una persona de la lista para comenzar a conversar.' }));
    const texto = el('input', { type: 'text', class: 'form-control', id: 'eduChatTexto', placeholder: 'Escribe un mensaje...', maxlength: '1000', disabled: true, autocomplete: 'off', 'aria-label': 'Mensaje' });
    const enviar = el('button', { type: 'submit', class: 'btn-primary', id: 'eduChatEnviar', disabled: true }, el('i', { class: 'fas fa-paper-plane' }), el('span', { class: 'edu-chat2-enviar-txt', text: ' Enviar' }));
    const form = el('form', { class: 'edu-chat2-form', id: 'eduChatForm' }, texto, enviar);

    const raiz = el('div', { class: 'edu-chat2', id: 'eduChat' },
        el('aside', { class: 'edu-chat2-lista' }, buscar, filtroRol, aviso,
            el('h4', { text: 'Conversaciones' }), historial,
            el('h4', { text: 'Personas' }), lista),
        el('section', { class: 'edu-chat2-conv' }, cabecera, mensajes, form));
    seccion.pagina.append(raiz);

    buscar.addEventListener('input', pintarContactos);
    filtroRol.addEventListener('change', pintarContactos);
    form.addEventListener('submit', enviarDesdeForm);
    return raiz;
}

function pintarContactos() {
    const host = document.getElementById('eduChatContactos');
    if (!host) return;
    const f = (document.getElementById('eduChatBuscar')?.value || '').trim().toLocaleLowerCase('es');
    const r = document.getElementById('eduChatFiltroRol')?.value || '';
    const res = contactos.filter(u => (!r || u.rol === r) &&
        (`${nombreDe(u)} ${ROL_LABEL[u.rol] || u.rol}`).toLocaleLowerCase('es').includes(f)).slice(0, 80);
    host.replaceChildren(...res.map(u => itemContacto(u)));
    if (!res.length) host.append(el('p', { class: 'edu-chat2-vacio', text: contactos.length ? 'Sin resultados' : 'No hay personas disponibles' }));
}

function itemContacto(u, extra) {
    const b = el('button', { type: 'button', class: 'edu-chat2-item' + (destino?.id === u.id ? ' activo' : '') },
        avatar(u),
        el('span', { class: 'info' }, el('strong', { text: nombreDe(u) }), el('small', { text: extra?.sub || ROL_LABEL[u.rol] || u.rol || '' })));
    if (extra?.noLeidos) b.append(el('span', { class: 'edu-chat2-dot', text: '●' }));
    b.addEventListener('click', () => abrirConversacion(u));
    return b;
}

function pintarHistorial() {
    const host = document.getElementById('eduChatHistorial');
    if (!host) return;
    const l = leidos();
    let pendientes = 0;
    const items = [];
    for (const c of chats) {
        const otro = (c.participantes || []).find(x => x !== ctx.uid);
        const u = contactos.find(p => p.id === otro);
        if (!u) continue; // conversación con alguien no permitido / inactivo
        const ts = c.actualizadoEn?.toMillis?.() || 0;
        const noLeido = c.ultimoRemitente && c.ultimoRemitente !== ctx.uid && ts > (l[c.id] || 0) && destino?.id !== u.id;
        if (noLeido) pendientes++;
        items.push(itemContacto(u, { sub: c.ultimoTexto || ROL_LABEL[u.rol] || '', noLeidos: noLeido }));
    }
    host.replaceChildren(...items);
    if (!items.length) host.append(el('p', { class: 'edu-chat2-vacio', text: 'Aún no tienes conversaciones' }));
    actualizarBadge(pendientes);
}

function actualizarBadge(n) { marcarSeccion('chat', n); }

async function abrirConversacion(u) {
    destino = u;
    const raiz = document.getElementById('eduChat');
    raiz?.classList.add('abierto');
    const cab = document.getElementById('eduChatCabecera');
    cab.replaceChildren(el('div', { class: 'edu-chat2-item', style: 'padding:0;cursor:default' }, avatar(u),
        el('span', { class: 'info' }, el('strong', { text: nombreDe(u) }), el('small', { text: ROL_LABEL[u.rol] || u.rol || '' }))));
    const txt = document.getElementById('eduChatTexto');
    txt.disabled = false; document.getElementById('eduChatEnviar').disabled = false;
    if (window.matchMedia('(pointer: fine)').matches) txt.focus();
    pintarContactos();

    const host = document.getElementById('eduChatMensajes');
    host.replaceChildren(el('p', { class: 'edu-chat2-vacio', text: 'Cargando conversación...' }));
    offMensajes?.(); offMensajes = null;
    const chatId = [ctx.uid, u.id].sort().join('_');
    const ref = doc(ctx.db, 'colegios', ctx.colegioId, 'chats', chatId);
    try {
        const existe = await getDoc(ref).catch(() => null);
        if (!existe?.exists()) {
            host.replaceChildren(el('p', { class: 'edu-chat2-vacio', text: 'Aún no hay mensajes. ¡Escribe el primero!' }));
            marcarLeido(chatId); pintarHistorial();
            return;
        }
    } catch { /* sigue */ }
    if (destino?.id !== u.id) return;
    offMensajes = onSnapshot(query(collection(ref, 'mensajes'), orderBy('creadoEn', 'asc'), limit(200)), snap => {
        host.replaceChildren();
        snap.forEach(d => {
            const m = d.data();
            const b = el('div', { class: 'edu-chat2-burbuja' + (m.remitenteUid === ctx.uid ? ' propia' : '') }, el('span', { text: m.texto || '' }));
            if (m.imagenUrl && /^https:\/\//.test(m.imagenUrl)) b.append(el('img', { src: m.imagenUrl, alt: 'Imagen adjunta', loading: 'lazy', style: 'max-width:240px;width:100%;border-radius:10px;display:block;margin-top:6px' }));
            if (m.archivoUrl && /^https:\/\//.test(m.archivoUrl)) b.append(el('a', { href: m.archivoUrl, target: '_blank', rel: 'noopener noreferrer', text: '📎 ' + (m.archivoNombre || 'Ver archivo'), style: 'color:inherit;display:block;margin-top:4px' }));
            b.append(el('small', { text: fecha(m.creadoEn) }));
            host.append(b);
        });
        if (!snap.size) host.append(el('p', { class: 'edu-chat2-vacio', text: 'Aún no hay mensajes. ¡Escribe el primero!' }));
        host.scrollTop = host.scrollHeight;
        marcarLeido(chatId); pintarHistorial();
    }, e => host.replaceChildren(el('p', { class: 'edu-chat2-vacio', text: 'No se pudo cargar la conversación: ' + e.message })));
}

async function enviarDesdeForm(e) {
    e.preventDefault();
    const input = document.getElementById('eduChatTexto');
    const texto = input.value.trim();
    if (!texto || !destino) return;
    const btn = document.getElementById('eduChatEnviar');
    btn.disabled = true;
    try {
        const ok = await enviarMensajeDirecto(destino.id, texto, destino.rol);
        if (!ok) throw new Error('Tu rol no tiene permitido chatear con esta persona.');
        input.value = '';
        if (!offMensajes) await abrirConversacion(destino);
    } catch (err) {
        alert('No se pudo enviar: ' + err.message);
    } finally {
        btn.disabled = false;
        if (window.matchMedia('(pointer: fine)').matches) input.focus();
    }
}

async function iniciar() {
    let c;
    try { c = ctx = await obtenerContexto(); } catch (e) { console.warn('EduOne chat:', e.message); return; }
    if (!c.colegioId || !c.rol || c.rol === 'superadmin') return;
    if (!montarUI()) return;

    const bloqueados = c.rol === 'contador'
        ? 'Solo puedes chatear con secretaría y rectoría.'
        : (CHAT_BLOQUEOS[c.rol] || []).length
            ? 'No disponible con: ' + [...new Set(CHAT_BLOQUEOS[c.rol])].map(r => ROL_LABEL[r] || r).join(', ') + '.'
            : '';
    const aviso = document.getElementById('eduChatAviso');
    if (bloqueados) aviso.textContent = bloqueados; else aviso.remove();

    try {
        const snap = await getDocs(query(collection(c.db, 'usuarios'), where('colegioId', '==', c.colegioId)));
        contactos = snap.docs
            .map(d => ({ id: uidDe(d), ...d.data() }))
            .filter(u => u.id !== c.uid && u.activo !== false && chatPermitido(c.rol, u.rol))
            .sort((a, b) => nombreDe(a).localeCompare(nombreDe(b), 'es'));
    } catch (e) {
        document.getElementById('eduChatContactos').replaceChildren(el('p', { class: 'edu-chat2-vacio', text: 'No se pudieron cargar los contactos: ' + e.message }));
        return;
    }
    const roles = [...new Set(contactos.map(u => u.rol))].sort((a, b) => (ROL_LABEL[a] || a).localeCompare(ROL_LABEL[b] || b, 'es'));
    const filtro = document.getElementById('eduChatFiltroRol');
    roles.forEach(r => filtro.append(el('option', { value: r, text: ROL_LABEL[r] || r })));
    pintarContactos();

    onSnapshot(query(collection(c.db, 'colegios', c.colegioId, 'chats'), where('participantes', 'array-contains', c.uid)), snap => {
        chats = snap.docs.map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (b.actualizadoEn?.toMillis?.() || 0) - (a.actualizadoEn?.toMillis?.() || 0));
        pintarHistorial();
    }, e => console.warn('EduOne chat historial:', e.message));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
else iniciar();
