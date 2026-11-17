/**
 * Vercel Serverless Function: /api/generate-routine
 * Coach Personal IA de FORGE — Conectado con Base de Datos Biomecánica Propia (RAG) y Google Search Grounding
 * Soporta dos modos:
 *  - mode: "plan" (por defecto) -> Prescribe el plan semanal eligiendo EJERCICIOS reales por nivel, equipo y lesiones.
 *  - mode: "coach" -> Consulta libre con búsqueda web en tiempo real (google_search) + historial del usuario.
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Usa POST.' });
  }

  try {
    const {
      mode = 'plan',
      userProfile,
      historialReciente,
      contextoRAG,
      pregunta,
      planActual,
      apiKeyClient
    } = req.body || {};

    const apiKey = process.env.GEMINI_API_KEY || apiKeyClient || '';

    if (!apiKey) {
      return res.status(400).json({ error: 'Falta GEMINI_API_KEY', fallbackRecommended: true });
    }

    const endpoints = apiKey.startsWith('AQ.')
      ? [
          `https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`
        ]
      : [
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`
        ];

    // MODO COACH: Consulta libre con búsqueda en internet (Google Search Grounding)
    if (mode === 'coach') {
      const coachPrompt = `Sos FORGE, entrenador personal experto basado en ciencia deportiva (NSCA, Schoenfeld, Israetel, Steven Low).
Respondé en español rioplatense claro, directo y fundamentado. Usá búsqueda web si necesitás validar evidencia biomecánica, lesiones o progresiones específicas.

PERFIL DEL ATLETA: ${JSON.stringify(userProfile || {})}
PLAN ACTUAL: ${JSON.stringify(planActual || [])}
ÚLTIMAS SESIONES: ${JSON.stringify((historialReciente || []).slice(-3))}

CONSULTA: "${pregunta || ''}"`;

      const payloadWithSearch = {
        contents: [{ role: 'user', parts: [{ text: coachPrompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.5 }
      };

      const payloadFallback = {
        contents: [{ role: 'user', parts: [{ text: coachPrompt }] }],
        generationConfig: { temperature: 0.5 }
      };

      for (const url of endpoints) {
        for (const payload of [payloadWithSearch, payloadFallback]) {
          const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (resp.ok) {
            const data = await resp.json();
            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const chunks = data?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
            const fuentes = chunks
              .filter((c) => c?.web?.uri)
              .slice(0, 3)
              .map((c) => ({ titulo: c.web.title || 'Fuente científica', url: c.web.uri }));
            if (text) {
              return res.status(200).json({ source: 'forge-coach-web', respuesta: text, fuentes });
            }
          }
        }
      }

      return res.status(502).json({ error: 'No se pudo consultar al Coach IA', fallbackRecommended: true });
    }

    // MODO PLAN: Selección de ejercicios biomecánicos por NIVEL REAL + EQUIPAMIENTO + BASE DE DATOS PROPIA
    const eq = userProfile?.equipamiento || 'gimnasio';
    const nivel = userProfile?.nivel || 'intermedio';

    const reglasEquipamiento = {
      peso_corporal:
        'EQUIPAMIENTO = EN CASA SIN HERRAMIENTAS: Solo suelo, pared, toalla o silla/cama. PROHIBIDO incluir barras, paralelas, fondos en barra, anillas, aros, mancuernas, discos, poleas o máquinas. pesoSugerido = 0.',
      calistenia_barra:
        'EQUIPAMIENTO = PARQUE / BARRA Y PARALELAS: Solo barra de dominadas, paralelas y peso corporal.',
      mancuernas:
        'EQUIPAMIENTO = EN CASA CON MANCUERNAS: Solo mancuernas y banco/suelo. Sin máquinas ni poleas.',
      gimnasio: 'EQUIPAMIENTO = GIMNASIO COMPLETO: Barras, mancuernas, máquinas y poleas.'
    };

    const reglasNivel = {
      principiante:
        'NIVEL PRINCIPIANTE (CRÍTICO): NO bajes solo las repeticiones de ejercicios avanzados. CAMBIÁ LOS EJERCICIOS por variantes de fundamentos y alta estabilidad (ej: en casa -> Flexiones inclinadas en mesa, Flexiones en rodillas, Sentadilla a silla, Puente de glúteo bilateral, Retracciones escapulares; en gym -> Máquinas guiadas, Prensa, Jalón al pecho, Sentadilla Goblet).',
      intermedio:
        'NIVEL INTERMEDIO: Seleccioná patrones completos y clásicos (ej: en casa -> Flexiones clásicas en suelo, Flexiones en pica, Sentadilla profunda tempo 3-1-1, Sentadilla Búlgara, Puente unilateral; en gym -> Press banca, Remo barra, Sentadilla barra, RDL).',
      avanzado:
        'NIVEL AVANZADO: Seleccioná variantes de alta exigencia mecánica y unilateral (ej: en casa -> Flexiones arquero, Pseudo-Planche, Pike elevadas, Sentadilla Pistol/Shrimp asistida, Remo unilateral; en gym -> Compuestos pesados con pausa, Dominadas lastradas, Remo Pendlay).'
    };

    const systemPrompt = `Sos FORGE, entrenador personal CSCS basado en evidencia científica (NSCA, Schoenfeld, Israetel, Steven Low).
Tu trabajo es analizar el caso específico de este atleta y elegir los EJERCICIOS CORRECTOS para su nivel, equipamiento y posibles molestias, apoyándote en la BASE DE DATOS PROPIA provista.

${reglasEquipamiento[eq] || reglasEquipamiento.gimnasio}
${reglasNivel[nivel] || reglasNivel.intermedio}

SI EL USUARIO REPORTA MOLESTIAS EN "notasIA" (hombro, rodilla, muñeca, lumbar), EXCLUÍ automáticamente movimientos que irriten esa articulación y explicá la adaptación en "mensajeCoach".

Devolvé ÚNICAMENTE JSON puro con esta estructura:
{
  "mensajeCoach": "Explicación clara de 1-2 líneas de por qué elegiste ESTOS ejercicios para su nivel y situación específica",
  "sesiones": [
    {
      "id": "dia_1",
      "divisionMuscular": "Empuje",
      "titulo": "Empuje",
      "enfoque": "Enfoque técnico breve",
      "ejercicios": [
        {
          "nombre": "Nombre exacto del ejercicio",
          "grupoMuscular": "Músculo principal",
          "tipo": "compuesto",
          "seriesObjetivo": 3,
          "repsMin": 8,
          "repsMax": 12,
          "pesoSugerido": 0,
          "repsSugeridas": 10,
          "descansoSegundos": 90,
          "rirObjetivo": 2,
          "regresion": "Variante más fácil si cuesta",
          "progresion": "Siguiente ejercicio cuando lo domine",
          "notaTecnica": "Clave técnica clara en 1 frase",
          "porQueEsteEjercicio": "Por qué este ejercicio específico encaja con su nivel y objetivo"
        }
      ]
    }
  ]
}`;

    const userPrompt = JSON.stringify({
      userProfile,
      baseDeDatosPropiaFiltrada: contextoRAG || {},
      ultimosEntrenamientos: (historialReciente || []).slice(-3)
    });

    const payload = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: 'application/json'
      }
    };

    for (const url of endpoints) {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (resp.ok) {
        const data = await resp.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        const planJson = JSON.parse(rawText);
        if (Array.isArray(planJson.sesiones) && planJson.sesiones.length > 0) {
          return res.status(200).json({ source: 'forge-gemini-rag', plan: planJson });
        }
      }
    }

    return res.status(502).json({ error: 'Fallback a Base Biomecánica Propia', fallbackRecommended: true });
  } catch (error) {
    return res.status(500).json({ error: error.message, fallbackRecommended: true });
  }
}
