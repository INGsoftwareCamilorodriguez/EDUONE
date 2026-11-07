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
            // Dinero: el campo pasa a ser de texto con formato colombiano (450.000),
            // pero el código del panel sigue leyendo .value como número ("450000").
            detectar: el => !!el.dataset.eduMonto || el.classList.contains('edu-monto') ||
                (el.type === 'number' && /monto|valor|abono|precio|pago|pension|matricula|saldo|costo|cobro|tarifa/i.test(el.id + ' ' + el.name) &&
                    !/anio|año|porcentaje|orden|nota|pregunta|puntaje|tiempo|peso|cantidad|dia/i.test(el.id + ' ' + el.name)),
            preparar: el => convertirMonto(el),
            limpiar: v => v,
            mensaje: 'Escribe un valor válido, solo números (por ejemplo 450.000).'
        }
    };

    // -----------------------------------------------------------------
    // Dinero (COP): lee "450.000", "450,000", "450000", "450.000,50"...
    // -----------------------------------------------------------------
    const gruposMiles = (s, sep) => { const g = s.split(sep); return /^\d{1,3}$/.test(g[0]) && g.slice(1).every(x => /^\d{3}$/.test(x)); };
    /** Devuelve el número, null si está vacío o NaN si el formato no es válido. */
    function parsearMonto(texto) {
        if (typeof texto === 'number') return Number.isFinite(texto) ? texto : NaN;
        const s = String(texto ?? '').replace(/\s/g, '').replace(/^\$/, '').replace(/cop$/i, '');
        if (s === '') return null;
        if (!/^[0-9.,]+$/.test(s)) return NaN;
        const puntos = (s.match(/\./g) || []).length, comas = (s.match(/,/g) || []).length;
        let entero = s, decimal = '';
        if (puntos && comas) {
            // El último separador es el decimal; el otro, el de miles
            const sepDec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
            const sepMil = sepDec === ',' ? '.' : ',';
            const partes = s.split(sepDec);
            if (partes.length !== 2 || !gruposMiles(partes[0], sepMil)) return NaN;
            entero = partes[0].split(sepMil).join('');
            decimal = partes[1];
        } else if (puntos || comas) {
            const sep = puntos ? '.' : ',';
            const partes = s.split(sep);
            if (partes.length > 2) {                       // 1.450.000 -> miles
                if (!gruposMiles(s, sep)) return NaN;
                entero = partes.join('');
            } else if (partes[1].length === 3 && /^\d{1,3}$/.test(partes[0])) {
                entero = partes.join('');                  // 450.000 / 450,000 -> miles
            } else if (partes[1].length <= 2) {
                entero = partes[0]; decimal = partes[1];   // 450,5 / 450.50 -> decimales
            } else return NaN;
        }
        if (!/^\d+$/.test(entero) || (decimal && !/^\d{1,2}$/.test(decimal))) return NaN;
        return Number(entero + (decimal ? '.' + decimal : ''));
    }
    const formatearMonto = n => Number(n).toLocaleString('es-CO', { maximumFractionDigits: 2 });
    const VALOR_NATIVO = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    const textoDe = el => VALOR_NATIVO.get.call(el);

    function convertirMonto(el) {
        if (el.dataset.eduMontoListo) return;
        el.dataset.eduMontoListo = '1';
        el.dataset.eduMonto = '1';
        const inicial = textoDe(el);
        const min = el.getAttribute('min');
        if (min !== null && el.dataset.min === undefined) el.dataset.min = min;
        if (el.getAttribute('max') !== null && el.dataset.max === undefined) el.dataset.max = el.getAttribute('max');
        if (el.type !== 'text') el.type = 'text';
        ['min', 'max', 'step', 'pattern'].forEach(a => el.removeAttribute(a));
        el.inputMode = 'decimal';
        el.autocomplete = 'off';
        el.maxLength = 18;
        if (!el.placeholder || /^ej[:.]?\s*\d+$/i.test(el.placeholder.trim())) el.placeholder = 'Ej: 450.000';
        el.title = 'Solo números. Puedes usar puntos para los miles y coma para decimales (450.000 o 450.000,50).';
        // El código del panel lee y escribe .value como siempre:
        //  - lectura: número sin formato ("450000"), o "" si no es válido
        //  - escritura: se muestra con formato ("450.000")
        Object.defineProperty(el, 'value', {
            configurable: true,
            get() { const n = parsearMonto(textoDe(this)); return n == null || Number.isNaN(n) ? '' : String(n); },
            set(v) {
                const n = parsearMonto(v);
                VALOR_NATIVO.set.call(this, n == null || Number.isNaN(n) ? String(v ?? '') : formatearMonto(n));
            }
        });
        Object.defineProperty(el, 'valueAsNumber', {
            configurable: true,
            get() { const n = parsearMonto(textoDe(this)); return n == null ? NaN : n; },
            set(v) { this.value = v; }
        });
        if (inicial) el.value = inicial;
    }

    function errorMonto(el) {
        const texto = textoDe(el).trim();
        if (!texto) return el.required ? 'Escribe el valor.' : '';
        const n = parsearMonto(texto);
        if (Number.isNaN(n)) return 'Valor no válido. Usa solo números, por ejemplo 450.000 (sin letras ni signos).';
        const min = el.dataset.min !== undefined && el.dataset.min !== '' ? Number(el.dataset.min) : 0;
        if (n < min) return min > 0 ? `El valor mínimo es ${formatearMonto(min)}.` : 'El valor no puede ser negativo.';
        if (el.dataset.max !== undefined && el.dataset.max !== '' && n > Number(el.dataset.max)) {
            return `El valor máximo permitido es $${formatearMonto(Number(el.dataset.max))}.`;
        }
        return '';
    }

    window.EduMonto = { parsear: parsearMonto, formatear: formatearMonto, convertir: convertirMonto };

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
        if (regla === REGLAS.monto) {
            convertirMonto(el);
            const n = parsearMonto(textoDe(el));
            if (n != null && !Number.isNaN(n)) VALOR_NATIVO.set.call(el, formatearMonto(n));
            el.setCustomValidity('');
            return;
        }
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
        if (regla === REGLAS.monto) {
            const error = errorMonto(el);
            el.setCustomValidity(error);
            return !error;
        }
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
        if (regla === REGLAS.monto) {
            // Solo números, puntos y comas (sin letras, signos ni espacios)
            const texto = textoDe(el), limpio = texto.replace(/[^0-9.,]/g, '');
            if (limpio !== texto) {
                const pos = Math.max(0, (el.selectionStart ?? texto.length) - (texto.length - limpio.length));
                VALOR_NATIVO.set.call(el, limpio);
                try { el.setSelectionRange(pos, pos); } catch { /* sin selección */ }
            }
            el.setCustomValidity('');
            return;
        }
        if (!regla || regla.alSalir) { if (regla) el.setCustomValidity(''); return; }
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
        const malos = [...form.querySelectorAll('input[data-edu-valida]')].filter(el => el.offsetParent !== null && !revisar(el));
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
