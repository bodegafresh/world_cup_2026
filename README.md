# Pool Team 2026

Plataforma cuantitativa multi-competencia para futbol, con Supabase/PostgreSQL como fuente canonica.

## Estado Actual

El proyecto esta migrando desde un prototipo basado en Google Apps Script/Google Sheets hacia una arquitectura limpia:

- Supabase es la fuente de verdad.
- Google Sheets ya no debe usarse como storage de aplicacion.
- La migracion inicial se ejecuta con Python directo contra Supabase.
- Las tablas finales no replican hojas y no guardan raw rows.

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

Google Sheet directo es opcional, solo como input de migracion:

```bash
python3 scripts/migration/migrate_wc2026_to_supabase.py \
  --google-spreadsheet-id "<spreadsheet-id>" \
  --google-credentials-json "/secure/path/google-service-account.credentials.json"
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
- `docs/new_project/remove-google-sheets-runtime.md`
- `docs/new_project/operational-jobs.md`
- `docs/new_project/reset-redesign-plan.md`

## Regla Del Proyecto

No agregar nuevas dependencias de Google Sheets. Cualquier ingesta, normalizacion, feature, prediccion o decision EV debe persistir en Supabase o en jobs externos que escriban Supabase.
