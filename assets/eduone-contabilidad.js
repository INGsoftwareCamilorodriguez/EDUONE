/* =====================================================================
   EduOne - eduone-contabilidad.js  (rol Contador)
   Reparto de funciones:
   - Secretaría: maneja los cobros y registra los pagos (pensiones,
     matrículas y eventos). Ver eduone-pensiones.js.
   - Contador: verifica la contabilidad, las ganancias y las pérdidas.
     Consulta pagos, cartera y movimientos, registra egresos (gastos)
     y otros ingresos que no son pagos de estudiantes, y revisa que los
     pagos registrados por secretaría cuadren con la contabilidad.
   Este archivo, en el panel del contador:
   1) Quita los botones para registrar/abonar pagos y configurar pensiones.
   2) No deja registrar a mano ingresos de Pensión/Matrícula/Evento
      (llegan solos cuando secretaría registra el pago).
   3) Agrega "Ganancias y pérdidas": resultado mes a mes y verificación
      de pagos contra la contabilidad.
   Se carga con: <script type="module" src="assets/eduone-contabilidad.js"></script>
   ===================================================================== */
import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js';
import { obtenerContexto } from './eduone-comun.js?v=20261107';
import { el, agregarEstilos, agregarSeccion } from './eduone-secciones.js?v=20261107';
import { MESES, COP } from './eduone-cobros.js?v=20261107';

const CATEGORIAS_PAGO = ['Pensión', 'Matrícula', 'Evento'];
const AVISO = 'Los pagos y abonos los registra la secretaría. Como contador puedes consultarlos y verificarlos en "Ganancias y pérdidas".';

const CSS = `
#btnRegistrarPagoPension,#btnConfigurarPension,
button[onclick*="abonar"],button[onclick*="irAPagar"]{display:none!important}
.cont-aviso{display:flex;gap:10px;align-items:flex-start;background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a;border-radius:12px;padding:12px 14px;margin-bottom:16px;font-size:.87rem}
.cont-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px}
.cont-kpi{background:#fff;border:1px solid #e6edf6;border-radius:14px;padding:14px 16px}
.cont-kpi small{display:block;color:#64748b;font-size:.76rem}.cont-kpi b{font-size:1.2rem}
.cont-pos{color:#16a34a}.cont-neg{color:#dc2626}
.cont-ok{display:inline-block;padding:3px 10px;border-radius:999px;font-size:.74rem;font-weight:600;background:#dcfce7;color:#166534}
.cont-rev{display:inline-block;padding:3px 10px;border-radius:999px;font-size:.74rem;font-weight:600;background:#fef3c7;color:#92400e}
@media(max-width:900px){.cont-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;

const fechaMov = m => {
    if (typeof m.fecha === 'string' && /^\d{4}-\d{2}/.test(m.fecha)) return { anio: Number(m.fecha.slice(0, 4)), mes: Number(m.fecha.slice(5, 7)) };
    const d = m.fecha?.toDate?.() || m.fechaCreacion?.toDate?.();
    return d ? { anio: d.getFullYear(), mes: d.getMonth() + 1 } : null;
};

async function montar() {
    const c = await obtenerContexto();
    if (c.rol !== 'contador' || !c.colegioId) return;
    agregarEstilos('eduContabilidadCss', CSS);

    // 1) Sin registro de pagos: se reemplazan las acciones por un aviso
    for (const nombre of ['abonarPensionDesdeContador', 'abonarPensionDesdeContadorPorEstudiante', 'abonarMatriculaDesdeContador', 'irAPagar']) {
        window[nombre] = () => alert(AVISO);
    }
    for (const id of ['page-pensiones', 'page-estudiantes', 'page-cartera']) {
        const p = document.getElementById(id);
        if (!p || p.querySelector('.cont-aviso')) continue;
        const aviso = el('div', { class: 'cont-aviso' }, el('i', { class: 'fas fa-circle-info', style: 'margin-top:2px' }), el('span', { text: AVISO }));
        const cabecera = p.querySelector('.page-header');
        if (cabecera) cabecera.after(aviso); else p.prepend(aviso);
    }

    // 2) Los ingresos por pagos de estudiantes no se registran a mano
    const tipo = document.getElementById('movTipo');
    const categoria = document.getElementById('movCategoria');
    const marcarCategorias = () => {
        if (!categoria) return;
        [...categoria.options].forEach(o => {
            const bloquear = tipo?.value === 'ingreso' && CATEGORIAS_PAGO.includes(o.value);
            o.disabled = bloquear;
            if (bloquear && o.selected) categoria.value = '';
        });
    };
    tipo?.addEventListener('change', marcarCategorias);
    document.getElementById('btnNuevoMovimiento')?.addEventListener('click', () => setTimeout(marcarCategorias, 50));
    document.getElementById('formNuevoMovimiento')?.addEventListener('submit', e => {
        if (tipo?.value === 'ingreso' && CATEGORIAS_PAGO.includes(categoria?.value)) {
            e.preventDefault();
            e.stopImmediatePropagation();
            alert('Los ingresos por ' + categoria.value.toLowerCase() + ' se registran solos cuando secretaría registra el pago. Aquí puedes registrar egresos y otros ingresos del colegio.');
        }
    }, true);

    // 3) Ganancias y pérdidas
    const sec = agregarSeccion({ id: 'resultados', icono: 'fas fa-scale-balanced', texto: 'Ganancias y pérdidas', grupo: 'REPORTES', titulo: 'Ganancias y pérdidas', menu: 'Reportes' });
    if (!sec) return;
    const anioSel = el('select', { class: 'form-control', 'aria-label': 'Año' });
    const y = new Date().getFullYear();
    for (const a of [y, y - 1, y - 2]) anioSel.append(el('option', { value: String(a), text: String(a) }));
    const actualizar = el('button', { type: 'button', class: 'btn-secondary' }, el('i', { class: 'fas fa-rotate' }), ' Actualizar');
    const kpis = el('div', { class: 'cont-kpis' });
    const cuerpo = el('tbody', {}, el('tr', {}, el('td', { colspan: '5', class: 'text-center text-muted', text: 'Cargando...' })));
    const cuerpoVer = el('tbody', {}, el('tr', {}, el('td', { colspan: '5', class: 'text-center text-muted', text: 'Cargando...' })));
    sec.pagina.append(
        el('div', { class: 'edu-filtros', 'data-sin-filtros': '' }, anioSel, actualizar),
        kpis,
        el('div', { class: 'card', 'data-sin-filtros': '' },
            el('div', { class: 'card-header' }, el('h2', {}, el('i', { class: 'fas fa-chart-line', style: 'color:var(--primary)' }), ' Resultado mes a mes')),
            el('div', { class: 'card-body' }, el('div', { class: 'table-responsive' }, el('table', { class: 'table-modern' },
                el('thead', {}, el('tr', {}, ...['Mes', 'Ingresos', 'Egresos', 'Resultado', ''].map(t => el('th', { text: t })))), cuerpo)))),
        el('div', { class: 'card', style: 'margin-top:16px', 'data-sin-filtros': '' },
            el('div', { class: 'card-header' }, el('h2', {}, el('i', { class: 'fas fa-clipboard-check', style: 'color:var(--primary)' }), ' Verificación: pagos de secretaría vs. contabilidad')),
            el('div', { class: 'card-body' },
                el('p', { class: 'text-muted', style: 'font-size:.82rem', text: 'Compara lo que secretaría registró como pagos (pensiones, matrículas y eventos) con los ingresos que quedaron en la contabilidad. Si no cuadra, revisa los movimientos de ese mes.' }),
                el('div', { class: 'table-responsive' }, el('table', { class: 'table-modern' },
                    el('thead', {}, el('tr', {}, ...['Mes', 'Pagos registrados', 'Ingresos contables por pagos', 'Diferencia', 'Estado'].map(t => el('th', { text: t })))), cuerpoVer)))));

    let cache = null;
    const cargar = async () => {
        const base = ['colegios', c.colegioId];
        const leer = n => getDocs(collection(c.db, ...base, n)).then(s => s.docs.map(d => d.data())).catch(() => []);
        const [movs, pp, pm, pe] = await Promise.all([leer('movimientos'), leer('pagos_pensiones'), leer('pagos_matriculas'), leer('pagos_eventos')]);
        cache = { movs, pagos: [...pp, ...pm, ...pe] };
    };
    const pintar = () => {
        if (!cache) return;
        const anio = Number(anioSel.value);
        const filas = MESES.map(() => ({ ing: 0, egr: 0, pagos: 0, ingPagos: 0 }));
        for (const m of cache.movs) {
            const f = fechaMov(m);
            if (!f || f.anio !== anio) continue;
            const v = Number(m.monto) || 0;
            if (m.tipo === 'egreso') filas[f.mes - 1].egr += v;
            else { filas[f.mes - 1].ing += v; if (CATEGORIAS_PAGO.includes(m.categoria)) filas[f.mes - 1].ingPagos += v; }
        }
        for (const p of cache.pagos) {
            const f = fechaMov(p);
            if (f && f.anio === anio) filas[f.mes - 1].pagos += Number(p.monto) || 0;
        }
        const tot = filas.reduce((a, f) => ({ ing: a.ing + f.ing, egr: a.egr + f.egr }), { ing: 0, egr: 0 });
        const res = tot.ing - tot.egr;
        const kpi = (t, v, cls = '') => el('div', { class: 'cont-kpi' }, el('small', { text: t }), el('b', { class: cls, text: v }));
        kpis.replaceChildren(kpi('Ingresos ' + anio, COP.format(tot.ing)), kpi('Egresos ' + anio, COP.format(tot.egr)),
            kpi(res >= 0 ? 'Ganancia' : 'Pérdida', COP.format(Math.abs(res)), res >= 0 ? 'cont-pos' : 'cont-neg'),
            kpi('Margen', tot.ing ? Math.round((res / tot.ing) * 100) + ' %' : '—', res >= 0 ? 'cont-pos' : 'cont-neg'));
        const mesMax = anio === y ? new Date().getMonth() + 1 : 12;
        cuerpo.replaceChildren(...filas.slice(0, mesMax).map((f, i) => {
            const r = f.ing - f.egr;
            return el('tr', {}, el('td', { text: MESES[i] }), el('td', { text: COP.format(f.ing) }), el('td', { text: COP.format(f.egr) }),
                el('td', {}, el('strong', { class: r >= 0 ? 'cont-pos' : 'cont-neg', text: (r < 0 ? '-' : '') + COP.format(Math.abs(r)) })),
                el('td', { text: f.ing || f.egr ? (r >= 0 ? 'Ganancia' : 'Pérdida') : '—' }));
        }));
        cuerpoVer.replaceChildren(...filas.slice(0, mesMax).map((f, i) => {
            const dif = f.pagos - f.ingPagos;
            return el('tr', {}, el('td', { text: MESES[i] }), el('td', { text: COP.format(f.pagos) }), el('td', { text: COP.format(f.ingPagos) }),
                el('td', {}, el('strong', { class: dif === 0 ? '' : 'cont-neg', text: COP.format(dif) })),
                el('td', {}, el('span', { class: Math.abs(dif) < 1 ? 'cont-ok' : 'cont-rev', text: Math.abs(dif) < 1 ? '✔ Cuadra' : '⚠ Revisar' })));
        }));
    };
    const recargar = async () => {
        actualizar.disabled = true;
        try { await cargar(); pintar(); }
        catch (e) { cuerpo.replaceChildren(el('tr', {}, el('td', { colspan: '5', class: 'text-center text-danger', text: 'Error: ' + e.message }))); }
        finally { actualizar.disabled = false; }
    };
    anioSel.addEventListener('change', pintar);
    actualizar.addEventListener('click', recargar);
    sec.pagina.addEventListener('edu:mostrar', () => { if (!cache) recargar(); });
}

const go = () => montar().catch(e => console.warn('EduOne contabilidad:', e.message));
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
