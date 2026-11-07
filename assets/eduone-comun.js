/* =====================================================================
   EduOne - eduone-comun.js  (lógica compartida, sin interfaz)
   - Contexto del usuario (Firebase lo inicializa cada página).
   - Limitaciones de chat por rol (iguales a firestore.rules).
   - Avisos automáticos: notificarFamilia() y enviarMensajeDirecto().
   ===================================================================== */
import { getApps } from 'https://www.gstatic.com/firebasejs/11.3.1/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.3.1/firebase-auth.js';
import {
    getFirestore, doc, getDoc, setDoc, addDoc, collection, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js';

// ---------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------
export const ROL_LABEL = {
    rector: 'Rector(a)', admin_colegio: 'Administrador', admin_auxiliar: 'Auxiliar administrativo',
    coord_academico: 'Coordinador académico', coord_convivencia: 'Coordinador de convivencia',
    secretaria: 'Secretaría', orientador: 'Orientación escolar', contador: 'Contador(a)',
    profesor: 'Profesor(a)', estudiante: 'Estudiante', acudiente: 'Acudiente'
};
const DIRECTIVOS = ['rector', 'admin_colegio', 'admin_auxiliar'];

// Limitaciones de chat. Un chat se permite solo si NINGUNO de los dos
// roles bloquea al otro. Mantener igual a bloqueaChat() en firestore.rules.
export const CHAT_BLOQUEOS = {
    coord_academico: ['secretaria', 'contador', ...DIRECTIVOS],
    coord_convivencia: ['contador', 'secretaria'],
    acudiente: ['contador', 'estudiante', 'acudiente'],
    orientador: ['contador'],
    secretaria: []
};
export const CONTADOR_PERMITIDOS = ['secretaria', ...DIRECTIVOS];

function bloquea(a, b) {
    if (a === 'contador') return !CONTADOR_PERMITIDOS.includes(b);
    return (CHAT_BLOQUEOS[a] || []).includes(b);
}
export function chatPermitido(rolA, rolB) {
    if (!rolA || !rolB || rolA === 'superadmin' || rolB === 'superadmin') return false;
    return !bloquea(rolA, rolB) && !bloquea(rolB, rolA);
}

// ---------------------------------------------------------------------
// Contexto
// ---------------------------------------------------------------------
const esperar = ms => new Promise(r => setTimeout(r, ms));
let ctxListo = null;

/** @returns {Promise<{db, uid, rol, colegioId, perfil}>} */
export function obtenerContexto() {
    if (ctxListo) return ctxListo;
    ctxListo = (async () => {
        for (let i = 0; i < 100 && !getApps().length; i++) await esperar(150);
        const app = getApps().find(a => a.name === '[DEFAULT]') || getApps()[0];
        if (!app) throw new Error('Firebase no está inicializado en esta página');
        const user = await new Promise(res => {
            const off = onAuthStateChanged(getAuth(app), u => { if (u) { off(); res(u); } });
        });
        const db = getFirestore(app);
        const perfil = await getDoc(doc(db, 'usuarios', user.uid));
        if (!perfil.exists()) throw new Error('Usuario sin perfil');
        const datos = perfil.data();
        return { db, uid: user.uid, rol: datos.rol, colegioId: datos.colegioId, perfil: datos };
    })();
    ctxListo.catch(() => { ctxListo = null; });
    return ctxListo;
}

export const nombreDe = u => (u?.nombre || `${u?.nombres || ''} ${u?.apellidos || ''}`).trim() || u?.email || 'Usuario';
export const uidDe = d => d.data().uid || d.data().authUid || d.id;
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------------
// Avisos automáticos
// ---------------------------------------------------------------------

/** Aviso al estudiante y a su acudiente (los dos leen notificaciones por estudianteId). */
export async function notificarFamilia(estudianteId, titulo, mensaje, tipo = 'aviso', extra = {}) {
    if (!estudianteId) return;
    const c = await obtenerContexto();
    await addDoc(collection(c.db, 'colegios', c.colegioId, 'notificaciones'), {
        estudianteId, titulo: String(titulo).slice(0, 140), mensaje: String(mensaje).slice(0, 1000), tipo, leida: false,
        remitenteUid: c.uid, remitenteNombre: nombreDe(c.perfil), remitenteRol: c.rol,
        fecha: serverTimestamp(), ...extra
    });
}

/**
 * Aviso a una persona del colegio (destino.uid) o a todos los de un rol
 * (destino.rol). Aparece en la campana de notificaciones de su panel.
 */
export async function notificarUsuario(destino, titulo, mensaje, tipo = 'aviso', extra = {}) {
    if (!destino?.uid && !destino?.rol) return;
    const c = await obtenerContexto();
    await addDoc(collection(c.db, 'colegios', c.colegioId, 'notificaciones'), {
        destinatarioUid: destino.uid || null, destinatarioRol: destino.rol || null,
        titulo: String(titulo).slice(0, 140), mensaje: String(mensaje).slice(0, 1000), tipo, leida: false, leidoPor: [],
        remitenteUid: c.uid, remitenteNombre: nombreDe(c.perfil), remitenteRol: c.rol,
        fecha: serverTimestamp(), ...extra
    });
}

/** Mensaje privado (crea el chat si no existe). Devuelve false si el rol no lo permite. */
export async function enviarMensajeDirecto(destUid, texto, rolDestino) {
    const c = await obtenerContexto();
    if (!destUid || destUid === c.uid) return false;
    let rolDest = rolDestino;
    if (!rolDest) {
        const d = await getDoc(doc(c.db, 'usuarios', destUid));
        rolDest = d.exists() ? d.data().rol : '';
    }
    if (!chatPermitido(c.rol, rolDest)) return false;
    const chatId = [c.uid, destUid].sort().join('_');
    const ref = doc(c.db, 'colegios', c.colegioId, 'chats', chatId);
    // Un chat que no existe no se puede leer (hay que ser participante),
    // por eso un error aquí significa "todavía no existe".
    const existe = await getDoc(ref).then(s => s.exists()).catch(() => false);
    const resumen = { colegioId: c.colegioId, actualizadoEn: serverTimestamp(), ultimoTexto: String(texto).slice(0, 120), ultimoRemitente: c.uid };
    // En chats existentes no se reescriben los participantes (las reglas exigen el mismo orden)
    await setDoc(ref, existe ? resumen : { ...resumen, participantes: [c.uid, destUid] }, { merge: true });
    await addDoc(collection(ref, 'mensajes'), {
        colegioId: c.colegioId, remitenteUid: c.uid, destinatarioUid: destUid,
        texto: String(texto).slice(0, 2000), creadoEn: serverTimestamp()
    });
    return true;
}

window.EduOne = Object.assign(window.EduOne || {}, { chatPermitido, enviarMensajeDirecto, notificarFamilia, notificarUsuario, obtenerContexto, ROL_LABEL });
