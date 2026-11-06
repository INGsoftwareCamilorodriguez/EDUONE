/* =====================================================================
   EduOne - eduone-validacion.js  (validación de formularios, todos los paneles)
   Script clásico, sin dependencias. Detecta los campos por su tipo o id:
   - Teléfono / celular: solo números, 7 a 10 dígitos (celular 3XXXXXXXXX,
     fijo 60XXXXXXXX o 7 dígitos). Se quitan espacios, guiones y el +57.
   - Documento / cédula / NIT: solo números, 5 a 15 dígitos.
   - Nombres y apellidos de personas: solo letras, espacios, tildes, ' y -.
   - Correo: formato válido, sin espacios, en minúsculas.
   - Valores de dinero / montos: números positivos (sin "e", "-" ni "+").
   Además: se recortan espacios al inicio y al final de los textos y,
   antes de enviar, se limpian los valores que el panel llenó por código
   (p. ej. al editar un estudiante) para que no fallen por formato.
   Un campo puede marcarse a mano con data-validar="telefono|documento|nombre|correo|monto"
   o excluirse con data-validar="no".
   Se carga con: <script src="../assets/eduone-validacion.js" defer></script>
   ===================================================================== */
(function () {
    'use strict';
    if (window.__eduValidacion) return;
    window.__eduValidacion = true;

    const ES_BUSQUEDA = /buscar|filtro|search/i;
    const REGLAS = {
        telefono: {
            detectar: el => el.type === 'tel' || /tel[eé]fono|celular|whats|movil|m[oó]vil|phone/i.test(el.id + ' ' + el.name),
            preparar(el) {
                el.inputMode = 'numeric';
                el.autocomplete = el.autocomplete || 'tel';
                el.maxLength = 13;
                el.pattern = '(3[0-9]{9}|60[0-9]{8}|[0-9]{7})';
                el.title = 'Solo números: celular de 10 dígitos (3XXXXXXXXX) o fijo de 7 o 10 dígitos (60XXXXXXXX)';
                if (!el.placeholder || /tel|cel/i.test(el.placeholder)) el.placeholder = 'Ej: 3001234567';
            },
            limpiar(v) {
                let d = String(v).replace(/\D/g, '');
                if (d.length === 12 && d.startsWith('57')) d = d.slice(2);
                return d.slice(0, 10);
            },
            mensaje: 'Escribe un teléfono válido: celular de 10 dígitos que empiece por 3, o fijo de 7 o 10 dígitos.'
        },
        documento: {
            detectar: el => /documento|c[eé]dula|identificaci[oó]n|^nit$|nit[A-Z]|numeroDoc/i.test(el.id + ' ' + el.name) && !/tipo|url|archivo|file/i.test(el.id + ' ' + el.name),
            preparar(el) {
                el.inputMode = 'numeric';
                el.maxLength = 15;
                el.pattern = '[0-9]{5,15}';
                el.title = 'Solo números, entre 5 y 15 dígitos, sin puntos ni espacios';
            },
            limpiar: v => String(v).replace(/\D/g, '').slice(0, 15),
            mensaje: 'El documento debe tener solo números (entre 5 y 15 dígitos), sin puntos ni espacios.'
        },
        nombre: {
            // Solo nombres de PERSONAS (no cursos, grados, asignaturas ni colegios)
            detectar: el => /^(est|editEst|perfil|personal|editPersonal|nuevo|editarNuevoRector|rector)(Nombres?|Apellidos?|Acudiente|NombreAcudiente)$/i.test(el.id) && el.type !== 'email',
            preparar(el) {
                el.pattern = "[A-Za-zÁÉÍÓÚÜÑáéíóúüñ' .\\-]{2,80}";
                el.title = 'Solo letras y espacios (mínimo 2 caracteres)';
                el.maxLength = 80;
                el.autocapitalize = 'words';
            },
            limpiar: v => String(v).replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ' .\-]/g, '').replace(/\s{2,}/g, ' '),
            mensaje: 'El nombre solo puede tener letras y espacios.'
        },
        correo: {
            detectar: el => el.type === 'email',
            preparar(el) {
                el.pattern = '[^@\\s]+@[^@\\s]+\\.[^@\\s]{2,}';
                el.title = 'Correo electrónico válido, por ejemplo nombre@dominio.com';
                el.maxLength = el.maxLength > 0 ? el.maxLength : 120;
                el.autocapitalize = 'off';
                el.spellcheck = false;
            },
            limpiar: v => String(v).replace(/\s/g, '').toLowerCase(),
            alSalir: true,
            mensaje: 'Escribe un correo válido, por ejemplo nombre@dominio.com.'
        },
        monto: {
            detectar: el => el.type === 'number' && /monto|valor|abono|precio|pago|pension|matricula/i.test(el.id + ' ' + el.name) && !/anio|año|porcentaje|orden/i.test(el.id),
            preparar(el) {
                if (el.min === '') el.min = '0';
                el.inputMode = 'numeric';
                if (!el.step || el.step === 'any') el.step = '1';
            },
            limpiar: v => v,
            mensaje: 'Escribe un valor numérico mayor o igual a cero.'
        }
    };

    function reglaDe(el) {
        if (el.dataset.validar === 'no') return null;
        if (el.dataset.validar && REGLAS[el.dataset.validar]) return REGLAS[el.dataset.validar];
        if (el.tagName !== 'INPUT' || ES_BUSQUEDA.test(el.id + ' ' + el.name + ' ' + el.type) || el.type === 'hidden' || el.type === 'password') return null;
        for (const k of ['correo', 'telefono', 'documento', 'nombre', 'monto']) if (REGLAS[k].detectar(el)) return REGLAS[k];
        return null;
    }

    function preparar(el) {
        if (el.dataset.eduValida) return;
        const regla = reglaDe(el);
        if (!regla) return;
        el.dataset.eduValida = '1';
        regla.preparar(el);
    }

    function limpiar(el) {
        const regla = reglaDe(el);
        if (regla && el.value) {
            const nuevo = regla.limpiar(el.value);
            if (nuevo !== el.value) el.value = nuevo;
        }
        if (regla) el.setCustomValidity('');
    }

    function revisar(el) {
        const regla = reglaDe(el);
        if (!regla) return true;
        el.setCustomValidity('');
        if (el.value && !el.checkValidity()) {
            el.setCustomValidity(regla.mensaje);
            return false;
        }
        return true;
    }

    function prepararTodo(raiz = document) {
        raiz.querySelectorAll?.('input').forEach(preparar);
    }

    // Mientras se escribe: los campos numéricos no aceptan letras
    document.addEventListener('input', e => {
        const el = e.target;
        if (!(el instanceof HTMLInputElement)) return;
        preparar(el);
        const regla = reglaDe(el);
        if (!regla || regla.alSalir || regla === REGLAS.monto) { if (regla) el.setCustomValidity(''); return; }
        const pos = el.selectionStart, antes = el.value.length;
        limpiar(el);
        if (pos != null && el.type !== 'email' && el.type !== 'number') {
            const p = Math.max(0, pos - (antes - el.value.length));
            try { el.setSelectionRange(p, p); } catch { /* tipos sin selección */ }
        }
    }, true);

    // En montos: bloquear e, E, +, -
    document.addEventListener('keydown', e => {
        const el = e.target;
        if (el instanceof HTMLInputElement && reglaDe(el) === REGLAS.monto && ['e', 'E', '+', '-'].includes(e.key)) e.preventDefault();
    }, true);

    // Al salir del campo: recortar espacios y mostrar el error si lo hay
    document.addEventListener('focusout', e => {
        const el = e.target;
        if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
        if (el.type !== 'password' && el.type !== 'file' && typeof el.value === 'string' && el.value !== el.value.trim() && el.type !== 'number') el.value = el.value.trim();
        limpiar(el);
        if (!revisar(el)) el.reportValidity();
    }, true);

    // Antes de que el navegador valide el formulario: limpiar valores puestos por código
    function antesDeEnviar(form) {
        if (!form) return;
        form.querySelectorAll('input, textarea').forEach(el => {
            if (el.type !== 'password' && el.type !== 'file' && el.type !== 'number' && typeof el.value === 'string' && el.value !== el.value.trim()) el.value = el.value.trim();
            preparar(el); limpiar(el); revisar(el);
        });
    }
    document.addEventListener('click', e => {
        const b = e.target.closest?.('button[type="submit"], input[type="submit"], button:not([type])');
        if (b?.form) antesDeEnviar(b.form);
    }, true);
    document.addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.target?.form && e.target.tagName === 'INPUT') antesDeEnviar(e.target.form);
    }, true);
    // Formularios con novalidate (validan en JS): se bloquea el envío si un campo con formato no cumple
    document.addEventListener('submit', e => {
        const form = e.target;
        antesDeEnviar(form);
        const malos = [...form.querySelectorAll('input[data-edu-valida]')].filter(el => el.value && !el.checkValidity() && el.offsetParent !== null);
        if (malos.length) {
            e.preventDefault();
            e.stopImmediatePropagation();
            malos[0].reportValidity();
            malos[0].focus();
        }
    }, true);

    const iniciar = () => {
        prepararTodo();
        new MutationObserver(ms => {
            for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.tagName === 'INPUT') preparar(n); else prepararTodo(n); }
        }).observe(document.body, { childList: true, subtree: true });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
