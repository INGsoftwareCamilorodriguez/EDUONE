/* =====================================================================
   EduOne - eduone-panel.js  (diseño 2026 para acudiente, coordinadores
   y secretaría). Script clásico, sin dependencias.
   - Convierte la barra lateral en el menú superior del nuevo diseño
     (la barra lateral queda oculta y sus enlaces siguen haciendo todo
     el trabajo, así no cambia la lógica de cada panel).
   - Agrega la portada del colegio y un encabezado a cada sección.
   - Escucha el evento "eduone:colegio" (assets/eduone-ui.js) para
     actualizar nombre, logo y portada en vivo.
   Se carga con: <script src="../assets/eduone-panel.js" defer></script>
   ===================================================================== */
(function () {
    'use strict';
    if (window.__eduPanel2026) return;
    window.__eduPanel2026 = true;

    const LOGO = new URL('../imagenes/logo-96.png', document.currentScript?.src || location.href).href;
    const DESCRIPCIONES = {
        notas: 'Calificaciones por asignatura y período',
        anuncios: 'Mensajes y novedades del colegio',
        reportes: 'Reportes y novedades registradas',
        boletin: 'Genera y descarga el boletín académico',
        docentes: 'Planta docente y asignaciones',
        cursos: 'Cursos, grupos y directores de grupo',
        calificaciones: 'Consulta de calificaciones por curso',
        periodos: 'Configura los períodos del año escolar',
        rendimiento: 'Indicadores y desempeño académico',
        horarios: 'Programación de clases',
        recuperaciones: 'Planes y actividades de recuperación',
        situaciones: 'Casos académicos de los estudiantes',
        estudiantes: 'Consulta de estudiantes del colegio',
        casos: 'Quejas e incidentes de convivencia',
        seguimiento: 'Seguimiento y compromisos adquiridos',
        citaciones: 'Citaciones y comunicación con acudientes',
        historial: 'Historial por estudiante',
        matriculas: 'Registro y gestión de matrículas',
        acudientes: 'Padres de familia y acudientes',
        certificados: 'Certificados de estudio y notas',
        documentos: 'Genera documentos institucionales',
        traslados: 'Traslados y retiros de estudiantes'
    };

    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
    const h = (tag, attrs = {}, ...hijos) => {
        const n = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (k === 'class') n.className = v;
            else if (k === 'text') n.textContent = v;
            else n.setAttribute(k, v);
        }
        hijos.flat().forEach(c => c != null && n.append(c));
        return n;
    };
    const capitalizar = t => {
        const s = String(t || '').trim().toLowerCase();
        return s.charAt(0).toUpperCase() + s.slice(1);
    };

    function iniciar() {
        document.body.classList.add('edu-panel2026');
        const header = $('.top-header');
        const sideNav = $('.sidebar-nav');
        if (!header || !sideNav) return;

        // ---------- Marca + nombre del colegio ----------
        const left = $('.header-left', header);
        const marca = h('div', { class: 'edu-brand' },
            h('img', { class: 'edu-logo-img', src: LOGO, alt: 'EduOne', width: '36', height: '36' }),
            h('span', {}, 'Edu', h('b', { text: 'One' })));
        const institucion = h('div', { class: 'edu-institution', id: 'eduInstitutionName', text: '' });
        left.append(marca, institucion);

        const nombreSidebar = $('#colegioNombreSidebar');
        const copiarNombre = () => {
            const t = (nombreSidebar?.textContent || '').trim();
            if (t && !/^cargando/i.test(t)) { institucion.textContent = t; institucion.title = t; }
        };
        if (nombreSidebar) {
            copiarNombre();
            new MutationObserver(copiarNombre).observe(nombreSidebar, { childList: true, characterData: true, subtree: true });
        }

        // ---------- Menú superior a partir de la barra lateral ----------
        const grupos = [];
        let titulo = null;
        for (const nodo of sideNav.children) {
            if (nodo.classList.contains('nav-section')) { titulo = capitalizar(nodo.textContent); continue; }
            if (nodo.tagName !== 'UL') continue;
            const links = $$('a[data-page]', nodo);
            if (links.length) grupos.push({ titulo, links });
            titulo = null;
        }
        const total = grupos.reduce((n, g) => n + g.links.length, 0);
        const plano = total <= 6;

        const nav = h('nav', { class: 'edu-topnav', id: 'eduPanelNav', 'aria-label': 'Menú principal' });
        const botonMenu = h('button', {
            type: 'button', class: 'edu-mobile-menu', id: 'eduPanelMenu',
            'aria-controls': 'eduPanelNav', 'aria-expanded': 'false', 'aria-label': 'Abrir menú'
        }, h('i', { class: 'fas fa-bars' }), h('span', { class: 'edu-menu-text', text: 'Menú' }));

        const icono = a => (a.querySelector('i')?.className || 'fas fa-circle');
        const texto = a => (a.querySelector('span')?.textContent || a.textContent).trim();
        const enlaceDirecto = a => {
            const el = h('a', { href: '#', 'data-edu-page': a.dataset.page }, h('i', { class: icono(a) }), ' ' + texto(a));
            return el;
        };

        for (const g of grupos) {
            if (plano || !g.titulo || g.links.length === 1) {
                g.links.forEach(a => nav.append(enlaceDirecto(a)));
                continue;
            }
            const det = h('details', {},
                h('summary', {}, g.titulo, h('i', { class: 'fas fa-chevron-down' })),
                h('div', { class: 'edu-subnav' }, g.links.map(a =>
                    h('button', { type: 'button', 'data-edu-page': a.dataset.page }, h('i', { class: icono(a) }), texto(a)))));
            nav.append(det);
        }
        const right = $('.header-right', header);
        header.insertBefore(botonMenu, right);
        header.insertBefore(nav, right);

        const cerrarMenu = () => {
            nav.classList.remove('mobile-open');
            botonMenu.setAttribute('aria-expanded', 'false');
            $$('details', nav).forEach(d => { d.open = false; });
        };
        const marcar = pagina => {
            $$('[data-edu-page]', nav).forEach(b => b.classList.toggle('selected', b.dataset.eduPage === pagina));
            $$('details', nav).forEach(d => d.classList.toggle('selected', !!d.querySelector(`[data-edu-page="${pagina}"]`)));
        };
        nav.addEventListener('click', e => {
            const b = e.target.closest('[data-edu-page]');
            if (!b) return;
            e.preventDefault();
            $(`.sidebar-nav a[data-page="${b.dataset.eduPage}"]`)?.click();
            cerrarMenu();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        // Cualquier navegación (también desde la campana u otros botones) actualiza el menú
        $$('.sidebar-nav a[data-page]').forEach(a => a.addEventListener('click', () => marcar(a.dataset.page)));
        marcar($('.sidebar-nav li.active a[data-page]')?.dataset.page || 'inicio');

        $$('details', nav).forEach(d => d.addEventListener('toggle', () => {
            if (d.open) $$('details', nav).forEach(o => { if (o !== d) o.open = false; });
        }));
        botonMenu.addEventListener('click', () => {
            const abierto = nav.classList.toggle('mobile-open');
            botonMenu.setAttribute('aria-expanded', String(abierto));
        });
        document.addEventListener('pointerdown', e => {
            if (!nav.contains(e.target) && !botonMenu.contains(e.target)) cerrarMenu();
        });
        document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarMenu(); });
        window.addEventListener('resize', () => { if (window.innerWidth > 1280) cerrarMenu(); });

        // ---------- Encabezado de cada sección ----------
        $$('.page-content[id^="page-"]').forEach(p => {
            const pagina = p.id.slice(5);
            if (pagina === 'inicio' || p.querySelector('.edu-hero, .welcome-banner')) return;
            const a = $(`.sidebar-nav a[data-page="${pagina}"]`);
            if (!a) return;
            p.prepend(h('div', { class: 'edu-hero' },
                h('div', { class: 'edu-hero-icon' }, h('i', { class: icono(a) })),
                h('div', {}, h('h2', { text: texto(a) }), h('p', { text: DESCRIPCIONES[pagina] || 'Gestión institucional' }))));
        });

        // ---------- Portada del colegio en Inicio ----------
        const banner = $('#page-inicio .welcome-banner');
        if (banner) {
            banner.classList.add('edu-school-cover');
            if (!banner.querySelector('#bannerLogoContainer')) {
                banner.prepend(h('div', { class: 'edu-hero-icon', id: 'eduHomeSchoolLogo' }, h('i', { class: 'fas fa-school' })));
            }
        }

        // ---------- Selector de hijo (acudiente) ----------
        const selector = $('#hijoSelectorWrap');
        const contenido = $('#contentArea');
        if (selector && contenido) {
            const barra = h('div', { class: 'edu-hijo-bar', hidden: '' },
                h('label', { for: 'hijoSelector' }, h('i', { class: 'fas fa-user-graduate' }), 'Estudiante'));
            barra.append(selector);
            contenido.prepend(barra);
            const sync = () => { barra.hidden = getComputedStyle(selector).display === 'none'; };
            new MutationObserver(sync).observe(selector, { attributes: true, attributeFilter: ['style', 'class'] });
            sync();
        }
    }

    // ---------- Datos del colegio en vivo (desde eduone-ui.js) ----------
    document.addEventListener('eduone:colegio', ev => {
        const d = ev.detail?.datos || {};
        const inst = $('#eduInstitutionName');
        if (inst && d.nombre) { inst.textContent = d.nombre; inst.title = d.nombre; }
        const portada = d.fotoPortadaUrl || d.fotoColegioUrl || '';
        const raiz = document.documentElement.style;
        if (portada) raiz.setProperty('--edu-school-image', `url("${String(portada).replace(/["\\]/g, '')}")`);
        else raiz.removeProperty('--edu-school-image');
        const caja = $('#eduHomeSchoolLogo');
        if (caja) {
            if (d.logoUrl) {
                const img = caja.querySelector('img') || caja.appendChild(h('img', { alt: 'Logo del colegio' }));
                caja.querySelector('i')?.remove();
                if (img.src !== d.logoUrl) img.src = d.logoUrl;
            }
        }
        // Logo dentro del banner propio de coordinadores / secretaría
        const propio = $('#bannerLogoContainer');
        if (propio && d.logoUrl) {
            const img = propio.querySelector('img');
            if (img && img.src !== d.logoUrl) img.src = d.logoUrl;
        }
    });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
    else iniciar();
})();
