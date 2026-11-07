/* =====================================================================
   EduOne - eduone-registros.js  (registro de estudiantes nuevos)
   Flujo:
   1) SECRETARÍA ("Nuevos estudiantes"): registra los datos del estudiante
      y del acudiente (padre/madre), el grado/curso y, si lo hay, el pago
      de la matrícula. NO crea correos ni contraseñas.
      Si el colegio ya superó el número de estudiantes de su plan, se le
      muestra un aviso, pero la información se guarda y se envía igual.
   2) RECTORÍA ("Cuentas de acceso"): ve lo que registró secretaría
      (pendientes y ya creados, con filtros y búsqueda) y asigna el correo
      y la contraseña del estudiante y del acudiente. Si el colegio llegó
      al máximo de estudiantes del plan, NO puede crear las cuentas.
   Cada solicitud se procesa una sola vez aunque se intente desde dos
   pestañas o dos equipos (transacción sobre la solicitud).
   Colección: colegios/{id}/solicitudes_registro/doc_{documento}
   ===================================================================== */
import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/11.3.1/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/11.3.1/firebase-auth.js';
import {
    collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, query, where, runTransaction, onSnapshot, serverTimestamp, getCountFromServer
} from 'https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js';
import { obtenerContexto, nombreDe, notificarUsuario } from './eduone-comun.js?v=20261108';
import { el, agregarEstilos, agregarSeccion, marcarSeccion } from './eduone-secciones.js?v=20261108';
import { COP, ymd, norm } from './eduone-cobros.js?v=20261108';

const TIPOS_DOC = { TI: 'Tarjeta de identidad', RC: 'Registro civil', CC: 'Cédula de ciudadanía', CE: 'Cédula de extranjería', PEP: 'PEP / PPT', PA: 'Pasaporte' };
const PARENTESCOS = ['Madre', 'Padre', 'Abuelo(a)', 'Tío(a)', 'Hermano(a)', 'Otro'];
const METODOS = { efectivo: 'Efectivo', transferencia: 'Transferencia', consignacion: 'Consignación', tarjeta: 'Tarjeta débito/crédito', nequi: 'Nequi / Daviplata' };
const ESTADOS = { pendiente: ['Pendiente de cuenta', 'abonado'], procesando: ['Creando cuentas...', 'sin'], completada: ['Cuenta creada', 'pagado'], rechazada: ['Rechazada', 'pendiente'] };

const CSS = `
.reg-cupo{display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:14px 18px;border-radius:14px;background:var(--primary-bg,#eff6ff);margin-bottom:16px}
.reg-cupo .barra{flex:1 1 220px;max-width:420px;height:9px;border-radius:99px;background:#e2e8f0;overflow:hidden}
.reg-cupo .barra>div{height:100%;background:var(--success,#16a34a);border-radius:99px;transition:width .3s}
.reg-cupo.lleno{background:#fef2f2}.reg-cupo.lleno .barra>div{background:#dc2626}
.reg-alerta{display:flex;gap:10px;align-items:flex-start;border-radius:12px;padding:12px 14px;margin-bottom:14px;font-size:.88rem;line-height:1.45}
.reg-alerta.error{background:#fef2f2;border:1px solid #fecaca;color:#991b1b}
.reg-alerta.aviso{background:#fffbeb;border:1px solid #fde68a;color:#92400e}
.reg-alerta.ok{background:#f0fdf4;border:1px solid #bbf7d0;color:#166534}
.reg-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.reg-sub{font-size:.92rem;color:var(--gray-600,#475569);margin:18px 0 10px;display:flex;gap:8px;align-items:center}
.reg-sub:first-child{margin-top:0}
.reg-chip{display:inline-block;padding:3px 10px;border-radius:999px;font-size:.74rem;font-weight:600;white-space:nowrap}
.reg-chip.pagado{background:#dcfce7;color:#166534}.reg-chip.abonado{background:#fef3c7;color:#92400e}
.reg-chip.pendiente{background:#fee2e2;color:#991b1b}.reg-chip.sin{background:#f1f5f9;color:#64748b}
.reg-pass{display:flex;gap:8px}.reg-pass input{flex:1}
.reg-cred{background:#0f172a;color:#e2e8f0;border-radius:12px;padding:14px 16px;font:500 .86rem ui-monospace,Consolas,monospace;white-space:pre-wrap;margin:10px 0}
@media(max-width:900px){.reg-grid{grid-template-columns:1fr 1fr}}
@media(max-width:600px){.reg-grid{grid-template-columns:1fr}}
`;

let c = null;
const base = () => ['colegios', c.colegioId];
const col = n => collection(c.db, ...base(), n);

async function cupo() {
    const [col_, est, pend] = await Promise.all([
        getDoc(doc(c.db, ...base())),
        getCountFromServer(col('estudiantes')).then(s => s.data().count).catch(async () => (await getDocs(col('estudiantes'))).size),
        getCountFromServer(query(col('solicitudes_registro'), where('estado', '==', 'pendiente'))).then(s => s.data().count).catch(() => 0)
    ]);
    const d = col_.exists() ? col_.data() : {};
    const max = Number(d.maxEstudiantes) || 999999;
    return { max, actuales: est, pendientes: pend, plan: d.planNombre || 'Plan', ilimitado: max >= 999999 };
}

function tarjetaCupo(info, conPendientes) {
    const usados = info.actuales + (conPendientes ? info.pendientes : 0);
    const lleno = !info.ilimitado && usados >= info.max;
    const pct = info.ilimitado ? 0 : Math.min(100, Math.round((usados / info.max) * 100));
    return el('div', { class: 'reg-cupo' + (lleno ? ' lleno' : '') },
        el('div', {}, el('small', { class: 'text-muted', style: 'display:block;font-size:.72rem;text-transform:uppercase', text: 'Plan actual' }), el('strong', { text: info.plan })),
        el('div', { class: 'barra' }, el('div', { style: `width:${pct}%` })),
        el('div', {}, el('strong', { text: `${info.actuales}${conPendientes && info.pendientes ? ' + ' + info.pendientes + ' pendientes' : ''} / ${info.ilimitado ? '∞' : info.max}` }),
            el('small', { class: 'text-muted', style: 'display:block', text: 'estudiantes' })));
}

const alerta = (tipo, texto) => el('div', { class: 'reg-alerta ' + tipo }, el('i', { class: tipo === 'ok' ? 'fas fa-circle-check' : 'fas fa-triangle-exclamation', style: 'margin-top:2px' }), el('span', { text: texto }));

async function cargarGradosCursos() {
    const [g, cu] = await Promise.all([getDocs(col('grados')), getDocs(col('cursos'))]);
    const grados = g.docs.map(d => ({ id: d.id, nombre: d.data().nombre || 'Grado', orden: Number(d.data().orden) || 0 })).sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
    const cursos = cu.docs.map(d => ({ id: d.id, nombre: d.data().nombre || 'Curso', gradoId: d.data().gradoId || '' })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
    return { grados, cursos };
}

// =====================================================================
// SECRETARÍA: registrar estudiante nuevo
// =====================================================================
async function montarSecretaria() {
    const sec = agregarSeccion({ id: 'nuevos', icono: 'fas fa-user-plus', texto: 'Nuevos estudiantes', grupo: 'GESTIÓN ACADÉMICA', titulo: 'Registro de estudiantes nuevos', menu: 'Gestión académica' });
    if (!sec) return;
    agregarEstilos('eduRegistrosCss', CSS);
    const cupoHost = el('div', {});
    const mensajes = el('div', {});
    const inp = (id, attrs = {}) => el('input', { id, class: 'form-control', autocomplete: 'off', ...attrs });
    const sel = (id, opciones, attrs = {}) => el('select', { id, class: 'form-control', ...attrs }, ...opciones);
    const grupo = (label, control, extra = {}) => el('div', { class: 'form-group', ...extra }, el('label', { for: control.id, text: label }), control);

    const f = {
        nombres: inp('regNombres', { type: 'text', required: true, maxlength: '80', 'data-validar': 'nombre' }),
        apellidos: inp('regApellidos', { type: 'text', required: true, maxlength: '80', 'data-validar': 'nombre' }),
        tipoDoc: sel('regTipoDoc', Object.entries(TIPOS_DOC).map(([k, v]) => el('option', { value: k, text: v }))),
        documento: inp('regDocumento', { type: 'text', required: true }),
        nacimiento: inp('regFechaNacimiento', { type: 'date', max: ymd() }),
        telefono: inp('regTelefono', { type: 'tel' }),
        direccion: inp('regDireccion', { type: 'text', maxlength: '120' }),
        acuNombre: inp('regAcuNombre', { type: 'text', required: true, maxlength: '80', 'data-validar': 'nombre' }),
        parentesco: sel('regAcuParentesco', PARENTESCOS.map(p => el('option', { value: p, text: p }))),
        acuDocumento: inp('regAcuDocumento', { type: 'text' }),
        acuTelefono: inp('regAcuTelefono', { type: 'tel', required: true }),
        acuCorreo: inp('regAcuCorreo', { type: 'email', placeholder: 'Correo de contacto (opcional)' }),
        acuDireccion: inp('regAcuDireccion', { type: 'text', maxlength: '120' }),
        grado: sel('regGrado', [el('option', { value: '', text: 'Seleccionar grado' })], { required: true }),
        curso: sel('regCurso', [el('option', { value: '', text: 'Seleccionar curso' })], { required: true }),
        valor: inp('regValorMatricula', { type: 'text', class: 'form-control edu-monto', placeholder: 'Ej: 450.000' }),
        abono: inp('regAbono', { type: 'text', class: 'form-control edu-monto', placeholder: 'Ej: 450.000' }),
        metodo: sel('regMetodo', Object.entries(METODOS).map(([k, v]) => el('option', { value: k, text: v }))),
        referencia: inp('regReferencia', { type: 'text', maxlength: '40', placeholder: 'Opcional' }),
        fechaPago: inp('regFechaPago', { type: 'date', max: ymd() })
    };
    const btn = el('button', { type: 'submit', class: 'btn-primary' }, el('i', { class: 'fas fa-paper-plane' }), ' Registrar y enviar a rectoría');
    const form = el('form', { id: 'formRegistroNuevo' },
        el('h3', { class: 'reg-sub' }, el('i', { class: 'fas fa-user-graduate', style: 'color:var(--primary)' }), 'Datos del estudiante'),
        el('div', { class: 'reg-grid' }, grupo('Nombres *', f.nombres), grupo('Apellidos *', f.apellidos), grupo('Tipo de documento', f.tipoDoc),
            grupo('Número de documento *', f.documento), grupo('Fecha de nacimiento', f.nacimiento), grupo('Teléfono', f.telefono), grupo('Dirección', f.direccion)),
        el('h3', { class: 'reg-sub' }, el('i', { class: 'fas fa-user-friends', style: 'color:var(--primary)' }), 'Padre de familia / acudiente'),
        el('div', { class: 'reg-grid' }, grupo('Nombre completo *', f.acuNombre), grupo('Parentesco', f.parentesco), grupo('Documento', f.acuDocumento),
            grupo('Teléfono *', f.acuTelefono), grupo('Correo de contacto', f.acuCorreo), grupo('Dirección', f.acuDireccion)),
        el('h3', { class: 'reg-sub' }, el('i', { class: 'fas fa-graduation-cap', style: 'color:var(--primary)' }), 'Grado y curso'),
        el('div', { class: 'reg-grid' }, grupo('Grado *', f.grado), grupo('Curso *', f.curso)),
        el('h3', { class: 'reg-sub' }, el('i', { class: 'fas fa-money-bill-wave', style: 'color:var(--primary)' }), 'Matrícula'),
        el('div', { class: 'reg-grid' }, grupo('Valor de la matrícula (COP)', f.valor), grupo('Pago recibido (COP)', f.abono), grupo('Método de pago', f.metodo),
            grupo('Referencia', f.referencia), grupo('Fecha del pago', f.fechaPago)),
        el('p', { class: 'text-muted', style: 'font-size:.8rem;margin:6px 0 14px', text: 'El correo y la contraseña del estudiante y del acudiente los asigna rectoría. Cuando rectoría cree las cuentas, la matrícula y el pago quedan registrados.' }),
        el('div', { style: 'display:flex;justify-content:flex-end' }, btn));

    const tbody = el('tbody', {}, el('tr', {}, el('td', { colspan: '7', class: 'text-center text-muted', text: 'Cargando...' })));
    sec.pagina.append(cupoHost,
        el('div', { class: 'card' }, el('div', { class: 'card-header' }, el('h2', {}, el('i', { class: 'fas fa-user-plus', style: 'color:var(--primary)' }), ' Registrar estudiante nuevo')),
            el('div', { class: 'card-body' }, mensajes, form)),
        el('div', { class: 'card', style: 'margin-top:16px' }, el('div', { class: 'card-header' }, el('h2', {}, el('i', { class: 'fas fa-list', style: 'color:var(--primary)' }), ' Estudiantes registrados por secretaría')),
            el('div', { class: 'card-body' }, el('div', { class: 'table-responsive' }, el('table', { class: 'table-modern' },
                el('thead', {}, el('tr', {}, ...['#', 'Estudiante', 'Documento', 'Curso', 'Acudiente', 'Fecha', 'Estado'].map(t => el('th', { text: t })))), tbody)))));

    let gc = { grados: [], cursos: [] };
    const llenarCursos = () => {
        f.curso.replaceChildren(el('option', { value: '', text: 'Seleccionar curso' }),
            ...gc.cursos.filter(x => !f.grado.value || x.gradoId === f.grado.value).map(x => el('option', { value: x.id, text: x.nombre })));
    };
    f.grado.addEventListener('change', llenarCursos);
    const refrescarCupo = async () => {
        try { const info = await cupo(); cupoHost.replaceChildren(tarjetaCupo(info, true)); return info; } catch { return null; }
    };
    let montado = false;
    sec.pagina.addEventListener('edu:mostrar', async () => {
        refrescarCupo();
        if (montado) return;
        montado = true;
        gc = await cargarGradosCursos().catch(() => gc);
        f.grado.replaceChildren(el('option', { value: '', text: 'Seleccionar grado' }), ...gc.grados.map(g => el('option', { value: g.id, text: g.nombre })));
        llenarCursos();
        onSnapshot(query(col('solicitudes_registro'), where('creadoPor', '==', c.uid)), snap => {
            const filas = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.creadoEn?.toMillis?.() || 0) - (a.creadoEn?.toMillis?.() || 0));
            tbody.replaceChildren(...(filas.length ? filas.map((s, i) => {
                const [txt, cls] = ESTADOS[s.estado] || ESTADOS.pendiente;
                return el('tr', {},
                    el('td', { text: String(i + 1) }),
                    el('td', { text: `${s.estudiante?.nombres || ''} ${s.estudiante?.apellidos || ''}`.trim() }),
                    el('td', { text: s.estudiante?.documento || '-' }),
                    el('td', { text: [s.gradoNombre, s.cursoNombre].filter(Boolean).join(' · ') || '-' }),
                    el('td', { text: s.acudiente?.nombre || '-' }),
                    el('td', { text: s.creadoEn?.toDate?.().toLocaleDateString('es-CO') || '' }),
                    el('td', {}, el('span', { class: 'reg-chip ' + cls, text: txt }), s.motivoRechazo ? el('small', { class: 'text-muted', style: 'display:block', text: s.motivoRechazo }) : null));
            }) : [el('tr', {}, el('td', { colspan: '7', class: 'text-center text-muted', text: 'Aún no has registrado estudiantes nuevos.' }))]));
        }, err => tbody.replaceChildren(el('tr', {}, el('td', { colspan: '7', class: 'text-center text-danger', text: 'Error: ' + err.message }))));
    });

    form.addEventListener('submit', async e => {
        e.preventDefault();
        if (btn.disabled) return;
        mensajes.replaceChildren();
        const v = id => f[id].value.trim();
        const documento = v('documento').replace(/\D/g, '');
        const valor = Number(f.valor.value) || 0, abono = Number(f.abono.value) || 0;
        const errores = [];
        if (v('nombres').length < 2 || v('apellidos').length < 2) errores.push('Escribe nombres y apellidos del estudiante.');
        if (!/^\d{5,15}$/.test(documento)) errores.push('El documento del estudiante debe tener entre 5 y 15 números.');
        if (v('acuNombre').length < 3) errores.push('Escribe el nombre del acudiente.');
        if (!/^(3\d{9}|60\d{8}|\d{7})$/.test(v('acuTelefono').replace(/\D/g, ''))) errores.push('Escribe un teléfono válido del acudiente.');
        if (!f.grado.value || !f.curso.value) errores.push('Elige el grado y el curso.');
        if (abono > valor) errores.push(`El pago recibido (${COP.format(abono)}) no puede ser mayor al valor de la matrícula (${COP.format(valor)}).`);
        if (abono > 0 && !f.fechaPago.value) errores.push('Elige la fecha del pago de la matrícula.');
        if (abono > 0 && f.metodo.value !== 'efectivo' && v('referencia').length < 3) errores.push('Escribe la referencia del pago.');
        if (errores.length) { mensajes.replaceChildren(alerta('error', errores.join(' '))); return; }

        btn.disabled = true;
        try {
            // ¿Ya existe este estudiante?
            const yaEst = await getDocs(query(col('estudiantes'), where('documento', '==', documento)));
            if (!yaEst.empty) throw new Error(`Ya hay un estudiante registrado con el documento ${documento}.`);
            const info = await cupo();
            const grado = gc.grados.find(g => g.id === f.grado.value), curso = gc.cursos.find(x => x.id === f.curso.value);
            const ref = doc(col('solicitudes_registro'), 'doc_' + documento);
            const excede = !info.ilimitado && info.actuales + info.pendientes + 1 > info.max;
            await runTransaction(c.db, async tx => {
                const s = await tx.get(ref);
                if (s.exists() && s.data().estado !== 'rechazada') throw new Error(`Ya se registró un estudiante con el documento ${documento} (estado: ${(ESTADOS[s.data().estado] || ESTADOS.pendiente)[0].toLowerCase()}).`);
                tx.set(ref, {
                    colegioId: c.colegioId,
                    estudiante: { nombres: v('nombres'), apellidos: v('apellidos'), tipoDocumento: f.tipoDoc.value, documento, fechaNacimiento: f.nacimiento.value || '', telefono: v('telefono').replace(/\D/g, ''), direccion: v('direccion') },
                    acudiente: { nombre: v('acuNombre'), parentesco: f.parentesco.value, documento: v('acuDocumento').replace(/\D/g, ''), telefono: v('acuTelefono').replace(/\D/g, ''), correoContacto: v('acuCorreo').toLowerCase(), direccion: v('acuDireccion') },
                    gradoId: f.grado.value, gradoNombre: grado?.nombre || '', cursoId: f.curso.value, cursoNombre: curso?.nombre || '',
                    matricula: { valor, abono, metodo: f.metodo.value, referencia: v('referencia'), fecha: abono > 0 ? f.fechaPago.value : '' },
                    estado: 'pendiente', excedeCupo: excede,
                    creadoPor: c.uid, creadoPorNombre: nombreDe(c.perfil), creadoEn: serverTimestamp()
                });
            });
            notificarUsuario({ rol: 'rector' }, '🧑‍🎓 Estudiante nuevo por crear cuenta',
                `${nombreDe(c.perfil)} registró a ${v('nombres')} ${v('apellidos')} (${grado?.nombre || ''} ${curso?.nombre || ''}). Falta asignar el correo y la contraseña en Gestión → Cuentas de acceso.${excede ? ' Atención: el colegio superó el cupo de su plan.' : ''}`,
                'registro').catch(er => console.warn('Aviso a rectoría:', er.message));
            form.reset();
            llenarCursos();
            mensajes.replaceChildren(excede
                ? alerta('error', `⚠️ El colegio ya superó la cantidad de estudiantes de su plan "${info.plan}" (${info.actuales + info.pendientes + 1} de ${info.max}). La información se guardó y se envió a rectoría, pero rectoría no podrá crear las cuentas hasta que se amplíe el plan.`)
                : alerta('ok', '✅ Estudiante registrado y enviado a rectoría para crear el correo y la contraseña.'));
            refrescarCupo();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (er) {
            mensajes.replaceChildren(alerta('error', er.message));
        } finally { btn.disabled = false; }
    });
}

// =====================================================================
// RECTORÍA: asignar correo y contraseña
// =====================================================================
let appSecundaria = null;
function authSecundaria() {
    if (!appSecundaria) {
        const principal = getApps().find(a => a.name === '[DEFAULT]') || getApps()[0];
        appSecundaria = getApps().find(a => a.name === 'secundaria-registros') || initializeApp(principal.options, 'secundaria-registros');
    }
    return getAuth(appSecundaria);
}

async function usuarioPorCorreo(email) {
    const s = await getDocs(query(collection(c.db, 'usuarios'), where('email', '==', email))).catch(() => null);
    return s && !s.empty ? { id: s.docs[0].id, ...s.docs[0].data() } : null;
}

async function crearCuenta(email, password, nombre, rol, extra = {}) {
    const auth = authSecundaria();
    try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await setDoc(doc(c.db, 'usuarios', cred.user.uid), { nombre, email, rol, colegioId: c.colegioId, activo: true, fechaCreacion: serverTimestamp(), ...extra });
        await signOut(auth);
        return cred.user.uid;
    } catch (e) {
        await signOut(auth).catch(() => {});
        if (e.code === 'auth/email-already-in-use') throw new Error(`El correo ${email} ya está registrado en la plataforma.`);
        if (e.code === 'auth/invalid-email') throw new Error(`El correo ${email} no es válido.`);
        if (e.code === 'auth/weak-password') throw new Error('La contraseña debe tener al menos 6 caracteres.');
        throw e;
    }
}

const generarClave = () => {
    const letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ', nums = '23456789';
    const r = new Uint32Array(8); crypto.getRandomValues(r);
    return [...r].map((n, i) => (i < 5 ? letras : nums)[n % (i < 5 ? letras.length : nums.length)]).join('');
};

async function montarRector() {
    const sec = agregarSeccion({ id: 'cuentas', icono: 'fas fa-user-lock', texto: 'Cuentas de acceso', grupo: 'GESTIÓN', titulo: 'Cuentas de acceso de estudiantes nuevos', menu: 'Gestión' });
    if (!sec) return;
    agregarEstilos('eduRegistrosCss', CSS);
    const cupoHost = el('div', {});
    const avisos = el('div', {});
    const buscar = el('input', { type: 'search', class: 'form-control edu-buscar-input', placeholder: 'Buscar por estudiante, documento o acudiente...', maxlength: '60', 'aria-label': 'Buscar' });
    const fEstado = el('select', { class: 'form-control', 'aria-label': 'Estado' },
        ...[['pendiente', 'Pendientes de cuenta'], ['completada', 'Con cuenta creada'], ['rechazada', 'Rechazadas'], ['', 'Todos los estados']].map(([v, t]) => el('option', { value: v, text: t })));
    const fGrado = el('select', { class: 'form-control', 'aria-label': 'Grado' }, el('option', { value: '', text: 'Todos los grados' }));
    const fCurso = el('select', { class: 'form-control', 'aria-label': 'Curso' }, el('option', { value: '', text: 'Todos los cursos' }));
    const tbody = el('tbody', {}, el('tr', {}, el('td', { colspan: '8', class: 'text-center text-muted', text: 'Cargando...' })));
    sec.pagina.append(cupoHost, avisos,
        el('div', { class: 'card', 'data-sin-filtros': '' }, el('div', { class: 'card-body' },
            el('div', { class: 'edu-filtros', 'data-sin-filtros': '' }, el('div', { class: 'edu-buscar' }, el('i', { class: 'fas fa-search' }), buscar), fEstado, fGrado, fCurso),
            el('div', { class: 'table-responsive' }, el('table', { class: 'table-modern' },
                el('thead', {}, el('tr', {}, ...['#', 'Estudiante', 'Curso', 'Acudiente', 'Registró', 'Matrícula', 'Estado', 'Acciones'].map(t => el('th', { text: t })))), tbody)))));
    document.body.append(modalCuentas());

    let solicitudes = [], info = null, gc = { grados: [], cursos: [] };
    const lleno = () => info && !info.ilimitado && info.actuales >= info.max;
    const pintarCupo = () => {
        if (!info) return;
        cupoHost.replaceChildren(tarjetaCupo(info, false));
        avisos.replaceChildren(lleno()
            ? alerta('error', `Se alcanzó el máximo de estudiantes del plan "${info.plan}" (${info.actuales} de ${info.max}). No se pueden crear más cuentas de estudiantes hasta ampliar el plan.`)
            : solicitudes.some(s => s.estado === 'pendiente') ? alerta('aviso', 'Secretaría registró estudiantes nuevos. Asígnales el correo y la contraseña con el botón "Crear cuentas".') : '');
    };
    const pintar = () => {
        const q = norm(buscar.value).split(' ').filter(Boolean);
        const filas = solicitudes.filter(s => {
            if (fEstado.value && s.estado !== fEstado.value && !(fEstado.value === 'pendiente' && s.estado === 'procesando')) return false;
            if (fGrado.value && s.gradoId !== fGrado.value) return false;
            if (fCurso.value && s.cursoId !== fCurso.value) return false;
            const t = norm(`${s.estudiante?.nombres} ${s.estudiante?.apellidos} ${s.estudiante?.documento} ${s.acudiente?.nombre} ${s.acudiente?.telefono}`);
            return q.every(x => t.includes(x));
        });
        tbody.replaceChildren(...(filas.length ? filas.map((s, i) => {
            const [txt, cls] = ESTADOS[s.estado] || ESTADOS.pendiente;
            const crear = el('button', { type: 'button', class: 'btn-primary', style: 'padding:6px 12px;font-size:.8rem', disabled: s.estado !== 'pendiente' || lleno(), title: lleno() ? 'Se alcanzó el máximo de estudiantes del plan' : '' },
                el('i', { class: 'fas fa-key' }), ' Crear cuentas');
            crear.addEventListener('click', () => abrirCuentas(s, info));
            const rechazar = el('button', { type: 'button', class: 'btn-secondary', style: 'padding:6px 10px;font-size:.8rem', disabled: s.estado !== 'pendiente', title: 'Rechazar registro' }, el('i', { class: 'fas fa-ban' }));
            rechazar.addEventListener('click', async () => {
                const motivo = prompt('Motivo del rechazo (lo verá secretaría):', '');
                if (motivo === null) return;
                rechazar.disabled = true;
                try {
                    await runTransaction(c.db, async tx => {
                        const r = doc(col('solicitudes_registro'), s.id);
                        const d = await tx.get(r);
                        if (!d.exists() || d.data().estado !== 'pendiente') throw new Error('Este registro ya fue procesado.');
                        tx.update(r, { estado: 'rechazada', motivoRechazo: motivo.trim().slice(0, 200), procesadoPor: c.uid, procesadoPorNombre: nombreDe(c.perfil), procesadoEn: serverTimestamp() });
                    });
                    if (s.creadoPor) notificarUsuario({ uid: s.creadoPor }, '❌ Registro rechazado', `Rectoría rechazó el registro de ${s.estudiante?.nombres || ''} ${s.estudiante?.apellidos || ''}.${motivo.trim() ? ' Motivo: ' + motivo.trim().slice(0, 200) : ''}`, 'registro').catch(() => {});
                } catch (e) { alert(e.message); rechazar.disabled = false; }
            });
            const m = s.matricula || {};
            return el('tr', {},
                el('td', { text: String(i + 1) }),
                el('td', {}, el('strong', { text: `${s.estudiante?.nombres || ''} ${s.estudiante?.apellidos || ''}`.trim() }),
                    el('small', { class: 'text-muted', style: 'display:block', text: `${s.estudiante?.tipoDocumento || 'Doc.'} ${s.estudiante?.documento || ''}` }),
                    s.estado === 'completada' && s.correoEstudiante ? el('small', { style: 'display:block;color:var(--success,#16a34a)', text: s.correoEstudiante }) : null),
                el('td', { text: [s.gradoNombre, s.cursoNombre].filter(Boolean).join(' · ') || '-' }),
                el('td', {}, el('span', { text: s.acudiente?.nombre || '-' }), el('small', { class: 'text-muted', style: 'display:block', text: [s.acudiente?.parentesco, s.acudiente?.telefono].filter(Boolean).join(' · ') })),
                el('td', {}, el('span', { text: s.creadoPorNombre || '-' }), el('small', { class: 'text-muted', style: 'display:block', text: s.creadoEn?.toDate?.().toLocaleDateString('es-CO') || '' })),
                el('td', { text: m.valor ? `${COP.format(m.valor)}${m.abono ? ' · pagó ' + COP.format(m.abono) : ''}` : '—' }),
                el('td', {}, el('span', { class: 'reg-chip ' + cls, text: txt }), s.excedeCupo && s.estado === 'pendiente' ? el('small', { style: 'display:block;color:#b91c1c', text: 'Excede el plan' }) : null),
                el('td', {}, el('div', { style: 'display:flex;gap:6px' }, crear, rechazar)));
        }) : [el('tr', {}, el('td', { colspan: '8', class: 'text-center text-muted', text: solicitudes.length ? 'No hay registros con ese filtro o búsqueda.' : 'Secretaría aún no ha registrado estudiantes nuevos.' }))]));
    };
    buscar.addEventListener('input', pintar);
    [fEstado, fCurso].forEach(x => x.addEventListener('change', pintar));
    fGrado.addEventListener('change', () => {
        fCurso.replaceChildren(el('option', { value: '', text: 'Todos los cursos' }), ...gc.cursos.filter(x => !fGrado.value || x.gradoId === fGrado.value).map(x => el('option', { value: x.id, text: x.nombre })));
        pintar();
    });

    // Contador en el menú (pendientes) y lista en vivo
    onSnapshot(col('solicitudes_registro'), snap => {
        solicitudes = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.creadoEn?.toMillis?.() || 0) - (a.creadoEn?.toMillis?.() || 0));
        marcarSeccion('cuentas', solicitudes.filter(s => s.estado === 'pendiente').length);
        pintar(); pintarCupo();
    }, err => tbody.replaceChildren(el('tr', {}, el('td', { colspan: '8', class: 'text-center text-danger', text: 'Error: ' + err.message }))));
    sec.pagina.addEventListener('edu:mostrar', async () => {
        info = await cupo().catch(() => info);
        pintarCupo(); pintar();
        if (!gc.grados.length) {
            gc = await cargarGradosCursos().catch(() => gc);
            gc.grados.forEach(g => fGrado.append(el('option', { value: g.id, text: g.nombre })));
            gc.cursos.forEach(x => fCurso.append(el('option', { value: x.id, text: x.nombre })));
        }
    });
    window.__eduCuentasRefrescar = async () => { info = await cupo().catch(() => info); pintarCupo(); pintar(); };
}

// ---------------------------------------------------------------------
// Modal "Crear cuentas"
// ---------------------------------------------------------------------
let solActual = null;
function modalCuentas() {
    const inp = (id, attrs) => el('input', { id, class: 'form-control', autocomplete: 'off', ...attrs });
    const correoEst = inp('ctaCorreoEst', { type: 'email', required: true, maxlength: '120' });
    const passEst = inp('ctaPassEst', { type: 'text', required: true, minlength: '6', maxlength: '40', 'data-validar': 'no' });
    const correoAcu = inp('ctaCorreoAcu', { type: 'email', required: true, maxlength: '120' });
    const passAcu = inp('ctaPassAcu', { type: 'text', minlength: '6', maxlength: '40', 'data-validar': 'no' });
    const notaAcu = el('small', { class: 'text-muted', style: 'display:block;margin-top:4px' });
    const gen = input => el('button', { type: 'button', class: 'btn-secondary', title: 'Generar contraseña', onclick: () => { input.value = generarClave(); } }, el('i', { class: 'fas fa-wand-magic-sparkles' }));
    const mensajes = el('div', {});
    const resumen = el('div', { class: 'reg-alerta aviso', style: 'margin-bottom:12px' });
    const btn = el('button', { type: 'submit', class: 'btn-primary' }, el('i', { class: 'fas fa-key' }), ' Crear cuentas');
    const cerrar = () => { modal.classList.remove('show'); };
    const form = el('form', {},
        el('div', { class: 'modal-body' }, resumen, mensajes,
            el('h3', { class: 'reg-sub' }, el('i', { class: 'fas fa-user-graduate', style: 'color:var(--primary)' }), 'Cuenta del estudiante'),
            el('div', { class: 'form-grid' },
                el('div', { class: 'form-group' }, el('label', { for: 'ctaCorreoEst', text: 'Correo del estudiante *' }), correoEst),
                el('div', { class: 'form-group' }, el('label', { for: 'ctaPassEst', text: 'Contraseña *' }), el('div', { class: 'reg-pass' }, passEst, gen(passEst)))),
            el('h3', { class: 'reg-sub' }, el('i', { class: 'fas fa-user-friends', style: 'color:var(--primary)' }), 'Cuenta del acudiente'),
            el('div', { class: 'form-grid' },
                el('div', { class: 'form-group' }, el('label', { for: 'ctaCorreoAcu', text: 'Correo del acudiente *' }), correoAcu, notaAcu),
                el('div', { class: 'form-group' }, el('label', { for: 'ctaPassAcu', text: 'Contraseña' }), el('div', { class: 'reg-pass' }, passAcu, gen(passAcu))))),
        el('div', { class: 'modal-footer' }, el('button', { type: 'button', class: 'btn-secondary', text: 'Cancelar', onclick: cerrar }), btn));

    let acudienteExistente = null;
    const revisarAcudiente = async () => {
        const email = correoAcu.value.trim().toLowerCase();
        acudienteExistente = null;
        notaAcu.textContent = 'Si el acudiente ya tiene cuenta (por otro hijo), se vincula sin crear una nueva.';
        passAcu.required = true; passAcu.disabled = false;
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) return;
        const u = await usuarioPorCorreo(email);
        if (u && u.rol === 'acudiente' && u.colegioId === c.colegioId) {
            acudienteExistente = u;
            notaAcu.textContent = `✅ ${u.nombre || email} ya tiene cuenta de acudiente: el estudiante se vinculará a esa cuenta.`;
            passAcu.required = false; passAcu.disabled = true; passAcu.value = '';
        } else if (u) {
            notaAcu.textContent = '⚠️ Ese correo ya lo usa otra cuenta que no es de acudiente de este colegio. Usa otro correo.';
        }
    };
    correoAcu.addEventListener('change', revisarAcudiente);

    form.addEventListener('submit', async e => {
        e.preventDefault();
        if (btn.disabled || !solActual) return;
        mensajes.replaceChildren();
        const s = solActual;
        const emailEst = correoEst.value.trim().toLowerCase(), emailAcu = correoAcu.value.trim().toLowerCase();
        if (emailEst === emailAcu) { mensajes.replaceChildren(alerta('error', 'El estudiante y el acudiente deben tener correos diferentes.')); return; }
        if (passEst.value.length < 6 || (!acudienteExistente && passAcu.value.length < 6)) { mensajes.replaceChildren(alerta('error', 'Las contraseñas deben tener al menos 6 caracteres.')); return; }
        btn.disabled = true;
        const refSol = doc(col('solicitudes_registro'), s.id);
        let tomada = false;
        try {
            // 1) Cupo del plan: rectoría no puede crear cuentas por encima del máximo
            const info = await cupo();
            if (!info.ilimitado && info.actuales >= info.max) throw new Error(`Se alcanzó el máximo de estudiantes del plan "${info.plan}" (${info.actuales} de ${info.max}). No se pueden crear más cuentas.`);
            // 2) Tomar la solicitud (una sola vez, aunque haya otra pestaña u otro equipo)
            await runTransaction(c.db, async tx => {
                const d = await tx.get(refSol);
                if (!d.exists()) throw new Error('El registro ya no existe.');
                const est = d.data();
                const vieja = est.estado === 'procesando' && Date.now() - (est.procesandoDesde?.toMillis?.() || 0) > 5 * 60 * 1000;
                if (est.estado !== 'pendiente' && !vieja) throw new Error('Este registro ya está siendo procesado o ya tiene cuenta (otra pestaña u otro usuario).');
                tx.update(refSol, { estado: 'procesando', procesandoPor: c.uid, procesandoDesde: serverTimestamp() });
            });
            tomada = true;
            // 3) Correos disponibles
            const ya = await getDocs(query(col('estudiantes'), where('documento', '==', s.estudiante.documento)));
            if (!ya.empty) throw new Error(`Ya existe un estudiante con el documento ${s.estudiante.documento}.`);
            if (await usuarioPorCorreo(emailEst)) throw new Error(`El correo ${emailEst} ya está registrado. Usa otro.`);
            if (!acudienteExistente && await usuarioPorCorreo(emailAcu)) throw new Error(`El correo del acudiente ${emailAcu} ya está registrado y no es de un acudiente de este colegio.`);
            // 4) Cuentas
            const nombreEst = `${s.estudiante.nombres} ${s.estudiante.apellidos}`.trim();
            const uidAcu = acudienteExistente ? acudienteExistente.id : await crearCuenta(emailAcu, passAcu.value, s.acudiente.nombre, 'acudiente', { telefono: s.acudiente.telefono || '' });
            const uidEst = await crearCuenta(emailEst, passEst.value, nombreEst, 'estudiante', { cursoId: s.cursoId || '' });
            // 5) Estudiante y matrícula
            const estRef = await addDoc(col('estudiantes'), {
                nombres: s.estudiante.nombres, apellidos: s.estudiante.apellidos, tipoDocumento: s.estudiante.tipoDocumento || '',
                documento: s.estudiante.documento, correo: emailEst, fechaNacimiento: s.estudiante.fechaNacimiento || '',
                direccion: s.estudiante.direccion || '', telefono: s.estudiante.telefono || '',
                acudiente: s.acudiente.nombre, acudienteParentesco: s.acudiente.parentesco || '', acudienteDocumento: s.acudiente.documento || '',
                acudienteTelefono: s.acudiente.telefono || '', acudienteEmail: emailAcu, acudienteDireccion: s.acudiente.direccion || '',
                estado: 'activo', gradoId: s.gradoId, gradoNombre: s.gradoNombre || '', cursoId: s.cursoId, cursoNombre: s.cursoNombre || '',
                uid: uidEst, solicitudId: s.id, registradoPor: s.creadoPor || '', fechaRegistro: serverTimestamp()
            });
            await updateDoc(doc(c.db, 'usuarios', uidEst), { estudianteId: estRef.id }).catch(() => {});
            const m = s.matricula || {};
            const valor = Number(m.valor) || 0, abono = Math.min(Number(m.abono) || 0, valor || Infinity);
            const matRef = await addDoc(col('matriculas'), {
                estudianteId: estRef.id, estudianteNombre: nombreEst, gradoId: s.gradoId, cursoId: s.cursoId,
                anio: new Date().getFullYear(), estado: 'activo', valorMatricula: valor, totalAbonado: abono, saldo: Math.max(0, valor - abono),
                estadoPago: valor === 0 ? 'sin-cobro' : abono >= valor ? 'pagado' : abono > 0 ? 'abonado' : 'pendiente', fechaRegistro: serverTimestamp()
            });
            if (abono > 0) {
                const comun = {
                    estudianteId: estRef.id, estudianteNombre: nombreEst, monto: abono, metodo: m.metodo || 'efectivo', referencia: m.referencia || '',
                    fecha: m.fecha || ymd(), creadoPor: s.creadoPor || c.uid, creadoPorNombre: s.creadoPorNombre || nombreDe(c.perfil), rolCreador: 'secretaria', fechaCreacion: serverTimestamp()
                };
                const pago = await addDoc(col('pagos_matriculas'), { ...comun, matriculaId: matRef.id, tipo: 'matricula' });
                await addDoc(col('movimientos'), { ...comun, tipo: 'ingreso', categoria: 'Matrícula', descripcion: `Pago matrícula - ${nombreEst}`, pagoId: pago.id });
            }
            await updateDoc(refSol, {
                estado: 'completada', estudianteId: estRef.id, correoEstudiante: emailEst, correoAcudiente: emailAcu, acudienteVinculado: !!acudienteExistente,
                procesadoPor: c.uid, procesadoPorNombre: nombreDe(c.perfil), procesadoEn: serverTimestamp(), uidEstudiante: uidEst, uidAcudiente: uidAcu
            });
            tomada = false;
            if (s.creadoPor && s.creadoPor !== c.uid) notificarUsuario({ uid: s.creadoPor }, '✅ Cuentas creadas', `Rectoría creó las cuentas de ${nombreEst} y de su acudiente.`, 'registro').catch(() => {});
            const cred = `Estudiante: ${nombreEst}\n  Correo: ${emailEst}\n  Contraseña: ${passEst.value}\n\nAcudiente: ${s.acudiente.nombre}\n  Correo: ${emailAcu}\n  Contraseña: ${acudienteExistente ? '(la que ya tenía)' : passAcu.value}`;
            const copiar = el('button', { type: 'button', class: 'btn-secondary', onclick: () => navigator.clipboard?.writeText(cred) }, el('i', { class: 'fas fa-copy' }), ' Copiar datos');
            mensajes.replaceChildren(alerta('ok', '✅ Cuentas creadas. Entrega estos datos al acudiente (no se volverán a mostrar).'), el('div', { class: 'reg-cred', text: cred }), copiar);
            form.querySelectorAll('input').forEach(i => { i.disabled = true; });
            btn.hidden = true;
            window.__eduCuentasRefrescar?.();
        } catch (er) {
            if (tomada) await updateDoc(refSol, { estado: 'pendiente', ultimoError: String(er.message).slice(0, 200) }).catch(() => {});
            mensajes.replaceChildren(alerta('error', er.message));
        } finally { btn.disabled = false; }
    });

    const modal = el('div', { class: 'modal', id: 'modalCuentasRegistro' },
        el('div', { class: 'modal-overlay', onclick: cerrar }),
        el('div', { class: 'modal-content', style: 'max-width:720px' },
            el('div', { class: 'modal-header' },
                el('h2', {}, el('i', { class: 'fas fa-key', style: 'color:var(--primary)' }), ' Crear cuentas de acceso'),
                el('button', { type: 'button', class: 'modal-close', 'aria-label': 'Cerrar', onclick: cerrar }, '×')),
            form));
    modal._preparar = s => {
        solActual = s;
        acudienteExistente = null;
        mensajes.replaceChildren();
        btn.hidden = false;
        form.querySelectorAll('input').forEach(i => { i.disabled = false; });
        resumen.replaceChildren(el('i', { class: 'fas fa-user-graduate', style: 'margin-top:2px' }), el('span', {},
            el('strong', { text: `${s.estudiante.nombres} ${s.estudiante.apellidos}` }), ` · ${s.estudiante.tipoDocumento || 'Doc.'} ${s.estudiante.documento} · ${[s.gradoNombre, s.cursoNombre].filter(Boolean).join(' · ')}`,
            el('br'), `Acudiente: ${s.acudiente.nombre}${s.acudiente.parentesco ? ' (' + s.acudiente.parentesco + ')' : ''} · Tel. ${s.acudiente.telefono || '-'}`));
        correoEst.value = `${s.estudiante.documento}@eduone.com`;
        passEst.value = generarClave();
        correoAcu.value = s.acudiente.correoContacto || '';
        passAcu.value = generarClave();
        revisarAcudiente();
    };
    return modal;
}

function abrirCuentas(s, info) {
    if (info && !info.ilimitado && info.actuales >= info.max) {
        alert(`Se alcanzó el máximo de estudiantes del plan "${info.plan}" (${info.actuales} de ${info.max}). No se pueden crear más cuentas.`);
        return;
    }
    const modal = document.getElementById('modalCuentasRegistro');
    modal._preparar(s);
    modal.classList.add('show');
}

// =====================================================================
async function montar() {
    c = await obtenerContexto();
    if (!c.colegioId) return;
    if (c.rol === 'secretaria') await montarSecretaria();
    else if (['rector', 'admin_colegio'].includes(c.rol)) await montarRector();
}
const go = () => montar().catch(e => console.warn('EduOne registros:', e.message));
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();

