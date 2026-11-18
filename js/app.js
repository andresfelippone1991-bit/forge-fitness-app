/**
 * js/app.js
 * FORGE — Inspirado en TITUS (titus.fitness/landing#metodo)
 * "Lee cada serie que registrás y ajusta tu plan"
 * 4 pantallas diferenciadas: Entrenar · Plan · Coach (Consulta Libre) · Progreso & Ajustes + Onboarding 5 pasos
 */

const AppFORGE = (() => {
  const STORAGE_KEYS = {
    USER_PROFILE: 'userProfile',
    USER_PLAN: 'userPlan',
    ENTRENAMIENTOS: 'entrenamientos',
    METRICAS: 'metricasCorporales',
    COACH_CHAT: 'forge_coach_chat',
    GEMINI_KEY: 'forge_gemini_api_key'
  };

  const DEFAULT_API_KEY = '';
  const ROMANOS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

  // 5 niveles de sensación idénticos al método TITUS
  const SENSACIONES = [
    { idx: 0, label: 'SOBRÓ', rir: 4, desc: 'Sobró mucho margen' },
    { idx: 1, label: 'CÓMODO', rir: 3, desc: 'Margen amplio' },
    { idx: 2, label: 'JUSTO', rir: 2, desc: 'Zona óptima · RPE 8' },
    { idx: 3, label: 'ME COSTÓ', rir: 1, desc: 'Muy exigente' },
    { idx: 4, label: 'AL FALLO', rir: 0, desc: 'Al límite máximo' }
  ];

  const CARDIO_BADGES = {
    intenso: {
      label: 'INTENSO · HIIT / TABATA',
      short: 'Intenso (HIIT/Tabata)',
      cls: 'bg-red-500/15 border-red-400/35 text-red-300'
    },
    medio: {
      label: 'MEDIO · AERÓBICO',
      short: 'Medio',
      cls: 'bg-gold/15 border-gold/40 text-gold-hi'
    },
    bajo: {
      label: 'BAJO · SIN IMPACTO',
      short: 'Bajo (Sin impacto)',
      cls: 'bg-mint/10 border-mint/30 text-mint'
    }
  };

  function obtenerBadgeCardio(intensidad = 'medio') {
    return CARDIO_BADGES[intensidad] || CARDIO_BADGES.medio;
  }

  let state = {
    vista: 'entrenar', // 'onboarding' | 'entrenar' | 'plan' | 'coach' | 'progreso'
    subTabProgreso: 'progreso', // 'progreso' | 'ajustes'
    pasoOnboarding: 1,
    totalPasosOnboarding: 5,
    userProfile: null,
    userPlan: null,
    sesionIdx: 0,
    entrenamientos: [],
    metricasCorporales: [],
    chatMensajes: [],
    chatEnviando: false,
    modoDeload: false,
    pasoDisco: 2.5,
    generandoIA: false,
    ejercicioGrafico: '',
    descanso: {
      activo: false,
      etiqueta: 'Descanso',
      total: 90,
      restante: 0,
      finTs: null,
      interval: null
    }
  };

  let draftOnboarding = {
    nombre: 'Atleta',
    objetivo: 'hipertrofia',
    equipamiento: 'peso_corporal',
    dias: 4,
    divisionMuscular: 'PPL',
    nivel: 'intermedio',
    notasIA: ''
  };

  function aRomano(n) {
    return ROMANOS[n] || String(n + 1);
  }

  function formatearTiempo(seg) {
    const s = Math.max(0, Number(seg) || 90);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }

  /**
   * =========================================================================
   * 1. PERSISTENCIA EN LOCALSTORAGE
   * =========================================================================
   */
  function cargarLocalStorage() {
    try {
      const rawProfile = localStorage.getItem(STORAGE_KEYS.USER_PROFILE);
      if (rawProfile) {
        state.userProfile = JSON.parse(rawProfile);
        if (state.userProfile.pasoDisco) state.pasoDisco = Number(state.userProfile.pasoDisco);
      }
    } catch (e) {}

    try {
      const rawPlan = localStorage.getItem(STORAGE_KEYS.USER_PLAN);
      if (rawPlan) {
        const parsed = JSON.parse(rawPlan);
        if (parsed && Array.isArray(parsed.sesiones) && parsed.sesiones.length > 0) {
          state.userPlan = parsed;
        }
      }
    } catch (e) {
      state.userPlan = null;
    }

    try {
      const rawEnt = localStorage.getItem(STORAGE_KEYS.ENTRENAMIENTOS);
      if (rawEnt) {
        const parsed = JSON.parse(rawEnt);
        if (Array.isArray(parsed)) state.entrenamientos = parsed;
        else if (parsed && Array.isArray(parsed.entrenamientos)) state.entrenamientos = parsed.entrenamientos;
      }
    } catch (e) {
      state.entrenamientos = [];
    }

    try {
      const rawMet = localStorage.getItem(STORAGE_KEYS.METRICAS);
      if (rawMet) state.metricasCorporales = JSON.parse(rawMet) || [];
    } catch (e) {
      state.metricasCorporales = [];
    }

    try {
      const rawChat = localStorage.getItem(STORAGE_KEYS.COACH_CHAT);
      if (rawChat) state.chatMensajes = JSON.parse(rawChat) || [];
    } catch (e) {
      state.chatMensajes = [];
    }
  }

  function guardarProfile(perfil) {
    state.userProfile = perfil;
    localStorage.setItem(STORAGE_KEYS.USER_PROFILE, JSON.stringify(perfil));
  }

  function guardarUserPlan(plan) {
    state.userPlan = plan;
    localStorage.setItem(STORAGE_KEYS.USER_PLAN, JSON.stringify(plan));
  }

  function guardarEntrenamientos(lista) {
    state.entrenamientos = lista;
    localStorage.setItem(
      STORAGE_KEYS.ENTRENAMIENTOS,
      JSON.stringify({ entrenamientos: lista }, null, 2)
    );
  }

  function guardarMetricas(lista) {
    state.metricasCorporales = lista;
    localStorage.setItem(STORAGE_KEYS.METRICAS, JSON.stringify(lista));
  }

  function guardarChat(mensajes) {
    state.chatMensajes = mensajes;
    localStorage.setItem(STORAGE_KEYS.COACH_CHAT, JSON.stringify(mensajes.slice(-20)));
  }

  function obtenerSesionActual() {
    if (!state.userPlan?.sesiones?.length) return null;
    const idx = Math.min(state.sesionIdx, state.userPlan.sesiones.length - 1);
    return state.userPlan.sesiones[idx];
  }

  function cargarSemillaDemo() {
    const perfilDemo = {
      nombre: 'Atleta FORGE',
      dias: 4,
      divisionMuscular: 'PPL',
      equipamiento: 'gimnasio',
      objetivo: 'hipertrofia',
      nivel: 'intermedio',
      notasIA: '',
      pasoDisco: 2.5,
      onboardingCompletado: true
    };

    const entrenamientosDemo = [
      {
        id: '09-11-2026',
        fecha: '2026-11-09',
        divisionMuscular: 'Empuje',
        ejercicios: [
          {
            nombre: 'Press de Banca',
            series: [
              { peso: 77.5, reps: 8, descanso_segundos: 120, rir: 2 },
              { peso: 80, reps: 8, descanso_segundos: 120, rir: 2 },
              { peso: 82.5, reps: 6, descanso_segundos: 120, rir: 2 }
            ]
          }
        ]
      },
      {
        id: '15-11-2026',
        fecha: '2026-11-15',
        divisionMuscular: 'Empuje',
        ejercicios: [
          {
            nombre: 'Press de Banca',
            series: [
              { peso: 80, reps: 8, descanso_segundos: 120, rir: 2 },
              { peso: 85, reps: 6, descanso_segundos: 120, rir: 2 }
            ]
          }
        ]
      }
    ];

    const metricasDemo = [
      { fecha: '2026-11-01', pesoCorporalKg: 78.0, porcentajeGrasa: 14.2 },
      { fecha: '2026-11-16', pesoCorporalKg: 78.4, porcentajeGrasa: 13.8 }
    ];

    guardarProfile(perfilDemo);
    guardarEntrenamientos(entrenamientosDemo);
    guardarMetricas(metricasDemo);
    draftOnboarding = { ...perfilDemo };
  }

  /**
   * =========================================================================
   * 2. CONEXIÓN GEMINI IA (BASE BIOMECÁNICA PROPIA RAG + GOOGLE SEARCH WEB)
   * =========================================================================
   */
  async function llamarGeminiTexto(prompt, opciones = {}) {
    const { expectJson = false, usarBusquedaWeb = false } =
      typeof opciones === 'boolean' ? { expectJson: opciones } : opciones;
    const apiKey = localStorage.getItem(STORAGE_KEYS.GEMINI_KEY) || DEFAULT_API_KEY;
    if (!apiKey) return null;

    const payloads = [];
    if (usarBusquedaWeb && !expectJson) {
      payloads.push(
        JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.5 }
        })
      );
    }
    payloads.push(
      JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: expectJson ? 0.3 : 0.55,
          ...(expectJson ? { responseMimeType: 'application/json' } : {})
        }
      })
    );

    const endpoints = apiKey.startsWith('AQ.')
      ? [
          `https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`
        ]
      : [
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`
        ];

    for (const url of endpoints) {
      for (const body of payloads) {
        try {
          const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body
          });
          if (resp.ok) {
            const data = await resp.json();
            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            const chunks = data?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
            const fuentes = chunks
              .filter((c) => c?.web?.uri)
              .slice(0, 3)
              .map((c) => ({ titulo: c.web.title || 'Fuente web', url: c.web.uri }));
            if (text) return { text, fuentes };
          }
        } catch (e) {}
      }
    }
    return null;
  }

  async function construirPlanCompleto(usarIA = true) {
    const perfil = state.userProfile || draftOnboarding;

    if (usarIA) {
      state.generandoIA = true;
      renderizar();

      try {
        const eq = perfil.equipamiento || 'gimnasio';
        const nivel = perfil.nivel || 'intermedio';
        const contextoRAG = await window.MotorEntrenamiento.construirContextoRAGParaIA(perfil);

        const reglasEq = {
          peso_corporal:
            'REGLA ABSOLUTA: Entrena EN CASA SIN HERRAMIENTAS (solo suelo, pared, toalla o silla). PROHIBIDO incluir barras, paralelas, fondos en barra, anillas, aros, mancuernas, poleas o máquinas. Todo debe tener pesoSugerido = 0.',
          calistenia_barra:
            'REGLA ABSOLUTA: Parque/calistenia con barra de dominadas y paralelas (sin máquinas ni poleas).',
          mancuernas:
            'REGLA ABSOLUTA: En casa SOLO con mancuernas y banco/suelo.',
          gimnasio:
            'EQUIPAMIENTO: Gimnasio comercial completo.'
        };
        const reglasNivel = {
          principiante:
            'NIVEL PRINCIPIANTE (CRÍTICO): NO bajes solo las repeticiones. CAMBIÁ LOS EJERCICIOS por variantes de fundamentos y alta estabilidad tomadas de nuestra base de datos propia (ej: Flexiones inclinadas en mesa, Flexiones en rodillas, Sentadilla a silla, Puente de glúteo bilateral, Retracciones escapulares; en gym: Máquinas guiadas, Prensa, Jalón al pecho, Sentadilla Goblet).',
          intermedio:
            'NIVEL INTERMEDIO: Elegí ejercicios multiarticulares clásicos completos (ej: Flexiones clásicas en suelo, Pike Push-Ups, Sentadilla profunda tempo 3-1-1, Búlgara, Puente unilateral; en gym: Press banca, Remo barra, Sentadilla barra, RDL).',
          avanzado:
            'NIVEL AVANZADO: Elegí progresiones avanzadas y trabajo unilateral exigente (ej: Flexiones arquero, Pseudo-Planche, Pike elevadas, Pistol/Shrimp asistida, Remo unilateral; en gym: Compuestos pesados con pausa, Dominadas lastradas).'
        };

        const diasStr = window.MotorEntrenamiento.obtenerEstructuraSemanal(perfil)
          .map((d) => d.divisionMuscular)
          .join(', ');

        const prompt = `Sos FORGE, entrenador personal CSCS basado en evidencia científica (NSCA, Schoenfeld, Israetel, Steven Low). Armá el PLAN SEMANAL COMPLETO en español rioplatense claro apoyándote en la BASE DE DATOS BIOMECÁNICA PROPIA provista.

${reglasEq[eq] || reglasEq.gimnasio}
${reglasNivel[nivel] || reglasNivel.intermedio}

PERFIL DEL ATLETA:
- Objetivo: ${perfil.objetivo}
- Nivel: ${nivel}
- Días/semana: ${perfil.dias}
- Sesiones exactas a crear: ${diasStr}
- Molestias/notas del usuario: "${perfil.notasIA || 'Ninguna'}" (si menciona dolor articular, excluí ejercicios contraindicados)
- Historial reciente: ${JSON.stringify(state.entrenamientos.slice(-3))}

BASE DE DATOS PROPIA CURADA PARA ESTE ATLETA (usá estos ejercicios y criterios como fundamento principal):
${JSON.stringify(contextoRAG)}

Creá 4 ejercicios por cada sesión (${diasStr}). Devolvé SOLO JSON puro:
{
  "mensajeCoach": "Explicación clara de 1-2 líneas sobre por qué elegiste ESTOS ejercicios para su nivel y situación",
  "sesiones": [
    {
      "id": "dia_1",
      "divisionMuscular": "Empuje",
      "titulo": "Empuje",
      "enfoque": "Breve resumen",
      "ejercicios": [
        {
          "nombre": "Nombre claro del ejercicio",
          "grupoMuscular": "Músculo principal",
          "tipo": "compuesto",
          "seriesObjetivo": 3,
          "repsMin": 8,
          "repsMax": 12,
          "pesoSugerido": 0,
          "repsSugeridas": 10,
          "descansoSegundos": 90,
          "rirObjetivo": 2,
          "regresion": "Variante más accesible",
          "progresion": "Variante más exigente",
          "notaTecnica": "Clave técnica en 1 frase",
          "porQueEsteEjercicio": "Por qué este ejercicio es ideal para su nivel"
        }
      ]
    }
  ]
}`;

        let planCrudo = null;
        const resIA = await llamarGeminiTexto(prompt, { expectJson: true });
        if (resIA?.text) {
          planCrudo = JSON.parse(resIA.text);
        } else {
          try {
            const resp = await fetch('/api/generate-routine', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                mode: 'plan',
                userProfile: perfil,
                contextoRAG,
                historialReciente: state.entrenamientos.slice(-4),
                apiKeyClient: localStorage.getItem(STORAGE_KEYS.GEMINI_KEY) || DEFAULT_API_KEY
              })
            });
            if (resp.ok) {
              const data = await resp.json();
              if (data?.plan?.sesiones?.length) planCrudo = data.plan;
            }
          } catch (e) {}
        }

        if (planCrudo?.sesiones?.length) {
          const hidratado = await window.MotorEntrenamiento.hidratarPlanConProgresion(
            {
              ...planCrudo,
              generadoPor: 'FORGE IA · Base Biomecánica',
              fechaCreacion: new Date().toISOString().slice(0, 10),
              equipamiento: perfil.equipamiento,
              objetivo: perfil.objetivo,
              nivel: perfil.nivel
            },
            state.entrenamientos,
            perfil,
            state.modoDeload
          );
          inicializarSensacionEnPlan(hidratado);
          guardarUserPlan(hidratado);
          state.sesionIdx = 0;
          state.generandoIA = false;
          mostrarToastRecalibro('FORGE ARMÓ TU PLAN', 'Ejercicios elegidos para tu nivel y equipamiento.');
          return true;
        }
      } catch (e) {
        console.warn('Usando FORGE Coach local:', e.message);
      } finally {
        state.generandoIA = false;
      }
    }

    const planLocal = await window.MotorEntrenamiento.generarPlanSemanalLocal(
      perfil,
      state.entrenamientos,
      state.modoDeload
    );
    inicializarSensacionEnPlan(planLocal);
    guardarUserPlan(planLocal);
    state.sesionIdx = 0;
    return false;
  }

  function inicializarSensacionEnPlan(plan) {
    (plan?.sesiones || []).forEach((s) => {
      (s.ejercicios || []).forEach((e) => {
        if (e.sensacionIdx === undefined) e.sensacionIdx = 2; // JUSTO por defecto
      });
    });
  }

  async function rehidratarPlanGuardado() {
    if (!state.userPlan) {
      await construirPlanCompleto(false);
      return;
    }
    const hidratado = await window.MotorEntrenamiento.hidratarPlanConProgresion(
      state.userPlan,
      state.entrenamientos,
      state.userProfile || draftOnboarding,
      state.modoDeload
    );
    inicializarSensacionEnPlan(hidratado);
    guardarUserPlan(hidratado);
  }

  /**
   * =========================================================================
   * 3. TEMPORIZADOR DE DESCANSO & AUDIO
   * =========================================================================
   */
  function sonarAlerta(tipo = 'ok') {
    try {
      if (navigator.vibrate) navigator.vibrate(tipo === 'fin' ? [180, 90, 180] : [50]);
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const notas = tipo === 'fin' ? [523, 659, 784] : [440, 554];
      notas.forEach((f, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, ctx.currentTime + i * 0.1);
        gain.gain.setValueAtTime(0.1, ctx.currentTime + i * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.1 + 0.18);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.1);
        osc.stop(ctx.currentTime + i * 0.1 + 0.2);
      });
    } catch (e) {}
  }

  function iniciarDescanso(segundos = 90, etiqueta = 'Descanso') {
    if (state.descanso.interval) clearInterval(state.descanso.interval);
    const total = Math.max(15, Number(segundos) || 90);
    const esCardioTimer = etiqueta.toLowerCase().includes('cardio');
    state.descanso = {
      activo: true,
      etiqueta,
      total,
      restante: total,
      finTs: Date.now() + total * 1000,
      interval: setInterval(() => {
        const rest = Math.max(0, Math.ceil((state.descanso.finTs - Date.now()) / 1000));
        state.descanso.restante = rest;
        actualizarPildoraDescanso();
        if (rest <= 0) {
          clearInterval(state.descanso.interval);
          state.descanso.interval = null;
          state.descanso.activo = false;
          sonarAlerta('fin');
          actualizarPildoraDescanso();
          mostrarToastRecalibro(
            esCardioTimer ? 'BLOQUE DE CARDIO LISTO' : 'DESCANSO LISTO',
            esCardioTimer ? 'Completaste el tiempo objetivo. Marcá el bloque y calificá cómo se sintió.' : 'Podés pasar a tu próxima serie.'
          );
        }
      }, 250)
    };
    actualizarPildoraDescanso();
  }

  function sumarDescanso(delta = 30) {
    if (!state.descanso.activo) return;
    state.descanso.finTs += delta * 1000;
    state.descanso.total = Math.max(
      state.descanso.total,
      Math.ceil((state.descanso.finTs - Date.now()) / 1000)
    );
    state.descanso.restante = Math.max(0, Math.ceil((state.descanso.finTs - Date.now()) / 1000));
    actualizarPildoraDescanso();
  }

  function saltarDescanso() {
    if (state.descanso.interval) clearInterval(state.descanso.interval);
    state.descanso.interval = null;
    state.descanso.activo = false;
    state.descanso.restante = 0;
    actualizarPildoraDescanso();
  }

  function actualizarPildoraDescanso() {
    const pill = document.getElementById('floating-rest-pill');
    const lbl = document.getElementById('rest-label');
    const txt = document.getElementById('rest-countdown-text');
    const bar = document.getElementById('rest-progress-bar');
    if (!pill || !txt || !bar) return;

    if (!state.descanso.activo || state.vista !== 'entrenar') {
      pill.classList.add('translate-y-24', 'opacity-0', 'pointer-events-none');
      return;
    }

    pill.classList.remove('translate-y-24', 'opacity-0', 'pointer-events-none');
    if (lbl) lbl.textContent = state.descanso.etiqueta || 'Descanso';
    txt.textContent = formatearTiempo(state.descanso.restante);
    const pct = Math.min(100, Math.max(0, (state.descanso.restante / state.descanso.total) * 100));
    bar.style.width = `${pct}%`;
  }

  /**
   * =========================================================================
   * 4. NAVEGACIÓN Y RENDERIZADO
   * =========================================================================
   */
  function irATab(tab) {
    state.vista = tab;
    renderizar();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function abrirOnboarding() {
    draftOnboarding = { ...draftOnboarding, ...(state.userProfile || {}) };
    state.pasoOnboarding = 1;
    state.vista = 'onboarding';
    renderizar();
    window.scrollTo({ top: 0 });
  }

  function actualizarChrome() {
    const header = document.getElementById('app-header');
    const bottomNav = document.getElementById('app-bottom-nav');
    const main = document.getElementById('app-main');
    const slot = document.getElementById('header-right-slot');
    const esOnboarding = state.vista === 'onboarding';

    if (header) header.classList.toggle('hidden', esOnboarding);
    if (bottomNav) bottomNav.classList.toggle('hidden', esOnboarding);
    if (main) {
      main.className = esOnboarding
        ? 'max-w-lg mx-auto min-h-[100dvh] px-5 pt-6 pb-12'
        : 'max-w-lg mx-auto min-h-[100dvh] px-5 pt-20 pb-28';
    }

    if (slot) {
      if (state.vista === 'entrenar') {
        slot.innerHTML = `
          <button type="button" onclick="AppFORGE.guardarEntrenamiento()"
            class="px-3.5 py-1.5 rounded-full btn-gold font-display text-[10px] font-bold tracking-[0.14em] uppercase">
            Guardar
          </button>
        `;
      } else if (state.vista === 'coach') {
        slot.innerHTML = `
          <button type="button" onclick="AppFORGE.limpiarChatCoach()"
            class="px-3 py-1 rounded-full btn-ghost font-mono text-[10px] uppercase tracking-wider">
            ↺ Nueva
          </button>
        `;
      } else if (state.vista === 'plan') {
        slot.innerHTML = `
          <button type="button" onclick="AppFORGE.abrirOnboarding()"
            class="px-3 py-1 rounded-full btn-ghost font-mono text-[10px] uppercase tracking-wider">
            Cambiar plan
          </button>
        `;
      } else {
        slot.innerHTML = '';
      }
    }

    document.querySelectorAll('[data-tab]').forEach((btn) => {
      const t = btn.getAttribute('data-tab');
      const activo = t === state.vista;
      btn.className = activo
        ? 'flex flex-col items-center justify-center gap-1 py-1.5 text-gold transition-colors'
        : 'flex flex-col items-center justify-center gap-1 py-1.5 text-sandDim hover:text-sand transition-colors';
    });

    actualizarPildoraDescanso();
  }

  function renderizar() {
    actualizarChrome();
    const main = document.getElementById('app-main');
    if (!main) return;

    if (state.vista === 'onboarding') {
      main.innerHTML = renderOnboarding();
    } else if (state.vista === 'entrenar') {
      main.innerHTML = renderEntrenar();
    } else if (state.vista === 'plan') {
      main.innerHTML = renderPlan();
    } else if (state.vista === 'coach') {
      main.innerHTML = renderCoach();
    } else if (state.vista === 'progreso') {
      main.innerHTML = renderProgreso();
    }
  }

  /**
   * =========================================================================
   * PANTALLA 1: ONBOARDING DE 2 MINUTOS (Estilo TITUS — 1 pregunta por paso)
   * =========================================================================
   */
  function renderOnboarding() {
    const paso = state.pasoOnboarding;
    const total = state.totalPasosOnboarding;
    const d = draftOnboarding;
    const tienePlan = Boolean(state.userPlan?.sesiones?.length);

    let cuerpo = '';

    if (paso === 1) {
      const metas = [
        { id: 'hipertrofia', titulo: 'Hipertrofia', sub: 'Ganar masa muscular · 8–12 reps' },
        { id: 'fuerza', titulo: 'Fuerza', sub: 'Subir tus marcas · 4–6 reps' },
        { id: 'acondicionamiento', titulo: 'Recomposición', sub: 'Definir y mejorar resistencia · 12–15 reps' },
        { id: 'calistenia', titulo: 'Dominio Corporal', sub: 'Control y fuerza con tu cuerpo' }
      ];
      cuerpo = `
        <div class="mb-8">
          <div class="font-mono text-[10px] uppercase tracking-[0.26em] text-gold mb-2">FORGE · MÉTODO ADAPTATIVO</div>
          <h1 class="font-display text-3xl font-bold text-ivory tracking-wide leading-tight">¿Cuál es tu objetivo?</h1>
          <p class="font-editorial italic text-lg text-sand mt-1">Lee cada serie que registrás y ajusta tu plan.</p>
        </div>
        <div class="space-y-3">
          ${metas
            .map((m, i) => {
              const sel = d.objetivo === m.id;
              return `
              <button type="button" onclick="AppFORGE.elegirOnboarding('objetivo', '${m.id}', true)"
                class="w-full text-left px-5 py-4 rounded-2xl transition-all flex items-center justify-between gap-4 active:scale-[0.99] ${
                  sel ? 'card-forge-featured' : 'card-forge hover:border-gold/35'
                }">
                <div class="flex items-center gap-4">
                  <span class="w-8 h-8 rounded-full border ${
                    sel ? 'border-gold text-gold bg-gold/10' : 'border-gold/25 text-sand'
                  } font-display text-xs flex items-center justify-center shrink-0">${aRomano(i)}</span>
                  <div>
                    <div class="font-display text-sm font-semibold tracking-wider uppercase text-ivory">${m.titulo}</div>
                    <div class="text-xs text-sand mt-0.5">${m.sub}</div>
                  </div>
                </div>
                <span class="material-symbols-outlined text-gold/60 text-[18px]">chevron_right</span>
              </button>
            `;
            })
            .join('')}
        </div>
      `;
    } else if (paso === 2) {
      const equipos = [
        { id: 'peso_corporal', titulo: 'En casa, sin herramientas', sub: '100% suelo y tu cuerpo · Cero barras ni anillas' },
        { id: 'mancuernas', titulo: 'En casa con mancuernas', sub: 'Mancuernas y banco o suelo' },
        { id: 'calistenia_barra', titulo: 'Parque · Barra y paralelas', sub: 'Dominadas, fondos y peso corporal' },
        { id: 'gimnasio', titulo: 'Gimnasio completo', sub: 'Barras, máquinas, poleas y mancuernas' }
      ];
      cuerpo = `
        <div class="mb-8">
          <div class="font-mono text-[10px] uppercase tracking-[0.26em] text-gold mb-2">EQUIPAMIENTO REAL</div>
          <h1 class="font-display text-3xl font-bold text-ivory tracking-wide leading-tight">¿Con qué entrenás?</h1>
          <p class="font-editorial italic text-lg text-sand mt-1">Tu plan solo usará lo que realmente tenés disponible.</p>
        </div>
        <div class="space-y-3">
          ${equipos
            .map((e, i) => {
              const sel = d.equipamiento === e.id;
              return `
              <button type="button" onclick="AppFORGE.elegirOnboarding('equipamiento', '${e.id}', true)"
                class="w-full text-left px-5 py-4 rounded-2xl transition-all flex items-center justify-between gap-4 active:scale-[0.99] ${
                  sel ? 'card-forge-featured' : 'card-forge hover:border-gold/35'
                }">
                <div class="flex items-center gap-4">
                  <span class="w-8 h-8 rounded-full border ${
                    sel ? 'border-gold text-gold bg-gold/10' : 'border-gold/25 text-sand'
                  } font-display text-xs flex items-center justify-center shrink-0">${aRomano(i)}</span>
                  <div>
                    <div class="font-display text-sm font-semibold tracking-wider uppercase text-ivory">${e.titulo}</div>
                    <div class="text-xs text-sand mt-0.5">${e.sub}</div>
                  </div>
                </div>
                <span class="material-symbols-outlined text-gold/60 text-[18px]">chevron_right</span>
              </button>
            `;
            })
            .join('')}
        </div>
      `;
    } else if (paso === 3) {
      const splits = [
        { id: 'PPL', titulo: 'Empuje · Tirón · Pierna', sub: 'Divide por patrón de movimiento' },
        { id: 'Torso/Pierna', titulo: 'Torso · Pierna', sub: 'Balance ideal para 4 días' },
        { id: 'Full Body', titulo: 'Full Body', sub: 'Todo el cuerpo en cada sesión' }
      ];
      cuerpo = `
        <div class="mb-7">
          <div class="font-mono text-[10px] uppercase tracking-[0.26em] text-gold mb-2">FRECUENCIA SEMANAL</div>
          <h1 class="font-display text-3xl font-bold text-ivory tracking-wide leading-tight">¿Cuántos días por semana?</h1>
        </div>

        <div class="grid grid-cols-4 gap-2.5 mb-7">
          ${[3, 4, 5, 6]
            .map((num) => {
              const sel = Number(d.dias) === num;
              return `
              <button type="button" onclick="AppFORGE.elegirDiasOnboarding(${num})"
                class="py-4 rounded-2xl flex flex-col items-center justify-center transition-all ${
                  sel ? 'btn-gold font-bold' : 'card-forge text-ivory hover:border-gold/40'
                }">
                <span class="font-display text-2xl leading-none">${num}</span>
                <span class="font-mono text-[10px] uppercase mt-1 ${sel ? 'text-obsidian/80' : 'text-sand'}">días</span>
              </button>
            `;
            })
            .join('')}
        </div>

        <div class="font-mono text-[10px] uppercase tracking-[0.2em] text-sand mb-3">Estructura semanal</div>
        <div class="space-y-2.5 mb-8">
          ${splits
            .map((sp) => {
              const sel = d.divisionMuscular === sp.id;
              return `
              <button type="button" onclick="AppFORGE.elegirOnboarding('divisionMuscular', '${sp.id}', false)"
                class="w-full text-left px-4 py-3.5 rounded-2xl flex items-center justify-between transition-all ${
                  sel ? 'card-forge-featured' : 'card-forge hover:border-gold/35'
                }">
                <div>
                  <div class="font-display text-xs font-semibold tracking-wider uppercase text-ivory">${sp.titulo}</div>
                  <div class="text-xs text-sand mt-0.5">${sp.sub}</div>
                </div>
                <span class="w-5 h-5 rounded-full border flex items-center justify-center ${
                  sel ? 'border-gold bg-gold text-obsidian' : 'border-gold/25'
                }">
                  ${sel ? '<span class="material-symbols-outlined text-[14px]">check</span>' : ''}
                </span>
              </button>
            `;
            })
            .join('')}
        </div>

        <button type="button" onclick="AppFORGE.irPasoOnboarding(4)"
          class="w-full py-4 rounded-full btn-gold font-display text-xs font-bold tracking-[0.2em] uppercase">
          Continuar
        </button>
      `;
    } else if (paso === 4) {
      const niveles = [
        { id: 'principiante', titulo: 'Principiante', sub: 'Menos de 6 meses de constancia' },
        { id: 'intermedio', titulo: 'Intermedio', sub: '6 meses a 2 años entrenando' },
        { id: 'avanzado', titulo: 'Avanzado', sub: 'Más de 2 años con sobrecarga progresiva' }
      ];
      cuerpo = `
        <div class="mb-8">
          <div class="font-mono text-[10px] uppercase tracking-[0.26em] text-gold mb-2">EXPERIENCIA</div>
          <h1 class="font-display text-3xl font-bold text-ivory tracking-wide leading-tight">¿Cuál es tu nivel actual?</h1>
          <p class="font-editorial italic text-lg text-sand mt-1">Calibramos el volumen y la exigencia inicial.</p>
        </div>
        <div class="space-y-3">
          ${niveles
            .map((n, i) => {
              const sel = d.nivel === n.id;
              return `
              <button type="button" onclick="AppFORGE.elegirOnboarding('nivel', '${n.id}', true)"
                class="w-full text-left px-5 py-4 rounded-2xl transition-all flex items-center justify-between gap-4 active:scale-[0.99] ${
                  sel ? 'card-forge-featured' : 'card-forge hover:border-gold/35'
                }">
                <div class="flex items-center gap-4">
                  <span class="w-8 h-8 rounded-full border ${
                    sel ? 'border-gold text-gold bg-gold/10' : 'border-gold/25 text-sand'
                  } font-display text-xs flex items-center justify-center shrink-0">${aRomano(i)}</span>
                  <div>
                    <div class="font-display text-sm font-semibold tracking-wider uppercase text-ivory">${n.titulo}</div>
                    <div class="text-xs text-sand mt-0.5">${n.sub}</div>
                  </div>
                </div>
                <span class="material-symbols-outlined text-gold/60 text-[18px]">chevron_right</span>
              </button>
            `;
            })
            .join('')}
        </div>
      `;
    } else {
      const eqMap = {
        peso_corporal: 'En casa sin herramientas',
        mancuernas: 'Casa con mancuernas',
        calistenia_barra: 'Barra y paralelas',
        gimnasio: 'Gimnasio completo'
      };
      cuerpo = `
        <div class="mb-6">
          <div class="font-mono text-[10px] uppercase tracking-[0.26em] text-gold mb-2">ÚLTIMO PASO</div>
          <h1 class="font-display text-3xl font-bold text-ivory tracking-wide leading-tight">¿Alguna molestia o preferencia?</h1>
          <p class="font-editorial italic text-lg text-sand mt-1">Opcional — FORGE lo tiene en cuenta al armar tus ejercicios.</p>
        </div>

        <textarea rows="3" oninput="AppFORGE.actualizarNotaOnboarding(this.value)"
          placeholder="Ej: Solo tengo espacio en el suelo, me molesta un poco la muñeca derecha..."
          class="w-full p-4 rounded-2xl bg-obsidian2 border hairline text-ivory text-sm placeholder:text-sandDim focus:outline-none focus:border-gold mb-6">${
            d.notasIA || ''
          }</textarea>

        <div class="p-4 rounded-2xl card-forge mb-8 space-y-2">
          <div class="font-mono text-[10px] uppercase tracking-[0.2em] text-gold">Resumen de tu plan</div>
          <div class="grid grid-cols-2 gap-3 text-xs pt-1">
            <div><span class="text-sand block">Objetivo</span><strong class="text-ivory uppercase">${d.objetivo}</strong></div>
            <div><span class="text-sand block">Equipamiento</span><strong class="text-gold-soft">${eqMap[d.equipamiento] || d.equipamiento}</strong></div>
            <div><span class="text-sand block">Frecuencia</span><strong class="text-ivory">${d.dias} días / sem</strong></div>
            <div><span class="text-sand block">División</span><strong class="text-ivory">${d.divisionMuscular}</strong></div>
          </div>
        </div>

        <button type="button" onclick="AppFORGE.finalizarOnboarding()" ${state.generandoIA ? 'disabled' : ''}
          class="w-full py-4 rounded-full btn-gold font-display text-xs font-bold tracking-[0.22em] uppercase flex items-center justify-center gap-2 disabled:opacity-60">
          ${
            state.generandoIA
              ? '<span class="w-4 h-4 border-2 border-obsidian border-t-transparent rounded-full animate-spin"></span> ARMANDO TU PLAN...'
              : 'ARMAR MI PLAN'
          }
        </button>
      `;
    }

    return `
      <div class="flex flex-col min-h-[88dvh] animate-view">
        <div class="flex items-center justify-between mb-6">
          ${
            paso > 1
              ? `<button type="button" onclick="AppFORGE.irPasoOnboarding(${paso - 1})"
                  class="w-9 h-9 rounded-full card-forge flex items-center justify-center text-sand hover:text-ivory">
                  <span class="material-symbols-outlined text-[18px]">arrow_back</span>
                </button>`
              : `<span class="font-display text-sm font-bold tracking-[0.25em] text-gold">FORGE</span>`
          }
          <span class="font-mono text-[10px] uppercase tracking-[0.22em] text-sand">${aRomano(paso - 1)} / ${aRomano(
      total - 1
    )}</span>
          ${
            tienePlan
              ? `<button type="button" onclick="AppFORGE.irATab('entrenar')" class="font-mono text-[10px] uppercase tracking-wider text-sand hover:text-ivory">Cerrar</button>`
              : `<div class="w-9"></div>`
          }
        </div>

        <div class="grid grid-cols-5 gap-1.5 mb-8">
          ${Array.from({ length: total }, (_, i) => {
            const on = i + 1 <= paso;
            return `<div class="h-[2px] rounded-full ${on ? 'bg-gold' : 'bg-white/10'}"></div>`;
          }).join('')}
        </div>

        ${cuerpo}
      </div>
    `;
  }

  /**
   * =========================================================================
   * PANTALLA 2: ENTRENAR (Inspirada 1:1 en titus-entreno.webp)
   * Tarjetas con números romanos, series limpias y el slider "¿CÓMO SE SINTIÓ?"
   * =========================================================================
   */
  function renderEntrenar() {
    const plan = state.userPlan;
    const sesion = obtenerSesionActual();
    if (!plan || !sesion) {
      return `<div class="py-20 text-center text-sand">Cargando tu sesión...</div>`;
    }

    const eqLabels = {
      peso_corporal: 'Sin equipo · Casa',
      mancuernas: 'Mancuernas',
      calistenia_barra: 'Barra y paralelas',
      gimnasio: 'Gimnasio'
    };

    const semanaNum = Math.max(1, Math.floor(state.entrenamientos.length / Math.max(1, plan.sesiones.length)) + 1);

    return `
      <div class="space-y-6 animate-view">
        <!-- Encabezado de sesión estilo TITUS -->
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <span class="font-mono text-[10px] uppercase tracking-[0.22em] text-gold">
              ${(plan.objetivoNombre || 'PLAN').toUpperCase()} · SEM ${semanaNum}
            </span>
            <span class="font-mono text-[10px] uppercase tracking-[0.16em] text-sand">
              ${eqLabels[plan.equipamiento] || ''}
            </span>
          </div>

          <!-- Selector de días del plan -->
          <div class="flex gap-2 overflow-x-auto pb-1">
            ${plan.sesiones
              .map((s, idx) => {
                const activo = idx === state.sesionIdx;
                return `
                <button type="button" onclick="AppFORGE.seleccionarDiaPlan(${idx})"
                  class="px-4 py-1.5 rounded-full font-display text-[11px] tracking-[0.14em] uppercase shrink-0 transition-all ${
                    activo
                      ? 'border border-gold bg-gold/15 text-gold-hi font-semibold'
                      : 'border hairline text-sand hover:text-ivory'
                  }">
                  Día ${aRomano(idx)} · ${s.titulo || s.divisionMuscular}
                </button>
              `;
              })
              .join('')}
          </div>
        </div>

        <!-- Aviso discreto si el usuario editó esta sesión -->
        ${
          sesion.modificadaPorUsuario
            ? `
            <div class="px-4 py-3 rounded-2xl bg-gold/10 border border-gold/35 flex items-center justify-between gap-3">
              <div class="min-w-0">
                <div class="font-mono text-[9.5px] uppercase tracking-[0.2em] text-gold">Rutina modificada por vos</div>
                <div class="text-xs text-ivory/85 mt-0.5">Analizá tus cambios con FORGE Coach</div>
              </div>
              <button type="button" onclick="AppFORGE.analizarRutinaModificadaConCoach()"
                class="px-3.5 py-2 rounded-full btn-gold font-display text-[10px] font-bold tracking-[0.14em] uppercase shrink-0">
                Analizar
              </button>
            </div>
          `
            : ''
        }

        <!-- Tarjetas de ejercicios estilo titus-entreno.webp -->
        <div class="space-y-5">
          ${
            sesion.ejercicios.length === 0
              ? `<div class="p-8 rounded-2xl card-forge text-center space-y-3">
                  <p class="font-editorial italic text-lg text-sand">No quedan ejercicios en esta sesión.</p>
                </div>`
              : sesion.ejercicios.map((ej, ejIdx) => renderTarjetaEjercicioTitus(ej, ejIdx)).join('')
          }
        </div>

        <!-- Agregar ejercicio propio o desde la Base de Datos + Cardio + Analizar cambios -->
        <div class="space-y-3 pt-1">
          <div class="grid grid-cols-2 gap-2.5">
            <button type="button" onclick="AppFORGE.abrirModalAgregarEjercicio(null, 'todos')"
              class="py-3.5 px-3 rounded-2xl border border-dashed border-gold/35 hover:border-gold/70 bg-gold/[0.03] font-mono text-[10.5px] uppercase tracking-[0.14em] text-gold-soft hover:text-gold-hi flex items-center justify-center gap-1.5 transition">
              <span class="material-symbols-outlined text-[17px]">add</span>
              <span>Ejercicio / BD</span>
            </button>
            <button type="button" onclick="AppFORGE.abrirModalAgregarEjercicio(null, 'cardio')"
              class="py-3.5 px-3 rounded-2xl border border-dashed border-mint/35 hover:border-mint/70 bg-mint/[0.03] font-mono text-[10.5px] uppercase tracking-[0.14em] text-mint hover:text-ivory flex items-center justify-center gap-1.5 transition">
              <span class="material-symbols-outlined text-[17px]">directions_run</span>
              <span>+ Cardio (tiempo)</span>
            </button>
          </div>

          <button type="button" onclick="AppFORGE.analizarRutinaModificadaConCoach()"
            class="w-full py-3 rounded-full btn-ghost font-mono text-[10.5px] uppercase tracking-[0.16em] flex items-center justify-center gap-2">
            <span class="material-symbols-outlined text-[16px]">auto_awesome</span>
            <span>Analizar ajustes de esta rutina con FORGE</span>
          </button>
        </div>

        <!-- Botón dorado final para guardar el entrenamiento y recalibrar la próxima semana -->
        <div class="pt-1 pb-4">
          <button type="button" onclick="AppFORGE.guardarEntrenamiento()"
            class="w-full py-4 rounded-full btn-gold font-display text-xs font-bold tracking-[0.22em] uppercase">
            Finalizar y recalibrar plan
          </button>
        </div>
      </div>
    `;
  }

  function renderTarjetaEjercicioTitus(ej, ejIdx) {
    const sensIdx = ej.sensacionIdx !== undefined ? ej.sensacionIdx : 2;
    const esCardio = Boolean(ej.esCardio || ej.tipo === 'cardio');
    const esSinEquipo = Boolean(ej.esPesoCorporal);
    const knobLeftPct = sensIdx * 25;
    const badgeCardio = esCardio ? obtenerBadgeCardio(ej.intensidadCardio || 'medio') : null;
    const minPrimerBloque = esCardio
      ? Math.max(1, Number(ej.series?.[0]?.tiempo_minutos) || Number(ej.duracionMinutos) || 15)
      : 0;

    return `
      <article class="rounded-2xl card-forge p-4 sm:p-5 space-y-4">
        <!-- Cabecera: Número Romano + Nombre en Cormorant Italic + Info -->
        <div class="flex items-start justify-between gap-3">
          <div class="flex items-start gap-3 min-w-0">
            <span class="w-8 h-8 rounded-full border border-gold/30 text-gold font-display text-xs flex items-center justify-center shrink-0 mt-0.5">
              ${aRomano(ejIdx)}
            </span>
            <div class="min-w-0">
              <h2 class="font-editorial italic text-[21px] font-medium text-ivory leading-snug">
                ${ej.nombre}
              </h2>
              ${
                esCardio
                  ? `<div class="mt-1.5 mb-1">
                      <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border font-mono text-[9px] uppercase tracking-[0.16em] ${badgeCardio.cls}">
                        <span class="material-symbols-outlined text-[11px]">directions_run</span>
                        <span>${badgeCardio.label}</span>
                      </span>
                    </div>`
                  : ''
              }
              <p class="font-mono text-[10px] text-sand mt-0.5 leading-relaxed">
                ${ej.prescripcion.mensajeProgresion}
              </p>
            </div>
          </div>
          <button type="button" onclick="AppFORGE.abrirModalEjercicio(${ejIdx})"
            class="w-8 h-8 rounded-full border hairline text-sand hover:text-gold flex items-center justify-center shrink-0"
            title="Ver técnica, editar o eliminar">
            <span class="material-symbols-outlined text-[16px]">more_horiz</span>
          </button>
        </div>

        <!-- Encabezados de columnas de series / bloques -->
        <div class="grid grid-cols-12 items-center font-mono text-[9.5px] uppercase tracking-[0.18em] text-sandDim pt-1 border-t hairline">
          <span class="col-span-2">${esCardio ? 'BLOQUE' : ''}</span>
          ${
            esCardio
              ? `<span class="col-span-6 text-center">TIEMPO (MIN)</span>
                 <span class="col-span-4 text-right text-gold/80">CRONO / OK</span>`
              : esSinEquipo
              ? `<span class="col-span-7 text-center">REPS</span>
                 <span class="col-span-3 text-right text-gold/80">RIR ${ej.rirObjetivo ?? 2}</span>`
              : `<span class="col-span-4 text-center">REPS</span>
                 <span class="col-span-4 text-center">KG</span>
                 <span class="col-span-2 text-right text-gold/80">RIR ${ej.rirObjetivo ?? 2}</span>`
          }
        </div>

        <!-- Filas de series / bloques con números romanos (I, II, III...) -->
        <div class="space-y-2.5">
          ${ej.series
            .map((ser, sIdx) => {
              const ok = Boolean(ser.completada);
              const mins = Math.max(1, Number(ser.tiempo_minutos) || Number(ej.duracionMinutos) || 15);
              return `
              <div class="grid grid-cols-12 items-center gap-1 py-1 ${ok ? 'opacity-90' : ''}">
                <!-- Número romano de la serie/bloque -->
                <span class="col-span-2 font-display text-xs ${
                  ok ? 'text-gold' : 'text-sandDim'
                } pl-1">${aRomano(sIdx)}</span>

                ${
                  esCardio
                    ? `
                      <!-- SOLO TIEMPO EN MINUTOS PARA CARDIO -->
                      <div class="col-span-6 flex items-center justify-center gap-2">
                        <button type="button" onclick="AppFORGE.ajustarSerie(${ejIdx}, ${sIdx}, 'tiempo_minutos', -1)"
                          class="w-8 h-8 rounded-full text-sand hover:text-ivory hover:bg-white/5 font-mono text-base transition">−</button>
                        <div class="flex items-baseline justify-center gap-1">
                          <input type="number" min="1" max="180" value="${mins}"
                            oninput="AppFORGE.editarSerie(${ejIdx}, ${sIdx}, 'tiempo_minutos', this.value)"
                            class="w-11 bg-transparent text-center font-mono text-base font-semibold text-ivory focus:outline-none" />
                          <span class="font-mono text-[10px] uppercase text-sand">min</span>
                        </div>
                        <button type="button" onclick="AppFORGE.ajustarSerie(${ejIdx}, ${sIdx}, 'tiempo_minutos', 1)"
                          class="w-8 h-8 rounded-full text-sand hover:text-gold hover:bg-white/5 font-mono text-base transition">+</button>
                      </div>

                      <!-- Cronómetro directo del bloque + Check dorado -->
                      <div class="col-span-4 flex items-center justify-end gap-2">
                        <button type="button" onclick="AppFORGE.iniciarDescanso(${mins * 60}, 'Cardio · ${badgeCardio.short}')"
                          class="w-8 h-8 rounded-full border border-gold/30 text-gold hover:border-gold hover:bg-gold/10 flex items-center justify-center transition active:scale-90"
                          title="Iniciar cronómetro de ${mins} min">
                          <span class="material-symbols-outlined text-[16px]">play_arrow</span>
                        </button>
                        <button type="button" onclick="AppFORGE.alternarCheckSerie(${ejIdx}, ${sIdx})"
                          class="w-8 h-8 rounded-full border flex items-center justify-center transition-all active:scale-90 ${
                            ok
                              ? 'border-gold bg-gold text-obsidian shadow-[0_0_12px_rgba(212,165,106,0.45)]'
                              : 'border-gold/30 text-sand hover:border-gold'
                          }">
                          <span class="material-symbols-outlined text-[16px]">check</span>
                        </button>
                      </div>
                    `
                    : esSinEquipo
                    ? `
                      <!-- Solo REPS centrado para peso corporal sin herramientas -->
                      <div class="col-span-7 flex items-center justify-center gap-3">
                        <button type="button" onclick="AppFORGE.ajustarSerie(${ejIdx}, ${sIdx}, 'reps', -1)"
                          class="w-8 h-8 rounded-full text-sand hover:text-ivory hover:bg-white/5 font-mono text-base transition">−</button>
                        <input type="number" value="${ser.reps}"
                          oninput="AppFORGE.editarSerie(${ejIdx}, ${sIdx}, 'reps', this.value)"
                          class="w-12 bg-transparent text-center font-mono text-base font-semibold text-ivory focus:outline-none" />
                        <button type="button" onclick="AppFORGE.ajustarSerie(${ejIdx}, ${sIdx}, 'reps', 1)"
                          class="w-8 h-8 rounded-full text-sand hover:text-gold hover:bg-white/5 font-mono text-base transition">+</button>
                      </div>
                      <div class="col-span-3 flex items-center justify-end gap-1.5">
                        <button type="button" onclick="AppFORGE.alternarCheckSerie(${ejIdx}, ${sIdx})"
                          class="w-8 h-8 rounded-full border flex items-center justify-center transition-all active:scale-90 ${
                            ok
                              ? 'border-gold bg-gold text-obsidian shadow-[0_0_12px_rgba(212,165,106,0.45)]'
                              : 'border-gold/30 text-sand hover:border-gold'
                          }">
                          <span class="material-symbols-outlined text-[16px]">check</span>
                        </button>
                      </div>
                    `
                    : `
                      <!-- REPS -->
                      <div class="col-span-4 flex items-center justify-center gap-1">
                        <button type="button" onclick="AppFORGE.ajustarSerie(${ejIdx}, ${sIdx}, 'reps', -1)"
                          class="w-7 h-7 rounded-full text-sand hover:text-ivory hover:bg-white/5 font-mono text-sm">−</button>
                        <input type="number" value="${ser.reps}"
                          oninput="AppFORGE.editarSerie(${ejIdx}, ${sIdx}, 'reps', this.value)"
                          class="w-9 bg-transparent text-center font-mono text-sm font-semibold text-ivory focus:outline-none" />
                        <button type="button" onclick="AppFORGE.ajustarSerie(${ejIdx}, ${sIdx}, 'reps', 1)"
                          class="w-7 h-7 rounded-full text-sand hover:text-gold hover:bg-white/5 font-mono text-sm">+</button>
                      </div>

                      <!-- KG -->
                      <div class="col-span-4 flex items-center justify-center gap-1">
                        <button type="button" onclick="AppFORGE.ajustarSerie(${ejIdx}, ${sIdx}, 'peso', -${state.pasoDisco})"
                          class="w-7 h-7 rounded-full text-sand hover:text-ivory hover:bg-white/5 font-mono text-sm">−</button>
                        <input type="number" step="0.5" value="${ser.peso}"
                          oninput="AppFORGE.editarSerie(${ejIdx}, ${sIdx}, 'peso', this.value)"
                          class="w-11 bg-transparent text-center font-mono text-sm font-semibold text-ivory focus:outline-none" />
                        <button type="button" onclick="AppFORGE.ajustarSerie(${ejIdx}, ${sIdx}, 'peso', ${state.pasoDisco})"
                          class="w-7 h-7 rounded-full text-sand hover:text-gold hover:bg-white/5 font-mono text-sm">+</button>
                      </div>

                      <!-- Check circular dorado -->
                      <div class="col-span-2 flex items-center justify-end gap-1.5">
                        <button type="button" onclick="AppFORGE.alternarCheckSerie(${ejIdx}, ${sIdx})"
                          class="w-8 h-8 rounded-full border flex items-center justify-center transition-all active:scale-90 ${
                            ok
                              ? 'border-gold bg-gold text-obsidian shadow-[0_0_12px_rgba(212,165,106,0.45)]'
                              : 'border-gold/30 text-sand hover:border-gold'
                          }">
                          <span class="material-symbols-outlined text-[16px]">check</span>
                        </button>
                      </div>
                    `
                }
              </div>
            `;
            })
            .join('')}
        </div>

        <!-- Botón punteado + AGREGAR SERIE / BLOQUE -->
        <button type="button" onclick="AppFORGE.agregarSerie(${ejIdx})"
          class="w-full py-2.5 rounded-xl border border-dashed border-gold/25 hover:border-gold/50 font-mono text-[10px] uppercase tracking-[0.2em] text-sand hover:text-gold-soft transition">
          ${esCardio ? '+ Agregar bloque de tiempo' : '+ Agregar serie'}
        </button>

        <!-- SLIDER DE SENSACIÓN ¿CÓMO SE SINTIÓ? (Firma visual y funcional de TITUS) -->
        <div class="pt-3 border-t hairline space-y-3">
          <div class="text-center">
            <div class="font-display text-[10px] uppercase tracking-[0.22em] text-sand">¿Cómo se sintió?</div>
            <div class="font-editorial italic text-xs text-sandDim mt-0.5">
              ${
                esCardio
                  ? 'Ajustá el tiempo de tu próximo bloque y sesión'
                  : esSinEquipo
                  ? 'Ajustá las repeticiones de tu próxima serie y sesión'
                  : 'Ajustá el peso de tu próxima serie y sesión'
              }
            </div>
          </div>

          <!-- Pista degradada + 5 nodos clicables -->
          <div class="relative px-2 py-2">
            <div class="h-[4px] w-full rounded-full rpe-track relative">
              <!-- Perilla dorada animada -->
              <div class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-gradient-to-b from-gold-hi to-gold-deep border border-ivory/60 shadow-[0_0_12px_rgba(212,165,106,0.7)] transition-all duration-200 pointer-events-none"
                style="left: ${knobLeftPct}%;"></div>
            </div>
            <!-- Zonas táctiles invisibles encima de los 5 puntos -->
            <div class="grid grid-cols-5 mt-2.5">
              ${SENSACIONES.map(
                (s) => `
                <button type="button" onclick="AppFORGE.seleccionarSensacion(${ejIdx}, ${s.idx})"
                  class="py-1 font-mono text-[9px] uppercase tracking-wider text-center transition ${
                    sensIdx === s.idx ? 'text-gold-hi font-semibold' : 'text-sandDim hover:text-sand'
                  }">
                  ${s.label}
                </button>
              `
              ).join('')}
            </div>
          </div>
        </div>

        <!-- Pie minimalista: VER TÉCNICA · Tiempo -->
        <div class="pt-2 border-t hairline flex items-center justify-between text-sand">
          <button type="button" onclick="AppFORGE.abrirModalEjercicio(${ejIdx})"
            class="flex items-center gap-2 text-sand hover:text-gold-soft transition">
            <span class="w-7 h-7 rounded-full border border-gold/30 flex items-center justify-center text-gold">
              <span class="material-symbols-outlined text-[15px]">play_arrow</span>
            </span>
            <span class="font-mono text-[10px] uppercase tracking-[0.16em]">Ver técnica</span>
          </button>

          ${
            esCardio
              ? `<button type="button" onclick="AppFORGE.iniciarDescanso(${minPrimerBloque * 60}, 'Cardio · ${badgeCardio.short}')"
                  class="flex items-center gap-1.5 font-mono text-[11px] text-mint hover:text-ivory transition"
                  title="Iniciar cronómetro de cardio">
                  <span class="material-symbols-outlined text-[15px]">timer</span>
                  <span>Iniciar ${minPrimerBloque}:00</span>
                </button>`
              : `<button type="button" onclick="AppFORGE.iniciarDescanso(${ej.descansoSegundos || 90}, 'Descanso')"
                  class="flex items-center gap-1.5 font-mono text-[11px] text-gold hover:text-gold-hi transition"
                  title="Iniciar cronómetro de descanso">
                  <span class="material-symbols-outlined text-[15px]">timer</span>
                  <span>${formatearTiempo(ej.descansoSegundos || 90)}</span>
                </button>`
          }
        </div>
      </article>
    `;
  }

  /**
   * =========================================================================
   * PANTALLA 3: PLAN (Inspirada 1:1 en titus-plan.webp — Programas Códex)
   * =========================================================================
   */
  function renderPlan() {
    const plan = state.userPlan;
    const p = state.userProfile || draftOnboarding;
    if (!plan) return '';

    const eqLabels = {
      peso_corporal: 'Sin equipo',
      mancuernas: 'Mancuernas',
      calistenia_barra: 'Barra / Parque',
      gimnasio: 'Gym'
    };
    const nivelLabels = {
      principiante: 'Inicial',
      intermedio: 'Intermedio',
      avanzado: 'Avanzado'
    };

    return `
      <div class="space-y-6 animate-view">
        <!-- Encabezado editorial centrado -->
        <div class="text-center space-y-1">
          <h1 class="font-display text-2xl font-semibold tracking-[0.22em] text-gold-metallic uppercase">
            TU PLAN
          </h1>
          <p class="font-editorial italic text-base text-sand">
            Armado por FORGE para tus objetivos
          </p>
        </div>

        <!-- Tarjeta Hero con Medallón Dorado (Inspirada en titus-plan.webp) -->
        <section class="rounded-3xl card-forge-featured overflow-hidden">
          <!-- Medallón clásico minimalista en SVG -->
          <div class="pt-7 pb-4 flex flex-col items-center justify-center bg-gradient-to-b from-obsidian3 via-obsidian2 to-transparent">
            <svg viewBox="0 0 160 160" class="w-36 h-36">
              <defs>
                <linearGradient id="medGold" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#F7E2B5"/>
                  <stop offset="55%" stop-color="#D4A56A"/>
                  <stop offset="100%" stop-color="#7A5A32"/>
                </linearGradient>
              </defs>
              <circle cx="80" cy="80" r="70" fill="none" stroke="url(#medGold)" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.7"/>
              <circle cx="80" cy="80" r="60" fill="rgba(212,165,106,0.05)" stroke="url(#medGold)" stroke-width="1"/>
              <circle cx="80" cy="80" r="46" fill="none" stroke="url(#medGold)" stroke-width="0.6" opacity="0.5"/>
              <!-- Símbolo central FORGE -->
              <path d="M66 105V55h30v7.5H75v13.5h17v7.5H75V105h-9z" fill="url(#medGold)"/>
              <circle cx="80" cy="32" r="2.5" fill="#F7E2B5"/>
              <circle cx="80" cy="128" r="2.5" fill="#A87E48"/>
            </svg>
          </div>

          <div class="px-6 pb-6 space-y-4">
            <div class="font-mono text-[10px] uppercase tracking-[0.26em] text-sand">— PLAN ACTUAL —</div>

            <!-- Etiquetas limpias -->
            <div class="flex flex-wrap items-center gap-2">
              <span class="px-3 py-1 rounded-full bg-gold text-obsidian font-sans text-xs font-semibold">
                ${plan.objetivoNombre || 'Hipertrofia'}
              </span>
              <span class="px-3 py-1 rounded-full bg-mint/10 border border-mint/25 text-mint font-sans text-xs font-medium">
                ${nivelLabels[p.nivel] || 'Intermedio'}
              </span>
            </div>

            <div class="flex flex-wrap items-center gap-2 font-mono text-[11px] text-sand">
              <span class="px-2.5 py-1 rounded-full border hairline">${p.dias || 4} días/sem</span>
              <span class="px-2.5 py-1 rounded-full border hairline">${p.divisionMuscular || 'PPL'}</span>
              <span class="px-2.5 py-1 rounded-full border hairline">${eqLabels[plan.equipamiento] || 'Gym'}</span>
            </div>

            <div>
              <h2 class="font-display text-xl font-bold text-ivory tracking-wide leading-snug uppercase">
                ${(plan.objetivoNombre || 'ENTRENO').toUpperCase()} — ${p.dias || 4} DÍAS ${p.divisionMuscular || 'PPL'}
              </h2>
              <p class="font-editorial italic text-base text-sand mt-1.5">
                ${plan.mensajeCoach || 'Tu plan semanal, ajustado automáticamente con cada serie que registrás.'}
              </p>
            </div>

            <!-- Días incluidos en el plan (clicables directo a Entrenar) -->
            <div class="space-y-2 pt-2 border-t hairline">
              ${plan.sesiones
                .map(
                  (s, idx) => `
                <button type="button" onclick="AppFORGE.abrirDiaEnEntrenar(${idx})"
                  class="w-full px-4 py-3 rounded-xl bg-obsidian/70 hover:bg-obsidian3 border hairline flex items-center justify-between transition text-left">
                  <div class="flex items-center gap-3 min-w-0">
                    <span class="font-display text-xs text-gold w-5">${aRomano(idx)}</span>
                    <div class="min-w-0">
                      <div class="text-sm font-medium text-ivory truncate">${s.titulo || s.divisionMuscular}</div>
                      <div class="text-[11px] text-sand">${s.ejercicios.length} ejercicios</div>
                    </div>
                  </div>
                  <span class="material-symbols-outlined text-gold/60 text-[18px]">chevron_right</span>
                </button>
              `
                )
                .join('')}
            </div>

            <!-- Acciones -->
            <div class="pt-2 space-y-2.5">
              <button type="button" onclick="AppFORGE.irATab('entrenar')"
                class="w-full py-3.5 rounded-full btn-gold font-display text-xs font-bold tracking-[0.2em] uppercase">
                Ir a entrenar hoy
              </button>
              <button type="button" onclick="AppFORGE.regenerarPlanIA()" ${state.generandoIA ? 'disabled' : ''}
                class="w-full py-3 rounded-full btn-ghost font-mono text-[11px] uppercase tracking-[0.14em] flex items-center justify-center gap-2 disabled:opacity-50">
                ${
                  state.generandoIA
                    ? '<span class="w-3.5 h-3.5 border-2 border-gold border-t-transparent rounded-full animate-spin"></span> RECALCULANDO CON IA...'
                    : '<span class="material-symbols-outlined text-[15px]">auto_awesome</span> Renovar rutina con IA'
                }
              </button>
            </div>
          </div>
        </section>
      </div>
    `;
  }

  /**
   * =========================================================================
   * PANTALLA 4: COACH — CONSULTA LIBRE (Inspirada 1:1 en coach-consulta.webp)
   * =========================================================================
   */
  function renderCoach() {
    const sugerencias = [
      '¿Cómo progreso si entreno en casa sin pesas?',
      'Me molesta un hombro, ¿qué ejercicio cambio?',
      '¿Cuándo me conviene subir el peso o las reps?'
    ];

    return `
      <div class="flex flex-col min-h-[76dvh] justify-between gap-4 animate-view">
        <div class="space-y-4">
          <div>
            <h1 class="font-display text-lg font-semibold tracking-[0.18em] text-gold uppercase">Consulta Libre</h1>
            <p class="font-editorial italic text-base text-sand">Preguntale lo que quieras a FORGE sobre tu plan o historial.</p>
          </div>

          <!-- Mensajes -->
          <div id="coach-messages" class="space-y-4">
            ${
              state.chatMensajes.length === 0
                ? `
                <div class="rounded-2xl card-forge p-5 space-y-4">
                  <p class="text-sm text-ivory/90 leading-relaxed">
                    Hola. Tengo a la vista tu plan actual (<strong class="text-gold-soft">${
                      state.userPlan?.objetivoNombre || 'personalizado'
                    }</strong>) y tus <strong class="text-gold-soft">${
                    state.entrenamientos.length
                  } sesiones registradas</strong>. ¿En qué te ayudo hoy?
                  </p>
                  <div class="space-y-2 pt-1">
                    ${sugerencias
                      .map(
                        (q) => `
                      <button type="button" onclick="AppFORGE.enviarConsultaCoach('${q.replace(/'/g, "\\'")}')"
                        class="w-full text-left px-3.5 py-2.5 rounded-xl bg-obsidian/70 hover:border-gold/40 border hairline text-xs text-sand hover:text-ivory transition">
                        ${q}
                      </button>
                    `
                      )
                      .join('')}
                  </div>
                </div>
              `
                : state.chatMensajes
                    .map(
                      (m) => `
                  <div class="${
                    m.rol === 'user'
                      ? 'ml-8 p-3.5 rounded-2xl bg-gold/12 border border-gold/30 text-sm text-ivory'
                      : 'p-4 rounded-2xl card-forge text-sm text-ivory/90 leading-relaxed whitespace-pre-line'
                  }">
                    ${
                      m.rol === 'coach'
                        ? `<div class="font-mono text-[9.5px] uppercase tracking-[0.2em] text-gold mb-2">FORGE COACH</div>`
                        : ''
                    }
                    <div>${m.texto}</div>
                    ${
                      Array.isArray(m.fuentes) && m.fuentes.length > 0
                        ? `<div class="mt-3 pt-2.5 border-t hairline flex flex-wrap gap-1.5">
                            ${m.fuentes
                              .map(
                                (f) => `
                              <a href="${f.url}" target="_blank" rel="noopener noreferrer"
                                class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-obsidian border hairline font-mono text-[9.5px] text-gold-soft hover:border-gold transition">
                                <span class="material-symbols-outlined text-[12px]">public</span>
                                <span class="truncate max-w-[160px]">${f.titulo}</span>
                              </a>
                            `
                              )
                              .join('')}
                          </div>`
                        : ''
                    }
                  </div>
                `
                    )
                    .join('')
            }
            ${
              state.chatEnviando
                ? `<div class="p-4 rounded-2xl card-forge text-xs font-mono text-gold animate-pulse">FORGE está analizando tu historial...</div>`
                : ''
            }
          </div>
        </div>

        <!-- Barra de escritura estilo coach-consulta.webp -->
        <form onsubmit="AppFORGE.submitConsultaCoach(event)" class="flex items-center gap-2 pt-2">
          <input id="coach-input" type="text" autocomplete="off" placeholder="Escribí tu consulta..."
            class="flex-1 px-4 py-3.5 rounded-2xl bg-obsidian2 border hairline text-sm text-ivory placeholder:text-sandDim focus:outline-none focus:border-gold" />
          <button type="submit" ${state.chatEnviando ? 'disabled' : ''}
            class="w-12 h-12 rounded-2xl btn-gold flex items-center justify-center shrink-0 disabled:opacity-50">
            <span class="material-symbols-outlined text-[20px]">send</span>
          </button>
        </form>
      </div>
    `;
  }

  /**
   * =========================================================================
   * PANTALLA 5: PROGRESO Y AJUSTES (Stats dorados + Historial + Configuración)
   * =========================================================================
   */
  function renderProgreso() {
    const esProgreso = state.subTabProgreso === 'progreso';

    return `
      <div class="space-y-6 animate-view">
        <div class="flex items-center justify-between">
          <h1 class="font-display text-xl font-semibold tracking-[0.18em] text-gold-metallic uppercase">
            ${esProgreso ? 'PROGRESO' : 'AJUSTES'}
          </h1>
          <div class="inline-flex p-1 rounded-full card-forge">
            <button type="button" onclick="AppFORGE.cambiarSubTabProgreso('progreso')"
              class="px-3.5 py-1 rounded-full font-mono text-[10px] uppercase tracking-wider transition ${
                esProgreso ? 'btn-gold font-semibold' : 'text-sand'
              }">
              Progreso
            </button>
            <button type="button" onclick="AppFORGE.cambiarSubTabProgreso('ajustes')"
              class="px-3.5 py-1 rounded-full font-mono text-[10px] uppercase tracking-wider transition ${
                !esProgreso ? 'btn-gold font-semibold' : 'text-sand'
              }">
              Ajustes
            </button>
          </div>
        </div>

        ${esProgreso ? renderBloqueProgreso() : renderBloqueAjustes()}
      </div>
    `;
  }

  function renderBloqueProgreso() {
    const totalSesiones = state.entrenamientos.length;
    const volumenTotal = state.entrenamientos.reduce(
      (acc, ses) =>
        acc +
        (ses.ejercicios || []).reduce(
          (a, e) => a + window.MotorEntrenamiento.calcularTonelajeSeries(e.series || []),
          0
        ),
      0
    );
    const totalReps = state.entrenamientos.reduce(
      (acc, ses) =>
        acc +
        (ses.ejercicios || []).reduce(
          (a, e) => a + (e.series || []).reduce((r, s) => r + (Number(s.reps) || 0), 0),
          0
        ),
      0
    );
    const ultimaMet = state.metricasCorporales[state.metricasCorporales.length - 1];

    const nombresDisponibles = Array.from(
      new Set(state.entrenamientos.flatMap((s) => (s.ejercicios || []).map((e) => e.nombre)).filter(Boolean))
    );
    if (nombresDisponibles.length && !nombresDisponibles.includes(state.ejercicioGrafico)) {
      state.ejercicioGrafico = nombresDisponibles[0];
    }

    let modoGrafico = 'kg'; // 'kg' | 'reps' | 'min'
    const puntos = [...state.entrenamientos]
      .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
      .map((s) => {
        const ej = (s.ejercicios || []).find(
          (e) => (e.nombre || '').toLowerCase() === (state.ejercicioGrafico || '').toLowerCase()
        );
        if (!ej?.series?.length) return null;
        const maxMin = Math.max(...ej.series.map((sr) => Number(sr.tiempo_minutos) || 0));
        if (ej.esCardio || maxMin > 0) {
          modoGrafico = 'min';
          const totalMin = ej.series.reduce((acc, sr) => acc + (Number(sr.tiempo_minutos) || 0), 0);
          return { fecha: s.fecha.slice(5), valor: totalMin };
        }
        const maxPeso = Math.max(...ej.series.map((sr) => Number(sr.peso) || 0));
        if (maxPeso > 0) {
          return {
            fecha: s.fecha.slice(5),
            valor: Math.max(...ej.series.map((sr) => window.MotorEntrenamiento.calcular1RMEpley(sr.peso, sr.reps)))
          };
        }
        modoGrafico = 'reps';
        return { fecha: s.fecha.slice(5), valor: Math.max(...ej.series.map((sr) => Number(sr.reps) || 0)) };
      })
      .filter(Boolean);

    return `
      <!-- Dos tarjetas stat al estilo de la landing de TITUS -->
      <div class="grid grid-cols-2 gap-3">
        <div class="p-5 rounded-2xl card-forge">
          <div class="font-display text-3xl font-bold text-gold-metallic leading-none">${totalSesiones}</div>
          <div class="font-mono text-[9.5px] uppercase tracking-[0.18em] text-sand mt-2">Entrenos anotados</div>
        </div>
        <div class="p-5 rounded-2xl card-forge">
          <div class="font-display text-3xl font-bold text-gold-metallic leading-none">
            ${
              volumenTotal > 0
                ? volumenTotal >= 1000
                  ? `${(volumenTotal / 1000).toFixed(1)}t`
                  : `${volumenTotal}`
                : totalReps
            }
          </div>
          <div class="font-mono text-[9.5px] uppercase tracking-[0.18em] text-sand mt-2">
            ${volumenTotal > 0 ? 'Kilos levantados' : 'Reps acumuladas'}
          </div>
        </div>
      </div>

      <!-- Curva de evolución dorada -->
      <section class="p-5 rounded-2xl card-forge space-y-4">
        <div class="flex items-center justify-between gap-2">
          <div>
            <div class="font-display text-xs uppercase tracking-[0.18em] text-ivory">Evolución</div>
            <div class="font-editorial italic text-sm text-sand">${
              modoGrafico === 'min'
                ? 'Minutos de cardio por sesión'
                : modoGrafico === 'reps'
                ? 'Repeticiones máximas por sesión'
                : '1RM estimado (Epley)'
            }</div>
          </div>
          ${
            nombresDisponibles.length
              ? `<select onchange="AppFORGE.cambiarEjercicioGrafico(this.value)"
                  class="px-3 py-1.5 rounded-full bg-obsidian border hairline text-[11px] text-gold-soft max-w-[160px] focus:outline-none">
                  ${nombresDisponibles
                    .map((n) => `<option value="${n}" ${n === state.ejercicioGrafico ? 'selected' : ''}>${n}</option>`)
                    .join('')}
                </select>`
              : ''
          }
        </div>
        ${renderCurvaDorada(puntos, modoGrafico)}
      </section>

      <!-- Peso corporal -->
      <section class="p-5 rounded-2xl card-forge flex items-center justify-between">
        <div>
          <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-sand">Peso corporal</div>
          <div class="font-display text-2xl font-bold text-ivory mt-1">
            ${ultimaMet ? `${ultimaMet.pesoCorporalKg} kg` : 'Sin registrar'}
          </div>
        </div>
        <button type="button" onclick="AppFORGE.abrirModalBiometria()"
          class="px-4 py-2 rounded-full btn-ghost font-mono text-[10px] uppercase tracking-wider">
          Registrar
        </button>
      </section>

      <!-- Historial limpio -->
      <section class="space-y-3">
        <div class="font-mono text-[10px] uppercase tracking-[0.22em] text-sand px-1">Historial reciente</div>
        ${
          !state.entrenamientos.length
            ? `<div class="p-8 rounded-2xl card-forge text-center text-sm text-sand">Todavía no registraste sesiones.</div>`
            : [...state.entrenamientos]
                .reverse()
                .map((ses, idx) => {
                  const realIdx = state.entrenamientos.length - 1 - idx;
                  return `
                  <article class="p-4 rounded-2xl card-forge space-y-2.5">
                    <div class="flex items-center justify-between">
                      <div>
                        <span class="font-display text-sm font-semibold tracking-wider uppercase text-ivory">${ses.divisionMuscular}</span>
                        <span class="font-mono text-[10px] text-sand ml-2">${ses.fecha}</span>
                      </div>
                      <button type="button" onclick="AppFORGE.eliminarSesion(${realIdx})"
                        class="text-sandDim hover:text-ivory transition" title="Eliminar">
                        <span class="material-symbols-outlined text-[16px]">delete</span>
                      </button>
                    </div>
                    <div class="space-y-1 pt-2 border-t hairline">
                      ${(ses.ejercicios || [])
                        .map((e) => {
                          const esCardioHist =
                            Boolean(e.esCardio) ||
                            (e.series || []).some((sr) => (Number(sr.tiempo_minutos) || 0) > 0);
                          if (esCardioHist) {
                            const totalMin = (e.series || []).reduce(
                              (acc, sr) => acc + (Number(sr.tiempo_minutos) || 0),
                              0
                            );
                            const badge = obtenerBadgeCardio(e.intensidadCardio || 'medio');
                            return `
                              <div class="flex items-center justify-between text-xs">
                                <span class="font-editorial italic text-[15px] text-ivory/90 truncate pr-2">${e.nombre}</span>
                                <span class="font-mono text-[11px] text-mint shrink-0">${totalMin} min · ${badge.short}</span>
                              </div>
                            `;
                          }
                          const mejor = (e.series || []).reduce(
                            (b, c) => ((c.peso || 0) >= (b.peso || 0) && (c.reps || 0) >= (b.reps || 0) ? c : b),
                            e.series?.[0] || { peso: 0, reps: 0 }
                          );
                          const txt = Number(mejor.peso) > 0 ? `${mejor.peso} kg × ${mejor.reps}` : `${mejor.reps} reps`;
                          return `
                          <div class="flex items-center justify-between text-xs">
                            <span class="font-editorial italic text-[15px] text-ivory/90 truncate pr-2">${e.nombre}</span>
                            <span class="font-mono text-[11px] text-gold shrink-0">${e.series?.length || 0}× · ${txt}</span>
                          </div>
                        `;
                        })
                        .join('')}
                    </div>
                  </article>
                `;
                })
                .join('')
        }
      </section>
    `;
  }

  function renderCurvaDorada(puntos, unidad = 'kg') {
    if (!puntos.length) {
      return `<div class="h-32 rounded-xl bg-obsidian/60 border border-dashed hairline flex items-center justify-center text-xs text-sandDim">Anotá tu primer entreno para ver la curva</div>`;
    }
    const w = 340;
    const h = 125;
    const padX = 28;
    const padY = 22;
    const vals = puntos.map((p) => p.valor);
    const min = Math.max(0, Math.min(...vals) * 0.88);
    const max = Math.max(...vals) * 1.1 || 10;

    const coords = puntos.map((p, i) => ({
      ...p,
      x: puntos.length === 1 ? w / 2 : padX + (i / (puntos.length - 1)) * (w - padX * 2),
      y: h - padY - ((p.valor - min) / Math.max(1, max - min)) * (h - padY * 2)
    }));

    const line = coords.map((c) => `${c.x},${c.y}`).join(' ');
    const area =
      coords.length > 1
        ? `M ${coords[0].x},${h - padY} L ${coords.map((c) => `${c.x},${c.y}`).join(' L ')} L ${
            coords[coords.length - 1].x
          },${h - padY} Z`
        : '';

    return `
      <svg viewBox="0 0 ${w} ${h}" class="w-full h-32">
        <defs>
          <linearGradient id="goldWave" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#D4A56A" stop-opacity="0.32" />
            <stop offset="100%" stop-color="#D4A56A" stop-opacity="0" />
          </linearGradient>
        </defs>
        ${area ? `<path d="${area}" fill="url(#goldWave)" />` : ''}
        ${
          coords.length > 1
            ? `<polyline fill="none" stroke="#D4A56A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${line}" />`
            : ''
        }
        ${coords
          .map(
            (c) => `
          <circle cx="${c.x}" cy="${c.y}" r="4" fill="#F7E2B5" stroke="#060504" stroke-width="1.5" />
          <text x="${c.x}" y="${c.y - 9}" text-anchor="middle" fill="#F5F2E8" font-size="10" font-family="JetBrains Mono">${Math.round(
              c.valor
            )}${unidad === 'reps' ? 'r' : unidad === 'min' ? 'm' : ''}</text>
          <text x="${c.x}" y="${h - 5}" text-anchor="middle" fill="#7A6C54" font-size="9" font-family="JetBrains Mono">${
              c.fecha
            }</text>
        `
          )
          .join('')}
      </svg>
    `;
  }

  function renderBloqueAjustes() {
    return `
      <div class="space-y-4">
        <div class="rounded-2xl card-forge divide-y hairline overflow-hidden">
          <button type="button" onclick="AppFORGE.abrirOnboarding()"
            class="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-white/[0.02] transition">
            <div>
              <div class="text-sm font-medium text-ivory">Rehacer cuestionario del plan</div>
              <div class="text-xs text-sand">Cambiá objetivo, días o equipamiento</div>
            </div>
            <span class="material-symbols-outlined text-gold/70 text-[18px]">chevron_right</span>
          </button>

          <div class="px-5 py-4 flex items-center justify-between">
            <span class="text-sm font-medium text-ivory">Salto de discos</span>
            <div class="inline-flex p-1 rounded-full bg-obsidian border hairline">
              ${[1.25, 2.5]
                .map(
                  (val) => `
                <button type="button" onclick="AppFORGE.cambiarPasoDisco(${val})"
                  class="px-3 py-1 rounded-full font-mono text-[11px] transition ${
                    state.pasoDisco === val ? 'btn-gold font-semibold' : 'text-sand'
                  }">
                  ${val} kg
                </button>
              `
                )
                .join('')}
            </div>
          </div>

          <div class="px-5 py-4 flex items-center justify-between">
            <div>
              <div class="text-sm font-medium text-ivory">Semana de descarga (Deload)</div>
              <div class="text-xs text-sand">Reduce volumen e intensidad para recuperar</div>
            </div>
            <button type="button" onclick="AppFORGE.alternarDeload()"
              class="w-11 h-6 rounded-full p-0.5 transition ${state.modoDeload ? 'bg-gold' : 'bg-white/15'}">
              <div class="w-5 h-5 rounded-full bg-obsidian transition-transform ${
                state.modoDeload ? 'translate-x-5' : 'translate-x-0'
              }"></div>
            </button>
          </div>
        </div>

        <div class="rounded-2xl card-forge divide-y hairline overflow-hidden">
          <button type="button" onclick="AppFORGE.exportarJSON()"
            class="w-full px-5 py-3.5 flex items-center justify-between text-left text-sm text-ivory hover:bg-white/[0.02]">
            <span>Exportar respaldo (.json)</span>
            <span class="material-symbols-outlined text-sand text-[18px]">download</span>
          </button>
          <button type="button" onclick="AppFORGE.restaurarDemo()"
            class="w-full px-5 py-3.5 flex items-center justify-between text-left text-sm text-gold-soft hover:bg-white/[0.02]">
            <span>Cargar demo de gimnasio (Press 85kg × 6)</span>
            <span class="material-symbols-outlined text-gold text-[18px]">restart_alt</span>
          </button>
          <button type="button" onclick="AppFORGE.vaciarHistorial()"
            class="w-full px-5 py-3.5 flex items-center justify-between text-left text-sm text-red-400 hover:bg-white/[0.02]">
            <span>Borrar historial</span>
            <span class="material-symbols-outlined text-red-400 text-[18px]">delete_outline</span>
          </button>
        </div>

        <details class="rounded-2xl card-forge p-4">
          <summary class="font-mono text-[10px] uppercase tracking-[0.18em] text-sand cursor-pointer">
            Avanzado (API Key e inspector localStorage)
          </summary>
          <div class="mt-4 space-y-3">
            <div class="flex gap-2">
              <input id="perfil-api-key" type="password"
                value="${localStorage.getItem(STORAGE_KEYS.GEMINI_KEY) || DEFAULT_API_KEY}"
                class="flex-1 px-3 py-2 rounded-xl bg-obsidian border hairline font-mono text-xs text-ivory focus:outline-none focus:border-gold" />
              <button type="button" onclick="AppFORGE.guardarApiKey()"
                class="px-4 py-2 rounded-xl btn-gold font-display text-[10px] font-bold uppercase">
                Guardar
              </button>
            </div>
            <pre class="text-[11px] font-mono text-mint/90 bg-obsidian p-3 rounded-xl overflow-x-auto max-h-48">${JSON.stringify(
              { entrenamientos: state.entrenamientos },
              null,
              2
            )}</pre>
          </div>
        </details>

        <p class="font-editorial italic text-xs text-center text-sandDim px-4">
          FORGE es una herramienta de entrenamiento. No reemplaza evaluación médica profesional.
        </p>
      </div>
    `;
  }

  /**
   * =========================================================================
   * MODALES (Técnica y Biometría)
   * =========================================================================
   */
  function abrirModalHTML(html) {
    const backdrop = document.getElementById('app-modal-backdrop');
    const panel = document.getElementById('app-modal-panel');
    if (!backdrop || !panel) return;
    panel.innerHTML = html;
    backdrop.classList.remove('opacity-0', 'pointer-events-none');
    panel.classList.remove('translate-y-8');
  }

  function cerrarModal(ev) {
    if (ev && ev.target && ev.target.id !== 'app-modal-backdrop') return;
    const backdrop = document.getElementById('app-modal-backdrop');
    const panel = document.getElementById('app-modal-panel');
    if (!backdrop || !panel) return;
    backdrop.classList.add('opacity-0', 'pointer-events-none');
    panel.classList.add('translate-y-8');
  }

  function abrirModalEjercicio(ejIdx) {
    const ej = obtenerSesionActual()?.ejercicios?.[ejIdx];
    if (!ej) return;
    const esCardio = Boolean(ej.esCardio || ej.tipo === 'cardio');
    const badgeCardio = esCardio ? obtenerBadgeCardio(ej.intensidadCardio || 'medio') : null;

    abrirModalHTML(`
      <div class="space-y-5">
        <div class="flex items-start justify-between gap-3">
          <div>
            <span class="font-mono text-[10px] uppercase tracking-[0.2em] text-gold">${ej.grupoMuscular}</span>
            <h3 class="font-editorial italic text-2xl font-medium text-ivory mt-0.5">${ej.nombre}</h3>
            ${
              esCardio
                ? `<div class="mt-2">
                    <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border font-mono text-[9.5px] uppercase tracking-[0.16em] ${badgeCardio.cls}">
                      <span class="material-symbols-outlined text-[12px]">directions_run</span>
                      <span>${badgeCardio.label} · Solo tiempo</span>
                    </span>
                  </div>`
                : ''
            }
          </div>
          <button type="button" onclick="AppFORGE.cerrarModal()"
            class="w-8 h-8 rounded-full border hairline text-sand hover:text-ivory flex items-center justify-center">
            <span class="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>

        ${
          ej.porQueEsteEjercicio
            ? `<div class="p-4 rounded-2xl bg-gold/8 border border-gold/25 space-y-1">
                <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-gold">¿Por qué elegí este ejercicio para vos?</div>
                <p class="text-sm text-ivory/90 leading-relaxed">${ej.porQueEsteEjercicio}</p>
              </div>`
            : ''
        }

        <div class="p-4 rounded-2xl card-forge space-y-1">
          <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-gold">Clave técnica</div>
          <p class="text-sm text-ivory/90 leading-relaxed">${ej.notaTecnica}</p>
        </div>

        <div class="grid grid-cols-2 gap-3 text-xs">
          <div class="p-3.5 rounded-2xl card-forge">
            <span class="text-sand block mb-1">Más accesible</span>
            <strong class="text-ivory">${ej.regresion}</strong>
          </div>
          <div class="p-3.5 rounded-2xl card-forge">
            <span class="text-sand block mb-1">Siguiente nivel</span>
            <strong class="text-gold-soft">${ej.progresion}</strong>
          </div>
        </div>

        <!-- Acciones directas sobre el ejercicio -->
        <div class="pt-3 border-t hairline grid grid-cols-3 gap-2">
          <button type="button" onclick="AppFORGE.abrirModalEditarEjercicio(${ejIdx})"
            class="py-2.5 px-2 rounded-xl card-forge hover:border-gold/50 text-ivory font-mono text-[10px] uppercase tracking-wider flex items-center justify-center gap-1 transition">
            <span class="material-symbols-outlined text-[15px] text-gold">edit</span>
            <span>Editar</span>
          </button>
          <button type="button" onclick="AppFORGE.abrirModalAgregarEjercicio(${ejIdx}, '${esCardio ? 'cardio' : 'todos'}')"
            class="py-2.5 px-2 rounded-xl card-forge hover:border-gold/50 text-gold-soft font-mono text-[10px] uppercase tracking-wider flex items-center justify-center gap-1 transition">
            <span class="material-symbols-outlined text-[15px] text-gold">swap_horiz</span>
            <span>Cambiar</span>
          </button>
          <button type="button" onclick="AppFORGE.eliminarEjercicioDeSesion(${ejIdx})"
            class="py-2.5 px-2 rounded-xl bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 text-red-300 font-mono text-[10px] uppercase tracking-wider flex items-center justify-center gap-1 transition">
            <span class="material-symbols-outlined text-[15px]">delete</span>
            <span>Eliminar</span>
          </button>
        </div>
      </div>
    `);
  }

  /**
   * =========================================================================
   * EDITOR DE EJERCICIOS, BUSCADOR EN BASE DE DATOS Y ANÁLISIS DE CAMBIOS
   * =========================================================================
   */
  let buscadorState = {
    reemplazarIdx: null,
    modo: 'buscar', // 'buscar' | 'propio'
    soloMiEquipo: true,
    categoriaFiltro: 'todos', // 'todos' | 'fuerza' | 'cardio'
    intensidadCardio: 'todas', // 'todas' | 'intenso' | 'medio' | 'bajo'
    modalidadPropio: 'peso', // 'peso' | 'corporal' | 'cardio'
    query: '',
    catalogo: []
  };

  async function abrirModalAgregarEjercicio(reemplazarIdx = null, filtroInicial = 'todos') {
    const eqUsuario = state.userProfile?.equipamiento || 'gimnasio';
    buscadorState.reemplazarIdx = reemplazarIdx;
    buscadorState.modo = 'buscar';
    buscadorState.query = '';
    buscadorState.soloMiEquipo = true;
    buscadorState.categoriaFiltro = filtroInicial || 'todos';
    buscadorState.intensidadCardio = 'todas';
    buscadorState.modalidadPropio =
      filtroInicial === 'cardio' ? 'cardio' : eqUsuario === 'peso_corporal' ? 'corporal' : 'peso';
    buscadorState.catalogo = await window.MotorEntrenamiento.obtenerCatalogoCompleto();
    renderModalBuscadorEjercicio();
  }

  function cambiarModoBuscador(modo) {
    buscadorState.modo = modo;
    renderModalBuscadorEjercicio();
  }

  function cambiarFiltroBuscador(soloEquipo) {
    buscadorState.soloMiEquipo = soloEquipo;
    renderModalBuscadorEjercicio();
  }

  function cambiarCategoriaBuscador(cat) {
    buscadorState.categoriaFiltro = cat;
    if (cat !== 'cardio') {
      buscadorState.intensidadCardio = 'todas';
    } else {
      buscadorState.modalidadPropio = 'cardio';
    }
    renderModalBuscadorEjercicio();
  }

  function cambiarIntensidadBuscador(nivelInt) {
    buscadorState.intensidadCardio = nivelInt;
    renderModalBuscadorEjercicio();
  }

  function cambiarModalidadPropio(mod) {
    buscadorState.modalidadPropio = mod;
    renderModalBuscadorEjercicio();
  }

  function actualizarQueryBuscador(val) {
    buscadorState.query = val || '';
    const listaEl = document.getElementById('buscador-resultados-lista');
    if (listaEl) {
      listaEl.innerHTML = renderResultadosBuscadorHTML();
    }
  }

  function renderResultadosBuscadorHTML() {
    const eqUsuario = state.userProfile?.equipamiento || 'gimnasio';
    const q = buscadorState.query.trim().toLowerCase();

    const filtrados = buscadorState.catalogo.filter((ej) => {
      const esCardio = Boolean(ej.esCardio || ej.tipo === 'cardio' || ej.categoria === 'Cardio');
      if (buscadorState.categoriaFiltro === 'cardio' && !esCardio) return false;
      if (buscadorState.categoriaFiltro === 'fuerza' && esCardio) return false;
      if (
        buscadorState.categoriaFiltro === 'cardio' &&
        buscadorState.intensidadCardio !== 'todas' &&
        ej.intensidadCardio !== buscadorState.intensidadCardio
      ) {
        return false;
      }
      if (buscadorState.soloMiEquipo && !(ej.equipamiento || []).includes(eqUsuario)) {
        return false;
      }
      if (!q) return true;
      const intTxt = esCardio ? obtenerBadgeCardio(ej.intensidadCardio).label : '';
      const texto = `${ej.nombre} ${ej.grupoMuscular} ${ej.categoria} ${intTxt} ${(ej.niveles || []).join(' ')}`.toLowerCase();
      return texto.includes(q);
    });

    if (!filtrados.length) {
      return `
        <div class="p-6 rounded-2xl card-forge text-center space-y-2">
          <p class="text-xs text-sand">No encontramos ejercicios con este filtro${buscadorState.query ? ` ("${buscadorState.query}")` : ''}.</p>
          <button type="button" onclick="AppFORGE.cambiarModoBuscador('propio')"
            class="px-4 py-2 rounded-full btn-gold font-display text-[10px] font-bold uppercase tracking-wider">
            + Crearlo como ejercicio propio
          </button>
        </div>
      `;
    }

    const rIdx = buscadorState.reemplazarIdx === null ? 'null' : buscadorState.reemplazarIdx;
    return filtrados
      .map((ej) => {
        const esCardio = Boolean(ej.esCardio || ej.tipo === 'cardio');
        const badge = esCardio ? obtenerBadgeCardio(ej.intensidadCardio || 'medio') : null;
        return `
      <button type="button" onclick="AppFORGE.seleccionarEjercicioDeBD('${ej.id}', ${rIdx})"
        class="w-full text-left p-3.5 rounded-xl bg-obsidian hover:bg-obsidian3 border hairline hover:border-gold/45 transition flex items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="font-editorial italic text-[17px] text-ivory truncate">${ej.nombre}</div>
          ${
            esCardio
              ? `<div class="flex flex-wrap items-center gap-1.5 mt-1 font-mono text-[9.5px]">
                  <span class="px-2 py-0.5 rounded-full border ${badge.cls} uppercase">${badge.short}</span>
                  <span class="text-sand">${ej.duracionMinutos || 15} min · Solo tiempo</span>
                </div>`
              : `<div class="flex flex-wrap items-center gap-1.5 mt-0.5 font-mono text-[9.5px] text-sand">
                  <span>${ej.grupoMuscular}</span>
                  <span>·</span>
                  <span class="text-gold/90 uppercase">${(ej.niveles || []).join(' / ')}</span>
                </div>`
          }
        </div>
        <span class="material-symbols-outlined text-gold text-[18px] shrink-0">add_circle</span>
      </button>
    `;
      })
      .join('');
  }

  function renderModalBuscadorEjercicio() {
    const esReemplazo = buscadorState.reemplazarIdx !== null;
    const esBuscar = buscadorState.modo === 'buscar';
    const mod = buscadorState.modalidadPropio;
    const esPropioCardio = mod === 'cardio';

    abrirModalHTML(`
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <div class="font-mono text-[9.5px] uppercase tracking-[0.2em] text-gold">
              ${esReemplazo ? 'REEMPLAZAR EJERCICIO' : 'SUMAR A LA SESIÓN'}
            </div>
            <h3 class="font-display text-lg uppercase tracking-wider text-ivory mt-0.5">
              ${esBuscar ? 'Base de datos FORGE' : esPropioCardio ? 'Nuevo Cardio (Solo tiempo)' : 'Nuevo ejercicio propio'}
            </h3>
          </div>
          <button type="button" onclick="AppFORGE.cerrarModal()"
            class="w-8 h-8 rounded-full border hairline text-sand hover:text-ivory flex items-center justify-center">
            <span class="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>

        <!-- Selector Buscar en BD vs Crear Propio -->
        <div class="grid grid-cols-2 gap-1.5 p-1 rounded-full bg-obsidian border hairline">
          <button type="button" onclick="AppFORGE.cambiarModoBuscador('buscar')"
            class="py-2 rounded-full font-mono text-[10px] uppercase tracking-wider transition ${
              esBuscar ? 'btn-gold font-semibold' : 'text-sand hover:text-ivory'
            }">
            Buscar en BD
          </button>
          <button type="button" onclick="AppFORGE.cambiarModoBuscador('propio')"
            class="py-2 rounded-full font-mono text-[10px] uppercase tracking-wider transition ${
              !esBuscar ? 'btn-gold font-semibold' : 'text-sand hover:text-ivory'
            }">
            + Crear propio
          </button>
        </div>

        ${
          esBuscar
            ? `
              <div class="space-y-3">
                <input type="text" value="${buscadorState.query}" autofocus
                  oninput="AppFORGE.actualizarQueryBuscador(this.value)"
                  placeholder="${
                    buscadorState.categoriaFiltro === 'cardio'
                      ? 'Buscar Tabata, HIIT, sin impacto, caminata...'
                      : 'Buscar por nombre, músculo, cardio o nivel...'
                  }"
                  class="w-full px-4 py-3 rounded-xl bg-obsidian border hairline text-sm text-ivory placeholder:text-sandDim focus:outline-none focus:border-gold" />

                <!-- Filtro de categoría: Todos / Fuerza / Cardio -->
                <div class="grid grid-cols-3 gap-1.5">
                  ${[
                    { id: 'todos', label: 'Todos' },
                    { id: 'fuerza', label: 'Fuerza' },
                    { id: 'cardio', label: 'Cardio' }
                  ]
                    .map(
                      (c) => `
                    <button type="button" onclick="AppFORGE.cambiarCategoriaBuscador('${c.id}')"
                      class="py-1.5 rounded-xl font-mono text-[10px] uppercase tracking-wider border transition ${
                        buscadorState.categoriaFiltro === c.id
                          ? c.id === 'cardio'
                            ? 'border-mint bg-mint/15 text-mint font-semibold'
                            : 'border-gold bg-gold/15 text-gold-hi font-semibold'
                          : 'hairline text-sand hover:text-ivory'
                      }">
                      ${c.label}
                    </button>
                  `
                    )
                    .join('')}
                </div>

                <!-- Sub-filtros de intensidad cuando está seleccionado CARDIO -->
                ${
                  buscadorState.categoriaFiltro === 'cardio'
                    ? `<div class="flex flex-wrap gap-1.5">
                        ${[
                          { id: 'todas', label: 'Todas' },
                          { id: 'intenso', label: 'Intenso (HIIT/Tabata)' },
                          { id: 'medio', label: 'Medio' },
                          { id: 'bajo', label: 'Bajo (Sin impacto)' }
                        ]
                          .map(
                            (it) => `
                          <button type="button" onclick="AppFORGE.cambiarIntensidadBuscador('${it.id}')"
                            class="px-2.5 py-1 rounded-full font-mono text-[9.5px] uppercase tracking-wider border transition ${
                              buscadorState.intensidadCardio === it.id
                                ? 'border-gold bg-gold/15 text-gold-hi font-semibold'
                                : 'hairline text-sand hover:text-ivory'
                            }">
                            ${it.label}
                          </button>
                        `
                          )
                          .join('')}
                      </div>`
                    : ''
                }

                <div class="flex items-center gap-2">
                  <button type="button" onclick="AppFORGE.cambiarFiltroBuscador(true)"
                    class="px-3 py-1 rounded-full font-mono text-[10px] uppercase tracking-wider border transition ${
                      buscadorState.soloMiEquipo
                        ? 'border-gold bg-gold/15 text-gold-hi'
                        : 'hairline text-sand'
                    }">
                    Solo mi equipo
                  </button>
                  <button type="button" onclick="AppFORGE.cambiarFiltroBuscador(false)"
                    class="px-3 py-1 rounded-full font-mono text-[10px] uppercase tracking-wider border transition ${
                      !buscadorState.soloMiEquipo
                        ? 'border-gold bg-gold/15 text-gold-hi'
                        : 'hairline text-sand'
                    }">
                    Ver toda la BD (${buscadorState.catalogo.length})
                  </button>
                </div>

                <div id="buscador-resultados-lista" class="space-y-2 max-h-[40dvh] overflow-y-auto pr-0.5">
                  ${renderResultadosBuscadorHTML()}
                </div>
              </div>
            `
            : `
              <form onsubmit="AppFORGE.guardarEjercicioPropio(event)" class="space-y-3.5">
                <!-- Modalidad del ejercicio -->
                <div>
                  <label class="font-mono text-[10px] uppercase text-sand block mb-1.5">Modalidad</label>
                  <div class="grid grid-cols-3 gap-1.5">
                    ${[
                      { id: 'peso', label: 'Con peso (kg)' },
                      { id: 'corporal', label: 'Peso corporal' },
                      { id: 'cardio', label: 'Cardio (tiempo)' }
                    ]
                      .map(
                        (m) => `
                      <button type="button" onclick="AppFORGE.cambiarModalidadPropio('${m.id}')"
                        class="py-2 px-1.5 rounded-xl font-mono text-[9.5px] uppercase tracking-wider border transition ${
                          mod === m.id
                            ? m.id === 'cardio'
                              ? 'border-mint bg-mint/15 text-mint font-semibold'
                              : 'border-gold bg-gold/15 text-gold-hi font-semibold'
                            : 'hairline text-sand hover:text-ivory'
                        }">
                        ${m.label}
                      </button>
                    `
                      )
                      .join('')}
                  </div>
                </div>

                <div>
                  <label class="font-mono text-[10px] uppercase text-sand block mb-1">Nombre del ejercicio</label>
                  <input id="custom-ej-nombre" type="text" required placeholder="${
                    esPropioCardio
                      ? 'Ej: Tabata en bici fija / Caminata en cinta'
                      : 'Ej: Flexiones con banda elástica'
                  }"
                    class="w-full px-3.5 py-2.5 rounded-xl bg-obsidian border hairline text-sm text-ivory focus:outline-none focus:border-gold" />
                </div>

                ${
                  esPropioCardio
                    ? `
                      <div>
                        <label class="font-mono text-[10px] uppercase text-sand block mb-1">Intensidad de Cardio</label>
                        <select id="custom-cardio-intensidad"
                          class="w-full px-3 py-2.5 rounded-xl bg-obsidian border hairline text-xs text-ivory focus:outline-none focus:border-gold">
                          <option value="intenso">Intenso (HIIT / Tabata)</option>
                          <option value="medio" selected>Medio (Aeróbico continuo)</option>
                          <option value="bajo">Bajo (Sin impacto)</option>
                        </select>
                      </div>

                      <div class="grid grid-cols-3 gap-2.5">
                        <div>
                          <label class="font-mono text-[10px] uppercase text-sand block mb-1">Bloques</label>
                          <input id="custom-ej-series" type="number" min="1" max="8" value="1"
                            class="w-full px-3 py-2 rounded-xl bg-obsidian border hairline font-mono text-sm text-ivory text-center" />
                        </div>
                        <div>
                          <label class="font-mono text-[10px] uppercase text-sand block mb-1">Minutos</label>
                          <input id="custom-cardio-min" type="number" min="1" max="180" value="15"
                            class="w-full px-3 py-2 rounded-xl bg-obsidian border hairline font-mono text-sm text-ivory text-center" />
                        </div>
                        <div>
                          <label class="font-mono text-[10px] uppercase text-sand block mb-1">Pausa (s)</label>
                          <input id="custom-ej-desc" type="number" min="15" max="300" step="15" value="60"
                            class="w-full px-3 py-2 rounded-xl bg-obsidian border hairline font-mono text-sm text-ivory text-center" />
                        </div>
                      </div>
                    `
                    : `
                      <div class="grid grid-cols-2 gap-3">
                        <div>
                          <label class="font-mono text-[10px] uppercase text-sand block mb-1">Grupo muscular</label>
                          <select id="custom-ej-musculo"
                            class="w-full px-3 py-2.5 rounded-xl bg-obsidian border hairline text-xs text-ivory focus:outline-none focus:border-gold">
                            <option value="Pectoral">Pectoral</option>
                            <option value="Espalda / Dorsal">Espalda / Dorsal</option>
                            <option value="Cuádriceps / Pierna">Cuádriceps / Pierna</option>
                            <option value="Isquios / Glúteo">Isquios / Glúteo</option>
                            <option value="Hombros">Hombros</option>
                            <option value="Bíceps / Tríceps">Bíceps / Tríceps</option>
                            <option value="Core / Abdomen">Core / Abdomen</option>
                          </select>
                        </div>
                        <div>
                          <label class="font-mono text-[10px] uppercase text-sand block mb-1">Tipo</label>
                          <select id="custom-ej-tipo"
                            class="w-full px-3 py-2.5 rounded-xl bg-obsidian border hairline text-xs text-ivory focus:outline-none focus:border-gold">
                            <option value="compuesto">Compuesto</option>
                            <option value="aislado">Aislado</option>
                          </select>
                        </div>
                      </div>

                      <div class="grid grid-cols-3 gap-2.5">
                        <div>
                          <label class="font-mono text-[10px] uppercase text-sand block mb-1">Series</label>
                          <input id="custom-ej-series" type="number" min="1" max="8" value="3"
                            class="w-full px-3 py-2 rounded-xl bg-obsidian border hairline font-mono text-sm text-ivory text-center" />
                        </div>
                        <div>
                          <label class="font-mono text-[10px] uppercase text-sand block mb-1">Reps</label>
                          <input id="custom-ej-reps" type="number" min="1" max="50" value="10"
                            class="w-full px-3 py-2 rounded-xl bg-obsidian border hairline font-mono text-sm text-ivory text-center" />
                        </div>
                        <div>
                          <label class="font-mono text-[10px] uppercase text-sand block mb-1">Desc. (s)</label>
                          <input id="custom-ej-desc" type="number" min="15" max="300" step="15" value="90"
                            class="w-full px-3 py-2 rounded-xl bg-obsidian border hairline font-mono text-sm text-ivory text-center" />
                        </div>
                      </div>
                    `
                }

                <button type="submit"
                  class="w-full py-3.5 rounded-full btn-gold font-display text-xs font-bold tracking-[0.2em] uppercase">
                  ${esReemplazo ? 'Reemplazar con este ejercicio' : esPropioCardio ? 'Agregar Cardio a mi sesión' : 'Agregar a mi sesión'}
                </button>
              </form>
            `
        }
      </div>
    `);
  }

  async function seleccionarEjercicioDeBD(ejId, reemplazarIdx) {
    const sesion = obtenerSesionActual();
    if (!sesion) return;
    const encontrado = buscadorState.catalogo.find((e) => e.id === ejId);
    if (!encontrado) return;

    const listo = await window.MotorEntrenamiento.construirEjercicioListo(
      encontrado,
      state.userProfile,
      state.entrenamientos,
      state.modoDeload
    );

    if (reemplazarIdx !== null && reemplazarIdx !== undefined && sesion.ejercicios[reemplazarIdx]) {
      sesion.ejercicios[reemplazarIdx] = listo;
      mostrarToastRecalibro('EJERCICIO CAMBIADO', `Ahora tenés ${listo.nombre}. Tocá Analizar para revisar el ajuste.`);
    } else {
      sesion.ejercicios.push(listo);
      mostrarToastRecalibro('EJERCICIO AGREGADO', `${listo.nombre} sumado a ${sesion.titulo}.`);
    }

    sesion.modificadaPorUsuario = true;
    guardarUserPlan(state.userPlan);
    cerrarModal();
    renderizar();
  }

  async function guardarEjercicioPropio(ev) {
    ev.preventDefault();
    const sesion = obtenerSesionActual();
    if (!sesion) return;

    const nombre = (document.getElementById('custom-ej-nombre')?.value || '').trim();
    if (!nombre) return;

    const mod = buscadorState.modalidadPropio || 'peso';
    const esCardio = mod === 'cardio';
    const esPesoCorporal = mod === 'corporal' || esCardio;
    const series = Number(document.getElementById('custom-ej-series')?.value) || (esCardio ? 1 : 3);
    const desc = Number(document.getElementById('custom-ej-desc')?.value) || (esCardio ? 60 : 90);

    let payloadEjercicio;
    if (esCardio) {
      const intensidadCardio = document.getElementById('custom-cardio-intensidad')?.value || 'medio';
      const duracionMinutos = Math.max(1, Number(document.getElementById('custom-cardio-min')?.value) || 15);
      const badge = obtenerBadgeCardio(intensidadCardio);
      payloadEjercicio = {
        nombre,
        grupoMuscular: `Cardio · ${badge.short}`,
        tipo: 'cardio',
        esCardio: true,
        intensidadCardio,
        duracionMinutos,
        esPesoCorporal: true,
        pesoSugerido: 0,
        seriesObjetivo: series,
        descansoSegundos: desc,
        porQueEsteEjercicio: `Cardio ${badge.short} agregado manualmente por vos (solo por tiempo).`
      };
    } else {
      const musculo = document.getElementById('custom-ej-musculo')?.value || 'Personalizado';
      const tipo = document.getElementById('custom-ej-tipo')?.value || 'compuesto';
      const reps = Number(document.getElementById('custom-ej-reps')?.value) || 10;
      payloadEjercicio = {
        nombre,
        grupoMuscular: musculo,
        tipo,
        esCardio: false,
        esPesoCorporal,
        pesoSugerido: esPesoCorporal ? 0 : 20,
        seriesObjetivo: series,
        repsMin: Math.max(4, reps - 2),
        repsMax: reps + 2,
        repsSugeridas: reps,
        descansoSegundos: desc,
        porQueEsteEjercicio: 'Ejercicio personalizado agregado por vos.'
      };
    }

    const listo = await window.MotorEntrenamiento.construirEjercicioListo(
      payloadEjercicio,
      state.userProfile,
      state.entrenamientos,
      state.modoDeload
    );

    const rIdx = buscadorState.reemplazarIdx;
    if (rIdx !== null && rIdx !== undefined && sesion.ejercicios[rIdx]) {
      sesion.ejercicios[rIdx] = listo;
      mostrarToastRecalibro('EJERCICIO REEMPLAZADO', `Actualizado a ${listo.nombre}.`);
    } else {
      sesion.ejercicios.push(listo);
      mostrarToastRecalibro(esCardio ? 'CARDIO AGREGADO' : 'EJERCICIO CREADO', `${listo.nombre} sumado a tu sesión.`);
    }

    sesion.modificadaPorUsuario = true;
    guardarUserPlan(state.userPlan);
    cerrarModal();
    renderizar();
  }

  let edicionModalidadActual = 'peso';

  function cambiarModalidadEdicion(ejIdx, mod) {
    edicionModalidadActual = mod;
    abrirModalEditarEjercicio(ejIdx, mod);
  }

  function abrirModalEditarEjercicio(ejIdx, modalidadForzada = null) {
    const ej = obtenerSesionActual()?.ejercicios?.[ejIdx];
    if (!ej) return;

    const mod =
      modalidadForzada ||
      (ej.esCardio || ej.tipo === 'cardio' ? 'cardio' : ej.esPesoCorporal ? 'corporal' : 'peso');
    edicionModalidadActual = mod;
    const esCardio = mod === 'cardio';
    const intActual = ej.intensidadCardio || 'medio';
    const minActual = Math.max(
      1,
      Number(ej.series?.[0]?.tiempo_minutos) || Number(ej.duracionMinutos) || 15
    );

    abrirModalHTML(`
      <form onsubmit="AppFORGE.guardarEdicionEjercicio(event, ${ejIdx})" class="space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <div class="font-mono text-[9.5px] uppercase tracking-[0.2em] text-gold">EDITAR EJERCICIO</div>
            <h3 class="font-display text-lg uppercase tracking-wider text-ivory mt-0.5">Ajustar parámetros</h3>
          </div>
          <button type="button" onclick="AppFORGE.cerrarModal()"
            class="w-8 h-8 rounded-full border hairline text-sand flex items-center justify-center">
            <span class="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>

        <!-- Selector de modalidad -->
        <div>
          <label class="font-mono text-[10px] uppercase text-sand block mb-1.5">Modalidad</label>
          <div class="grid grid-cols-3 gap-1.5">
            ${[
              { id: 'peso', label: 'Con peso (kg)' },
              { id: 'corporal', label: 'Peso corporal' },
              { id: 'cardio', label: 'Cardio (tiempo)' }
            ]
              .map(
                (m) => `
              <button type="button" onclick="AppFORGE.cambiarModalidadEdicion(${ejIdx}, '${m.id}')"
                class="py-2 px-1.5 rounded-xl font-mono text-[9.5px] uppercase tracking-wider border transition ${
                  mod === m.id
                    ? m.id === 'cardio'
                      ? 'border-mint bg-mint/15 text-mint font-semibold'
                      : 'border-gold bg-gold/15 text-gold-hi font-semibold'
                    : 'hairline text-sand hover:text-ivory'
                }">
                ${m.label}
              </button>
            `
              )
              .join('')}
          </div>
        </div>

        <div>
          <label class="font-mono text-[10px] uppercase text-sand block mb-1">Nombre</label>
          <input id="edit-ej-nombre" type="text" required value="${ej.nombre.replace(/"/g, '&quot;')}"
            class="w-full px-3.5 py-2.5 rounded-xl bg-obsidian border hairline text-sm text-ivory focus:outline-none focus:border-gold" />
        </div>

        ${
          esCardio
            ? `
              <div>
                <label class="font-mono text-[10px] uppercase text-sand block mb-1">Intensidad de Cardio</label>
                <select id="edit-cardio-intensidad"
                  class="w-full px-3.5 py-2.5 rounded-xl bg-obsidian border hairline text-xs text-ivory focus:outline-none focus:border-gold">
                  <option value="intenso" ${intActual === 'intenso' ? 'selected' : ''}>Intenso (HIIT / Tabata)</option>
                  <option value="medio" ${intActual === 'medio' ? 'selected' : ''}>Medio (Aeróbico)</option>
                  <option value="bajo" ${intActual === 'bajo' ? 'selected' : ''}>Bajo (Sin impacto)</option>
                </select>
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="font-mono text-[10px] uppercase text-sand block mb-1">Duración (min)</label>
                  <input id="edit-cardio-min" type="number" min="1" max="180" value="${minActual}"
                    class="w-full px-3 py-2 rounded-xl bg-obsidian border hairline font-mono text-sm text-ivory text-center" />
                </div>
                <div>
                  <label class="font-mono text-[10px] uppercase text-sand block mb-1">Pausa (s)</label>
                  <input id="edit-ej-desc" type="number" min="15" max="300" step="15" value="${ej.descansoSegundos || 60}"
                    class="w-full px-3 py-2 rounded-xl bg-obsidian border hairline font-mono text-sm text-ivory text-center" />
                </div>
              </div>
            `
            : `
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="font-mono text-[10px] uppercase text-sand block mb-1">Músculo</label>
                  <input id="edit-ej-musculo" type="text" value="${(ej.grupoMuscular || '').replace(/"/g, '&quot;')}"
                    class="w-full px-3.5 py-2.5 rounded-xl bg-obsidian border hairline text-xs text-ivory focus:outline-none focus:border-gold" />
                </div>
                <div>
                  <label class="font-mono text-[10px] uppercase text-sand block mb-1">Tipo</label>
                  <select id="edit-ej-tipo"
                    class="w-full px-3 py-2.5 rounded-xl bg-obsidian border hairline text-xs text-ivory focus:outline-none focus:border-gold">
                    <option value="compuesto" ${ej.tipo === 'compuesto' ? 'selected' : ''}>Compuesto</option>
                    <option value="aislado" ${ej.tipo === 'aislado' ? 'selected' : ''}>Aislado</option>
                  </select>
                </div>
              </div>

              <div class="grid grid-cols-3 gap-2.5">
                <div>
                  <label class="font-mono text-[10px] uppercase text-sand block mb-1">Reps mín</label>
                  <input id="edit-ej-rmin" type="number" min="1" max="50" value="${ej.repsMin || 8}"
                    class="w-full px-3 py-2 rounded-xl bg-obsidian border hairline font-mono text-sm text-ivory text-center" />
                </div>
                <div>
                  <label class="font-mono text-[10px] uppercase text-sand block mb-1">Reps máx</label>
                  <input id="edit-ej-rmax" type="number" min="1" max="60" value="${ej.repsMax || 12}"
                    class="w-full px-3 py-2 rounded-xl bg-obsidian border hairline font-mono text-sm text-ivory text-center" />
                </div>
                <div>
                  <label class="font-mono text-[10px] uppercase text-sand block mb-1">Desc. (s)</label>
                  <input id="edit-ej-desc" type="number" min="15" max="300" step="15" value="${ej.descansoSegundos || 90}"
                    class="w-full px-3 py-2 rounded-xl bg-obsidian border hairline font-mono text-sm text-ivory text-center" />
                </div>
              </div>
            `
        }

        <div class="flex gap-2 pt-1">
          <button type="button" onclick="AppFORGE.abrirModalAgregarEjercicio(${ejIdx}, '${esCardio ? 'cardio' : 'todos'}')"
            class="px-4 py-3 rounded-full btn-ghost font-mono text-[10px] uppercase tracking-wider shrink-0">
            Cambiar (BD)
          </button>
          <button type="submit"
            class="flex-1 py-3 rounded-full btn-gold font-display text-xs font-bold tracking-[0.18em] uppercase">
            Guardar cambios
          </button>
        </div>
      </form>
    `);
  }

  function guardarEdicionEjercicio(ev, ejIdx) {
    ev.preventDefault();
    const sesion = obtenerSesionActual();
    const ej = sesion?.ejercicios?.[ejIdx];
    if (!ej) return;

    const mod = edicionModalidadActual || 'peso';
    const esCardio = mod === 'cardio';

    ej.nombre = (document.getElementById('edit-ej-nombre')?.value || ej.nombre).trim();
    ej.descansoSegundos = Number(document.getElementById('edit-ej-desc')?.value) || (esCardio ? 60 : 90);
    ej.manualUsuario = true;

    if (esCardio) {
      const intCardio = document.getElementById('edit-cardio-intensidad')?.value || 'medio';
      const durMin = Math.max(1, Number(document.getElementById('edit-cardio-min')?.value) || 15);
      const badge = obtenerBadgeCardio(intCardio);
      ej.esCardio = true;
      ej.tipo = 'cardio';
      ej.intensidadCardio = intCardio;
      ej.duracionMinutos = durMin;
      ej.esPesoCorporal = true;
      ej.grupoMuscular = `Cardio · ${badge.short}`;
      ej.prescripcion = {
        ...(ej.prescripcion || {}),
        esCardio: true,
        intensidadCardio: intCardio,
        tiempoSugerido: durMin,
        mensajeProgresion: `Meta hoy: ${durMin} min · Cardio ${badge.short}`
      };
      ej.series.forEach((s) => {
        s.peso = 0;
        s.reps = 0;
        s.tiempo_minutos = durMin;
        s.descanso_segundos = ej.descansoSegundos;
      });
    } else {
      ej.esCardio = false;
      ej.intensidadCardio = null;
      ej.duracionMinutos = 0;
      ej.grupoMuscular = (document.getElementById('edit-ej-musculo')?.value || ej.grupoMuscular).trim();
      ej.tipo = document.getElementById('edit-ej-tipo')?.value || 'compuesto';
      ej.repsMin = Number(document.getElementById('edit-ej-rmin')?.value) || 8;
      ej.repsMax = Math.max(ej.repsMin, Number(document.getElementById('edit-ej-rmax')?.value) || 12);
      ej.esPesoCorporal = mod === 'corporal';
      ej.series.forEach((s) => {
        s.descanso_segundos = ej.descansoSegundos;
        s.tiempo_minutos = 0;
        if (ej.esPesoCorporal) s.peso = 0;
        if (!Number(s.reps)) s.reps = ej.repsMin;
      });
    }

    sesion.modificadaPorUsuario = true;
    guardarUserPlan(state.userPlan);
    cerrarModal();
    renderizar();
    mostrarToastRecalibro('EJERCICIO EDITADO', `${ej.nombre} actualizado. Podés analizar tus ajustes.`);
  }

  function eliminarEjercicioDeSesion(ejIdx) {
    const sesion = obtenerSesionActual();
    if (!sesion || !sesion.ejercicios[ejIdx]) return;
    const eliminado = sesion.ejercicios[ejIdx].nombre;
    sesion.ejercicios.splice(ejIdx, 1);
    sesion.modificadaPorUsuario = true;
    guardarUserPlan(state.userPlan);
    cerrarModal();
    renderizar();
    mostrarToastRecalibro('EJERCICIO ELIMINADO', `Quitaste ${eliminado}. Tocá Analizar para revisar el balance.`);
  }

  /**
   * Analiza los ajustes biomecánicos sobre la rutina modificada por el usuario
   * (Auditoría instantánea + Opinión personalizada de Gemini IA)
   */
  async function analizarRutinaModificadaConCoach() {
    const sesion = obtenerSesionActual();
    if (!sesion) return;

    const audit = window.MotorEntrenamiento.analizarRutinaModificada(sesion, state.userProfile);

    const renderAuditModal = (comentarioIA = null, cargandoIA = false, fuentes = []) => {
      abrirModalHTML(`
        <div class="space-y-5">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="font-mono text-[10px] uppercase tracking-[0.2em] text-gold">AUDITORÍA DEL COACH</div>
              <h3 class="font-display text-xl font-bold text-ivory uppercase mt-0.5">${sesion.titulo || sesion.divisionMuscular}</h3>
            </div>
            <button type="button" onclick="AppFORGE.cerrarModal()"
              class="w-8 h-8 rounded-full border hairline text-sand hover:text-ivory flex items-center justify-center shrink-0">
              <span class="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>

          <!-- Puntuación y estado -->
          <div class="p-4 rounded-2xl card-forge-featured flex items-center justify-between">
            <div>
              <div class="font-mono text-[10px] uppercase tracking-[0.18em] ${
                audit.puntaje >= 85 ? 'text-mint' : 'text-gold'
              }">${audit.estado}</div>
              <div class="text-xs text-sand mt-1">${sesion.ejercicios.length} ejercicios${
                audit.totalSeries > 0 ? ` · ${audit.totalSeries} series` : ''
              }${audit.totalMinCardio > 0 ? ` · ${audit.totalMinCardio} min cardio` : ''}</div>
            </div>
            <div class="font-display text-3xl font-bold text-gold-metallic">${audit.puntaje}<span class="text-sm text-sand">/100</span></div>
          </div>

          <!-- Fortalezas -->
          ${
            audit.fortalezas.length
              ? `<div class="space-y-1.5">
                  <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-mint">Lo que está bien</div>
                  ${audit.fortalezas
                    .map(
                      (f) =>
                        `<div class="p-3 rounded-xl bg-mint/5 border border-mint/20 text-xs text-ivory/90">✓ ${f}</div>`
                    )
                    .join('')}
                </div>`
              : ''
          }

          <!-- Alertas detectadas -->
          ${
            audit.alertas.length
              ? `<div class="space-y-1.5">
                  <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-gold">Puntos a ajustar</div>
                  ${audit.alertas
                    .map(
                      (a) =>
                        `<div class="p-3 rounded-xl bg-gold/10 border border-gold/30 text-xs text-ivory/90">• ${a}</div>`
                    )
                    .join('')}
                </div>`
              : ''
          }

          <!-- Diagnóstico específico de FORGE IA -->
          <div class="p-4 rounded-2xl card-forge space-y-2">
            <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-gold">Análisis personalizado FORGE IA</div>
            ${
              cargandoIA
                ? `<div class="text-xs font-mono text-sand animate-pulse">Evaluando tu selección de ejercicios y progresión...</div>`
                : `<p class="text-xs text-ivory/90 leading-relaxed whitespace-pre-line">${
                    comentarioIA ||
                    (audit.ajustes.length
                      ? audit.ajustes.join('\n')
                      : 'Tu sesión quedó bien equilibrada. Registrá cada serie y usá el slider de sensación para que FORGE calibre tu próxima semana.')
                  }</p>`
            }
            ${
              fuentes?.length
                ? `<div class="pt-2 border-t hairline flex flex-wrap gap-1.5">
                    ${fuentes
                      .map(
                        (f) =>
                          `<a href="${f.url}" target="_blank" rel="noopener noreferrer" class="px-2.5 py-1 rounded-full bg-obsidian border hairline font-mono text-[9.5px] text-gold-soft">${f.titulo}</a>`
                      )
                      .join('')}
                  </div>`
                : ''
            }
          </div>

          <!-- Acción rápida de optimización biomecánica -->
          <div class="space-y-2">
            ${
              sesion.ejercicios.length >= 2
                ? `<button type="button" onclick="AppFORGE.optimizarOrdenYDescansos()"
                    class="w-full py-3.5 rounded-full btn-gold font-display text-xs font-bold tracking-[0.18em] uppercase">
                    Optimizar orden y descansos sin cambiar tus ejercicios
                  </button>`
                : ''
            }
            <button type="button" onclick="AppFORGE.cerrarModal()"
              class="w-full py-2.5 rounded-full btn-ghost font-mono text-[10px] uppercase tracking-wider">
              Seguir entrenando así
            </button>
          </div>
        </div>
      `);
    };

    // Mostrar auditoría local instantánea mientras consulta a la IA
    renderAuditModal(null, true, []);

    const listaResumen = sesion.ejercicios.map((e, i) => {
      if (e.esCardio || e.tipo === 'cardio') {
        const minTot = (e.series || []).reduce((acc, s) => acc + (Number(s.tiempo_minutos) || 0), 0);
        return {
          orden: i + 1,
          nombre: e.nombre,
          tipo: 'cardio',
          intensidadCardio: e.intensidadCardio || 'medio',
          bloques: e.series.length,
          minutosTotales: minTot
        };
      }
      return {
        orden: i + 1,
        nombre: e.nombre,
        musculo: e.grupoMuscular,
        tipo: e.tipo,
        series: e.series.length,
        reps: `${e.repsMin}-${e.repsMax}`,
        descansoSeg: e.descansoSegundos
      };
    });

    const prompt = `Sos FORGE, coach experto CSCS. El atleta modificó manualmente su sesión de "${
      sesion.divisionMuscular
    }". Analizá estos ejercicios exactos para su perfil y dale 2 o 3 ajustes concretos en español rioplatense (máximo 110 palabras):
Perfil: ${JSON.stringify(state.userProfile)}
Sesión modificada: ${JSON.stringify(listaResumen)}
Auditoría inicial: ${JSON.stringify({ puntaje: audit.puntaje, alertas: audit.alertas })}`;

    const resIA = await llamarGeminiTexto(prompt, { expectJson: false, usarBusquedaWeb: true });
    renderAuditModal(resIA?.text || null, false, resIA?.fuentes || []);
  }

  function optimizarOrdenYDescansos() {
    const sesion = obtenerSesionActual();
    if (!sesion || sesion.ejercicios.length < 2) return;

    // Compuestos primero, aislados después y cardio al final
    const cardio = sesion.ejercicios.filter((e) => e.esCardio || e.tipo === 'cardio');
    const compuestos = sesion.ejercicios.filter((e) => !(e.esCardio || e.tipo === 'cardio') && e.tipo === 'compuesto');
    const aislados = sesion.ejercicios.filter((e) => !(e.esCardio || e.tipo === 'cardio') && e.tipo !== 'compuesto');
    sesion.ejercicios = [...compuestos, ...aislados, ...cardio].map((e, idx) => {
      const esCardio = Boolean(e.esCardio || e.tipo === 'cardio');
      const descOptimo = esCardio
        ? e.intensidadCardio === 'intenso'
          ? 90
          : 60
        : e.tipo === 'compuesto'
        ? 120
        : 75;
      e.orden = idx + 1;
      e.descansoSegundos = descOptimo;
      e.series.forEach((s) => (s.descanso_segundos = descOptimo));
      return e;
    });

    sesion.modificadaPorUsuario = false;
    guardarUserPlan(state.userPlan);
    cerrarModal();
    renderizar();
    mostrarToastRecalibro(
      'SESIÓN OPTIMIZADA',
      cardio.length > 0
        ? 'Fuerza compuesta primero, aislados después y cardio al final para rendir al máximo.'
        : 'Ordenamos compuestos primero y ajustamos descansos según demanda neuromuscular.'
    );
  }

  function abrirModalBiometria() {
    const ultima = state.metricasCorporales[state.metricasCorporales.length - 1] || {
      pesoCorporalKg: 78.4,
      porcentajeGrasa: 13.8
    };
    abrirModalHTML(`
      <div class="space-y-5">
        <div class="flex items-center justify-between">
          <h3 class="font-display text-lg uppercase tracking-wider text-gold">Peso Corporal</h3>
          <button type="button" onclick="AppFORGE.cerrarModal()"
            class="w-8 h-8 rounded-full border hairline text-sand flex items-center justify-center">
            <span class="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="font-mono text-[10px] uppercase text-sand block mb-1.5">Peso (kg)</label>
            <input id="modal-peso" type="number" step="0.1" value="${ultima.pesoCorporalKg}"
              class="w-full px-4 py-3 rounded-xl bg-obsidian border hairline font-mono text-lg text-ivory focus:outline-none focus:border-gold" />
          </div>
          <div>
            <label class="font-mono text-[10px] uppercase text-sand block mb-1.5">% Grasa (opc.)</label>
            <input id="modal-grasa" type="number" step="0.1" value="${ultima.porcentajeGrasa || ''}"
              class="w-full px-4 py-3 rounded-xl bg-obsidian border hairline font-mono text-lg text-ivory focus:outline-none focus:border-gold" />
          </div>
        </div>
        <button type="button" onclick="AppFORGE.guardarBiometriaModal()"
          class="w-full py-3.5 rounded-full btn-gold font-display text-xs font-bold tracking-[0.2em] uppercase">
          Guardar
        </button>
      </div>
    `);
  }

  /**
   * =========================================================================
   * 5. ACCIONES INTERACTIVAS & RECALIBRACIÓN EN VIVO
   * =========================================================================
   */
  function irPasoOnboarding(paso) {
    state.pasoOnboarding = Math.min(state.totalPasosOnboarding, Math.max(1, paso));
    renderizar();
  }

  function elegirOnboarding(campo, valor, avanzar = false) {
    draftOnboarding[campo] = valor;
    if (avanzar && state.pasoOnboarding < state.totalPasosOnboarding) {
      state.pasoOnboarding++;
    }
    renderizar();
  }

  function elegirDiasOnboarding(dias) {
    draftOnboarding.dias = Number(dias);
    if (dias === 3) draftOnboarding.divisionMuscular = 'Full Body';
    else if (dias === 4) draftOnboarding.divisionMuscular = 'Torso/Pierna';
    else draftOnboarding.divisionMuscular = 'PPL';
    renderizar();
  }

  function actualizarNotaOnboarding(val) {
    draftOnboarding.notasIA = val;
  }

  async function finalizarOnboarding() {
    const perfilNuevo = {
      ...draftOnboarding,
      pasoDisco: state.pasoDisco,
      onboardingCompletado: true,
      fechaActualizacion: new Date().toISOString().slice(0, 10)
    };
    guardarProfile(perfilNuevo);
    await construirPlanCompleto(true);
    state.vista = 'entrenar';
    renderizar();
    window.scrollTo({ top: 0 });
  }

  async function regenerarPlanIA() {
    await construirPlanCompleto(true);
    renderizar();
  }

  function seleccionarDiaPlan(idx) {
    if (!state.userPlan?.sesiones?.[idx]) return;
    state.sesionIdx = idx;
    renderizar();
  }

  function abrirDiaEnEntrenar(idx) {
    state.sesionIdx = idx;
    state.vista = 'entrenar';
    renderizar();
    window.scrollTo({ top: 0 });
  }

  function ajustarSerie(ejIdx, sIdx, campo, delta) {
    const ser = obtenerSesionActual()?.ejercicios?.[ejIdx]?.series?.[sIdx];
    if (!ser) return;
    const minVal = campo === 'tiempo_minutos' ? 1 : 0;
    const nuevo = Math.max(minVal, +(Number(ser[campo] || 0) + delta).toFixed(2));
    ser[campo] = campo === 'reps' || campo === 'tiempo_minutos' ? Math.round(nuevo) : nuevo;
    guardarUserPlan(state.userPlan);
    renderizar();
  }

  function editarSerie(ejIdx, sIdx, campo, val) {
    const ser = obtenerSesionActual()?.ejercicios?.[ejIdx]?.series?.[sIdx];
    if (!ser) return;
    const minVal = campo === 'tiempo_minutos' ? 1 : 0;
    ser[campo] = Math.max(minVal, Number(val) || minVal);
    guardarUserPlan(state.userPlan);
  }

  function alternarCheckSerie(ejIdx, sIdx) {
    const ej = obtenerSesionActual()?.ejercicios?.[ejIdx];
    const ser = ej?.series?.[sIdx];
    if (!ej || !ser) return;

    const esCardio = Boolean(ej.esCardio || ej.tipo === 'cardio');
    ser.completada = !ser.completada;
    if (ser.completada) {
      sonarAlerta('ok');
      const pendientes = ej.series.slice(sIdx + 1).filter((p) => !p.completada);
      if (esCardio) {
        pendientes.forEach((p) => {
          p.tiempo_minutos = ser.tiempo_minutos;
        });
        if (pendientes.length > 0) {
          iniciarDescanso(ser.descanso_segundos || ej.descansoSegundos || 60, 'Pausa entre bloques');
        }
      } else {
        iniciarDescanso(ser.descanso_segundos || ej.descansoSegundos || 90, 'Descanso');
        pendientes.forEach((p) => {
          p.peso = ser.peso;
          p.reps = ser.reps;
        });
      }
    }
    guardarUserPlan(state.userPlan);
    renderizar();
  }

  function agregarSerie(ejIdx) {
    const ej = obtenerSesionActual()?.ejercicios?.[ejIdx];
    if (!ej) return;
    const esCardio = Boolean(ej.esCardio || ej.tipo === 'cardio');
    const ult = ej.series[ej.series.length - 1] || {
      peso: esCardio ? 0 : ej.prescripcion.pesoSugerido,
      reps: esCardio ? 0 : ej.prescripcion.repsSugeridas,
      tiempo_minutos: esCardio ? ej.prescripcion.tiempoSugerido || ej.duracionMinutos || 15 : 0,
      descanso_segundos: ej.descansoSegundos || (esCardio ? 60 : 90),
      rir: 2
    };
    ej.series.push({
      numeroSerie: ej.series.length + 1,
      peso: esCardio ? 0 : ult.peso,
      reps: esCardio ? 0 : ult.reps,
      tiempo_minutos: esCardio ? Math.max(1, Number(ult.tiempo_minutos) || 15) : 0,
      descanso_segundos: ult.descanso_segundos,
      rir: ult.rir,
      completada: false
    });
    guardarUserPlan(state.userPlan);
    renderizar();
  }

  /**
   * Interacción central de TITUS: Slider "¿CÓMO SE SINTIÓ?" (SOBRÓ · CÓMODO · JUSTO · ME COSTÓ · AL FALLO)
   * Recalibra en vivo las series pendientes y deja listo el ajuste para la próxima sesión.
   */
  function seleccionarSensacion(ejIdx, sensIdx) {
    const ej = obtenerSesionActual()?.ejercicios?.[ejIdx];
    if (!ej) return;

    const sens = SENSACIONES[sensIdx] || SENSACIONES[2];
    ej.sensacionIdx = sens.idx;
    ej.series.forEach((s) => {
      s.rir = sens.rir;
    });

    const ref = ej.series.find((s) => s.completada) || ej.series[0];
    const pendientes = ej.series.filter((s) => !s.completada);
    const esCardio = Boolean(ej.esCardio || ej.tipo === 'cardio');
    const esPesoCorp = Boolean(ej.esPesoCorporal) || Number(ref?.peso || 0) === 0;

    let aviso = '';
    if (esCardio) {
      const baseMin = Math.max(1, Number(ref?.tiempo_minutos) || Number(ej.duracionMinutos) || 15);
      if (sens.rir >= 3) {
        const saltoMin = ej.intensidadCardio === 'intenso' ? (sens.rir === 4 ? 2 : 1) : sens.rir === 4 ? 3 : 2;
        const nuevoTiempo = baseMin + saltoMin;
        pendientes.forEach((p) => (p.tiempo_minutos = nuevoTiempo));
        aviso = `${ej.nombre}: ajustado a ${nuevoTiempo} min (${sens.label.toLowerCase()}).`;
      } else if (sens.rir === 0) {
        aviso = `${ej.nombre}: consolidamos ${baseMin} min y regulamos el ritmo para recuperar bien.`;
      } else {
        aviso = `${ej.nombre}: ${sens.desc}. Duración en zona cardiovascular óptima.`;
      }
    } else if (sens.rir >= 3) {
      // SOBRÓ o CÓMODO -> subir exigencia
      const saltoReps = sens.rir === 4 ? 2 : 1;
      if (!esPesoCorp) {
        const nuevoPeso = +(Number(ref.peso) + state.pasoDisco).toFixed(1);
        pendientes.forEach((p) => (p.peso = nuevoPeso));
        aviso = `${ej.nombre}: subido a ${nuevoPeso} kg (${sens.label.toLowerCase()}).`;
      } else {
        const nuevasReps = Number(ref.reps) + saltoReps;
        pendientes.forEach((p) => (p.reps = nuevasReps));
        aviso = `${ej.nombre}: subido a ${nuevasReps} reps (${sens.label.toLowerCase()}).`;
      }
    } else if (sens.rir === 0) {
      // AL FALLO -> proteger técnica y añadir descanso
      aviso = `${ej.nombre}: consolidamos carga y +30s de descanso para tu recuperación.`;
      if (state.descanso.activo) sumarDescanso(30);
    } else {
      aviso = `${ej.nombre}: ${sens.desc}. Volumen dentro del rango óptimo.`;
    }

    guardarUserPlan(state.userPlan);
    renderizar();
    mostrarToastRecalibro('FORGE RECALIBRÓ', aviso);
  }

  async function guardarEntrenamiento() {
    const sesion = obtenerSesionActual();
    if (!sesion) return;

    const hoy = new Date();
    const yyyy = hoy.getFullYear();
    const mm = String(hoy.getMonth() + 1).padStart(2, '0');
    const dd = String(hoy.getDate()).padStart(2, '0');
    const divNombre = sesion.divisionMuscular;

    const nuevo = {
      id: `${dd}-${mm}-${yyyy}`,
      fecha: `${yyyy}-${mm}-${dd}`,
      divisionMuscular: divNombre,
      ejercicios: sesion.ejercicios.map((ej) => {
        const esCardio = Boolean(ej.esCardio || ej.tipo === 'cardio');
        const hechas = ej.series.filter((s) => s.completada);
        const lista = hechas.length ? hechas : ej.series;
        return {
          nombre: ej.nombre,
          esCardio,
          intensidadCardio: esCardio ? ej.intensidadCardio || 'medio' : null,
          series: lista.map((s) => ({
            peso: esCardio ? 0 : Number(s.peso) || 0,
            reps: esCardio ? 0 : Number(s.reps) || 0,
            tiempo_minutos: esCardio ? Math.max(1, Number(s.tiempo_minutos) || Number(ej.duracionMinutos) || 15) : 0,
            descanso_segundos: Number(s.descanso_segundos) || ej.descansoSegundos || 90,
            rir: Number(s.rir ?? 2)
          }))
        };
      })
    };

    guardarEntrenamientos([...state.entrenamientos, nuevo]);
    saltarDescanso();
    await rehidratarPlanGuardado();

    const sesionActualizada = obtenerSesionActual();
    const ajustesHTML = (sesionActualizada?.ejercicios || [])
      .map(
        (ej) => `
      <div class="p-3.5 rounded-xl bg-obsidian border hairline space-y-1">
        <div class="font-editorial italic text-base text-ivory">${ej.nombre}</div>
        <div class="font-mono text-[11px] text-mint">${ej.prescripcion.mensajeProgresion}</div>
      </div>
    `
      )
      .join('');

    renderizar();

    abrirModalHTML(`
      <div class="space-y-5">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-mint">
              <span class="w-1.5 h-1.5 rounded-full bg-mint"></span>
              FORGE RECALIBRÓ TU PLAN
            </div>
            <h3 class="font-display text-xl font-bold text-ivory uppercase mt-1">Sesión guardada</h3>
            <p class="font-editorial italic text-sm text-sand mt-0.5">
              Leí tus series de ${divNombre} y ya ajusté tus metas para la próxima semana:
            </p>
          </div>
          <button type="button" onclick="AppFORGE.cerrarModal()"
            class="w-8 h-8 rounded-full border hairline text-sand flex items-center justify-center shrink-0">
            <span class="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>

        <div class="space-y-2.5 max-h-[45dvh] overflow-y-auto">
          ${ajustesHTML}
        </div>

        <button type="button" onclick="AppFORGE.cerrarModal(); AppFORGE.irATab('progreso');"
          class="w-full py-3.5 rounded-full btn-gold font-display text-xs font-bold tracking-[0.2em] uppercase">
          Ver mi progreso
        </button>
      </div>
    `);
  }

  /**
   * =========================================================================
   * 6. COACH IA — CONSULTA LIBRE
   * =========================================================================
   */
  function submitConsultaCoach(ev) {
    ev.preventDefault();
    const input = document.getElementById('coach-input');
    const txt = (input?.value || '').trim();
    if (!txt) return;
    input.value = '';
    enviarConsultaCoach(txt);
  }

  async function enviarConsultaCoach(pregunta) {
    const nuevos = [...state.chatMensajes, { rol: 'user', texto: pregunta }];
    guardarChat(nuevos);
    state.chatEnviando = true;
    renderizar();

    const contextoRAG = await window.MotorEntrenamiento.construirContextoRAGParaIA(
      state.userProfile || draftOnboarding
    );
    const planResumido = (state.userPlan?.sesiones || []).map((s) => ({
      dia: s.titulo,
      ejercicios: s.ejercicios.map((e) => e.nombre)
    }));

    const prompt = `Sos FORGE, entrenador personal basado en ciencia deportiva (NSCA, Schoenfeld, Israetel, Steven Low).
Respondé en español rioplatense, de forma clara, directa y estructurada (máximo 160 palabras).
Usá búsqueda web en fuentes científicas confiables si la consulta pregunta sobre técnica, lesiones, evidencia o progresión específica.
Perfil del atleta: ${JSON.stringify(state.userProfile)}
Base biomecánica recomendada para su nivel: ${JSON.stringify(contextoRAG.criterioNivel)}
Plan actual: ${JSON.stringify(planResumido)}
Últimas sesiones registradas: ${JSON.stringify(state.entrenamientos.slice(-3))}
Consulta del atleta: "${pregunta}"`;

    let respuesta = null;
    let fuentes = [];

    const resDirecta = await llamarGeminiTexto(prompt, { expectJson: false, usarBusquedaWeb: true });
    if (resDirecta?.text) {
      respuesta = resDirecta.text;
      fuentes = resDirecta.fuentes || [];
    } else {
      // Intentar endpoint serverless en Vercel
      try {
        const resp = await fetch('/api/generate-routine', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'coach',
            userProfile: state.userProfile,
            planActual: planResumido,
            historialReciente: state.entrenamientos.slice(-3),
            pregunta,
            apiKeyClient: localStorage.getItem(STORAGE_KEYS.GEMINI_KEY) || DEFAULT_API_KEY
          })
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data?.respuesta) {
            respuesta = data.respuesta;
            fuentes = data.fuentes || [];
          }
        }
      } catch (e) {}
    }

    if (!respuesta) {
      const nivel = state.userProfile?.nivel || 'intermedio';
      const eq = state.userProfile?.equipamiento || 'peso_corporal';
      const crit = contextoRAG.criterioNivel?.explicacion || '';
      if (pregunta.toLowerCase().includes('sin pesa') || eq === 'peso_corporal') {
        respuesta = `Para tu nivel (${nivel}) entrenando en casa sin equipo:\n\n1. Progresión por ejercicio: no se trata solo de hacer más reps, sino de pasar al siguiente ejercicio del árbol biomecánico (ej: Flexiones Inclinadas → en Suelo → Declinadas → Arquero).\n2. Control técnico: bajá en 3 segundos con pausa de 1s abajo.\n3. Cuando en el slider marcás SOBRÓ, FORGE te prepara para saltar al siguiente escalón.`;
      } else if (pregunta.toLowerCase().includes('hombro') || pregunta.toLowerCase().includes('dolor') || pregunta.toLowerCase().includes('rodilla')) {
        respuesta = `Ante molestia articular, nunca entrenes con dolor agudo:\n\n1. Tocá "Ver técnica" en ese ejercicio para ver la variante "Más accesible".\n2. Si anotás la molestia (hombro, rodilla, muñeca o lumbar) en Plan → Cambiar plan (Paso V), FORGE filtra automáticamente tu base biomecánica y sustituye los ejercicios riesgosos.`;
      } else {
        respuesta = `Criterio FORGE para tu nivel (${nivel}):\n\n${crit}\n\n• Registrá cada serie y mové el slider "¿Cómo se sintió?" al terminar el ejercicio para que el plan se ajuste automáticamente.`;
      }
    }

    state.chatEnviando = false;
    guardarChat([...state.chatMensajes, { rol: 'coach', texto: respuesta.trim(), fuentes }]);
    renderizar();
  }

  function limpiarChatCoach() {
    guardarChat([]);
    renderizar();
  }

  /**
   * =========================================================================
   * 7. PROGRESO & AJUSTES
   * =========================================================================
   */
  function cambiarSubTabProgreso(sub) {
    state.subTabProgreso = sub;
    renderizar();
  }

  function cambiarEjercicioGrafico(nombre) {
    state.ejercicioGrafico = nombre;
    renderizar();
  }

  function guardarBiometriaModal() {
    const peso = Number(document.getElementById('modal-peso')?.value);
    const grasa = Number(document.getElementById('modal-grasa')?.value) || 0;
    if (!peso || peso < 25) return;
    guardarMetricas([
      ...state.metricasCorporales,
      { fecha: new Date().toISOString().slice(0, 10), pesoCorporalKg: peso, porcentajeGrasa: grasa }
    ]);
    cerrarModal();
    renderizar();
    mostrarToastRecalibro('BIOMETRÍA ACTUALIZADA', `Peso registrado: ${peso} kg.`);
  }

  async function eliminarSesion(idx) {
    const copia = [...state.entrenamientos];
    copia.splice(idx, 1);
    guardarEntrenamientos(copia);
    await rehidratarPlanGuardado();
    renderizar();
  }

  function cambiarPasoDisco(val) {
    state.pasoDisco = val;
    if (state.userProfile) {
      state.userProfile.pasoDisco = val;
      guardarProfile(state.userProfile);
    }
    renderizar();
  }

  async function alternarDeload() {
    state.modoDeload = !state.modoDeload;
    await rehidratarPlanGuardado();
    renderizar();
    mostrarToastRecalibro(
      state.modoDeload ? 'DELOAD ACTIVADO' : 'PLAN NORMAL',
      state.modoDeload ? 'Volumen e intensidad reducidos para recuperar.' : 'Sobrecarga progresiva activa.'
    );
  }

  function exportarJSON() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            userProfile: state.userProfile,
            userPlan: state.userPlan,
            entrenamientos: state.entrenamientos,
            metricasCorporales: state.metricasCorporales
          },
          null,
          2
        )
      ],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `forge-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    mostrarToastRecalibro('RESPALDO LISTO', 'Se descargó tu archivo .json.');
  }

  async function restaurarDemo() {
    cargarSemillaDemo();
    await construirPlanCompleto(false);
    state.vista = 'entrenar';
    renderizar();
    mostrarToastRecalibro('DEMO CARGADA', 'Press Banca 85 kg × 6 listo para probar.');
  }

  async function vaciarHistorial() {
    guardarEntrenamientos([]);
    await rehidratarPlanGuardado();
    renderizar();
    mostrarToastRecalibro('HISTORIAL REINICIADO', 'Tus sesiones previas fueron borradas.');
  }

  function guardarApiKey() {
    const val = (document.getElementById('perfil-api-key')?.value || '').trim();
    if (val) {
      localStorage.setItem(STORAGE_KEYS.GEMINI_KEY, val);
      mostrarToastRecalibro('API KEY GUARDADA', 'Lista para conectar con FORGE IA.');
    }
  }

  function mostrarToastRecalibro(titulo, detalle) {
    const box = document.getElementById('toast-container');
    if (!box) return;
    box.innerHTML = '';
    const el = document.createElement('div');
    el.className =
      'w-full px-4 py-3 rounded-2xl bg-obsidian3/95 border border-gold/40 shadow-2xl backdrop-blur-xl transition-all duration-300';
    el.innerHTML = `
      <div class="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-mint">
        <span class="w-1.5 h-1.5 rounded-full bg-mint"></span>
        <span>${titulo}</span>
      </div>
      <div class="text-xs text-ivory/90 mt-1 leading-snug">${detalle}</div>
    `;
    box.appendChild(el);
    setTimeout(() => {
      el.classList.add('opacity-0', '-translate-y-2');
      setTimeout(() => el.remove(), 260);
    }, 3400);
  }

  async function init() {
    if (!localStorage.getItem(STORAGE_KEYS.GEMINI_KEY)) {
      localStorage.setItem(STORAGE_KEYS.GEMINI_KEY, DEFAULT_API_KEY);
    }

    cargarLocalStorage();

    if (!state.userProfile) {
      state.vista = 'onboarding';
      state.pasoOnboarding = 1;
      renderizar();
      return;
    }

    draftOnboarding = { ...draftOnboarding, ...state.userProfile };

    if (
      !state.userPlan ||
      state.userPlan.equipamiento !== state.userProfile.equipamiento ||
      state.userPlan.nivel !== state.userProfile.nivel
    ) {
      await construirPlanCompleto(false);
    } else {
      await rehidratarPlanGuardado();
    }

    state.vista = 'entrenar';
    renderizar();
  }

  return {
    init,
    irATab,
    abrirOnboarding,
    irPasoOnboarding,
    elegirOnboarding,
    elegirDiasOnboarding,
    actualizarNotaOnboarding,
    finalizarOnboarding,
    regenerarPlanIA,
    seleccionarDiaPlan,
    abrirDiaEnEntrenar,
    ajustarSerie,
    editarSerie,
    alternarCheckSerie,
    agregarSerie,
    seleccionarSensacion,
    iniciarDescanso,
    sumarDescanso,
    saltarDescanso,
    guardarEntrenamiento,
    submitConsultaCoach,
    enviarConsultaCoach,
    limpiarChatCoach,
    cambiarSubTabProgreso,
    cambiarEjercicioGrafico,
    abrirModalEjercicio,
    abrirModalAgregarEjercicio,
    cambiarModoBuscador,
    cambiarFiltroBuscador,
    cambiarCategoriaBuscador,
    cambiarIntensidadBuscador,
    cambiarModalidadPropio,
    cambiarModalidadEdicion,
    actualizarQueryBuscador,
    seleccionarEjercicioDeBD,
    guardarEjercicioPropio,
    abrirModalEditarEjercicio,
    guardarEdicionEjercicio,
    eliminarEjercicioDeSesion,
    analizarRutinaModificadaConCoach,
    optimizarOrdenYDescansos,
    abrirModalBiometria,
    guardarBiometriaModal,
    cerrarModal,
    eliminarSesion,
    cambiarPasoDisco,
    alternarDeload,
    exportarJSON,
    restaurarDemo,
    vaciarHistorial,
    guardarApiKey
  };
})();

window.AppFORGE = AppFORGE;
document.addEventListener('DOMContentLoaded', () => AppFORGE.init());
