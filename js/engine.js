/**
 * js/engine.js
 * Cerebro Biomecánico de FORGE (Entrenador Personal basado en Ciencia + Base de Datos Propia)
 * - Selección de EJERCICIOS reales por nivel (Principiante / Intermedio / Avanzado), no solo bajar reps
 * - Filtro automático por lesiones/molestias detectadas en notas del usuario (hombro, rodilla, muñeca, lumbar)
 * - Filtro estricto de equipamiento (cero barras/anillas si entrenás en casa sin herramientas)
 * - Contexto RAG de tu base de datos para inyectar a Gemini IA + Google Search Grounding
 */

const MotorEntrenamiento = (() => {
  let dbCache = null;

  const PALABRAS_PROHIBIDAS_SIN_EQUIPO = [
    'barra',
    'paralela',
    'dips',
    'fondo en barra',
    'fondos en barra',
    'anilla',
    'aro',
    'polea',
    'mancuerna',
    'disco',
    'prensa',
    'máquina',
    'maquina',
    'dominada',
    'pull-up',
    'chin-up',
    'jalón',
    'jalon',
    'press de banca',
    'press banca',
    'press militar',
    'peso muerto',
    'kettlebell',
    'pesa rusa'
  ];

  async function cargarBaseDeDatos() {
    if (dbCache) return dbCache;
    if (window.__EMBEDDED_DATABASE__) {
      dbCache = window.__EMBEDDED_DATABASE__;
      return dbCache;
    }
    try {
      const resp = await fetch('./data/database.json');
      if (!resp.ok) throw new Error('Error cargando database.json');
      dbCache = await resp.json();
      return dbCache;
    } catch (err) {
      return { parametrosPorObjetivo: {}, multiplicadorNivel: {}, catalogoEjercicios: {}, criteriosPorNivel: {} };
    }
  }

  function calcular1RMEpley(peso, reps) {
    const p = Number(peso) || 0;
    const r = Number(reps) || 0;
    if (p <= 0 || r <= 0) return 0;
    if (r === 1) return p;
    return +(p * (1 + r / 30)).toFixed(1);
  }

  function calcular1RMBrzycki(peso, reps) {
    const p = Number(peso) || 0;
    const r = Number(reps) || 0;
    if (p <= 0 || r <= 0) return 0;
    if (r === 1) return p;
    const denom = 1.0278 - 0.0278 * Math.min(r, 30);
    if (denom <= 0) return p;
    return +(p / denom).toFixed(1);
  }

  function calcularTonelajeSeries(series = []) {
    return series.reduce((acc, s) => acc + (Number(s.peso) || 0) * (Number(s.reps) || 0), 0);
  }

  function redondearPasoDisco(peso, paso = 2.5) {
    if (peso <= 0) return 0;
    return Math.round(peso / paso) * paso;
  }

  /**
   * Detecta molestias articulares mencionadas por el usuario en sus notas libres
   */
  function detectarMolestias(notas = '') {
    const t = (notas || '').toLowerCase();
    const molestias = [];
    if (t.includes('hombro') || t.includes('manguito')) molestias.push('hombro');
    if (t.includes('rodilla') || t.includes('menisco') || t.includes('rotula')) molestias.push('rodilla');
    if (t.includes('muñeca') || t.includes('muneca')) molestias.push('muneca');
    if (t.includes('lumbar') || t.includes('espalda baja') || t.includes('cintura') || t.includes('hernia')) {
      molestias.push('lumbar');
    }
    return molestias;
  }

  const INTENSIDADES_CARDIO = {
    intenso: 'Intenso (HIIT / Tabata)',
    medio: 'Medio',
    bajo: 'Bajo (Sin impacto)'
  };

  function etiquetaIntensidadCardio(intensidad = 'medio') {
    return INTENSIDADES_CARDIO[intensidad] || INTENSIDADES_CARDIO.medio;
  }

  function esEjercicioCardio(ej) {
    return Boolean(ej?.esCardio || ej?.tipo === 'cardio');
  }

  function buscarUltimoRegistroEjercicio(nombreEjercicio, divisionActual, entrenamientos = []) {
    if (!Array.isArray(entrenamientos) || entrenamientos.length === 0) return null;

    const ordenados = [...entrenamientos].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    const nombreNorm = (nombreEjercicio || '').trim().toLowerCase();

    for (const sesion of ordenados) {
      if (!Array.isArray(sesion.ejercicios)) continue;
      const ej = sesion.ejercicios.find(
        (e) => (e.nombre || '').trim().toLowerCase() === nombreNorm
      );
      if (ej && Array.isArray(ej.series) && ej.series.length > 0) {
        const validas = ej.series.filter(
          (s) => (Number(s.tiempo_minutos) || 0) > 0 || (Number(s.reps) || 0) > 0
        );
        if (!validas.length) continue;

        const esCardioHist = esEjercicioCardio(ej) || validas.some((s) => (Number(s.tiempo_minutos) || 0) > 0);
        const mejorSerie = validas.reduce((best, curr) => {
          if (esCardioHist) {
            return (Number(curr.tiempo_minutos) || 0) >= (Number(best.tiempo_minutos) || 0) ? curr : best;
          }
          const scoreBest = (Number(best.peso) || 0) > 0 ? calcular1RMEpley(best.peso, best.reps) : Number(best.reps);
          const scoreCurr = (Number(curr.peso) || 0) > 0 ? calcular1RMEpley(curr.peso, curr.reps) : Number(curr.reps);
          return scoreCurr >= scoreBest ? curr : best;
        }, validas[validas.length - 1]);

        return {
          fecha: sesion.fecha,
          divisionMuscular: sesion.divisionMuscular,
          ultimaSerie: validas[validas.length - 1],
          mejorSerie,
          todasLasSeries: validas
        };
      }
    }
    return null;
  }

  function calcularPrescripcionProgresiva(
    ejercicioBase,
    paramsObjetivo,
    multNivel,
    historialEjercicio,
    modoDeload = false,
    esSinEquipo = false
  ) {
    if (esEjercicioCardio(ejercicioBase)) {
      const intensidadCardio = ejercicioBase.intensidadCardio || 'medio';
      const labelInt = etiquetaIntensidadCardio(intensidadCardio);
      const durBase = Math.max(
        1,
        Number(ejercicioBase.duracionMinutos) ||
          (intensidadCardio === 'intenso' ? 8 : intensidadCardio === 'bajo' ? 20 : 15)
      );

      if (!historialEjercicio) {
        const tiempoInicial = modoDeload ? Math.max(4, Math.round(durBase * 0.75)) : durBase;
        return {
          tieneHistorial: false,
          esCardio: true,
          intensidadCardio,
          esPesoCorporal: true,
          pesoSugerido: 0,
          repsSugeridas: 0,
          tiempoSugerido: tiempoInicial,
          pesoAlternativoSubida: 0,
          estadoProgresion: 'calibracion',
          etiquetaEstado: 'Primera sesión',
          mensajeProgresion: modoDeload
            ? `Descarga hoy: ${tiempoInicial} min suaves · Cardio ${labelInt}`
            : `Meta hoy: ${tiempoInicial} min · Cardio ${labelInt}`
        };
      }

      const ref = historialEjercicio.mejorSerie;
      const ultimoTiempo = Math.max(1, Number(ref.tiempo_minutos) || durBase);
      const ultimoRir = ref.rir !== undefined && ref.rir !== null ? Number(ref.rir) : 2;
      const pasoGrande = intensidadCardio === 'intenso' ? 2 : 3;
      const pasoNormal = intensidadCardio === 'intenso' ? 1 : 2;

      let tiempoHoy = ultimoTiempo;
      let mensajeProgresion = '';

      if (modoDeload) {
        tiempoHoy = Math.max(4, Math.round(ultimoTiempo * 0.75));
        mensajeProgresion = `Última vez: ${ultimoTiempo} min · Descarga hoy: ${tiempoHoy} min (${labelInt})`;
      } else if (ultimoRir >= 3) {
        tiempoHoy = ultimoTiempo + pasoGrande;
        mensajeProgresion = `Última vez: ${ultimoTiempo} min (sobró) · Meta hoy: ${tiempoHoy} min · ${labelInt}`;
      } else if (ultimoRir === 0) {
        tiempoHoy = ultimoTiempo;
        mensajeProgresion = `Última vez: ${ultimoTiempo} min (al límite) · Meta hoy: consolidar ${tiempoHoy} min`;
      } else {
        tiempoHoy = ultimoTiempo + pasoNormal;
        mensajeProgresion = `Última vez: ${ultimoTiempo} min · Meta hoy: ${tiempoHoy} min · ${labelInt}`;
      }

      return {
        tieneHistorial: true,
        esCardio: true,
        intensidadCardio,
        esPesoCorporal: true,
        ultimoTiempo,
        ultimoRir,
        fechaUltima: historialEjercicio.fecha,
        pesoSugerido: 0,
        repsSugeridas: 0,
        tiempoSugerido: tiempoHoy,
        pesoAlternativoSubida: 0,
        mensajeProgresion
      };
    }

    const repsMin = Number(ejercicioBase.repsMin) || paramsObjetivo.repsMin || 8;
    const repsMax = Number(ejercicioBase.repsMax) || paramsObjetivo.repsMax || 12;
    const incrementoDisco = 2.5;
    const esBodyweight =
      esSinEquipo ||
      ejercicioBase.esPesoCorporal ||
      Number(ejercicioBase.pesoBaseIntermedio ?? ejercicioBase.pesoSugerido ?? 0) === 0;

    if (!historialEjercicio) {
      let pesoInicial = esBodyweight
        ? 0
        : redondearPasoDisco(
            (Number(ejercicioBase.pesoSugerido) || Number(ejercicioBase.pesoBaseIntermedio) || 20) *
              (ejercicioBase.pesoSugerido ? 1 : multNivel),
            2.5
          );
      if (modoDeload && pesoInicial > 0) {
        pesoInicial = redondearPasoDisco(pesoInicial * 0.9, 2.5);
      }

      const repsIniciales =
        Number(ejercicioBase.repsSugeridas) || Math.round((repsMin + repsMax) / 2);

      return {
        tieneHistorial: false,
        esPesoCorporal: esBodyweight,
        pesoSugerido: pesoInicial,
        repsSugeridas: repsIniciales,
        pesoAlternativoSubida: pesoInicial > 0 ? +(pesoInicial + incrementoDisco).toFixed(1) : 0,
        estadoProgresion: 'calibracion',
        etiquetaEstado: 'Primera sesión',
        mensajeProgresion:
          pesoInicial > 0
            ? `Meta hoy: ${pesoInicial} kg × ${repsIniciales} reps (técnica controlada)`
            : `Meta hoy: ${repsIniciales} reps controladas · Foco en técnica`
      };
    }

    const ref = historialEjercicio.mejorSerie;
    const ultimoPeso = esBodyweight ? 0 : Number(ref.peso) || 0;
    const ultimasReps = Number(ref.reps) || repsMin;
    const ultimoRir = ref.rir !== undefined && ref.rir !== null ? Number(ref.rir) : 2;

    let pesoHoy = ultimoPeso;
    let repsHoy = ultimasReps;
    let pesoSubida = ultimoPeso > 0 ? +(ultimoPeso + incrementoDisco).toFixed(1) : 0;
    let mensajeProgresion = '';

    if (modoDeload) {
      pesoHoy = ultimoPeso > 0 ? redondearPasoDisco(ultimoPeso * 0.9, 2.5) : 0;
      repsHoy = Math.max(6, Math.round(ultimasReps * 0.8));
      mensajeProgresion =
        ultimoPeso > 0
          ? `Última vez: ${ultimoPeso} kg × ${ultimasReps} · Descarga hoy: ${pesoHoy} kg × ${repsHoy}`
          : `Última vez: ${ultimasReps} reps · Descarga hoy: ${repsHoy} reps suaves`;
    } else if (esBodyweight) {
      if (ultimoRir >= 3) {
        repsHoy = ultimasReps + 2;
        mensajeProgresion = `Última vez: ${ultimasReps} reps (sobró) · Meta hoy: ${repsHoy} reps o pasar a la progresión`;
      } else if (ultimoRir === 0) {
        repsHoy = ultimasReps;
        mensajeProgresion = `Última vez: ${ultimasReps} reps (al fallo) · Meta hoy: consolidar ${repsHoy} reps`;
      } else {
        repsHoy = ultimasReps + 1;
        mensajeProgresion = `Última vez: ${ultimasReps} reps · Meta hoy: ${repsHoy} reps`;
      }
    } else if (ultimoRir >= 3 && ultimasReps >= repsMin) {
      const inc = Math.max(incrementoDisco, redondearPasoDisco(ultimoPeso * paramsObjetivo.incrementoPct, 2.5));
      pesoHoy = +(ultimoPeso + inc).toFixed(1);
      repsHoy = repsMin;
      mensajeProgresion = `Última vez: ${ultimoPeso} kg × ${ultimasReps} (cómodo) · Meta hoy: subir a ${pesoHoy} kg × ${repsHoy}`;
    } else if (ultimoRir === 0 || ultimasReps < repsMin) {
      pesoHoy = ultimoPeso;
      repsHoy = Math.max(repsMin, ultimasReps);
      mensajeProgresion = `Última vez: ${ultimoPeso} kg × ${ultimasReps} · Meta hoy: consolidar ${pesoHoy} kg × ${repsHoy}`;
    } else {
      const nuevasReps = Math.min(repsMax, ultimasReps + (ultimasReps + 2 <= repsMax ? 2 : 1));
      if (ultimasReps >= repsMax) {
        pesoHoy = pesoSubida;
        repsHoy = repsMin;
        mensajeProgresion = `Última vez: ${ultimoPeso} kg × ${ultimasReps} · Meta hoy: subir a ${pesoHoy} kg × ${repsHoy}`;
      } else {
        pesoHoy = ultimoPeso;
        repsHoy = nuevasReps;
        mensajeProgresion = `Última vez: ${ultimoPeso} kg × ${ultimasReps} · Meta hoy: ${pesoHoy} kg × ${repsHoy} o subir a ${pesoSubida} kg`;
      }
    }

    return {
      tieneHistorial: true,
      esPesoCorporal: esBodyweight,
      ultimoPeso,
      ultimasReps,
      ultimoRir,
      fechaUltima: historialEjercicio.fecha,
      pesoSugerido: pesoHoy,
      repsSugeridas: repsHoy,
      pesoAlternativoSubida: pesoSubida,
      mensajeProgresion
    };
  }

  function violaSinEquipo(ejercicio) {
    if (
      esEjercicioCardio(ejercicio) &&
      Array.isArray(ejercicio?.equipamiento) &&
      ejercicio.equipamiento.includes('peso_corporal')
    ) {
      return false;
    }
    const texto = `${ejercicio?.nombre || ''} ${ejercicio?.notaTecnica || ''}`.toLowerCase();
    return PALABRAS_PROHIBIDAS_SIN_EQUIPO.some((palabra) => texto.includes(palabra));
  }

  /**
   * Selección inteligente estilo Coach Real:
   * 1. Filtra ESTRICTAMENTE por equipamiento
   * 2. Filtra por NIVEL REAL (Principiante vs Intermedio vs Avanzado reciben EJERCICIOS DISTINTOS)
   * 3. Excluye ejercicios contraindicados si el usuario reportó molestias articulares
   */
  function obtenerEjerciciosPorNivelYEquipamiento(db, categoria, perfil, cantidad = 4) {
    const equipamiento = perfil?.equipamiento || 'gimnasio';
    const nivel = perfil?.nivel || 'intermedio';
    const molestias = detectarMolestias(perfil?.notasIA || '');

    const todos = db.catalogoEjercicios?.[categoria] || [];

    // 1. Filtro estricto de equipamiento
    const porEquipo = todos.filter((ej) => (ej.equipamiento || []).includes(equipamiento));
    const baseEquipo = porEquipo.length > 0 ? porEquipo : todos;

    // 2. Excluir contraindicados por molestias reportadas
    const seguros = molestias.length
      ? baseEquipo.filter((ej) => !(ej.contraindicaciones || []).some((c) => molestias.includes(c)))
      : baseEquipo;
    const poolSeguro = seguros.length > 0 ? seguros : baseEquipo;

    // 3. Priorizar estrictamente el NIVEL exacto del usuario
    const exactoNivel = poolSeguro.filter((ej) => (ej.niveles || []).includes(nivel));

    // Si faltan ejercicios para completar los 4, completamos desde el nivel adyacente más seguro
    const ordenRespaldo =
      nivel === 'principiante'
        ? ['intermedio', 'avanzado']
        : nivel === 'avanzado'
        ? ['intermedio', 'principiante']
        : ['principiante', 'avanzado'];

    const resultado = [...exactoNivel];
    for (const nivAlt of ordenRespaldo) {
      if (resultado.length >= cantidad) break;
      const candidatos = poolSeguro.filter(
        (ej) => (ej.niveles || []).includes(nivAlt) && !resultado.some((r) => r.id === ej.id)
      );
      for (const c of candidatos) {
        if (resultado.length < cantidad) resultado.push(c);
      }
    }

    return resultado.slice(0, cantidad);
  }

  /**
   * Genera el bloque de conocimiento curado (RAG) de nuestra base de datos propia
   * para entregarle a Gemini IA y que tome decisiones como un coach real.
   */
  async function construirContextoRAGParaIA(perfil) {
    const db = await cargarBaseDeDatos();
    const molestias = detectarMolestias(perfil?.notasIA || '');
    const criterioNivel = db.criteriosPorNivel?.[perfil?.nivel || 'intermedio'] || {};

    const opcionesCuradas = {
      Empuje: obtenerEjerciciosPorNivelYEquipamiento(db, 'Empuje', perfil, 5).map((e) => ({
        nombre: e.nombre,
        grupoMuscular: e.grupoMuscular,
        niveles: e.niveles,
        regresion: e.regresion,
        progresion: e.progresion,
        porQue: e.porQueEsteEjercicio
      })),
      Tirón: obtenerEjerciciosPorNivelYEquipamiento(db, 'Tirón', perfil, 5).map((e) => ({
        nombre: e.nombre,
        grupoMuscular: e.grupoMuscular,
        niveles: e.niveles,
        regresion: e.regresion,
        progresion: e.progresion,
        porQue: e.porQueEsteEjercicio
      })),
      Pierna: obtenerEjerciciosPorNivelYEquipamiento(db, 'Pierna', perfil, 5).map((e) => ({
        nombre: e.nombre,
        grupoMuscular: e.grupoMuscular,
        niveles: e.niveles,
        regresion: e.regresion,
        progresion: e.progresion,
        porQue: e.porQueEsteEjercicio
      })),
      Cardio: obtenerEjerciciosPorNivelYEquipamiento(db, 'Cardio', perfil, 6).map((e) => ({
        nombre: e.nombre,
        intensidadCardio: e.intensidadCardio,
        duracionMinutos: e.duracionMinutos,
        niveles: e.niveles,
        porQue: e.porQueEsteEjercicio
      }))
    };

    return {
      fuentesCientificas: db.meta?.fuentesMetodologicas || [],
      criterioNivel,
      molestiasDetectadas: molestias,
      catalogoRecomendadoBasePropia: opcionesCuradas
    };
  }

  function obtenerEstructuraSemanal(userProfile) {
    const split = userProfile?.divisionMuscular || 'PPL';
    const dias = Number(userProfile?.dias) || 4;

    if (split === 'Torso/Pierna') {
      return [
        { id: 'dia_1', divisionMuscular: 'Torso', titulo: 'Torso', categorias: ['Empuje', 'Tirón'] },
        { id: 'dia_2', divisionMuscular: 'Pierna', titulo: 'Pierna', categorias: ['Pierna'] }
      ];
    }

    if (split === 'Full Body') {
      return [
        { id: 'dia_1', divisionMuscular: 'Full Body A', titulo: 'Full Body A', categorias: ['Pierna', 'Empuje', 'Tirón'] },
        { id: 'dia_2', divisionMuscular: 'Full Body B', titulo: 'Full Body B', categorias: ['Empuje', 'Tirón', 'Pierna'] },
        ...(dias >= 3
          ? [{ id: 'dia_3', divisionMuscular: 'Full Body C', titulo: 'Full Body C', categorias: ['Pierna', 'Tirón', 'Empuje'] }]
          : [])
      ];
    }

    return [
      { id: 'dia_1', divisionMuscular: 'Empuje', titulo: 'Empuje', categorias: ['Empuje'] },
      { id: 'dia_2', divisionMuscular: 'Tirón', titulo: 'Tirón', categorias: ['Tirón'] },
      { id: 'dia_3', divisionMuscular: 'Pierna', titulo: 'Pierna', categorias: ['Pierna'] }
    ];
  }

  async function generarPlanSemanalLocal(userProfile, entrenamientos = [], modoDeload = false) {
    const db = await cargarBaseDeDatos();
    const equipamiento = userProfile?.equipamiento || 'gimnasio';
    const objetivo = userProfile?.objetivo || 'hipertrofia';
    const nivel = userProfile?.nivel || 'intermedio';
    const paramsObj = db.parametrosPorObjetivo?.[objetivo] || db.parametrosPorObjetivo.hipertrofia;
    const criterioNivel = db.criteriosPorNivel?.[nivel] || {};
    const molestias = detectarMolestias(userProfile?.notasIA || '');
    const estructura = obtenerEstructuraSemanal(userProfile);

    const seriesAjustadas = Math.max(2, (paramsObj.seriesBase || 3) + (criterioNivel.seriesAjuste || 0));

    const sesiones = estructura.map((dia, diaIdx) => {
      let seleccionados = [];
      if (dia.categorias.length === 1) {
        seleccionados = obtenerEjerciciosPorNivelYEquipamiento(db, dia.categorias[0], userProfile, 4);
      } else if (dia.categorias.length === 2) {
        seleccionados = [
          ...obtenerEjerciciosPorNivelYEquipamiento(db, dia.categorias[0], userProfile, 2),
          ...obtenerEjerciciosPorNivelYEquipamiento(db, dia.categorias[1], userProfile, 2)
        ];
      } else {
        const offset = diaIdx % 2;
        const pList = obtenerEjerciciosPorNivelYEquipamiento(db, 'Pierna', userProfile, 4);
        const eList = obtenerEjerciciosPorNivelYEquipamiento(db, 'Empuje', userProfile, 4);
        const tList = obtenerEjerciciosPorNivelYEquipamiento(db, 'Tirón', userProfile, 4);
        seleccionados = [
          pList[offset] || pList[0],
          eList[offset] || eList[0],
          tList[offset] || tList[0],
          pList[offset + 1] || pList[1] || pList[0],
          eList[offset + 1] || eList[1] || eList[0]
        ].filter(Boolean);
      }

      return {
        id: dia.id,
        divisionMuscular: dia.divisionMuscular,
        titulo: dia.titulo,
        enfoque: `${criterioNivel.titulo || paramsObj.nombre}`,
        ejercicios: seleccionados.map((ej) => ({
          ...ej,
          seriesObjetivo: seriesAjustadas,
          repsMin: paramsObj.repsMin,
          repsMax: paramsObj.repsMax,
          descansoSegundos:
            ej.tipo === 'compuesto' ? paramsObj.descansoCompuesto : paramsObj.descansoAislado,
          rirObjetivo: paramsObj.rirObjetivo
        }))
      };
    });

    const notaMolestia = molestias.length
      ? ` Protegimos articulaciones sensibles (${molestias.join(', ')}).`
      : '';

    const planBruto = {
      generadoPor: 'FORGE Coach · Base Biomecánica',
      fechaCreacion: new Date().toISOString().slice(0, 10),
      equipamiento,
      objetivo,
      nivel,
      objetivoNombre: paramsObj.nombre,
      mensajeCoach: `${criterioNivel.explicacion || 'Plan adaptado a tu nivel y equipamiento.'}${notaMolestia}`,
      sesiones
    };

    return await hidratarPlanConProgresion(planBruto, entrenamientos, userProfile, modoDeload);
  }

  async function hidratarPlanConProgresion(planSemanal, entrenamientos = [], userProfile = {}, modoDeload = false) {
    const db = await cargarBaseDeDatos();
    const equipamiento = userProfile?.equipamiento || planSemanal?.equipamiento || 'gimnasio';
    const objetivo = userProfile?.objetivo || planSemanal?.objetivo || 'hipertrofia';
    const nivel = userProfile?.nivel || planSemanal?.nivel || 'intermedio';
    const paramsObj = db.parametrosPorObjetivo?.[objetivo] || db.parametrosPorObjetivo.hipertrofia;
    const multNivel = db.multiplicadorNivel?.[nivel] || 1.0;
    const esSinEquipo = equipamiento === 'peso_corporal';

    const sesionesHidratadas = (planSemanal.sesiones || []).map((ses, sesIdx) => {
      const divLower = (ses.divisionMuscular || '').toLowerCase();
      const catFallback = divLower.includes('tir')
        ? 'Tirón'
        : divLower.includes('piern')
        ? 'Pierna'
        : 'Empuje';
      const backups = obtenerEjerciciosPorNivelYEquipamiento(db, catFallback, { ...userProfile, equipamiento, nivel }, 5);
      let backupCursor = 0;

      const ejerciciosLimpios = (ses.ejercicios || []).map((ejRaw, ejIdx) => {
        let ej = { ...ejRaw };

        if (esSinEquipo && !ej.manualUsuario && violaSinEquipo(ej)) {
          const reemplazo = backups[backupCursor % backups.length];
          backupCursor++;
          if (reemplazo) {
            ej = {
              ...reemplazo,
              seriesObjetivo: ej.seriesObjetivo || paramsObj.seriesBase,
              repsMin: ej.repsMin || paramsObj.repsMin,
              repsMax: ej.repsMax || paramsObj.repsMax,
              descansoSegundos: ej.descansoSegundos || 90,
              rirObjetivo: ej.rirObjetivo || paramsObj.rirObjetivo
            };
          }
        }

        const esCardio = esEjercicioCardio(ej);
        const intensidadCardio = esCardio ? ej.intensidadCardio || 'medio' : null;

        if (esSinEquipo && !ej.manualUsuario && !esCardio) {
          ej.pesoBaseIntermedio = 0;
          ej.pesoSugerido = 0;
          ej.esPesoCorporal = true;
        }

        const historialEj = buscarUltimoRegistroEjercicio(
          ej.nombre,
          ses.divisionMuscular,
          entrenamientos
        );

        const prescripcion = calcularPrescripcionProgresiva(
          ej,
          paramsObj,
          multNivel,
          historialEj,
          modoDeload,
          esSinEquipo
        );

        let numSeries = esCardio
          ? Number(ej.seriesObjetivo) || ej.series?.length || 1
          : Number(ej.seriesObjetivo) || paramsObj.seriesBase || 3;
        if (modoDeload) {
          numSeries = esCardio ? Math.max(1, numSeries) : Math.max(2, Math.round(numSeries * 0.6));
        }

        const descansoSeg = esCardio
          ? Number(ej.descansoSegundos) || (intensidadCardio === 'intenso' ? 90 : 60)
          : Number(ej.descansoSegundos) ||
            (ej.tipo === 'aislado' ? paramsObj.descansoAislado : paramsObj.descansoCompuesto) ||
            90;

        const seriesPrellenadas = Array.from({ length: numSeries }, (_, sIdx) => ({
          numeroSerie: sIdx + 1,
          peso: esCardio ? 0 : prescripcion.pesoSugerido,
          reps: esCardio ? 0 : prescripcion.repsSugeridas,
          tiempo_minutos: esCardio ? prescripcion.tiempoSugerido : 0,
          descanso_segundos: descansoSeg,
          rir: Number(ej.rirObjetivo) || paramsObj.rirObjetivo || 2,
          completada: false
        }));

        return {
          id: ej.id || `plan_${sesIdx}_ej_${ejIdx}`,
          orden: ejIdx + 1,
          nombre: ej.nombre,
          grupoMuscular: ej.grupoMuscular || (esCardio ? 'Cardio' : ses.divisionMuscular),
          tipo: esCardio ? 'cardio' : ej.tipo || 'compuesto',
          esCardio,
          intensidadCardio,
          duracionMinutos: esCardio ? prescripcion.tiempoSugerido : 0,
          esPesoCorporal: esCardio ? true : prescripcion.esPesoCorporal,
          regresion: ej.regresion || (esCardio ? 'Reducí 3–5 min o bajá un escalón de intensidad' : 'Variante más accesible con menor brazo de palanca'),
          progresion: ej.progresion || (esCardio ? 'Sumá 2–3 min o subí al siguiente nivel de intensidad' : 'Variante más exigente o pausa de 2 segundos'),
          notaTecnica: ej.notaTecnica || (esCardio ? 'Mantené respiración controlada y ritmo constante durante todo el bloque.' : 'Mantené el abdomen firme y controlá la bajada.'),
          porQueEsteEjercicio:
            ej.porQueEsteEjercicio ||
            ej.porQue ||
            `Elegido para tu nivel ${nivel} respetando tu equipamiento disponible.`,
          seriesObjetivo: numSeries,
          repsMin: esCardio ? 0 : Number(ej.repsMin) || paramsObj.repsMin || 8,
          repsMax: esCardio ? 0 : Number(ej.repsMax) || paramsObj.repsMax || 12,
          descansoSegundos: descansoSeg,
          rirObjetivo: Number(ej.rirObjetivo) || paramsObj.rirObjetivo || 2,
          niveles: ej.niveles || [nivel],
          equipamiento: ej.equipamiento || [equipamiento],
          contraindicaciones: ej.contraindicaciones || [],
          manualUsuario: Boolean(ej.manualUsuario),
          prescripcion,
          series: seriesPrellenadas
        };
      });

      return {
        id: ses.id || `dia_${sesIdx + 1}`,
        divisionMuscular: ses.divisionMuscular || `Día ${sesIdx + 1}`,
        titulo: ses.titulo || ses.divisionMuscular || `Día ${sesIdx + 1}`,
        enfoque: ses.enfoque || '',
        objetivoNombre: paramsObj.nombre,
        esDiaCardio:
          ses.esDiaCardio !== undefined
            ? Boolean(ses.esDiaCardio)
            : ejerciciosLimpios.length > 0 && ejerciciosLimpios.every((e) => esEjercicioCardio(e)),
        salteadoSemana: Boolean(ses.salteadoSemana),
        fechaSalteado: ses.fechaSalteado || null,
        modificadaPorUsuario: Boolean(ses.modificadaPorUsuario),
        ejercicios: ejerciciosLimpios
      };
    });

    return {
      ...planSemanal,
      equipamiento,
      objetivo,
      nivel,
      objetivoNombre: paramsObj.nombre,
      sesiones: sesionesHidratadas
    };
  }

  /**
   * Devuelve el catálogo plano de toda la base de datos para el buscador de ejercicios
   */
  async function obtenerCatalogoCompleto() {
    const db = await cargarBaseDeDatos();
    const lista = [];
    Object.entries(db.catalogoEjercicios || {}).forEach(([categoria, ejercicios]) => {
      (ejercicios || []).forEach((ej) => {
        lista.push({ ...ej, categoria });
      });
    });
    return lista;
  }

  /**
   * Hidrata un único ejercicio (elegido del buscador o creado por el usuario) listo para insertar en la sesión
   */
  async function construirEjercicioListo(ejBase, userProfile = {}, entrenamientos = [], modoDeload = false) {
    const db = await cargarBaseDeDatos();
    const objetivo = userProfile?.objetivo || 'hipertrofia';
    const nivel = userProfile?.nivel || 'intermedio';
    const paramsObj = db.parametrosPorObjetivo?.[objetivo] || db.parametrosPorObjetivo.hipertrofia;
    const multNivel = db.multiplicadorNivel?.[nivel] || 1.0;

    const esCardio = esEjercicioCardio(ejBase);
    const intensidadCardio = esCardio ? ejBase.intensidadCardio || 'medio' : null;
    const esPesoCorporal = esCardio
      ? true
      : ejBase.esPesoCorporal !== undefined
      ? Boolean(ejBase.esPesoCorporal)
      : Number(ejBase.pesoBaseIntermedio ?? ejBase.pesoSugerido ?? 0) === 0;

    const historialEj = buscarUltimoRegistroEjercicio(ejBase.nombre, '', entrenamientos);
    const prescripcion = calcularPrescripcionProgresiva(
      { ...ejBase, esCardio, intensidadCardio, esPesoCorporal },
      paramsObj,
      multNivel,
      historialEj,
      modoDeload,
      esPesoCorporal
    );

    const numSeries = esCardio
      ? Number(ejBase.seriesObjetivo) || 1
      : Number(ejBase.seriesObjetivo) || paramsObj.seriesBase || 3;
    const descansoSeg = esCardio
      ? Number(ejBase.descansoSegundos) || (intensidadCardio === 'intenso' ? 90 : 60)
      : Number(ejBase.descansoSegundos) ||
        (ejBase.tipo === 'aislado' ? paramsObj.descansoAislado : paramsObj.descansoCompuesto) ||
        90;

    return {
      id: ejBase.id || `custom_${Date.now()}`,
      nombre: ejBase.nombre,
      grupoMuscular: ejBase.grupoMuscular || (esCardio ? `Cardio · ${etiquetaIntensidadCardio(intensidadCardio)}` : 'Personalizado'),
      tipo: esCardio ? 'cardio' : ejBase.tipo || 'compuesto',
      esCardio,
      intensidadCardio,
      duracionMinutos: esCardio ? prescripcion.tiempoSugerido : 0,
      esPesoCorporal,
      regresion: ejBase.regresion || (esCardio ? 'Reducí 3–5 min o bajá un escalón de intensidad' : 'Variante con menor carga o recorrido controlado'),
      progresion: ejBase.progresion || (esCardio ? 'Sumá 2–3 min o subí de intensidad' : 'Aumentá peso, repeticiones o agregá pausa de 2s'),
      notaTecnica: ejBase.notaTecnica || (esCardio ? 'Mantené respiración controlada y ritmo constante durante todo el bloque.' : 'Controlá el descenso y mantené técnica estricta en todo el rango.'),
      porQueEsteEjercicio:
        ejBase.porQueEsteEjercicio || 'Agregado manualmente por vos a esta sesión.',
      seriesObjetivo: numSeries,
      repsMin: esCardio ? 0 : Number(ejBase.repsMin) || paramsObj.repsMin || 8,
      repsMax: esCardio ? 0 : Number(ejBase.repsMax) || paramsObj.repsMax || 12,
      descansoSegundos: descansoSeg,
      rirObjetivo: Number(ejBase.rirObjetivo) || paramsObj.rirObjetivo || 2,
      niveles: ejBase.niveles || [nivel],
      equipamiento: ejBase.equipamiento || [userProfile?.equipamiento || 'gimnasio'],
      contraindicaciones: ejBase.contraindicaciones || [],
      sensacionIdx: 2,
      manualUsuario: true,
      prescripcion,
      series: Array.from({ length: numSeries }, (_, idx) => ({
        numeroSerie: idx + 1,
        peso: esCardio ? 0 : prescripcion.pesoSugerido,
        reps: esCardio ? 0 : prescripcion.repsSugeridas,
        tiempo_minutos: esCardio ? prescripcion.tiempoSugerido : 0,
        descanso_segundos: descansoSeg,
        rir: Number(ejBase.rirObjetivo) || paramsObj.rirObjetivo || 2,
        completada: false
      }))
    };
  }

  /**
   * Crea una nueva sesión (día) lista para agregar al plan semanal del usuario:
   * - 'cardio_intenso' | 'cardio_medio' | 'cardio_bajo'
   * - 'Empuje' | 'Tirón' | 'Pierna' | 'Full Body' | 'libre'
   */
  async function crearSesionParaPlan(tipo = 'cardio_medio', opciones = {}, userProfile = {}, entrenamientos = [], modoDeload = false) {
    const db = await cargarBaseDeDatos();
    const equipamiento = userProfile?.equipamiento || 'gimnasio';
    const objetivo = userProfile?.objetivo || 'hipertrofia';
    const nivel = userProfile?.nivel || 'intermedio';
    const paramsObj = db.parametrosPorObjetivo?.[objetivo] || db.parametrosPorObjetivo.hipertrofia;
    const criterioNivel = db.criteriosPorNivel?.[nivel] || {};
    const seriesAjustadas = Math.max(2, (paramsObj.seriesBase || 3) + (criterioNivel.seriesAjuste || 0));
    const molestias = detectarMolestias(userProfile?.notasIA || '');

    let titulo = (opciones.titulo || '').trim();
    let enfoque = '';
    let esDiaCardio = false;
    let seleccionados = [];

    if (tipo.startsWith('cardio_')) {
      esDiaCardio = true;
      const intensidad = tipo.replace('cardio_', ''); // 'intenso' | 'medio' | 'bajo'
      const labelInt = etiquetaIntensidadCardio(intensidad);
      if (!titulo) {
        titulo =
          intensidad === 'intenso'
            ? 'Cardio HIIT / Tabata'
            : intensidad === 'bajo'
            ? 'Cardio Sin Impacto'
            : 'Cardio Moderado';
      }
      enfoque = `Solo por tiempo · ${labelInt}`;

      const todosCardio = db.catalogoEjercicios?.Cardio || [];
      const porIntensidad = todosCardio.filter((c) => c.intensidadCardio === intensidad);
      const porEquipo = porIntensidad.filter((c) => (c.equipamiento || []).includes(equipamiento));
      const base = porEquipo.length ? porEquipo : porIntensidad;
      const seguros = molestias.length
        ? base.filter((c) => !(c.contraindicaciones || []).some((m) => molestias.includes(m)))
        : base;
      const pool = seguros.length ? seguros : base;
      seleccionados = pool.slice(0, intensidad === 'intenso' ? 2 : 1);
    } else if (tipo === 'Full Body') {
      if (!titulo) titulo = 'Full Body Extra';
      enfoque = 'Cuerpo completo';
      const pList = obtenerEjerciciosPorNivelYEquipamiento(db, 'Pierna', userProfile, 2);
      const eList = obtenerEjerciciosPorNivelYEquipamiento(db, 'Empuje', userProfile, 2);
      const tList = obtenerEjerciciosPorNivelYEquipamiento(db, 'Tirón', userProfile, 2);
      seleccionados = [pList[0], eList[0], tList[0], pList[1] || eList[1]].filter(Boolean);
    } else if (tipo === 'Empuje' || tipo === 'Tirón' || tipo === 'Pierna') {
      if (!titulo) titulo = tipo;
      enfoque = criterioNivel.titulo || paramsObj.nombre;
      seleccionados = obtenerEjerciciosPorNivelYEquipamiento(db, tipo, userProfile, 4);
    } else {
      if (!titulo) titulo = 'Día Personalizado';
      enfoque = 'Armado a tu medida';
      seleccionados = [];
    }

    const ejerciciosHidratados = [];
    for (const ejBase of seleccionados) {
      const esC = esEjercicioCardio(ejBase);
      const listo = await construirEjercicioListo(
        {
          ...ejBase,
          seriesObjetivo: esC ? ejBase.seriesObjetivo || 1 : seriesAjustadas,
          repsMin: esC ? 0 : paramsObj.repsMin,
          repsMax: esC ? 0 : paramsObj.repsMax
        },
        userProfile,
        entrenamientos,
        modoDeload
      );
      ejerciciosHidratados.push(listo);
    }

    return {
      id: `dia_custom_${Date.now()}`,
      divisionMuscular: titulo,
      titulo,
      enfoque,
      objetivoNombre: paramsObj.nombre,
      esDiaCardio,
      salteadoSemana: false,
      fechaSalteado: null,
      modificadaPorUsuario: false,
      ejercicios: ejerciciosHidratados
    };
  }

  /**
   * Auditoría biomecánica completa de una sesión modificada por el usuario
   */
  function analizarRutinaModificada(sesion, userProfile = {}) {
    const ejercicios = sesion?.ejercicios || [];
    const nivel = userProfile?.nivel || 'intermedio';
    const eq = userProfile?.equipamiento || 'gimnasio';
    const objetivo = userProfile?.objetivo || 'hipertrofia';
    const molestias = detectarMolestias(userProfile?.notasIA || '');

    const cardio = ejercicios.filter((e) => esEjercicioCardio(e));
    const fuerza = ejercicios.filter((e) => !esEjercicioCardio(e));
    const totalSeriesFuerza = fuerza.reduce((acc, e) => acc + (e.series?.length || 0), 0);
    const totalSeries = totalSeriesFuerza;
    const totalMinCardio = cardio.reduce(
      (acc, e) =>
        acc +
        (e.series || []).reduce((m, s) => m + (Number(s.tiempo_minutos) || Number(e.duracionMinutos) || 0), 0),
      0
    );
    const compuestos = fuerza.filter((e) => e.tipo === 'compuesto');
    const aislados = fuerza.filter((e) => e.tipo === 'aislado');

    const fortalezas = [];
    const alertas = [];
    const ajustes = [];
    let puntaje = 100;

    // 1. Volumen efectivo de la sesión (Israetel MEV / MRV diario + Cardio por tiempo)
    if (ejercicios.length === 0) {
      puntaje = 0;
      alertas.push('La sesión quedó vacía. Agregá al menos 3 ejercicios o un bloque de cardio desde el buscador.');
    } else if (fuerza.length === 0 && cardio.length > 0) {
      fortalezas.push(`Sesión dedicada de cardio (${totalMinCardio} min totales en ${cardio.length} bloque${cardio.length > 1 ? 's' : ''}).`);
      const minIntenso = cardio
        .filter((c) => c.intensidadCardio === 'intenso')
        .reduce((acc, e) => acc + (e.series || []).reduce((m, s) => m + (Number(s.tiempo_minutos) || 0), 0), 0);
      if (minIntenso > 30) {
        puntaje -= 12;
        alertas.push(`Mucho tiempo de HIIT/Tabata (${minIntenso} min). Pasados ~20–25 min cae la potencia real.`);
        ajustes.push('Combiná 10–15 min de HIIT con un bloque de cardio Bajo (sin impacto) para enfriar.');
      }
    } else if (totalSeriesFuerza < 8) {
      puntaje -= 18;
      alertas.push(`Volumen de fuerza bajo (${totalSeriesFuerza} series). Para ${objetivo} suele rendir mejor entre 10 y 18 series por sesión.`);
      ajustes.push('Sumá 1 ejercicio compuesto o agregá 1 serie extra a tus ejercicios principales.');
    } else if (totalSeriesFuerza > 22) {
      puntaje -= 20;
      alertas.push(`Volumen excesivo (${totalSeriesFuerza} series de fuerza). Pasadas las ~20 series aumenta la fatiga basura.`);
      ajustes.push('Recortá 1 ejercicio accesorio o dejá 3 series efectivas por movimiento para sostener la intensidad.');
    } else {
      const extraCardio = totalMinCardio > 0 ? ` + ${totalMinCardio} min de cardio` : '';
      fortalezas.push(`Volumen en rango óptimo (${totalSeriesFuerza} series de fuerza${extraCardio}).`);
    }

    // 2. Orden biomecánico (Compuestos primero -> Aislados -> Cardio al final)
    let desordenado = false;
    let vioAislado = false;
    let vioCardio = false;
    let cardioAntesDeFuerza = false;
    ejercicios.forEach((e) => {
      const esC = esEjercicioCardio(e);
      if (esC) {
        vioCardio = true;
      } else {
        if (vioCardio && e.tipo === 'compuesto') cardioAntesDeFuerza = true;
        if (e.tipo === 'aislado') vioAislado = true;
        if (e.tipo === 'compuesto' && vioAislado) desordenado = true;
      }
    });

    if (cardioAntesDeFuerza) {
      desordenado = true;
      puntaje -= 14;
      alertas.push('Tenés cardio antes de ejercicios compuestos de fuerza: puede restarte energía y estabilidad.');
      ajustes.push('Mové el cardio al final de la sesión (el botón de abajo ordena Fuerza primero y Cardio al final).');
    } else if (desordenado) {
      puntaje -= 12;
      alertas.push('Orden subóptimo: tenés ejercicios aislados antes de ejercicios compuestos.');
      ajustes.push('Mové los compuestos al principio cuando tu sistema nervioso está fresco (podés hacerlo en 1 toque abajo).');
    } else if (compuestos.length > 0) {
      fortalezas.push(
        cardio.length > 0
          ? 'Orden óptimo: fuerza compuesta primero y cardio al final de la sesión.'
          : 'Orden biomecánico correcto: los movimientos multiarticulares van primero.'
      );
    }

    // 3. Compatibilidad de nivel
    if (nivel === 'principiante') {
      const avanzados = ejercicios.filter(
        (e) => Array.isArray(e.niveles) && e.niveles.includes('avanzado') && !e.niveles.includes('principiante')
      );
      if (avanzados.length > 0) {
        puntaje -= 15;
        alertas.push(
          `Agregaste ejercicios de alta exigencia para nivel principiante: ${avanzados.map((a) => a.nombre).join(', ')}.`
        );
        ajustes.push('Si te cuesta controlar la técnica o el pulso, reemplazalo por una variante de nivel inicial.');
      }
    }

    // 4. Contraindicaciones por molestias reportadas + reconocimiento cardio sin impacto
    if (molestias.length > 0) {
      const riesgosos = ejercicios.filter((e) =>
        (e.contraindicaciones || []).some((c) => molestias.includes(c))
      );
      if (riesgosos.length > 0) {
        puntaje -= 20;
        alertas.push(
          `Ojo articular (${molestias.join(', ')}): revisá ${riesgosos.map((r) => r.nombre).join(', ')} porque puede irritar la zona.`
        );
        ajustes.push('Reemplazá el ejercicio marcado o pasá a cardio Bajo (sin impacto) / rango sin dolor.');
      } else {
        fortalezas.push(`Todos los ejercicios actuales cuidan tus articulaciones reportadas (${molestias.join(', ')}).`);
      }

      if (
        (molestias.includes('rodilla') || molestias.includes('lumbar')) &&
        cardio.some((c) => c.intensidadCardio === 'bajo')
      ) {
        fortalezas.push('Muy buena elección de cardio Bajo (sin impacto) para proteger rodillas y zona lumbar.');
      }
    }

    // 5. Compatibilidad de equipamiento
    if (eq === 'peso_corporal') {
      const conEquipo = ejercicios.filter((e) => violaSinEquipo(e));
      if (conEquipo.length > 0) {
        puntaje -= 10;
        alertas.push(`Agregaste movimientos que requieren equipo (${conEquipo.map((c) => c.nombre).join(', ')}) aunque tu perfil es sin herramientas.`);
      }
    }

    // 6. Balance compuestos vs aislados (solo si hay trabajo de fuerza)
    if (fuerza.length >= 3 && compuestos.length === 0) {
      puntaje -= 15;
      alertas.push('Faltan ejercicios compuestos multiarticulares (son la base de la sobrecarga progresiva).');
      ajustes.push('Incorporá al menos 2 ejercicios compuestos para los grupos principales de este día.');
    } else if (compuestos.length > 0 && aislados.length > 0) {
      fortalezas.push(`Buen equilibrio entre compuestos (${compuestos.length}) y aislados (${aislados.length}).`);
    }

    puntaje = Math.max(20, Math.min(100, puntaje));
    const estado =
      puntaje >= 85 ? 'RUTINA ÓPTIMA' : puntaje >= 65 ? 'BUENA · CON AJUSTES' : 'REQUIERE AJUSTES';

    return {
      puntaje,
      estado,
      totalSeries,
      totalMinCardio,
      desordenado,
      fortalezas,
      alertas,
      ajustes
    };
  }

  return {
    cargarBaseDeDatos,
    calcular1RMEpley,
    calcular1RMBrzycki,
    calcularTonelajeSeries,
    redondearPasoDisco,
    detectarMolestias,
    etiquetaIntensidadCardio,
    esEjercicioCardio,
    buscarUltimoRegistroEjercicio,
    calcularPrescripcionProgresiva,
    violaSinEquipo,
    obtenerEjerciciosPorNivelYEquipamiento,
    construirContextoRAGParaIA,
    obtenerEstructuraSemanal,
    generarPlanSemanalLocal,
    hidratarPlanConProgresion,
    obtenerCatalogoCompleto,
    construirEjercicioListo,
    crearSesionParaPlan,
    analizarRutinaModificada
  };
})();

window.MotorEntrenamiento = MotorEntrenamiento;
