/* =====================================================================
   EduOne - eduone-filtros.js  (filtros y búsqueda en todos los roles)
   Para cada tabla de datos de los paneles (estudiantes, notas, pagos,
   pensiones, matrículas, personal, casos...):
   - La barra de filtros toma el diseño del panel del rector: buscador
     con lupa + selectores en una sola fila (en el celular se apilan).
   - Si la tabla no tiene buscador, se agrega uno (sin importar tildes
     ni mayúsculas) que filtra las filas al instante.
   - Si la tabla tiene columnas como Curso, Grado, Estado, Rol, Mes o
     Periodo y no hay un selector para ellas, se agrega el selector con
     los valores que aparecen en la tabla.
   - Los selectores de filtro con etiqueta encima quedan en la misma
     fila; la etiqueta pasa al texto de la primera opción
     ("Todos los grados", "Seleccionar curso").
   Funciona con las tablas que los paneles vuelven a pintar: cada vez
   que cambian las filas se aplica de nuevo la búsqueda.
   Una tabla o barra se puede excluir con data-sin-filtros.
   Lo importa eduone-ui.js en los paneles de colegio.
   ===================================================================== */
const normal = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const CONTENEDORES_FILTRO = '.search-bar, .eco-filtros, .table-toolbar, .filtros-secciones, .filtros, .filters, .edu-filtros, .form-grid, .form-row';
const COLUMNAS_FILTRABLES = ['curso', 'grado', 'estado', 'rol', 'periodo', 'asignatura', 'tipo', 'mes', 'categoria', 'metodo', 'concepto', 'modalidad'];
const EXCLUIR = '.modal, .boletin-print, #boletinPreview, #boletinContent, [data-sin-filtros], .horario-grid, .schedule, [id*="horario"], .no-search';

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------
function plural(palabra) {
    const p = palabra.toLowerCase();
    if (/[aeiouáéíóú]$/.test(p)) return p + 's';
    if (/z$/.test(p)) return p.slice(0, -1) + 'ces';
    if (/ón$/.test(p)) return p.slice(0, -2) + 'ones';
    return p + 'es';
}
const femenino = p => /(a|ión|ad)$/i.test(p.trim()) && !/^(dia|mapa|tema|programa|problema)$/i.test(p.trim());
function textoOpcionVacia(etiqueta, actual) {
    const base = etiqueta.replace(/[*:]/g, '').trim();
    if (!base) return actual;
    const t = normal(actual);
    if (/^(selecciona|seleccionar|seleccione|elige|elegir|--)/.test(t)) return `Seleccionar ${base.toLowerCase()}`;
    if (/^tod[oa]s?$/.test(t) || t === '' || t === '-') return `${femenino(base) ? 'Todas las' : 'Todos los'} ${plural(base)}`;
    return actual;
}

function textoCelda(td) { return (td?.innerText ?? td?.textContent ?? '').replace(/\s+/g, ' ').trim(); }
function filasDatos(tbody) {
    return [...tbody.rows].filter(tr => !tr.classList.contains('edu-sin-resultados') &&
        !(tr.cells.length === 1 && tr.cells[0].colSpan > 1));
}

// ---------------------------------------------------------------------
// Barra de filtros
// ---------------------------------------------------------------------
function prepararCampoConEtiqueta(grupo) {
    const label = grupo.querySelector(':scope > label');
    const control = grupo.querySelector('select, input');
    if (!label || !control || control.dataset.eduFiltroCampo) return;
    control.dataset.eduFiltroCampo = '1';
    const etiqueta = label.textContent.trim();
    label.classList.add('edu-sr');
    control.setAttribute('aria-label', etiqueta.replace(/[*:]/g, '').trim());
    control.title = etiqueta.replace(/[*:]/g, '').trim();
    if (control.tagName === 'SELECT') {
        const ajustar = () => {
            const op = control.options[0];
            if (op && op.value === '') {
                const nuevo = textoOpcionVacia(etiqueta, op.textContent);
                if (op.textContent !== nuevo) op.textContent = nuevo;
            }
        };
        ajustar();
        new MutationObserver(ajustar).observe(control, { childList: true });
    } else if (!control.placeholder) {
        control.placeholder = etiqueta.replace(/[*:]/g, '').trim();
    }
}

function esBarraDeFiltros(nodo) {
    if (!nodo || nodo.closest(EXCLUIR) || nodo.closest('form')) return false;
    if (nodo.querySelector('textarea, input[type="file"], input[type="password"], input[type="email"], input[type="tel"]')) return false;
    const controles = nodo.querySelectorAll('select, input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])');
    if (!controles.length || controles.length > 6) return false;
    // Las barras clásicas siempre son filtros; las cuadrículas de formulario solo si
    // son selectores (o fechas/búsqueda) y no hay campos obligatorios de captura
    if (nodo.matches('.search-bar, .eco-filtros, .table-toolbar, .filtros-secciones, .filtros, .filters, .edu-filtros')) return true;
    return [...controles].every(c => c.tagName === 'SELECT' || ['month', 'date', 'search'].includes(c.type) ||
        /buscar|filtro|search/i.test(c.id + ' ' + c.placeholder));
}

function crearBuscador(placeholder) {
    const caja = document.createElement('div');
    caja.className = 'edu-buscar';
    const i = document.createElement('i');
    i.className = 'fas fa-search';
    i.setAttribute('aria-hidden', 'true');
    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'form-control edu-buscar-input';
    input.placeholder = placeholder;
    input.autocomplete = 'off';
    input.maxLength = 80;
    input.setAttribute('aria-label', 'Buscar en la tabla');
    caja.append(i, input);
    return caja;
}

function convertirBarra(barra) {
    if (barra.dataset.eduBarra) return;
    barra.dataset.eduBarra = '1';
    barra.classList.add('edu-filtros');
    barra.querySelectorAll(':scope > .form-group').forEach(prepararCampoConEtiqueta);
    // Buscadores existentes: lupa y estilo comunes
    barra.querySelectorAll('input[type="text"], input[type="search"]').forEach(inp => {
        if (inp.closest('.edu-buscar, .search-box, .search-page-input-wrap, .student-search, .search-combobox')) return;
        if (!/buscar|filtro|search/i.test(inp.id + ' ' + inp.placeholder + ' ' + inp.type)) return;
        const caja = crearBuscador('');
        caja.querySelector('input').remove();
        inp.before(caja);
        caja.append(inp);
        inp.placeholder = inp.placeholder.replace(/^🔍\s*/, '');
    });
    // Un botón "Consultar/Buscar/Generar" suelto justo después queda en la misma fila
    const siguiente = barra.nextElementSibling;
    if (siguiente && siguiente.tagName === 'BUTTON' && !siguiente.closest('form')) barra.append(siguiente);
}

// ---------------------------------------------------------------------
// Tablas
// ---------------------------------------------------------------------
const tablasListas = new WeakSet();

function envolturaDe(tabla) {
    return tabla.closest('.table-responsive, .table-wrapper, .table-container') || tabla;
}

function buscarBarra(envoltura) {
    // Hermanos anteriores dentro del mismo contenedor
    let n = envoltura.previousElementSibling, saltos = 0;
    while (n && saltos < 4) {
        if (n.matches(CONTENEDORES_FILTRO) && esBarraDeFiltros(n)) return n;
        const interna = n.querySelector?.(':scope > ' + CONTENEDORES_FILTRO.split(', ').join(', :scope > '));
        if (interna && esBarraDeFiltros(interna)) return interna;
        n = n.previousElementSibling; saltos++;
    }
    // Barra en la tarjeta anterior (filtros en una tarjeta y tabla en otra)
    const tarjeta = envoltura.closest('.card');
    const anterior = tarjeta?.previousElementSibling;
    if (anterior?.matches('.card')) {
        const b = anterior.querySelector(CONTENEDORES_FILTRO);
        if (b && esBarraDeFiltros(b) && !anterior.querySelector('table')) return b;
    }
    return null;
}

function prepararTabla(tabla) {
    if (tablasListas.has(tabla)) return;
    if (!tabla.tHead || !tabla.tBodies[0] || tabla.closest(EXCLUIR) || !tabla.closest('.page-content')) return;
    const encabezados = [...tabla.tHead.rows[0]?.cells || []].map(th => textoCelda(th));
    if (encabezados.length < 3) return;
    tablasListas.add(tabla);
    const tbody = tabla.tBodies[0];
    const envoltura = envolturaDe(tabla);
    let barra = buscarBarra(envoltura);
    if (!barra) {
        barra = document.createElement('div');
        envoltura.before(barra);
    }
    convertirBarra(barra);

    // Buscador: el que ya existe (si filtra en el panel) o uno nuevo
    let buscador = barra.querySelector('.edu-buscar-input');
    const tieneBuscadorPropio = !buscador && barra.querySelector('input[type="text"], input[type="search"]');
    if (!buscador && !tieneBuscadorPropio) {
        const columnas = encabezados.filter(h => h && h !== '#' && !/acciones|opciones/i.test(h)).slice(0, 3).map(h => h.toLowerCase());
        const caja = crearBuscador('Buscar' + (columnas.length ? ' por ' + columnas.join(', ') : '') + '...');
        barra.prepend(caja);
        buscador = caja.querySelector('input');
    }

    // Selectores automáticos para columnas sin filtro
    const textosBarra = normal([...barra.querySelectorAll('select')].map(s => (s.getAttribute('aria-label') || '') + ' ' + (s.options[0]?.textContent || '') + ' ' + s.id).join(' '));
    const auto = [];
    encabezados.forEach((h, idx) => {
        const clave = normal(h);
        const tipo = COLUMNAS_FILTRABLES.find(c => clave === c || clave.startsWith(c + ' ') || clave.endsWith(' ' + c));
        if (!tipo || auto.length >= 3 || textosBarra.includes(tipo)) return;
        const sel = document.createElement('select');
        sel.className = 'form-control edu-filtro-auto';
        sel.dataset.columna = String(idx);
        sel.setAttribute('aria-label', h);
        sel.hidden = true;
        sel.append(new Option(`${femenino(h) ? 'Todas las' : 'Todos los'} ${plural(h)}`, ''));
        barra.append(sel);
        auto.push(sel);
    });

    const sinResultados = () => {
        let tr = tbody.querySelector(':scope > tr.edu-sin-resultados');
        if (!tr) {
            tr = document.createElement('tr');
            tr.className = 'edu-sin-resultados';
            const td = document.createElement('td');
            td.colSpan = encabezados.length;
            td.className = 'text-center text-muted';
            td.textContent = 'No hay resultados con esa búsqueda o filtro.';
            tr.append(td);
        }
        return tr;
    };

    let cambiandoNosotros = false;
    const aplicar = () => {
        const q = normal(buscador?.value || '').split(' ').filter(Boolean);
        const filas = filasDatos(tbody);
        // Opciones de los selectores automáticos según los datos actuales
        for (const sel of auto) {
            const col = Number(sel.dataset.columna);
            const valores = [...new Set(filas.map(tr => textoCelda(tr.cells[col])).filter(v => v && v !== '-' && v.length <= 40))]
                .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
            const util = valores.length >= 2 && valores.length <= 40;
            sel.hidden = !util;
            const actual = sel.value;
            const firma = valores.join('|');
            if (sel.dataset.firma !== firma) {
                sel.dataset.firma = firma;
                sel.length = 1;
                valores.forEach(v => sel.append(new Option(v, v)));
                sel.value = valores.includes(actual) ? actual : '';
            }
        }
        let visibles = 0;
        for (const tr of filas) {
            const texto = normal(tr.textContent);
            let ok = q.every(p => texto.includes(p));
            if (ok) for (const sel of auto) {
                if (sel.value && textoCelda(tr.cells[Number(sel.dataset.columna)]) !== sel.value) { ok = false; break; }
            }
            tr.classList.toggle('edu-oculta-filtro', !ok);
            if (ok) visibles++;
        }
        const filtrando = q.length || auto.some(s => s.value);
        const aviso = tbody.querySelector(':scope > tr.edu-sin-resultados');
        cambiandoNosotros = true;
        if (filtrando && filas.length && !visibles) { if (!aviso) tbody.append(sinResultados()); }
        else aviso?.remove();
        queueMicrotask(() => { cambiandoNosotros = false; });
    };

    buscador?.addEventListener('input', aplicar);
    auto.forEach(s => s.addEventListener('change', aplicar));
    let pendiente = false;
    new MutationObserver(registros => {
        if (cambiandoNosotros) return;
        const soloNuestros = registros.every(r => [...r.addedNodes, ...r.removedNodes].every(n => n.classList?.contains('edu-sin-resultados')));
        if (soloNuestros || pendiente) return;
        pendiente = true;
        requestAnimationFrame(() => { pendiente = false; aplicar(); });
    }).observe(tbody, { childList: true });
    aplicar();
}

// Barras de filtro que no están junto a una tabla (tareas, notas, boletín...)
function prepararBarrasSueltas(raiz = document) {
    raiz.querySelectorAll?.('.page-content .form-grid, .page-content .search-bar, .page-content .eco-filtros').forEach(n => {
        if (n.dataset.eduBarra || !esBarraDeFiltros(n)) return;
        // Solo cuando sus campos son selectores de consulta (no formularios de captura)
        const controles = n.querySelectorAll('select, input:not([type="hidden"])');
        if ([...controles].some(c => c.required)) return;
        convertirBarra(n);
    });
}

function revisarTodo() {
    document.querySelectorAll('.page-content table').forEach(prepararTabla);
    prepararBarrasSueltas();
}

function iniciar() {
    document.body.classList.add('edu-filtros-activos');
    revisarTodo();
    let pendiente = false;
    new MutationObserver(registros => {
        if (pendiente) return;
        if (!registros.some(r => [...r.addedNodes].some(n => n.nodeType === 1 && (n.tagName === 'TABLE' || n.querySelector?.('table, .form-grid, .search-bar, .eco-filtros'))))) return;
        pendiente = true;
        setTimeout(() => { pendiente = false; revisarTodo(); }, 120);
    }).observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
else iniciar();
