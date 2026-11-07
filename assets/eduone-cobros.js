/* =====================================================================
   EduOne - eduone-cobros.js  (lógica de cobros, sin interfaz)
   Cómo cobra un colegio privado en Colombia:
   - Matrícula: se paga una sola vez al ingresar (colección matriculas).
   - Pensión: cada mes, el mismo valor para todos (o por grado / por
     estudiante), configurada por rectoría en configuracion_pensiones.
   - Estudiante que ingresa a mitad de año: según la política del colegio
     se cobra la pensión desde el mes de ingreso o desde el mes siguiente
     (configuracion_cobros/general.cobrarMesIngreso).
   - Eventos de pago (jean day, feria...): eventos_cobro + cargos_eventos.
   Este archivo calcula el estado de cuenta de cada estudiante, genera el
   cobro mensual automático (una sola vez por mes, aunque varias personas
   abran el panel a la vez) y envía los recordatorios de pago (uno por día
   por estudiante).
   ===================================================================== */
import {
    collection, doc, getDoc, getDocs, setDoc, query, where, runTransaction, writeBatch, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js';
import { nombreDe } from './eduone-comun.js?v=20261107';

export const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
export const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
export const idMes = (anio, mes) => `${anio}-${String(mes).padStart(2, '0')}`;
export const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const norm = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const DIA_MS = 86400000;

/** Política de cobro por defecto (la cambia rectoría). */
export const POLITICA_BASE = {
    cobrarMesIngreso: true,        // ¿el estudiante nuevo paga la pensión del mes en que entra?
    diaLimitePago: 10,             // después de este día el mes queda "en mora"
    mesesCobro: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]   // meses con pensión (febrero a noviembre)
};

/** Mensajes genéricos (iguales para todos los colegios). */
export const MENSAJES = {
    cobroMensual: (est, mes, anio, valor) =>
        `Estimado padre de familia: ya está disponible el cobro de la pensión de ${MESES[mes - 1]} de ${anio} de ${est} por ${COP.format(valor)}. ` +
        'Le recordamos realizar el pago a tiempo. Si la pensión no está al día, no podrá consultar los boletines de calificaciones. ' +
        'Para más información diríjase a la sede del colegio.',
    recordatorio: (est, detalle, total) =>
        `Estimado padre de familia: el estudiante ${est} tiene pendiente el pago de ${detalle} por un total de ${COP.format(total)}. ` +
        'Mientras el pago no esté al día no podrá consultar los boletines de calificaciones. ' +
        'Por favor acérquese a la sede del colegio o realice el pago lo antes posible.'
};

const fechaDe = v => {
    if (!v) return null;
    if (v.toDate) return v.toDate();
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) { const [y, m, d] = v.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); }
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
};

export async function leerPolitica(c) {
    try {
        const s = await getDoc(doc(c.db, 'colegios', c.colegioId, 'configuracion_cobros', 'general'));
        const d = s.exists() ? s.data() : {};
        return {
            ...POLITICA_BASE, ...d,
            mesesCobro: Array.isArray(d.mesesCobro) && d.mesesCobro.length ? d.mesesCobro.map(Number) : POLITICA_BASE.mesesCobro,
            diaLimitePago: Math.min(28, Math.max(1, Number(d.diaLimitePago) || POLITICA_BASE.diaLimitePago)),
            cobrarMesIngreso: d.cobrarMesIngreso !== false
        };
    } catch { return { ...POLITICA_BASE }; }
}

export async function guardarPolitica(c, politica) {
    await setDoc(doc(c.db, 'colegios', c.colegioId, 'configuracion_cobros', 'general'), {
        colegioId: c.colegioId,
        cobrarMesIngreso: !!politica.cobrarMesIngreso,
        diaLimitePago: Math.min(28, Math.max(1, Number(politica.diaLimitePago) || 10)),
        mesesCobro: [...new Set(politica.mesesCobro.map(Number))].filter(m => m >= 1 && m <= 12).sort((a, b) => a - b),
        actualizadoPor: c.uid, actualizadoPorNombre: nombreDe(c.perfil), actualizadoEn: serverTimestamp()
    });
}

const activo = e => !['retirado', 'inactivo'].includes(e.estado) && e.activo !== false;

/**
 * Carga lo necesario para calcular cuentas.
 * soloEstudianteId: para el panel del acudiente / estudiante (lee solo lo suyo).
 */
export async function cargarDatosCobro(c, { soloEstudianteId = null, anioDesde = new Date().getFullYear() - 1 } = {}) {
    const base = ['colegios', c.colegioId];
    const col = n => collection(c.db, ...base, n);
    const [estSnap, cursosSnap, cfgSnap, matSnap, penSnap, politica] = await Promise.all([
        soloEstudianteId ? getDoc(doc(c.db, ...base, 'estudiantes', soloEstudianteId)) : getDocs(col('estudiantes')),
        getDocs(col('cursos')),
        getDocs(col('configuracion_pensiones')),
        getDocs(soloEstudianteId ? query(col('matriculas'), where('estudianteId', '==', soloEstudianteId)) : col('matriculas')),
        getDocs(soloEstudianteId ? query(col('pensiones'), where('estudianteId', '==', soloEstudianteId)) : query(col('pensiones'), where('anio', '>=', anioDesde))),
        leerPolitica(c)
    ]);
    const lista = soloEstudianteId ? (estSnap.exists() ? [{ id: estSnap.id, ...estSnap.data() }] : []) : estSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const cursos = new Map(cursosSnap.docs.map(d => [d.id, { nombre: d.data().nombre || '', gradoId: d.data().gradoId || '' }]));
    const configs = new Map(cfgSnap.docs.map(d => [d.id, { valor: Number(d.data().valor) || 0, valoresPorGrado: d.data().valoresPorGrado || {} }]));
    const matriculaPorEst = new Map();
    matSnap.forEach(d => {
        const m = { id: d.id, ...d.data() };
        if (!m.estudianteId || ['inactivo', 'retirado'].includes(m.estado)) return;
        const actual = matriculaPorEst.get(m.estudianteId);
        if (!actual || Number(m.anio || m.anioEscolar || 0) >= Number(actual.anio || actual.anioEscolar || 0)) matriculaPorEst.set(m.estudianteId, m);
    });
    const pensionesPorEst = new Map();
    penSnap.forEach(d => {
        const p = { id: d.id, ...d.data() };
        if (!p.estudianteId) return;
        if (!pensionesPorEst.has(p.estudianteId)) pensionesPorEst.set(p.estudianteId, new Map());
        pensionesPorEst.get(p.estudianteId).set(`${Number(p.anio)}-${Number(p.mes)}`, p);
    });
    const estudiantes = lista.filter(activo).map(e => ({
        ...e,
        nombreCompleto: `${e.nombres || ''} ${e.apellidos || ''}`.trim() || e.nombre || 'Estudiante',
        cursoNombre: cursos.get(e.cursoId)?.nombre || cursos.get(matriculaPorEst.get(e.id)?.cursoId)?.nombre || e.cursoNombre || ''
    })).sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto, 'es'));
    return { estudiantes, cursos, configs, matriculaPorEst, pensionesPorEst, politica };
}

export function gradoDe(est, datos) {
    const m = datos.matriculaPorEst.get(est.id);
    return est.gradoId || m?.gradoId || datos.cursos.get(est.cursoId)?.gradoId || datos.cursos.get(m?.cursoId)?.gradoId || '';
}

/** Configuración del mes; si no existe y el mes es de cobro, la última anterior (cobro automático). */
function configDelMes(datos, anio, mes) {
    const exacta = datos.configs.get(idMes(anio, mes));
    if (exacta) return exacta;
    if (!datos.politica.mesesCobro.includes(mes)) return null;
    const clave = idMes(anio, mes);
    const anteriores = [...datos.configs.keys()].filter(k => k < clave).sort();
    return anteriores.length ? datos.configs.get(anteriores[anteriores.length - 1]) : null;
}

/** Valor de la pensión de un mes: documento ya generado > valor individual > valor del grado > valor general. */
export function valorPension(est, anio, mes, datos) {
    const p = datos.pensionesPorEst.get(est.id)?.get(`${anio}-${mes}`);
    if (p) return Number(p.valorPension) || 0;
    // Solo hay pensión en los meses configurados por rectoría o en los meses de cobro del colegio
    const exacta = datos.configs.get(idMes(anio, mes));
    if (!exacta && !datos.politica.mesesCobro.includes(mes)) return 0;
    const conf = configDelMes(datos, anio, mes);
    const individual = Number(est.valorPension ?? est.pensionMensual ?? 0);
    if (individual > 0 && conf) return individual;
    if (!conf) return 0;
    const porGrado = Number(conf.valoresPorGrado?.[gradoDe(est, datos)] || 0);
    return porGrado > 0 ? porGrado : (Number(conf.valor) || 0);
}

/** Primer mes que se le cobra al estudiante según su fecha de ingreso y la política. */
export function inicioCobro(est, datos, anioActual = new Date().getFullYear()) {
    const m = datos.matriculaPorEst.get(est.id);
    const ingreso = fechaDe(m?.fechaRegistro) || fechaDe(m?.fechaMatricula) || fechaDe(est.fechaRegistro) || fechaDe(est.fechaIngreso);
    if (!ingreso || ingreso.getFullYear() < anioActual) return { anio: anioActual, mes: 1 };
    let mes = ingreso.getMonth() + 1, anio = ingreso.getFullYear();
    if (!datos.politica.cobrarMesIngreso) { mes++; if (mes > 12) { mes = 1; anio++; } }
    return { anio, mes };
}

/**
 * Estado de cuenta del estudiante a la fecha.
 * - meses: pensiones desde su inicio de cobro hasta el mes actual (y deudas de años anteriores).
 * - enMora: meses cuyo día límite ya pasó y tienen saldo.
 * - bloqueaBoletin: debe pensión vencida o tiene saldo de matrícula.
 * - resaltar: el mes impago más antiguo lleva 15 días o más (botón de recordatorio más visible).
 */
export function estadoCuenta(est, datos, hoy = new Date()) {
    const anioActual = hoy.getFullYear(), mesActual = hoy.getMonth() + 1;
    const inicio = inicioCobro(est, datos, anioActual);
    const meses = [];
    const vistos = new Set();
    const agregar = (anio, mes) => {
        const clave = `${anio}-${mes}`;
        if (vistos.has(clave)) return;
        vistos.add(clave);
        const p = datos.pensionesPorEst.get(est.id)?.get(clave);
        const valor = valorPension(est, anio, mes, datos);
        if (!p && !valor) return;
        const abonado = Number(p?.totalAbonado) || 0;
        const saldo = Math.max(0, valor - abonado);
        const limite = new Date(anio, mes - 1, datos.politica.diaLimitePago, 23, 59, 59);
        const inicioMes = new Date(anio, mes - 1, 1);
        meses.push({
            anio, mes, valor, abonado, saldo, pensionId: p?.id || null, generada: !!p,
            vencido: saldo > 0 && hoy > limite,
            diasDesdeInicio: Math.floor((hoy - inicioMes) / DIA_MS)
        });
    };
    // Pensiones ya generadas hasta el mes actual (incluye deudas de años anteriores)
    for (const p of datos.pensionesPorEst.get(est.id)?.values() || []) {
        const a = Number(p.anio), ms = Number(p.mes);
        if (a < anioActual || (a === anioActual && ms <= mesActual)) agregar(a, ms);
    }
    // Año actual desde el inicio de cobro
    if (inicio.anio <= anioActual) {
        for (let mes = inicio.anio < anioActual ? 1 : inicio.mes; mes <= mesActual; mes++) agregar(anioActual, mes);
    }
    meses.sort((a, b) => (a.anio - b.anio) || (a.mes - b.mes));

    const m = datos.matriculaPorEst.get(est.id);
    const valorMatricula = Number(m?.valorMatricula) || 0;
    const abonadoMatricula = Number(m?.totalAbonado) || 0;
    const saldoMatricula = valorMatricula > 0 ? Math.max(0, valorMatricula - abonadoMatricula) : 0;

    const pendientes = meses.filter(x => x.saldo > 0);
    const enMora = pendientes.filter(x => x.vencido);
    const deudaPensiones = pendientes.reduce((s, x) => s + x.saldo, 0);
    const masAntiguo = pendientes[0];
    return {
        meses, pendientes, enMora, deudaPensiones,
        matricula: m ? { id: m.id, valor: valorMatricula, abonado: abonadoMatricula, saldo: saldoMatricula } : null,
        total: deudaPensiones + saldoMatricula,
        alDia: !pendientes.length && !saldoMatricula,
        bloqueaBoletin: enMora.length > 0 || saldoMatricula > 0,
        diasMora: masAntiguo ? masAntiguo.diasDesdeInicio : 0,
        resaltar: !!masAntiguo && masAntiguo.diasDesdeInicio >= 15
    };
}

export function textoEstado(cuenta) {
    if (cuenta.alDia) return { clase: 'pagado', texto: 'Al día' };
    if (cuenta.resaltar) return { clase: 'mora15', texto: `En mora (+${cuenta.diasMora} días)` };
    if (cuenta.enMora.length || cuenta.matricula?.saldo) return { clase: 'pendiente', texto: 'En mora' };
    return { clase: 'abonado', texto: 'Pendiente del mes' };
}

export function detalleDeuda(cuenta) {
    const partes = cuenta.pendientes.map(x => `${MESES[x.mes - 1]}${x.anio !== new Date().getFullYear() ? ' ' + x.anio : ''}`);
    if (cuenta.matricula?.saldo) partes.unshift('la matrícula');
    if (!partes.length) return '';
    const texto = partes.length === 1 ? partes[0] : partes.slice(0, -1).join(', ') + ' y ' + partes[partes.length - 1];
    return (cuenta.pendientes.length ? (cuenta.matricula?.saldo ? '' : 'la pensión de ') : '') + texto;
}

// ---------------------------------------------------------------------
// Cobro mensual automático (una sola vez por mes y por colegio)
// ---------------------------------------------------------------------
const ROLES_COBRAN = ['secretaria', 'rector', 'admin_colegio', 'admin_auxiliar'];

export async function generarCobroMensual(c, hoy = new Date()) {
    if (!ROLES_COBRAN.includes(c.rol)) return null;
    const anio = hoy.getFullYear(), mes = hoy.getMonth() + 1;
    const clave = idMes(anio, mes);
    const ref = doc(c.db, 'colegios', c.colegioId, 'cobros_mensuales', clave);
    // Reclamar el trabajo: solo un navegador lo hace (los demás ven que ya está hecho o en proceso)
    const tomado = await runTransaction(c.db, async tx => {
        const s = await tx.get(ref);
        if (s.exists()) {
            const d = s.data();
            const viejo = d.estado === 'procesando' && (Date.now() - (d.inicio?.toMillis?.() || 0)) > 10 * 60 * 1000;
            if (d.estado === 'completo' || !viejo) return false;
        }
        tx.set(ref, { colegioId: c.colegioId, anio, mes, estado: 'procesando', por: c.uid, porNombre: nombreDe(c.perfil), inicio: serverTimestamp() });
        return true;
    }).catch(e => { console.warn('Cobro mensual:', e.message); return false; });
    if (!tomado) return null;

    try {
        const datos = await cargarDatosCobro(c, { anioDesde: anio });
        const base = ['colegios', c.colegioId];
        const ops = [];
        let creadas = 0;
        for (const est of datos.estudiantes) {
            const inicio = inicioCobro(est, datos, anio);
            if (inicio.anio > anio || (inicio.anio === anio && inicio.mes > mes)) continue;
            if (datos.pensionesPorEst.get(est.id)?.has(`${anio}-${mes}`)) continue;
            const valor = valorPension(est, anio, mes, datos);
            if (!(valor > 0)) continue;
            const m = datos.matriculaPorEst.get(est.id);
            ops.push([doc(c.db, ...base, 'pensiones', `${clave}_${est.id}`), {
                estudianteId: est.id, cursoId: est.cursoId || m?.cursoId || '', mes, anio, valorPension: valor,
                totalAbonado: 0, saldo: valor, estado: 'pendiente', generadoAuto: true, creadoEn: serverTimestamp()
            }, { merge: true }]);
            ops.push([doc(c.db, ...base, 'notificaciones', `cobro_${clave}_${est.id}`), {
                estudianteId: est.id, tipo: 'cobro', prioridad: 'alta', leida: false,
                titulo: `🔔 Pensión de ${MESES[mes - 1]} ${anio}`,
                mensaje: MENSAJES.cobroMensual(est.nombreCompleto, mes, anio, valor),
                anio, mes, valor, remitenteUid: c.uid, remitenteNombre: 'Colegio', remitenteRol: 'sistema', fecha: serverTimestamp()
            }]);
            creadas++;
        }
        for (let i = 0; i < ops.length; i += 400) {
            const lote = writeBatch(c.db);
            ops.slice(i, i + 400).forEach(([r, d, o]) => o ? lote.set(r, d, o) : lote.set(r, d));
            await lote.commit();
        }
        await setDoc(ref, { estado: 'completo', creadas, fin: serverTimestamp() }, { merge: true });
        return { creadas, clave };
    } catch (e) {
        await setDoc(ref, { estado: 'error', error: String(e.message).slice(0, 300) }, { merge: true }).catch(() => {});
        throw e;
    }
}

// ---------------------------------------------------------------------
// Recordatorio de pago: una sola vez al día por estudiante
// ---------------------------------------------------------------------
export async function recordatoriosDeHoy(c) {
    const s = await getDocs(query(collection(c.db, 'colegios', c.colegioId, 'recordatorios_pago'), where('fecha', '==', ymd())));
    return new Map(s.docs.map(d => [d.data().estudianteId, d.data()]));
}

export async function enviarRecordatorio(c, est, cuenta) {
    const hoy = ymd();
    const ref = doc(c.db, 'colegios', c.colegioId, 'recordatorios_pago', `${est.id}_${hoy}`);
    const detalle = detalleDeuda(cuenta) || 'la pensión';
    await runTransaction(c.db, async tx => {
        const s = await tx.get(ref);
        if (s.exists()) {
            const d = s.data();
            throw new Error(`Ya se envió el recordatorio de hoy${d.porNombre ? ' (lo envió ' + d.porNombre + ')' : ''}. Podrás enviar otro mañana.`);
        }
        tx.set(ref, {
            estudianteId: est.id, estudianteNombre: est.nombreCompleto, fecha: hoy, total: cuenta.total, detalle,
            por: c.uid, porNombre: nombreDe(c.perfil), porRol: c.rol, creadoEn: serverTimestamp()
        });
        tx.set(doc(c.db, 'colegios', c.colegioId, 'notificaciones', `recordatorio_${est.id}_${hoy}`), {
            estudianteId: est.id, tipo: 'cobro', prioridad: 'alta', leida: false,
            titulo: '⚠️ Recordatorio de pago de pensión',
            mensaje: MENSAJES.recordatorio(est.nombreCompleto, detalle, cuenta.total),
            total: cuenta.total, remitenteUid: c.uid, remitenteNombre: 'Colegio', remitenteRol: 'sistema', fecha: serverTimestamp()
        });
    });
    return { detalle };
}

// ---------------------------------------------------------------------
// Boletines: habilitación por periodo (rectoría)
// ---------------------------------------------------------------------
export async function leerHabilitacionBoletines(c) {
    try {
        const s = await getDoc(doc(c.db, 'colegios', c.colegioId, 'configuracion_cobros', 'boletines'));
        return s.exists() ? (s.data().periodos || {}) : {};
    } catch { return {}; }
}

