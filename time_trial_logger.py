#!/usr/bin/env python3
"""Capture CTR Nitro-Fueled Time Trial results alongside last_run metadata."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import sys
import threading
import time
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

PROJECT_ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
USER_DATA_DIR = (
    Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local")) / "CTRNF" / "data"
    if getattr(sys, "frozen", False)
    else PROJECT_ROOT / "data"
)


def _configured_log_path() -> Path | None:
    config_path = USER_DATA_DIR / "settings.json"
    try:
        configured = json.loads(config_path.read_text(encoding="utf-8")).get("log_path", "")
        return Path(configured).expanduser() if configured else None
    except (OSError, ValueError, AttributeError):
        return None


DEFAULT_LOG = _configured_log_path() or Path("last_run.log")
CSV_PATH = USER_DATA_DIR / "time_trials.csv"
RALLY_RING_CSV_PATH = USER_DATA_DIR / "rally_ring.csv"
SKINS_CSV_PATH = PROJECT_ROOT / "data" / "game_skins.csv"
CHARACTERS_CSV_PATH = PROJECT_ROOT / "data" / "game_characters.csv"
TRACKS_CSV_PATH = PROJECT_ROOT / "data" / "game_tracks.csv"
ACHIEVEMENTS_CSV_PATH = PROJECT_ROOT / "data" / "achievements.csv"
STORE_CATALOG_PATH = PROJECT_ROOT / "data" / "store" / "store.json"
STORE_WALLET_PATH = USER_DATA_DIR / "store" / "wallet.csv"
WEEKEND_WUMPA_MULTIPLIER = 2
BASE_WUMPAS = 5000
WUMPACOIN_ICON = "/wumpacoin.webp"
ACHIEVEMENT_ICON_DIR = PROJECT_ROOT / "utils" / "achievements"
_ACHIEVEMENT_ICON_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".jfif")
CATALOG_IMAGE_DIR = PROJECT_ROOT / "web" / "catalog"
_CATALOG_IMAGE_EXTENSIONS = (".webp", ".png", ".jpg", ".jpeg", ".gif", ".avif")
_CATALOG_IMAGE_FIELDS = ("url", "url_mask", "url_character", "dev_url")
MASK_CLUBS = ("Aku Aku", "Uka Uka", "Velo", "Sparx")
# Stacked in skin order. Basic 500,000, then Exotic 2,000,000, Legendary 5,000,000, Beenox 10,000,000, Ultra 20,000,000.
UNLOCK_COST = {"basic": 500_000, "exotic": 2_000_000, "legendary": 5_000_000, "beenox": 10_000_000, "ultra": 20_000_000}
# Added to the global multiplier. 1 milli = 0.001, so the next score is ×1.001.
BONUS_MILLI = {"basic": 1, "exotic": 2, "legendary": 3, "beenox": 5, "ultra": 10}
_rally_lock = threading.Lock()
_store_lock = threading.RLock()
WALLET_FIELDS = ("id", "kind", "mode", "race_id", "item_id", "coins", "captured_at")
CSV_FIELDS = (
    "id",
    "track_id",
    "track",
    "skin_id",
    "skin",
    "time_raw",
    "time_seconds",
    "pb",
    "delta_pb",
    "captured_at",
)

TRACK_RE = re.compile(r"LOADING LEVEL:\s*['\"]([^'\"]+)['\"]", re.IGNORECASE)
MENU_TRACK_PARTS = {"octane_startscreen"}
CHARACTER_PATTERNS = (
    # Only player 0 is the local racer; ghost replay data can load other IDs
    # (for example playerid:2) and must not replace the selected character.
    re.compile(r"Loading hero\s+\S+\s+\[([^\]]+)\]\s+in\s+pool\S+\s+forPlayID:0\b", re.IGNORECASE),
    re.compile(r"changeHeroAndOutfit\s+\[0\]\s+\[[^\]]*\]\s+\[([^\]]+)\]", re.IGNORECASE),
)
TIME_RE = re.compile(r"^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,2}))?\s*$")


def parse_time(raw: str) -> float:
    """Convert M:SS:CC, M:SS.CC, or SS.CC into seconds."""
    value = raw.strip()
    parts = value.split(":")
    if len(parts) == 3:
        minutes_s, seconds_s, centiseconds_s = parts
        if not (minutes_s.isdigit() and seconds_s.isdigit() and centiseconds_s.isdigit()):
            raise ValueError("use M:SS:CC, M:SS.CC, or SS.CC")
        minutes, seconds, centiseconds = map(int, (minutes_s, seconds_s, centiseconds_s))
    else:
        match = TIME_RE.fullmatch(value)
        if not match:
            raise ValueError("use M:SS:CC, M:SS.CC, or SS.CC")
        minutes_s, seconds_s, fraction_s = match.groups()
        minutes = int(minutes_s or 0)
        seconds = int(seconds_s)
        if fraction_s is None:
            raise ValueError("missing the hundredths (for example 1:20.99)")
        centiseconds = int(fraction_s.ljust(2, "0"))
    if seconds > 59 or centiseconds > 99:
        raise ValueError("seconds must be 00–59 and hundredths 00–99")
    return minutes * 60 + seconds + centiseconds / 100


def extract_metadata(line: str, state: dict[str, str]) -> None:
    track = TRACK_RE.search(line)
    if track:
        candidate = track.group(1).strip()
        # The game emits a StartScreen level after leaving a race/menu; it is
        # not a track and must not replace the last actual course.
        parts = {part.casefold() for part in candidate.split("/")}
        if not parts.intersection(MENU_TRACK_PARTS):
            state["track"] = candidate
    for pattern in CHARACTER_PATTERNS:
        skin = pattern.search(line)
        if skin and skin.group(1).strip().casefold() not in {"none", "null"}:
            state["skin"] = skin.group(1).strip()
            break


def next_id(path: Path) -> int:
    if not path.exists() or path.stat().st_size == 0:
        return 1
    delimiter = csv_delimiter(path)
    with path.open("r", newline="", encoding="utf-8-sig") as csv_file:
        rows = csv.DictReader(csv_file, delimiter=delimiter)
        ids = [int(row["id"]) for row in rows if row.get("id", "").isdigit()]
    return max(ids, default=0) + 1


def entity_ids(path: Path, field: str) -> dict[str, int]:
    """Assign stable 1-based IDs in first-seen order for distinct values."""
    found: dict[str, int] = {}
    if not path.exists() or path.stat().st_size == 0:
        return found
    delimiter = csv_delimiter(path)
    with path.open("r", newline="", encoding="utf-8-sig") as csv_file:
        reader = csv.DictReader(csv_file, delimiter=delimiter)
        if not reader.fieldnames or field not in reader.fieldnames:
            raise ValueError(
                "this CSV uses an older layout; delete or rename it before saving"
            )
        id_field = f"{field}_id"
        for row in reader:
            value = row.get(field, "")
            raw_id = row.get(id_field, "")
            if value and raw_id.isdigit():
                found[value] = int(raw_id)
    return found


def csv_delimiter(path: Path) -> str:
    if not path.exists() or path.stat().st_size == 0:
        return ","
    with path.open("r", encoding="utf-8-sig", newline="") as csv_file:
        header = csv_file.readline()
    return ";" if header.count(";") > header.count(",") else ","


def ensure_pb_column(path: Path) -> dict[str, float]:
    """Backfill historical per-track PB flags and return each track's best time."""
    if not path.exists() or path.stat().st_size == 0:
        return {}
    delimiter = csv_delimiter(path)
    with path.open("r", newline="", encoding="utf-8-sig") as csv_file:
        reader = csv.DictReader(csv_file, delimiter=delimiter)
        fieldnames = list(reader.fieldnames or [])
        rows = list(reader)
    if not fieldnames or "track" not in fieldnames or "time_seconds" not in fieldnames:
        raise ValueError("El CSV de tiempos no tiene columnas track y time_seconds.")

    best_by_track: dict[str, float] = {}
    if "pb" not in fieldnames:
        flags: dict[int, str] = {}
        ordered = sorted(
            enumerate(rows),
            key=lambda pair: int(pair[1].get("id", "")) if pair[1].get("id", "").isdigit() else pair[0],
        )
        for index, row in ordered:
            track = (row.get("track") or "").strip()
            try:
                seconds = float(row.get("time_seconds", ""))
            except (TypeError, ValueError):
                flags[index] = "0"
                continue
            if not track or track.casefold() in {"null", "none"}:
                flags[index] = "0"
                continue
            previous = best_by_track.get(track)
            if previous is None or seconds < previous:
                flags[index] = "1"
                best_by_track[track] = seconds
            else:
                flags[index] = "0"

        if "captured_at" in fieldnames:
            fieldnames.insert(fieldnames.index("captured_at"), "pb")
        else:
            fieldnames.append("pb")
        temp_path = path.with_suffix(path.suffix + ".tmp")
        with temp_path.open("w", newline="", encoding="utf-8-sig") as csv_file:
            writer = csv.DictWriter(csv_file, fieldnames=fieldnames, delimiter=delimiter)
            writer.writeheader()
            for index, row in enumerate(rows):
                updated = {field: row.get(field, "") for field in fieldnames}
                updated["pb"] = flags.get(index, "0")
                writer.writerow(updated)
        os.replace(temp_path, path)
    else:
        for row in rows:
            track = (row.get("track") or "").strip()
            try:
                seconds = float(row.get("time_seconds", ""))
            except (TypeError, ValueError):
                continue
            if track and track.casefold() not in {"null", "none"}:
                best_by_track[track] = min(seconds, best_by_track.get(track, seconds))
    return best_by_track


def ensure_delta_pb_column(path: Path) -> None:
    """Backfill each attempt's delta from the PB that existed before it."""
    if not path.exists() or path.stat().st_size == 0:
        return
    delimiter = csv_delimiter(path)
    with path.open("r", newline="", encoding="utf-8-sig") as csv_file:
        reader = csv.DictReader(csv_file, delimiter=delimiter)
        fieldnames = list(reader.fieldnames or [])
        rows = list(reader)
    if not fieldnames or "track" not in fieldnames or "time_seconds" not in fieldnames:
        raise ValueError("El CSV de tiempos no tiene columnas track y time_seconds.")
    if "delta_pb" in fieldnames:
        return

    previous_best: dict[str, float] = {}
    deltas: dict[int, str] = {}
    ordered = sorted(
        enumerate(rows),
        key=lambda pair: int(pair[1].get("id", "")) if pair[1].get("id", "").isdigit() else pair[0],
    )
    for index, row in ordered:
        track = (row.get("track") or "").strip()
        try:
            seconds = float(row.get("time_seconds", ""))
        except (TypeError, ValueError):
            deltas[index] = ""
            continue
        if not track or track.casefold() in {"null", "none"}:
            deltas[index] = ""
            continue
        prior_pb = previous_best.get(track)
        deltas[index] = f"{(seconds - prior_pb) if prior_pb is not None else 0.0:.2f}"
        if prior_pb is None or seconds < prior_pb:
            previous_best[track] = seconds

    if "captured_at" in fieldnames:
        fieldnames.insert(fieldnames.index("captured_at"), "delta_pb")
    else:
        fieldnames.append("delta_pb")
    temp_path = path.with_suffix(path.suffix + ".tmp")
    with temp_path.open("w", newline="", encoding="utf-8-sig") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=fieldnames, delimiter=delimiter)
        writer.writeheader()
        for index, row in enumerate(rows):
            updated = {field: row.get(field, "") for field in fieldnames}
            updated["delta_pb"] = deltas.get(index, "")
            writer.writerow(updated)
    os.replace(temp_path, path)


def save_record(track: str, skin: str, raw_time: str, csv_path: Path) -> dict[str, str]:
    seconds = parse_time(raw_time)
    ensure_possible_time(track, seconds)
    best_by_track = ensure_pb_column(csv_path)
    ensure_delta_pb_column(csv_path)
    track = (track or "").strip()
    skin = (skin or "").strip()
    if not track or track.casefold() in {"null", "none"}:
        track, track_id = "null", ""
    else:
        track_ids = entity_ids(csv_path, "track")
        track_id = str(track_ids.get(track, max(track_ids.values(), default=0) + 1))
    if not skin or skin.casefold() in {"null", "none"}:
        skin, skin_id = "null", ""
    else:
        skin_ids = entity_ids(csv_path, "skin")
        skin_id = str(skin_ids.get(skin, max(skin_ids.values(), default=0) + 1))
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    needs_header = not csv_path.exists() or csv_path.stat().st_size == 0
    prior_pb = best_by_track.get(track) if track and track.casefold() not in {"null", "none"} else None
    record = {
        "id": str(next_id(csv_path)),
        "track_id": track_id,
        "track": track,
        "skin_id": skin_id,
        "skin": skin,
        "time_raw": raw_time.strip(),
        "time_seconds": f"{seconds:.2f}",
        "pb": "1" if track and track.casefold() not in {"null", "none"} and (track not in best_by_track or seconds < best_by_track[track]) else "0",
        "delta_pb": f"{seconds - prior_pb:.2f}" if prior_pb is not None else ("0.00" if track and track.casefold() not in {"null", "none"} else ""),
        "captured_at": datetime.now().astimezone().isoformat(timespec="seconds"),
    }
    with csv_path.open("a", newline="", encoding="utf-8-sig") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=CSV_FIELDS)
        if needs_header:
            writer.writeheader()
        writer.writerow(record)
    coin_breakdown = {}
    record["wumpas"] = str(credit_race_coins("time_trial", record["id"], record["track"], record["captured_at"], coin_breakdown))
    record["wumpa_breakdown"] = coin_breakdown
    return record


RALLY_FIELDS = (
    "id",
    "track_id",
    "track",
    "skin_id",
    "skin",
    "score",
    "laps",
    "pb",
    "delta_pb",
    "score_mult",
    "multiplier",
    "notes",
    "captured_at",
)


def parse_score(raw: str) -> int:
    value = raw.strip()
    if not re.fullmatch(r"\d+", value):
        raise ValueError("enter a whole score, no decimals (e.g. 100452)")
    return int(value)


def parse_laps(raw: str) -> int:
    value = raw.strip()
    if not re.fullmatch(r"\d+", value):
        raise ValueError("enter the lap count as a whole number")
    return int(value)


def scaled_score(score: int, bonus_milli: int) -> int:
    """Return score × (1 + bonus_milli/1000), rounded half up."""
    if bonus_milli <= 0:
        return score
    return (score * (1000 + bonus_milli) + 500) // 1000


def _display_skin_name(value: str, fallback: str) -> str:
    text = (value or "").strip() or fallback
    if len(text) >= 2 and text[0] == text[-1] == '"':
        text = text[1:-1]
    return text or fallback


def _track_catalog_row(track: str) -> dict[str, str]:
    key = (track or "").strip()
    if not key or key.casefold() in {"null", "none"}:
        return {}
    for row in _read_table(TRACKS_CSV_PATH):
        if (row.get("track") or "").strip() == key:
            return row
    return {}


def _csv_centis(raw: str) -> int | None:
    text = (raw or "").strip().replace(" ", "").replace(",", ".")
    if not text:
        return None
    try:
        return int((Decimal(text) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    except Exception:
        return None


def _centis_from_seconds(seconds: float) -> int:
    return int((Decimal(str(seconds)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)) * 100)


def _clock_from_centis(total: int) -> str:
    minutes, rest = divmod(total, 6_000)
    seconds, frac = divmod(rest, 100)
    return f"{minutes}:{seconds:02d}:{frac:02d}"


def _csv_int(raw: str) -> int | None:
    text = (raw or "").strip().replace(" ", "")
    if not text.isdigit():
        return None
    return int(text)


def ensure_possible_time(track: str, seconds: float) -> None:
    """Reject a time at or below the track's published threshold."""
    row = _track_catalog_row(track)
    limit = _csv_centis(row.get("time_threshold") or "")
    if limit is None or _centis_from_seconds(seconds) > limit:
        return
    name = (row.get("track_clean") or "").strip() or "this track"
    raise ValueError(f"That time can't be saved. The limit for {name} is {_clock_from_centis(limit)}.")


def ensure_possible_score(track: str, score: int) -> None:
    """Reject a Ring Rally score at or above the track's published threshold."""
    row = _track_catalog_row(track)
    limit = _csv_int(row.get("score_threshold") or "")
    if limit is None or score < limit:
        return
    name = (row.get("track_clean") or "").strip() or "this track"
    raise ValueError(f"That score can't be saved. The limit for {name} is {limit:,}.")


def _read_table(path: Path) -> list[dict[str, str]]:
    if not path.exists() or path.stat().st_size == 0:
        return []
    with path.open("r", newline="", encoding="utf-8-sig") as source:
        header = source.readline()
        delimiter = ";" if header.count(";") > header.count(",") else ","
        source.seek(0)
        return [localize_image_fields(row) for row in csv.DictReader(source, delimiter=delimiter)]


def load_rally_catalog(
    skins_path: Path = SKINS_CSV_PATH,
    characters_path: Path = CHARACTERS_CSV_PATH,
    tracks_path: Path = TRACKS_CSV_PATH,
    achievements_path: Path = ACHIEVEMENTS_CSV_PATH,
) -> dict:
    """Skins grouped by character_id, ordered by skin_id, with cumulative unlock costs."""
    skin_by_name: dict[str, dict[str, str]] = {}
    grouped: dict[str, list[dict[str, str]]] = {}
    for row in _read_table(skins_path):
        name = (row.get("skin") or "").strip()
        if name:
            skin_by_name[name] = row
        character_id = (row.get("character_id") or "").strip()
        if character_id:
            grouped.setdefault(character_id, []).append(row)

    ladders: dict[str, list[dict]] = {}
    for character_id, group in grouped.items():
        ordered = sorted(
            group,
            key=lambda row: int(row["skin_id"]) if str(row.get("skin_id", "")).strip().isdigit() else 10**9,
        )
        total = 0
        steps: list[dict] = []
        for row in ordered:
            kind = (row.get("skin_type") or "").strip().casefold()
            cost = UNLOCK_COST.get(kind)
            bonus = BONUS_MILLI.get(kind)
            if cost is None or bonus is None:
                label = (row.get("skin_type") or "").strip() or "(vacío)"
                raise ValueError(f"skin_type no reconocido en game_skins.csv: {label}")
            total += cost
            raw_name = (row.get("skin") or "").strip()
            steps.append(
                {
                    "skin_id": (row.get("skin_id") or "").strip(),
                    "skin": raw_name,
                    "skin_name": _display_skin_name(row.get("skin_name") or "", raw_name),
                    "skin_type": (row.get("skin_type") or "").strip(),
                    "url": (row.get("url") or "").strip(),
                    "character": (row.get("character") or "").strip(),
                    "character_id": character_id,
                    "cost": cost,
                    "threshold": total,
                    "bonus_milli": bonus,
                }
            )
        ladders[character_id] = steps

    characters: dict[str, dict[str, str]] = {}
    characters_by_game: dict[str, list[str]] = {}
    for row in _read_table(characters_path):
        character_id = (row.get("character_id") or "").strip()
        if not character_id:
            continue
        characters[character_id] = row
        game = (row.get("game_base") or "").strip().casefold()
        if game:
            characters_by_game.setdefault(game, []).append(character_id)
    tracks: dict[str, dict[str, str]] = {}
    tracks_by_game: dict[str, list[str]] = {}
    for row in _read_table(tracks_path):
        track = (row.get("track") or "").strip()
        if not track:
            continue
        tracks[track] = row
        game = (row.get("track_game") or "").strip().casefold()
        if game:
            tracks_by_game.setdefault(game, []).append(track)
    return {
        "skin_by_name": skin_by_name,
        "ladders": ladders,
        "characters": characters,
        "characters_by_game": characters_by_game,
        "tracks": tracks,
        "tracks_by_game": tracks_by_game,
        "achievements": _load_achievements(achievements_path),
    }


def _character_id(skin: str, catalog: dict) -> str:
    row = catalog["skin_by_name"].get((skin or "").strip())
    if not row:
        return ""
    return (row.get("character_id") or "").strip()


def _points_by_character(rows: list[dict[str, str]], catalog: dict) -> dict[str, int]:
    totals: dict[str, int] = {}
    for row in rows:
        character_id = _character_id(row.get("skin", ""), catalog)
        if not character_id:
            continue
        try:
            amount = int((row.get("score_mult") or "0").strip() or "0")
        except ValueError:
            continue
        totals[character_id] = totals.get(character_id, 0) + amount
    return totals


def _milli_for_points(catalog: dict, points_by: dict[str, int]) -> int:
    """Bonus from every unlocked skin, across all characters."""
    total = 0
    for character_id, ladder in catalog["ladders"].items():
        points = points_by.get(character_id, 0)
        total += sum(step["bonus_milli"] for step in ladder if step["threshold"] <= points)
    return total


def _unlock_notes(steps: list[dict]) -> str:
    if not steps:
        return ""
    parts = [f"{step['skin_name']} ({step['skin_type']})" for step in steps]
    if len(parts) == 1:
        return f"Unlock: {parts[0]}"
    return "Unlock: " + ", ".join(parts)


def _progress_notes(steps: list[dict], trophies: list[dict]) -> str:
    parts = []
    skin_note = _unlock_notes(steps)
    if skin_note:
        parts.append(skin_note)
    if trophies:
        names = [item["name"] for item in trophies]
        label = "Trophy" if len(names) == 1 else "Trophies"
        parts.append(f"{label}: " + ", ".join(names))
    return " · ".join(parts)


def _parse_milli(raw: str) -> int:
    text = (raw or "").strip().replace(" ", "").replace(",", ".")
    if not text:
        return 0
    try:
        value = (Decimal(text) * 1000).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    except Exception as exc:
        raise ValueError(f"bonus de achievement no numérico: {raw}") from exc
    return int(value)


def _parse_goal_int(raw: str) -> int:
    text = (raw or "").strip().replace(" ", "")
    if not text:
        return 0
    if not text.isdigit():
        raise ValueError(f"meta de achievement no entera: {raw}")
    return int(text)


def _mask_clubs(mask: str) -> set[str]:
    """Aku Aku/Uka Uka counts for both clubs. Any counts for every club."""
    text = (mask or "").strip()
    if not text:
        return set()
    if text.casefold() == "any":
        return set(MASK_CLUBS)
    clubs: set[str] = set()
    for part in text.split("/"):
        token = part.strip()
        folded = token.casefold()
        if not token:
            continue
        if folded == "any":
            return set(MASK_CLUBS)
        for club in MASK_CLUBS:
            club_folded = club.casefold()
            if club_folded in folded or folded in club_folded:
                clubs.add(club)
    return clubs


def _club_from_note(notes: str) -> str:
    match = re.search(r"with\s+(.+?)\s+mask", notes, re.IGNORECASE)
    phrase = match.group(1).strip() if match else ""
    for club in MASK_CLUBS:
        folded = phrase.casefold()
        if club.casefold() in folded or folded in club.casefold():
            return club
    raise ValueError(f"máscara de achievement no reconocida: {notes}")


def is_mod_track(row: dict[str, str] | None) -> bool:
    """Community tracks are Time Trial only and stay out of the 40-track trophies."""
    return ((row or {}).get("track_game") or "").strip().casefold() == "mod"


def _is_time_trial_mode(game_mode: str) -> bool:
    folded = (game_mode or "").casefold()
    return "time trial" in folded or "contrarreloj" in folded


def _is_bonus_mode(game_mode: str) -> bool:
    return (game_mode or "").strip().casefold() == "bonus"


def _classify_time_trial(name: str, notes: str, goal_raw: str) -> dict:
    """Contrarreloj rows share some notes with Ring Rally, so the mode decides first."""
    notes_cf = notes.casefold().strip()
    name_cf = name.casefold()
    if notes_cf == "any combination":
        return {"kind": "time_trials", "goal": _parse_goal_int(goal_raw)}
    if "any track" in notes_cf:
        return {"kind": "dev_tracks", "goal": _parse_goal_int(goal_raw) or 1}
    if "all tracks" in notes_cf and "velo" in name_cf:
        return {"kind": "velo_tracks", "goal": _parse_goal_int(goal_raw)}
    if "all tracks" in notes_cf:
        return {"kind": "dev_tracks", "goal": _parse_goal_int(goal_raw)}
    raise ValueError(f"notes de achievement de Contrarreloj no reconocidas: {notes or '(vacío)'}")


def _classify_bonus(notes: str, goal_raw: str) -> dict:
    notes_cf = notes.casefold().strip()
    if "mod" in notes_cf and "track" in notes_cf:
        return {"kind": "mod_tracks", "goal": _parse_goal_int(goal_raw) or 1}
    raise ValueError(f"notes de achievement bonus no reconocidas: {notes or '(vacío)'}")


def _classify_achievement(name: str, notes: str, goal_raw: str, game_mode: str = "") -> dict:
    notes_cf = notes.casefold().strip()
    name_cf = name.casefold()
    if _is_time_trial_mode(game_mode):
        return _classify_time_trial(name, notes, goal_raw)
    if _is_bonus_mode(game_mode):
        return _classify_bonus(notes, goal_raw)
    if "unlock all" in notes_cf and "achievement" in notes_cf:
        return {"kind": "platinum"}
    if notes_cf.startswith("multiplier"):
        return {"kind": "multiplier", "goal_milli": _parse_milli(goal_raw)}
    if "single character" in notes_cf:
        return {"kind": "character_points", "goal": _parse_goal_int(goal_raw)}
    if "base points" in notes_cf and "mask" in notes_cf:
        return {"kind": "mask_points", "goal": _parse_goal_int(goal_raw), "club": _club_from_note(notes)}
    if notes_cf == "laps":
        return {"kind": "laps", "goal": _parse_goal_int(goal_raw)}
    if notes_cf == "any combination":
        return {"kind": "races", "goal": _parse_goal_int(goal_raw)}
    if notes_cf == "any skins":
        return {"kind": "skin_count", "goal": _parse_goal_int(goal_raw)}
    if notes_cf == "all skins":
        return {"kind": "all_skins"}
    if notes_cf in {"basic", "exotic", "legendary", "beenox", "ultra"}:
        return {"kind": "skin_type", "skin_type": notes.strip()}
    if "base points" in notes_cf and "race" in name_cf:
        return {"kind": "single_race", "goal": _parse_goal_int(goal_raw)}
    if "base points" in notes_cf:
        return {"kind": "total_points", "goal": _parse_goal_int(goal_raw)}
    if "track" in name_cf:
        return {"kind": "all_tracks", "game": notes.strip()}
    if "character" in name_cf:
        return {"kind": "all_characters", "game": notes.strip()}
    raise ValueError(f"notes de achievement no reconocidas: {notes or '(vacío)'}")


def catalog_image_stem(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]


def catalog_image_url(url: str) -> str:
    """Usa la copia en web/catalog cuando existe. Si no, conserva la URL original."""

    raw = (url or "").strip()
    if not raw.startswith(("http://", "https://")):
        return raw
    stem = catalog_image_stem(raw)
    for extension in _CATALOG_IMAGE_EXTENSIONS:
        if (CATALOG_IMAGE_DIR / f"{stem}{extension}").is_file():
            return f"/catalog/{stem}{extension}"
    return raw


def localize_image_fields(row: dict[str, str]) -> dict[str, str]:
    for field in _CATALOG_IMAGE_FIELDS:
        value = (row.get(field) or "").strip()
        if value:
            row[field] = catalog_image_url(value)
    return row


def catalog_image_file(name: str) -> Path | None:
    if not name or name != Path(name).name:
        return None
    suffix = Path(name).suffix.lower()
    stem = Path(name).stem
    if suffix not in _CATALOG_IMAGE_EXTENSIONS or re.fullmatch(r"[0-9a-f]{16}", stem) is None:
        return None
    target = (CATALOG_IMAGE_DIR / name).resolve()
    root = CATALOG_IMAGE_DIR.resolve()
    if target.parent != root or not target.is_file():
        return None
    return target


def achievement_icon_url(achievement_id: str, fallback: str) -> str:
    """Local file utils/achievements/{id}.ext wins. The CSV url is the fallback."""
    token = (achievement_id or "").strip()
    if not token or any(mark in token for mark in ("/", "\\", "..")):
        return fallback
    for extension in _ACHIEVEMENT_ICON_EXTENSIONS:
        if (ACHIEVEMENT_ICON_DIR / f"{token}{extension}").is_file():
            return f"/achievements/{token}{extension}"
    return fallback


def _load_achievements(path: Path) -> list[dict]:
    if not path.exists() or path.stat().st_size == 0:
        return []
    achievements = []
    for row in _read_table(path):
        name = (row.get("name") or "").strip()
        if not name:
            continue
        notes = (row.get("notes") or "").strip()
        goal_raw = (row.get("goal") or "").strip()
        game_mode = (row.get("game_mode") or "").strip()
        try:
            kind = _classify_achievement(name, notes, goal_raw, game_mode)
        except ValueError:
            continue
        tier = (row.get("type") or "").strip()
        achievements.append(
            {
                "id": (row.get("id") or "").strip(),
                "name": name,
                "notes": notes,
                "description": (row.get("description_en") or row.get("description") or "").strip(),
                "game_mode": game_mode,
                "type": tier,
                "tier": tier,
                "milli": _parse_milli(row.get("mult") or ""),
                "url": achievement_icon_url((row.get("id") or "").strip(), (row.get("url") or "").strip()),
                **kind,
            }
        )
    return achievements


def _cell_int(row: dict[str, str], field: str) -> int:
    try:
        return int((row.get(field) or "").strip() or "0")
    except (TypeError, ValueError):
        return 0


def _blank_stats() -> dict:
    return {
        "base_points": 0,
        "max_score": 0,
        "laps": 0,
        "races": 0,
        "tracks": set(),
        "characters": set(),
        "points_by": {},
        "base_by_character": {},
        "base_by_club": {},
        "tt_races": 0,
        "velo_tracks": set(),
        "dev_tracks": set(),
        "mod_tracks": set(),
    }


def _clone_stats(stats: dict) -> dict:
    return {
        "base_points": stats["base_points"],
        "max_score": stats["max_score"],
        "laps": stats["laps"],
        "races": stats["races"],
        "tracks": set(stats["tracks"]),
        "characters": set(stats["characters"]),
        "points_by": dict(stats["points_by"]),
        "base_by_character": dict(stats["base_by_character"]),
        "base_by_club": dict(stats["base_by_club"]),
        "tt_races": stats.get("tt_races", 0),
        "velo_tracks": set(stats.get("velo_tracks") or ()),
        "dev_tracks": set(stats.get("dev_tracks") or ()),
        "mod_tracks": set(stats.get("mod_tracks") or ()),
    }


def _add_rally_row(stats: dict, row: dict[str, str], catalog: dict, score_mult: int | None = None) -> None:
    track = (row.get("track") or "").strip()
    profile = (catalog.get("tracks") or {}).get(track, {})
    if is_mod_track(profile):
        return
    score = _cell_int(row, "score")
    amount = score if score_mult is None else score_mult
    if score_mult is None and (row.get("score_mult") or "").strip():
        amount = _cell_int(row, "score_mult")
    stats["base_points"] += score
    stats["max_score"] = max(stats["max_score"], score)
    stats["laps"] += _cell_int(row, "laps")
    stats["races"] += 1
    if track and track.casefold() not in {"null", "none"}:
        stats["tracks"].add(track)
    character_id = _character_id(row.get("skin", ""), catalog)
    if not character_id:
        return
    stats["characters"].add(character_id)
    stats["points_by"][character_id] = stats["points_by"].get(character_id, 0) + amount
    stats["base_by_character"][character_id] = stats["base_by_character"].get(character_id, 0) + score
    profile = catalog["characters"].get(character_id, {})
    for club in _mask_clubs(profile.get("mask") or ""):
        stats["base_by_club"][club] = stats["base_by_club"].get(club, 0) + score


def _stats_from_rows(rows: list[dict[str, str]], catalog: dict) -> dict:
    stats = _blank_stats()
    ordered = sorted(
        rows,
        key=lambda row: int(row["id"]) if str(row.get("id", "")).isdigit() else 10**9,
    )
    for row in ordered:
        _add_rally_row(stats, row, catalog)
    return stats


def _skin_counts(catalog: dict, points_by: dict[str, int], skin_type: str = "") -> tuple[int, int]:
    wanted = skin_type.casefold()
    unlocked = 0
    total = 0
    for ladder in catalog["ladders"].values():
        for step in ladder:
            if wanted and step["skin_type"].casefold() != wanted:
                continue
            total += 1
            if step["threshold"] <= points_by.get(step["character_id"], 0):
                unlocked += 1
    return unlocked, total


def _set_count(wanted: list[str], seen: set[str]) -> tuple[int, int]:
    return sum(1 for item in wanted if item in seen), len(wanted)


def _tracks_with_time(catalog: dict, field: str) -> list[str]:
    found = []
    for track, row in (catalog.get("tracks") or {}).items():
        if is_mod_track(row):
            continue
        if _csv_centis(row.get(field) or "") is not None:
            found.append(track)
    return found


def _add_time_trial_row(stats: dict, row: dict[str, str], catalog: dict) -> None:
    """A saved Contrarreloj counts as a race, and as a Velo or developer beat when it is faster."""
    stats["tt_races"] = stats.get("tt_races", 0) + 1
    track = (row.get("track") or "").strip()
    if not track or track.casefold() in {"null", "none"}:
        return
    try:
        seconds = float((row.get("time_seconds") or "").strip().replace(",", "."))
    except (TypeError, ValueError):
        return
    player = _centis_from_seconds(seconds)
    profile = (catalog.get("tracks") or {}).get(track, {})
    if is_mod_track(profile):
        stats.setdefault("mod_tracks", set()).add(track)
        return
    velo = _csv_centis(profile.get("velo_time") or "")
    dev = _csv_centis(profile.get("dev_time") or "")
    if velo is not None and player < velo:
        stats.setdefault("velo_tracks", set()).add(track)
    if dev is not None and player < dev:
        stats.setdefault("dev_tracks", set()).add(track)


def _apply_time_trials(stats: dict, catalog: dict, rows: list[dict[str, str]] | None = None) -> None:
    source = _read_table(CSV_PATH) if rows is None else rows
    for row in source:
        _add_time_trial_row(stats, row, catalog)


def _measure_achievement(ach: dict, stats: dict, catalog: dict) -> tuple[int, int]:
    kind = ach["kind"]
    if kind == "total_points":
        return stats["base_points"], ach["goal"]
    if kind == "single_race":
        return stats["max_score"], ach["goal"]
    if kind == "laps":
        return stats["laps"], ach["goal"]
    if kind == "races":
        return stats["races"], ach["goal"]
    if kind == "skin_count":
        unlocked, _total = _skin_counts(catalog, stats["points_by"])
        return unlocked, ach["goal"]
    if kind == "skin_type":
        return _skin_counts(catalog, stats["points_by"], ach["skin_type"])
    if kind == "all_skins":
        return _skin_counts(catalog, stats["points_by"])
    if kind == "all_tracks":
        wanted = catalog["tracks_by_game"].get(ach["game"].casefold(), [])
        return _set_count(wanted, stats["tracks"])
    if kind == "all_characters":
        wanted = catalog["characters_by_game"].get(ach["game"].casefold(), [])
        return _set_count(wanted, stats["characters"])
    if kind == "mask_points":
        return stats["base_by_club"].get(ach["club"], 0), ach["goal"]
    if kind == "character_points":
        best = max(stats["base_by_character"].values(), default=0)
        return best, ach["goal"]
    if kind == "time_trials":
        return stats.get("tt_races", 0), ach["goal"]
    if kind == "velo_tracks":
        beaten = len(stats.get("velo_tracks") or ())
        target = ach["goal"] or len(_tracks_with_time(catalog, "velo_time"))
        return beaten, target
    if kind == "dev_tracks":
        beaten = len(stats.get("dev_tracks") or ())
        target = ach["goal"] or len(_tracks_with_time(catalog, "dev_time"))
        return beaten, target
    if kind == "mod_tracks":
        done = len(stats.get("mod_tracks") or ())
        mods = [row for row in (catalog.get("tracks") or {}).values() if is_mod_track(row)]
        target = ach["goal"] or len(mods)
        return done, target
    return 0, 0


def _achievement_state(stats: dict, catalog: dict) -> tuple[dict[str, dict], int]:
    """Progress of every trophy and the global bonus, skins included.

    The multiplier trophy looks at skins plus the other trophies, without its
    own bonus. Ring Rally Legend unlocks only after every other trophy that
    adds a bonus. An empty mult is 0, so that trophy stays on the list and
    unlocking it does not move the Ring Rally multiplier.
    """
    achievements = catalog.get("achievements") or []
    regular = [ach for ach in achievements if ach["kind"] not in {"multiplier", "platinum"}]
    multiplier = next((ach for ach in achievements if ach["kind"] == "multiplier"), None)
    platinum = next((ach for ach in achievements if ach["kind"] == "platinum"), None)
    state: dict[str, dict] = {}
    bonus = _milli_for_points(catalog, stats["points_by"])
    for ach in regular:
        current, target = _measure_achievement(ach, stats, catalog)
        unlocked = target > 0 and current >= target
        state[ach["id"]] = {"current": current, "target": target, "unlocked": unlocked}
        if unlocked and ach["milli"] > 0:
            bonus += ach["milli"]
    if multiplier is not None:
        target = multiplier["goal_milli"]
        unlocked = target > 0 and bonus >= target
        state[multiplier["id"]] = {"current": bonus, "target": target, "unlocked": unlocked}
        if unlocked:
            bonus += multiplier["milli"]
    others = [ach for ach in achievements if ach is not platinum and ach["milli"] > 0]
    other_unlocked = sum(1 for ach in others if state.get(ach["id"], {}).get("unlocked"))
    if platinum is not None:
        target = len(others)
        unlocked = target > 0 and other_unlocked >= target
        state[platinum["id"]] = {"current": other_unlocked, "target": target, "unlocked": unlocked}
        if unlocked:
            bonus += platinum["milli"]
    return state, bonus


def _fmt_count(value: int) -> str:
    return f"{value:,}"


def _trophy_meta(ach: dict, target: int) -> str:
    kind = ach["kind"]
    if kind == "total_points":
        return f"Suma {_fmt_count(ach['goal'])} pts base"
    if kind == "single_race":
        return f"Consigue {_fmt_count(ach['goal'])} pts base en una carrera"
    if kind == "all_tracks":
        return f"Corre las {target} pistas de {ach['game']}"
    if kind == "all_characters":
        return f"Corre con los {target} personajes de {ach['game']}"
    if kind == "skin_type":
        label = ach["skin_type"][:1].upper() + ach["skin_type"][1:]
        return f"Desbloquea las {target} skins {label}"
    if kind == "all_skins":
        return f"Desbloquea las {target} skins"
    if kind == "skin_count":
        return f"Desbloquea {_fmt_count(ach['goal'])} skins"
    if kind == "races":
        return f"Completa {_fmt_count(ach['goal'])} carreras de Ring Rally"
    if kind == "laps":
        return f"Acumula {_fmt_count(ach['goal'])} vueltas"
    if kind == "multiplier":
        return f"Alcanza un bonus de {ach['goal_milli'] / 1000:.3f}"
    if kind == "mask_points":
        extra = "Aku Aku/Uka Uka y Any también suman." if ach["club"] in {"Aku Aku", "Uka Uka"} else "Any también suma."
        return f"Suma {_fmt_count(ach['goal'])} pts base con máscara {ach['club']}. {extra}"
    if kind == "character_points":
        return f"Suma {_fmt_count(ach['goal'])} pts base con un mismo personaje"
    if kind == "time_trials":
        return f"Completa {_fmt_count(ach['goal'])} carreras de Contrarreloj"
    if kind == "velo_tracks":
        return f"Supera el tiempo de Velo en las {target} pistas"
    if kind == "dev_tracks":
        if int(ach.get("goal") or target) == 1:
            return "Supera un tiempo de desarrollador"
        return f"Supera el tiempo del desarrollador en las {target} pistas"
    if kind == "mod_tracks":
        if target <= 1:
            return "Corre en una pista modificada por la comunidad"
        return f"Corre en {target} pistas modificadas por la comunidad"
    if kind == "platinum":
        return f"Desbloquea los otros {target} trofeos"
    return ach.get("notes") or ""


def _trophy_unit(kind: str) -> str:
    if kind in {"total_points", "single_race", "mask_points", "character_points"}:
        return "points"
    if kind == "multiplier":
        return "milli"
    return "count"


def _ratio(current: int, target: int) -> float:
    if target <= 0 or current >= target:
        return 1.0
    if current <= 0:
        return 0.0
    return current / target


def _skin_card(step: dict, points_after: int, status: str) -> dict:
    target = int(step["threshold"])
    return {
        "kind": "skin",
        "status": status,
        "label": "Skin",
        "name": step["skin_name"],
        "detail": f"{step['character']} · {step['skin_type']}",
        "url": step["url"],
        "current": points_after,
        "target": target,
        "unit": "points",
        "progress": _ratio(points_after, target),
    }


def _trophy_card(ach: dict, state: dict[str, dict], status: str) -> dict:
    info = state.get(ach["id"], {})
    current = int(info.get("current") or 0)
    target = int(info.get("target") or 0)
    return {
        "kind": "trophy",
        "status": status,
        "label": "Trophy",
        "name": ach["name"],
        "detail": ach.get("description", ""),
        "tier": ach.get("tier") or "",
        "type": ach.get("type") or "",
        "url": ach.get("url") or "",
        "current": current,
        "target": target,
        "unit": _trophy_unit(ach["kind"]),
        "progress": _ratio(current, target),
    }


def _unlock_cards(
    steps: list[dict],
    trophies: list[dict],
    points_after: int,
    state: dict[str, dict],
) -> list[dict]:
    """Skins and trophies this one race opened, ready for the celebration box."""
    cards = [_skin_card(step, points_after, "unlocked") for step in steps]
    cards.extend(_trophy_card(ach, state, "unlocked") for ach in trophies)
    return cards


def _next_skin_card(ladder: list[dict], points_after: int) -> list[dict]:
    """The single skin this character is working toward. Locked trophies stay out."""
    nxt = next((step for step in ladder if int(step["threshold"]) > points_after), None)
    if nxt is None or points_after <= 0:
        return []
    return [_skin_card(nxt, points_after, "progress")]


def ensure_wallet() -> list[dict[str, str]]:
    """Create the wallet once. Existing race logs are not rewritten and do not earn coins."""
    with _store_lock:
        return _read_wallet()


def wallet_balance() -> int:
    """Current Wumpacoins. A missing wallet starts with the base grant."""
    with _store_lock:
        return _wallet_balance(_read_wallet())


def _read_wallet() -> list[dict[str, str]]:
    path = STORE_WALLET_PATH
    rows: list[dict[str, str]] = []
    if path.exists() and path.stat().st_size > 0:
        with path.open("r", newline="", encoding="utf-8-sig") as source:
            rows = list(csv.DictReader(source, delimiter=csv_delimiter(path)))
    if rows:
        return rows
    seeded = [
        {
            "id": "1",
            "kind": "grant",
            "mode": "",
            "race_id": "",
            "item_id": "",
            "coins": str(BASE_WUMPAS),
            "captured_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        }
    ]
    _write_wallet(seeded)
    return seeded


def _write_wallet(rows: list[dict[str, str]]) -> None:
    path = STORE_WALLET_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", newline="", encoding="utf-8-sig") as target:
        writer = csv.DictWriter(target, fieldnames=WALLET_FIELDS, delimiter=";", lineterminator="\n")
        writer.writeheader()
        for index, row in enumerate(rows, start=1):
            record = {field: row.get(field, "") for field in WALLET_FIELDS}
            if not str(record.get("id") or "").isdigit():
                record["id"] = str(index)
            writer.writerow(record)
    os.replace(temporary, path)


def _wallet_balance(rows: list[dict[str, str]]) -> int:
    total = 0
    for row in rows:
        try:
            total += int((row.get("coins") or "0").strip() or "0")
        except ValueError:
            continue
    return total


def _purchased_ids(rows: list[dict[str, str]]) -> set[str]:
    return {
        (row.get("item_id") or "").strip()
        for row in rows
        if (row.get("kind") or "").strip() == "buy" and (row.get("item_id") or "").strip()
    }


def _condition_matches_race(condition: dict, character_id: str, track_id: str) -> bool:
    """Match dimension IDs, never the independently assigned race record IDs."""
    if condition["type"] == "track":
        return bool(track_id) and str(condition["track_id"]) == track_id
    if condition["type"] == "characters":
        return bool(character_id) and character_id in {str(value) for value in condition["character_ids"]}
    raise ValueError(f"Unknown store condition type: {condition['type']}")


def _store_help_lines(item: dict) -> list[str]:
    lines = []
    if item["bonus_all_milli"]:
        lines.append(f"+{item['bonus_all_milli'] / 1000:.3f} on every Ring Rally")
    if item["bonus_condition_milli"] and item["condition_label"]:
        bonus = f"+{item['bonus_condition_milli'] / 1000:.3f}"
        if item["condition"]["type"] == "track":
            lines.append(f"{bonus} on {item['condition_label']}")
        else:
            lines.append(f"{bonus} with {item['condition_label']}")
    for extra in item["additional_conditions"]:
        lines.append(f"+{extra['bonus_milli'] / 1000:.3f} with {extra['condition']['label']}")
    if item["bonus_coins_flat"]:
        lines.append(f"+{item['bonus_coins_flat']} Wumpacoins per new race")
    if item["bonus_coins"] != Decimal("1"):
        lines.append(f"×{item['bonus_coins']} Wumpacoins from every new race")
    for override in item["conditional_overrides"]:
        lines.append(f"+{override['bonus_milli'] / 1000:.3f} if {override['condition']['label']}")
    return lines


def _load_store_items() -> list[dict]:
    path = STORE_CATALOG_PATH
    if not path.exists() or path.stat().st_size == 0:
        return []
    items = []
    for row in json.loads(path.read_text(encoding="utf-8"))["items"]:
        item_id = str(row.get("item_id") or "").strip()
        name = (row.get("name") or "").strip()
        if not item_id or not name:
            continue
        url = (row.get("image_url") or "").strip()
        condition = row["condition"]
        required = row.get("unlock_condition") or []
        required = required if isinstance(required, list) else [required]
        items.append(
            {
                "id": item_id,
                "name": name,
                "item_category": row["item_category"],
                "character_id": row.get("character_id"),
                "track_id": row.get("track_id"),
                "price": int(row["price"]),
                "bonus_all_milli": int(row["bonus_all_milli"]),
                "bonus_condition_milli": int(row["bonus_condition_milli"]),
                "condition": condition,
                "conditional_overrides": row.get("conditional_overrides", []),
                "additional_conditions": row.get("additional_conditions", []),
                "unlock_condition": [str(value) for value in required],
                "unlock_label": row.get("unlock_label", ""),
                "bonus_coins_flat": int(row.get("bonus_coins_flat", 0)),
                "bonus_coins": Decimal(str(row.get("bonus_coins", 1))),
                "condition_label": condition["label"],
                "url": catalog_image_url(url) if url else "",
            }
        )
    for item in items:
        if item["item_category"] in ("skin", "Avatar") and item["character_id"] is not None:
            prices = sorted({other["price"] for other in items if other["item_category"] == item["item_category"] and other["character_id"] == item["character_id"]})
            item["level"] = prices.index(item["price"]) + 1
        else:
            item["level"] = None
    return items


def _store_milli_for_skin(skin: str, catalog: dict, track: str = "") -> int:
    """Purchased store bonus for this race. Conditional bonuses need the matching character or track."""
    with _store_lock:
        owned = _purchased_ids(_read_wallet())
    if not owned:
        return 0
    character_id = _character_id(skin, catalog)
    track_row = (catalog.get("tracks") or {}).get((track or "").strip(), {})
    track_id = (track_row.get("track_id") or "").strip()
    total = 0
    for item in _load_store_items():
        if item["id"] not in owned:
            continue
        total += item["bonus_all_milli"]
        conditional = item["bonus_condition_milli"] if _condition_matches_race(item["condition"], character_id, track_id) else 0
        for override in item["conditional_overrides"]:
            if _condition_matches_race(override["condition"], character_id, track_id):
                conditional = int(override["bonus_milli"])
                break
        total += conditional
        for extra in item["additional_conditions"]:
            if _condition_matches_race(extra["condition"], character_id, track_id):
                total += int(extra["bonus_milli"])
    return total


def _weekend_wumpa_multiplier(captured_at: str) -> int:
    """Friday, Saturday and Sunday use the local date on the race stamp."""
    try:
        moment = datetime.fromisoformat((captured_at or "").strip())
    except ValueError:
        return 1
    if moment.weekday() >= 4:
        return WEEKEND_WUMPA_MULTIPLIER
    return 1


def race_wumpas(track: str, mode: str, captured_at: str) -> int:
    """Track payout from game_tracks, doubled on Friday, Saturday and Sunday."""
    row = _track_catalog_row(track)
    field = "rr_wumpas" if mode == "rally_ring" else "tt_wumpas"
    base = _csv_int(row.get(field) or "") or 0
    return base * _weekend_wumpa_multiplier(captured_at)


def store_bonus_summary() -> dict:
    """Purchased store bonuses. The conditional part depends on who races."""
    with _store_lock:
        owned = _purchased_ids(_read_wallet())
    always = 0
    grouped: dict[str, int] = {}
    for item in _load_store_items():
        if item["id"] not in owned:
            continue
        always += item["bonus_all_milli"]
        for additional in item["additional_conditions"]:
            additional_label = additional["condition"]["label"]
            grouped[additional_label] = grouped.get(additional_label, 0) + int(additional["bonus_milli"])
        extra = item["bonus_condition_milli"]
        label = item["condition_label"]
        overrides = item["conditional_overrides"]
        if overrides:
            label += " except " + ", ".join(o["condition"]["label"] for o in overrides)
            for override in overrides:
                override_label = override["condition"]["label"] + " (instead of " + item["condition_label"] + ")"
                grouped[override_label] = grouped.get(override_label, 0) + int(override["bonus_milli"])
        if extra and label:
            grouped[label] = grouped.get(label, 0) + extra
    return {
        "always": f"{always / 1000:.3f}",
        "conditions": [
            {"label": label, "bonus": f"{milli / 1000:.3f}"}
            for label, milli in grouped.items()
        ],
    }


def credit_race_coins(mode: str, race_id: str, track: str, captured_at: str, breakdown: dict | None = None) -> int:
    """Grant this race's track payout once. The amount is frozen on the wallet row."""
    race_id = str(race_id or "").strip()
    if not race_id:
        return 0
    with _store_lock:
        rows = _read_wallet()
        for row in rows:
            if (
                (row.get("kind") or "").strip() == "earn"
                and (row.get("mode") or "").strip() == mode
                and (row.get("race_id") or "").strip() == race_id
            ):
                try:
                    return int((row.get("coins") or "0").strip() or "0")
                except ValueError:
                    return 0
        owned = _purchased_ids(rows)
        purchased = [item for item in _load_store_items() if item["id"] in owned]
        multiplier = max((item["bonus_coins"] for item in purchased), default=Decimal("1"))
        flat = sum(item["bonus_coins_flat"] for item in purchased)
        weekend = _weekend_wumpa_multiplier(captured_at)
        track_row = _track_catalog_row(track)
        field = "rr_wumpas" if mode == "rally_ring" else "tt_wumpas"
        base = _csv_int(track_row.get(field) or "") or 0
        weekend_amount = base * weekend
        multiplied = int((Decimal(weekend_amount) * multiplier).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        amount = multiplied + flat
        if breakdown is not None:
            breakdown.update({"base": base, "weekend_multiplier": weekend, "coin_multiplier": str(multiplier),
                              "multiplier_bonus": multiplied - weekend_amount, "flat_bonus": flat, "total": amount})
        rows.append(
            {
                "id": "",
                "kind": "earn",
                "mode": mode,
                "race_id": race_id,
                "item_id": "",
                "coins": str(amount),
                "captured_at": captured_at,
            }
        )
        _write_wallet(rows)
    return amount


def store_payload() -> dict:
    with _store_lock:
        rows = _read_wallet()
        balance = _wallet_balance(rows)
        owned = _purchased_ids(rows)
    items = []
    catalog = _load_store_items()
    names = {item["id"]: item["name"] for item in catalog}
    for item in catalog:
        purchased = item["id"] in owned
        required = item["unlock_condition"]
        missing = [identifier for identifier in required if identifier not in owned]
        locked = bool(missing)
        items.append(
            {
                "id": item["id"],
                "name": item["name"],
                "item_category": item["item_category"],
                "character_id": item["character_id"],
                "track_id": item["track_id"],
                "level": item["level"],
                "price": item["price"],
                "bonus_all": f"{item['bonus_all_milli'] / 1000:.3f}",
                "bonus_condition": f"{item['bonus_condition_milli'] / 1000:.3f}",
                "bonus_coins": str(item["bonus_coins"]),
                "condition_label": item["condition_label"],
                "help": _store_help_lines(item),
                "url": item["url"],
                "purchased": purchased,
                "locked": locked and not purchased,
                "unlock_condition": required,
                "unlock_name": item["unlock_label"] or ", ".join(names.get(identifier, identifier) for identifier in missing),
                "affordable": purchased or (not locked and balance >= item["price"]),
            }
        )
    return {
        "mode": "store",
        "balance": balance,
        "weekend_multiplier": WEEKEND_WUMPA_MULTIPLIER,
        "coin_icon": WUMPACOIN_ICON,
        "items": items,
    }


def buy_store_item(item_id: str) -> dict:
    item_id = str(item_id or "").strip()
    with _store_lock:
        catalog = {item["id"]: item for item in _load_store_items()}
        item = catalog.get(item_id)
        if item is None:
            raise ValueError("That item is not in the store.")
        rows = _read_wallet()
        if item_id in _purchased_ids(rows):
            raise ValueError("Already purchased.")
        required = item["unlock_condition"]
        missing = [identifier for identifier in required if identifier not in _purchased_ids(rows)]
        if missing:
            labels = [catalog[identifier]["name"] if identifier in catalog else identifier for identifier in missing]
            raise ValueError(f"Buy {', '.join(labels)} first to unlock {item['name']}.")
        balance = _wallet_balance(rows)
        if balance < item["price"]:
            raise ValueError(f"Not enough Wumpacoins. {item['name']} costs {item['price']:,}.")
        rows.append(
            {
                "id": "",
                "kind": "buy",
                "mode": "",
                "race_id": "",
                "item_id": item_id,
                "coins": str(-item["price"]),
                "captured_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            }
        )
        _write_wallet(rows)
    return store_payload()


def score_with_progression(
    prior_rows: list[dict[str, str]],
    skin: str,
    score: int,
    catalog: dict,
    laps: int = 0,
    track: str = "",
) -> dict:
    """Snapshot the global multiplier for one new score without rewriting older rows.

    Skins and trophies already unlocked raise the next score. If this race opens
    more of either, the same record is recalculated with those bonuses included.
    Trophy progress uses the raw score. score_mult stays the album currency.
    """
    character_id = _character_id(skin, catalog)
    ladder = catalog["ladders"].get(character_id, []) if character_id else []
    prior_stats = _stats_from_rows(prior_rows, catalog)
    _apply_time_trials(prior_stats, catalog)
    store_milli = _store_milli_for_skin(skin, catalog, track)
    prior_state, milli = _achievement_state(prior_stats, catalog)
    milli += store_milli
    points = prior_stats["points_by"].get(character_id, 0) if character_id else 0
    score_mult = scaled_score(score, milli)
    fresh: list[dict] = []
    fresh_trophies: list[dict] = []
    for _ in range(64):
        trial = _clone_stats(prior_stats)
        _add_rally_row(
            trial,
            {"score": str(score), "laps": str(laps), "track": track, "skin": skin},
            catalog,
            score_mult=score_mult,
        )
        state, new_milli = _achievement_state(trial, catalog)
        new_milli += store_milli
        unlocked = [step for step in ladder if step["threshold"] <= points + score_mult]
        fresh = [step for step in unlocked if step["threshold"] > points]
        fresh_trophies = [
            ach
            for ach in catalog.get("achievements") or []
            if state.get(ach["id"], {}).get("unlocked") and not prior_state.get(ach["id"], {}).get("unlocked")
        ]
        if new_milli == milli:
            break
        milli = new_milli
        score_mult = scaled_score(score, milli)
    return {
        "score_mult": score_mult,
        "multiplier": f"{milli / 1000:.3f}",
        "notes": _progress_notes(fresh, fresh_trophies),
        "character_id": character_id,
        "unlocks": _unlock_cards(fresh, fresh_trophies, points + score_mult, state)
        or _next_skin_card(ladder, points + score_mult),
    }


def _read_rally(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    if not path.exists() or path.stat().st_size == 0:
        return list(RALLY_FIELDS), []
    with path.open("r", newline="", encoding="utf-8-sig") as source:
        reader = csv.DictReader(source, delimiter=csv_delimiter(path))
        fieldnames = list(reader.fieldnames or [])
        if not {"track", "score"}.issubset(fieldnames):
            raise ValueError("El CSV Ring Rally existente tiene un esquema incompatible.")
        return fieldnames, list(reader)


def _write_rally(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    with temp_path.open("w", newline="", encoding="utf-8-sig") as target:
        writer = csv.DictWriter(target, fieldnames=RALLY_FIELDS, extrasaction="ignore", lineterminator="\n")
        writer.writeheader()
        for row in rows:
            writer.writerow({field: row.get(field, "") for field in RALLY_FIELDS})
    os.replace(temp_path, path)


def _append_rally(path: Path, record: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    needs_header = not path.exists() or path.stat().st_size == 0
    with path.open("a", newline="", encoding="utf-8-sig") as target:
        writer = csv.DictWriter(target, fieldnames=RALLY_FIELDS, extrasaction="ignore", lineterminator="\n")
        if needs_header:
            writer.writeheader()
        writer.writerow({field: record.get(field, "") for field in RALLY_FIELDS})


def _row_has_progression(row: dict[str, str]) -> bool:
    return bool((row.get("score_mult") or "").strip()) and (row.get("multiplier") or "").strip() != ""


def _fill_missing_progression(rows: list[dict[str, str]], catalog: dict) -> None:
    """Fill empty progression cells in id order. Rows that already have them stay put."""
    ordered = sorted(
        range(len(rows)),
        key=lambda index: int(rows[index]["id"]) if str(rows[index].get("id", "")).isdigit() else index,
    )
    prior: list[dict[str, str]] = []
    for index in ordered:
        row = rows[index]
        if not _row_has_progression(row):
            try:
                score = int((row.get("score") or "").strip())
            except (TypeError, ValueError):
                score = 0
            result = score_with_progression(
                prior,
                (row.get("skin") or "").strip(),
                score,
                catalog,
                laps=_cell_int(row, "laps"),
                track=(row.get("track") or "").strip(),
            )
            row["score_mult"] = str(result["score_mult"])
            row["multiplier"] = result["multiplier"]
            row["notes"] = result["notes"]
        prior.append(row)


def _rally_schema_ready(path: Path, fieldnames: list[str], rows: list[dict[str, str]]) -> bool:
    return (
        path.exists()
        and path.stat().st_size > 0
        and fieldnames == list(RALLY_FIELDS)
        and all(_row_has_progression(row) for row in rows)
    )


def _entity_id_from_rows(rows: list[dict[str, str]], field: str, value: str) -> tuple[str, str]:
    value = (value or "").strip()
    if not value or value.casefold() in {"null", "none"}:
        return "null", ""
    found: dict[str, int] = {}
    id_field = f"{field}_id"
    for row in rows:
        raw = (row.get(field) or "").strip()
        raw_id = (row.get(id_field) or "").strip()
        if raw and raw_id.isdigit():
            found[raw] = int(raw_id)
    return value, str(found.get(value, max(found.values(), default=0) + 1))


def _new_rally_record(
    rows: list[dict[str, str]],
    track: str,
    skin: str,
    score: int,
    laps: int,
    catalog: dict,
) -> tuple[dict[str, str], list[dict]]:
    track, track_id = _entity_id_from_rows(rows, "track", track)
    skin, skin_id = _entity_id_from_rows(rows, "skin", skin)
    previous: int | None = None
    if track.casefold() not in {"null", "none"}:
        for row in rows:
            if (row.get("track") or "").strip() != track:
                continue
            try:
                old_score = int((row.get("score") or "").strip())
            except (TypeError, ValueError):
                continue
            previous = old_score if previous is None else max(previous, old_score)
    progress = score_with_progression(rows, skin, score, catalog, laps=laps, track=track)
    record_id = max((int(row["id"]) for row in rows if str(row.get("id", "")).isdigit()), default=0) + 1
    return {
        "id": str(record_id),
        "track_id": track_id,
        "track": track,
        "skin_id": skin_id,
        "skin": skin,
        "score": str(score),
        "laps": str(laps),
        "pb": "1" if previous is None or score > previous else "0",
        "delta_pb": str(score - previous) if previous is not None else "0",
        "score_mult": str(progress["score_mult"]),
        "multiplier": progress["multiplier"],
        "notes": progress["notes"],
        "captured_at": datetime.now().astimezone().isoformat(timespec="seconds"),
    }, list(progress.get("unlocks") or [])


def ensure_rally_progression(csv_path: Path | None = None) -> None:
    """Backfill score_mult, multiplier and notes once. Completed rows are not rewritten."""
    path = csv_path or RALLY_RING_CSV_PATH
    with _rally_lock:
        fieldnames, rows = _read_rally(path)
        if _rally_schema_ready(path, fieldnames, rows):
            return
        if rows:
            _fill_missing_progression(rows, load_rally_catalog())
        if rows or (path.exists() and path.stat().st_size > 0):
            _write_rally(path, rows)


def save_rally_record(
    track: str, skin: str, raw_score: str, raw_laps: str, csv_path: Path
) -> tuple[dict[str, str], list[dict]]:
    if is_mod_track(_track_catalog_row(track)):
        raise ValueError("Mod tracks can only be logged in Time Trial.")
    score = parse_score(raw_score)
    laps = parse_laps(raw_laps)
    ensure_possible_score(track, score)
    with _rally_lock:
        fieldnames, rows = _read_rally(csv_path)
        catalog = load_rally_catalog()
        ready = _rally_schema_ready(csv_path, fieldnames, rows)
        if any(not _row_has_progression(row) for row in rows):
            _fill_missing_progression(rows, catalog)
        record, unlocks = _new_rally_record(rows, (track or "").strip(), (skin or "").strip(), score, laps, catalog)
        if ready:
            _append_rally(csv_path, record)
        else:
            _write_rally(csv_path, [*rows, record])
        coin_breakdown = {}
        record["wumpas"] = str(credit_race_coins("rally_ring", record["id"], record["track"], record["captured_at"], coin_breakdown))
        record["wumpa_breakdown"] = coin_breakdown
        return record, unlocks


def build_rally_progression(rows: list[dict[str, str]], catalog: dict | None = None) -> dict:
    """Album state per character from the frozen score_mult column."""
    catalog = catalog or load_rally_catalog()
    points: dict[str, int] = {}
    base: dict[str, int] = {}
    runs: dict[str, int] = {}
    for row in rows:
        character_id = _character_id(row.get("skin", ""), catalog)
        if not character_id:
            continue
        runs[character_id] = runs.get(character_id, 0) + 1
        try:
            base[character_id] = base.get(character_id, 0) + int((row.get("score") or "0").strip() or "0")
        except ValueError:
            pass
        try:
            points[character_id] = points.get(character_id, 0) + int((row.get("score_mult") or "0").strip() or "0")
        except ValueError:
            pass

    ids = set(catalog["characters"]) | set(catalog["ladders"]) | set(points)
    characters: list[dict] = []
    unlocked_total = 0
    skins_total = 0
    for character_id in sorted(ids, key=lambda value: (0, int(value)) if str(value).isdigit() else (1, str(value))):
        profile = catalog["characters"].get(character_id, {})
        ladder = catalog["ladders"].get(character_id, [])
        total_points = points.get(character_id, 0)
        unlocked_steps = [step for step in ladder if step["threshold"] <= total_points]
        next_step = next((step for step in ladder if step["threshold"] > total_points), None)
        skins = []
        for step in ladder:
            unlocked = step["threshold"] <= total_points
            skins.append(
                {
                    "skin_id": step["skin_id"],
                    "skin_name": step["skin_name"],
                    "skin_type": step["skin_type"],
                    "url": step["url"],
                    "unlocked": unlocked,
                    "is_next": bool(next_step and step["skin_id"] == next_step["skin_id"]),
                    "cost": step["cost"],
                    "threshold": step["threshold"],
                }
            )
        upcoming = None
        if next_step:
            into = total_points - (next_step["threshold"] - next_step["cost"])
            remaining = next_step["threshold"] - total_points
            upcoming = {
                "skin_name": next_step["skin_name"],
                "skin_type": next_step["skin_type"],
                "cost": next_step["cost"],
                "threshold": next_step["threshold"],
                "into": max(into, 0),
                "remaining": max(remaining, 0),
                "progress": round(max(into, 0) / next_step["cost"], 6) if next_step["cost"] else 0,
            }
        unlocked_total += len(unlocked_steps)
        skins_total += len(ladder)
        fallback_name = ladder[0]["character"] if ladder else "null"
        characters.append(
            {
                "character_id": character_id,
                "character": (profile.get("character") or "").strip() or fallback_name,
                "game_base": (profile.get("game_base") or "").strip(),
                "mask": (profile.get("mask") or "").strip(),
                "url_mask": (profile.get("url_mask") or "").strip(),
                "url_character": (profile.get("url_character") or "").strip(),
                "points": total_points,
                "base_points": base.get(character_id, 0),
                "runs": runs.get(character_id, 0),
                "unlocked": len(unlocked_steps),
                "total_skins": len(ladder),
                "next": upcoming,
                "skins": skins,
            }
        )
    active = _character_id(rows[-1].get("skin", ""), catalog) if rows else ""
    stats = _stats_from_rows(rows, catalog)
    _apply_time_trials(stats, catalog)
    _state, global_milli = _achievement_state(stats, catalog)
    return {
        "characters": characters,
        "active_character_id": active,
        "unlocked": unlocked_total,
        "total_skins": skins_total,
        "multiplier": f"{global_milli / 1000:.3f}",
        "store_bonus": store_bonus_summary(),
    }


def build_trophies(rows: list[dict[str, str]], catalog: dict | None = None) -> dict:
    """PlayStation-style trophy list. Dates come from the race that crossed each goal."""
    catalog = catalog or load_rally_catalog()
    achievements = catalog.get("achievements") or []
    stats = _blank_stats()
    unlocked_at: dict[str, str] = {}

    def event_key(kind: str, row: dict[str, str]) -> tuple:
        stamp = (row.get("captured_at") or "").strip()
        ident = int(row["id"]) if str(row.get("id", "")).isdigit() else 10**9
        return stamp, 0 if kind == "rally" else 1, ident

    events = [("rally", row) for row in rows] + [("trial", row) for row in _read_table(CSV_PATH)]
    events.sort(key=lambda item: event_key(item[0], item[1]))
    final_state: dict[str, dict] = {}
    total_milli = 0
    for kind, row in events:
        if kind == "rally":
            _add_rally_row(stats, row, catalog)
        else:
            _add_time_trial_row(stats, row, catalog)
        final_state, total_milli = _achievement_state(stats, catalog)
        captured = (row.get("captured_at") or "").strip()
        for ach in achievements:
            info = final_state.get(ach["id"], {})
            if info.get("unlocked") and ach["id"] not in unlocked_at:
                unlocked_at[ach["id"]] = captured
    if not events:
        final_state, total_milli = _achievement_state(stats, catalog)
    trophies = []
    unlocked_count = 0
    for ach in achievements:
        info = final_state.get(ach["id"], {"current": 0, "target": 0, "unlocked": False})
        current = int(info["current"])
        target = int(info["target"])
        unlocked = bool(info["unlocked"])
        if unlocked:
            unlocked_count += 1
        progress = min(1.0, current / target) if target else 0.0
        trophies.append(
            {
                "id": ach["id"],
                "name": ach["name"],
                "type": ach["type"],
                "tier": ach["tier"],
                "url": ach["url"],
                "description": ach.get("description", ""),
                "game_mode": ach.get("game_mode", ""),
                "mult": f"{ach['milli'] / 1000:.3f}",
                "meta": ach.get("description", ""),
                "current": current,
                "target": target,
                "unit": _trophy_unit(ach["kind"]),
                "progress": round(progress, 6),
                "unlocked": unlocked,
                "unlocked_at": unlocked_at.get(ach["id"], ""),
            }
        )
    return {
        "trophies": trophies,
        "unlocked": unlocked_count,
        "total": len(trophies),
        "multiplier": f"{total_milli / 1000:.3f}",
    }


def scan_existing_log(log_path: Path, state: dict[str, str]) -> None:
    with log_path.open("r", encoding="utf-8", errors="replace") as log_file:
        for line in log_file:
            extract_metadata(line, state)


def watch(log_path: Path, csv_path: Path) -> int:
    if not log_path.is_file():
        print(f"No existe el log: {log_path}", file=sys.stderr)
        return 2
    state = {"track": "", "skin": ""}
    scan_existing_log(log_path, state)
    print(f"Vigilando: {log_path}")
    print(f"CSV: {csv_path}")
    print(f"Metadatos iniciales: track={state['track'] or '(pendiente)'}, skin={state['skin'] or '(pendiente)'}")
    print("Escribe el tiempo al terminar cada Time Trial (ej. 1:20:99). Ctrl+C para salir.")
    state_lock = threading.Lock()

    def read_results() -> None:
        while True:
            try:
                raw_time = input("Tiempo: ").strip()
            except EOFError:
                return
            if not raw_time:
                continue
            with state_lock:
                track = state["track"]
                skin = state["skin"]
            if not track or not skin:
                print("Aún falta track o skin en el log; tiempo ignorado.", file=sys.stderr)
                continue
            try:
                record = save_record(track, skin, raw_time, csv_path)
            except ValueError as exc:
                print(f"Tiempo no válido ({exc}); registro ignorado.", file=sys.stderr)
                continue
            print(f"Guardado ID {record['id']}: {record['track']} | {record['skin']} | {record['time_seconds']} s")

    threading.Thread(target=read_results, name="manual-time-input", daemon=True).start()

    # Start at EOF: existing log lines seed metadata but are not new race events.
    with log_path.open("r", encoding="utf-8", errors="replace") as log_file:
        log_file.seek(0, 2)
        while True:
            line = log_file.readline()
            if not line:
                try:
                    if log_path.stat().st_size < log_file.tell():
                        # The producer rotated/truncated last_run; read the new file from its start.
                        log_file.seek(0)
                except OSError:
                    pass
                time.sleep(0.25)
                continue
            with state_lock:
                previous = (state["track"], state["skin"])
                extract_metadata(line, state)
                current = (state["track"], state["skin"])
            if current != previous:
                print(f"Metadatos actualizados: track={current[0] or '(pendiente)'}, skin={current[1] or '(pendiente)'}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--log", type=Path, default=DEFAULT_LOG, help="ruta al log last_run")
    parser.add_argument("--csv", type=Path, default=CSV_PATH, help="ruta del CSV de salida")
    parser.add_argument("--watch", action="store_true", help="vigila el log y pregunta por tiempos al cambiar metadatos")
    parser.add_argument("--record", metavar="TIEMPO", help="guarda un tiempo directamente con los últimos metadatos del log")
    args = parser.parse_args()

    if args.record:
        if not args.log.is_file():
            parser.error(f"no existe el log: {args.log}")
        state = {"track": "", "skin": ""}
        scan_existing_log(args.log, state)
        if not state["track"] or not state["skin"]:
            parser.error("no se encontraron track y skin en el log")
        try:
            record = save_record(state["track"], state["skin"], args.record, args.csv)
        except ValueError as exc:
            parser.error(str(exc))
        print(f"Guardado ID {record['id']}: {record['track']} | {record['skin']} | {record['time_seconds']} s")
        return 0
    if args.watch:
        try:
            return watch(args.log, args.csv)
        except KeyboardInterrupt:
            print("\nSeguimiento detenido.")
            return 0
    parser.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
