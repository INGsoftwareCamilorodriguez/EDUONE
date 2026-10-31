/* =====================================================================
   EduOne - eduone-ui.js  (módulo compartido por todos los paneles)
   1) Logo de EduOne en el encabezado, la barra lateral y la pestaña.
   2) Botón "Activar notificaciones" único para todos los roles
      (responsive: texto en escritorio, solo campana en celular).
   3) Selector de emojis para el chat y los comunicados.
   Se carga con: <script type="module" src="../assets/eduone-ui.js"></script>
   ===================================================================== */
import { getApps } from 'https://www.gstatic.com/firebasejs/11.3.1/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.3.1/firebase-auth.js';
import { getFirestore, doc, updateDoc, arrayUnion } from 'https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js';
import { getMessaging, getToken, onMessage, isSupported } from 'https://www.gstatic.com/firebasejs/11.3.1/firebase-messaging.js';

const VAPID_KEY = 'BEZ1FHZlfPST9VbY7GSpEAMzPjTOfmTQKRV6HCCI5esMChTrkeqpX51fM0NRwjbR60qifqoYwh6q2gSfHWsrrcs';
const SW_URL = '/firebase-messaging-sw.js';
const LOGO_URL = new URL('../imagenes/logo-96.png', import.meta.url).href;
const LOGO_ICON_URL = new URL('../imagenes/logo-192.png', import.meta.url).href;

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------
function el(tag, props = {}, children = []) {
    const n = document.createElement(tag);
    Object.assign(n, props);
    for (const c of [].concat(children)) n.append(c);
    return n;
}

let toastTimer = null;
function toast(texto, tipo = 'info', ms = 5000) {
    let t = document.getElementById('eduUiToast');
    if (!t) {
        t = el('div', { id: 'eduUiToast', className: 'edu-ui-toast' });
        t.setAttribute('role', 'status');
        t.setAttribute('aria-live', 'polite');
        t.addEventListener('click', () => t.classList.remove('visible'));
        document.body.append(t);
    }
    t.dataset.tipo = tipo;
    t.textContent = texto;
    t.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('visible'), ms);
}

const esperar = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------
// 1) LOGO
// ---------------------------------------------------------------------
function logoImg(clase) {
    const img = el('img', { src: LOGO_URL, alt: 'EduOne', className: clase, width: 34, height: 34, decoding: 'async' });
    return img;
}

function aplicarLogo() {
    // Barra lateral y marcas que usaban el icono de birrete
    document.querySelectorAll('.sidebar-header .logo > i.fa-graduation-cap, .edu-brand i.fa-graduation-cap')
        .forEach(i => i.replaceWith(logoImg('edu-logo-img')));

    // Encabezados sin marca (acudiente, secretaría, coordinadores, admin, rector)
    const header = document.querySelector('.top-header');
    if (header && !header.querySelector('.edu-brand, .edu-header-logo')) {
        const left = header.querySelector('.header-left') || header;
        const hamburger = left.querySelector('.hamburger-btn');
        const logo = logoImg('edu-header-logo');
        if (hamburger) hamburger.after(logo); else left.prepend(logo);
    }

    // Ícono de la pestaña
    if (!document.querySelector('link[rel~="icon"]')) {
        document.head.append(el('link', { rel: 'icon', type: 'image/png', href: LOGO_ICON_URL }));
        document.head.append(el('link', { rel: 'apple-touch-icon', href: LOGO_ICON_URL }));
    }
}

// ---------------------------------------------------------------------
// 2) NOTIFICACIONES PUSH (FCM)
// ---------------------------------------------------------------------
const esIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const esPWA = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

let pushBtn = null;
let pushEnProceso = false;
let escuchandoPrimerPlano = false;
let usuario = null;
let appFirebase = null;

function claveToken(uid) { return 'eduone_push_' + uid; }
function leerTokenGuardado(uid) { try { return localStorage.getItem(claveToken(uid)); } catch { return null; } }
function guardarTokenLocal(uid, token) { try { localStorage.setItem(claveToken(uid), token); } catch { /* sin storage */ } }

function crearBotonPush() {
    if (pushBtn) return pushBtn;
    const header = document.querySelector('.top-header');
    const destino = header?.querySelector('.header-right, .edu-user');
    if (!destino) return null;
    pushBtn = el('button', { type: 'button', id: 'eduPushBtn', className: 'edu-push-btn', title: 'Activar notificaciones' }, [
        el('i', { className: 'fas fa-bell' }),
        el('span', { className: 'edu-push-text', textContent: 'Activar notificaciones' })
    ]);
    pushBtn.setAttribute('aria-label', 'Activar notificaciones');
    pushBtn.hidden = true;
    pushBtn.addEventListener('click', () => activarPush(true));
    const campana = destino.querySelector('#notificacionesBtn');
    if (campana) campana.after(pushBtn); else destino.prepend(pushBtn);
    return pushBtn;
}

function mostrarBoton(visible) {
    const b = crearBotonPush();
    if (b) b.hidden = !visible;
}

// Registra el service worker y espera a que quede ACTIVO.
// Sin esta espera, getToken() falla la primera vez ("no active Service Worker")
// y aparecía un mensaje de error falso antes del mensaje de éxito.
async function serviceWorkerActivo() {
    const reg = await navigator.serviceWorker.register(SW_URL, { scope: '/' });
    const sw = reg.installing || reg.waiting || reg.active;
    if (sw && sw.state !== 'activated') {
        await new Promise(resolve => {
            const t = setTimeout(resolve, 10000);
            sw.addEventListener('statechange', () => {
                if (sw.state === 'activated') { clearTimeout(t); resolve(); }
            });
        });
    }
    return reg;
}

async function obtenerToken(messaging, reg) {
    try {
        return await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    } catch (e) {
        // Un reintento cubre la carrera de activación del service worker
        await esperar(1500);
        return await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    }
}

function escucharPrimerPlano(messaging) {
    if (escuchandoPrimerPlano) return;
    escuchandoPrimerPlano = true;
    onMessage(messaging, payload => {
        const titulo = payload.notification?.title || payload.data?.titulo || 'EduOne';
        const cuerpo = payload.notification?.body || payload.data?.cuerpo || 'Tienes una notificación nueva';
        toast(titulo + ' — ' + cuerpo, 'info', 7000);
    });
}

async function activarPush(desdeClic) {
    if (pushEnProceso || !usuario) return;

    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
        if (desdeClic) {
            toast(esIOS && !esPWA
                ? 'En iPhone: toca Compartir → "Agregar a inicio", abre EduOne desde ese ícono y activa las notificaciones.'
                : 'Este navegador no admite notificaciones. Usa Chrome actualizado.', 'warning', 9000);
        }
        return;
    }
    if (!window.isSecureContext) {
        if (desdeClic) toast('Abre EduOne con https:// para activar las notificaciones.', 'warning');
        return;
    }
    if (Notification.permission === 'denied') {
        mostrarBoton(true);
        if (desdeClic) toast('Las notificaciones están bloqueadas. Toca el candado junto a la dirección → Notificaciones → Permitir, y recarga la página.', 'warning', 10000);
        return;
    }
    if (Notification.permission !== 'granted' && !desdeClic) { mostrarBoton(true); return; }

    pushEnProceso = true;
    if (pushBtn) pushBtn.disabled = true;
    try {
        if (!(await isSupported())) throw new Error('Este navegador no es compatible con las notificaciones de EduOne.');
        if (Notification.permission !== 'granted') {
            const permiso = await Notification.requestPermission();
            if (permiso !== 'granted') {
                mostrarBoton(true);
                toast('No se autorizaron las notificaciones.', 'warning');
                return;
            }
        }
        const reg = await serviceWorkerActivo();
        const messaging = getMessaging(appFirebase);
        const token = await obtenerToken(messaging, reg);
        if (!token) throw new Error('Firebase no entregó el código de este dispositivo.');

        if (leerTokenGuardado(usuario.uid) !== token) {
            await updateDoc(doc(getFirestore(appFirebase), 'usuarios', usuario.uid), { fcmTokens: arrayUnion(token) });
            guardarTokenLocal(usuario.uid, token);
        }
        escucharPrimerPlano(messaging);
        mostrarBoton(false);
        if (desdeClic) toast('Notificaciones activadas en este dispositivo.', 'success');
    } catch (e) {
        console.error('EduOne notificaciones:', e);
        mostrarBoton(true);
        if (desdeClic) toast('No se pudieron activar las notificaciones: ' + (e?.message || e), 'error', 8000);
    } finally {
        pushEnProceso = false;
        if (pushBtn) pushBtn.disabled = false;
    }
}

async function iniciarPush() {
    // Espera a que la página inicialice Firebase
    for (let i = 0; i < 75 && !getApps().length; i++) await esperar(200);
    if (!getApps().length) return;
    appFirebase = getApps().find(a => a.name === '[DEFAULT]') || getApps()[0];
    onAuthStateChanged(getAuth(appFirebase), user => {
        usuario = user;
        if (!user) { mostrarBoton(false); return; }
        crearBotonPush();
        // Con permiso ya concedido se registra en silencio (sin mensajes)
        activarPush(false);
    });
}

// ---------------------------------------------------------------------
// 3) SELECTOR DE EMOJIS
// ---------------------------------------------------------------------
const EMOJIS = {
    'Caras': '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 😉 😍 🥰 😘 😋 😜 🤪 😎 🤓 🧐 🤔 🤗 🤭 😐 😶 🙄 😏 😬 😌 😔 😴 😷 🤒 🥳 😮 😲 😳 🥺 😢 😭 😤 😡 🤯 😱 😥 😓',
    'Gestos': '👍 👎 👌 ✌️ 🤞 🤟 👏 🙌 👐 🤝 🙏 💪 👋 ✋ ☝️ 👆 👇 👉 👈 ✍️ 🫶 ❤️ 🧡 💛 💚 💙 💜 🤍 💯 💥 ✨ ⭐ 🌟 🔥',
    'Escuela': '📚 📖 📝 ✏️ 🖊️ 📒 📓 📔 📕 📗 📘 📙 📐 📏 🎒 🏫 🎓 👩‍🏫 👨‍🏫 🧑‍🎓 💻 🖥️ 🧮 🔬 🧪 🧬 🌍 🗺️ 🎨 🎵 ⚽ 🏀 🏆 🥇 📅 ⏰ 📌 📎 📊 📈',
    'Símbolos': '✅ ☑️ ✔️ ❌ ❗ ❓ ⚠️ 🚫 ⛔ 🔔 📢 📣 💬 💡 📩 📞 ➕ ➖ ➡️ ⬅️ ⬆️ ⬇️ 🔴 🟠 🟡 🟢 🔵 🟣 ⚪ ⚫',
    'Celebración': '🎉 🎊 🎈 🎁 🎂 🍰 🥂 🏅 🎖️ 👑 💐 🌸 🌻 🌈 ☀️ 🌙 ⛅ 🍎 🍕 🍔 🍟 🍦 ☕ 🧃'
};
const SELECTORES_EMOJI = '#chatTexto, #eduChatTexto, #eduChatText, #comunicadoTexto, [data-emoji]';

let picker = null;
let destinoEmoji = null;
let botonActivo = null;

function crearPicker() {
    if (picker) return picker;
    const tabs = el('div', { className: 'edu-emoji-tabs' });
    const grid = el('div', { className: 'edu-emoji-grid' });
    picker = el('div', { className: 'edu-emoji-picker', id: 'eduEmojiPicker' }, [tabs, grid]);
    picker.setAttribute('role', 'dialog');
    picker.setAttribute('aria-label', 'Elegir emoji');
    picker.hidden = true;

    const mostrarCategoria = nombre => {
        tabs.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.cat === nombre));
        grid.replaceChildren(...EMOJIS[nombre].split(' ').map(e => {
            const b = el('button', { type: 'button', className: 'edu-emoji-item', textContent: e, title: e });
            b.dataset.emoji = e;
            return b;
        }));
    };
    Object.keys(EMOJIS).forEach((nombre, i) => {
        const b = el('button', { type: 'button', textContent: EMOJIS[nombre].split(' ')[0], title: nombre });
        b.dataset.cat = nombre;
        b.setAttribute('aria-label', nombre);
        tabs.append(b);
        if (i === 0) mostrarCategoria(nombre);
    });
    tabs.addEventListener('click', e => {
        const b = e.target.closest('button[data-cat]');
        if (b) mostrarCategoria(b.dataset.cat);
    });
    // mousedown evita que el campo pierda el cursor en escritorio
    grid.addEventListener('mousedown', e => e.preventDefault());
    grid.addEventListener('click', e => {
        const b = e.target.closest('.edu-emoji-item');
        if (b) insertarEmoji(b.dataset.emoji);
    });
    document.body.append(picker);

    document.addEventListener('pointerdown', e => {
        if (!picker.hidden && !picker.contains(e.target) && !e.target.closest('.edu-emoji-btn')) cerrarPicker();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarPicker(); });
    window.addEventListener('resize', () => { if (!picker.hidden) posicionarPicker(); });
    return picker;
}

function posicionarPicker() {
    if (!botonActivo) return;
    if (window.matchMedia('(max-width: 600px)').matches) {
        picker.style.left = picker.style.top = '';
        return; // en celular se muestra como panel inferior (CSS)
    }
    const r = botonActivo.getBoundingClientRect();
    const w = picker.offsetWidth, h = picker.offsetHeight;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    const top = r.top - h - 8 > 8 ? r.top - h - 8 : Math.min(r.bottom + 8, window.innerHeight - h - 8);
    picker.style.left = left + 'px';
    picker.style.top = top + 'px';
}

function abrirPicker(boton, campo) {
    if (campo.disabled || campo.readOnly) {
        toast('Primero selecciona una conversación.', 'warning', 3500);
        return;
    }
    crearPicker();
    if (!picker.hidden && botonActivo === boton) { cerrarPicker(); return; }
    destinoEmoji = campo;
    botonActivo = boton;
    picker.hidden = false;
    boton.setAttribute('aria-expanded', 'true');
    posicionarPicker();
}

function cerrarPicker() {
    if (!picker || picker.hidden) return;
    picker.hidden = true;
    botonActivo?.setAttribute('aria-expanded', 'false');
}

function insertarEmoji(emoji) {
    const campo = destinoEmoji;
    if (!campo || campo.disabled) return;
    const max = campo.maxLength > 0 ? campo.maxLength : Infinity;
    if (campo.value.length + emoji.length > max) { toast('El mensaje llegó al límite de caracteres.', 'warning', 3000); return; }
    const inicio = campo.selectionStart ?? campo.value.length;
    const fin = campo.selectionEnd ?? campo.value.length;
    campo.setRangeText(emoji, inicio, fin, 'end');
    campo.dispatchEvent(new Event('input', { bubbles: true }));
    // En celular no se enfoca para no abrir el teclado encima del selector
    if (window.matchMedia('(pointer: fine)').matches) campo.focus();
}

function prepararCampoEmoji(campo) {
    if (campo.dataset.emojiListo) return;
    campo.dataset.emojiListo = '1';
    const boton = el('button', { type: 'button', className: 'edu-emoji-btn', textContent: '😊', title: 'Insertar emoji' });
    boton.setAttribute('aria-label', 'Insertar emoji');
    boton.setAttribute('aria-haspopup', 'dialog');
    boton.setAttribute('aria-expanded', 'false');
    boton.addEventListener('click', () => abrirPicker(boton, campo));
    if (campo.tagName === 'TEXTAREA') {
        boton.classList.add('edu-emoji-btn--area');
        campo.after(boton);
    } else {
        campo.before(boton);
    }
}

function buscarCamposEmoji() {
    document.querySelectorAll(SELECTORES_EMOJI).forEach(c => {
        if ((c.tagName === 'INPUT' && (c.type === 'text' || c.type === 'search' || !c.getAttribute('type'))) || c.tagName === 'TEXTAREA') {
            prepararCampoEmoji(c);
        }
    });
}

// ---------------------------------------------------------------------
// Inicio
// ---------------------------------------------------------------------
function iniciar() {
    aplicarLogo();
    buscarCamposEmoji();
    let pendiente = false;
    new MutationObserver(() => {
        if (pendiente) return;
        pendiente = true;
        requestAnimationFrame(() => { pendiente = false; buscarCamposEmoji(); });
    }).observe(document.body, { childList: true, subtree: true });
    iniciarPush();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
else iniciar();
