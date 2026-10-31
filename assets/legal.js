/* =====================================================================
   EduOne - legal.js  (módulo compartido)
   Versiones vigentes de los documentos legales y registro trazable de
   cada aceptación en Firestore (colección "consentimientos").

   La regla de Firestore solo permite CREAR registros (no editarlos ni
   borrarlos), exige las dos casillas aceptadas y fija "creadoEn" con la
   hora del servidor de Google. Solo el superadmin puede leerlos.

   IMPORTANTE: cuando cambie el texto de un documento, actualice su
   "version" aquí y la fecha visible en la página del documento. Así cada
   registro queda ligado a la versión exacta que la persona aceptó.
   ===================================================================== */
import { collection, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js';

export const DOCUMENTOS = {
    terminos: {
        version: '2026-10-31',
        titulo: 'Términos y condiciones',
        url: new URL('../terminos.html', import.meta.url).href
    },
    privacidad: {
        version: '2026-10-31',
        titulo: 'Política de privacidad y tratamiento de datos personales',
        url: new URL('../privacidad.html', import.meta.url).href
    }
};

// Guarda el momento exacto en que la persona marcó cada casilla
export function vigilarCasilla(input) {
    if (!input || input.dataset.legalVigilada) return;
    input.dataset.legalVigilada = '1';
    input.addEventListener('change', () => {
        input.dataset.marcadoEn = input.checked ? new Date().toISOString() : '';
    });
}

function textoDeCasilla(input) {
    const label = input.labels && input.labels[0];
    return (label ? label.textContent : '').replace(/\s+/g, ' ').trim();
}

export function datosCasillas({ terminos, privacidad }) {
    const uno = (input, doc) => ({
        aceptado: input.checked === true,
        version: doc.version,
        url: doc.url,
        texto: textoDeCasilla(input),
        marcadoEn: input.dataset.marcadoEn || null
    });
    return {
        terminos: uno(terminos, DOCUMENTOS.terminos),
        privacidad: uno(privacidad, DOCUMENTOS.privacidad)
    };
}

export function claveAceptacion(uid) {
    return 'eduone_legal_' + uid;
}
export function versionesVigentes() {
    return DOCUMENTOS.terminos.version + '|' + DOCUMENTOS.privacidad.version;
}
export function yaAceptoEnEsteDispositivo(uid) {
    try { return localStorage.getItem(claveAceptacion(uid)) === versionesVigentes(); } catch { return false; }
}
export function marcarAceptadoEnEsteDispositivo(uid) {
    try { localStorage.setItem(claveAceptacion(uid), versionesVigentes()); } catch { /* sin storage */ }
}

/**
 * Registra una aceptación.
 * formulario: 'contacto' (sin sesión, uid null) | 'login' (uid de la sesión)
 * titular: datos que identifican a la persona (nombre, correo, etc.)
 * casillas: { terminos: <input>, privacidad: <input> }
 * origen: de dónde vino la aceptación (p. ej. 'formulario-login', 'confirmacion-panel')
 */
export async function registrarConsentimiento(db, { formulario, uid = null, titular = {}, casillas, origen }) {
    let zonaHoraria = null;
    try { zonaHoraria = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* navegador antiguo */ }
    return addDoc(collection(db, 'consentimientos'), {
        formulario,
        uid,
        titular,
        documentos: datosCasillas(casillas),
        contexto: {
            origen: origen || formulario,
            pagina: location.origin + location.pathname,
            referente: document.referrer || null,
            userAgent: navigator.userAgent,
            idioma: navigator.language || null,
            zonaHoraria,
            pantalla: screen.width + 'x' + screen.height
        },
        fechaCliente: new Date().toISOString(),
        creadoEn: serverTimestamp()
    });
}
