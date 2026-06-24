# Remove Google Sheets Runtime

Estado actual: la migracion inicial ya no usa Google Apps Script ni Google Sheets como storage. El camino oficial es Python directo a Supabase.

## Removed From Migration Path

- `src/InitialBootstrapLoad.gs`
- `src/SupabaseMigration.gs`
- `docs/new_project/initial-bootstrap-load.md`
- `docs/supabase-primary-migration.md`
- `docs/sheets-schema.md`
- `docs/gas-code-normalization-plan.md`
- API admin endpoints:
  - `admin/supabase/bootstrap-mvp30`
  - `admin/supabase/bootstrap-mvp30-fast`
  - `admin/supabase/migrate-core`
  - `admin/supabase/migrate-sheet`
  - `admin/supabase/import-sheet-raw`
  - `admin/supabase/validate`
  - `admin/supabase/cutover-primary`
  - `admin/supabase/rollback-sheets`

## Still Legacy

These files still contain `SpreadsheetApp`, `DriveApp` or repository helpers and must be replaced before deleting Apps Script storage support completely:

- `src/SheetManager.gs`
- `src/SheetsRepository.gs`
- `src/DriveStorage.gs`
- any module that calls `readAll_`, `appendRow_`, `appendRows_`, `updateRow_`, `upsertRowsByKey_`

## Next Refactor

1. Replace every production read path with `PublishedReadService` or Supabase repositories.
2. Replace every production write path with API ingestion jobs that write Supabase tables directly.
3. Remove `SpreadsheetApp` and `DriveApp` scopes from `appsscript.json`.
4. Delete Sheets repository files.
5. Keep Google Sheets only as optional export outside the application runtime.

## Rule

No new feature may write to Google Sheets. If data is needed, create a Supabase table/view/repository or a Python/worker ingestion job.
