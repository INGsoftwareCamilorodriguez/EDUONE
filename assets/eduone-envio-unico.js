/* =====================================================================
   EduOne - eduone-envio-unico.js  (cada envío se procesa una sola vez)
   Aplica a TODOS los formularios de TODOS los roles (tareas, notas,
   registros, pagos, citas, mensajes...):
   1) Doble clic / Enter repetido: mientras un formulario se está enviando,
      los demás intentos se ignoran.
   2) Dos pestañas o dos dispositivos con la misma cuenta enviando la misma
      información al mismo tiempo: solo el primero pasa. Se usa un "candado"
      en Firestore (colección envios) que las reglas solo dejan crear una vez
      cada 20 segundos para el mismo contenido; el segundo envío se rechaza
      en el servidor, no solo en el navegador.
   3) Botones de acción (guardar, registrar, enviar...): un segundo clic
      dentro del mismo segundo se ignora.
   Excepciones: formularios con data-envio-libre y buscadores.
   Lo importa eduone-ui.js en todos los paneles.
   ===================================================================== */
import { getApps } from 'https://www.gstatic.com/firebasejs/11.3.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/11.3.1/firebase-auth.js';
import { getFirestore, doc, setDoc, getDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js';

const VENTANA_SEG = 20;              // mismo contenido dentro de esta ventana = repetido
const ESPERA_MAX_MS = 5000;          // sin respuesta del servidor (sin internet): no se bloquea el panel
const MSG_REPETIDO = 'Esta misma información ya se envió hace unos segundos (desde esta u otra pestaña o dispositivo). Solo se registra una vez.';
const MSG_EN_CURSO = 'Ya se está enviando, espera un momento...';

const enCurso = new WeakSet();
const aprobados = new WeakSet();

function aviso(texto) {
    let t = document.getElementById('eduEnvioAviso');
    if (!t) {
        t = document.createElement('div');
        t.id = 'eduEnvioAviso';
        t.setAttribute('role', 'status');
        t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:4000;max-width:min(560px,92vw);padding:12px 18px;border-radius:12px;background:#1e293b;color:#fff;font:600 .88rem Inter,system-ui,sans-serif;box-shadow:0 12px 30px rgba(15,23,42,.3);text-align:center;display:none';
        t.addEventListener('click', () => { t.style.display = 'none'; });
        document.body.append(t);
    }
    t.textContent = texto;
    t.style.display = 'block';
    clearTimeout(t._h);
    t._h = setTimeout(() => { t.style.display = 'none'; }, 5000);
}

const esBusqueda = form => /buscar|search|filtro|login/i.test(`${form.id} ${form.getAttribute('name') || ''} ${form.getAttribute('role') || ''}`) || form.dataset.envioLibre !== undefined;

function contenido(form, submitter) {
    const partes = [location.pathname, form.id || form.getAttribute('name') || '', submitter?.id || submitter?.textContent?.trim() || ''];
    form.querySelectorAll('input, select, textarea').forEach(campo => {
        const nombre = campo.id || campo.name || campo.type;
        if (campo.type === 'password') partes.push(`${nombre}=#${campo.value.length}`);
        else if (campo.type === 'file') partes.push(`${nombre}=${[...campo.files].map(f => f.name + ':' + f.size + ':' + f.lastModified).join(',')}`);
        else if (campo.type === 'checkbox' || campo.type === 'radio') partes.push(`${nombre}:${campo.value}=${campo.checked}`);
        else partes.push(`${nombre}=${campo.value}`);
    });
    // Contexto visible (por ejemplo, el estudiante al que se le registra el pago)
    const contexto = form.closest('.modal-content, .card, .page-content') || form;
    partes.push((contexto.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 3000));
    return partes.join('␟');
}

async function sha256(texto) {
    const datos = new TextEncoder().encode(texto);
    const hash = await crypto.subtle.digest('SHA-256', datos);
    return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const conTiempo = (promesa, ms) => Promise.race([promesa, new Promise(res => setTimeout(() => res('tiempo'), ms))]);

/** true si el envío puede continuar; false si es repetido. */
export async function reclamarEnvio(texto) {
    const app = getApps().find(a => a.name === '[DEFAULT]') || getApps()[0];
    const user = app ? getAuth(app).currentUser : null;
    if (!user || !crypto?.subtle) return true;
    const firma = await sha256(user.uid + '|' + texto);

    // Otra pestaña de este mismo navegador
    const clave = 'eduone_envio_' + firma.slice(0, 32);
    try {
        const t = Number(localStorage.getItem(clave) || 0);
        if (Date.now() - t < VENTANA_SEG * 1000) return false;
        localStorage.setItem(clave, String(Date.now()));
    } catch { /* sin storage */ }

    // Otro dispositivo: candado en el servidor
    const db = getFirestore(app);
    const ref = doc(db, 'envios', firma);
    try {
        const r = await conTiempo(setDoc(ref, { uid: user.uid, en: serverTimestamp(), ruta: location.pathname.slice(0, 80) }), ESPERA_MAX_MS);
        if (r === 'tiempo') return true;
        return true;
    } catch (err) {
        if (err?.code !== 'permission-denied') return true;
        // ¿Repetido de verdad, o las reglas todavía no tienen la colección "envios"?
        try {
            const s = await conTiempo(getDoc(ref), ESPERA_MAX_MS);
            if (s !== 'tiempo' && s.exists()) return false;
        } catch { /* sin permiso de lectura: reglas viejas */ }
        return true;
    }
}

function limpiarViejos() {
    try {
        const ahora = Date.now();
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k?.startsWith('eduone_envio_') && ahora - Number(localStorage.getItem(k) || 0) > VENTANA_SEG * 3000) localStorage.removeItem(k);
        }
    } catch { /* sin storage */ }
}

// ---------------------------------------------------------------------
// Formularios
// ---------------------------------------------------------------------
document.addEventListener('submit', e => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement) || esBusqueda(form)) return;
    if (aprobados.has(form)) { aprobados.delete(form); return; }    // ya verificado: sigue al código del panel
    e.preventDefault();
    e.stopImmediatePropagation();
    if (enCurso.has(form)) { aviso(MSG_EN_CURSO); return; }
    enCurso.add(form);
    const submitter = e.submitter && e.submitter.form === form ? e.submitter : null;
    const texto = contenido(form, submitter);
    reclamarEnvio(texto).then(ok => {
        if (!ok) { aviso(MSG_REPETIDO); return; }
        aprobados.add(form);
        try { submitter ? form.requestSubmit(submitter) : form.requestSubmit(); }
        finally { aprobados.delete(form); }
    }).catch(() => {
        aprobados.add(form);
        try { form.requestSubmit(); } finally { aprobados.delete(form); }
    }).finally(() => setTimeout(() => enCurso.delete(form), 1200));
}, true);

// ---------------------------------------------------------------------
// Botones de acción fuera de formularios: un clic por segundo
// ---------------------------------------------------------------------
const ultimoClic = new WeakMap();
document.addEventListener('click', e => {
    if (!e.isTrusted) return;                       // los clics hechos por código no se tocan
    const b = e.target.closest?.('button');
    if (!b || b.closest('.top-header, summary, .cob-tabs, .edu-emoji-picker, [data-envio-libre]')) return;
    if (b.type === 'submit' && b.form) return;      // lo cubre el control de formularios
    if (!/btn-(primary|success|danger|warning|info)|cob-btn|guardar|registrar|enviar/i.test(b.className + ' ' + b.id)) return;
    const ahora = Date.now();
    if (ahora - (ultimoClic.get(b) || 0) < 1000) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
    }
    ultimoClic.set(b, ahora);
}, true);

limpiarViejos();
