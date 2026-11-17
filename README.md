# FORGE — Lee cada serie que registrás y ajusta tu plan

Aplicación web de entrenamiento personal inteligente con arquitectura **Offline-First en `localStorage`**, **Base de Datos Biomecánica Propia (60 ejercicios por nivel y equipamiento)**, **Coach IA con búsqueda web (Gemini 2.5 Flash)** y lista para desplegar en **Vercel**.

---

## Características Principales

- **Onboarding en 5 pasos**: Recopila objetivo, equipamiento real (*en casa sin herramientas, mancuernas, parque/barra, gimnasio*), días/semana, división muscular, nivel y posibles molestias articulares.
- **Selección real de ejercicios por nivel**: Principiante, Intermedio y Avanzado reciben ejercicios biomecánicamente distintos (no solo cambio de repeticiones), con protección automática ante molestias reportadas (hombro, rodilla, muñeca, lumbar).
- **Consola `Entrenar`**: Registro serie a serie con números romanos, temporizador de descanso flotante, slider **`¿CÓMO SE SINTIÓ?`** (`SOBRÓ · CÓMODO · JUSTO · ME COSTÓ · AL FALLO`) que recalibra tus series y tu próxima sesión en vivo.
- **Editor de rutina + Buscador en Base de Datos + Auditoría**: Editá, reemplazá, eliminá o creá tus propios ejercicios y ejecutá **`Analizar ajustes`** para recibir un puntaje biomecánico y recomendaciones del Coach.
- **Coach (`Consulta Libre`)**: Chat personalizado conectado a tu perfil, plan e historial, con soporte de Google Search Grounding en Gemini.
- **Progreso & Persistencia**: Curva de evolución (1RM Epley / repeticiones), historial completo en `localStorage`, registro de peso corporal y exportación `.json`.

---

## Despliegue en Vercel

1. Importá este repositorio en [Vercel](https://vercel.com).
2. *(Opcional para IA en la nube)*: Agregá la variable de entorno `GEMINI_API_KEY` en `Settings → Environment Variables`.
3. También podés cargar tu API Key localmente desde **`Progreso → Ajustes → Avanzado`** (se guarda únicamente en tu navegador).
