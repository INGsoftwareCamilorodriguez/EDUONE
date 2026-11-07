/* =====================================================================
   EduOne - eduone-secciones.js
   Agrega una sección nueva (enlace + página) a cualquier panel que use
   .sidebar-nav y .page-content, sin tocar la lógica de navegación de
   la página. El enlace se agrega también al menú superior del panel,
   sea cual sea su diseño:
     - #eduPanelNav   (acudiente, coordinadores, secretaría, contador, orientación)
     - .edu-unico-menu (rector)
     - .edu-nav       (estudiante)
     - .edu-topnav    (profesor)
   Opciones:
     principal: true  -> botón propio en la barra (no dentro de un menú)
     menu: 'Finanzas' -> dentro del menú desplegable con ese nombre
                         (si no existe, queda como botón propio)
   ===================================================================== */

export function el(tag, attrs = {}, ...hijos) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v === true ? '' : v);
    }
    hijos.flat().forEach(h => h != null && h !== false && n.append(h));
    return n;
}

const estilosAgregados = new Set();
export function agregarEstilos(id, css) {
    if (estilosAgregados.has(id) || document.getElementById(id)) return;
    estilosAgregados.add(id);
    document.head.append(el('style', { id }, css));
}

const normal = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Menú superior del panel y su tipo. */
export function menuSuperior() {
    const panel = document.getElementById('eduPanelNav');
    if (panel) return { nav: panel, tipo: 'panel' };
    const rector = document.querySelector('.edu-unico-menu');
    if (rector) return { nav: rector, tipo: 'rector' };
    const est = document.querySelector('nav.edu-nav');
    if (est) return { nav: est, tipo: 'estudiante' };
    const prof = document.querySelector('nav.edu-topnav');
    if (prof) return { nav: prof, tipo: 'profesor' };
    return null;
}

const CLASE_SEL = { panel: 'selected', rector: 'active', estudiante: 'edu-active', profesor: 'selected' };

/** Cierra menús desplegables y el menú del celular, en cualquier diseño. */
export function cerrarMenus() {
    document.querySelectorAll('.top-header details[open]').forEach(d => { d.open = false; });
    document.querySelectorAll('.edu-nav-group.edu-open').forEach(g => {
        g.classList.remove('edu-open');
        g.querySelector('.edu-group-toggle')?.setAttribute('aria-expanded', 'false');
    });
    document.querySelectorAll('.top-header .mobile-open, .top-header .menu-abierto, .top-header .edu-mobile-open')
        .forEach(n => n.classList.remove('mobile-open', 'menu-abierto', 'edu-mobile-open'));
    document.querySelectorAll('#eduPanelMenu, #eduMobileMenu, #eduMobileToggle').forEach(b => b.setAttribute('aria-expanded', 'false'));
}

/** Busca el menú desplegable cuyo título coincide con `nombre`. */
function buscarDesplegable(nav, tipo, nombre) {
    const objetivo = normal(nombre);
    if (tipo === 'estudiante') {
        for (const g of nav.querySelectorAll('.edu-nav-group')) {
            if (normal(g.querySelector('.edu-group-toggle')?.textContent).startsWith(objetivo)) return g.querySelector('.edu-dropdown');
        }
        return null;
    }
    for (const d of nav.querySelectorAll('details')) {
        if (normal(d.querySelector('summary')?.textContent).startsWith(objetivo)) return d.querySelector('.edu-subnav, .edu-menu-options');
    }
    return null;
}

function crearItemMenu(id, icono, texto, mostrar, { principal, menu }) {
    const m = menuSuperior();
    if (!m) return false;
    const { nav, tipo } = m;
    if (nav.querySelector(`[data-edu-page="${id}"]`)) return true;
    const destino = !principal && menu ? buscarDesplegable(nav, tipo, menu) : null;
    let item;
    if (destino) {
        item = el('button', { type: 'button', 'data-edu-page': id, id: 'eduTop_' + id }, el('i', { class: icono }), ' ' + texto);
        destino.append(item);
    } else {
        const attrs = { 'data-edu-page': id, id: 'eduTop_' + id, class: 'edu-nav-propio' };
        if (tipo === 'rector') { attrs.class += ' edu-toplink'; attrs.type = 'button'; }
        if (tipo === 'estudiante') attrs.type = 'button';
        if (tipo === 'panel' || tipo === 'profesor') attrs.href = '#';
        item = el(tipo === 'panel' || tipo === 'profesor' ? 'a' : 'button', attrs, el('i', { class: icono }), ' ' + texto);
        // Antes de "Mi perfil" cuando existe, para que el perfil quede al final
        const perfil = nav.querySelector(':scope > [data-to="perfil"], :scope > #eduProfileNav, :scope > [data-prof-page="perfil"]');
        if (perfil) perfil.before(item); else nav.append(item);
    }
    // En el diseño "panel" el propio menú ya reenvía el clic al enlace lateral
    if (tipo !== 'panel') {
        item.addEventListener('click', e => { e.preventDefault(); mostrar(e); cerrarMenus(); });
    }
    return true;
}

/** Marca como seleccionada la sección `id` en el menú superior (cualquier diseño). */
export function marcarEnMenu(id) {
    const m = menuSuperior();
    if (!m) return;
    const clase = CLASE_SEL[m.tipo];
    m.nav.querySelectorAll('.selected, .active, .edu-active').forEach(n => n.classList.remove('selected', 'active', 'edu-active'));
    const item = m.nav.querySelector(`[data-edu-page="${id}"]`);
    if (!item) return;
    item.classList.add(clase);
    const grupo = item.closest('details, .edu-nav-group');
    if (grupo) grupo.classList.add(m.tipo === 'estudiante' ? 'edu-active' : 'selected');
}

/**
 * @returns {{ pagina: HTMLElement, link: HTMLAnchorElement, mostrar: Function } | null}
 */
const DESCRIPCIONES = {
    chat: 'Conversaciones privadas con las personas autorizadas del colegio',
    orientacion: 'Disponibilidad de orientación escolar y citas agendadas',
    cobros: 'Pensiones, matrículas, eventos de pago y estado de cartera',
    nuevos: 'Datos del estudiante y del acudiente; rectoría asigna las cuentas',
    cuentas: 'Correo y contraseña de los estudiantes que registró secretaría',
    entregaBoletines: 'Autoriza la entrega de boletines de cada periodo',
    resultados: 'Ingresos, egresos y verificación de los pagos registrados'
};

export function agregarSeccion({ id, icono, texto, grupo = 'COMUNICACIÓN', titulo, principal = false, menu = null, descripcion = '' }) {
    if (document.getElementById('page-' + id)) return null;
    const contenedor = document.querySelector('.page-content')?.parentElement || document.getElementById('contentArea');
    const sideNav = document.querySelector('.sidebar-nav');
    if (!contenedor || !sideNav) return null;

    // Grupo en la barra lateral (oculta en el diseño actual, pero la usan los paneles para navegar)
    let ul = sideNav.querySelector(`ul[data-edu-grupo="${grupo}"]`);
    if (!ul) {
        ul = el('ul', { 'data-edu-grupo': grupo });
        sideNav.append(el('div', { class: 'nav-section', text: grupo }), ul);
    }
    const link = el('a', { href: '#', 'data-page': id }, el('i', { class: icono }), el('span', { text: texto }));
    ul.append(el('li', {}, link));

    const pagina = el('div', { id: 'page-' + id, class: 'page-content' },
        // Encabezado de la sección, igual en todos los paneles
        el('div', { class: 'edu-sec-hero' },
            el('div', { class: 'edu-sec-hero-icon' }, el('i', { class: icono })),
            el('div', {}, el('h2', { text: titulo || texto }), el('p', { text: descripcion || DESCRIPCIONES[id] || 'Gestión institucional' }))));
    contenedor.append(pagina);

    const mostrar = (e) => {
        e?.preventDefault();
        document.querySelectorAll('.page-content').forEach(p => p.classList.toggle('active', p === pagina));
        document.querySelectorAll('.sidebar-nav li').forEach(li => li.classList.toggle('active', li.contains(link)));
        marcarEnMenu(id);
        const t = document.getElementById('pageTitle');
        if (t && !t.querySelector('img') && !t.classList.contains('edu-brand')) t.textContent = titulo || texto;
        if (window.innerWidth <= 992) {
            document.getElementById('sidebar')?.classList.remove('open');
            document.getElementById('sidebarOverlay')?.classList.remove('active');
            document.body.style.overflow = '';
        }
        pagina.dispatchEvent(new CustomEvent('edu:mostrar'));
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    link.addEventListener('click', mostrar);
    sideNav.addEventListener('click', e => {
        const a = e.target.closest('a[data-page]');
        if (a && a !== link) pagina.classList.remove('active');
    });
    // Cualquier otro botón de navegación (menú superior, accesos rápidos) oculta esta sección
    document.addEventListener('click', e => {
        const b = e.target.closest('[data-go], [data-to], [data-prof-page], [data-inicio-to], [data-edu-page]');
        if (!b || b.dataset.eduPage === id) return;
        pagina.classList.remove('active');
        document.querySelector(`.top-header [data-edu-page="${id}"]`)?.classList.remove('selected', 'active', 'edu-active');
    }, true);

    // Menú superior (puede existir ya o crearse un poco después)
    const opciones = { principal, menu };
    if (!crearItemMenu(id, icono, texto, mostrar, opciones)) {
        let n = 0;
        const t = setInterval(() => { if (crearItemMenu(id, icono, texto, mostrar, opciones) || ++n > 40) clearInterval(t); }, 250);
    }
    return { pagina, link, mostrar };
}

/** Pone un contador rojo junto al enlace de la sección (0 lo quita). */
export function marcarSeccion(id, n) {
    agregarEstilos('eduSeccionesCss', '.edu-chat-badge{display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 5px;margin-left:6px;border-radius:9px;background:#dc2626;color:#fff;font-size:.68rem;font-weight:700}');
    for (const a of [document.querySelector(`.sidebar-nav a[data-page="${id}"] span`), document.getElementById('eduTop_' + id)]) {
        if (!a) continue;
        let b = a.querySelector('.edu-chat-badge');
        if (!n) { b?.remove(); continue; }
        if (!b) { b = el('span', { class: 'edu-chat-badge' }); a.append(b); }
        b.textContent = n > 9 ? '9+' : String(n);
    }
}
