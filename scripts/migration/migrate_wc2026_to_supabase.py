#!/usr/bin/env python3
"""
Migrate WC2026 source data into the clean Supabase schema.

This script is intentionally independent from Google Apps Script. It reads an
Excel workbook by default, or a Google Sheet when optional Google dependencies
are installed, and writes only canonical/useful data into Supabase.

Required environment:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY  (preferred) or SUPABASE_KEY

Supported inputs:
  --xlsx /path/to/workbook.xlsx
  --google-spreadsheet-id <id> --google-credentials-json /path/key.json

Before running against an empty database:
  1. Run supabase/new_project/001_clean_schema.sql
  2. Run supabase/new_project/003_seed_countries_wc2026.sql
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import uuid
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, time as dt_time, timezone
from pathlib import Path
from typing import Any, Iterable
from zoneinfo import ZoneInfo


SOURCE_NAME = "GOOGLE_SHEET_EXPORT"
DEFAULT_SEASON_SLUG = "wc2026"
DEFAULT_COMPETITION_SLUG = "fifa-world-cup"
DEFAULT_SOURCE_TZ = "America/Santiago"

TABLE_PRIMARY_KEYS = {
    "competitions": "competition_id",
    "competition_seasons": "competition_season_id",
    "competition_stages": "stage_id",
    "competition_groups": "group_id",
    "teams": "team_id",
    "team_aliases": "team_alias_id",
    "competition_team_entries": "competition_team_entry_id",
    "competition_group_memberships": "group_membership_id",
    "players": "player_id",
    "team_memberships": "team_membership_id",
    "competition_rosters": "competition_roster_id",
    "venues": "venue_id",
    "matches": "match_id",
    "tournament_slots": "tournament_slot_id",
    "match_participants": "match_participant_id",
    "entity_external_refs": "entity_external_ref_id",
}


TEAM_DISPLAY_ES = {
    "algeria": "Argelia",
    "argentina": "Argentina",
    "australia": "Australia",
    "austria": "Austria",
    "belgium": "Belgica",
    "bosniaherzegovina": "Bosnia y Herzegovina",
    "brazil": "Brasil",
    "canada": "Canada",
    "capeverde": "Cabo Verde",
    "colombia": "Colombia",
    "congodr": "Congo DR",
    "cotedivoire": "Costa de Marfil",
    "croatia": "Croacia",
    "curacao": "Curazao",
    "czechia": "Republica Checa",
    "ecuador": "Ecuador",
    "egypt": "Egipto",
    "england": "Inglaterra",
    "france": "Francia",
    "germany": "Alemania",
    "ghana": "Ghana",
    "haiti": "Haiti",
    "iran": "Iran",
    "iraq": "Irak",
    "japan": "Japon",
    "jordan": "Jordania",
    "mexico": "Mexico",
    "morocco": "Marruecos",
    "netherlands": "Paises Bajos",
    "newzealand": "Nueva Zelanda",
    "norway": "Noruega",
    "panama": "Panama",
    "paraguay": "Paraguay",
    "portugal": "Portugal",
    "qatar": "Catar",
    "saudiarabia": "Arabia Saudita",
    "scotland": "Escocia",
    "senegal": "Senegal",
    "southafrica": "Sudafrica",
    "southkorea": "Corea del Sur",
    "spain": "Espana",
    "sweden": "Suecia",
    "switzerland": "Suiza",
    "tunisia": "Tunez",
    "turkey": "Turquia",
    "unitedstates": "EE.UU.",
    "uruguay": "Uruguay",
    "uzbekistan": "Uzbekistan",
}

TEAM_ALIASES = {
    "algeria": ["algeria", "argelia", "alg", "dz"],
    "argentina": ["argentina", "arg"],
    "australia": ["australia", "aus"],
    "austria": ["austria", "aut"],
    "belgium": ["belgium", "belgica", "bel"],
    "bosniaherzegovina": ["bosnia and herzegovina", "bosnia herzegovina", "bosnia-herzegovina", "bosnia & herzegovina", "bosnia", "bih"],
    "brazil": ["brazil", "brasil", "bra"],
    "canada": ["canada", "canada", "can"],
    "capeverde": ["cape verde", "cabo verde", "cpv"],
    "colombia": ["colombia", "col"],
    "congodr": ["dr congo", "congo dr", "drc", "cod", "rd congo"],
    "cotedivoire": ["ivory coast", "cote d ivoire", "cote d'ivoire", "costa de marfil", "civ"],
    "croatia": ["croatia", "croacia", "hrv"],
    "curacao": ["curacao", "curazao", "cuw"],
    "czechia": ["czechia", "czech republic", "republica checa", "cze"],
    "ecuador": ["ecuador", "ecu"],
    "egypt": ["egypt", "egipto", "egy"],
    "england": ["england", "inglaterra", "eng"],
    "france": ["france", "francia", "fra"],
    "germany": ["germany", "alemania", "deutschland", "ger", "deu"],
    "ghana": ["ghana", "gha"],
    "haiti": ["haiti", "hai", "hti"],
    "iran": ["iran", "irn"],
    "iraq": ["iraq", "irak", "irq"],
    "japan": ["japan", "japon", "jpn"],
    "jordan": ["jordan", "jordania", "jor"],
    "mexico": ["mexico", "mex"],
    "morocco": ["morocco", "marruecos", "mar"],
    "netherlands": ["netherlands", "holanda", "paises bajos", "ned", "nld"],
    "newzealand": ["new zealand", "nueva zelanda", "nzl"],
    "norway": ["norway", "noruega", "nor"],
    "panama": ["panama", "pan"],
    "paraguay": ["paraguay", "par"],
    "portugal": ["portugal", "por"],
    "qatar": ["qatar", "catar", "qat"],
    "saudiarabia": ["saudi arabia", "arabia saudita", "ksa", "sau"],
    "scotland": ["scotland", "escocia", "sco"],
    "senegal": ["senegal", "sen"],
    "southafrica": ["south africa", "sudafrica", "rsa", "zaf"],
    "southkorea": ["south korea", "korea republic", "republic of korea", "corea del sur", "kor"],
    "spain": ["spain", "espana", "esp"],
    "sweden": ["sweden", "suecia", "swe"],
    "switzerland": ["switzerland", "suiza", "sui", "che"],
    "tunisia": ["tunisia", "tunez", "tun"],
    "turkey": ["turkey", "turkiye", "turquia", "tur"],
    "unitedstates": ["united states", "united states of america", "usa", "u s a", "us", "eeuu", "ee uu", "estados unidos"],
    "uruguay": ["uruguay", "uru"],
    "uzbekistan": ["uzbekistan", "uzb"],
}

TEAM_COUNTRY = {
    "algeria": "DZ",
    "argentina": "AR",
    "australia": "AU",
    "austria": "AT",
    "belgium": "BE",
    "bosniaherzegovina": "BA",
    "brazil": "BR",
    "canada": "CA",
    "capeverde": "CV",
    "colombia": "CO",
    "congodr": "CD",
    "cotedivoire": "CI",
    "croatia": "HR",
    "curacao": "CW",
    "czechia": "CZ",
    "ecuador": "EC",
    "egypt": "EG",
    "england": "GB",
    "france": "FR",
    "germany": "DE",
    "ghana": "GH",
    "haiti": "HT",
    "iran": "IR",
    "iraq": "IQ",
    "japan": "JP",
    "jordan": "JO",
    "mexico": "MX",
    "morocco": "MA",
    "netherlands": "NL",
    "newzealand": "NZ",
    "norway": "NO",
    "panama": "PA",
    "paraguay": "PY",
    "portugal": "PT",
    "qatar": "QA",
    "saudiarabia": "SA",
    "scotland": "GB",
    "senegal": "SN",
    "southafrica": "ZA",
    "southkorea": "KR",
    "spain": "ES",
    "sweden": "SE",
    "switzerland": "CH",
    "tunisia": "TN",
    "turkey": "TR",
    "unitedstates": "US",
    "uruguay": "UY",
    "uzbekistan": "UZ",
}

TEAM_FIFA = {
    "algeria": "ALG",
    "argentina": "ARG",
    "australia": "AUS",
    "austria": "AUT",
    "belgium": "BEL",
    "bosniaherzegovina": "BIH",
    "brazil": "BRA",
    "canada": "CAN",
    "capeverde": "CPV",
    "colombia": "COL",
    "congodr": "COD",
    "cotedivoire": "CIV",
    "croatia": "CRO",
    "curacao": "CUW",
    "czechia": "CZE",
    "ecuador": "ECU",
    "egypt": "EGY",
    "england": "ENG",
    "france": "FRA",
    "germany": "GER",
    "ghana": "GHA",
    "haiti": "HAI",
    "iran": "IRN",
    "iraq": "IRQ",
    "japan": "JPN",
    "jordan": "JOR",
    "mexico": "MEX",
    "morocco": "MAR",
    "netherlands": "NED",
    "newzealand": "NZL",
    "norway": "NOR",
    "panama": "PAN",
    "paraguay": "PAR",
    "portugal": "POR",
    "qatar": "QAT",
    "saudiarabia": "KSA",
    "scotland": "SCO",
    "senegal": "SEN",
    "southafrica": "RSA",
    "southkorea": "KOR",
    "spain": "ESP",
    "sweden": "SWE",
    "switzerland": "SUI",
    "tunisia": "TUN",
    "turkey": "TUR",
    "unitedstates": "USA",
    "uruguay": "URU",
    "uzbekistan": "UZB",
}


def normalize_text(value: Any) -> str:
    text = "" if value is None else str(value)
    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = text.lower()
    text = text.replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


ALIAS_TO_KEY = {
    normalize_text(alias).replace(" ", ""): key
    for key, aliases in TEAM_ALIASES.items()
    for alias in aliases
}


def team_key(name: Any) -> str:
    normalized = normalize_text(name)
    compact = normalized.replace(" ", "")
    return ALIAS_TO_KEY.get(compact, compact)


def display_name_for_team(name: Any) -> str:
    key = team_key(name)
    return TEAM_DISPLAY_ES.get(key, str(name or "").strip())


def slugify(value: Any) -> str:
    return normalize_text(value).replace(" ", "-")


def is_tournament_slot(name: Any) -> bool:
    s = normalize_text(name)
    if not s:
        return False
    patterns = [
        r"^group [a-z0-9]+ (winner|runner up|2nd place|second place|third place|3rd place)$",
        r"^third place group",
        r"^round of [0-9]+ [0-9]+ (winner|loser)$",
        r"^quarter ?final [0-9]+ (winner|loser)$",
        r"^semi ?final [0-9]+ (winner|loser)$",
        r"^semifinal [0-9]+ (winner|loser)$",
    ]
    return any(re.search(pattern, s) for pattern in patterns)


def slot_code(name: Any) -> str:
    return normalize_text(name).replace(" ", "_")


def first_present(row: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = row.get(key)
        if value is not None and str(value).strip() != "":
            return value
    return None


def to_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def parse_datetime(row: dict[str, Any], source_tz: str) -> str | None:
    for key in ("date_utc", "fecha_utc", "kickoff_at"):
        value = row.get(key)
        if value:
            dt = coerce_datetime(value, ZoneInfo("UTC"))
            if dt:
                return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

    fecha = first_present(row, "fecha", "fecha_chile", "date")
    hora = first_present(row, "hora_chile", "hora", "time")
    if not fecha:
        return None

    local_tz = ZoneInfo(source_tz)
    if isinstance(fecha, datetime):
        d = fecha.date()
    elif isinstance(fecha, date):
        d = fecha
    else:
        text = str(fecha).strip()
        d = None
        for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d"):
            try:
                d = datetime.strptime(text[:10], fmt).date()
                break
            except ValueError:
                pass
        if d is None:
            dt = coerce_datetime(text, local_tz)
            if dt:
                return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
            return None

    if isinstance(hora, datetime):
        t = hora.time()
    elif isinstance(hora, dt_time):
        t = hora
    elif hora:
        match = re.search(r"(\d{1,2}):(\d{2})", str(hora))
        t = dt_time(int(match.group(1)), int(match.group(2))) if match else dt_time(0, 0)
    else:
        t = dt_time(0, 0)

    return datetime.combine(d, t, local_tz).astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def coerce_datetime(value: Any, default_tz: ZoneInfo) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=default_tz)
    if isinstance(value, date):
        return datetime.combine(value, dt_time(0, 0), default_tz)
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=default_tz)
    except ValueError:
        return None


@dataclass
class Supabase:
    url: str
    key: str
    dry_run: bool = False
    sleep_seconds: float = 0.0

    @property
    def rest_url(self) -> str:
        return self.url.rstrip("/") + "/rest/v1"

    def request(self, method: str, path: str, body: Any = None, query: dict[str, str] | None = None, prefer: str | None = None) -> Any:
        query_string = urllib.parse.urlencode(query or {})
        url = f"{self.rest_url}/{path}" + (f"?{query_string}" if query_string else "")
        payload = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if prefer:
            headers["Prefer"] = prefer
        if self.dry_run and method.upper() in {"POST", "PATCH", "DELETE"}:
            print(f"[dry-run] {method.upper()} {path} rows={len(body) if isinstance(body, list) else 1}")
            if prefer and "return=representation" in prefer:
                rows = body if isinstance(body, list) else [body]
                return [self._dry_row(path, row) for row in rows]
            return []
        req = urllib.request.Request(url, data=payload, headers=headers, method=method.upper())
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=60) as response:
                    text = response.read().decode("utf-8")
                    if self.sleep_seconds:
                        time.sleep(self.sleep_seconds)
                    return json.loads(text) if text else []
            except urllib.error.HTTPError as exc:
                text = exc.read().decode("utf-8")
                if exc.code in {429, 500, 502, 503, 504} and attempt < 3:
                    time.sleep(2 ** attempt)
                    continue
                raise RuntimeError(f"Supabase HTTP {exc.code} {method.upper()} {path}: {text}") from exc

    def _dry_row(self, path: str, row: dict[str, Any]) -> dict[str, Any]:
        table = path.split("?")[0]
        out = dict(row)
        primary_key = TABLE_PRIMARY_KEYS.get(table)
        if primary_key and primary_key not in out:
            out[primary_key] = str(uuid.uuid5(uuid.NAMESPACE_URL, table + ":" + json.dumps(row, sort_keys=True, default=str)))
        return out

    def upsert(self, table: str, rows: list[dict[str, Any]], conflict: str, returning: bool = False) -> list[dict[str, Any]]:
        if not rows:
            return []
        deduped = dedupe(rows, conflict.split(","))
        prefer = "resolution=merge-duplicates,return=representation" if returning else "resolution=merge-duplicates,return=minimal"
        out: list[dict[str, Any]] = []
        for batch in chunks(deduped, 500):
            result = self.request("POST", table, batch, {"on_conflict": conflict}, prefer)
            if returning and isinstance(result, list):
                out.extend(result)
        return out

    def select(self, table: str, query: dict[str, str]) -> list[dict[str, Any]]:
        if self.dry_run and table == "competition_groups":
            season_id = str(query.get("competition_season_id", "")).replace("eq.", "")
            return [{
                "group_id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"competition_groups:{season_id}:Grupo {letter}")),
                "competition_season_id": season_id,
                "stage_id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"stage:{season_id}:GROUP_STAGE")),
                "group_code": f"Grupo {letter}",
                "group_name": f"Grupo {letter}",
                "group_order": index + 1,
            } for index, letter in enumerate("ABCDEFGHIJKL")]
        return self.request("GET", table, None, query)


def dedupe(rows: list[dict[str, Any]], keys: list[str]) -> list[dict[str, Any]]:
    seen: dict[tuple[Any, ...], dict[str, Any]] = {}
    for row in rows:
        seen[tuple(row.get(k) for k in keys)] = row
    return list(seen.values())


def chunks(items: list[dict[str, Any]], size: int) -> Iterable[list[dict[str, Any]]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def load_xlsx(path: str) -> dict[str, list[dict[str, Any]]]:
    try:
        import openpyxl
    except ImportError as exc:
        raise SystemExit("openpyxl is required for --xlsx. Install it or use the bundled Python environment.") from exc

    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    data: dict[str, list[dict[str, Any]]] = {}
    for sheet_name in workbook.sheetnames:
        sheet = workbook[sheet_name]
        rows = list(sheet.iter_rows(values_only=True))
        if not rows:
            data[sheet_name] = []
            continue
        headers = [normalize_header(value) for value in rows[0]]
        records = []
        for values in rows[1:]:
            record = {}
            for index, header in enumerate(headers):
                if not header:
                    continue
                record[header] = values[index] if index < len(values) else None
            if any(value not in (None, "") for value in record.values()):
                records.append(record)
        data[sheet_name] = records
    return data


def load_google_sheet(spreadsheet_id: str, credentials_json: str) -> dict[str, list[dict[str, Any]]]:
    try:
        import gspread
        from google.oauth2.service_account import Credentials
    except ImportError as exc:
        raise SystemExit("Google Sheet input requires optional packages: gspread google-auth") from exc

    scopes = ["https://www.googleapis.com/auth/spreadsheets.readonly"]
    credentials = Credentials.from_service_account_file(credentials_json, scopes=scopes)
    client = gspread.authorize(credentials)
    spreadsheet = client.open_by_key(spreadsheet_id)
    data: dict[str, list[dict[str, Any]]] = {}
    for worksheet in spreadsheet.worksheets():
        values = worksheet.get_all_values()
        if not values:
            data[worksheet.title] = []
            continue
        headers = [normalize_header(value) for value in values[0]]
        records = []
        for raw in values[1:]:
            record = {header: raw[index] if index < len(raw) else None for index, header in enumerate(headers) if header}
            if any(value not in (None, "") for value in record.values()):
                records.append(record)
        data[worksheet.title] = records
    return data


def normalize_header(value: Any) -> str:
    return normalize_text(value).replace(" ", "_")


def get_rows(data: dict[str, list[dict[str, Any]]], sheet_name: str) -> list[dict[str, Any]]:
    return data.get(sheet_name, [])


def migrate(data: dict[str, list[dict[str, Any]]], sb: Supabase, args: argparse.Namespace) -> None:
    print("Ensuring competition catalog")
    competition = sb.upsert(
        "competitions",
        [{
            "slug": args.competition_slug,
            "display_name": "FIFA World Cup",
            "competition_type": "TOURNAMENT",
            "country_code": None,
            "region": "Global",
            "tier": 1,
            "is_international": True,
            "metadata": {"source": SOURCE_NAME, "format": "GROUP_THEN_KNOCKOUT"},
        }],
        "slug",
        returning=True,
    )[0]
    season = sb.upsert(
        "competition_seasons",
        [{
            "competition_id": competition["competition_id"],
            "slug": args.season_slug,
            "season_label": "2026",
            "starts_at": "2026-06-11T00:00:00Z",
            "ends_at": "2026-07-19T23:59:59Z",
            "timezone_name": "UTC",
            "status": "ACTIVE",
            "format_code": "GROUP_THEN_KNOCKOUT",
            "metadata": {"source": SOURCE_NAME, "host_countries": ["US", "MX", "CA"]},
        }],
        "slug",
        returning=True,
    )[0]
    season_id = season["competition_season_id"]

    stages = upsert_stages_and_groups(sb, season_id)
    teams = upsert_teams(sb, data, season_id)
    players = upsert_players_and_rosters(sb, data, season_id, teams)
    venues = upsert_venues(sb, data)
    upsert_matches(sb, data, season_id, stages, teams, venues, args.source_timezone)

    counts = {
        "teams": len(teams),
        "players": len(players),
        "venues": len(venues),
    }
    print(json.dumps({"ok": True, "counts": counts}, indent=2, ensure_ascii=False))


def upsert_stages_and_groups(sb: Supabase, season_id: str) -> dict[str, dict[str, Any]]:
    stage_rows = [
        ("GROUP_STAGE", "Fase de grupos", 1, "GROUP_STAGE"),
        ("ROUND_OF_32", "Dieciseisavos de final", 2, "KNOCKOUT"),
        ("ROUND_OF_16", "Octavos de final", 3, "KNOCKOUT"),
        ("QUARTER_FINAL", "Cuartos de final", 4, "KNOCKOUT"),
        ("SEMI_FINAL", "Semifinal", 5, "KNOCKOUT"),
        ("THIRD_PLACE", "Tercer lugar", 6, "THIRD_PLACE"),
        ("FINAL", "Final", 7, "FINAL"),
    ]
    stages = sb.upsert(
        "competition_stages",
        [{
            "competition_season_id": season_id,
            "stage_code": code,
            "stage_name": name,
            "stage_order": order,
            "stage_type": stage_type,
            "rules": {"source": SOURCE_NAME},
        } for code, name, order, stage_type in stage_rows],
        "competition_season_id,stage_code",
        returning=True,
    )
    by_code = {row["stage_code"]: row for row in stages}
    group_stage_id = by_code["GROUP_STAGE"]["stage_id"]
    sb.upsert(
        "competition_groups",
        [{
            "competition_season_id": season_id,
            "stage_id": group_stage_id,
            "group_code": f"Grupo {letter}",
            "group_name": f"Grupo {letter}",
            "group_order": index + 1,
            "metadata": {"source": SOURCE_NAME},
        } for index, letter in enumerate("ABCDEFGHIJKL")],
        "competition_season_id,stage_id,group_code",
    )
    return by_code


def upsert_teams(sb: Supabase, data: dict[str, list[dict[str, Any]]], season_id: str) -> dict[str, dict[str, Any]]:
    candidates: dict[str, dict[str, Any]] = {}
    for row in get_rows(data, "Clasificacion"):
        name = first_present(row, "equipo")
        if name:
            candidates[team_key(name)] = {"name": name, "group": first_present(row, "grupo"), "source_id": first_present(row, "equipo_id")}
    if not candidates:
        for sheet in ("Equipos", "Partidos", "SourceFixtures", "Planteles"):
            for row in get_rows(data, sheet):
                for name in candidate_team_names(sheet, row):
                    if name and not is_tournament_slot(name):
                        candidates.setdefault(team_key(name), {"name": name, "group": first_present(row, "grupo", "group_name"), "source_id": None})

    rows = []
    for key, item in sorted(candidates.items()):
        display = TEAM_DISPLAY_ES.get(key, display_name_for_team(item["name"]))
        rows.append({
            "slug": slugify(display),
            "team_type": "NATIONAL_TEAM",
            "display_name": display,
            "normalized_name": normalize_text(display),
            "country_code": TEAM_COUNTRY.get(key),
            "gender": "MEN",
            "metadata": {
                "source": SOURCE_NAME,
                "canonical_key": key,
                "names": {"es": display, "en": english_name_for_key(key)},
                "sports_entity": {"fifa_code": TEAM_FIFA.get(key)},
            },
        })
    missing_country = [row["display_name"] for row in rows if not row["country_code"]]
    if missing_country:
        raise SystemExit(f"Teams without ISO country mapping: {missing_country}")
    saved = sb.upsert("teams", rows, "slug", returning=True)
    teams = {row["metadata"]["canonical_key"]: row for row in saved}

    alias_rows = []
    ref_rows = []
    entry_rows = []
    for key, team in teams.items():
        aliases = set(TEAM_ALIASES.get(key, []))
        aliases.add(team["display_name"])
        aliases.add(english_name_for_key(key))
        for alias in aliases:
            if alias:
                alias_rows.append({
                    "team_id": team["team_id"],
                    "alias": alias,
                    "normalized_alias": normalize_text(alias),
                    "language_code": "es" if alias == team["display_name"] else None,
                    "source": SOURCE_NAME,
                    "confidence": 1,
                })
        if TEAM_FIFA.get(key):
            ref_rows.append({
                "entity_type": "TEAM",
                "entity_id": team["team_id"],
                "source": "FIFA",
                "source_entity_type": "association",
                "source_entity_id": TEAM_FIFA[key],
                "source_entity_name": team["display_name"],
                "confidence": 1,
                "is_primary": True,
                "payload": {"source": SOURCE_NAME},
            })
        entry_rows.append({
            "competition_season_id": season_id,
            "team_id": team["team_id"],
            "entry_status": "ACTIVE",
            "metadata": {"source": SOURCE_NAME},
        })
    sb.upsert("team_aliases", alias_rows, "normalized_alias,source")
    sb.upsert("entity_external_refs", ref_rows, "entity_type,source,source_entity_id")
    entries = sb.upsert("competition_team_entries", entry_rows, "competition_season_id,team_id", returning=True)
    entry_by_team = {row["team_id"]: row for row in entries}

    group_rows = sb.select("competition_groups", {"select": "*", "competition_season_id": f"eq.{season_id}"})
    groups = {row["group_code"]: row for row in group_rows}
    membership_rows = []
    for row in get_rows(data, "Clasificacion"):
        key = team_key(first_present(row, "equipo"))
        team = teams.get(key)
        group = groups.get(str(first_present(row, "grupo") or "").strip())
        if team and group:
            membership_rows.append({
                "group_id": group["group_id"],
                "competition_team_entry_id": entry_by_team[team["team_id"]]["competition_team_entry_id"],
                "membership_status": "ACTIVE",
                "seed_position": to_int(first_present(row, "posicion")),
                "metadata": {"source": SOURCE_NAME},
            })
    sb.upsert("competition_group_memberships", membership_rows, "group_id,competition_team_entry_id")

    if len(teams) != 48:
        raise SystemExit(f"Expected 48 teams, got {len(teams)}. Refusing to continue.")
    return teams


def candidate_team_names(sheet: str, row: dict[str, Any]) -> list[Any]:
    if sheet == "Equipos":
        return [first_present(row, "nombre", "equipo", "team", "display_name")]
    if sheet == "Partidos":
        return [first_present(row, "local", "home_team_name"), first_present(row, "visitante", "away_team_name")]
    if sheet == "SourceFixtures":
        return [first_present(row, "home_team_name"), first_present(row, "away_team_name")]
    if sheet == "Planteles":
        return [first_present(row, "equipo")]
    return []


def english_name_for_key(key: str) -> str:
    aliases = TEAM_ALIASES.get(key) or [key]
    return aliases[0].title().replace(" And ", " and ")


def upsert_players_and_rosters(sb: Supabase, data: dict[str, list[dict[str, Any]]], season_id: str, teams: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    player_rows = []
    roster_candidates = []
    for row in get_rows(data, "Planteles"):
        player_name = first_present(row, "jugador", "player_name", "nombre")
        team_name = first_present(row, "equipo", "team")
        if not player_name or not team_name:
            continue
        key = team_key(team_name)
        team = teams.get(key)
        if not team:
            continue
        player_id_source = first_present(row, "player_id", "jugador_id")
        slug = slugify(player_name) if not player_id_source else f"player-api-football-{player_id_source}"
        player_rows.append({
            "slug": slug,
            "display_name": str(player_name).strip(),
            "normalized_name": normalize_text(player_name),
            "nationality_country_code": team["country_code"],
            "gender": "MEN",
            "metadata": {"source": SOURCE_NAME},
        })
        roster_candidates.append((slug, team["team_id"], row))

    saved = sb.upsert("players", player_rows, "slug", returning=True)
    players = {row["slug"]: row for row in saved}
    roster_rows = []
    membership_rows = []
    for slug, team_id, source_row in roster_candidates:
        player = players.get(slug)
        if not player:
            continue
        membership_rows.append({
            "player_id": player["player_id"],
            "team_id": team_id,
            "membership_type": "NATIONAL_TEAM",
            "source": SOURCE_NAME,
            "confidence": 1,
            "metadata": {},
        })
        roster_rows.append({
            "competition_season_id": season_id,
            "team_id": team_id,
            "player_id": player["player_id"],
            "shirt_number": to_int(first_present(source_row, "numero", "number")),
            "position": first_present(source_row, "posicion", "position"),
            "roster_status": "ACTIVE",
            "metadata": {"source": SOURCE_NAME, "role": first_present(source_row, "rol")},
        })
    sb.upsert("team_memberships", membership_rows, "player_id,team_id,membership_type,source")
    sb.upsert("competition_rosters", roster_rows, "competition_season_id,team_id,player_id")
    return players


def upsert_venues(sb: Supabase, data: dict[str, list[dict[str, Any]]]) -> dict[str, dict[str, Any]]:
    venues: dict[str, dict[str, Any]] = {}
    for row in get_rows(data, "Partidos"):
        name = first_present(row, "estadio", "venue_name")
        if not name:
            continue
        slug = slugify(name)
        venues[slug] = {
            "slug": slug,
            "display_name": str(name).strip(),
            "city": first_present(row, "ciudad", "venue_city"),
            "country_code": normalize_country_from_text(first_present(row, "pais_estadio", "pais", "country_code")),
            "timezone_name": first_present(row, "timezone_estadio") or None,
            "latitude": first_present(row, "lat"),
            "longitude": first_present(row, "lon"),
            "metadata": {"source": SOURCE_NAME},
        }
    saved = sb.upsert("venues", list(venues.values()), "slug", returning=True)
    return {row["slug"]: row for row in saved}


def normalize_country_from_text(value: Any) -> str | None:
    if not value:
        return None
    text = normalize_text(value).replace(" ", "")
    return {
        "usa": "US",
        "unitedstates": "US",
        "estadosunidos": "US",
        "mexico": "MX",
        "canada": "CA",
    }.get(text)


def upsert_matches(
    sb: Supabase,
    data: dict[str, list[dict[str, Any]]],
    season_id: str,
    stages: dict[str, dict[str, Any]],
    teams: dict[str, dict[str, Any]],
    venues: dict[str, dict[str, Any]],
    source_tz: str,
) -> None:
    group_rows = sb.select("competition_groups", {"select": "*", "competition_season_id": f"eq.{season_id}"})
    groups = {row["group_code"]: row for row in group_rows}

    match_rows = []
    participant_specs = []
    slot_rows_by_code: dict[str, dict[str, Any]] = {}
    for row in get_rows(data, "Partidos"):
        home_raw = first_present(row, "local", "home_team_name")
        away_raw = first_present(row, "visitante", "away_team_name")
        kickoff = parse_datetime(row, source_tz)
        if not home_raw or not away_raw or not kickoff:
            continue
        stage_code = stage_code_from_row(row)
        group = groups.get(str(first_present(row, "grupo", "group_name") or "").strip())
        venue_slug = slugify(first_present(row, "estadio", "venue_name")) if first_present(row, "estadio", "venue_name") else None
        slug = slugify(first_present(row, "match_id", "match_key") or f"{kickoff}-{home_raw}-{away_raw}")
        match_rows.append({
            "competition_season_id": season_id,
            "stage_id": stages[stage_code]["stage_id"],
            "group_id": group["group_id"] if group else None,
            "venue_id": venues.get(venue_slug, {}).get("venue_id") if venue_slug else None,
            "slug": slug,
            "match_number": to_int(first_present(row, "match_number", "matchday")),
            "kickoff_at": kickoff,
            "status": match_status(first_present(row, "status")),
            "is_neutral": True,
            "home_score": to_int(first_present(row, "goles_local", "home_score")),
            "away_score": to_int(first_present(row, "goles_visitante", "away_score")),
            "metadata": {"source": SOURCE_NAME},
        })
        participant_specs.append((slug, "HOME", home_raw, to_int(first_present(row, "goles_local", "home_score")), stage_code, group))
        participant_specs.append((slug, "AWAY", away_raw, to_int(first_present(row, "goles_visitante", "away_score")), stage_code, group))
        for raw in (home_raw, away_raw):
            if is_tournament_slot(raw):
                code = slot_code(raw)
                slot_rows_by_code[code] = {
                    "competition_season_id": season_id,
                    "stage_id": stages[stage_code]["stage_id"],
                    "slot_code": code,
                    "slot_label": str(raw).strip(),
                    "slot_type": infer_slot_type(raw),
                    "source_group_id": group["group_id"] if group else None,
                    "metadata": {"source": SOURCE_NAME},
                }

    saved_matches = sb.upsert("matches", match_rows, "slug", returning=True)
    matches = {row["slug"]: row for row in saved_matches}
    saved_slots = sb.upsert("tournament_slots", list(slot_rows_by_code.values()), "competition_season_id,slot_code", returning=True)
    slots = {row["slot_code"]: row for row in saved_slots}
    participant_rows = []
    for match_slug, side, raw, score, _stage_code, _group in participant_specs:
        match = matches.get(match_slug)
        if not match:
            continue
        if is_tournament_slot(raw):
            slot = slots.get(slot_code(raw))
            if not slot:
                continue
            participant_rows.append({
                "match_id": match["match_id"],
                "side": side,
                "participant_role": "SLOT",
                "tournament_slot_id": slot["tournament_slot_id"],
                "is_home_designation": side == "HOME",
                "score": score,
                "metadata": {"source": SOURCE_NAME, "raw_name": raw},
            })
        else:
            team = teams.get(team_key(raw))
            if not team:
                continue
            participant_rows.append({
                "match_id": match["match_id"],
                "side": side,
                "participant_role": "TEAM",
                "team_id": team["team_id"],
                "is_home_designation": side == "HOME",
                "score": score,
                "metadata": {"source": SOURCE_NAME, "raw_name": raw},
            })
    sb.upsert("match_participants", participant_rows, "match_id,side")


def stage_code_from_row(row: dict[str, Any]) -> str:
    raw = normalize_text(first_present(row, "fase", "stage", "round") or "")
    if "group" in raw or "grupo" in raw:
        return "GROUP_STAGE"
    if "32" in raw or "dieciseis" in raw:
        return "ROUND_OF_32"
    if "16" in raw or "octav" in raw:
        return "ROUND_OF_16"
    if "quarter" in raw or "cuarto" in raw:
        return "QUARTER_FINAL"
    if "semi" in raw:
        return "SEMI_FINAL"
    if "third" in raw or "tercer" in raw:
        return "THIRD_PLACE"
    if "final" in raw:
        return "FINAL"
    return "GROUP_STAGE"


def match_status(value: Any) -> str:
    raw = normalize_text(value)
    if raw in {"ft", "finished", "finalizado"}:
        return "FINISHED"
    if raw in {"live", "inplay", "ht"}:
        return "LIVE"
    if raw in {"postponed"}:
        return "POSTPONED"
    if raw in {"cancelled", "canceled"}:
        return "CANCELLED"
    return "SCHEDULED"


def infer_slot_type(value: Any) -> str:
    raw = normalize_text(value)
    if "third place group" in raw:
        return "BEST_THIRD"
    if "winner" in raw:
        return "WINNER"
    if "loser" in raw:
        return "LOSER"
    if "2nd" in raw or "second" in raw:
        return "GROUP_RUNNER_UP"
    return "STRUCTURAL"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Migrate WC2026 workbook/Google Sheet to clean Supabase schema.")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--xlsx", help="Path to exported workbook.")
    source.add_argument("--google-spreadsheet-id", help="Google Sheet ID.")
    parser.add_argument("--google-credentials-json", help="Service account JSON for Google Sheets input.")
    parser.add_argument("--supabase-url", default=os.environ.get("SUPABASE_URL"))
    parser.add_argument("--supabase-key", default=os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY"))
    parser.add_argument("--season-slug", default=DEFAULT_SEASON_SLUG)
    parser.add_argument("--competition-slug", default=DEFAULT_COMPETITION_SLUG)
    parser.add_argument("--source-timezone", default=DEFAULT_SOURCE_TZ)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--sleep-seconds", type=float, default=0.0)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not args.supabase_url or not args.supabase_key:
        raise SystemExit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SUPABASE_KEY.")
    if args.google_spreadsheet_id and not args.google_credentials_json:
        raise SystemExit("--google-credentials-json is required with --google-spreadsheet-id.")
    data = load_xlsx(args.xlsx) if args.xlsx else load_google_sheet(args.google_spreadsheet_id, args.google_credentials_json)
    sb = Supabase(args.supabase_url, args.supabase_key, args.dry_run, args.sleep_seconds)
    migrate(data, sb, args)


if __name__ == "__main__":
    main()
