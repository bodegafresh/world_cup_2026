# Tournament Structure Model

## Decision

`teams` is a global identity table. It must not store tournament-specific group
membership. A team can participate in many competitions, seasons, stages and
groups over time.

Canonical structure:

- `teams`: global team identity.
- `competition_participants`: team entered into one competition season.
- `competition_stages`: phases of a competition season.
- `competition_groups`: groups/pools inside one stage.
- `competition_group_memberships`: team membership in a group.
- `qualification_rules`: how teams advance between stages.
- `tournament_slots`: unresolved bracket or qualification slots.
- `match_team_slots`: home/away participant definition for a match.

Legacy/cache fields:

- `teams.group_code`: deprecated. Keep null.
- `competition_team_mapping.group_code`: compatibility cache only.
- `matches.group_code`: compatibility cache only.

## WC2026 Example

WC2026 has:

- `GROUP_STAGE`: 12 groups, A-L, 4 teams per group.
- `ROUND_OF_32`: 32 teams.
- `ROUND_OF_16`.
- `QUARTERFINAL`.
- `SEMIFINAL`.
- `THIRD_PLACE`.
- `FINAL`.

Group participants are represented in:

- `competition_participants`
- `competition_groups`
- `competition_group_memberships`

Future knockout placeholders such as `Group A Winner`, `Third Place Group A/B/C/D/F`
or `Round of 32 1 Winner` are represented in:

- `tournament_slots`
- `match_team_slots`

They are not teams.

## League Example

A normal domestic league usually has:

- one `competition_stage` with `stage_type = LEAGUE_PHASE` or `LEAGUE_REGULAR`;
- no rows in `competition_groups`;
- all teams in `competition_participants`;
- standings scoped to the competition season, not group membership.

## Cup Example

A cup can have only knockout stages:

- `ROUND_OF_64`
- `ROUND_OF_32`
- `ROUND_OF_16`
- `QUARTERFINAL`
- `SEMIFINAL`
- `FINAL`

It may have `tournament_slots` before fixtures are resolved, but no groups.

## Rule

No model, EV filter, calibration segment or readiness check should infer group
membership from `teams`. Use stage/group tables or participant tables.

## Identity, Metadata And Media

Every project relation uses internal IDs:

- Team: `teams.team_key`
- Player: `players.player_key`
- Competition season: `competition_seasons.competition_season_id`
- Match: `matches.match_id`
- Venue: `venues.venue_id`
- Referee: `referees.referee_key`

External provider IDs are not operational keys. They belong in
`entity_external_refs`, for example:

- API-Football team id
- Football-Data team id
- ESPN event id
- odds provider identifiers

Images and visual assets belong in `entity_media_assets`, for example:

- national team flag
- team logo or crest
- player photo
- venue image

`metadata` is for useful normalized attributes that are not relational keys:

- country code
- federation code
- source quality
- source update timestamp
- non-critical descriptive attributes

Ingestion rule:

1. Normalize source names and aliases.
2. Resolve or create the internal entity ID.
3. Upsert canonical entity fields.
4. Upsert aliases.
5. Upsert external refs.
6. Upsert media assets.
7. Attach the entity to the competition context.
8. Write data quality/readiness events for anything ambiguous.
