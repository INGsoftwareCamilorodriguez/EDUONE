/* =====================================================================
   EduOne - eduone-secciones.js
   Agrega una sección nueva (enlace + página) a cualquier panel que use
   .sidebar-nav y .page-content, sin tocar la lógica de navegación de
   la página. También la agrega al menú superior del diseño 2026
   (#eduPanelNav, creado por eduone-panel.js).
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

/**
 * @returns {{ pagina: HTMLElement, link: HTMLAnchorElement, mostrar: Function } | null}
 */
export function agregarSeccion({ id, icono, texto, grupo = 'COMUNICACIÓN', titulo }) {
    if (document.getElementById('page-' + id)) return null;
    const contenedor = document.querySelector('.page-content')?.parentElement || document.getElementById('contentArea');
    const sideNav = document.querySelector('.sidebar-nav');
    if (!contenedor || !sideNav) return null;

    // Grupo en la barra lateral
    let ul = sideNav.querySelector(`ul[data-edu-grupo="${grupo}"]`);
    if (!ul) {
        ul = el('ul', { 'data-edu-grupo': grupo });
        sideNav.append(el('div', { class: 'nav-section', text: grupo }), ul);
    }
    const link = el('a', { href: '#', 'data-page': id }, el('i', { class: icono }), el('span', { text: texto }));
    ul.append(el('li', {}, link));

    const pagina = el('div', { id: 'page-' + id, class: 'page-content' });
    contenedor.append(pagina);

    const mostrar = (e) => {
        e?.preventDefault();
        document.querySelectorAll('.page-content').forEach(p => p.classList.toggle('active', p === pagina));
        document.querySelectorAll('.sidebar-nav li').forEach(li => li.classList.toggle('active', li.contains(link)));
        document.querySelectorAll('#eduPanelNav [data-edu-page]').forEach(b => b.classList.toggle('selected', b.dataset.eduPage === id));
        document.querySelectorAll('#eduPanelNav details').forEach(d => d.classList.remove('selected'));
        const t = document.getElementById('pageTitle');
        if (t && !t.querySelector('img')) t.textContent = titulo || texto;
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

    // Menú superior (puede existir ya o crearse un poco después)
    const enTopNav = () => {
        const nav = document.getElementById('eduPanelNav');
        if (!nav) return false;
        if (!nav.querySelector(`[data-edu-page="${id}"]`)) {
            nav.append(el('a', { href: '#', 'data-edu-page': id, id: 'eduTop_' + id }, el('i', { class: icono }), ' ' + texto));
        }
        return true;
    };
    if (!enTopNav()) {
        let n = 0;
        const t = setInterval(() => { if (enTopNav() || ++n > 40) clearInterval(t); }, 250);
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
