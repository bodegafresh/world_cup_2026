# Pool Team 2026

Plataforma cuantitativa multi-competencia para futbol, con Supabase/PostgreSQL como fuente canonica.

## Estado Actual

- Supabase es la fuente de verdad.
- La migracion inicial se ejecuta con Python directo contra Supabase.
- El runtime GAS nuevo no usa hojas; el migrador externo puede leer la fuente viva del proyecto original.
- Las tablas finales no guardan raw rows ni replican estructuras externas.

## Base Limpia

SQL principal:

```bash
supabase/new_project/000_drop_all.sql
supabase/new_project/001_clean_schema.sql
supabase/new_project/003_seed_countries_wc2026.sql
```

Reset solo de datos:

```bash
supabase/new_project/002_truncate_all_data.sql
```

## Migracion Inicial

Script:

```bash
scripts/migration/migrate_wc2026_to_supabase.py
```

Variables:

```bash
export SUPABASE_URL="https://<project-ref>.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"
```

Dry run:

```bash
python3 scripts/migration/migrate_wc2026_to_supabase.py \
  --xlsx "/Users/mcerda/Downloads/Mundial2026 - Modelo de Datos y Estadísticas (18).xlsx" \
  --dry-run
```

Run real:

```bash
python3 scripts/migration/migrate_wc2026_to_supabase.py \
  --xlsx "/Users/mcerda/Downloads/Mundial2026 - Modelo de Datos y Estadísticas (18).xlsx"
```

Run real desde la fuente viva:

```bash
python3 scripts/migration/migrate_wc2026_to_supabase.py \
  --google-spreadsheet-id "<spreadsheet-id>" \
  --venues-file "/Users/mcerda/Downloads/estadios.txt"
```

Por defecto no consume APIs externas. Para enriquecer con APIs usar budgets explicitos:

```bash
export API_FOOTBALL_KEY="<api-football-key>"
export FOOTBALL_DATA_TOKEN="<football-data-token>"
export SPORTMONKS_API_TOKEN="<sportmonks-token>"

python3 scripts/migration/migrate_wc2026_to_supabase.py \
  --google-spreadsheet-id "<spreadsheet-id>" \
  --venues-file "/Users/mcerda/Downloads/estadios.txt" \
  --api-football-budget 2 \
  --football-data-budget 2 \
  --espn-budget 2 \
  --sportmonks-budget 0
```

El cache queda en `.cache/api_enrichment` para no repetir requests ya usados.

Para aprovechar la trial corta de Sportmonks sin depender de ella en runtime, se puede correr un enriquecimiento mas amplio. El script usa primero `core/countries` para guardar referencias en `countries.payload.external_refs`, luego consulta jugadores por pais y solo enlaza jugadores cuando el nombre existe de forma unica en la base local:

```bash
python3 scripts/migration/migrate_wc2026_to_supabase.py \
  --google-spreadsheet-id "<spreadsheet-id>" \
  --venues-file "/Users/mcerda/Downloads/estadios.txt" \
  --sportmonks-budget 60 \
  --sportmonks-country-pages 6
```

## Conteos Esperados Del Workbook Actual

- teams: 48
- players: 423
- venues: 16
- matches: 104
- tournament_slots: 64
- match_participants: 208

## Documentacion Relevante

- `docs/new_project/python-migration-plan.md`
- `docs/new_project/countries-normalization.md`
- `docs/new_project/operational-jobs.md`

## Regla Del Proyecto

Cualquier ingesta, normalizacion, feature, prediccion o decision EV debe persistir en Supabase o en jobs externos que escriban Supabase.
