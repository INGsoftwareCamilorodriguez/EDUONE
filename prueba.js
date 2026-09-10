<script type="module">
        // =============================================
        // FIREBASE CONFIG
        // =============================================
        import { initializeApp } from "firebase/app";
        import { getAuth, onAuthStateChanged, signOut, updatePassword } from "firebase/auth";
        import {
            getFirestore,
            doc, getDoc, collection, getDocs, addDoc, updateDoc, deleteDoc,
            query, where, serverTimestamp, setDoc, orderBy
        } from "firebase/firestore";
        import { getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject } from "firebase/storage";

        const firebaseConfig = {
            apiKey: "AIzaSyA3U98y5BJWQwpypFCAyNioqSRfXkr9UA0",
            authDomain: "eduone-5f7cf.firebaseapp.com",
            projectId: "eduone-5f7cf",
            storageBucket: "eduone-5f7cf.firebasestorage.app",
            messagingSenderId: "541282614006",
            appId: "1:541282614006:web:f8cf617c99f08403df0ad7",
            measurementId: "G-Y2P0EMNYCL"
        };

        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const db = getFirestore(app);
        const storage = getStorage(app);

        // =============================================
        // VARIABLES GLOBALES
        // =============================================
        let colegioId = null;
        let estudianteId = null;
        let usuarioActual = null;
        let cursoActualId = null;
        let isLoggingOut = false;
        let archivosSubidos = [];
        let notificacionActualId = null;
        let evalTimerInterval = null;
        let evalTiempoRestante = 0;
        let evalRespuestas = {};
        let evalDataActual = null;
        let evalPreguntasActuales = [];

        // =============================================
        // REFERENCIAS DOM
        // =============================================
        const loadingState = document.getElementById('loadingState');
        const userNameEl = document.getElementById('userName');
        const userRoleEl = document.getElementById('userRole');
        const colegioNombreSidebar = document.getElementById('colegioNombreSidebar');
        const logoutBtn = document.getElementById('logoutBtn');

        // =============================================
        // TOAST NOTIFICATIONS
        // =============================================
        function showToast(message, type = 'success', duration = 4000) {
            const container = document.getElementById('toastContainer');
            if (!container) {
                alert(message);
                return;
            }
            
            const icons = {
                success: 'fas fa-check-circle',
                error: 'fas fa-times-circle',
                warning: 'fas fa-exclamation-triangle',
                info: 'fas fa-info-circle'
            };

            const toast = document.createElement('div');
            toast.className = `toast ${type}`;
            toast.innerHTML = `
                <i class="${icons[type] || icons.info}"></i>
                <span>${message}</span>
                <button class="close-toast">&times;</button>
            `;

            toast.querySelector('.close-toast').addEventListener('click', () => {
                toast.remove();
            });

            container.appendChild(toast);

            setTimeout(() => {
                if (toast.parentNode) toast.remove();
            }, duration);
        }

        // =============================================
        // SIDEBAR
        // =============================================
        const sidebar = document.getElementById('sidebar');
        const sidebarOverlay = document.getElementById('sidebarOverlay');
        const hamburgerBtn = document.getElementById('hamburgerBtn');
        const sidebarCloseMobile = document.getElementById('sidebarCloseMobile');
        const sidebarToggle = document.getElementById('sidebarToggle');
        const mainContent = document.getElementById('mainContent');

        function openSidebarMobile() {
            sidebar.classList.add('open');
            sidebarOverlay.classList.add('active');
            document.body.style.overflow = 'hidden';
        }

        function closeSidebarMobile() {
            sidebar.classList.remove('open');
            sidebarOverlay.classList.remove('active');
            document.body.style.overflow = '';
        }

        function toggleSidebarDesktop() {
            if (window.innerWidth > 992) {
                sidebar.classList.toggle('collapsed');
                mainContent.classList.toggle('expanded');
            }
        }

        if (hamburgerBtn) hamburgerBtn.addEventListener('click', openSidebarMobile);
        if (sidebarCloseMobile) sidebarCloseMobile.addEventListener('click', closeSidebarMobile);
        if (sidebarOverlay) sidebarOverlay.addEventListener('click', closeSidebarMobile);
        if (sidebarToggle) sidebarToggle.addEventListener('click', toggleSidebarDesktop);

        document.querySelectorAll('.sidebar-nav a').forEach(link => {
            link.addEventListener('click', () => {
                if (window.innerWidth <= 992) closeSidebarMobile();
            });
        });

        window.addEventListener('resize', () => {
            if (window.innerWidth > 992) {
                closeSidebarMobile();
                sidebar.classList.remove('open');
                sidebarOverlay.classList.remove('active');
                document.body.style.overflow = '';
            }
        });

        // =============================================
        // NAVEGACIÓN
        // =============================================
        const navLinks = document.querySelectorAll('.sidebar-nav a');
        const pages = document.querySelectorAll('.page-content');
        const pageTitle = document.getElementById('pageTitle');

        const pageNames = {
            inicio: 'Inicio',
            horario: 'Mi Horario',
            asignaturas: 'Mis Asignaturas',
            asistencia: 'Mi Asistencia',
            notas: 'Mis Notas',
            progreso: 'Mi Progreso',
            boletines: 'Mis Boletines',
            comunicados: 'Comunicados',
            observador: 'Mi Observador'
        };

        navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = link.dataset.page;

                navLinks.forEach(l => l.closest('li').classList.remove('active'));
                link.closest('li').classList.add('active');

                pages.forEach(p => p.classList.remove('active'));
                const targetPage = document.getElementById('page-' + page);
                if (targetPage) targetPage.classList.add('active');

                if (pageNames[page]) pageTitle.textContent = pageNames[page];

                if (window.innerWidth <= 768) {
                    sidebar.classList.add('collapsed');
                }

                if (page === 'horario') cargarHorario();
                if (page === 'asignaturas') cargarAsignaturas();
                if (page === 'asistencia') cargarAsistenciaEstudiante();
                if (page === 'notas') cargarNotasEstudiante();
                if (page === 'progreso') cargarProgresoEstudiante();
                if (page === 'boletines') cargarBoletines();
                if (page === 'comunicados') cargarComunicados();
                if (page === 'observador') cargarObservador();
            });
        });

        // =============================================
        // FUNCIONES DE UTILIDAD
        // =============================================
        function formatearFecha(fecha) {
            if (!fecha) return 'Sin fecha';
            try {
                const d = fecha.toDate ? fecha.toDate() : new Date(fecha);
                return d.toLocaleDateString('es-CO', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            } catch (e) {
                return 'Fecha inválida';
            }
        }

        function formatTime(segundos) {
            const min = Math.floor(segundos / 60);
            const sec = segundos % 60;
            return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
        }

        // =============================================
        // SUBIR ARCHIVO A STORAGE CON PROGRESO
        // =============================================
        async function subirArchivoStorageConProgreso(ruta, archivo, onProgress) {
            return new Promise((resolve, reject) => {
                const storageRef = ref(storage, ruta);
                const uploadTask = uploadBytesResumable(storageRef, archivo);

                uploadTask.on('state_changed',
                    (snapshot) => {
                        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                        if (onProgress) onProgress(progress);
                    },
                    (error) => {
                        console.error('Error al subir archivo:', error);
                        resolve({ success: false, error: error.message });
                    },
                    async () => {
                        try {
                            const url = await getDownloadURL(storageRef);
                            resolve({ success: true, url: url, path: ruta });
                        } catch (error) {
                            resolve({ success: false, error: error.message });
                        }
                    }
                );
            });
        }

        // =============================================
        // SUBIR ARCHIVOS DE ENTREGA
        // =============================================
        async function subirArchivosEntrega(entregaId, archivos) {
            const resultados = [];

            for (const archivo of archivos) {
                const ruta = `entregas/${colegioId}/${estudianteId}/${entregaId}/${Date.now()}_${archivo.nombre}`;
                const resultado = await subirArchivoStorageConProgreso(ruta, archivo.file, (progress) => {
                    const statusEl = document.getElementById('uploadProgress');
                    if (statusEl) {
                        statusEl.style.display = 'block';
                        statusEl.textContent = `Subiendo ${archivo.nombre}: ${Math.round(progress)}%`;
                    }
                });

                if (resultado.success) {
                    resultados.push({
                        nombre: archivo.nombre,
                        url: resultado.url,
                        path: resultado.path,
                        size: archivo.size
                    });
                } else {
                    showToast(`Error al subir ${archivo.nombre}: ${resultado.error}`, 'error');
                }
            }

            return resultados;
        }

        // =============================================
        // DASHBOARD
        // =============================================
        async function cargarDashboard() {
            try {
                const estudianteDoc = await getDoc(doc(db, 'colegios', colegioId, 'estudiantes', estudianteId));
                if (!estudianteDoc.exists()) {
                    throw new Error('Estudiante no encontrado');
                }

                const estudiante = estudianteDoc.data();

                const colegioDoc = await getDoc(doc(db, 'colegios', colegioId));
                if (colegioDoc.exists()) {
                    const data = colegioDoc.data();
                    colegioNombreSidebar.textContent = data.nombre || 'Colegio';
                }

                const matQ = query(
                    collection(db, 'colegios', colegioId, 'matriculas'),
                    where('estudianteId', '==', estudianteId),
                    where('estado', '==', 'activo')
                );
                const matSnap = await getDocs(matQ);

                let cursoNombre = 'Sin curso';
                let gradoNombre = 'Sin grado';
                let anio = '';

                if (!matSnap.empty) {
                    const mat = matSnap.docs[0].data();
                    cursoActualId = mat.cursoId;
                    anio = mat.anio || '';

                    if (mat.cursoId) {
                        const cursoDoc = await getDoc(doc(db, 'colegios', colegioId, 'cursos', mat.cursoId));
                        if (cursoDoc.exists()) {
                            const cursoData = cursoDoc.data();
                            cursoNombre = cursoData.nombre || 'Sin curso';
                            if (cursoData.gradoId) {
                                const gradoDoc = await getDoc(doc(db, 'colegios', colegioId, 'grados', cursoData.gradoId));
                                gradoNombre = gradoDoc.exists() ? gradoDoc.data().nombre : 'Sin grado';
                            }
                        }
                    }
                }

                document.getElementById('bienvenida').textContent = `Bienvenido, ${usuarioActual?.nombre || 'Estudiante'}`;
                document.getElementById('infoEstudiante').textContent =
                    `${estudiante.nombres || ''} ${estudiante.apellidos || ''} - ${gradoNombre} ${cursoNombre}`;

                document.getElementById('estDocumento').textContent = estudiante.documento || '-';
                document.getElementById('estCurso').textContent = `${gradoNombre} ${cursoNombre}`.trim() || '-';
                document.getElementById('estAcudiente').textContent = estudiante.acudiente || '-';
                document.getElementById('estAnio').textContent = anio || '-';

                window.perfilData = {
                    nombres: estudiante.nombres || '',
                    apellidos: estudiante.apellidos || '',
                    documento: estudiante.documento || '',
                    correo: usuarioActual?.email || '',
                    curso: `${gradoNombre} ${cursoNombre}`.trim() || '-',
                    acudiente: estudiante.acudiente || '-',
                    acudienteTelefono: estudiante.acudienteTelefono || '-'
                };

                let asignaturasCount = 0;
                if (cursoActualId) {
                    const horariosQ = query(
                        collection(db, 'colegios', colegioId, 'horarios'),
                        where('cursoId', '==', cursoActualId)
                    );
                    const horariosSnap = await getDocs(horariosQ);
                    const asignaturasSet = new Set();
                    for (const docSnap of horariosSnap.docs) {
                        const h = docSnap.data();
                        if (h.asignaturaId) {
                            asignaturasSet.add(h.asignaturaId);
                        }
                    }
                    asignaturasCount = asignaturasSet.size;
                }
                document.getElementById('statsAsignaturas').textContent = asignaturasCount;

                let tareasPendientes = 0;
                if (cursoActualId) {
                    const actividadesQ = query(
                        collection(db, 'colegios', colegioId, 'actividades'),
                        where('cursoId', '==', cursoActualId)
                    );
                    const actividadesSnap = await getDocs(actividadesQ);

                    for (const docSnap of actividadesSnap.docs) {
                        const actividadId = docSnap.id;
                        const entregaQ = query(
                            collection(db, 'colegios', colegioId, 'entregas'),
                            where('actividadId', '==', actividadId),
                            where('estudianteId', '==', estudianteId)
                        );
                        const entregaSnap = await getDocs(entregaQ);
                        if (entregaSnap.empty) {
                            tareasPendientes++;
                        } else {
                            const entrega = entregaSnap.docs[0].data();
                            if (entrega.estado === 'pendiente') {
                                tareasPendientes++;
                            }
                        }
                    }
                }
                document.getElementById('statsTareasPendientes').textContent = tareasPendientes;

                const notasQ = query(
                    collection(db, 'colegios', colegioId, 'notas'),
                    where('estudianteId', '==', estudianteId)
                );
                const notasSnap = await getDocs(notasQ);

                const notasPorAsignatura = {};
                for (const docSnap of notasSnap.docs) {
                    const n = docSnap.data();
                    if (n.valor && n.valor > 0) {
                        const key = n.asignaturaId || 'general';
                        if (!notasPorAsignatura[key]) {
                            notasPorAsignatura[key] = [];
                        }
                        notasPorAsignatura[key].push(parseFloat(n.valor));
                    }
                }

                let sumPromedios = 0;
                let countAsignaturas = 0;
                for (const [key, notas] of Object.entries(notasPorAsignatura)) {
                    const prom = notas.reduce((a, b) => a + b, 0) / notas.length;
                    sumPromedios += prom;
                    countAsignaturas++;
                }
                const promedio = countAsignaturas > 0 ? (sumPromedios / countAsignaturas) : 0;
                document.getElementById('statsPromedio').textContent = promedio > 0 ? promedio.toFixed(1) : '-';

                const asisQ = query(
                    collection(db, 'colegios', colegioId, 'asistencias'),
                    where('estudianteId', '==', estudianteId)
                );
                const asisSnap = await getDocs(asisQ);
                let presentes = 0;
                let total = 0;
                for (const docSnap of asisSnap.docs) {
                    const a = docSnap.data();
                    total++;
                    if (a.estado === 'presente') presentes++;
                }
                const porcentajeAsis = total > 0 ? Math.round((presentes / total) * 100) : 0;
                document.getElementById('statsAsistencia').textContent = `${porcentajeAsis}%`;

                try {
                    const notiQ = query(
                        collection(db, 'colegios', colegioId, 'notificaciones'),
                        where('estudianteId', '==', estudianteId),
                        where('leida', '==', false)
                    );
                    const notiSnap = await getDocs(notiQ);
                    document.getElementById('notiCount').textContent = notiSnap.size;
                } catch (e) {
                    console.warn('Error al contar notificaciones:', e);
                    document.getElementById('notiCount').textContent = '0';
                }

                loadingState.style.display = 'none';

            } catch (error) {
                console.error('Error al cargar dashboard:', error);
                loadingState.innerHTML = `
                    <div style="color: var(--danger); font-size: 2rem;">
                        <i class="fas fa-exclamation-circle"></i>
                    </div>
                    <h3>Error al cargar los datos</h3>
                    <p>${error.message}</p>
                    <button class="btn-primary" onclick="location.reload()">Reintentar</button>
                `;
            }
        }

        // =============================================
        // HORARIO
        // =============================================
        async function cargarHorario() {
            const container = document.getElementById('horarioContainer');

            if (!cursoActualId) {
                container.innerHTML = `
                    <div class="text-center text-muted" style="padding: 40px 0;">
                        <i class="fas fa-calendar-alt" style="font-size: 2rem; display: block; margin-bottom: 12px;"></i>
                        No tienes un curso asignado aún.
                    </div>
                `;
                return;
            }

            try {
                const q = query(
                    collection(db, 'colegios', colegioId, 'horarios'),
                    where('cursoId', '==', cursoActualId)
                );
                const snap = await getDocs(q);

                if (snap.empty) {
                    container.innerHTML = `
                        <div class="text-center text-muted" style="padding: 40px 0;">
                            <i class="fas fa-calendar-alt" style="font-size: 2rem; display: block; margin-bottom: 12px;"></i>
                            No hay horarios asignados para tu curso.
                        </div>
                    `;
                    return;
                }

                const horarios = [];
                for (const docSnap of snap.docs) {
                    const data = docSnap.data();
                    let profesorNombre = data.profesorNombre || 'Sin profesor';
                    if (!data.profesorNombre && data.profesorId) {
                        try {
                            const userDoc = await getDoc(doc(db, 'usuarios', data.profesorId));
                            profesorNombre = userDoc.exists() ? userDoc.data().nombre : 'Sin profesor';
                        } catch (e) {}
                    }
                    horarios.push({
                        id: docSnap.id,
                        ...data,
                        profesorNombre: profesorNombre,
                        asignaturaNombre: data.asignaturaNombre || 'Clase'
                    });
                }

                const horasOrden = ['7:00 - 7:45', '7:45 - 8:30', '8:30 - 9:15', '9:15 - 10:00',
                    '10:30 - 11:15', '11:15 - 12:00', '12:00 - 12:45',
                    '14:00 - 14:45', '14:45 - 15:30', '15:30 - 16:15'
                ];
                horarios.sort((a, b) => horasOrden.indexOf(a.hora) - horasOrden.indexOf(b.hora));

                const dias = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];

                let html = `<div class="horario-grid">`;
                html += `<div class="h-cell header"></div>`;
                dias.forEach(d => {
                    html += `<div class="h-cell header">${d}</div>`;
                });

                horasOrden.forEach(hora => {
                    html += `<div class="h-cell hora">${hora}</div>`;
                    dias.forEach(dia => {
                        const clase = horarios.find(h => h.dia === dia && h.hora === hora);
                        if (clase) {
                            html += `
                                <div class="h-cell materia">
                                    <span class="asignatura">${clase.asignaturaNombre}</span>
                                    <span class="profesor">${clase.profesorNombre}</span>
                                </div>
                            `;
                        } else {
                            html += `<div class="h-cell"></div>`;
                        }
                    });
                });

                html += `</div>`;
                container.innerHTML = html;

            } catch (error) {
                console.error('Error al cargar horario:', error);
                container.innerHTML = `
                    <div class="text-center text-danger" style="padding: 40px 0;">
                        Error al cargar el horario: ${error.message}
                    </div>
                `;
            }
        }

        // =============================================
        // AUTH - VERIFICAR ESTUDIANTE (CORREGIDO)
        // =============================================
        onAuthStateChanged(auth, async (user) => {
            console.log('🔍 onAuthStateChanged ejecutado');
            
            if (isLoggingOut) return;

            if (!user) {
                console.log('❌ No hay usuario, redirigiendo a login...');
                window.location.href = '../login.html';
                return;
            }

            try {
                console.log('👤 Usuario autenticado:', user.email);
                
                const userDoc = await getDoc(doc(db, 'usuarios', user.uid));
                console.log('📌 userDoc existe:', userDoc.exists());
                
                if (!userDoc.exists()) {
                    console.log('❌ Usuario no existe en Firestore');
                    await signOut(auth);
                    window.location.href = '../login.html';
                    return;
                }

                const data = userDoc.data();
                console.log('📋 Datos del usuario:', data);

                // Verificar rol
                if (data.rol !== 'estudiante') {
                    console.log(`❌ Rol incorrecto: ${data.rol}`);
                    showToast('⛔ Acceso denegado. No eres estudiante.', 'error');
                    await signOut(auth);
                    window.location.href = '../login.html';
                    return;
                }

                if (data.activo !== true) {
                    console.log('❌ Usuario inactivo');
                    showToast('⛔ Tu cuenta está desactivada.', 'error');
                    await signOut(auth);
                    window.location.href = '../login.html';
                    return;
                }

                // =============================================
                // ASIGNAR COLEGIO SI NO TIENE
                // =============================================
                let colegioIdFinal = data.colegioId;
                
                if (!colegioIdFinal) {
                    console.log('⚠️ Usuario sin colegio, buscando uno...');
                    
                    try {
                        const colegiosSnap = await getDocs(collection(db, 'colegios'));
                        if (!colegiosSnap.empty) {
                            colegioIdFinal = colegiosSnap.docs[0].id;
                            console.log('✅ Colegio encontrado:', colegioIdFinal);
                            await updateDoc(doc(db, 'usuarios', user.uid), {
                                colegioId: colegioIdFinal
                            });
                        } else {
                            colegioIdFinal = 'DEFAULT_COLEGIO';
                            console.log('📌 Usando colegio por defecto');
                        }
                    } catch (error) {
                        console.error('❌ Error buscando colegios:', error);
                        colegioIdFinal = 'DEFAULT_COLEGIO';
                    }
                }

                console.log('✅ Colegio ID final:', colegioIdFinal);
                
                colegioId = colegioIdFinal;
                usuarioActual = data;
                estudianteId = user.uid;

                if (userNameEl) userNameEl.textContent = data.nombre || user.email;
                if (userRoleEl) userRoleEl.textContent = 'Estudiante';

                // =============================================
                // 🔧 BUSCAR ESTUDIANTE
                // =============================================
                let estudianteEncontrado = false;
                let estudianteData = null;

                try {
                    console.log('🔍 Buscando estudiante en colegio:', colegioId);
                    console.log('📌 Correo a buscar:', data.email);
                    
                    // OBTENER TODOS LOS ESTUDIANTES DEL COLEGIO
                    const allEstudiantes = await getDocs(collection(db, 'colegios', colegioId, 'estudiantes'));
                    console.log('📌 Total estudiantes:', allEstudiantes.size);
                    
                    for (const docSnap of allEstudiantes.docs) {
                        const estData = docSnap.data();
                        
                        if (estData.correo && estData.correo.toLowerCase() === data.email.toLowerCase()) {
                            estudianteId = docSnap.id;
                            estudianteData = estData;
                            estudianteEncontrado = true;
                            console.log('✅ Estudiante encontrado por correo:', estudianteId);
                            break;
                        }
                        if (estData.email && estData.email.toLowerCase() === data.email.toLowerCase()) {
                            estudianteId = docSnap.id;
                            estudianteData = estData;
                            estudianteEncontrado = true;
                            console.log('✅ Estudiante encontrado por email:', estudianteId);
                            break;
                        }
                    }
                    
                    // Si no se encuentra, CREAR ESTUDIANTE
                    if (!estudianteEncontrado) {
                        console.log('🆕 Estudiante no encontrado, creando uno nuevo...');
                        
                        // Buscar matrícula para obtener curso
                        let cursoIdTemp = null;
                        try {
                            const matQ = query(
                                collection(db, 'colegios', colegioId, 'matriculas'),
                                where('estudianteId', '==', user.uid),
                                where('estado', '==', 'activo')
                            );
                            const matSnap = await getDocs(matQ);
                            if (!matSnap.empty) {
                                const mat = matSnap.docs[0].data();
                                cursoIdTemp = mat.cursoId;
                            }
                        } catch (e) {}
                        
                        const nuevoEstudiante = {
                            nombres: data.nombre || user.displayName || 'Estudiante',
                            apellidos: '',
                            correo: data.email,
                            email: data.email,
                            uid: user.uid,
                            documento: '',
                            acudiente: '',
                            acudienteTelefono: '',
                            cursoId: cursoIdTemp || '',
                            estado: 'activo',
                            fechaRegistro: serverTimestamp()
                        };
                        
                        const estRef = await addDoc(collection(db, 'colegios', colegioId, 'estudiantes'), nuevoEstudiante);
                        estudianteId = estRef.id;
                        estudianteData = nuevoEstudiante;
                        estudianteEncontrado = true;
                        console.log('✅ Estudiante creado:', estudianteId);
                        showToast('✅ Perfil de estudiante creado automáticamente', 'success');
                    }
                    
                } catch (error) {
                    console.error('❌ Error al buscar/crear estudiante:', error);
                    showToast('⚠️ Error al cargar datos del estudiante: ' + error.message, 'error');
                }

                if (!estudianteEncontrado) {
                    console.error('❌ No se pudo encontrar ni crear el estudiante');
                    if (loadingState) {
                        loadingState.innerHTML = `
                            <div style="color: var(--danger); font-size: 2rem;">
                                <i class="fas fa-exclamation-circle"></i>
                            </div>
                            <h3>Error al cargar el perfil del estudiante</h3>
                            <p style="color: var(--text-secondary);">No se encontró el estudiante en la base de datos.</p>
                            <p style="color: var(--text-secondary); font-size: 0.85rem;">Correo: ${data.email}</p>
                            <button class="btn-primary" onclick="location.reload()">Reintentar</button>
                            <button class="btn-secondary" onclick="window.location.href='../login.html'">Volver al login</button>
                        `;
                    }
                    return;
                }

                console.log('✅ Estudiante verificado correctamente');
                console.log('📌 Estudiante ID:', estudianteId);
                console.log('📌 Colegio ID:', colegioId);

                await cargarDashboard();

            } catch (error) {
                console.error('❌ Error de autenticación:', error);
                if (loadingState) {
                    loadingState.innerHTML = `
                        <div style="color: var(--danger); font-size: 2rem;">
                            <i class="fas fa-exclamation-circle"></i>
                        </div>
                        <h3>Error al verificar usuario</h3>
                        <p style="color: var(--text-secondary);">${error.message}</p>
                        <button class="btn-primary" onclick="location.reload()">Reintentar</button>
                        <button class="btn-secondary" onclick="window.location.href='../login.html'">Volver al login</button>
                    `;
                }
            }
        });

        // =============================================
        // LOGOUT
        // =============================================
        logoutBtn.addEventListener('click', async () => {
            if (confirm('¿Seguro que deseas cerrar sesión?')) {
                try {
                    isLoggingOut = true;
                    await signOut(auth);
                    window.location.href = '../login.html';
                } catch (error) {
                    console.error('Error al cerrar sesión:', error);
                    showToast('❌ Error al cerrar sesión', 'error');
                    isLoggingOut = false;
                }
            }
        });

        console.log('✅ EduOne - Panel del Estudiante cargado correctamente');
        console.log('📁 Ruta: colegios/estudiante.html');
        console.log('📦 Storage configurado correctamente');

    </script>