/* =====================================================================
   EduOne - eduone-campana.js  (bandeja de notificaciones en todos los roles)
   - Paneles que no tenían campana (rector, secretaría, coordinadores,
     orientación, contador): se agrega la campana con su bandeja.
     Muestra los avisos dirigidos a la persona (destinatarioUid) o a su
     rol (destinatarioRol), en vivo. Al abrir un aviso o "Marcar todo como
     leído", el contador baja y el aviso queda leído.
   - Paneles que ya la tenían (estudiante, acudiente, profesor): se oculta
     el número rojo cuando no hay avisos sin leer.
   Los avisos se crean con notificarUsuario() de eduone-comun.js.
   Lo importa eduone-ui.js en los paneles de colegio.
   ===================================================================== */
import {
    collection, doc, query, where, onSnapshot, updateDoc, arrayUnion
} from 'https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js';
import { obtenerContexto } from './eduone-comun.js?v=20261108';

const CSS = `
.edu-campana-wrap{position:relative;display:flex;align-items:center}
.edu-campana{position:relative;display:grid;place-items:center;width:42px;height:42px;border:1px solid var(--border,#e2e8f0);border-radius:12px;background:#fff;color:#33415f;cursor:pointer;font-size:1.05rem}
.edu-campana:hover,.edu-campana[aria-expanded="true"]{background:var(--primary-bg,#eff6ff);color:var(--primary,#2563eb)}
.edu-campana-num{position:absolute;top:-6px;right:-6px;min-width:19px;height:19px;padding:0 5px;border-radius:10px;background:#dc2626;color:#fff;font:700 .68rem/19px Inter,system-ui,sans-serif;text-align:center}
.edu-campana-num[hidden],.badge-noti.edu-cero{display:none!important}
.edu-bandeja{position:absolute;top:calc(100% + 10px);right:0;z-index:300;width:min(380px,92vw);max-height:min(520px,75vh);display:flex;flex-direction:column;background:#fff;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 18px 45px rgba(15,23,42,.18);overflow:hidden}
.edu-bandeja[hidden]{display:none}
.edu-bandeja-cab{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid #eef2f7}
.edu-bandeja-cab strong{font-size:.95rem;color:#0f172a}
.edu-bandeja-cab button{border:0;background:none;color:var(--primary,#2563eb);font:600 .78rem Inter,system-ui,sans-serif;cursor:pointer}
.edu-bandeja-lista{overflow-y:auto}
.edu-aviso{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid #f1f5f9;background:#fff;padding:12px 16px;cursor:pointer;font-family:Inter,system-ui,sans-serif}
.edu-aviso:hover{background:#f8fafc}
.edu-aviso.nuevo{background:#eff6ff}
.edu-aviso strong{display:flex;gap:8px;align-items:center;font-size:.86rem;color:#0f172a}
.edu-aviso.nuevo strong::before{content:'';width:8px;height:8px;border-radius:50%;background:var(--primary,#2563eb);flex:none}
.edu-aviso span{display:block;font-size:.8rem;color:#475569;margin-top:4px;line-height:1.4}
.edu-aviso small{display:block;font-size:.7rem;color:#94a3b8;margin-top:5px}
.edu-bandeja-vacia{padding:28px 16px;text-align:center;color:#94a3b8;font-size:.86rem}
`;

const fechaTexto = t => {
    const d = t?.toDate?.();
    if (!d) return '';
    const min = Math.round((Date.now() - d) / 60000);
    if (min < 1) return 'Ahora';
    if (min < 60) return `Hace ${min} min`;
    if (min < 1440) return `Hace ${Math.round(min / 60)} h`;
    return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
};

// Campanas que ya existían: sin número cuando está en cero
function ocultarCeros() {
    document.querySelectorAll('.badge-noti').forEach(b => {
        const ajustar = () => b.classList.toggle('edu-cero', !Number(b.textContent.trim()));
        ajustar();
        new MutationObserver(ajustar).observe(b, { childList: true, characterData: true, subtree: true });
    });
}

async function montar() {
    if (document.getElementById('notificacionesBtn')) { ocultarCeros(); return; }
    const destino = document.querySelector('.top-header .header-right, .top-header .edu-user');
    if (!destino || document.getElementById('eduCampana')) return;
    const c = await obtenerContexto();
    if (!c.colegioId) return;

    const estilo = document.createElement('style');
    estilo.textContent = CSS;
    document.head.append(estilo);

    const wrap = document.createElement('div');
    wrap.className = 'edu-campana-wrap';
    wrap.innerHTML = `<button type="button" class="edu-campana" id="eduCampana" aria-label="Notificaciones" aria-expanded="false" aria-haspopup="true" title="Notificaciones">
        <i class="fas fa-bell"></i><span class="edu-campana-num" hidden>0</span></button>
      <div class="edu-bandeja" id="eduBandeja" hidden role="dialog" aria-label="Notificaciones">
        <div class="edu-bandeja-cab"><strong>Notificaciones</strong><button type="button" id="eduBandejaTodo">Marcar todo como leído</button></div>
        <div class="edu-bandeja-lista"><div class="edu-bandeja-vacia">Cargando...</div></div>
      </div>`;
    const usuario = destino.querySelector('.user-info, .edu-user-name');
    if (usuario) usuario.before(wrap); else destino.prepend(wrap);
    // El botón "Activar notificaciones" (avisos al celular) va junto a la campana
    const push = document.getElementById('eduPushBtn');
    if (push) wrap.after(push);

    const boton = wrap.querySelector('#eduCampana');
    const numero = wrap.querySelector('.edu-campana-num');
    const bandeja = wrap.querySelector('#eduBandeja');
    const lista = wrap.querySelector('.edu-bandeja-lista');

    const porConsulta = { uid: [], rol: [] };
    let avisos = [];
    let primeraCarga = true;
    const sinLeer = n => !(n.leidoPor || []).includes(c.uid) && !(n.destinatarioUid === c.uid && n.leida);

    const marcarLeido = n => {
        const cambios = { leidoPor: arrayUnion(c.uid) };
        if (n.destinatarioUid === c.uid) cambios.leida = true;
        return updateDoc(doc(c.db, 'colegios', c.colegioId, 'notificaciones', n.id), cambios).catch(e => console.warn('Notificación:', e.message));
    };

    const pintar = () => {
        const antes = new Set(avisos.filter(sinLeer).map(n => n.id));
        const mapa = new Map([...porConsulta.uid, ...porConsulta.rol].map(n => [n.id, n]));
        avisos = [...mapa.values()].sort((a, b) => (b.fecha?.toMillis?.() || 0) - (a.fecha?.toMillis?.() || 0)).slice(0, 40);
        const nuevos = avisos.filter(sinLeer);
        numero.hidden = !nuevos.length;
        numero.textContent = nuevos.length > 9 ? '9+' : String(nuevos.length);
        if (!primeraCarga) {
            const llegado = nuevos.find(n => !antes.has(n.id));
            if (llegado) {
                boton.animate?.([{ transform: 'rotate(0)' }, { transform: 'rotate(-15deg)' }, { transform: 'rotate(15deg)' }, { transform: 'rotate(0)' }], { duration: 500 });
            }
        }
        lista.replaceChildren();
        if (!avisos.length) {
            lista.innerHTML = '<div class="edu-bandeja-vacia"><i class="fas fa-bell-slash"></i><br>No tienes notificaciones</div>';
            return;
        }
        for (const n of avisos) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'edu-aviso' + (sinLeer(n) ? ' nuevo' : '');
            const t = document.createElement('strong'); t.textContent = n.titulo || 'Aviso';
            const m = document.createElement('span'); m.textContent = n.mensaje || '';
            const f = document.createElement('small'); f.textContent = [fechaTexto(n.fecha), n.remitenteNombre].filter(Boolean).join(' · ');
            item.append(t, m, f);
            item.addEventListener('click', () => { if (sinLeer(n)) marcarLeido(n); });
            lista.append(item);
        }
    };

    const escuchar = (clave, campo, valor) => onSnapshot(
        query(collection(c.db, 'colegios', c.colegioId, 'notificaciones'), where(campo, '==', valor)),
        snap => { porConsulta[clave] = snap.docs.map(d => ({ id: d.id, ...d.data() })); pintar(); primeraCarga = false; },
        err => { console.warn('Notificaciones:', err.message); porConsulta[clave] = []; pintar(); });
    escuchar('uid', 'destinatarioUid', c.uid);
    if (c.rol) escuchar('rol', 'destinatarioRol', c.rol);

    const cerrar = () => { bandeja.hidden = true; boton.setAttribute('aria-expanded', 'false'); };
    boton.addEventListener('click', e => {
        e.stopPropagation();
        bandeja.hidden = !bandeja.hidden;
        boton.setAttribute('aria-expanded', String(!bandeja.hidden));
    });
    wrap.querySelector('#eduBandejaTodo').addEventListener('click', () => { avisos.filter(sinLeer).forEach(marcarLeido); });
    document.addEventListener('pointerdown', e => { if (!wrap.contains(e.target)) cerrar(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrar(); });
}

const go = () => montar().catch(e => console.warn('EduOne campana:', e.message));
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
