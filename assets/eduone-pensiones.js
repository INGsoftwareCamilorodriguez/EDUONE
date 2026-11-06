/* =====================================================================
   EduOne - eduone-pensiones.js  (Secretaría: cobro de pensiones)
   Agrega la sección "Pensiones" al panel de secretaría:
   - Buscar estudiante (nombre o documento, sin importar tildes).
   - Ver los meses del año con valor, abonado, saldo y estado.
   - Registrar pagos o abonos (validados) y emitir recibo.
   Usa los mismos datos que rectoría y contador:
     configuracion_pensiones/{AAAA-MM}  -> valor mensual del colegio
     pensiones/{AAAA-MM}_{estudianteId} -> obligación del mes
     pagos_pensiones, movimientos        -> pago y su ingreso contable
   Se carga con: <script type="module" src="../assets/eduone-pensiones.js"></script>
   ===================================================================== */
import {
    collection, doc, getDocs, addDoc, query, where, runTransaction, serverTimestamp, onSnapshot
} from 'https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js';
import { obtenerContexto, notificarFamilia, nombreDe } from './eduone-comun.js?v=20261105';
import { el, agregarEstilos, agregarSeccion } from './eduone-secciones.js?v=20261105';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const METODOS = { efectivo: 'Efectivo', transferencia: 'Transferencia', consignacion: 'Consignación', tarjeta: 'Tarjeta débito/crédito', nequi: 'Nequi / Daviplata' };
const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const norm = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const hoyYmd = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const idMes = (anio, mes) => `${anio}-${String(mes).padStart(2, '0')}`;

const CSS = `
.pen-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:18px}
.pen-buscar{position:relative;max-width:520px}
.pen-sug{position:absolute;left:0;right:0;top:100%;z-index:40;background:#fff;border:1px solid var(--border,#e2e8f0);border-radius:12px;box-shadow:0 10px 30px rgba(15,23,42,.12);max-height:280px;overflow-y:auto;margin-top:4px}
.pen-sug button{display:block;width:100%;text-align:left;border:0;background:transparent;padding:10px 12px;font:inherit;font-size:.88rem;cursor:pointer;color:inherit}
.pen-sug button:hover,.pen-sug button:focus{background:var(--primary-bg,#eff6ff);outline:none}
.pen-sug small{color:var(--text-secondary,#64748b)}
.pen-est{display:flex;gap:16px;flex-wrap:wrap;align-items:center;justify-content:space-between;padding:14px 16px;border-radius:14px;background:var(--primary-bg,#eff6ff);margin:14px 0}
.pen-est strong{font-size:1.05rem;display:block}
.pen-est small{color:var(--text-secondary,#64748b);display:block}
.pen-tot{display:flex;gap:18px;flex-wrap:wrap}
.pen-tot div{text-align:right}
.pen-tot b{display:block;font-size:1.05rem}
.pen-tabla td,.pen-tabla th{white-space:nowrap}
.pen-chip{display:inline-block;padding:3px 10px;border-radius:999px;font-size:.74rem;font-weight:600}
.pen-chip.pagado{background:#dcfce7;color:#166534}.pen-chip.abonado{background:#fef3c7;color:#92400e}
.pen-chip.pendiente{background:#fee2e2;color:#991b1b}.pen-chip.sin{background:#f1f5f9;color:#64748b}
.pen-err{color:#dc2626;font-size:.78rem;display:block;margin-top:4px}
.pen-resumen{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:10px 0 14px}
.pen-resumen div{background:var(--bg,#f8fafc);border-radius:10px;padding:10px;text-align:center}
.pen-resumen small{display:block;color:var(--text-secondary,#64748b);font-size:.74rem}
.pen-resumen b{font-size:1rem}
.pen-hoy{display:flex;flex-direction:column;gap:8px}
.pen-hoy-item{display:flex;justify-content:space-between;gap:10px;border:1px solid var(--border,#e2e8f0);border-radius:12px;padding:10px 12px;flex-wrap:wrap}
@media (max-width:640px){.pen-resumen{grid-template-columns:1fr}.pen-tot{width:100%;justify-content:space-between}.pen-tot div{text-align:left}}
`;

let c = null;
let estudiantes = [];
let cursos = new Map();
let estSel = null;
let pensionesEst = new Map();   // "anio-mes" -> { id, ...datos }
let configValores = new Map();  // "AAAA-MM" -> valor

function valorDelMes(est, anio, mes) {
    const p = pensionesEst.get(`${anio}-${mes}`);
    if (p) return Number(p.valorPension) || 0;
    const individual = Number(est.valorPension ?? est.pensionMensual ?? 0);
    return individual > 0 ? individual : (configValores.get(idMes(anio, mes)) || 0);
}

async function montar() {
    c = await obtenerContexto();
    if (!['secretaria', 'rector', 'admin_colegio'].includes(c.rol) || !c.colegioId) return;
    const sec = agregarSeccion({ id: 'pensiones', icono: 'fas fa-money-bill-wave', texto: 'Pensiones', grupo: 'COBROS', titulo: 'Pago de pensiones' });
    if (!sec) return;
    agregarEstilos('eduPensionesCss', CSS);

    const anioSel = el('select', { class: 'form-control', id: 'penAnio', 'aria-label': 'Año', style: 'max-width:130px' });
    const y = new Date().getFullYear();
    for (const a of [y + 1, y, y - 1]) anioSel.append(el('option', { value: String(a), text: String(a), selected: a === y }));
    const buscar = el('input', { type: 'search', class: 'form-control', id: 'penBuscar', placeholder: 'Nombre o documento del estudiante...', autocomplete: 'off', maxlength: '60', 'aria-label': 'Buscar estudiante' });
    const sug = el('div', { class: 'pen-sug', hidden: true, role: 'listbox' });
    const detalle = el('div', { id: 'penDetalle' }, el('p', { class: 'text-muted', text: 'Busca un estudiante para ver sus pensiones y registrar pagos.' }));
    const hoy = el('div', { class: 'pen-hoy', id: 'penHoy' });
    const totalHoy = el('strong', { text: COP.format(0) });

    sec.pagina.append(el('div', { class: 'pen-grid' },
        el('div', { class: 'card' },
            el('div', { class: 'card-header', style: 'display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center' },
                el('h2', {}, el('i', { class: 'fas fa-money-bill-wave', style: 'color:var(--primary)' }), ' Cobro de pensiones'),
                el('label', { style: 'display:flex;gap:8px;align-items:center;font-size:.88rem' }, 'Año', anioSel)),
            el('div', { class: 'card-body' },
                el('div', { class: 'pen-buscar' }, buscar, sug),
                detalle)),
        el('div', { class: 'card' },
            el('div', { class: 'card-header', style: 'display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap' },
                el('h2', {}, el('i', { class: 'fas fa-receipt', style: 'color:var(--primary)' }), ' Pagos registrados hoy'),
                el('span', {}, 'Total: ', totalHoy)),
            el('div', { class: 'card-body' }, hoy))));
    document.body.append(modalPago());

    // Datos base
    try {
        const [e, cs, cfg] = await Promise.all([
            getDocs(collection(c.db, 'colegios', c.colegioId, 'estudiantes')),
            getDocs(collection(c.db, 'colegios', c.colegioId, 'cursos')),
            getDocs(collection(c.db, 'colegios', c.colegioId, 'configuracion_pensiones'))
        ]);
        cursos = new Map(cs.docs.map(d => [d.id, d.data().nombre || '']));
        configValores = new Map(cfg.docs.map(d => [d.id, Number(d.data().valor) || 0]));
        estudiantes = e.docs.map(d => ({ id: d.id, ...d.data() }))
            .filter(x => !['retirado', 'inactivo'].includes(x.estado) && x.activo !== false)
            .map(x => ({ ...x, nombreCompleto: `${x.nombres || ''} ${x.apellidos || ''}`.trim() || 'Estudiante' }))
            .sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto, 'es'));
    } catch (err) {
        detalle.replaceChildren(el('p', { class: 'text-danger', text: 'No se pudieron cargar los estudiantes: ' + err.message }));
    }

    const pintarSug = () => {
        const q = norm(buscar.value);
        if (q.length < 2) { sug.hidden = true; return; }
        const res = estudiantes.filter(e => norm(e.nombreCompleto).includes(q) || norm(e.documento).includes(q)).slice(0, 20);
        sug.replaceChildren(...res.map(e => el('button', {
            type: 'button', role: 'option',
            onclick: () => { buscar.value = e.nombreCompleto; sug.hidden = true; elegir(e); }
        }, el('strong', { text: e.nombreCompleto }), el('small', { text: ` · Doc. ${e.documento || '-'} · ${cursos.get(e.cursoId) || 'Sin curso'}` }))));
        if (!res.length) sug.append(el('div', { style: 'padding:12px', class: 'text-muted', text: 'No se encontraron estudiantes' }));
        sug.hidden = false;
    };
    buscar.addEventListener('input', pintarSug);
    buscar.addEventListener('focus', pintarSug);
    buscar.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); sug.querySelector('button')?.click(); }
        if (e.key === 'ArrowDown') { e.preventDefault(); sug.querySelector('button')?.focus(); }
    });
    document.addEventListener('pointerdown', e => { if (!sug.contains(e.target) && e.target !== buscar) sug.hidden = true; });
    anioSel.addEventListener('change', () => estSel && elegir(estSel));

    // Pagos de hoy (de todo el colegio)
    onSnapshot(query(collection(c.db, 'colegios', c.colegioId, 'pagos_pensiones'), where('fecha', '==', hoyYmd())), snap => {
        const pagos = snap.docs.map(d => d.data()).sort((a, b) => (b.fechaCreacion?.toMillis?.() || 0) - (a.fechaCreacion?.toMillis?.() || 0));
        totalHoy.textContent = COP.format(pagos.reduce((s, p) => s + (Number(p.monto) || 0), 0));
        hoy.replaceChildren(...pagos.map(p => el('div', { class: 'pen-hoy-item' },
            el('div', {}, el('strong', { text: p.estudianteNombre || estudiantes.find(e => e.id === p.estudianteId)?.nombreCompleto || 'Estudiante' }),
                el('small', { class: 'text-muted', style: 'display:block', text: `${MESES[(p.mes || 1) - 1]} ${p.anio} · ${METODOS[p.metodo] || p.metodo || ''}${p.referencia ? ' · Ref. ' + p.referencia : ''}` })),
            el('strong', { text: COP.format(Number(p.monto) || 0) }))));
        if (!pagos.length) hoy.append(el('p', { class: 'text-muted', text: 'Aún no hay pagos registrados hoy.' }));
    }, err => hoy.replaceChildren(el('p', { class: 'text-danger', text: 'No se pudieron cargar los pagos: ' + err.message })));
}

async function elegir(est) {
    estSel = est;
    const detalle = document.getElementById('penDetalle');
    detalle.replaceChildren(el('p', { class: 'text-muted', text: 'Cargando pensiones...' }));
    const anio = Number(document.getElementById('penAnio').value);
    try {
        const snap = await getDocs(query(collection(c.db, 'colegios', c.colegioId, 'pensiones'), where('estudianteId', '==', est.id)));
        pensionesEst = new Map(snap.docs.map(d => [`${d.data().anio}-${d.data().mes}`, { id: d.id, ...d.data() }]));
    } catch (err) {
        detalle.replaceChildren(el('p', { class: 'text-danger', text: 'Error: ' + err.message }));
        return;
    }
    const filas = [];
    let totValor = 0, totAbonado = 0;
    for (let mes = 1; mes <= 12; mes++) {
        const p = pensionesEst.get(`${anio}-${mes}`);
        const valor = valorDelMes(est, anio, mes);
        if (!p && !valor) continue;   // mes sin cobro configurado
        const abonado = Number(p?.totalAbonado) || 0;
        const saldo = Math.max(0, valor - abonado);
        const estado = !p ? 'sin' : (saldo === 0 ? 'pagado' : abonado > 0 ? 'abonado' : 'pendiente');
        totValor += valor; totAbonado += abonado;
        filas.push(el('tr', {},
            el('td', { text: MESES[mes - 1] }),
            el('td', { text: COP.format(valor) }),
            el('td', { text: COP.format(abonado) }),
            el('td', {}, el('strong', { text: COP.format(saldo) })),
            el('td', {}, el('span', { class: 'pen-chip ' + estado, text: { sin: 'Sin generar', pagado: 'Pagado', abonado: 'Abonado', pendiente: 'Pendiente' }[estado] })),
            el('td', {}, saldo > 0
                ? el('button', { type: 'button', class: 'btn-primary', style: 'padding:6px 12px;font-size:.8rem', onclick: () => abrirPago(est, anio, mes) }, el('i', { class: 'fas fa-cash-register' }), ' Registrar pago')
                : el('span', { class: 'text-muted', text: '—' }))));
    }
    const acudiente = est.acudiente ? `Acudiente: ${est.acudiente}${est.acudienteTelefono ? ' · Tel. ' + est.acudienteTelefono : ''}` : 'Sin acudiente registrado';
    detalle.replaceChildren(
        el('div', { class: 'pen-est' },
            el('div', {}, el('strong', { text: est.nombreCompleto }),
                el('small', { text: `Doc. ${est.documento || '-'} · ${cursos.get(est.cursoId) || 'Sin curso'}` }),
                el('small', { text: acudiente })),
            el('div', { class: 'pen-tot' },
                el('div', {}, el('small', { text: `Total ${anio}` }), el('b', { text: COP.format(totValor) })),
                el('div', {}, el('small', { text: 'Pagado' }), el('b', { text: COP.format(totAbonado), style: 'color:var(--success,#16a34a)' })),
                el('div', {}, el('small', { text: 'Debe' }), el('b', { text: COP.format(Math.max(0, totValor - totAbonado)), style: 'color:var(--danger,#dc2626)' })))),
        filas.length
            ? el('div', { class: 'table-responsive' }, el('table', { class: 'table-modern pen-tabla' },
                el('thead', {}, el('tr', {}, ...['Mes', 'Valor', 'Abonado', 'Saldo', 'Estado', ''].map(t => el('th', { text: t })))),
                el('tbody', {}, filas)))
            : el('p', { class: 'text-muted', text: `No hay pensiones configuradas para ${anio}. Rectoría debe definir el valor mensual (Pensiones → valor del mes).` }));
}

// ---------------------------------------------------------------------
// Modal de pago
// ---------------------------------------------------------------------
let pagoActual = null;
function modalPago() {
    const campo = (label, input, err) => el('div', { class: 'form-group' }, el('label', { for: input.id, text: label }), input, err);
    const monto = el('input', { type: 'text', inputmode: 'numeric', class: 'form-control', id: 'penMonto', placeholder: 'Ej: 250000', maxlength: '12', autocomplete: 'off' });
    const metodo = el('select', { class: 'form-control', id: 'penMetodo' }, ...Object.entries(METODOS).map(([k, v]) => el('option', { value: k, text: v })));
    const ref = el('input', { type: 'text', class: 'form-control', id: 'penReferencia', placeholder: 'N.º de transacción o comprobante', maxlength: '40', autocomplete: 'off' });
    const fecha = el('input', { type: 'date', class: 'form-control', id: 'penFecha' });
    const recibo = el('input', { type: 'checkbox', id: 'penRecibo', checked: true });
    const errMonto = el('span', { class: 'pen-err', hidden: true }), errRef = el('span', { class: 'pen-err', hidden: true }), errFecha = el('span', { class: 'pen-err', hidden: true });
    const alerta = el('div', { class: 'alert', style: 'display:none' });
    const resumen = el('div', { class: 'pen-resumen', id: 'penResumen' });
    const btn = el('button', { type: 'submit', class: 'btn-primary', id: 'penGuardar' }, el('i', { class: 'fas fa-save' }), ' Registrar pago');
    const cerrar = () => modal.classList.remove('show');

    // Solo números en el monto (con separadores de miles al escribir)
    monto.addEventListener('input', () => {
        const dig = monto.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 10);
        monto.value = dig ? Number(dig).toLocaleString('es-CO') : '';
        errMonto.hidden = true;
    });
    ref.addEventListener('input', () => { ref.value = ref.value.replace(/[^\w-]/g, '').slice(0, 40); errRef.hidden = true; });
    metodo.addEventListener('change', () => { ref.placeholder = metodo.value === 'efectivo' ? 'Opcional' : 'N.º de transacción o comprobante (obligatorio)'; });

    const form = el('form', { novalidate: true },
        el('div', { class: 'modal-body' }, alerta,
            el('p', { id: 'penModalEst', style: 'font-weight:600' }), resumen,
            el('div', { class: 'form-grid' },
                campo('Valor a pagar (COP) *', monto, errMonto),
                campo('Método de pago *', metodo),
                campo('Referencia', ref, errRef),
                campo('Fecha del pago *', fecha, errFecha)),
            el('label', { style: 'display:flex;gap:8px;align-items:center;cursor:pointer;font-size:.88rem' }, recibo, 'Imprimir recibo al guardar')),
        el('div', { class: 'modal-footer' },
            el('button', { type: 'button', class: 'btn-secondary', text: 'Cancelar', onclick: cerrar }), btn));

    form.addEventListener('submit', async e => {
        e.preventDefault();
        alerta.style.display = 'none';
        const valorMonto = Number(monto.value.replace(/\D/g, ''));
        const saldo = pagoActual.saldo;
        let ok = true;
        const err = (n, t) => { n.textContent = t; n.hidden = false; ok = false; };
        if (!valorMonto || valorMonto <= 0) err(errMonto, 'Escribe un valor mayor a cero.');
        else if (valorMonto > saldo) err(errMonto, `El valor no puede ser mayor al saldo (${COP.format(saldo)}).`);
        if (metodo.value !== 'efectivo' && ref.value.trim().length < 3) err(errRef, 'Escribe la referencia del pago (mínimo 3 caracteres).');
        if (!fecha.value) err(errFecha, 'Elige la fecha del pago.');
        else if (fecha.value > hoyYmd()) err(errFecha, 'La fecha no puede ser futura.');
        if (!ok) return;
        btn.disabled = true;
        try {
            const r = await registrarPago({ ...pagoActual, monto: valorMonto, metodo: metodo.value, referencia: ref.value.trim(), fecha: fecha.value });
            if (recibo.checked) imprimirRecibo(r);
            cerrar();
            await elegir(pagoActual.est);
        } catch (er) {
            alerta.className = 'alert alert-error show'; alerta.textContent = '❌ ' + er.message; alerta.style.display = 'block';
        } finally { btn.disabled = false; }
    });

    const modal = el('div', { class: 'modal', id: 'modalPagoSecretaria' },
        el('div', { class: 'modal-overlay', onclick: cerrar }),
        el('div', { class: 'modal-content', style: 'max-width:640px' },
            el('div', { class: 'modal-header' },
                el('h2', {}, el('i', { class: 'fas fa-cash-register', style: 'color:var(--primary)' }), ' Registrar pago de pensión'),
                el('button', { type: 'button', class: 'modal-close', 'aria-label': 'Cerrar', onclick: cerrar }, '×')),
            form));
    return modal;
}

function abrirPago(est, anio, mes) {
    const p = pensionesEst.get(`${anio}-${mes}`);
    const valor = valorDelMes(est, anio, mes);
    const abonado = Number(p?.totalAbonado) || 0;
    pagoActual = { est, anio, mes, valor, abonado, saldo: Math.max(0, valor - abonado), pensionId: p?.id || null };
    document.getElementById('penModalEst').textContent = `${est.nombreCompleto} · Pensión de ${MESES[mes - 1]} ${anio}`;
    document.getElementById('penResumen').replaceChildren(
        el('div', {}, el('small', { text: 'Valor del mes' }), el('b', { text: COP.format(valor) })),
        el('div', {}, el('small', { text: 'Ya abonado' }), el('b', { text: COP.format(abonado) })),
        el('div', {}, el('small', { text: 'Saldo' }), el('b', { text: COP.format(pagoActual.saldo), style: 'color:var(--danger,#dc2626)' })));
    const m = document.getElementById('penMonto');
    m.value = pagoActual.saldo.toLocaleString('es-CO');
    document.getElementById('penMetodo').value = 'efectivo';
    document.getElementById('penReferencia').value = '';
    document.getElementById('penFecha').value = hoyYmd();
    document.getElementById('penFecha').max = hoyYmd();
    document.querySelectorAll('#modalPagoSecretaria .pen-err').forEach(e => { e.hidden = true; });
    document.querySelector('#modalPagoSecretaria .alert').style.display = 'none';
    document.getElementById('modalPagoSecretaria').classList.add('show');
    m.focus();
}

/** Actualiza la obligación del mes en una transacción (dos pagos simultáneos no se pisan). */
async function registrarPago({ est, anio, mes, valor, pensionId, monto, metodo, referencia, fecha }) {
    const base = ['colegios', c.colegioId];
    const ref = doc(c.db, ...base, 'pensiones', pensionId || `${idMes(anio, mes)}_${est.id}`);
    const res = await runTransaction(c.db, async tx => {
        const snap = await tx.get(ref);
        const datos = snap.exists() ? snap.data() : null;
        const valorMes = datos ? (Number(datos.valorPension) || valor) : valor;
        const abonado = Number(datos?.totalAbonado) || 0;
        const saldoAntes = Math.max(0, valorMes - abonado);
        if (monto > saldoAntes) throw new Error(`Otro usuario registró un pago hace un momento. El saldo ahora es ${COP.format(saldoAntes)}.`);
        const nuevoAbonado = abonado + monto;
        const saldo = Math.max(0, valorMes - nuevoAbonado);
        const estado = saldo === 0 ? 'pagado' : 'abonado';
        if (datos) tx.update(ref, { totalAbonado: nuevoAbonado, saldo, estado, fechaActualizacion: serverTimestamp() });
        else tx.set(ref, { estudianteId: est.id, cursoId: est.cursoId || '', mes, anio, valorPension: valorMes, totalAbonado: nuevoAbonado, saldo, estado, creadoEn: serverTimestamp() });
        return { valorMes, nuevoAbonado, saldo, estado };
    });
    const comun = { estudianteId: est.id, estudianteNombre: est.nombreCompleto, monto, metodo, referencia, fecha, creadoPor: c.uid, creadoPorNombre: nombreDe(c.perfil), rolCreador: c.rol, fechaCreacion: serverTimestamp() };
    const pago = await addDoc(collection(c.db, ...base, 'pagos_pensiones'), { ...comun, pensionId: ref.id, mes, anio });
    await addDoc(collection(c.db, ...base, 'movimientos'), {
        ...comun, tipo: 'ingreso', categoria: 'Pensión',
        descripcion: `Pago pensión ${MESES[mes - 1]} ${anio} - ${est.nombreCompleto}`
    });
    notificarFamilia(est.id, '💳 Pago de pensión registrado',
        `Se registró un pago de ${COP.format(monto)} a la pensión de ${MESES[mes - 1]} ${anio} de ${est.nombreCompleto}. ${res.saldo === 0 ? 'El mes quedó al día.' : 'Saldo pendiente: ' + COP.format(res.saldo) + '.'}`,
        'pago').catch(e => console.warn('Aviso de pago:', e.message));
    return { ...res, est, anio, mes, monto, metodo, referencia, fecha, recibo: pago.id.slice(0, 8).toUpperCase() };
}

function imprimirRecibo(r) {
    const colegio = document.getElementById('eduInstitutionName')?.textContent || document.getElementById('colegioNombreSidebar')?.textContent || 'Colegio';
    const w = window.open('', '_blank', 'width=420,height=640');
    if (!w) { alert('Permite las ventanas emergentes para imprimir el recibo.'); return; }
    const filas = [
        ['Recibo N.º', r.recibo], ['Fecha', r.fecha], ['Estudiante', r.est.nombreCompleto], ['Documento', r.est.documento || '-'],
        ['Concepto', `Pensión ${MESES[r.mes - 1]} ${r.anio}`], ['Método', METODOS[r.metodo] || r.metodo], ['Referencia', r.referencia || '-'],
        ['Valor pagado', COP.format(r.monto)], ['Saldo del mes', COP.format(r.saldo)], ['Atendió', nombreDe(c.perfil)]
    ];
    const d = w.document;
    d.title = 'Recibo de pago';
    const st = d.createElement('style');
    st.textContent = 'body{font-family:Arial,sans-serif;padding:24px;color:#0f172a}h1{font-size:18px;margin:0 0 4px}p{margin:0 0 16px;color:#64748b;font-size:12px}table{width:100%;border-collapse:collapse;font-size:13px}td{padding:7px 4px;border-bottom:1px dashed #cbd5e1}td:last-child{text-align:right;font-weight:600}.f{margin-top:28px;font-size:11px;color:#64748b;text-align:center}';
    d.head.append(st);
    const h = d.createElement('h1'); h.textContent = colegio;
    const p = d.createElement('p'); p.textContent = 'Recibo de pago de pensión';
    const t = d.createElement('table');
    filas.forEach(([a, b]) => { const tr = t.insertRow(); tr.insertCell().textContent = a; tr.insertCell().textContent = b; });
    const f = d.createElement('div'); f.className = 'f'; f.textContent = 'Generado por EduOne';
    d.body.append(h, p, t, f);
    setTimeout(() => { w.print(); }, 300);
}

const go = () => montar().catch(e => console.warn('EduOne pensiones:', e.message));
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
