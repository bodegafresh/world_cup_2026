-- Drop opcional de tablas RAW si la politica final es:
-- "no guardar raw en Supabase; solo datos utiles normalizados".
--
-- Este script es mas agresivo que drop_legacy_sheet_replica_tables.sql.
-- Ejecutarlo solo si ya decidiste que no habra capa RAW persistida en DB.
--
-- Recomendacion: antes de ejecutar, exportar backup SQL/CSV si necesitas
-- auditoria historica.

-- ---------------------------------------------------------------------------
-- PREVIEW
-- ---------------------------------------------------------------------------

select 'sheet_raw_rows' as object_name, count(*) as rows from sheet_raw_rows
union all
select 'source_fixtures', count(*) from source_fixtures;

-- Estas dos pueden ser datos utiles para features si se normalizan. No se
-- incluyen en el DROP por defecto:
--
-- weather_snapshots
-- news_items
--
-- Si quieres eliminarlas tambien, revisa el bloque opcional al final.

-- ---------------------------------------------------------------------------
-- DROP RAW NO USADO POR MODELO FINAL
-- ---------------------------------------------------------------------------

begin;

drop table if exists sheet_raw_rows;
drop table if exists source_fixtures;

commit;

-- ---------------------------------------------------------------------------
-- OPCIONAL: eliminar fuentes externas no normalizadas
-- ---------------------------------------------------------------------------
--
-- Ejecutar solo si NO usaras clima/noticias como features ni como contexto.
--
-- begin;
-- drop table if exists weather_snapshots;
-- drop table if exists news_items;
-- commit;
