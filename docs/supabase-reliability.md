# Supabase Reliability

## Migrations

Apply:

1. `supabase/migrations/007_supabase_reliability.sql`

It creates:

- `supabase_heartbeats`
- `app_supabase_healthcheck(...)`
- `app_transaction_batch(...)`

## Healthcheck / Keep Alive

Use this endpoint from cron:

```bash
curl -sS "$POOL_API_URL/api/v1/health/supabase" \
  -H "Authorization: Bearer $WEB_KEY"
```

Recommended frequency for the free Supabase tier:

- every 6 hours, or
- every 12 hours if you want less noise.

It performs a lightweight database read and upserts one row in
`supabase_heartbeats`.

Apps Script trigger option:

- function: `cronSupabaseHealthcheck`
- timer: every 6 hours

## Safe Transactions

Use `supabaseTransaction_(operations)` from GAS when multiple writes must commit
or rollback together.

Example:

```js
supabaseTransaction_([
  {
    action: 'upsert',
    table: 'teams',
    conflict_columns: ['team_key'],
    rows: [{ team_key: 'brazil', display_name: 'Brasil' }]
  },
  {
    action: 'upsert',
    table: 'competition_participants',
    conflict_columns: ['competition_season_id', 'team_key'],
    rows: [{ competition_season_id: 'WC2026', team_key: 'brazil' }]
  }
]);
```

If any operation fails, Postgres rolls back the full batch.

Supported actions:

- `insert`
- `upsert`
- `delete`

Delete requires exact filters:

```js
{
  action: 'delete',
  table: 'team_aliases',
  filters: { team_key: 'legacy_key' }
}
```

## Retry Policy

`supabaseRequest_` retries transient failures:

- 408
- 425
- 429
- 500
- 502
- 503
- 504
- network/socket/timeouts

Default:

- 2 retries
- exponential backoff
- jitter

Transactions default to no retry to avoid re-running unknown write outcomes.
