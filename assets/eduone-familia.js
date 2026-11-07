/* =====================================================================
   EduOne - eduone-familia.js  (boletines y avisos de pago)
   RECTORÍA ("Entrega de boletines"):
     - Habilita o deshabilita la entrega de boletines de cada periodo.
     - Ve cuántas familias no podrán ver el boletín por pagos pendientes.
   ACUDIENTE y ESTUDIANTE (sección "Boletín"):
     - Si rectoría no ha habilitado el periodo: "No está habilitada la
       entrega de boletines".
     - Si está habilitado pero la familia debe pensión vencida o matrícula:
       "Le hace falta proceso de pago..." y no se muestra ninguna nota.
     - Si está habilitado y la familia va al día: el boletín sale normal.
   ACUDIENTE: aviso destacado de pago pendiente en todo el panel y
   ventana de "Aviso importante" con los cobros sin leer.
   Se carga con: <script type="module" src="../assets/eduone-familia.js"></script>
   ===================================================================== */
import {
    collection, doc, getDoc, getDocs, setDoc, updateDoc, query, where, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/11.3.1/firebase-auth.js';
import { getApps } from 'https://www.gstatic.com/firebasejs/11.3.1/firebase-app.js';
import { obtenerContexto, nombreDe } from './eduone-comun.js?v=20261107';
import { el, agregarEstilos, agregarSeccion } from './eduone-secciones.js?v=20261107';
import { COP, cargarDatosCobro, estadoCuenta, detalleDeuda, leerHabilitacionBoletines } from './eduone-cobros.js?v=20261107';

const PERIODOS = [1, 2, 3, 4];
const MSG_NO_HABILITADO = 'No está habilitada la entrega de boletines';
const MSG_PAGO = 'Le hace falta proceso de pago. Para más información diríjase a la sede del colegio.';

const CSS = `
.fam-bloqueo{display:flex;gap:16px;align-items:flex-start;padding:22px 24px;border-radius:16px;margin:16px 0;font-size:.95rem;line-height:1.5}
.fam-bloqueo i{font-size:1.6rem;margin-top:2px}
.fam-bloqueo h3{margin:0 0 4px;font-size:1.1rem}
.fam-bloqueo.cerrado{background:#f1f5f9;border:1px solid #cbd5e1;color:#334155}
.fam-bloqueo.pago{background:#fef2f2;border:1px solid #fecaca;color:#991b1b}
.fam-banner{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:14px 18px;border-radius:14px;margin-bottom:16px;background:linear-gradient(90deg,#dc2626,#ef4444);color:#fff;box-shadow:0 8px 22px rgba(220,38,38,.25)}
.fam-banner strong{display:block;font-size:1rem}.fam-banner span{font-size:.86rem;opacity:.95}
.fam-banner i{font-size:1.4rem}
.fam-modal-lista{display:flex;flex-direction:column;gap:10px;max-height:50vh;overflow:auto}
.fam-modal-item{border:1px solid #fecaca;background:#fff7f7;border-radius:12px;padding:12px 14px}
.fam-modal-item strong{display:block;color:#991b1b;margin-bottom:4px}
.bol-periodos{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.bol-periodo{border:1px solid #e2e8f0;border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:10px;background:#fff}
.bol-periodo.on{border-color:#86efac;background:#f0fdf4}
.bol-periodo h3{margin:0;font-size:1rem}
.bol-switch{display:flex;align-items:center;gap:10px;cursor:pointer;font-weight:600;font-size:.88rem}
.bol-switch input{width:44px;height:24px;appearance:none;background:#cbd5e1;border-radius:99px;position:relative;cursor:pointer;transition:background .2s;flex:none}
.bol-switch input::after{content:'';position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left .2s}
.bol-switch input:checked{background:#16a34a}.bol-switch input:checked::after{left:23px}
@media(max-width:900px){.bol-periodos{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:520px){.bol-periodos{grid-template-columns:1fr}}
`;

let c = null;

// ---------------------------------------------------------------------
// Estudiante actual (acudiente: hijo seleccionado; estudiante: él mismo)
// ---------------------------------------------------------------------
let hijosCache = null;
async function estudianteActualId() {
    if (c.rol === 'estudiante') {
        if (c.perfil.estudianteId) return c.perfil.estudianteId;
        const email = (getAuth(getApps()[0]).currentUser?.email || c.perfil.email || '').toLowerCase();
        for (const campo of ['correo', 'email']) {
            const s = await getDocs(query(collection(c.db, 'colegios', c.colegioId, 'estudiantes'), where(campo, '==', email))).catch(() => null);
            if (s && !s.empty) return s.docs[0].id;
        }
        return null;
    }
    const sel = document.getElementById('hijoSelector');
    if (sel?.value && getComputedStyle(document.getElementById('hijoSelectorWrap') || sel).display !== 'none') return sel.value;
    if (!hijosCache) {
        const email = (getAuth(getApps()[0]).currentUser?.email || c.perfil.email || '').trim().toLowerCase();
        const s = await getDocs(collection(c.db, 'colegios', c.colegioId, 'estudiantes'));
        hijosCache = s.docs.filter(d => (d.data().acudienteEmail || '').trim().toLowerCase() === email).map(d => d.id);
    }
    return sel?.value && hijosCache.includes(sel.value) ? sel.value : hijosCache[0] || null;
}

async function cuentaDe(estId) {
    const datos = await cargarDatosCobro(c, { soloEstudianteId: estId });
    const est = datos.estudiantes[0];
    return est ? { est, cuenta: estadoCuenta(est, datos) } : null;
}

// ---------------------------------------------------------------------
// Boletín: autorización y pagos
// ---------------------------------------------------------------------
function mostrarBloqueo(tipo, titulo, texto) {
    const contenido = document.getElementById('boletinContent');
    if (contenido) contenido.style.display = 'none';
    document.getElementById('boletinPreview')?.replaceChildren();
    const pagina = document.getElementById('page-boletin') || document.getElementById('page-boletines');
    if (!pagina) return;
    pagina.querySelector('.fam-bloqueo')?.remove();
    const caja = el('div', { class: 'fam-bloqueo ' + tipo, role: 'alert' },
        el('i', { class: tipo === 'pago' ? 'fas fa-circle-exclamation' : 'fas fa-lock' }),
        el('div', {}, el('h3', { text: titulo }), texto ? el('p', { style: 'margin:0', text: texto }) : null));
    const ancla = contenido || pagina.querySelector('.card');
    if (ancla?.parentElement) ancla.parentElement.insertBefore(caja, ancla); else pagina.append(caja);
}
const quitarBloqueo = () => document.querySelectorAll('.fam-bloqueo').forEach(n => n.remove());

/** Devuelve null si puede ver el boletín, o el motivo del bloqueo. */
async function revisarBoletin(periodo) {
    const habil = await leerHabilitacionBoletines(c);
    const habilitados = PERIODOS.filter(p => habil[p] === true || habil[String(p)] === true);
    if (periodo) {
        if (!habilitados.includes(Number(periodo))) return { tipo: 'cerrado', titulo: MSG_NO_HABILITADO, texto: `Rectoría aún no ha habilitado la entrega del boletín del periodo ${periodo}.` };
    } else if (habilitados.length < PERIODOS.length) {
        return {
            tipo: 'cerrado', titulo: MSG_NO_HABILITADO,
            texto: habilitados.length ? `Solo está habilitada la entrega de: ${habilitados.map(p => 'Periodo ' + p).join(', ')}. Elige uno de esos periodos.` : 'Rectoría aún no ha habilitado la entrega de boletines.'
        };
    }
    const estId = await estudianteActualId();
    if (!estId) return { tipo: 'cerrado', titulo: 'No se encontró el estudiante', texto: '' };
    const r = await cuentaDe(estId);
    if (r?.cuenta.bloqueaBoletin) return { tipo: 'pago', titulo: MSG_PAGO, texto: '' };
    return null;
}

function interceptarBoletin() {
    if (document.documentElement.dataset.famBoletin) return;
    document.documentElement.dataset.famBoletin = '1';
    let aprobado = false;
    // En fase de captura sobre el documento: se revisa antes que el código del panel
    document.addEventListener('click', async e => {
        const boton = e.target.closest?.('#btnGenerarBoletin');
        if (!boton) return;
        if (aprobado) { aprobado = false; quitarBloqueo(); return; }
        e.preventDefault();
        e.stopImmediatePropagation();
        if (boton.dataset.revisando) return;
        boton.dataset.revisando = '1';
        const original = boton.innerHTML;
        boton.disabled = true;
        boton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando...';
        try {
            const periodo = document.getElementById('boletinFiltroPeriodo')?.value || '';
            const motivo = await revisarBoletin(periodo);
            boton.disabled = false;
            boton.innerHTML = original;
            if (motivo) { mostrarBloqueo(motivo.tipo, motivo.titulo, motivo.texto); return; }
            aprobado = true;
            boton.click();
        } catch (er) {
            boton.disabled = false;
            boton.innerHTML = original;
            mostrarBloqueo('cerrado', 'No se pudo verificar la entrega de boletines', er.message);
        } finally { delete boton.dataset.revisando; }
    }, true);
    // Al cambiar de periodo o de hijo se oculta el boletín anterior
    document.getElementById('boletinFiltroPeriodo')?.addEventListener('change', () => {
        quitarBloqueo();
        const contenido = document.getElementById('boletinContent');
        if (contenido) contenido.style.display = 'none';
    });
    document.getElementById('hijoSelector')?.addEventListener('change', () => {
        quitarBloqueo();
        const contenido = document.getElementById('boletinContent');
        if (contenido) contenido.style.display = 'none';
        pintarBanner();
    });
}

// ---------------------------------------------------------------------
// Acudiente: aviso destacado de pago y ventana de aviso importante
// ---------------------------------------------------------------------
async function pintarBanner() {
    if (c.rol !== 'acudiente') return;
    const estId = await estudianteActualId();
    document.getElementById('famBanner')?.remove();
    if (!estId) return;
    const r = await cuentaDe(estId).catch(() => null);
    if (!r || r.cuenta.alDia) return;
    const { est, cuenta } = r;
    const host = document.getElementById('contentArea') || document.querySelector('.content-area');
    if (!host) return;
    const banner = el('div', { class: 'fam-banner', id: 'famBanner', role: 'alert' },
        el('div', { style: 'display:flex;gap:12px;align-items:center' }, el('i', { class: 'fas fa-triangle-exclamation' }),
            el('div', {}, el('strong', { text: `Pago pendiente: ${detalleDeuda(cuenta)} (${COP.format(cuenta.total)})` }),
                el('span', { text: `${est.nombreCompleto}. ${cuenta.bloqueaBoletin ? 'Mientras no esté al día no podrá consultar los boletines.' : 'Si no se paga a tiempo no podrá consultar los boletines.'} Para pagar, diríjase a la sede del colegio.` }))));
    const barraHijo = host.querySelector('.edu-hijo-bar');
    if (barraHijo) barraHijo.after(banner); else host.prepend(banner);
}

async function avisoImportante() {
    if (c.rol !== 'acudiente') return;
    const estId = await estudianteActualId();
    if (!estId) return;
    const clave = `eduone_aviso_cobro_${c.uid}_${new Date().toISOString().slice(0, 10)}`;
    try { if (localStorage.getItem(clave)) return; } catch { /* sin storage */ }
    const s = await getDocs(query(collection(c.db, 'colegios', c.colegioId, 'notificaciones'), where('estudianteId', '==', estId), where('leida', '==', false))).catch(() => null);
    const avisos = (s?.docs || []).map(d => ({ id: d.id, ...d.data() })).filter(n => n.prioridad === 'alta')
        .sort((a, b) => (b.fecha?.toMillis?.() || 0) - (a.fecha?.toMillis?.() || 0)).slice(0, 5);
    if (!avisos.length) return;
    const cerrar = async () => {
        modal.remove();
        try { localStorage.setItem(clave, '1'); } catch { /* sin storage */ }
        await Promise.all(avisos.map(a => updateDoc(doc(c.db, 'colegios', c.colegioId, 'notificaciones', a.id), { leida: true }).catch(() => {})));
    };
    const modal = el('div', { class: 'modal show', id: 'famAvisoModal', role: 'dialog', 'aria-modal': 'true' },
        el('div', { class: 'modal-overlay' }),
        el('div', { class: 'modal-content', style: 'max-width:560px' },
            el('div', { class: 'modal-header' }, el('h2', {}, el('i', { class: 'fas fa-bell', style: 'color:#dc2626' }), ' Aviso importante del colegio')),
            el('div', { class: 'modal-body' }, el('div', { class: 'fam-modal-lista' },
                ...avisos.map(a => el('div', { class: 'fam-modal-item' }, el('strong', { text: a.titulo || 'Aviso de pago' }), el('span', { text: a.mensaje || '' }))))),
            el('div', { class: 'modal-footer' }, el('button', { type: 'button', class: 'btn-primary', onclick: cerrar }, el('i', { class: 'fas fa-check' }), ' Entendido'))));
    document.body.append(modal);
}

// ---------------------------------------------------------------------
// Rectoría: habilitar la entrega de boletines
// ---------------------------------------------------------------------
async function montarRector() {
    const sec = agregarSeccion({ id: 'entregaBoletines', icono: 'fas fa-file-circle-check', texto: 'Entrega de boletines', grupo: 'ACADÉMICO', titulo: 'Entrega de boletines', menu: 'Académico' });
    if (!sec) return;
    const ref = doc(c.db, 'colegios', c.colegioId, 'configuracion_cobros', 'boletines');
    const tarjetas = el('div', { class: 'bol-periodos' });
    const resumen = el('div', {});
    const tbody = el('tbody', {});
    sec.pagina.append(
        el('div', { class: 'card' }, el('div', { class: 'card-header' }, el('h2', {}, el('i', { class: 'fas fa-file-circle-check', style: 'color:var(--primary)' }), ' Autorizar la entrega de boletines a las familias')),
            el('div', { class: 'card-body' },
                el('p', { class: 'text-muted', style: 'margin-bottom:14px', text: 'Mientras un periodo no esté habilitado, el acudiente y el estudiante verán "No está habilitada la entrega de boletines". Al habilitarlo, lo ven las familias que están al día con la pensión y la matrícula; a las que deben se les indica que les falta el proceso de pago.' }),
                tarjetas)),
        el('div', { class: 'card', style: 'margin-top:16px' }, el('div', { class: 'card-header' }, el('h2', {}, el('i', { class: 'fas fa-user-lock', style: 'color:var(--primary)' }), ' Familias que no podrán ver el boletín por pagos pendientes')),
            el('div', { class: 'card-body' }, resumen, el('div', { class: 'table-responsive' }, el('table', { class: 'table-modern' },
                el('thead', {}, el('tr', {}, ...['#', 'Estudiante', 'Curso', 'Acudiente', 'Pendiente', 'Deuda'].map(t => el('th', { text: t })))), tbody)))));

    let estado = {};
    const pintar = () => {
        tarjetas.replaceChildren(...PERIODOS.map(p => {
            const on = estado[p] === true || estado[String(p)] === true;
            const chk = el('input', { type: 'checkbox', checked: on, 'aria-label': `Habilitar boletín del periodo ${p}` });
            chk.addEventListener('change', async () => {
                const nuevo = chk.checked;
                if (!confirm(`¿${nuevo ? 'Habilitar' : 'Deshabilitar'} la entrega del boletín del periodo ${p} a las familias?`)) { chk.checked = !nuevo; return; }
                chk.disabled = true;
                try {
                    const actual = await getDoc(ref);
                    const periodos = { ...(actual.exists() ? actual.data().periodos || {} : {}), [p]: nuevo };
                    await setDoc(ref, { colegioId: c.colegioId, periodos, actualizadoPor: c.uid, actualizadoPorNombre: nombreDe(c.perfil), actualizadoEn: serverTimestamp() }, { merge: true });
                    estado = periodos;
                } catch (e) { alert('No se pudo guardar: ' + e.message); chk.checked = !nuevo; }
                finally { chk.disabled = false; pintar(); }
            });
            return el('div', { class: 'bol-periodo' + (on ? ' on' : '') },
                el('h3', { text: `Periodo ${p}` }),
                el('label', { class: 'bol-switch' }, chk, el('span', { text: on ? 'Entrega habilitada' : 'No habilitada' })));
        }));
    };
    const cargar = async () => {
        const s = await getDoc(ref).catch(() => null);
        estado = s?.exists() ? s.data().periodos || {} : {};
        pintar();
        resumen.replaceChildren(el('p', { class: 'text-muted', text: 'Calculando...' }));
        try {
            const datos = await cargarDatosCobro(c);
            const bloqueados = datos.estudiantes.map(est => ({ est, cuenta: estadoCuenta(est, datos) })).filter(x => x.cuenta.bloqueaBoletin);
            resumen.replaceChildren(el('p', { style: 'margin-bottom:12px', text: bloqueados.length ? `${bloqueados.length} de ${datos.estudiantes.length} estudiantes tienen pagos vencidos: sus familias no verán el boletín hasta ponerse al día.` : '✅ Todas las familias están al día: todas podrán ver el boletín.' }));
            tbody.replaceChildren(...bloqueados.map((x, i) => el('tr', {},
                el('td', { text: String(i + 1) }), el('td', { text: x.est.nombreCompleto }), el('td', { text: x.est.cursoNombre || '-' }),
                el('td', { text: x.est.acudiente || '-' }), el('td', { text: detalleDeuda(x.cuenta) }), el('td', {}, el('strong', { text: COP.format(x.cuenta.total) })))));
        } catch (e) { resumen.replaceChildren(el('p', { class: 'text-danger', text: 'No se pudo calcular: ' + e.message })); }
    };
    sec.pagina.addEventListener('edu:mostrar', cargar);
}

// ---------------------------------------------------------------------
async function montar() {
    c = await obtenerContexto();
    if (!c.colegioId) return;
    agregarEstilos('eduFamiliaCss', CSS);
    if (['rector', 'admin_colegio'].includes(c.rol)) return montarRector();
    if (!['acudiente', 'estudiante'].includes(c.rol)) return;
    interceptarBoletin();
    if (c.rol === 'acudiente') {
        // El panel carga los hijos un poco después; se espera un momento
        setTimeout(() => { pintarBanner().catch(() => {}); avisoImportante().catch(() => {}); }, 1500);
    }
}
const go = () => montar().catch(e => console.warn('EduOne familia:', e.message));
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();

