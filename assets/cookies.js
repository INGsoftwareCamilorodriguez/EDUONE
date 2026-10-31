/* =====================================================================
   EduOne - cookies.js
   Aviso y configuración de cookies para el sitio público y el login.

   Hoy EduOne solo usa cookies/almacenamiento técnico NECESARIO, que no
   requiere consentimiento; el aviso informa y deja elegir. Si algún día
   se agrega analítica o publicidad, cárguela SOLO así:
       if (window.EduOneCookies.permitido('analitica')) { ... }
   y escuche cambios con  window.EduOneCookies.alCambiar(fn).
   Cualquier elemento con el atributo  data-cookies-config  abre la
   configuración.
   ===================================================================== */
(function () {
    'use strict';

    var CLAVE = 'eduone_cookies';
    var VERSION = '2026-10-31';
    var VIGENCIA_MS = 365 * 24 * 60 * 60 * 1000; // se vuelve a preguntar cada 12 meses
    var script = document.currentScript;
    var URL_POLITICA = new URL('../cookies.html', script ? script.src : location.href).href;
    var oyentes = [];

    function leer() {
        try {
            var d = JSON.parse(localStorage.getItem(CLAVE) || 'null');
            if (!d || d.version !== VERSION || Date.now() - new Date(d.fecha).getTime() > VIGENCIA_MS) return null;
            return d;
        } catch (e) { return null; }
    }
    function guardar(analitica) {
        var d = { version: VERSION, fecha: new Date().toISOString(), necesarias: true, analitica: !!analitica };
        try { localStorage.setItem(CLAVE, JSON.stringify(d)); } catch (e) { /* sin storage */ }
        oyentes.forEach(function (fn) { try { fn(d); } catch (e) { /* oyente con error */ } });
        return d;
    }

    var CSS = '' +
        '#eduCookieBanner{position:fixed;left:16px;right:16px;bottom:16px;z-index:100050;max-width:760px;margin:0 auto;' +
        'background:linear-gradient(180deg,rgba(17,26,48,.98),rgba(10,15,30,.98));color:#e2e8f0;border:1px solid rgba(34,211,238,.28);' +
        'border-radius:20px;box-shadow:0 20px 60px rgba(0,0,0,.5);padding:20px 22px;font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif;' +
        'transform:translateY(20px);opacity:0;transition:transform .35s cubic-bezier(.4,0,.2,1),opacity .35s}' +
        '#eduCookieBanner.visible{transform:none;opacity:1}' +
        '#eduCookieBanner h2{font-size:16px;font-weight:700;color:#fff;margin:0 0 6px;display:flex;align-items:center;gap:8px}' +
        '#eduCookieBanner p{font-size:13.5px;line-height:1.6;color:#94a3b8;margin:0}' +
        '#eduCookieBanner a{color:#22d3ee;font-weight:600;text-decoration:none}#eduCookieBanner a:hover{text-decoration:underline}' +
        '#eduCookieBanner .ck-acciones{display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-end;margin-top:14px}' +
        '#eduCookieBanner button{font:600 14px Inter,sans-serif;border-radius:100px;padding:10px 18px;cursor:pointer;transition:all .25s;border:1px solid rgba(148,163,184,.3);background:transparent;color:#e2e8f0}' +
        '#eduCookieBanner button:hover{border-color:#22d3ee;color:#fff}' +
        '#eduCookieBanner button.ck-principal{background:linear-gradient(135deg,#2563eb 0%,#06b6d4 100%);border-color:transparent;color:#fff;box-shadow:0 6px 18px rgba(37,99,235,.35)}' +
        '#eduCookieBanner .ck-opciones{display:none;margin-top:14px;border-top:1px solid rgba(148,163,184,.15);padding-top:12px}' +
        '#eduCookieBanner.config .ck-opciones{display:block}' +
        '#eduCookieBanner .ck-op{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:10px 0}' +
        '#eduCookieBanner .ck-op strong{display:block;color:#fff;font-size:14px}' +
        '#eduCookieBanner .ck-op span{font-size:12.5px;color:#94a3b8;line-height:1.5}' +
        '#eduCookieBanner .ck-switch{position:relative;width:44px;height:24px;flex:0 0 44px;margin-top:2px}' +
        '#eduCookieBanner .ck-switch input{opacity:0;width:100%;height:100%;margin:0;position:absolute;cursor:pointer;z-index:1}' +
        '#eduCookieBanner .ck-switch i{position:absolute;inset:0;border-radius:24px;background:#334155;transition:.25s}' +
        '#eduCookieBanner .ck-switch i::after{content:"";position:absolute;width:18px;height:18px;left:3px;top:3px;border-radius:50%;background:#fff;transition:.25s}' +
        '#eduCookieBanner .ck-switch input:checked+i{background:#06b6d4}#eduCookieBanner .ck-switch input:checked+i::after{transform:translateX(20px)}' +
        '#eduCookieBanner .ck-switch input:disabled{cursor:not-allowed}#eduCookieBanner .ck-switch input:disabled+i{opacity:.6}' +
        '#eduCookieBanner .ck-switch input:focus-visible+i{outline:2px solid #22d3ee;outline-offset:2px}' +
        '@media(max-width:600px){#eduCookieBanner{left:10px;right:10px;bottom:10px;padding:16px;bottom:calc(10px + env(safe-area-inset-bottom,0px))}' +
        '#eduCookieBanner .ck-acciones button{flex:1 1 100%}}';

    var banner = null;

    function construir() {
        if (banner) return banner;
        var st = document.createElement('style');
        st.textContent = CSS;
        document.head.appendChild(st);

        banner = document.createElement('section');
        banner.id = 'eduCookieBanner';
        banner.setAttribute('role', 'dialog');
        banner.setAttribute('aria-live', 'polite');
        banner.setAttribute('aria-labelledby', 'eduCookieTitulo');
        banner.innerHTML =
            '<h2 id="eduCookieTitulo"><span aria-hidden="true">🍪</span> Usamos solo cookies necesarias</h2>' +
            '<p>EduOne guarda en tu navegador lo indispensable para que el sitio funcione: tu sesión y tus preferencias. ' +
            'No usamos cookies de publicidad ni de analítica. <a href="' + URL_POLITICA + '">Política de cookies</a></p>' +
            '<div class="ck-opciones">' +
            '  <div class="ck-op"><div><strong>Necesarias</strong><span>Inicio de sesión, seguridad y preferencias. Siempre activas.</span></div>' +
            '    <label class="ck-switch"><input type="checkbox" checked disabled aria-label="Cookies necesarias (siempre activas)"><i></i></label></div>' +
            '  <div class="ck-op"><div><strong>Analítica</strong><span>Medir el uso del sitio para mejorarlo. EduOne no las usa hoy; solo se activarían con tu permiso.</span></div>' +
            '    <label class="ck-switch"><input type="checkbox" id="eduCkAnalitica" aria-label="Cookies de analítica"><i></i></label></div>' +
            '</div>' +
            '<div class="ck-acciones">' +
            '  <button type="button" data-ck="config">Configurar</button>' +
            '  <button type="button" data-ck="guardar" hidden>Guardar selección</button>' +
            '  <button type="button" data-ck="necesarias">Solo necesarias</button>' +
            '  <button type="button" class="ck-principal" data-ck="todas">Aceptar todas</button>' +
            '</div>';
        document.body.appendChild(banner);

        banner.addEventListener('click', function (e) {
            var b = e.target.closest('button[data-ck]');
            if (!b) return;
            var accion = b.getAttribute('data-ck');
            if (accion === 'config') {
                banner.classList.add('config');
                b.hidden = true;
                banner.querySelector('[data-ck="guardar"]').hidden = false;
                return;
            }
            if (accion === 'todas') guardar(true);
            else if (accion === 'necesarias') guardar(false);
            else if (accion === 'guardar') guardar(document.getElementById('eduCkAnalitica').checked);
            cerrar();
        });
        return banner;
    }

    function abrir(enConfiguracion) {
        construir();
        var d = leer();
        document.getElementById('eduCkAnalitica').checked = !!(d && d.analitica);
        banner.classList.toggle('config', !!enConfiguracion);
        banner.querySelector('[data-ck="config"]').hidden = !!enConfiguracion;
        banner.querySelector('[data-ck="guardar"]').hidden = !enConfiguracion;
        banner.hidden = false;
        requestAnimationFrame(function () { banner.classList.add('visible'); });
    }
    function cerrar() {
        if (!banner) return;
        banner.classList.remove('visible');
        setTimeout(function () { banner.hidden = true; }, 350);
    }

    window.EduOneCookies = {
        abrir: function () { abrir(true); },
        permitido: function (categoria) {
            if (categoria === 'necesarias') return true;
            var d = leer();
            return !!(d && d[categoria]);
        },
        alCambiar: function (fn) { if (typeof fn === 'function') oyentes.push(fn); }
    };

    function iniciar() {
        document.addEventListener('click', function (e) {
            var t = e.target.closest && e.target.closest('[data-cookies-config]');
            if (!t) return;
            e.preventDefault();
            abrir(true);
        });
        if (!leer()) setTimeout(function () { abrir(false); }, 900);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
    else iniciar();
})();
