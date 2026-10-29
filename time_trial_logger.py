#!/usr/bin/env python3
"""Capture CTR Nitro-Fueled Time Trial results alongside last_run metadata."""

from __future__ import annotations

import argparse
import csv
import os
import re
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

DEFAULT_LOG = Path(r"C:\CTRNF\CTR-NitroFueled-PC-portable\last_run_JulianGomez.log")
CSV_PATH = Path(__file__).resolve().parent / "data" / "time_trials.csv"
CSV_FIELDS = (
    "id",
    "track_id",
    "track",
    "skin_id",
    "skin",
    "time_raw",
    "time_seconds",
    "pb",
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
            raise ValueError("usa M:SS:CC, M:SS.CC o SS.CC")
        minutes, seconds, centiseconds = map(int, (minutes_s, seconds_s, centiseconds_s))
    else:
        match = TIME_RE.fullmatch(value)
        if not match:
            raise ValueError("usa M:SS:CC, M:SS.CC o SS.CC")
        minutes_s, seconds_s, fraction_s = match.groups()
        minutes = int(minutes_s or 0)
        seconds = int(seconds_s)
        if fraction_s is None:
            raise ValueError("falta la fracción de centésimas (por ejemplo 1:20.99)")
        centiseconds = int(fraction_s.ljust(2, "0"))
    if seconds > 59 or centiseconds > 99:
        raise ValueError("segundos deben estar entre 00 y 59 y centésimas entre 00 y 99")
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
                "el CSV existente usa un esquema anterior; elimínalo o renómbralo antes de guardar"
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


def save_record(track: str, skin: str, raw_time: str, csv_path: Path) -> dict[str, str]:
    seconds = parse_time(raw_time)
    best_by_track = ensure_pb_column(csv_path)
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
    record = {
        "id": str(next_id(csv_path)),
        "track_id": track_id,
        "track": track,
        "skin_id": skin_id,
        "skin": skin,
        "time_raw": raw_time.strip(),
        "time_seconds": f"{seconds:.2f}",
        "pb": "1" if track and track.casefold() not in {"null", "none"} and (track not in best_by_track or seconds < best_by_track[track]) else "0",
        "captured_at": datetime.now().astimezone().isoformat(timespec="seconds"),
    }
    with csv_path.open("a", newline="", encoding="utf-8-sig") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=CSV_FIELDS)
        if needs_header:
            writer.writeheader()
        writer.writerow(record)
    return record


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
