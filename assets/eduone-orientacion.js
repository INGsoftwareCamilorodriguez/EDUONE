/* =====================================================================
   EduOne - eduone-orientacion.js
   Citas con Orientación escolar (psicología).
   - Funciones compartidas con colegios/orientador.html: horario de
     atención, franjas libres, agendar y cancelar citas.
   - En los demás paneles (coordinadores, profesor, contador, rector,
     secretaría) agrega la sección "Orientación escolar" para ver la
     disponibilidad del orientador(a) y agendar citas personales o, en el
     caso de coordinadores y rector, de seguimiento para un estudiante.
   Se carga con: <script type="module" src="../assets/eduone-orientacion.js"></script>
   ===================================================================== */
import {
    collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
    query, where, onSnapshot, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js';
import { obtenerContexto, notificarFamilia, nombreDe, uidDe, ROL_LABEL, esc } from './eduone-comun.js?v=20261107';
import { el, agregarEstilos, agregarSeccion, marcarSeccion } from './eduone-secciones.js?v=20261107';

// ---------------------------------------------------------------------
// Utilidades de fechas (hora local del colegio)
// ---------------------------------------------------------------------
export const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
export const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
export const aMin = h => { const [a, b] = String(h || '0:0').split(':').map(Number); return a * 60 + (b || 0); };
export const aHora = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const deYmd = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
export const fechaLarga = s => {
    const d = deYmd(s);
    return `${DIAS[d.getDay()]} ${d.getDate()} de ${d.toLocaleDateString('es-CO', { month: 'long' })}`;
};
export const hora12 = h => {
    const m = aMin(h), hh = Math.floor(m / 60), mm = m % 60;
    return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'a. m.' : 'p. m.'}`;
};

export const ESTADOS_CITA = {
    pendiente: { txt: 'Pendiente', color: '#d97706', bg: '#fef3c7' },
    confirmada: { txt: 'Confirmada', color: '#2563eb', bg: '#dbeafe' },
    realizada: { txt: 'Realizada', color: '#16a34a', bg: '#dcfce7' },
    no_asistio: { txt: 'No asistió', color: '#dc2626', bg: '#fee2e2' },
    cancelada: { txt: 'Cancelada', color: '#64748b', bg: '#f1f5f9' }
};
export const ORIGEN_CITA = {
    personal: 'Solicitud personal',
    convivencia: 'Remitido por convivencia',
    academico: 'Remitido por coordinación académica',
    rectoria: 'Remitido por rectoría',
    orientacion: 'Agendada por orientación'
};

export const DISPONIBILIDAD_VACIA = { duracion: 30, bloques: [], noDisponible: [] };

// ---------------------------------------------------------------------
// Datos
// ---------------------------------------------------------------------
export async function listarOrientadores() {
    const c = await obtenerContexto();
    const s = await getDocs(query(collection(c.db, 'usuarios'), where('colegioId', '==', c.colegioId), where('rol', '==', 'orientador')));
    return s.docs.map(d => ({ id: uidDe(d), ...d.data() })).filter(u => u.activo !== false);
}

export async function leerDisponibilidad(orientadorUid) {
    const c = await obtenerContexto();
    const s = await getDoc(doc(c.db, 'colegios', c.colegioId, 'orientacion_disponibilidad', orientadorUid));
    return s.exists() ? { ...DISPONIBILIDAD_VACIA, ...s.data() } : { ...DISPONIBILIDAD_VACIA };
}

export async function guardarDisponibilidad(datos) {
    const c = await obtenerContexto();
    await setDoc(doc(c.db, 'colegios', c.colegioId, 'orientacion_disponibilidad', c.uid), {
        orientadorUid: c.uid, orientadorNombre: nombreDe(c.perfil),
        duracion: Number(datos.duracion) || 30,
        bloques: datos.bloques || [], noDisponible: datos.noDisponible || [],
        actualizadoEn: serverTimestamp()
    });
}

export async function franjasOcupadas(orientadorUid) {
    const c = await obtenerContexto();
    const hoy = ymd(new Date());
    const s = await getDocs(query(collection(c.db, 'colegios', c.colegioId, 'orientacion_agenda'), where('orientadorUid', '==', orientadorUid)));
    return new Set(s.docs.map(d => d.data()).filter(a => a.fecha >= hoy).map(a => `${a.fecha}_${a.hora}`));
}

/** Franjas libres de los próximos `dias` días según el horario de atención. */
export function generarFranjas(disp, ocupadas, dias = 14, desde = new Date()) {
    const dur = Math.max(15, Number(disp.duracion) || 30);
    const libres = new Set(disp.noDisponible || []);
    const ahora = new Date();
    const minimoHoy = ahora.getHours() * 60 + ahora.getMinutes() + 30;
    const out = [];
    for (let i = 0; i < dias; i++) {
        const d = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate() + i);
        const fecha = ymd(d);
        if (libres.has(fecha)) continue;
        const bloques = (disp.bloques || []).filter(b => Number(b.dia) === d.getDay())
            .sort((a, b) => aMin(a.inicio) - aMin(b.inicio));
        for (const b of bloques) {
            for (let t = aMin(b.inicio); t + dur <= aMin(b.fin); t += dur) {
                if (i === 0 && fecha === ymd(ahora) && t < minimoHoy) continue;
                const hora = aHora(t);
                if (ocupadas.has(`${fecha}_${hora}`)) continue;
                out.push({ fecha, hora, fin: aHora(t + dur) });
            }
        }
    }
    return out;
}

/**
 * Agenda una cita. La franja se reserva primero con un id único
 * (orientador_fecha_hora): si alguien la tomó antes, falla sin duplicar.
 */
export async function agendarCita({ orientador, franja, motivo, modalidad = 'presencial', tipo = 'personal', origen = 'personal', estudiante = null, participante = null }) {
    const c = await obtenerContexto();
    const base = ['colegios', c.colegioId];
    const franjaId = `${orientador.id}_${franja.fecha}_${franja.hora}`;
    const agendaRef = doc(c.db, ...base, 'orientacion_agenda', franjaId);
    try {
        await setDoc(agendaRef, {
            orientadorUid: orientador.id, fecha: franja.fecha, hora: franja.hora, fin: franja.fin,
            solicitanteUid: c.uid, creadoEn: serverTimestamp()
        });
    } catch (e) {
        throw new Error('Esa franja acaba de ser ocupada. Elige otra hora.');
    }
    let citaRef;
    try {
        citaRef = await addDoc(collection(c.db, ...base, 'orientacion_citas'), {
            colegioId: c.colegioId,
            orientadorUid: orientador.id, orientadorNombre: nombreDe(orientador),
            fecha: franja.fecha, hora: franja.hora, fin: franja.fin, franjaId,
            motivo: String(motivo).trim().slice(0, 600), modalidad, tipo, origen,
            estudianteId: estudiante?.id || null,
            estudianteNombre: estudiante ? (estudiante.nombreCompleto || nombreDe(estudiante)) : null,
            cursoNombre: estudiante?.cursoNombre || null,
            participanteUid: participante?.id || null,
            participanteNombre: participante ? nombreDe(participante) : null,
            participanteRol: participante?.rol || null,
            participantesUid: participante?.id ? [participante.id] : [],
            solicitanteUid: c.uid, solicitanteNombre: nombreDe(c.perfil), solicitanteRol: c.rol,
            estado: 'pendiente', creadoEn: serverTimestamp()
        });
    } catch (e) {
        await deleteDoc(agendaRef).catch(() => { });
        throw e;
    }
    if (estudiante?.id) {
        await notificarFamilia(estudiante.id, '🧠 Cita con Orientación escolar',
            `Se agendó una cita de orientación para ${estudiante.nombreCompleto || nombreDe(estudiante)} el ${fechaLarga(franja.fecha)} a las ${hora12(franja.hora)} (${modalidad}). Motivo: ${String(motivo).trim().slice(0, 200)}`,
            'orientacion', { citaId: citaRef.id }).catch(e => console.warn('Aviso a la familia:', e.message));
    }
    return citaRef.id;
}

/** Cambia el estado de una cita; si se cancela, libera la franja. */
export async function cambiarEstadoCita(cita, estado) {
    const c = await obtenerContexto();
    const base = ['colegios', c.colegioId];
    const cambios = { estado, actualizadoEn: serverTimestamp() };
    if (estado === 'cancelada') cambios.canceladoPor = nombreDe(c.perfil);
    await updateDoc(doc(c.db, ...base, 'orientacion_citas', cita.id), cambios);
    if (estado === 'cancelada' && cita.franjaId) {
        await deleteDoc(doc(c.db, ...base, 'orientacion_agenda', cita.franjaId)).catch(e => console.warn('Franja:', e.message));
    }
    if (cita.estudianteId && ['confirmada', 'cancelada'].includes(estado)) {
        await notificarFamilia(cita.estudianteId,
            estado === 'confirmada' ? '✅ Cita de orientación confirmada' : '❌ Cita de orientación cancelada',
            `La cita de orientación del ${fechaLarga(cita.fecha)} a las ${hora12(cita.hora)} fue ${estado}.`,
            'orientacion', { citaId: cita.id }).catch(() => { });
    }
}

export async function listarEstudiantes() {
    const c = await obtenerContexto();
    const [est, cursos] = await Promise.all([
        getDocs(collection(c.db, 'colegios', c.colegioId, 'estudiantes')),
        getDocs(collection(c.db, 'colegios', c.colegioId, 'cursos'))
    ]);
    const nombreCurso = new Map(cursos.docs.map(d => [d.id, d.data().nombre || '']));
    return est.docs.map(d => {
        const e = d.data();
        return { id: d.id, ...e, nombreCompleto: `${e.nombres || ''} ${e.apellidos || ''}`.trim() || 'Estudiante', cursoNombre: nombreCurso.get(e.cursoId) || '' };
    }).filter(e => (e.estado || 'activo') === 'activo')
        .sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto, 'es'));
}

// ---------------------------------------------------------------------
// Componentes de interfaz reutilizables
// ---------------------------------------------------------------------
export const CSS_ORIENTACION = `
.edu-or-grid{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:18px;align-items:start}
.edu-or-dias{display:flex;flex-direction:column;gap:12px;max-height:420px;overflow-y:auto;padding-right:4px}
.edu-or-dia h5{font-size:.82rem;font-weight:600;margin:0 0 6px;color:var(--text-primary,#0f172a)}
.edu-or-franjas{display:flex;flex-wrap:wrap;gap:6px}
.edu-or-franja{border:1px solid var(--border,#e2e8f0);background:#fff;border-radius:999px;padding:6px 12px;font:inherit;font-size:.8rem;cursor:pointer;color:inherit}
.edu-or-franja:hover{border-color:var(--primary,#2563eb)}
.edu-or-franja.sel{background:var(--primary,#2563eb);border-color:var(--primary,#2563eb);color:#fff}
.edu-or-vacio{color:var(--text-secondary,#64748b);font-size:.88rem;padding:16px;text-align:center;background:var(--bg,#f8fafc);border-radius:12px}
.edu-or-chip{display:inline-block;padding:3px 10px;border-radius:999px;font-size:.74rem;font-weight:600}
.edu-or-lista{display:flex;flex-direction:column;gap:10px}
.edu-or-cita{border:1px solid var(--border,#e2e8f0);border-radius:14px;padding:12px 14px;display:flex;gap:12px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;background:#fff}
.edu-or-cita strong{display:block;font-size:.9rem}
.edu-or-cita small{display:block;color:var(--text-secondary,#64748b);font-size:.78rem;margin-top:2px}
.edu-or-sel-resumen{margin-top:10px;font-size:.85rem;padding:10px 12px;border-radius:10px;background:var(--primary-bg,#eff6ff)}
.edu-or-buscador{position:relative}
.edu-or-sugerencias{position:absolute;left:0;right:0;top:100%;z-index:30;background:#fff;border:1px solid var(--border,#e2e8f0);border-radius:12px;box-shadow:0 10px 30px rgba(15,23,42,.12);max-height:240px;overflow-y:auto;margin-top:4px}
.edu-or-sugerencias button{display:block;width:100%;text-align:left;border:0;background:transparent;padding:9px 12px;font:inherit;font-size:.85rem;cursor:pointer;color:inherit}
.edu-or-sugerencias button:hover{background:var(--primary-bg,#eff6ff)}
.edu-or-error{color:#dc2626;font-size:.8rem;margin-top:4px;display:block}
.edu-or-radios{display:flex;gap:10px;flex-wrap:wrap}
.edu-or-radios label{display:flex;align-items:center;gap:6px;border:1px solid var(--border,#e2e8f0);border-radius:10px;padding:8px 12px;cursor:pointer;font-size:.85rem}
.edu-or-radios input{accent-color:var(--primary,#2563eb)}
@media (max-width:900px){.edu-or-grid{grid-template-columns:1fr}}
@media (max-width:520px){.edu-or-cita{flex-direction:column}.edu-or-cita .acciones{width:100%}.edu-or-cita .acciones button{width:100%}}
`;

/** Selector de franjas libres agrupadas por día. onSelect(franja|null) */
export function selectorFranjas(contenedor, franjas, onSelect) {
    contenedor.replaceChildren();
    if (!franjas.length) {
        contenedor.append(el('div', { class: 'edu-or-vacio', text: 'No hay horarios disponibles en las próximas dos semanas.' }));
        onSelect(null);
        return;
    }
    const porDia = new Map();
    franjas.forEach(f => { if (!porDia.has(f.fecha)) porDia.set(f.fecha, []); porDia.get(f.fecha).push(f); });
    const lista = el('div', { class: 'edu-or-dias', role: 'listbox', 'aria-label': 'Horarios disponibles' });
    for (const [fecha, fs] of porDia) {
        const fila = el('div', { class: 'edu-or-franjas' });
        fs.forEach(f => fila.append(el('button', {
            type: 'button', class: 'edu-or-franja', role: 'option', 'aria-selected': 'false', text: hora12(f.hora),
            onclick: (e) => {
                lista.querySelectorAll('.edu-or-franja').forEach(b => { b.classList.remove('sel'); b.setAttribute('aria-selected', 'false'); });
                e.currentTarget.classList.add('sel'); e.currentTarget.setAttribute('aria-selected', 'true');
                onSelect(f);
            }
        })));
        lista.append(el('div', { class: 'edu-or-dia' }, el('h5', { text: fechaLarga(fecha) }), fila));
    }
    contenedor.append(lista);
    onSelect(null);
}

/** Campo de búsqueda con sugerencias. items: [{id, texto, sub}] */
export function buscadorConSugerencias(input, obtenerItems, onElegir) {
    const caja = el('div', { class: 'edu-or-sugerencias', hidden: true });
    input.parentElement.classList.add('edu-or-buscador');
    input.after(caja);
    input.setAttribute('autocomplete', 'off');
    const pintar = () => {
        const f = input.value.trim().toLocaleLowerCase('es');
        if (f.length < 2) { caja.hidden = true; return; }
        const res = obtenerItems().filter(i => `${i.texto} ${i.sub || ''}`.toLocaleLowerCase('es').includes(f)).slice(0, 25);
        caja.replaceChildren(...res.map(i => el('button', {
            type: 'button', onclick: () => { input.value = i.texto; caja.hidden = true; onElegir(i); }
        }, el('strong', { text: i.texto }), i.sub ? el('small', { text: ' · ' + i.sub, style: 'color:var(--text-secondary,#64748b)' }) : null)));
        if (!res.length) caja.append(el('div', { class: 'edu-or-vacio', text: 'Sin resultados' }));
        caja.hidden = false;
    };
    input.addEventListener('input', () => { onElegir(null); pintar(); });
    input.addEventListener('focus', pintar);
    document.addEventListener('pointerdown', e => { if (!caja.contains(e.target) && e.target !== input) caja.hidden = true; });
}

export function chipEstado(estado) {
    const e = ESTADOS_CITA[estado] || ESTADOS_CITA.pendiente;
    return el('span', { class: 'edu-or-chip', text: e.txt, style: `color:${e.color};background:${e.bg}` });
}

// ---------------------------------------------------------------------
// Sección "Orientación escolar" para los demás roles
// ---------------------------------------------------------------------
const ROLES_AGENDAN = ['profesor', 'coord_academico', 'coord_convivencia', 'contador', 'rector', 'admin_colegio', 'admin_auxiliar', 'secretaria', 'estudiante'];
const ROLES_REMITEN_ESTUDIANTE = { coord_academico: 'academico', coord_convivencia: 'convivencia', rector: 'rectoria', admin_colegio: 'rectoria' };

async function montarSeccionAgendar() {
    const c = await obtenerContexto();
    if (!ROLES_AGENDAN.includes(c.rol) || !c.colegioId) return;
    const seccion = agregarSeccion({ id: 'orientacion', icono: 'fas fa-brain', texto: 'Orientación escolar', grupo: 'COMUNICACIÓN', titulo: 'Citas con Orientación escolar', principal: true });
    if (!seccion) return;
    agregarEstilos('eduOrientacionCss', CSS_ORIENTACION);
    const puedeRemitir = !!ROLES_REMITEN_ESTUDIANTE[c.rol];

    const selOrientador = el('select', { class: 'form-control', id: 'orAgOrientador', required: true, 'aria-label': 'Orientador(a)' });
    const radiosPara = el('div', { class: 'edu-or-radios' },
        el('label', {}, el('input', { type: 'radio', name: 'orAgPara', value: 'personal', checked: true }), 'Para mí (cita personal)'),
        puedeRemitir ? el('label', {}, el('input', { type: 'radio', name: 'orAgPara', value: 'estudiante' }), 'Para un estudiante (seguimiento)') : null);
    const inpEst = el('input', { type: 'text', class: 'form-control', id: 'orAgEstudiante', placeholder: 'Escribe al menos 2 letras del nombre...', maxlength: '80' });
    const grupoEst = el('div', { class: 'form-group', hidden: true }, el('label', { for: 'orAgEstudiante', text: 'Estudiante *' }), el('div', {}, inpEst), el('span', { class: 'edu-or-error', id: 'orAgEstErr', hidden: true }));
    const franjasHost = el('div', { id: 'orAgFranjas' }, el('div', { class: 'edu-or-vacio', text: 'Cargando disponibilidad...' }));
    const resumen = el('div', { class: 'edu-or-sel-resumen', hidden: true });
    const selModalidad = el('select', { class: 'form-control', id: 'orAgModalidad' },
        el('option', { value: 'presencial', text: 'Presencial' }), el('option', { value: 'virtual', text: 'Virtual' }));
    const txtMotivo = el('textarea', { class: 'form-control', id: 'orAgMotivo', rows: '3', required: true, minlength: '10', maxlength: '600', placeholder: 'Cuéntale brevemente al orientador(a) el motivo de la cita' });
    const errMotivo = el('span', { class: 'edu-or-error', hidden: true });
    const alerta = el('div', { class: 'alert', style: 'display:none' });
    const btn = el('button', { type: 'submit', class: 'btn-primary' }, el('i', { class: 'fas fa-calendar-plus' }), ' Agendar cita');
    const form = el('form', { novalidate: true },
        alerta,
        el('div', { class: 'form-group' }, el('label', { for: 'orAgOrientador', text: 'Orientador(a) *' }), selOrientador),
        el('div', { class: 'form-group' }, el('label', { text: '¿Para quién es la cita?' }), radiosPara),
        grupoEst,
        el('div', { class: 'form-group' }, el('label', { text: 'Horario disponible *' }), franjasHost, resumen),
        el('div', { class: 'form-group' }, el('label', { for: 'orAgModalidad', text: 'Modalidad' }), selModalidad),
        el('div', { class: 'form-group' }, el('label', { for: 'orAgMotivo', text: 'Motivo *' }), txtMotivo, errMotivo),
        el('div', { style: 'display:flex;justify-content:flex-end' }, btn));

    const misCitas = el('div', { class: 'edu-or-lista' }, el('div', { class: 'edu-or-vacio', text: 'Cargando...' }));
    seccion.pagina.append(el('div', { class: 'edu-or-grid' },
        el('div', { class: 'card' }, el('div', { class: 'card-header' }, el('h2', {}, el('i', { class: 'fas fa-calendar-plus', style: 'color:var(--primary)' }), ' Agendar cita')), el('div', { class: 'card-body' }, form)),
        el('div', { class: 'card' }, el('div', { class: 'card-header' }, el('h2', {}, el('i', { class: 'fas fa-list', style: 'color:var(--primary)' }), ' Citas que he agendado')), el('div', { class: 'card-body' }, misCitas))));

    let orientadores = [], franjaSel = null, estudianteSel = null, estudiantes = null;
    const mostrarAlerta = (txt, ok) => { alerta.className = 'alert ' + (ok ? 'alert-success' : 'alert-error') + ' show'; alerta.textContent = txt; alerta.style.display = 'flex'; };

    async function cargarFranjas() {
        franjaSel = null; resumen.hidden = true;
        const o = orientadores.find(x => x.id === selOrientador.value);
        if (!o) { franjasHost.replaceChildren(el('div', { class: 'edu-or-vacio', text: 'El colegio aún no tiene orientador(a) registrado.' })); return; }
        franjasHost.replaceChildren(el('div', { class: 'edu-or-vacio', text: 'Cargando disponibilidad...' }));
        try {
            const [disp, ocupadas] = await Promise.all([leerDisponibilidad(o.id), franjasOcupadas(o.id)]);
            if (!disp.bloques.length) { franjasHost.replaceChildren(el('div', { class: 'edu-or-vacio', text: `${nombreDe(o)} todavía no ha publicado su horario de atención.` })); return; }
            selectorFranjas(franjasHost, generarFranjas(disp, ocupadas), f => {
                franjaSel = f;
                resumen.hidden = !f;
                if (f) resumen.textContent = `Seleccionaste: ${fechaLarga(f.fecha)}, de ${hora12(f.hora)} a ${hora12(f.fin)}`;
            });
        } catch (e) {
            franjasHost.replaceChildren(el('div', { class: 'edu-or-vacio', text: 'No se pudo cargar la disponibilidad: ' + e.message }));
        }
    }

    radiosPara.addEventListener('change', async () => {
        const paraEst = form.querySelector('input[name="orAgPara"]:checked')?.value === 'estudiante';
        grupoEst.hidden = !paraEst;
        if (paraEst && !estudiantes) {
            inpEst.placeholder = 'Cargando estudiantes...';
            try { estudiantes = await listarEstudiantes(); inpEst.placeholder = 'Escribe al menos 2 letras del nombre...'; }
            catch (e) { inpEst.placeholder = 'No se pudieron cargar los estudiantes'; }
        }
    });
    buscadorConSugerencias(inpEst,
        () => (estudiantes || []).map(e => ({ id: e.id, texto: e.nombreCompleto, sub: e.cursoNombre, e })),
        i => { estudianteSel = i?.e || null; document.getElementById('orAgEstErr').hidden = true; });
    selOrientador.addEventListener('change', cargarFranjas);

    form.addEventListener('submit', async e => {
        e.preventDefault();
        alerta.style.display = 'none';
        const paraEst = form.querySelector('input[name="orAgPara"]:checked')?.value === 'estudiante';
        const motivo = txtMotivo.value.trim();
        let ok = true;
        errMotivo.hidden = motivo.length >= 10;
        if (motivo.length < 10) { errMotivo.textContent = 'Escribe un motivo de al menos 10 caracteres.'; ok = false; }
        if (paraEst && !estudianteSel) { const er = document.getElementById('orAgEstErr'); er.textContent = 'Elige un estudiante de la lista.'; er.hidden = false; ok = false; }
        if (!franjaSel) { mostrarAlerta('Elige un horario disponible.'); ok = false; }
        if (!ok) return;
        const o = orientadores.find(x => x.id === selOrientador.value);
        btn.disabled = true;
        try {
            await agendarCita({
                orientador: o, franja: franjaSel, motivo, modalidad: selModalidad.value,
                tipo: paraEst ? 'estudiante' : 'personal',
                origen: paraEst ? ROLES_REMITEN_ESTUDIANTE[c.rol] : 'personal',
                estudiante: paraEst ? estudianteSel : null
            });
            mostrarAlerta(paraEst ? '✅ Cita agendada. Se avisó al estudiante y a su acudiente.' : '✅ Cita agendada. El orientador(a) la verá en su agenda.', true);
            form.reset(); grupoEst.hidden = true; estudianteSel = null;
            selOrientador.value = o.id;
            await cargarFranjas();
        } catch (err) {
            mostrarAlerta('❌ ' + err.message);
            if (/ocupada/.test(err.message)) cargarFranjas();
        } finally { btn.disabled = false; }
    });

    // Citas que agendé (en tiempo real)
    onSnapshot(query(collection(c.db, 'colegios', c.colegioId, 'orientacion_citas'), where('solicitanteUid', '==', c.uid)), snap => {
        const hoy = ymd(new Date());
        const citas = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => `${b.fecha}${b.hora}`.localeCompare(`${a.fecha}${a.hora}`));
        misCitas.replaceChildren();
        if (!citas.length) { misCitas.append(el('div', { class: 'edu-or-vacio', text: 'Aún no has agendado citas.' })); }
        let proximas = 0;
        for (const ci of citas) {
            const futura = ci.fecha >= hoy && ['pendiente', 'confirmada'].includes(ci.estado);
            if (futura) proximas++;
            misCitas.append(el('div', { class: 'edu-or-cita' },
                el('div', {},
                    el('strong', { text: `${fechaLarga(ci.fecha)} · ${hora12(ci.hora)}` }),
                    el('small', { text: ci.estudianteNombre ? `Estudiante: ${ci.estudianteNombre}${ci.cursoNombre ? ' (' + ci.cursoNombre + ')' : ''}` : 'Cita personal' }),
                    el('small', { text: `Con ${ci.orientadorNombre || 'Orientación'} · ${ci.modalidad || 'presencial'}` })),
                el('div', { class: 'acciones', style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, chipEstado(ci.estado),
                    futura ? el('button', {
                        type: 'button', class: 'btn-secondary', text: 'Cancelar',
                        onclick: async () => {
                            if (!confirm('¿Cancelar esta cita?')) return;
                            try { await cambiarEstadoCita(ci, 'cancelada'); cargarFranjas(); } catch (err) { alert('No se pudo cancelar: ' + err.message); }
                        }
                    }) : null)));
        }
        marcarSeccion('orientacion', 0);
    }, err => misCitas.replaceChildren(el('div', { class: 'edu-or-vacio', text: 'No se pudieron cargar tus citas: ' + err.message })));

    try {
        orientadores = await listarOrientadores();
        selOrientador.replaceChildren(...orientadores.map(o => el('option', { value: o.id, text: nombreDe(o) })));
        if (!orientadores.length) selOrientador.append(el('option', { value: '', text: 'Sin orientador(a) registrado' }));
    } catch (e) {
        selOrientador.replaceChildren(el('option', { value: '', text: 'No se pudo cargar' }));
    }
    // La disponibilidad se carga al abrir la sección (y se refresca cada vez)
    seccion.pagina.addEventListener('edu:mostrar', cargarFranjas);
}

// Solo en paneles que cargan este archivo con <script> (no en orientador.html,
// que importa las funciones y tiene su propia interfaz).
if (!document.documentElement.dataset.eduOrientador) {
    const go = () => montarSeccionAgendar().catch(e => console.warn('EduOne orientación:', e.message));
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
}
