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
        const validas = ej.series.filter((s) => Number(s.reps) > 0);
        if (!validas.length) continue;

        const mejorSerie = validas.reduce((best, curr) => {
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

        if (esSinEquipo && !ej.manualUsuario) {
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

        let numSeries = Number(ej.seriesObjetivo) || paramsObj.seriesBase || 3;
        if (modoDeload) {
          numSeries = Math.max(2, Math.round(numSeries * 0.6));
        }

        const descansoSeg =
          Number(ej.descansoSegundos) ||
          (ej.tipo === 'aislado' ? paramsObj.descansoAislado : paramsObj.descansoCompuesto) ||
          90;

        const seriesPrellenadas = Array.from({ length: numSeries }, (_, sIdx) => ({
          numeroSerie: sIdx + 1,
          peso: prescripcion.pesoSugerido,
          reps: prescripcion.repsSugeridas,
          descanso_segundos: descansoSeg,
          rir: Number(ej.rirObjetivo) || paramsObj.rirObjetivo || 2,
          completada: false
        }));

        return {
          id: ej.id || `plan_${sesIdx}_ej_${ejIdx}`,
          orden: ejIdx + 1,
          nombre: ej.nombre,
          grupoMuscular: ej.grupoMuscular || ses.divisionMuscular,
          tipo: ej.tipo || 'compuesto',
          esPesoCorporal: prescripcion.esPesoCorporal,
          regresion: ej.regresion || 'Variante más accesible con menor brazo de palanca',
          progresion: ej.progresion || 'Variante más exigente o pausa de 2 segundos',
          notaTecnica: ej.notaTecnica || 'Mantené el abdomen firme y controlá la bajada.',
          porQueEsteEjercicio:
            ej.porQueEsteEjercicio ||
            ej.porQue ||
            `Elegido para tu nivel ${nivel} respetando tu equipamiento disponible.`,
          seriesObjetivo: numSeries,
          repsMin: Number(ej.repsMin) || paramsObj.repsMin || 8,
          repsMax: Number(ej.repsMax) || paramsObj.repsMax || 12,
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

    const esPesoCorporal =
      ejBase.esPesoCorporal !== undefined
        ? Boolean(ejBase.esPesoCorporal)
        : Number(ejBase.pesoBaseIntermedio ?? ejBase.pesoSugerido ?? 0) === 0;

    const historialEj = buscarUltimoRegistroEjercicio(ejBase.nombre, '', entrenamientos);
    const prescripcion = calcularPrescripcionProgresiva(
      { ...ejBase, esPesoCorporal },
      paramsObj,
      multNivel,
      historialEj,
      modoDeload,
      esPesoCorporal
    );

    const numSeries = Number(ejBase.seriesObjetivo) || paramsObj.seriesBase || 3;
    const descansoSeg =
      Number(ejBase.descansoSegundos) ||
      (ejBase.tipo === 'aislado' ? paramsObj.descansoAislado : paramsObj.descansoCompuesto) ||
      90;

    return {
      id: ejBase.id || `custom_${Date.now()}`,
      nombre: ejBase.nombre,
      grupoMuscular: ejBase.grupoMuscular || 'Personalizado',
      tipo: ejBase.tipo || 'compuesto',
      esPesoCorporal,
      regresion: ejBase.regresion || 'Variante con menor carga o recorrido controlado',
      progresion: ejBase.progresion || 'Aumentá peso, repeticiones o agregá pausa de 2s',
      notaTecnica: ejBase.notaTecnica || 'Controlá el descenso y mantené técnica estricta en todo el rango.',
      porQueEsteEjercicio:
        ejBase.porQueEsteEjercicio || 'Agregado manualmente por vos a esta sesión.',
      seriesObjetivo: numSeries,
      repsMin: Number(ejBase.repsMin) || paramsObj.repsMin || 8,
      repsMax: Number(ejBase.repsMax) || paramsObj.repsMax || 12,
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
        peso: prescripcion.pesoSugerido,
        reps: prescripcion.repsSugeridas,
        descanso_segundos: descansoSeg,
        rir: Number(ejBase.rirObjetivo) || paramsObj.rirObjetivo || 2,
        completada: false
      }))
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

    const totalSeries = ejercicios.reduce((acc, e) => acc + (e.series?.length || 0), 0);
    const compuestos = ejercicios.filter((e) => e.tipo === 'compuesto');
    const aislados = ejercicios.filter((e) => e.tipo === 'aislado');

    const fortalezas = [];
    const alertas = [];
    const ajustes = [];
    let puntaje = 100;

    // 1. Volumen efectivo de la sesión (Israetel MEV / MRV diario)
    if (ejercicios.length === 0) {
      puntaje = 0;
      alertas.push('La sesión quedó vacía. Agregá al menos 3 ejercicios desde el buscador.');
    } else if (totalSeries < 8) {
      puntaje -= 18;
      alertas.push(`Volumen bajo (${totalSeries} series totales). Para ${objetivo} suele rendir mejor entre 10 y 18 series por sesión.`);
      ajustes.push('Sumá 1 ejercicio compuesto o agregá 1 serie extra a tus ejercicios principales.');
    } else if (totalSeries > 22) {
      puntaje -= 20;
      alertas.push(`Volumen excesivo (${totalSeries} series). Pasadas las ~20 series en una sola sesión aumenta la fatiga basura.`);
      ajustes.push('Recortá 1 ejercicio accesorio o dejá 3 series efectivas por movimiento para sostener la intensidad.');
    } else {
      fortalezas.push(`Volumen en rango óptimo (${totalSeries} series efectivas en ${ejercicios.length} ejercicios).`);
    }

    // 2. Orden biomecánico (Compuestos primero -> Aislados al final)
    let desordenado = false;
    let vioAislado = false;
    ejercicios.forEach((e) => {
      if (e.tipo === 'aislado') vioAislado = true;
      if (e.tipo === 'compuesto' && vioAislado) desordenado = true;
    });
    if (desordenado) {
      puntaje -= 12;
      alertas.push('Orden subóptimo: tenés ejercicios aislados antes de ejercicios compuestos.');
      ajustes.push('Mové los compuestos al principio cuando tu sistema nervioso está fresco (podés hacerlo en 1 toque abajo).');
    } else if (compuestos.length > 0) {
      fortalezas.push('Orden biomecánico correcto: los movimientos multiarticulares van primero.');
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
        ajustes.push('Si te cuesta controlar la bajada, tocá el menú del ejercicio y reemplazalo por una variante de nivel inicial.');
      }
    }

    // 4. Contraindicaciones por molestias reportadas
    if (molestias.length > 0) {
      const riesgosos = ejercicios.filter((e) =>
        (e.contraindicaciones || []).some((c) => molestias.includes(c))
      );
      if (riesgosos.length > 0) {
        puntaje -= 20;
        alertas.push(
          `Ojo articular (${molestias.join(', ')}): revisá ${riesgosos.map((r) => r.nombre).join(', ')} porque puede irritar la zona.`
        );
        ajustes.push('Reemplazá el ejercicio marcado o reducí el rango de movimiento sin dolor.');
      } else {
        fortalezas.push(`Todos los ejercicios actuales cuidan tus articulaciones reportadas (${molestias.join(', ')}).`);
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

    // 6. Balance compuestos vs aislados
    if (ejercicios.length >= 3 && compuestos.length === 0) {
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
    analizarRutinaModificada
  };
})();

window.MotorEntrenamiento = MotorEntrenamiento;
