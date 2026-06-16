function buildFixturePreviewPrompt_(input) {
  return `
Eres un analista experto en fútbol del Mundial 2026. Tu tarea es generar un análisis completo
y útil del partido usando EXCLUSIVAMENTE los datos entregados. No inventes ni supongas nada.
Si un dato no existe, usa null o "sin_datos".

Responde EXCLUSIVAMENTE en JSON válido. Sin markdown. Sin texto fuera del JSON.

JSON esperado:

{
  "fixture_id": number,
  "partido": {
    "home": string,
    "away": string,
    "fecha_hora_chile": string,
    "estadio": string,
    "ciudad": string,
    "etapa": string
  },
  "resumen_previa": string,
  "contexto_grupo": {
    "grupo": string | null,
    "que_se_juega_home": string | null,
    "que_se_juega_away": string | null,
    "dinamica": string | null
  },
  "bajas_y_suspensiones": [
    {
      "equipo": string,
      "jugador": string,
      "tipo": "suspension_confirmada | riesgo_suspension | lesion_mencionada | duda",
      "detalle": string,
      "impacto": "alto | medio | bajo"
    }
  ],
  "jugadores_en_forma": [
    {
      "equipo": string,
      "jugador": string,
      "rating_ultimo_partido": number | null,
      "descripcion": string
    }
  ],
  "arbitro": {
    "nombre": string | null,
    "nacionalidad": string | null,
    "tendencia": "ESTRICTO | NORMAL | PERMISIVO | sin_datos",
    "amarillas_por_partido": number | null,
    "impacto_esperado": string
  },
  "factores_clave": [
    {
      "categoria": "forma | clima | suspension | lesion | h2h | tactica | motivacion | mercado | grupo | arbitro",
      "descripcion": string,
      "impacto": "bajo | medio | alto",
      "favorece": "home | away | neutral | sin_datos"
    }
  ],
  "probabilidades": {
    "home_win": number,
    "draw": number,
    "away_win": number,
    "over_2_5": number,
    "under_2_5": number,
    "btts_yes": number,
    "btts_no": number
  },
  "confianza_modelo": "baja | media | alta",
  "alertas": [
    {
      "tipo": "clima | suspension | lesion | noticia | mercado | grupo | dato_faltante",
      "mensaje": string,
      "prioridad": "baja | media | alta"
    }
  ],
  "mensaje_telegram": string
}

INSTRUCCIONES ESPECIALES:

1. SUSPENSIONES: Si hay jugadores con 2+ tarjetas amarillas acumuladas (ver suspension_risks),
   menciónalos en bajas_y_suspensiones con tipo "riesgo_suspension" y detalla el impacto en
   el equipo. Con 3+ amarillas usar "suspension_confirmada".

2. LESIONES: Usa injury_mentions para detectar bajas por lesión. Si una noticia menciona a
   un jugador con palabras de lesión, incorpóralo en bajas_y_suspensiones.

3. CONTEXTO DEL GRUPO: Usa standings_stakes para explicar QUÉ SE JUEGA cada equipo.
   En la segunda jornada o tercera, esto es determinante. Si un equipo ya está eliminado
   o ya clasificó, impacta en motivación y alineación posible.

4. CLIMA: Si hay lluvia >50%, calor >33°C o viento >40 km/h, debe aparecer como alerta
   de prioridad alta y como factor_clave.

5. H2H: Si hay historial, menciona tendencia. Si no hay, no lo inventes.

6. mensaje_telegram: Máximo 250 caracteres. Debe incluir el resultado más relevante
   del análisis (quién tiene ventaja y por qué) en un tono informativo y directo.

7. ÁRBITRO: Si se conoce el árbitro (referee.nombre), considera su tendencia para el campo "arbitro" del JSON:
   - ESTRICTO (≥4.5 amarillas/partido): aumenta el riesgo de suspensión para jugadores con 1+ amarilla acumulada,
     mayor probabilidad de penales, incluir en factores_clave con categoría "arbitro".
   - PERMISIVO (≤2.5 amarillas/partido): baja el riesgo de tarjetas, menos penales probables.
   - NORMAL: sin ajuste significativo.
   Si no hay datos del torneo (stats_torneo null), usar solo la información del catálogo (nacionalidad, confederacion).

Datos de entrada:

${JSON.stringify(input, null, 2)}
`;
}
