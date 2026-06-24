-- Pool Team 2026 - Supabase reliability layer
-- Apply after 006_entity_metadata_refs_media.sql.
--
-- Adds:
-- - a heartbeat table + RPC for cron keep-alive / healthcheck
-- - a generic transactional batch RPC for safe server-side atomic writes

create extension if not exists pgcrypto;

create table if not exists supabase_heartbeats (
  heartbeat_key text primary key,
  service_name text not null,
  status text not null check (status in ('OK','WARN','ERROR')),
  checked_at timestamptz not null default now(),
  latency_ms integer,
  details jsonb not null default '{}'::jsonb
);

create or replace function app_supabase_healthcheck(
  p_service_name text default 'pool-team-2026',
  p_details jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_started_at timestamptz := clock_timestamp();
  v_latency_ms integer;
  v_counts jsonb;
begin
  select jsonb_build_object(
    'competitions', (select count(*) from competitions),
    'competition_seasons', (select count(*) from competition_seasons),
    'teams', (select count(*) from teams),
    'matches', (select count(*) from matches)
  )
  into v_counts;

  v_latency_ms := greatest(0, floor(extract(epoch from (clock_timestamp() - v_started_at)) * 1000)::integer);

  insert into supabase_heartbeats (
    heartbeat_key,
    service_name,
    status,
    checked_at,
    latency_ms,
    details
  )
  values (
    'default',
    p_service_name,
    'OK',
    now(),
    v_latency_ms,
    coalesce(p_details, '{}'::jsonb) || jsonb_build_object('counts', v_counts)
  )
  on conflict (heartbeat_key) do update set
    service_name = excluded.service_name,
    status = excluded.status,
    checked_at = excluded.checked_at,
    latency_ms = excluded.latency_ms,
    details = excluded.details;

  return jsonb_build_object(
    'ok', true,
    'status', 'OK',
    'checked_at', now(),
    'latency_ms', v_latency_ms,
    'counts', v_counts
  );
exception when others then
  v_latency_ms := greatest(0, floor(extract(epoch from (clock_timestamp() - v_started_at)) * 1000)::integer);
  insert into supabase_heartbeats (
    heartbeat_key,
    service_name,
    status,
    checked_at,
    latency_ms,
    details
  )
  values (
    'default',
    p_service_name,
    'ERROR',
    now(),
    v_latency_ms,
    jsonb_build_object('error', sqlerrm)
  )
  on conflict (heartbeat_key) do update set
    service_name = excluded.service_name,
    status = excluded.status,
    checked_at = excluded.checked_at,
    latency_ms = excluded.latency_ms,
    details = excluded.details;

  raise;
end;
$$;

create or replace function app_transaction_batch(p_operations jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_op jsonb;
  v_table text;
  v_action text;
  v_payload jsonb;
  v_filters jsonb;
  v_conflict_columns text[];
  v_result jsonb := '[]'::jsonb;
  v_count integer;
begin
  if jsonb_typeof(p_operations) <> 'array' then
    raise exception 'p_operations must be a jsonb array';
  end if;

  for v_op in select * from jsonb_array_elements(p_operations)
  loop
    v_action := lower(coalesce(v_op->>'action', ''));
    v_table := coalesce(v_op->>'table', '');
    v_payload := coalesce(v_op->'rows', v_op->'payload', '[]'::jsonb);
    v_filters := coalesce(v_op->'filters', '{}'::jsonb);

    if v_table = '' then
      raise exception 'transaction operation missing table';
    end if;

    if to_regclass(format('public.%I', v_table)) is null then
      raise exception 'table does not exist: %', v_table;
    end if;

    if v_action in ('insert', 'upsert') then
      if jsonb_typeof(v_payload) <> 'array' then
        raise exception 'insert/upsert rows must be an array for table %', v_table;
      end if;
      if jsonb_array_length(v_payload) = 0 then
        v_count := 0;
      elsif v_action = 'insert' then
        v_count := app_transaction_insert_rows(v_table, v_payload);
      else
        select array_agg(value::text)
        into v_conflict_columns
        from jsonb_array_elements_text(coalesce(v_op->'conflict_columns', '[]'::jsonb)) as t(value);

        if v_conflict_columns is null or array_length(v_conflict_columns, 1) is null then
          raise exception 'upsert requires conflict_columns for table %', v_table;
        end if;

        v_count := app_transaction_upsert_rows(v_table, v_payload, v_conflict_columns);
      end if;
    elsif v_action = 'delete' then
      v_count := app_transaction_delete_rows(v_table, v_filters);
    else
      raise exception 'unsupported transaction action: %', v_action;
    end if;

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'action', v_action,
      'table', v_table,
      'count', v_count
    ));
  end loop;

  return jsonb_build_object(
    'ok', true,
    'operations', jsonb_array_length(p_operations),
    'results', v_result
  );
end;
$$;

create or replace function app_transaction_insert_rows(
  p_table text,
  p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sql text;
  v_count integer;
  v_cols text[];
  v_insert_cols text;
begin
  select array_agg(distinct key order by key)
  into v_cols
  from jsonb_array_elements(p_rows) as row_obj(value),
       jsonb_object_keys(row_obj.value) as key
  where exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = p_table
      and c.column_name = key
  );

  if v_cols is null or array_length(v_cols, 1) is null then
    raise exception 'no valid table columns found for %', p_table;
  end if;

  v_insert_cols := (
    select string_agg(format('%I', col), ', ')
    from unnest(v_cols) col
  );

  v_sql := format(
    'insert into %1$I (%2$s)
     select %2$s from jsonb_populate_recordset(null::%1$I, $1)',
    p_table,
    v_insert_cols
  );
  execute v_sql using p_rows;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function app_transaction_upsert_rows(
  p_table text,
  p_rows jsonb,
  p_conflict_columns text[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sql text;
  v_count integer;
  v_cols text[];
  v_insert_cols text;
  v_conflict_cols text;
  v_update_cols text;
begin
  select array_agg(distinct key order by key)
  into v_cols
  from jsonb_array_elements(p_rows) as row_obj(value),
       jsonb_object_keys(row_obj.value) as key
  where exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = p_table
      and c.column_name = key
  );

  if v_cols is null or array_length(v_cols, 1) is null then
    raise exception 'no valid table columns found for %', p_table;
  end if;

  v_insert_cols := (
    select string_agg(format('%I', col), ', ')
    from unnest(v_cols) col
  );

  v_conflict_cols := (
    select string_agg(format('%I', col), ', ')
    from unnest(p_conflict_columns) col
  );

  v_update_cols := (
    select string_agg(format('%1$I = excluded.%1$I', col), ', ')
    from unnest(v_cols) col
    where not (col = any(p_conflict_columns))
  );

  if v_update_cols is null or v_update_cols = '' then
    v_update_cols := format('%1$I = excluded.%1$I', v_cols[1]);
  end if;

  v_sql := format(
    'insert into %1$I (%2$s)
     select %2$s from jsonb_populate_recordset(null::%1$I, $1)
     on conflict (%3$s) do update set %4$s',
    p_table,
    v_insert_cols,
    v_conflict_cols,
    v_update_cols
  );

  execute v_sql using p_rows;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function app_transaction_delete_rows(
  p_table text,
  p_filters jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sql text;
  v_where text;
  v_count integer;
begin
  if p_filters is null or p_filters = '{}'::jsonb then
    raise exception 'delete requires filters';
  end if;

  select string_agg(format('%I = %L', key, value), ' and ')
  into v_where
  from jsonb_each_text(p_filters)
  where exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = p_table
      and c.column_name = key
  );

  if v_where is null or v_where = '' then
    raise exception 'delete filters do not match columns for %', p_table;
  end if;

  v_sql := format('delete from %I where %s', p_table, v_where);
  execute v_sql;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
