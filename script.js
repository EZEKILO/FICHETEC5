(async function() {
    // ---------- CARGA DE MODELOS FACE-API ----------
    const loadingDiv = document.createElement('div');
    loadingDiv.style.cssText = 'position:fixed; top:10px; left:10px; background:#1e3a5f; color:white; padding:8px 16px; border-radius:40px; z-index:2000; font-weight:500;';
    loadingDiv.innerText = 'Cargando modelos faciales...';
    document.body.appendChild(loadingDiv);

    try {
        await faceapi.nets.ssdMobilenetv1.loadFromUri('https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights');
        await faceapi.nets.faceLandmark68Net.loadFromUri('https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights');
        await faceapi.nets.faceRecognitionNet.loadFromUri('https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights');
        loadingDiv.innerText = '✅ Modelos listos';
        setTimeout(() => loadingDiv.remove(), 1500);
    } catch (error) {
        console.error('Error cargando modelos:', error);
        loadingDiv.innerText = '❌ Error al cargar modelos';
        loadingDiv.style.background = '#b91c1c';
    }

    // ---------- BASES DE DATOS (localStorage) ----------
    let empleados = [];
    let fichadas = [];

    function cargarDatos() {
        try {
            const e = localStorage.getItem('empleados_facial');
            const f = localStorage.getItem('fichadas_facial');
            if (e) empleados = JSON.parse(e).map(emp => ({ ...emp, descriptors: emp.descriptors.map(d => new Float32Array(d)) }));
            if (f) fichadas = JSON.parse(f).map(fi => ({ ...fi, timestamp: new Date(fi.timestamp) }));
        } catch (error) {
            console.warn('Error cargando datos', error);
        }
    }
    function guardarEmpleados() {
        try {
            const paraGuardar = empleados.map(emp => ({ ...emp, descriptors: emp.descriptors.map(d => Array.from(d)) }));
            localStorage.setItem('empleados_facial', JSON.stringify(paraGuardar));
        } catch (error) {}
    }
    function guardarFichadas() {
        try {
            localStorage.setItem('fichadas_facial', JSON.stringify(fichadas));
        } catch (error) {}
    }
    cargarDatos();

    // ---------- UTILIDADES FACIALES ----------
    function distanciaEuclidiana(desc1, desc2) {
        return Math.sqrt(desc1.reduce((sum, val, i) => sum + (val - desc2[i]) ** 2, 0));
    }

    function buscarPorRostro(descriptor) {
        let mejor = { emp: null, dist: Infinity };
        for (let emp of empleados) {
            for (let desc of emp.descriptors) {
                const d = distanciaEuclidiana(descriptor, desc);
                if (d < mejor.dist) mejor = { emp, dist: d };
            }
        }
        return mejor.dist < 0.6 ? mejor.emp : null;
    }

    async function obtenerDescriptor(video) {
        try {
            const deteccion = await faceapi.detectSingleFace(video).withFaceLandmarks().withFaceDescriptor();
            return deteccion || null;
        } catch (error) {
            console.warn('Error obteniendo descriptor', error);
            return null;
        }
    }

    function validarRostroSinOclusion(deteccion) {
        if (!deteccion) return { valido: false, mensaje: 'No se detecta ningún rostro.' };
        const landmarks = deteccion.landmarks;
        const puntosBoca = landmarks.getMouth();
        const puntosOjoIzq = landmarks.getLeftEye();
        const puntosOjoDer = landmarks.getRightEye();

        if (!puntosBoca || puntosBoca.length < 10) {
            return { valido: false, mensaje: 'No se ve bien la boca. ¿Llevas mascarilla? Quítatela.' };
        }

        const labioSuperior = puntosBoca[19];
        const labioInferior = puntosBoca[55];
        if (labioSuperior && labioInferior) {
            const dy = Math.abs(labioSuperior.y - labioInferior.y);
            if (dy < 5) {
                return { valido: false, mensaje: 'Parece que tu boca está tapada. Quita mascarilla o similar.' };
            }
        }

        if (!puntosOjoIzq || puntosOjoIzq.length < 6 || !puntosOjoDer || puntosOjoDer.length < 6) {
            return { valido: false, mensaje: 'No se ven bien los ojos. ¿Llevas gafas muy oscuras? Quítatelas.' };
        }

        return { valido: true, mensaje: '' };
    }

    function capitalizar(str) {
        return str.toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
    }

    // ---------- CÁMARA ----------
    let currentStream = null;
    function pararCamara() {
        if (currentStream) {
            currentStream.getTracks().forEach(t => t.stop());
            currentStream = null;
        }
    }

    async function iniciarCamara(videoElement) {
        try {
            pararCamara();
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } 
            });
            currentStream = stream;
            videoElement.srcObject = stream;
            videoElement.setAttribute('playsinline', 'true');
            videoElement.setAttribute('autoplay', 'true');
            videoElement.setAttribute('muted', 'true');
            await videoElement.play();
            return true;
        } catch (error) {
            console.error('Error al acceder a la cámara:', error);
            return false;
        }
    }

    // ---------- REGISTRO ----------
    const modalReg = document.getElementById('modalRegistro');
    const regVideo = document.getElementById('regVideo');
    const regEstado = document.getElementById('regEstado');
    const regCapturar1 = document.getElementById('regCapturar1');
    const regCapturar2 = document.getElementById('regCapturar2');
    const regGuardarBtn = document.getElementById('regGuardar');
    const regPreviews = document.getElementById('regPreviews');
    const regNombre = document.getElementById('regNombre');
    const regApellido = document.getElementById('regApellido');
    const regDni = document.getElementById('regDni');

    let capturas = [];

    async function iniciarCamaraReg() {
        const ok = await iniciarCamara(regVideo);
        regEstado.innerText = ok ? 'Cámara lista. Capture 1ª foto.' : '❌ No se pudo acceder a la cámara.';
    }

    function limpiarCamposYCapturas() {
        regNombre.value = '';
        regApellido.value = '';
        regDni.value = '';
        capturas = [];
        regCapturar1.disabled = false;
        regCapturar2.disabled = true;
        regGuardarBtn.disabled = true;
        regPreviews.innerHTML = '';
        regEstado.innerText = 'Cámara lista. Capture 1ª foto.';
    }

    regCapturar1.addEventListener('click', async (e) => {
        e.preventDefault();
        const deteccion = await obtenerDescriptor(regVideo);
        if (!deteccion) {
            regEstado.innerText = '❌ No se detectó rostro. Intente de nuevo.';
            return;
        }
        const validacion = validarRostroSinOclusion(deteccion);
        if (!validacion.valido) {
            regEstado.innerText = '❌ ' + validacion.mensaje;
            return;
        }
        capturas[0] = deteccion.descriptor;
        regCapturar1.disabled = true;
        regCapturar2.disabled = false;
        regEstado.innerText = '✅ Primera captura OK. Capture segunda.';
        regPreviews.innerHTML = '<span style="color:green;">✔ Primera captura guardada</span>';
    });

    regCapturar2.addEventListener('click', async (e) => {
        e.preventDefault();
        const deteccion = await obtenerDescriptor(regVideo);
        if (!deteccion) {
            regEstado.innerText = '❌ No se detectó rostro. Intente de nuevo.';
            return;
        }
        const validacion = validarRostroSinOclusion(deteccion);
        if (!validacion.valido) {
            regEstado.innerText = '❌ ' + validacion.mensaje;
            return;
        }
        capturas[1] = deteccion.descriptor;
        regCapturar2.disabled = true;
        regEstado.innerText = '✅ Dos capturas completadas. Puede guardar.';
        regPreviews.innerHTML = '<span style="color:green;">✔✔ Dos rostros capturados</span>';
        regGuardarBtn.disabled = false;
    });

    regGuardarBtn.addEventListener('click', (e) => {
        e.preventDefault();
        let nombre = regNombre.value.trim();
        let apellido = regApellido.value.trim();
        let dni = regDni.value.trim();

        if (!nombre || !apellido || !dni) {
            alert('Complete todos los campos');
            return;
        }
        if (dni.length > 8) {
            alert('El DNI no puede tener más de 8 dígitos');
            return;
        }
        nombre = capitalizar(nombre);
        apellido = capitalizar(apellido);

        if (empleados.some(e => e.dni === dni)) {
            alert('Ya existe un empleado con ese DNI. Se limpiarán los campos.');
            limpiarCamposYCapturas();
            return;
        }
        for (let desc of capturas) {
            const empExistente = buscarPorRostro(desc);
            if (empExistente !== null) {
                alert(`Ese rostro ya pertenece a ${empExistente.nombre} ${empExistente.apellido} (DNI: ${empExistente.dni}). No se puede registrar duplicado.`);
                limpiarCamposYCapturas();
                return;
            }
        }
        const nuevo = {
            id: Date.now(),
            nombre: nombre,
            apellido: apellido,
            dni: dni,
            descriptors: capturas.map(d => new Float32Array(d))
        };
        empleados.push(nuevo);
        guardarEmpleados();
        alert('Empleado registrado con éxito');
        cerrarRegistro();
    });

    function cerrarRegistro() {
        modalReg.classList.remove('activo');
        pararCamara();
        limpiarCamposYCapturas();
    }

    document.getElementById('btnRegistrar').addEventListener('click', async (e) => {
        e.preventDefault();
        modalReg.classList.add('activo');
        await iniciarCamaraReg();
    });
    document.getElementById('regCancelar').addEventListener('click', (e) => {
        e.preventDefault();
        cerrarRegistro();
    });

    // ---------- FICHAJE ----------
    const modalFichar = document.getElementById('modalFichar');
    const ficharVideo = document.getElementById('ficharVideo');
    const ficharEstado = document.getElementById('ficharEstado');
    const ficharResultado = document.getElementById('ficharResultado');

    let ficharInterval = null;
    let ficharRegistrado = false;

    async function iniciarCamaraFichar() {
        const ok = await iniciarCamara(ficharVideo);
        if (!ok) {
            ficharEstado.innerText = '❌ No se pudo acceder a la cámara.';
            return;
        }
        ficharEstado.innerText = 'Buscando rostro...';
        ficharResultado.innerHTML = '';
        ficharRegistrado = false;

        ficharInterval = setInterval(async () => {
            if (ficharRegistrado) return;

            try {
                const deteccion = await obtenerDescriptor(ficharVideo);
                if (!deteccion) {
                    ficharEstado.innerText = '👤 No se ve ningún rostro';
                    return;
                }

                const emp = buscarPorRostro(deteccion.descriptor);
                if (!emp) {
                    ficharEstado.innerText = '❌ Rostro no reconocido';
                    return;
                }

                const hoy = new Date().toDateString();
                const fichasHoy = fichadas.filter(f => f.employeeId === emp.id && new Date(f.timestamp).toDateString() === hoy).sort((a,b) => a.timestamp - b.timestamp);
                let tipo = 'entrada';
                if (fichasHoy.length > 0) {
                    const ultimo = fichasHoy[fichasHoy.length-1];
                    tipo = ultimo.tipo === 'entrada' ? 'salida' : 'entrada';
                }
                if (fichasHoy.length >= 4) {
                    ficharEstado.innerText = '⛔ Ya has fichado 4 veces hoy (máximo)';
                    ficharResultado.innerHTML = '<div class="texto-error">Máximo alcanzado. Cerrando...</div>';
                    ficharRegistrado = true;
                    clearInterval(ficharInterval);
                    setTimeout(() => cerrarFichar(), 2000);
                    return;
                }

                const nuevaFichada = {
                    id: Date.now() + Math.random(),
                    employeeId: emp.id,
                    timestamp: new Date(),
                    tipo: tipo
                };
                fichadas.push(nuevaFichada);
                guardarFichadas();

                ficharResultado.innerHTML = `<div class="texto-exito">✅ ${emp.nombre} ${emp.apellido} - ${tipo} registrada ${new Date().toLocaleTimeString()}</div>`;
                ficharEstado.innerText = 'Fichaje correcto. Cerrando...';
                ficharRegistrado = true;
                clearInterval(ficharInterval);
                setTimeout(() => cerrarFichar(), 1500);
            } catch (e) {
                console.warn(e);
            }
        }, 2000);
    }

    function cerrarFichar() {
        modalFichar.classList.remove('activo');
        if (ficharInterval) {
            clearInterval(ficharInterval);
            ficharInterval = null;
        }
        pararCamara();
    }

    document.getElementById('btnFichar').addEventListener('click', async (e) => {
        e.preventDefault();
        modalFichar.classList.add('activo');
        await iniciarCamaraFichar();
    });

    document.getElementById('ficharCerrar').addEventListener('click', (e) => {
        e.preventDefault();
        cerrarFichar();
    });

    // ---------- ADMIN: LISTA Y DETALLE (con cálculo de extras) ----------
    const modalVer = document.getElementById('modalVer');
    const verSinAdmin = document.getElementById('verSinAdmin');
    const verAdminPanel = document.getElementById('verAdminPanel');
    const adminPass = document.getElementById('adminPass');
    const adminError = document.getElementById('adminError');
    const btnVolverLista = document.getElementById('btnVolverLista');
    const vistaLista = document.getElementById('vistaListaEmpleados');
    const vistaDetalle = document.getElementById('vistaDetalleEmpleado');
    const listaEmpleadosContainer = document.getElementById('listaEmpleadosContainer');
    const buscadorEmpleados = document.getElementById('buscadorEmpleados');
    const detalleTitulo = document.getElementById('detalleTitulo');
    const resumenEmpleadoDetalle = document.getElementById('resumenEmpleadoDetalle');
    const fichadasEmpleadoDetalle = document.getElementById('fichadasEmpleadoDetalle');
    const horasTotalesDetalle = document.getElementById('horasTotalesDetalle');
    const extrasDetalle = document.getElementById('extrasDetalle');

    let empleadoSeleccionado = null;

    // Función para obtener las horas trabajadas por día (pares entrada-salida)
    function obtenerHorasPorDia(employeeId) {
        const fichasEmp = fichadas.filter(f => f.employeeId === employeeId).sort((a,b) => a.timestamp - b.timestamp);
        const dias = {};
        let currentDay = null;
        let entradas = [];

        fichasEmp.forEach(f => {
            const dia = new Date(f.timestamp).toDateString();
            if (dia !== currentDay) {
                currentDay = dia;
                entradas = [];
            }
            if (f.tipo === 'entrada') {
                entradas.push(f);
            } else { // salida
                if (entradas.length > 0) {
                    const entrada = entradas.shift();
                    const minutos = (f.timestamp - entrada.timestamp) / 60000;
                    if (!dias[dia]) dias[dia] = 0;
                    dias[dia] += minutos;
                }
            }
        });
        return dias;
    }

    function calcularExtras(employeeId) {
        const horasPorDia = obtenerHorasPorDia(employeeId);
        const resumen = {
            porDia: {},
            porSemana: {},
            porMes: {}
        };

        for (let diaStr in horasPorDia) {
            const horas = horasPorDia[diaStr] / 60; // convertir a horas
            const extraDia = horas > 8 ? horas - 8 : 0;
            resumen.porDia[diaStr] = { horas, extra: extraDia };

            const fecha = new Date(diaStr);
            const semana = getWeekNumber(fecha);
            const claveSemana = `${fecha.getFullYear()}-W${semana}`;
            if (!resumen.porSemana[claveSemana]) resumen.porSemana[claveSemana] = { total: 0, extras: 0 };
            resumen.porSemana[claveSemana].total += horas;

            const mes = `${fecha.getFullYear()}-${fecha.getMonth()+1}`;
            if (!resumen.porMes[mes]) resumen.porMes[mes] = { total: 0, extras: 0 };
            resumen.porMes[mes].total += horas;
        }

        // Calcular extras semanales (más de 40h)
        for (let sem in resumen.porSemana) {
            const total = resumen.porSemana[sem].total;
            resumen.porSemana[sem].extras = total > 40 ? total - 40 : 0;
        }

        // Calcular extras mensuales (más de 160h)
        for (let m in resumen.porMes) {
            const total = resumen.porMes[m].total;
            resumen.porMes[m].extras = total > 160 ? total - 160 : 0;
        }

        return resumen;
    }

    function getWeekNumber(d) {
        d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    }

    // Renderiza la sección de extras con estilo calendario (acordeón por meses)
    function renderExtras(employeeId) {
        const extras = calcularExtras(employeeId);
        let html = '<h4 style="margin-bottom:1rem;">📆 Calendario de horas extras</h4>';

        // Agrupar por mes
        const meses = {};
        for (let diaStr in extras.porDia) {
            const fecha = new Date(diaStr);
            const mesKey = `${fecha.getFullYear()}-${fecha.getMonth()+1}`;
            if (!meses[mesKey]) meses[mesKey] = { dias: [], totalHoras: 0, totalExtras: 0 };
            meses[mesKey].dias.push({ fecha: diaStr, horas: extras.porDia[diaStr].horas, extra: extras.porDia[diaStr].extra });
            meses[mesKey].totalHoras += extras.porDia[diaStr].horas;
            meses[mesKey].totalExtras += extras.porDia[diaStr].extra;
        }

        // Ordenar meses descendente
        const mesesOrdenados = Object.keys(meses).sort().reverse();

        for (let mesKey of mesesOrdenados) {
            const [year, month] = mesKey.split('-');
            const nombreMes = new Date(year, month-1, 1).toLocaleString('es', { month: 'long' });
            const capitalizado = nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1);
            const mesData = meses[mesKey];
            // Ordenar días del mes (más reciente primero)
            mesData.dias.sort((a,b) => new Date(b.fecha) - new Date(a.fecha));

            html += `
                <div class="mes-acordeon">
                    <div class="mes-cabecera">
                        <span>${capitalizado} ${year}</span>
                        <span>${mesData.totalHoras.toFixed(1)} h total · ${mesData.totalExtras.toFixed(1)} h extra</span>
                        <span style="font-size:1.2rem;">▼</span>
                    </div>
                    <div class="mes-detalle">
                        <table class="tabla-dias">
                            <tr><th>Día</th><th>Horas trabajadas</th><th>Horas extra</th></tr>
            `;
            mesData.dias.forEach(d => {
                const fechaObj = new Date(d.fecha);
                const diaStr = fechaObj.toLocaleDateString('es', { day: '2-digit', month: 'short' });
                const extraClass = d.extra > 0 ? 'extra-positivo' : 'extra-cero';
                html += `<tr><td>${diaStr}</td><td>${d.horas.toFixed(1)} h</td><td class="${extraClass}">${d.extra.toFixed(1)} h</td></tr>`;
            });
            html += `</table></div></div>`;
        }

        // Resumen semanal
        html += '<div class="semana-resumen"><h5>Resumen semanal</h5><table class="tabla-dias"><tr><th>Semana</th><th>Total horas</th><th>Extras</th></tr>';
        const semanas = Object.keys(extras.porSemana).sort().reverse();
        semanas.forEach(sem => {
            const data = extras.porSemana[sem];
            html += `<tr><td>${sem}</td><td>${data.total.toFixed(1)} h</td><td class="${data.extras > 0 ? 'extra-positivo' : 'extra-cero'}">${data.extras.toFixed(1)} h</td></tr>`;
        });
        html += '</table></div>';

        extrasDetalle.innerHTML = html;

        // Añadir interactividad a los acordeones (toggle)
        document.querySelectorAll('.mes-cabecera').forEach(header => {
            header.addEventListener('click', function(e) {
                const detalle = this.parentElement.querySelector('.mes-detalle');
                detalle.classList.toggle('abierto');
            });
        });
    }

    function renderListaEmpleados(filtro = '') {
        const filtroLower = filtro.toLowerCase();
        const empleadosFiltrados = empleados.filter(emp =>
            emp.nombre.toLowerCase().includes(filtroLower) ||
            emp.apellido.toLowerCase().includes(filtroLower) ||
            emp.dni.includes(filtro)
        );

        let html = '';
        empleadosFiltrados.forEach(emp => {
            html += `
                <div class="empleado-item" data-id="${emp.id}">
                    <div class="empleado-info">
                        <strong>${emp.nombre} ${emp.apellido}</strong> - DNI: ${emp.dni}
                    </div>
                    <div class="empleado-acciones">
                        <button class="btn-pequeno ver-detalle" data-id="${emp.id}">👁️ Ver</button>
                        <button class="btn-pequeno eliminar-empleado" data-id="${emp.id}">🗑️</button>
                    </div>
                </div>
            `;
        });
        listaEmpleadosContainer.innerHTML = html || '<p style="padding:1rem;">No hay empleados que coincidan.</p>';

        // Asignar eventos a los botones de la lista
        document.querySelectorAll('.ver-detalle').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = Number(btn.dataset.id);
                mostrarDetalleEmpleado(id);
            });
        });
        document.querySelectorAll('.eliminar-empleado').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = Number(btn.dataset.id);
                eliminarEmpleado(id);
            });
        });
        // También se puede hacer clic en el item para ver detalle
        document.querySelectorAll('.empleado-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.tagName === 'BUTTON') return;
                const id = Number(item.dataset.id);
                mostrarDetalleEmpleado(id);
            });
        });
    }

    function eliminarEmpleado(id) {
        const emp = empleados.find(e => e.id === id);
        if (!emp) return;
        if (confirm(`¿Estás seguro de eliminar a ${emp.nombre} ${emp.apellido}? También se borrarán todas sus fichadas.`)) {
            empleados = empleados.filter(e => e.id !== id);
            fichadas = fichadas.filter(f => f.employeeId !== id);
            guardarEmpleados();
            guardarFichadas();
            if (empleadoSeleccionado === id) {
                volverALista();
            }
            renderListaEmpleados(buscadorEmpleados.value);
        }
    }

    function mostrarDetalleEmpleado(id) {
        empleadoSeleccionado = id;
        const emp = empleados.find(e => e.id === id);
        if (!emp) return;

        detalleTitulo.innerText = `${emp.nombre} ${emp.apellido} - DNI: ${emp.dni}`;

        // Resumen de hoy
        const horasHoy = calcularHorasTrabajadasHoy(id);
        const estado = obtenerEstadoEmpleado(id);
        const clase = estado === 'rojo' ? 'estado-rojo' : (estado === 'amarillo' ? 'estado-amarillo' : 'estado-verde');
        const textoEstado = estado === 'rojo' ? 'Sin fichar hoy' : (estado === 'amarillo' ? 'Jornada incompleta' : 'Jornada completa');
        resumenEmpleadoDetalle.innerHTML = `
            <p><span class="${clase}">${textoEstado}</span> · Horas hoy: ${horasHoy.toFixed(1)} h</p>
        `;

        // Renderizar extras con nuevo diseño
        renderExtras(id);

        // Fichadas del empleado
        const fichasEmp = fichadas.filter(f => f.employeeId === id).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
        let htmlFichas = '<table class="tabla-fichas"><tr><th>Fecha/hora</th><th>Tipo</th><th>Acciones</th></tr>';
        fichasEmp.forEach(f => {
            htmlFichas += `
                <tr>
                    <td>${new Date(f.timestamp).toLocaleString()}</td>
                    <td>${f.tipo}</td>
                    <td><button class="btn-pequeno eliminar-fichada" data-id="${f.id}">🗑️</button></td>
                </tr>
            `;
        });
        htmlFichas += '</table>';
        fichadasEmpleadoDetalle.innerHTML = htmlFichas || '<p>No hay fichadas para este empleado.</p>';

        // Horas totales
        const horasTotales = calcularHorasTotales(id);
        horasTotalesDetalle.innerHTML = `<strong>Horas totales trabajadas:</strong> ${horasTotales.toFixed(1)} h`;

        // Eventos para eliminar fichadas
        document.querySelectorAll('.eliminar-fichada').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const fId = Number(btn.dataset.id);
                fichadas = fichadas.filter(f => f.id !== fId);
                guardarFichadas();
                mostrarDetalleEmpleado(id); // recargar
            });
        });

        // Cambiar vista
        vistaLista.classList.add('oculto');
        vistaDetalle.classList.remove('oculto');
        btnVolverLista.style.display = 'inline-block';
    }

    function volverALista() {
        empleadoSeleccionado = null;
        vistaLista.classList.remove('oculto');
        vistaDetalle.classList.add('oculto');
        btnVolverLista.style.display = 'none';
        renderListaEmpleados(buscadorEmpleados.value);
    }

    // Funciones auxiliares de cálculo
    function calcularHorasTrabajadasHoy(employeeId) {
        const hoy = new Date().toDateString();
        const fichasHoy = fichadas.filter(f => f.employeeId === employeeId && new Date(f.timestamp).toDateString() === hoy).sort((a,b) => a.timestamp - b.timestamp);
        let minutos = 0;
        for (let i = 0; i < fichasHoy.length - 1; i += 2) {
            if (fichasHoy[i].tipo === 'entrada' && fichasHoy[i+1]?.tipo === 'salida') {
                minutos += (new Date(fichasHoy[i+1].timestamp) - new Date(fichasHoy[i].timestamp)) / 60000;
            }
        }
        return Math.round(minutos / 60 * 10) / 10;
    }

    function obtenerEstadoEmpleado(empId) {
        const hoy = new Date().toDateString();
        const fichasHoy = fichadas.filter(f => f.employeeId === empId && new Date(f.timestamp).toDateString() === hoy).sort((a,b) => a.timestamp - b.timestamp);
        if (fichasHoy.length === 0) return 'rojo';
        const horas = calcularHorasTrabajadasHoy(empId);
        const ultimoTipo = fichasHoy[fichasHoy.length-1].tipo;
        if (horas >= 8 && ultimoTipo === 'salida') return 'verde';
        return 'amarillo';
    }

    function calcularHorasTotales(empId) {
        const fichasEmp = fichadas.filter(f => f.employeeId === empId).sort((a,b) => a.timestamp - b.timestamp);
        let totalMinutos = 0;
        for (let i = 0; i < fichasEmp.length - 1; i += 2) {
            if (fichasEmp[i].tipo === 'entrada' && fichasEmp[i+1]?.tipo === 'salida') {
                totalMinutos += (new Date(fichasEmp[i+1].timestamp) - new Date(fichasEmp[i].timestamp)) / 60000;
            }
        }
        return Math.round(totalMinutos / 60 * 10) / 10;
    }

    // Eventos del panel admin
    document.getElementById('btnVerFichas').addEventListener('click', (e) => {
        e.preventDefault();
        modalVer.classList.add('activo');
        verSinAdmin.style.display = 'block';
        verAdminPanel.classList.add('oculto');
        adminPass.value = '';
        adminError.classList.add('oculto');
    });

    document.getElementById('btnAccederAdmin').addEventListener('click', (e) => {
        e.preventDefault();
        if (adminPass.value === 'admin123') {
            verSinAdmin.style.display = 'none';
            verAdminPanel.classList.remove('oculto');
            volverALista();
            renderListaEmpleados('');
        } else {
            adminError.innerText = 'Contraseña incorrecta';
            adminError.classList.remove('oculto');
        }
    });

    document.getElementById('btnCerrarAdmin').addEventListener('click', (e) => {
        e.preventDefault();
        verSinAdmin.style.display = 'block';
        verAdminPanel.classList.add('oculto');
    });

    document.getElementById('verCerrar').addEventListener('click', (e) => {
        e.preventDefault();
        modalVer.classList.remove('activo');
    });

    btnVolverLista.addEventListener('click', (e) => {
        e.preventDefault();
        volverALista();
    });

    buscadorEmpleados.addEventListener('input', (e) => {
        renderListaEmpleados(e.target.value);
    });

    // Cerrar modales al hacer clic en el overlay
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.classList.remove('activo');
        });
    });

})();