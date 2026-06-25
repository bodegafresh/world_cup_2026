# Python Migration Plan

Objetivo: migrar datos historicos desde la fuente viva del proyecto original o desde un workbook exportado a Supabase limpio, sin guardar raw rows y sin replicar la estructura accidental del archivo fuente.

## Decision

La migracion inicial se ejecuta con Python directo contra Supabase REST.

El sistema nuevo no lee la fuente original en runtime. Solo el script externo de migracion puede leerla mientras el proyecto original siga alimentandola.

## Script

Archivo:

```bash
scripts/migration/migrate_wc2026_to_supabase.py
```

Carga actualmente:

- `competitions`
- `competition_seasons`
- `competition_stages`
- `competition_groups`
- `teams`
- `team_aliases`
- `entity_external_refs`
- `competition_team_entries`
- `competition_group_memberships`
- `players`
- `team_memberships`
- `competition_rosters`
- `venues`
- `matches`
- `tournament_slots`
- `match_participants`

No carga raw payloads.

## Environment

```bash
export SUPABASE_URL="https://<project-ref>.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"
```

Usar service role para migracion inicial. No commitear `.env`.
Usar credenciales readonly para leer la fuente viva.

## Clean Run

Ejecutar SQL en Supabase:

```sql
-- 1
-- supabase/new_project/000_drop_all.sql

-- 2
-- supabase/new_project/001_clean_schema.sql

-- 3
-- supabase/new_project/003_seed_countries_wc2026.sql
```

Dry run local:

```bash
python3 scripts/migration/migrate_wc2026_to_supabase.py \
  --xlsx "/Users/mcerda/Downloads/Mundial2026 - Modelo de Datos y Estadísticas (18).xlsx" \
  --dry-run
```

Dry run desde fuente viva:

```bash
python3 scripts/migration/migrate_wc2026_to_supabase.py \
  --google-spreadsheet-id "<spreadsheet-id>" \
  --dry-run
```

Run real:

```bash
python3 scripts/migration/migrate_wc2026_to_supabase.py \
  --xlsx "/Users/mcerda/Downloads/Mundial2026 - Modelo de Datos y Estadísticas (18).xlsx"
```

Run real desde fuente viva:

```bash
python3 scripts/migration/migrate_wc2026_to_supabase.py \
  --google-spreadsheet-id "<spreadsheet-id>"
```

Enriquecimiento opcional con APIs externas:

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
  --sportmonks-budget 60 \
  --sportmonks-country-pages 6
```

Sportmonks se usa solo como fuente de enriquecimiento temporal: `core/countries` se persiste en `countries.payload.external_refs` y `football/players/countries/{id}` se enlaza a `entity_external_refs` únicamente cuando el jugador se puede resolver de forma no ambigua por nombre.

Si el Python del sistema no tiene dependencias:

```bash
python3 -m pip install openpyxl gspread google-auth
```

## Expected Counts With Current Workbook

Dry run validado con `Mundial2026 - Modelo de Datos y Estadísticas (18).xlsx`:

- teams: `48`
- players: `423`
- venues: `16`
- matches: `104`
- tournament_slots: `64`
- match_participants: `208`

## Post-Run Validation

```sql
select count(*) from teams;
select count(*) from players;
select count(*) from matches;
select * from published_data_quality_health where issue_count > 0;
select team_id, display_name, country_code from teams where country_code is null;
```

Expected:

- `teams = 48`
- no `NATIONAL_TEAMS_WITHOUT_ISO_COUNTRY`
- no duplicate team identity

## Target State

- Supabase is the only source of truth.
- Python/worker jobs ingest APIs and write Supabase.
