/* =====================================================================
   EduOne - eduone-encabezado.js  (encabezado igual en todos los roles)
   - A la izquierda: logo del colegio + nombre del colegio (ya no se
     muestra "EduOne" ni la sección en la que está el usuario).
     Si el colegio no tiene logo se usa el de EduOne.
   - Botones del menú con el mismo aspecto en todos los paneles:
     cada botón y cada menú desplegable lleva su icono.
   - Cuando el desarrollador cambia el logo o el nombre del colegio,
     todos los paneles abiertos se actualizan solos (evento
     "eduone:colegio" de eduone-ui.js, que escucha el colegio en vivo).
   Lo importa eduone-ui.js en los paneles de colegio.
   Estilos: assets/eduone-encabezado.css
   ===================================================================== */
const LOGO_EDUONE = new URL('../imagenes/logo-96.png', import.meta.url).href;
const CLAVE = 'eduone_marca_colegio';

const ICONOS_MENU = [
    ['gestion academica', 'fa-book-open'], ['gestion', 'fa-briefcase'], ['academico', 'fa-graduation-cap'],
    ['evaluacion', 'fa-clipboard-check'], ['comunicacion', 'fa-comments'], ['finanzas', 'fa-coins'],
    ['consulta', 'fa-magnifying-glass'], ['convivencia', 'fa-handshake-angle'], ['documentos', 'fa-folder-open'],
    ['cobros', 'fa-cash-register'], ['reportes', 'fa-chart-pie'], ['estructura', 'fa-sitemap'],
    ['agenda', 'fa-calendar-days'], ['orientacion', 'fa-brain'], ['mi perfil', 'fa-user-circle'],
    ['perfil', 'fa-user-circle'], ['inicio', 'fa-house']
];
const normal = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const urlValida = u => typeof u === 'string' && (/^https:\/\//i.test(u) || /^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,/i.test(u));

function leerCache() { try { return JSON.parse(localStorage.getItem(CLAVE) || 'null') || {}; } catch { return {}; } }
function guardarCache(d) { try { localStorage.setItem(CLAVE, JSON.stringify(d)); } catch { /* sin storage */ } }

let marca = null;

function crearMarca() {
    const header = document.querySelector('.top-header');
    if (!header) return null;
    if (marca?.isConnected) return marca;
    const img = document.createElement('img');
    img.alt = 'Logo del colegio';
    img.width = 40; img.height = 40;
    img.decoding = 'async';
    img.src = LOGO_EDUONE;
    img.addEventListener('error', () => { if (img.src !== LOGO_EDUONE) img.src = LOGO_EDUONE; });
    const caja = document.createElement('span');
    caja.className = 'edu-marca-logo';
    caja.append(img);
    const nombre = document.createElement('span');
    nombre.className = 'edu-marca-nombre';
    nombre.id = 'eduMarcaNombre';
    marca = document.createElement('div');
    marca.className = 'edu-marca';
    marca.append(caja, nombre);
    const izquierda = header.querySelector('.header-left');
    if (izquierda) izquierda.prepend(marca); else header.prepend(marca);
    return marca;
}

function nombreInicial() {
    const t = (document.getElementById('colegioNombreSidebar')?.textContent || '').trim();
    return t && !/^cargando/i.test(t) ? t : '';
}

/** Pone el logo y el nombre del colegio en el encabezado y en el resto del panel. */
export function aplicarMarca(datos = {}) {
    const m = crearMarca();
    const nombre = String(datos.nombre || '').trim();
    const logo = urlValida(datos.logoUrl) ? datos.logoUrl : '';
    if (m) {
        const n = m.querySelector('.edu-marca-nombre');
        if (nombre) { n.textContent = nombre; n.title = nombre; m.title = nombre; }
        const img = m.querySelector('img');
        const destino = logo || LOGO_EDUONE;
        if (img.getAttribute('src') !== destino) img.src = destino;
    }
    if (!nombre && !logo) return;
    // Otros lugares del panel que muestran el logo o el nombre del colegio
    if (logo) {
        for (const id of ['colegioLogoImg', 'eduSchoolLogo', 'eduHeroLogo']) {
            const img = document.getElementById(id);
            if (!img || img.tagName !== 'IMG') continue;
            if (img.getAttribute('src') !== logo) img.src = logo;
            img.hidden = false;
            if (img.style.display === 'none') img.style.display = 'block';
        }
        const placeholder = document.getElementById('colegioLogoPlaceholder');
        if (placeholder) placeholder.style.display = 'none';
        const icono = document.getElementById('eduSchoolIcon');
        if (icono) icono.hidden = true;
        for (const id of ['bannerLogoContainer', 'inicioLogoBox', 'eduHomeSchoolLogo']) {
            const caja = document.getElementById(id);
            if (!caja) continue;
            let img = caja.querySelector('img');
            if (!img) {
                img = document.createElement('img');
                img.alt = 'Logo del colegio';
                img.className = 'logo-colegio';
                caja.replaceChildren(img);
            }
            if (img.getAttribute('src') !== logo) img.src = logo;
        }
    }
    if (nombre) {
        for (const id of ['eduSchoolName', 'eduHeroColegio', 'inicioNombreColegio', 'eduInstitutionName']) {
            const n = document.getElementById(id);
            if (n && n.textContent !== nombre) n.textContent = nombre;
        }
    }
}

/** Un icono al inicio de cada botón y menú desplegable del menú superior. */
function iconosMenu() {
    const items = document.querySelectorAll(
        '.top-header .edu-topnav > a, .top-header .edu-topnav > details > summary,' +
        '.top-header .edu-unico-menu > .edu-toplink, .top-header .edu-unico-menu > details > summary,' +
        '.top-header .edu-nav > button, .top-header .edu-nav > .edu-nav-group > .edu-group-toggle');
    for (const item of items) {
        if (item.dataset.eduIcono) continue;
        item.dataset.eduIcono = '1';
        const primero = item.firstElementChild;
        if (primero && primero.tagName === 'I' && !primero.classList.contains('fa-chevron-down')) continue;
        const texto = normal(item.textContent);
        const par = ICONOS_MENU.find(([clave]) => texto.startsWith(clave));
        const i = document.createElement('i');
        i.className = 'fas ' + (par ? par[1] : 'fa-folder');
        i.setAttribute('aria-hidden', 'true');
        item.prepend(i);
    }
}

function iniciar() {
    document.body.classList.add('edu-encabezado');
    const cache = leerCache();
    aplicarMarca({ nombre: nombreInicial() || cache.nombre || '', logoUrl: cache.logoUrl || '' });
    if (window.__eduColegioDatos) aplicarMarca(window.__eduColegioDatos);
    iconosMenu();

    // Nombre que los paneles escriben en la barra lateral (mientras llega el colegio)
    const lateral = document.getElementById('colegioNombreSidebar');
    if (lateral) new MutationObserver(() => {
        const t = nombreInicial();
        if (t) aplicarMarca({ nombre: t, logoUrl: (window.__eduColegioDatos || leerCache()).logoUrl });
    }).observe(lateral, { childList: true, characterData: true, subtree: true });

    // Secciones agregadas después (chat, orientación, cobros...) también llevan icono
    const header = document.querySelector('.top-header');
    if (header) {
        let pendiente = false;
        new MutationObserver(() => {
            if (pendiente) return;
            pendiente = true;
            requestAnimationFrame(() => { pendiente = false; iconosMenu(); if (!marca?.isConnected) aplicarMarca(window.__eduColegioDatos || leerCache()); });
        }).observe(header, { childList: true, subtree: true });
    }
}

document.addEventListener('eduone:colegio', ev => {
    const d = ev.detail?.datos || {};
    guardarCache({ nombre: d.nombre || '', logoUrl: urlValida(d.logoUrl) ? d.logoUrl : '' });
    aplicarMarca(d);
});

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
else iniciar();
