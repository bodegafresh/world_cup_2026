# Countries Normalization

`countries` is ISO-first. The canonical key is `countries.code_alpha2`.
FIFA and IOC codes are sports metadata and must not be used as primary keys.

## Migration Order

Run on a clean database:

1. `supabase/new_project/000_drop_all.sql`
2. `supabase/new_project/001_clean_schema.sql`
3. `supabase/new_project/003_seed_countries_wc2026.sql`
4. `scripts/migration/migrate_wc2026_to_supabase.py`

If using `002_truncate_all_data.sql`, run the country seed again before loading teams.

## Core Rules

- `teams.country_code` references `countries(code_alpha2)`.
- National teams use the ISO country or territory code behind the sporting association.
- Clubs use the ISO country code of the club's origin.
- FIFA code is stored in `countries.fifa_code` only when it maps cleanly to the ISO row.
- FIFA associations without a one-to-one ISO country row are stored in `countries.payload`.
- External provider IDs and federation codes belong in `entity_external_refs` or sports metadata, never as canonical IDs.
- Country names must not be stored as free text in canonical tables.

## Special Sporting Cases

### United Kingdom

`GB` is the ISO country row. England, Scotland, Wales and Northern Ireland are separate FIFA associations, but they are not separate ISO 3166-1 alpha-2 countries.

Store:

- `countries.code_alpha2 = 'GB'`
- `countries.ioc_code = 'GBR'`
- `countries.fifa_code = null`
- `countries.payload.sports.fifa_associations[] = ENG/SCO/WAL/NIR`
- `teams.country_code = 'GB'` for England, Scotland, Wales and Northern Ireland national teams
- FIFA team code as an external reference, for example `entity_external_refs(source='FIFA', source_entity_id='ENG')`

### Curacao

`CW` is a valid ISO 3166-1 alpha-2 territory code. It is a FIFA member association with `fifa_code = 'CUW'`, but `is_sovereign = false`.

## Validation Queries

National teams missing ISO country:

```sql
select team_id, display_name, slug
from teams
where team_type = 'NATIONAL_TEAM'
  and country_code is null;
```

Country codes used by teams:

```sql
select t.display_name, t.country_code, c.default_name, c.fifa_code, c.ioc_code
from teams t
left join countries c on c.code_alpha2 = t.country_code
order by t.display_name;
```

Unexpected duplicate country-like values inside team metadata:

```sql
select team_id, display_name, metadata
from teams
where metadata ? 'country'
   or metadata ? 'country_code'
   or metadata ? 'fifa_code'
   or metadata ? 'ioc_code';
```

Published data quality check:

```sql
select *
from published_data_quality_health
where check_name = 'NATIONAL_TEAMS_WITHOUT_ISO_COUNTRY';
```

## Updates

Use SQL migrations/seeds or Python jobs only.
