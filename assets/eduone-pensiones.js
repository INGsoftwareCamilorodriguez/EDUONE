/* =====================================================================
   EduOne - eduone-pensiones.js  (Cobros: secretaría y rectoría)
   La secretaría maneja los cobros y pagos; rectoría ve lo mismo (y fija
   la política de cobro). El contador solo consulta y verifica (contador.html).
   Pestañas de la sección "Cobros":
   1) Estado de pagos: todos los estudiantes con su deuda, filtros por
      grado/curso/estado y búsqueda. Botón "Recordar pago" (una sola vez
      al día por estudiante; más visible si lleva 15 días o más sin pagar).
   2) Registrar pago: pensiones del año, matrícula y eventos del estudiante.
      Los valores se validan: solo números, mayor a cero y nunca mayor al
      saldo (450.000 se lee como cuatrocientos cincuenta mil).
   3) Eventos: eventos de pago del colegio (jean day, feria...).
   4) Pagos de hoy.
   5) Política de cobro: pensión del mes de ingreso, día límite y meses.
   El cobro de la pensión de cada mes se genera solo (una vez por mes)
   y le llega un aviso importante al acudiente (eduone-cobros.js).
   Datos: configuracion_pensiones, pensiones, pagos_pensiones, matriculas,
   pagos_matriculas, eventos_cobro, cargos_eventos, pagos_eventos,
   movimientos (ingreso contable), notificaciones, recordatorios_pago.
   ===================================================================== */
import {
    collection, doc, getDoc, getDocs, addDoc, query, where, runTransaction, serverTimestamp, onSnapshot, writeBatch
} from 'https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js';
import { obtenerContexto, notificarFamilia, nombreDe } from './eduone-comun.js?v=20261107';
import { el, agregarEstilos, agregarSeccion } from './eduone-secciones.js?v=20261107';
import {
    MESES, COP, idMes, ymd, norm, cargarDatosCobro, estadoCuenta, textoEstado, gradoDe, generarCobroMensual,
    recordatoriosDeHoy, enviarRecordatorio, leerPolitica, guardarPolitica, valorPension
} from './eduone-cobros.js?v=20261107';

const METODOS = { efectivo: 'Efectivo', transferencia: 'Transferencia', consignacion: 'Consignación', tarjeta: 'Tarjeta débito/crédito', nequi: 'Nequi / Daviplata' };
const ROLES = ['secretaria', 'rector', 'admin_colegio', 'admin_auxiliar'];
const EDITAN_POLITICA = ['rector', 'admin_colegio'];

const CSS = `
.cob-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 16px;padding:6px;background:#fff;border:1px solid #e6edf6;border-radius:14px}
.cob-tabs button{display:flex;align-items:center;gap:8px;border:0;background:transparent;padding:10px 14px;border-radius:10px;font:600 .86rem var(--font,Inter,system-ui,sans-serif);color:#33415f;cursor:pointer}
.cob-tabs button:hover,.cob-tabs button.activo{background:var(--primary-bg,#eff6ff);color:var(--primary,#2563eb)}
.cob-panel[hidden]{display:none!important}
.cob-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px}
.cob-kpi{background:#fff;border:1px solid #e6edf6;border-radius:14px;padding:14px 16px}
.cob-kpi small{display:block;color:var(--text-secondary,#64748b);font-size:.76rem}
.cob-kpi b{font-size:1.25rem}
.pen-buscar{position:relative;max-width:560px}
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
.pen-chip{display:inline-block;padding:3px 10px;border-radius:999px;font-size:.74rem;font-weight:600;white-space:nowrap}
.pen-chip.pagado{background:#dcfce7;color:#166534}.pen-chip.abonado{background:#fef3c7;color:#92400e}
.pen-chip.pendiente{background:#fee2e2;color:#991b1b}.pen-chip.sin{background:#f1f5f9;color:#64748b}
.pen-chip.mora15{background:#dc2626;color:#fff}
.pen-err{color:#dc2626;font-size:.78rem;display:block;margin-top:4px}
.pen-resumen{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:10px 0 14px}
.pen-resumen div{background:var(--bg,#f8fafc);border-radius:10px;padding:10px;text-align:center}
.pen-resumen small{display:block;color:var(--text-secondary,#64748b);font-size:.74rem}
.pen-resumen b{font-size:1rem}
.pen-hoy{display:flex;flex-direction:column;gap:8px}
.pen-hoy-item{display:flex;justify-content:space-between;gap:10px;border:1px solid var(--border,#e2e8f0);border-radius:12px;padding:10px 12px;flex-wrap:wrap}
.pen-subt{font-size:.95rem;margin:18px 0 8px;display:flex;align-items:center;gap:8px}
.cob-acciones{display:flex;gap:6px;flex-wrap:nowrap}
.cob-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid #dbe3ee;background:#fff;border-radius:9px;padding:7px 11px;font:600 .78rem var(--font,Inter,system-ui,sans-serif);color:#33415f;cursor:pointer;white-space:nowrap}
.cob-btn:hover{border-color:var(--primary,#2563eb);color:var(--primary,#2563eb)}
.cob-btn:disabled{opacity:.55;cursor:not-allowed}
.cob-btn.recordar{border-color:#f59e0b;color:#b45309;background:#fffbeb}
.cob-btn.recordar.urgente{background:#f59e0b;color:#fff;border-color:#f59e0b;box-shadow:0 0 0 0 rgba(245,158,11,.7);animation:cobPulso 1.6s infinite}
.cob-btn.enviado{border-color:#bbf7d0;background:#f0fdf4;color:#15803d}
@keyframes cobPulso{0%{box-shadow:0 0 0 0 rgba(245,158,11,.65)}70%{box-shadow:0 0 0 10px rgba(245,158,11,0)}100%{box-shadow:0 0 0 0 rgba(245,158,11,0)}}
.cob-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.cob-meses{display:flex;flex-wrap:wrap;gap:8px}
.cob-meses label{display:flex;gap:6px;align-items:center;border:1px solid #e2e8f0;border-radius:9px;padding:6px 10px;font-size:.82rem;cursor:pointer}
.cob-info{background:#f8fafc;border:1px dashed #cbd5e1;border-radius:12px;padding:12px 14px;font-size:.85rem;color:#334155}
@media (max-width:900px){.cob-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.cob-form-grid{grid-template-columns:1fr}}
@media (max-width:640px){.pen-resumen{grid-template-columns:1fr}.pen-tot{width:100%;justify-content:space-between}.pen-tot div{text-align:left}}
`;

let c = null;
let datos = null;                 // de cargarDatosCobro
let eventos = [];                 // eventos_cobro
let cargos = new Map();           // `${eventoId}_${estId}` -> cargo
let recordados = new Map();       // estudianteId -> recordatorio de hoy
let estSel = null;
let toast = () => {};

const mostrarToast = (texto, tipo = 'info') => {
    let t = document.getElementById('cobToast');
    if (!t) {
        t = el('div', { id: 'cobToast', role: 'status', style: 'position:fixed;bottom:22px;right:22px;z-index:3000;max-width:420px;padding:12px 16px;border-radius:12px;color:#fff;font:600 .88rem var(--font,Inter,sans-serif);box-shadow:0 12px 30px rgba(15,23,42,.25);display:none' });
        document.body.append(t);
    }
    t.style.background = tipo === 'error' ? '#dc2626' : tipo === 'ok' ? '#16a34a' : '#1e293b';
    t.textContent = texto;
    t.style.display = 'block';
    clearTimeout(t._h);
    t._h = setTimeout(() => { t.style.display = 'none'; }, 5000);
};

const enAlcance = (ev, est) => {
    if (ev.estado === 'cerrado') return false;
    if (ev.alcance === 'grado') return (ev.gradoIds || []).includes(gradoDe(est, datos));
    if (ev.alcance === 'curso') return (ev.cursoIds || []).includes(est.cursoId || datos.matriculaPorEst.get(est.id)?.cursoId);
    return true;
};

async function cargarTodo() {
    const base = ['colegios', c.colegioId];
    const [d, evSnap, cgSnap, rec] = await Promise.all([
        cargarDatosCobro(c),
        getDocs(collection(c.db, ...base, 'eventos_cobro')).catch(() => ({ docs: [] })),
        getDocs(collection(c.db, ...base, 'cargos_eventos')).catch(() => ({ docs: [] })),
        recordatoriosDeHoy(c).catch(() => new Map())
    ]);
    datos = d;
    eventos = evSnap.docs.map(x => ({ id: x.id, ...x.data() })).sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
    cargos = new Map(cgSnap.docs.map(x => [x.id, { id: x.id, ...x.data() }]));
    recordados = rec;
}

// ---------------------------------------------------------------------
// Montaje
// ---------------------------------------------------------------------
async function montar() {
    c = await obtenerContexto();
    if (!ROLES.includes(c.rol) || !c.colegioId) return;
    const esSecretaria = c.rol === 'secretaria';
    const sec = agregarSeccion({
        id: 'cobros', icono: 'fas fa-cash-register', texto: esSecretaria ? 'Cobros' : 'Cobros y cartera',
        grupo: 'COBROS', titulo: 'Cobros y pagos', principal: esSecretaria, menu: 'Finanzas'
    });
    if (!sec) return;
    agregarEstilos('eduCobrosCss', CSS);
    toast = mostrarToast;

    const tabs = [
        ['estado', 'fas fa-list-check', 'Estado de pagos'],
        ['pago', 'fas fa-cash-register', 'Registrar pago'],
        ['eventos', 'fas fa-calendar-check', 'Eventos'],
        ['hoy', 'fas fa-receipt', 'Pagos de hoy'],
        ['politica', 'fas fa-sliders', 'Política de cobro']
    ];
    const barra = el('div', { class: 'cob-tabs', role: 'tablist' });
    const paneles = {};
    for (const [id, icono, texto] of tabs) {
        barra.append(el('button', { type: 'button', role: 'tab', 'data-tab': id, onclick: () => abrirTab(id) }, el('i', { class: icono }), texto));
        paneles[id] = el('div', { class: 'cob-panel', 'data-panel': id, hidden: true });
    }
    sec.pagina.append(barra, ...Object.values(paneles));
    document.body.append(modalPago());

    function abrirTab(id) {
        barra.querySelectorAll('button').forEach(b => b.classList.toggle('activo', b.dataset.tab === id));
        Object.entries(paneles).forEach(([k, p]) => { p.hidden = k !== id; });
        if (id === 'estado') pintarEstado();
        if (id === 'eventos') pintarEventos();
        if (id === 'politica') pintarPolitica();
    }
    window.__eduCobrosAbrir = (tab, est) => { sec.mostrar(); abrirTab(tab); if (est) elegir(est); };

    montarEstado(paneles.estado);
    montarPago(paneles.pago);
    montarEventos(paneles.eventos);
    montarHoy(paneles.hoy);
    montarPolitica(paneles.politica);
    abrirTab('estado');

    let cargado = false;
    const cargar = async () => {
        try { await cargarTodo(); cargado = true; pintarEstado(); }
        catch (e) { paneles.estado.querySelector('tbody')?.replaceChildren(el('tr', {}, el('td', { colspan: '7', class: 'text-center text-danger', text: 'No se pudieron cargar los datos: ' + e.message }))); }
    };
    sec.pagina.addEventListener('edu:mostrar', () => { if (!cargado) cargar(); });

    // Cobro automático del mes (una sola vez por mes y por colegio)
    generarCobroMensual(c).then(r => {
        if (r?.creadas) { toast(`Se generó el cobro de la pensión de ${MESES[new Date().getMonth()]} para ${r.creadas} estudiantes y se avisó a las familias.`, 'ok'); if (cargado) cargar(); }
    }).catch(e => console.warn('Cobro mensual:', e.message));
}

// ---------------------------------------------------------------------
// 1) Estado de pagos
// ---------------------------------------------------------------------
let refsEstado = null;
function montarEstado(p) {
    const kpi = (id, txt) => el('div', { class: 'cob-kpi' }, el('small', { text: txt }), el('b', { id, text: '—' }));
    const buscar = el('input', { type: 'search', class: 'form-control edu-buscar-input', placeholder: 'Buscar por estudiante, documento o acudiente...', maxlength: '60', 'aria-label': 'Buscar estudiante' });
    const fGrado = el('select', { class: 'form-control', 'aria-label': 'Grado' }, el('option', { value: '', text: 'Todos los grados' }));
    const fCurso = el('select', { class: 'form-control', 'aria-label': 'Curso' }, el('option', { value: '', text: 'Todos los cursos' }));
    const fEstado = el('select', { class: 'form-control', 'aria-label': 'Estado de pago' },
        ...[['', 'Todos los estados'], ['pagado', 'Al día'], ['abonado', 'Pendiente del mes'], ['pendiente', 'En mora'], ['mora15', 'En mora +15 días']].map(([v, t]) => el('option', { value: v, text: t })));
    const actualizar = el('button', { type: 'button', class: 'btn-secondary', title: 'Actualizar' }, el('i', { class: 'fas fa-rotate' }), ' Actualizar');
    const tbody = el('tbody', {}, el('tr', {}, el('td', { colspan: '7', class: 'text-center text-muted', text: 'Cargando estado de pagos...' })));
    p.append(
        el('div', { class: 'cob-kpis' }, kpi('cobKpiAlDia', 'Al día'), kpi('cobKpiPend', 'Pendientes / en mora'), kpi('cobKpiMora', 'En mora +15 días'), kpi('cobKpiTotal', 'Total por cobrar')),
        el('div', { class: 'card', 'data-sin-filtros': '' }, el('div', { class: 'card-body' },
            el('div', { class: 'edu-filtros', 'data-sin-filtros': '' }, el('div', { class: 'edu-buscar' }, el('i', { class: 'fas fa-search' }), buscar), fGrado, fCurso, fEstado, actualizar),
            el('p', { class: 'text-muted', style: 'font-size:.8rem;margin:-6px 0 12px', text: '🔔 "Recordar pago" envía un aviso al acudiente. Se puede usar una sola vez al día por estudiante; se ve más brillante cuando la familia lleva 15 días o más sin pagar.' }),
            el('div', { class: 'table-responsive' }, el('table', { class: 'table-modern pen-tabla' },
                el('thead', {}, el('tr', {}, ...['#', 'Estudiante', 'Curso', 'Acudiente', 'Pendiente', 'Deuda', 'Estado', 'Acciones'].map(t => el('th', { text: t })))),
                tbody)))));
    refsEstado = { buscar, fGrado, fCurso, fEstado, tbody };
    [buscar].forEach(x => x.addEventListener('input', pintarEstado));
    [fGrado, fCurso, fEstado].forEach(x => x.addEventListener('change', () => { if (x === fGrado) llenarCursos(); pintarEstado(); }));
    actualizar.addEventListener('click', async () => {
        actualizar.disabled = true;
        try { await cargarTodo(); pintarEstado(); } catch (e) { toast('No se pudo actualizar: ' + e.message, 'error'); }
        finally { actualizar.disabled = false; }
    });
}

function llenarCursos() {
    const { fGrado, fCurso } = refsEstado;
    const actual = fCurso.value;
    const lista = [...datos.cursos.entries()].filter(([, v]) => !fGrado.value || v.gradoId === fGrado.value)
        .sort((a, b) => a[1].nombre.localeCompare(b[1].nombre, 'es', { numeric: true }));
    fCurso.replaceChildren(el('option', { value: '', text: 'Todos los cursos' }), ...lista.map(([id, v]) => el('option', { value: id, text: v.nombre })));
    fCurso.value = lista.some(([id]) => id === actual) ? actual : '';
}

function pintarEstado() {
    if (!refsEstado || !datos) return;
    const { buscar, fGrado, fCurso, fEstado, tbody } = refsEstado;
    // Grados (una sola vez)
    if (!fGrado.dataset.cargado) {
        fGrado.dataset.cargado = '1';
        const grados = new Map();
        getDocs(collection(c.db, 'colegios', c.colegioId, 'grados')).then(s => {
            s.forEach(d => grados.set(d.id, d.data().nombre || 'Grado'));
            [...grados.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es', { numeric: true }))
                .forEach(([id, n]) => fGrado.append(el('option', { value: id, text: n })));
        }).catch(() => {});
        llenarCursos();
    }
    const q = norm(buscar.value).split(' ').filter(Boolean);
    let alDia = 0, pend = 0, mora = 0, total = 0;
    const filas = [];
    let n = 0;
    for (const est of datos.estudiantes) {
        const cuenta = estadoCuenta(est, datos);
        const est2 = textoEstado(cuenta);
        if (cuenta.alDia) alDia++; else pend++;
        if (cuenta.resaltar) mora++;
        total += cuenta.total;
        const cursoId = est.cursoId || datos.matriculaPorEst.get(est.id)?.cursoId || '';
        if (fGrado.value && gradoDe(est, datos) !== fGrado.value) continue;
        if (fCurso.value && cursoId !== fCurso.value) continue;
        if (fEstado.value && est2.clase !== fEstado.value) continue;
        const texto = norm(`${est.nombreCompleto} ${est.documento || ''} ${est.acudiente || ''} ${est.acudienteTelefono || ''} ${est.cursoNombre}`);
        if (q.length && !q.every(x => texto.includes(x))) continue;
        filas.push(filaEstado(++n, est, cuenta, est2));
    }
    tbody.replaceChildren(...(filas.length ? filas : [el('tr', {}, el('td', { colspan: '8', class: 'text-center text-muted', text: datos.estudiantes.length ? 'No hay estudiantes con ese filtro o búsqueda.' : 'No hay estudiantes activos.' }))]));
    document.getElementById('cobKpiAlDia').textContent = String(alDia);
    document.getElementById('cobKpiPend').textContent = String(pend);
    document.getElementById('cobKpiMora').textContent = String(mora);
    document.getElementById('cobKpiTotal').textContent = COP.format(total);
}

function filaEstado(n, est, cuenta, estado) {
    const enviado = recordados.get(est.id);
    const recordar = el('button', {
        type: 'button', class: 'cob-btn recordar' + (cuenta.resaltar ? ' urgente' : '') + (enviado ? ' enviado' : ''),
        disabled: cuenta.alDia || !!enviado,
        title: enviado ? `Recordatorio enviado hoy${enviado.porNombre ? ' por ' + enviado.porNombre : ''}` : cuenta.alDia ? 'La familia está al día' : 'Enviar aviso de pago al acudiente (una vez al día)'
    }, el('i', { class: enviado ? 'fas fa-check' : 'fas fa-bell' }), enviado ? ' Enviado hoy' : ' Recordar pago');
    recordar.addEventListener('click', async () => {
        if (recordar.dataset.enviando) return;
        if (!confirm(`¿Enviar recordatorio de pago a la familia de ${est.nombreCompleto}?\nSolo se puede enviar uno por día.`)) return;
        recordar.dataset.enviando = '1';
        recordar.disabled = true;
        try {
            await enviarRecordatorio(c, est, cuenta);
            recordados.set(est.id, { porNombre: nombreDe(c.perfil) });
            toast(`Recordatorio enviado a la familia de ${est.nombreCompleto}.`, 'ok');
        } catch (e) {
            toast(e.message, 'error');
            recordados = await recordatoriosDeHoy(c).catch(() => recordados);
        } finally {
            delete recordar.dataset.enviando;
            pintarEstado();
        }
    });
    const cobrar = el('button', { type: 'button', class: 'cob-btn', onclick: () => window.__eduCobrosAbrir('pago', est) }, el('i', { class: 'fas fa-cash-register' }), ' Cobrar');
    return el('tr', {},
        el('td', { text: String(n) }),
        el('td', {}, el('strong', { text: est.nombreCompleto }), el('small', { class: 'text-muted', style: 'display:block', text: 'Doc. ' + (est.documento || '-') })),
        el('td', { text: est.cursoNombre || '-' }),
        el('td', {}, el('span', { text: est.acudiente || '-' }), el('small', { class: 'text-muted', style: 'display:block', text: est.acudienteTelefono ? 'Tel. ' + est.acudienteTelefono : '' })),
        el('td', { style: 'white-space:normal;max-width:240px', text: cuenta.alDia ? '—' : [cuenta.matricula?.saldo ? 'Matrícula' : '', ...cuenta.pendientes.map(x => MESES[x.mes - 1].slice(0, 3) + (x.anio !== new Date().getFullYear() ? ' ' + x.anio : ''))].filter(Boolean).join(', ') }),
        el('td', {}, el('strong', { text: COP.format(cuenta.total), style: cuenta.total ? 'color:var(--danger,#dc2626)' : '' })),
        el('td', {}, el('span', { class: 'pen-chip ' + estado.clase, text: estado.texto })),
        el('td', {}, el('div', { class: 'cob-acciones' }, cobrar, recordar)));
}

// ---------------------------------------------------------------------
// 2) Registrar pago (pensiones, matrícula y eventos de un estudiante)
// ---------------------------------------------------------------------
function montarPago(p) {
    const buscar = el('input', { type: 'search', class: 'form-control', id: 'penBuscar', placeholder: 'Nombre o documento del estudiante...', autocomplete: 'off', maxlength: '60', 'aria-label': 'Buscar estudiante' });
    const sug = el('div', { class: 'pen-sug', hidden: true, role: 'listbox' });
    const detalle = el('div', { id: 'penDetalle' }, el('p', { class: 'text-muted', text: 'Busca un estudiante para ver sus pensiones, matrícula y eventos, y registrar pagos.' }));
    p.append(el('div', { class: 'card' }, el('div', { class: 'card-body' },
        el('div', { class: 'pen-buscar' }, el('div', { class: 'edu-buscar' }, el('i', { class: 'fas fa-search' }), buscar), sug), detalle)));

    const pintarSug = () => {
        const q = norm(buscar.value);
        if (q.length < 2 || !datos) { sug.hidden = true; return; }
        const res = datos.estudiantes.filter(e => norm(e.nombreCompleto).includes(q) || norm(e.documento).includes(q)).slice(0, 20);
        sug.replaceChildren(...res.map(e => el('button', {
            type: 'button', role: 'option', onclick: () => { buscar.value = e.nombreCompleto; sug.hidden = true; elegir(e); }
        }, el('strong', { text: e.nombreCompleto }), el('small', { text: ` · Doc. ${e.documento || '-'} · ${e.cursoNombre || 'Sin curso'}` }))));
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
}

async function elegir(est) {
    estSel = est;
    const detalle = document.getElementById('penDetalle');
    const buscar = document.getElementById('penBuscar');
    if (buscar) buscar.value = est.nombreCompleto;
    if (!datos) { detalle.replaceChildren(el('p', { class: 'text-muted', text: 'Cargando...' })); await cargarTodo(); }
    const actual = datos.estudiantes.find(e => e.id === est.id) || est;
    const cuenta = estadoCuenta(actual, datos);
    const anio = new Date().getFullYear();

    // Pensiones del año (todos los meses con cobro) + deudas anteriores
    const filas = [];
    const meses = new Map(cuenta.meses.map(x => [`${x.anio}-${x.mes}`, x]));
    for (const x of cuenta.meses.filter(m => m.anio < anio)) filas.push(filaMes(actual, x));
    for (let mes = 1; mes <= 12; mes++) {
        let x = meses.get(`${anio}-${mes}`);
        if (!x) {
            // Meses futuros del año (aún no vencen): se pueden pagar por adelantado
            const pen = datos.pensionesPorEst.get(actual.id)?.get(`${anio}-${mes}`);
            const valor = valorPension(actual, anio, mes, datos);
            if (!pen && !valor) continue;
            const abonado = Number(pen?.totalAbonado) || 0;
            x = { anio, mes, valor, abonado, saldo: Math.max(0, valor - abonado), pensionId: pen?.id || null, futuro: mes > new Date().getMonth() + 1 };
        }
        filas.push(filaMes(actual, x));
    }

    const m = cuenta.matricula;
    const filaMatricula = m && m.valor > 0 ? el('tr', {},
        el('td', { text: 'Matrícula' }), el('td', { text: COP.format(m.valor) }), el('td', { text: COP.format(m.abonado) }),
        el('td', {}, el('strong', { text: COP.format(m.saldo) })),
        el('td', {}, el('span', { class: 'pen-chip ' + (m.saldo ? (m.abonado ? 'abonado' : 'pendiente') : 'pagado'), text: m.saldo ? (m.abonado ? 'Abonado' : 'Pendiente') : 'Pagado' })),
        el('td', {}, m.saldo ? botonPagar(() => abrirPago({ tipo: 'matricula', est: actual, valor: m.valor, abonado: m.abonado, matriculaId: m.id, concepto: 'Matrícula' })) : el('span', { class: 'text-muted', text: '—' })))
        : null;

    const evs = eventos.filter(ev => enAlcance(ev, actual));
    const filasEv = evs.map(ev => {
        const cg = cargos.get(`${ev.id}_${actual.id}`);
        const valor = Number(cg?.valor ?? ev.valor) || 0, abonado = Number(cg?.totalAbonado) || 0, saldo = Math.max(0, valor - abonado);
        return el('tr', {},
            el('td', {}, el('strong', { text: ev.nombre }), el('small', { class: 'text-muted', style: 'display:block', text: ev.fecha || '' })),
            el('td', { text: COP.format(valor) }), el('td', { text: COP.format(abonado) }), el('td', {}, el('strong', { text: COP.format(saldo) })),
            el('td', {}, el('span', { class: 'pen-chip ' + (saldo ? (abonado ? 'abonado' : 'pendiente') : 'pagado'), text: saldo ? (abonado ? 'Abonado' : 'Pendiente') : 'Pagado' })),
            el('td', {}, saldo ? botonPagar(() => abrirPago({ tipo: 'evento', est: actual, valor, abonado, evento: ev, concepto: 'Evento: ' + ev.nombre })) : el('span', { class: 'text-muted', text: '—' })));
    });

    const estado = textoEstado(cuenta);
    const acudiente = actual.acudiente ? `Acudiente: ${actual.acudiente}${actual.acudienteTelefono ? ' · Tel. ' + actual.acudienteTelefono : ''}` : 'Sin acudiente registrado';
    const tabla = (cuerpo) => el('div', { class: 'table-responsive', 'data-sin-filtros': '' }, el('table', { class: 'table-modern pen-tabla' },
        el('thead', {}, el('tr', {}, ...['Concepto', 'Valor', 'Abonado', 'Saldo', 'Estado', ''].map(t => el('th', { text: t })))),
        el('tbody', {}, cuerpo)));
    detalle.replaceChildren(
        el('div', { class: 'pen-est' },
            el('div', {}, el('strong', { text: actual.nombreCompleto }),
                el('small', { text: `Doc. ${actual.documento || '-'} · ${actual.cursoNombre || 'Sin curso'}` }),
                el('small', { text: acudiente }),
                el('span', { class: 'pen-chip ' + estado.clase, style: 'margin-top:6px', text: estado.texto })),
            el('div', { class: 'pen-tot' },
                el('div', {}, el('small', { text: 'Debe a la fecha' }), el('b', { text: COP.format(cuenta.total), style: 'color:var(--danger,#dc2626)' })),
                el('div', {}, el('small', { text: 'Boletines' }), el('b', { text: cuenta.bloqueaBoletin ? 'Bloqueados' : 'Disponibles', style: cuenta.bloqueaBoletin ? 'color:#b45309' : 'color:var(--success,#16a34a)' })))),
        el('h3', { class: 'pen-subt' }, el('i', { class: 'fas fa-calendar-days', style: 'color:var(--primary)' }), `Pensiones ${anio}`),
        filas.length ? tabla(filas) : el('p', { class: 'text-muted', text: `No hay pensiones configuradas para ${anio}. Rectoría debe definir el valor mensual (Pensiones → valor del mes).` }),
        filaMatricula ? el('h3', { class: 'pen-subt' }, el('i', { class: 'fas fa-file-signature', style: 'color:var(--primary)' }), 'Matrícula') : null,
        filaMatricula ? tabla([filaMatricula]) : null,
        filasEv.length ? el('h3', { class: 'pen-subt' }, el('i', { class: 'fas fa-calendar-check', style: 'color:var(--primary)' }), 'Eventos') : null,
        filasEv.length ? tabla(filasEv) : null);
}

const botonPagar = onclick => el('button', { type: 'button', class: 'btn-primary', style: 'padding:6px 12px;font-size:.8rem', onclick }, el('i', { class: 'fas fa-cash-register' }), ' Registrar pago');

function filaMes(est, x) {
    const estado = x.saldo === 0 ? 'pagado' : x.abonado > 0 ? 'abonado' : x.futuro ? 'sin' : 'pendiente';
    const txt = { pagado: 'Pagado', abonado: 'Abonado', pendiente: x.vencido ? 'En mora' : 'Pendiente', sin: 'Próximo' }[estado];
    return el('tr', {},
        el('td', { text: `${MESES[x.mes - 1]}${x.anio !== new Date().getFullYear() ? ' ' + x.anio : ''}` }),
        el('td', { text: COP.format(x.valor) }), el('td', { text: COP.format(x.abonado) }),
        el('td', {}, el('strong', { text: COP.format(x.saldo) })),
        el('td', {}, el('span', { class: 'pen-chip ' + estado, text: txt })),
        el('td', {}, x.saldo > 0
            ? botonPagar(() => abrirPago({ tipo: 'pension', est, anio: x.anio, mes: x.mes, valor: x.valor, abonado: x.abonado, pensionId: x.pensionId, concepto: `Pensión ${MESES[x.mes - 1]} ${x.anio}` }))
            : el('span', { class: 'text-muted', text: '—' })));
}

// ---------------------------------------------------------------------
// Modal de pago (pensión, matrícula o evento)
// ---------------------------------------------------------------------
let pagoActual = null;
function modalPago() {
    const campo = (label, input, err) => el('div', { class: 'form-group' }, el('label', { for: input.id, text: label }), input, err);
    const monto = el('input', { type: 'text', class: 'form-control edu-monto', id: 'penMonto', placeholder: 'Ej: 450.000', required: true, 'data-min': '1', autocomplete: 'off' });
    const todo = el('button', { type: 'button', class: 'cob-btn', style: 'margin-top:6px', text: 'Pagar el saldo completo' });
    const metodo = el('select', { class: 'form-control', id: 'penMetodo' }, ...Object.entries(METODOS).map(([k, v]) => el('option', { value: k, text: v })));
    const ref = el('input', { type: 'text', class: 'form-control', id: 'penReferencia', placeholder: 'Opcional', maxlength: '40', autocomplete: 'off' });
    const fecha = el('input', { type: 'date', class: 'form-control', id: 'penFecha' });
    const recibo = el('input', { type: 'checkbox', id: 'penRecibo', checked: true });
    const errMonto = el('span', { class: 'pen-err', hidden: true }), errRef = el('span', { class: 'pen-err', hidden: true }), errFecha = el('span', { class: 'pen-err', hidden: true });
    const alerta = el('div', { class: 'alert', style: 'display:none' });
    const resumen = el('div', { class: 'pen-resumen', id: 'penResumen' });
    const btn = el('button', { type: 'submit', class: 'btn-primary', id: 'penGuardar' }, el('i', { class: 'fas fa-save' }), ' Registrar pago');
    const cerrar = () => modal.classList.remove('show');

    monto.addEventListener('input', () => { errMonto.hidden = true; });
    todo.addEventListener('click', () => { monto.value = String(pagoActual?.saldo || ''); errMonto.hidden = true; });
    ref.addEventListener('input', () => { ref.value = ref.value.replace(/[^\w-]/g, '').slice(0, 40); errRef.hidden = true; });
    metodo.addEventListener('change', () => { ref.placeholder = metodo.value === 'efectivo' ? 'Opcional' : 'N.º de transacción o comprobante (obligatorio)'; });

    const form = el('form', { novalidate: true },
        el('div', { class: 'modal-body' }, alerta,
            el('p', { id: 'penModalEst', style: 'font-weight:600' }), resumen,
            el('div', { class: 'form-grid' },
                el('div', { class: 'form-group' }, el('label', { for: 'penMonto', text: 'Valor a pagar (COP) *' }), monto, todo, errMonto),
                campo('Método de pago *', metodo),
                campo('Referencia', ref, errRef),
                campo('Fecha del pago *', fecha, errFecha)),
            el('label', { style: 'display:flex;gap:8px;align-items:center;cursor:pointer;font-size:.88rem' }, recibo, 'Imprimir recibo al guardar')),
        el('div', { class: 'modal-footer' },
            el('button', { type: 'button', class: 'btn-secondary', text: 'Cancelar', onclick: cerrar }), btn));

    form.addEventListener('submit', async e => {
        e.preventDefault();
        if (btn.disabled) return;
        alerta.style.display = 'none';
        const texto = (Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').get.call(monto) || '').trim();
        const valorMonto = window.EduMonto ? window.EduMonto.parsear(texto) : Number(monto.value);
        const saldo = pagoActual.saldo;
        let ok = true;
        const err = (n, t) => { n.textContent = t; n.hidden = false; ok = false; };
        if (valorMonto == null || texto === '') err(errMonto, 'Escribe el valor que se va a pagar.');
        else if (Number.isNaN(valorMonto)) err(errMonto, 'Valor no válido. Usa solo números, por ejemplo 450.000 (sin letras ni signos).');
        else if (valorMonto <= 0) err(errMonto, 'El valor debe ser mayor a cero.');
        else if (valorMonto > saldo) err(errMonto, `El valor no puede ser mayor al saldo pendiente (${COP.format(saldo)}).`);
        if (metodo.value !== 'efectivo' && ref.value.trim().length < 3) err(errRef, 'Escribe la referencia del pago (mínimo 3 caracteres).');
        if (!fecha.value) err(errFecha, 'Elige la fecha del pago.');
        else if (fecha.value > ymd()) err(errFecha, 'La fecha no puede ser futura.');
        if (!ok) return;
        btn.disabled = true;
        try {
            const r = await registrarPago({ ...pagoActual, monto: valorMonto, metodo: metodo.value, referencia: ref.value.trim(), fecha: fecha.value });
            if (recibo.checked) imprimirRecibo(r);
            cerrar();
            toast(`Pago de ${COP.format(valorMonto)} registrado (${pagoActual.concepto}).`, 'ok');
            await cargarTodo();
            await elegir(pagoActual.est);
            pintarEstado();
        } catch (er) {
            alerta.className = 'alert alert-error show'; alerta.textContent = '❌ ' + er.message; alerta.style.display = 'block';
        } finally { btn.disabled = false; }
    });

    const modal = el('div', { class: 'modal', id: 'modalPagoSecretaria' },
        el('div', { class: 'modal-overlay', onclick: cerrar }),
        el('div', { class: 'modal-content', style: 'max-width:640px' },
            el('div', { class: 'modal-header' },
                el('h2', {}, el('i', { class: 'fas fa-cash-register', style: 'color:var(--primary)' }), ' Registrar pago'),
                el('button', { type: 'button', class: 'modal-close', 'aria-label': 'Cerrar', onclick: cerrar }, '×')),
            form));
    return modal;
}

function abrirPago(info) {
    pagoActual = { ...info, saldo: Math.max(0, info.valor - info.abonado) };
    document.getElementById('penModalEst').textContent = `${info.est.nombreCompleto} · ${info.concepto}`;
    document.getElementById('penResumen').replaceChildren(
        el('div', {}, el('small', { text: 'Valor' }), el('b', { text: COP.format(info.valor) })),
        el('div', {}, el('small', { text: 'Ya abonado' }), el('b', { text: COP.format(info.abonado) })),
        el('div', {}, el('small', { text: 'Saldo (máximo a pagar)' }), el('b', { text: COP.format(pagoActual.saldo), style: 'color:var(--danger,#dc2626)' })));
    const m = document.getElementById('penMonto');
    window.EduMonto?.convertir(m);
    m.dataset.max = String(pagoActual.saldo);
    m.value = String(pagoActual.saldo);
    document.getElementById('penMetodo').value = 'efectivo';
    document.getElementById('penReferencia').value = '';
    document.getElementById('penFecha').value = ymd();
    document.getElementById('penFecha').max = ymd();
    document.querySelectorAll('#modalPagoSecretaria .pen-err').forEach(e => { e.hidden = true; });
    document.querySelector('#modalPagoSecretaria .alert').style.display = 'none';
    document.getElementById('modalPagoSecretaria').classList.add('show');
    m.focus();
}

/** Actualiza el saldo en una transacción: dos pagos simultáneos (otra pestaña u otro equipo) no se suman dos veces. */
async function registrarPago(p) {
    const base = ['colegios', c.colegioId];
    const { est, monto, metodo, referencia, fecha, tipo } = p;
    const saldoErr = s => new Error(`El saldo cambió (otro usuario u otra pestaña registró un pago). El saldo ahora es ${COP.format(s)}.`);
    let ref, res;
    if (tipo === 'pension') {
        ref = doc(c.db, ...base, 'pensiones', p.pensionId || `${idMes(p.anio, p.mes)}_${est.id}`);
        res = await runTransaction(c.db, async tx => {
            const snap = await tx.get(ref);
            const d = snap.exists() ? snap.data() : null;
            const valor = d ? (Number(d.valorPension) || p.valor) : p.valor;
            const abonado = Number(d?.totalAbonado) || 0;
            const saldoAntes = Math.max(0, valor - abonado);
            if (monto > saldoAntes) throw saldoErr(saldoAntes);
            const nuevo = abonado + monto, saldo = Math.max(0, valor - nuevo), estado = saldo === 0 ? 'pagado' : 'abonado';
            if (d) tx.update(ref, { totalAbonado: nuevo, saldo, estado, fechaActualizacion: serverTimestamp() });
            else tx.set(ref, { estudianteId: est.id, cursoId: est.cursoId || '', mes: p.mes, anio: p.anio, valorPension: valor, totalAbonado: nuevo, saldo, estado, creadoEn: serverTimestamp() });
            return { saldo };
        });
    } else if (tipo === 'matricula') {
        ref = doc(c.db, ...base, 'matriculas', p.matriculaId);
        res = await runTransaction(c.db, async tx => {
            const snap = await tx.get(ref);
            if (!snap.exists()) throw new Error('No se encontró la matrícula.');
            const d = snap.data();
            const valor = Number(d.valorMatricula) || 0, abonado = Number(d.totalAbonado) || 0;
            const saldoAntes = Math.max(0, valor - abonado);
            if (monto > saldoAntes) throw saldoErr(saldoAntes);
            const nuevo = abonado + monto, saldo = Math.max(0, valor - nuevo);
            tx.update(ref, { totalAbonado: nuevo, saldo, estadoPago: saldo === 0 ? 'pagado' : 'abonado', fechaActualizacion: serverTimestamp() });
            return { saldo };
        });
    } else {
        ref = doc(c.db, ...base, 'cargos_eventos', `${p.evento.id}_${est.id}`);
        res = await runTransaction(c.db, async tx => {
            const snap = await tx.get(ref);
            const d = snap.exists() ? snap.data() : null;
            const valor = Number(d?.valor ?? p.valor) || 0, abonado = Number(d?.totalAbonado) || 0;
            const saldoAntes = Math.max(0, valor - abonado);
            if (monto > saldoAntes) throw saldoErr(saldoAntes);
            const nuevo = abonado + monto, saldo = Math.max(0, valor - nuevo);
            const datosCargo = { eventoId: p.evento.id, eventoNombre: p.evento.nombre, estudianteId: est.id, estudianteNombre: est.nombreCompleto, valor, totalAbonado: nuevo, saldo, estado: saldo === 0 ? 'pagado' : 'abonado', actualizadoEn: serverTimestamp() };
            if (d) tx.update(ref, datosCargo); else tx.set(ref, { ...datosCargo, creadoEn: serverTimestamp() });
            return { saldo };
        });
    }
    const comun = { estudianteId: est.id, estudianteNombre: est.nombreCompleto, monto, metodo, referencia, fecha, creadoPor: c.uid, creadoPorNombre: nombreDe(c.perfil), rolCreador: c.rol, fechaCreacion: serverTimestamp() };
    let pago;
    if (tipo === 'pension') pago = await addDoc(collection(c.db, ...base, 'pagos_pensiones'), { ...comun, pensionId: ref.id, mes: p.mes, anio: p.anio });
    else if (tipo === 'matricula') pago = await addDoc(collection(c.db, ...base, 'pagos_matriculas'), { ...comun, matriculaId: ref.id, tipo: 'matricula' });
    else pago = await addDoc(collection(c.db, ...base, 'pagos_eventos'), { ...comun, eventoId: p.evento.id, eventoNombre: p.evento.nombre });
    await addDoc(collection(c.db, ...base, 'movimientos'), {
        ...comun, tipo: 'ingreso', categoria: tipo === 'pension' ? 'Pensión' : tipo === 'matricula' ? 'Matrícula' : 'Evento',
        descripcion: `Pago ${p.concepto} - ${est.nombreCompleto}`, pagoId: pago.id
    });
    notificarFamilia(est.id, '💳 Pago registrado',
        `Se registró un pago de ${COP.format(monto)} por ${p.concepto} de ${est.nombreCompleto}. ${res.saldo === 0 ? 'Ese concepto quedó al día.' : 'Saldo pendiente: ' + COP.format(res.saldo) + '.'}`,
        'pago').catch(e => console.warn('Aviso de pago:', e.message));
    return { ...res, est, concepto: p.concepto, monto, metodo, referencia, fecha, recibo: pago.id.slice(0, 8).toUpperCase() };
}

function imprimirRecibo(r) {
    const colegio = (window.__eduColegioDatos?.nombre) || document.getElementById('eduMarcaNombre')?.textContent || document.getElementById('colegioNombreSidebar')?.textContent || 'Colegio';
    const w = window.open('', '_blank', 'width=420,height=640');
    if (!w) { alert('Permite las ventanas emergentes para imprimir el recibo.'); return; }
    const filas = [
        ['Recibo N.º', r.recibo], ['Fecha', r.fecha], ['Estudiante', r.est.nombreCompleto], ['Documento', r.est.documento || '-'],
        ['Concepto', r.concepto], ['Método', METODOS[r.metodo] || r.metodo], ['Referencia', r.referencia || '-'],
        ['Valor pagado', COP.format(r.monto)], ['Saldo del concepto', COP.format(r.saldo)], ['Atendió', nombreDe(c.perfil)]
    ];
    const d = w.document;
    d.title = 'Recibo de pago';
    const st = d.createElement('style');
    st.textContent = 'body{font-family:Arial,sans-serif;padding:24px;color:#0f172a}h1{font-size:18px;margin:0 0 4px}p{margin:0 0 16px;color:#64748b;font-size:12px}table{width:100%;border-collapse:collapse;font-size:13px}td{padding:7px 4px;border-bottom:1px dashed #cbd5e1}td:last-child{text-align:right;font-weight:600}.f{margin-top:28px;font-size:11px;color:#64748b;text-align:center}';
    d.head.append(st);
    const h = d.createElement('h1'); h.textContent = colegio;
    const p = d.createElement('p'); p.textContent = 'Recibo de pago';
    const t = d.createElement('table');
    filas.forEach(([a, b]) => { const tr = t.insertRow(); tr.insertCell().textContent = a; tr.insertCell().textContent = b; });
    const f = d.createElement('div'); f.className = 'f'; f.textContent = 'Generado por EduOne';
    d.body.append(h, p, t, f);
    setTimeout(() => { w.print(); }, 300);
}

// ---------------------------------------------------------------------
// 3) Eventos de pago
// ---------------------------------------------------------------------
let refsEventos = null;
function montarEventos(p) {
    const nombre = el('input', { type: 'text', class: 'form-control', id: 'cobEvNombre', maxlength: '80', required: true, placeholder: 'Ej: Jean Day, Feria de la ciencia' });
    const valor = el('input', { type: 'text', class: 'form-control edu-monto', id: 'cobEvValor', required: true, 'data-min': '1', placeholder: 'Ej: 5.000' });
    const fecha = el('input', { type: 'date', class: 'form-control', id: 'cobEvFecha', required: true });
    const alcance = el('select', { class: 'form-control', id: 'cobEvAlcance' },
        el('option', { value: 'todos', text: 'Todo el colegio' }), el('option', { value: 'grado', text: 'Un grado' }), el('option', { value: 'curso', text: 'Un curso' }));
    const destino = el('select', { class: 'form-control', id: 'cobEvDestino', hidden: true, 'aria-label': 'Grado o curso' });
    const desc = el('input', { type: 'text', class: 'form-control', id: 'cobEvDesc', maxlength: '200', placeholder: 'Descripción (opcional)' });
    const avisar = el('input', { type: 'checkbox', id: 'cobEvAvisar', checked: true });
    const alerta = el('div', { class: 'alert', style: 'display:none' });
    const btn = el('button', { type: 'submit', class: 'btn-primary' }, el('i', { class: 'fas fa-plus' }), ' Crear evento');
    const lista = el('div', {});
    const form = el('form', { novalidate: true }, alerta,
        el('div', { class: 'cob-form-grid' },
            el('div', { class: 'form-group' }, el('label', { for: 'cobEvNombre', text: 'Nombre del evento *' }), nombre),
            el('div', { class: 'form-group' }, el('label', { for: 'cobEvValor', text: 'Valor por estudiante (COP) *' }), valor),
            el('div', { class: 'form-group' }, el('label', { for: 'cobEvFecha', text: 'Fecha del evento *' }), fecha),
            el('div', { class: 'form-group' }, el('label', { for: 'cobEvAlcance', text: 'Para quién' }), alcance, destino),
            el('div', { class: 'form-group', style: 'grid-column:1/-1' }, el('label', { for: 'cobEvDesc', text: 'Descripción' }), desc)),
        el('label', { style: 'display:flex;gap:8px;align-items:center;font-size:.86rem;margin:6px 0 12px' }, avisar, 'Avisar a las familias de los estudiantes'),
        el('div', { style: 'display:flex;justify-content:flex-end' }, btn));
    p.append(
        el('div', { class: 'card' }, el('div', { class: 'card-header' }, el('h2', {}, el('i', { class: 'fas fa-calendar-plus', style: 'color:var(--primary)' }), ' Nuevo evento de pago')), el('div', { class: 'card-body' }, form)),
        el('div', { class: 'card', style: 'margin-top:16px' }, el('div', { class: 'card-header' }, el('h2', {}, el('i', { class: 'fas fa-list', style: 'color:var(--primary)' }), ' Eventos del colegio')), el('div', { class: 'card-body' }, lista)));
    refsEventos = { lista };

    alcance.addEventListener('change', async () => {
        destino.hidden = alcance.value === 'todos';
        destino.replaceChildren();
        if (alcance.value === 'curso') {
            [...datos.cursos.entries()].sort((a, b) => a[1].nombre.localeCompare(b[1].nombre, 'es', { numeric: true }))
                .forEach(([id, v]) => destino.append(el('option', { value: id, text: v.nombre })));
        } else if (alcance.value === 'grado') {
            const s = await getDocs(collection(c.db, 'colegios', c.colegioId, 'grados'));
            s.docs.map(d => [d.id, d.data().nombre || 'Grado']).sort((a, b) => a[1].localeCompare(b[1], 'es', { numeric: true }))
                .forEach(([id, n]) => destino.append(el('option', { value: id, text: n })));
        }
    });

    form.addEventListener('submit', async e => {
        e.preventDefault();
        if (btn.disabled) return;
        const mostrar = (t, ok) => { alerta.className = 'alert ' + (ok ? 'alert-success' : 'alert-error') + ' show'; alerta.textContent = t; alerta.style.display = 'block'; };
        const v = window.EduMonto?.parsear((Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').get.call(valor) || '').trim());
        if (nombre.value.trim().length < 3) return mostrar('Escribe el nombre del evento (mínimo 3 letras).');
        if (!(v > 0)) return mostrar('Escribe un valor válido mayor a cero (solo números, por ejemplo 5.000).');
        if (!fecha.value) return mostrar('Elige la fecha del evento.');
        if (alcance.value !== 'todos' && !destino.value) return mostrar('Elige el grado o el curso.');
        btn.disabled = true;
        try {
            const ev = {
                colegioId: c.colegioId, nombre: nombre.value.trim(), descripcion: desc.value.trim(), valor: v, fecha: fecha.value,
                alcance: alcance.value, gradoIds: alcance.value === 'grado' ? [destino.value] : [], cursoIds: alcance.value === 'curso' ? [destino.value] : [],
                estado: 'activo', creadoPor: c.uid, creadoPorNombre: nombreDe(c.perfil), creadoEn: serverTimestamp()
            };
            const refEv = await addDoc(collection(c.db, 'colegios', c.colegioId, 'eventos_cobro'), ev);
            let avisados = 0;
            if (avisar.checked) {
                const nuevo = { id: refEv.id, ...ev };
                const ests = datos.estudiantes.filter(est => enAlcance(nuevo, est));
                for (let i = 0; i < ests.length; i += 400) {
                    const lote = writeBatch(c.db);
                    ests.slice(i, i + 400).forEach(est => lote.set(doc(c.db, 'colegios', c.colegioId, 'notificaciones', `evento_${refEv.id}_${est.id}`), {
                        estudianteId: est.id, tipo: 'evento', prioridad: 'normal', leida: false,
                        titulo: `🎟️ ${ev.nombre}`,
                        mensaje: `El colegio programó el evento "${ev.nombre}" para el ${ev.fecha}. Valor: ${COP.format(v)}.${ev.descripcion ? ' ' + ev.descripcion : ''} El pago se realiza en la secretaría del colegio.`,
                        remitenteUid: c.uid, remitenteNombre: 'Colegio', remitenteRol: 'sistema', fecha: serverTimestamp()
                    }));
                    await lote.commit();
                    avisados += Math.min(400, ests.length - i);
                }
            }
            form.reset();
            destino.hidden = true;
            mostrar(`✅ Evento creado.${avisar.checked ? ` Se avisó a ${avisados} familias.` : ''}`, true);
            await cargarTodo();
            pintarEventos();
        } catch (er) { mostrar('❌ ' + er.message); }
        finally { btn.disabled = false; }
    });
}

function pintarEventos() {
    if (!refsEventos || !datos) return;
    const { lista } = refsEventos;
    if (!eventos.length) { lista.replaceChildren(el('p', { class: 'text-muted', text: 'Aún no hay eventos de pago.' })); return; }
    const filas = eventos.map((ev, i) => {
        const ests = datos.estudiantes.filter(est => ev.estado === 'cerrado' ? true : enAlcance(ev, est));
        let recaudado = 0, pagaron = 0;
        for (const est of ests) {
            const cg = cargos.get(`${ev.id}_${est.id}`);
            recaudado += Number(cg?.totalAbonado) || 0;
            if (cg && Number(cg.saldo) === 0) pagaron++;
        }
        const alcanceTxt = ev.alcance === 'grado' ? 'Un grado' : ev.alcance === 'curso' ? (datos.cursos.get(ev.cursoIds?.[0])?.nombre || 'Un curso') : 'Todo el colegio';
        const cerrar = el('button', { type: 'button', class: 'cob-btn', disabled: ev.estado === 'cerrado' }, el('i', { class: 'fas fa-lock' }), ev.estado === 'cerrado' ? ' Cerrado' : ' Cerrar');
        cerrar.addEventListener('click', async () => {
            if (!confirm(`¿Cerrar el evento "${ev.nombre}"? Ya no se podrán registrar pagos.`)) return;
            cerrar.disabled = true;
            try {
                const { updateDoc } = await import('https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js');
                await updateDoc(doc(c.db, 'colegios', c.colegioId, 'eventos_cobro', ev.id), { estado: 'cerrado', cerradoPor: c.uid, cerradoEn: serverTimestamp() });
                ev.estado = 'cerrado';
                pintarEventos();
            } catch (e) { toast('No se pudo cerrar: ' + e.message, 'error'); cerrar.disabled = false; }
        });
        return el('tr', {},
            el('td', { text: String(i + 1) }),
            el('td', {}, el('strong', { text: ev.nombre }), el('small', { class: 'text-muted', style: 'display:block', text: ev.descripcion || '' })),
            el('td', { text: ev.fecha || '-' }), el('td', { text: COP.format(Number(ev.valor) || 0) }), el('td', { text: alcanceTxt }),
            el('td', { text: `${pagaron} / ${ests.length}` }), el('td', {}, el('strong', { text: COP.format(recaudado) })),
            el('td', {}, el('span', { class: 'pen-chip ' + (ev.estado === 'cerrado' ? 'sin' : 'pagado'), text: ev.estado === 'cerrado' ? 'Cerrado' : 'Activo' })),
            el('td', {}, cerrar));
    });
    lista.replaceChildren(
        el('p', { class: 'text-muted', style: 'font-size:.82rem', text: 'Para registrar el pago de un evento, ve a "Registrar pago" y busca al estudiante: sus eventos aparecen al final.' }),
        el('div', { class: 'table-responsive' }, el('table', { class: 'table-modern pen-tabla' },
            el('thead', {}, el('tr', {}, ...['#', 'Evento', 'Fecha', 'Valor', 'Para', 'Pagaron', 'Recaudado', 'Estado', ''].map(t => el('th', { text: t })))),
            el('tbody', {}, filas))));
}

// ---------------------------------------------------------------------
// 4) Pagos de hoy
// ---------------------------------------------------------------------
function montarHoy(p) {
    const hoy = el('div', { class: 'pen-hoy' }, el('p', { class: 'text-muted', text: 'Cargando...' }));
    const totalHoy = el('strong', { text: COP.format(0) });
    p.append(el('div', { class: 'card' },
        el('div', { class: 'card-header', style: 'display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap' },
            el('h2', {}, el('i', { class: 'fas fa-receipt', style: 'color:var(--primary)' }), ' Pagos registrados hoy'),
            el('span', {}, 'Total: ', totalHoy)),
        el('div', { class: 'card-body' }, hoy)));
    const colecciones = ['pagos_pensiones', 'pagos_matriculas', 'pagos_eventos'];
    const porCol = {};
    const pintar = () => {
        const pagos = Object.values(porCol).flat().sort((a, b) => (b.fechaCreacion?.toMillis?.() || 0) - (a.fechaCreacion?.toMillis?.() || 0));
        totalHoy.textContent = COP.format(pagos.reduce((s, x) => s + (Number(x.monto) || 0), 0));
        hoy.replaceChildren(...pagos.map(x => el('div', { class: 'pen-hoy-item' },
            el('div', {}, el('strong', { text: x.estudianteNombre || 'Estudiante' }),
                el('small', { class: 'text-muted', style: 'display:block', text: `${x.mes ? 'Pensión ' + MESES[(x.mes || 1) - 1] + ' ' + x.anio : x.eventoNombre ? 'Evento: ' + x.eventoNombre : 'Matrícula'} · ${METODOS[x.metodo] || x.metodo || ''}${x.referencia ? ' · Ref. ' + x.referencia : ''}${x.creadoPorNombre ? ' · ' + x.creadoPorNombre : ''}` })),
            el('strong', { text: COP.format(Number(x.monto) || 0) }))));
        if (!pagos.length) hoy.append(el('p', { class: 'text-muted', text: 'Aún no hay pagos registrados hoy.' }));
    };
    for (const nombreCol of colecciones) {
        onSnapshot(query(collection(c.db, 'colegios', c.colegioId, nombreCol), where('fecha', '==', ymd())), snap => {
            porCol[nombreCol] = snap.docs.map(d => d.data());
            pintar();
        }, err => { porCol[nombreCol] = []; console.warn('Pagos de hoy:', nombreCol, err.message); pintar(); });
    }
}

// ---------------------------------------------------------------------
// 5) Política de cobro (rectoría la cambia; secretaría la consulta)
// ---------------------------------------------------------------------
let refsPolitica = null;
function montarPolitica(p) {
    const puede = EDITAN_POLITICA.includes(c.rol);
    const si = el('input', { type: 'radio', name: 'cobIngreso', value: 'si', disabled: !puede });
    const no = el('input', { type: 'radio', name: 'cobIngreso', value: 'no', disabled: !puede });
    const dia = el('input', { type: 'number', class: 'form-control', id: 'cobDiaLimite', min: '1', max: '28', step: '1', disabled: !puede, style: 'max-width:140px' });
    const meses = el('div', { class: 'cob-meses' }, ...MESES.map((m, i) => el('label', {}, el('input', { type: 'checkbox', value: String(i + 1), disabled: !puede }), m)));
    const estadoMes = el('div', { class: 'cob-info' }, 'Consultando el cobro de este mes...');
    const alerta = el('div', { class: 'alert', style: 'display:none' });
    const btn = el('button', { type: 'submit', class: 'btn-primary', hidden: !puede }, el('i', { class: 'fas fa-save' }), ' Guardar política');
    const form = el('form', { novalidate: true }, alerta,
        el('div', { class: 'form-group' }, el('label', { text: 'Estudiante que ingresa a mitad de año' }),
            el('label', { style: 'display:flex;gap:8px;align-items:center;font-weight:500;margin:6px 0' }, si, 'Paga la matrícula y también la pensión del mes en que ingresa'),
            el('label', { style: 'display:flex;gap:8px;align-items:center;font-weight:500' }, no, 'Paga solo la matrícula; la pensión se cobra desde el mes siguiente')),
        el('div', { class: 'form-group' }, el('label', { for: 'cobDiaLimite', text: 'Día límite de pago de cada mes' }), dia,
            el('small', { class: 'text-muted', style: 'display:block;margin-top:4px', text: 'Después de este día el mes queda en mora y la familia no puede ver los boletines hasta pagar.' })),
        el('div', { class: 'form-group' }, el('label', { text: 'Meses en que se cobra pensión' }), meses),
        el('div', { style: 'display:flex;justify-content:flex-end' }, btn));
    p.append(
        el('div', { class: 'card' }, el('div', { class: 'card-header' }, el('h2', {}, el('i', { class: 'fas fa-sliders', style: 'color:var(--primary)' }), ' Política de cobro del colegio')),
            el('div', { class: 'card-body' },
                puede ? null : el('p', { class: 'text-muted', text: 'Solo rectoría puede cambiar la política de cobro.' }),
                form)),
        el('div', { class: 'card', style: 'margin-top:16px' }, el('div', { class: 'card-header' }, el('h2', {}, el('i', { class: 'fas fa-robot', style: 'color:var(--primary)' }), ' Cobro automático del mes')),
            el('div', { class: 'card-body' }, estadoMes,
                el('p', { class: 'text-muted', style: 'font-size:.82rem;margin-top:10px', text: 'Cada mes, la primera vez que secretaría o rectoría entra a EduOne, se genera el cobro de la pensión para todos los estudiantes activos (con el valor que fijó rectoría) y a cada familia le llega un aviso importante. Se hace una sola vez por mes.' }))));
    refsPolitica = { si, no, dia, meses, estadoMes };

    form.addEventListener('submit', async e => {
        e.preventDefault();
        if (!puede || btn.disabled) return;
        const mostrar = (t, ok) => { alerta.className = 'alert ' + (ok ? 'alert-success' : 'alert-error') + ' show'; alerta.textContent = t; alerta.style.display = 'block'; };
        const d = Number(dia.value);
        const sel = [...meses.querySelectorAll('input:checked')].map(x => Number(x.value));
        if (!Number.isInteger(d) || d < 1 || d > 28) return mostrar('El día límite debe ser un número entre 1 y 28.');
        if (!sel.length) return mostrar('Elige al menos un mes de cobro.');
        btn.disabled = true;
        try {
            await guardarPolitica(c, { cobrarMesIngreso: si.checked, diaLimitePago: d, mesesCobro: sel });
            datos = null; await cargarTodo();
            mostrar('✅ Política guardada.', true);
        } catch (er) { mostrar('❌ ' + er.message); }
        finally { btn.disabled = false; }
    });
}

async function pintarPolitica() {
    if (!refsPolitica) return;
    const { si, no, dia, meses, estadoMes } = refsPolitica;
    const pol = datos?.politica || await leerPolitica(c);
    (pol.cobrarMesIngreso ? si : no).checked = true;
    dia.value = String(pol.diaLimitePago);
    meses.querySelectorAll('input').forEach(x => { x.checked = pol.mesesCobro.includes(Number(x.value)); });
    try {
        const hoy = new Date();
        const s = await getDoc(doc(c.db, 'colegios', c.colegioId, 'cobros_mensuales', idMes(hoy.getFullYear(), hoy.getMonth() + 1)));
        const d = s.exists() ? s.data() : null;
        estadoMes.textContent = !d ? `El cobro de ${MESES[hoy.getMonth()]} aún no se ha generado.`
            : d.estado === 'completo' ? `✅ Cobro de ${MESES[hoy.getMonth()]} generado${d.porNombre ? ' (al ingresar ' + d.porNombre + ')' : ''}: ${d.creadas || 0} pensiones nuevas y aviso a cada familia.`
                : d.estado === 'error' ? `⚠️ El cobro de ${MESES[hoy.getMonth()]} tuvo un error: ${d.error || ''}. Se intentará de nuevo.`
                    : `⏳ El cobro de ${MESES[hoy.getMonth()]} se está generando...`;
    } catch (e) { estadoMes.textContent = 'No se pudo consultar el cobro del mes: ' + e.message; }
}

const go = () => montar().catch(e => console.warn('EduOne cobros:', e.message));
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
