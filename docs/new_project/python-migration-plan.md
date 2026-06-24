# Python Migration Plan

Objetivo: migrar datos historicos desde un workbook exportado a Supabase limpio, sin guardar raw rows y sin replicar la estructura accidental del archivo fuente.

## Decision

La migracion inicial se ejecuta con Python directo contra Supabase REST.

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
```

Usar service role para migracion inicial. No commitear `.env`.

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

Run real:

```bash
python3 scripts/migration/migrate_wc2026_to_supabase.py \
  --xlsx "/Users/mcerda/Downloads/Mundial2026 - Modelo de Datos y Estadísticas (18).xlsx"
```

Si el Python del sistema no tiene `openpyxl`:

```bash
python3 -m pip install openpyxl
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
