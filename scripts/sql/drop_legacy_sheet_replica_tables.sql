-- Drop de tablas legacy que NO aplican al modelo final.
--
-- Objetivo:
-- Eliminar tablas nacidas del enfoque anterior "hoja = tabla" o salidas
-- analytics legacy reemplazadas por tablas canonicas/analytics finales.
--
-- Ejecutar solo despues de:
-- 1. aplicar 004_final_canonical_contract.sql,
-- 2. cargar datos utiles con /api/v1/admin/final/*,
-- 3. validar que frontend/API ya consumen tablas finales o views published_*.
--
-- NO elimina tablas canonicas finales.

-- ---------------------------------------------------------------------------
-- PREVIEW
-- ---------------------------------------------------------------------------

select 'model_outputs' as object_name, count(*) as rows from model_outputs
union all
select 'ev_picks', count(*) from ev_picks
union all
select 'model_calibration', count(*) from model_calibration
union all
select 'elo_ratings', count(*) from elo_ratings
union all
select 'data_quality_log', count(*) from data_quality_log
union all
select 'player_match_summary', count(*) from player_match_summary
union all
select 'group_simulations', count(*) from group_simulations;

-- ---------------------------------------------------------------------------
-- DROP
-- ---------------------------------------------------------------------------

begin;

-- Views antiguas que dependen de tablas legacy.
drop view if exists active_ev_plus;
drop view if exists model_calibration_daily;

-- Views de compatibilidad creadas en 004 que pueden depender de legacy solo
-- indirectamente o ser reemplazables desde tablas finales.
-- Se conservan las published_* basadas en tablas finales.

-- Tablas legacy/sheet-replica.
drop table if exists model_outputs;
drop table if exists ev_picks;
drop table if exists model_calibration;
drop table if exists elo_ratings;
drop table if exists data_quality_log;
drop table if exists player_match_summary;
drop table if exists group_simulations;

commit;

-- Tablas finales que reemplazan lo eliminado:
--
-- model_outputs       -> model_runs + model_predictions
-- ev_picks            -> betting_decisions + bets + published_ev_opportunities
-- model_calibration   -> calibration_runs + calibration_bins + model_metrics
-- elo_ratings         -> rating_snapshots + vw_current_elo_ratings
-- data_quality_log    -> data_quality_events
-- player_match_summary-> player_match_stats + match_events / published views
-- group_simulations   -> postergar simulation_runs/simulation_outputs hasta volumen real
