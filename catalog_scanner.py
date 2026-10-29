#!/usr/bin/env python3
"""Collect unique CTR Nitro-Fueled tracks and player skins from last_run."""

from __future__ import annotations

import argparse
import csv
import re
import sys
import time
from pathlib import Path

DEFAULT_LOG = Path(r"C:\CTRNF\CTR-NitroFueled-PC-portable\last_run_JulianGomez.log")
CSV_PATH = Path(__file__).resolve().parent / "game_catalog.csv"
CSV_FIELDS = ("track_id", "track", "skin_id", "skin")

TRACK_RE = re.compile(r"LOADING LEVEL:\s*['\"]([^'\"]+)['\"]", re.IGNORECASE)
MENU_TRACK_PARTS = {"octane_startscreen"}
SKIN_PATTERNS = (
    re.compile(r"Loading hero\s+\S+\s+\[([^\]]+)\]\s+in\s+pool\S+\s+forPlayID:0\b", re.IGNORECASE),
    re.compile(r"changeHeroAndOutfit\s+\[0\]\s+\[[^\]]*\]\s+\[([^\]]+)\]", re.IGNORECASE),
)


def csv_delimiter(path: Path) -> str:
    """Keep the delimiter already used by the catalog (Excel may use ';')."""
    if not path.exists() or path.stat().st_size == 0:
        return ","
    with path.open("r", encoding="utf-8-sig", newline="") as csv_file:
        header = csv_file.readline()
    return ";" if header.count(";") > header.count(",") else ","


def load_values(path: Path, value_field: str, id_field: str) -> dict[str, int]:
    values: dict[str, int] = {}
    if not path.exists() or path.stat().st_size == 0:
        return values
    delimiter = csv_delimiter(path)
    with path.open("r", newline="", encoding="utf-8-sig") as csv_file:
        reader = csv.DictReader(csv_file, delimiter=delimiter)
        if not reader.fieldnames or not {value_field, id_field}.issubset(reader.fieldnames):
            raise ValueError(f"El archivo {path} tiene un encabezado incompatible.")
        for row in reader:
            value, raw_id = row.get(value_field, ""), row.get(id_field, "")
            if value and raw_id and raw_id.isdigit():
                values[value] = int(raw_id)
    return values


def append_discovery(path: Path, *, track: str = "", skin: str = "") -> None:
    tracks = load_values(path, "track", "track_id")
    skins = load_values(path, "skin", "skin_id")
    new_track = track and track not in tracks
    new_skin = skin and skin not in skins
    if not new_track and not new_skin:
        return

    path.parent.mkdir(parents=True, exist_ok=True)
    needs_header = not path.exists() or path.stat().st_size == 0
    delimiter = csv_delimiter(path)
    with path.open("a", newline="", encoding="utf-8-sig") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=CSV_FIELDS, delimiter=delimiter)
        if needs_header:
            writer.writeheader()
        if new_track:
            track_id = max(tracks.values(), default=0) + 1
            writer.writerow({"track_id": track_id, "track": track, "skin_id": "", "skin": ""})
            print(f"Nueva pista [{track_id}]: {track}")
        if new_skin:
            skin_id = max(skins.values(), default=0) + 1
            writer.writerow({"track_id": "", "track": "", "skin_id": skin_id, "skin": skin})
            print(f"Nueva skin [{skin_id}]: {skin}")


def inspect_line(line: str, csv_path: Path) -> None:
    track_match = TRACK_RE.search(line)
    if track_match:
        track = track_match.group(1).strip()
        parts = {part.casefold() for part in track.split("/")}
        if not parts.intersection(MENU_TRACK_PARTS):
            append_discovery(csv_path, track=track)
    for pattern in SKIN_PATTERNS:
        skin_match = pattern.search(line)
        if skin_match:
            skin = skin_match.group(1).strip()
            if skin.casefold() not in {"none", "null"}:
                append_discovery(csv_path, skin=skin)
            break


def watch(log_path: Path, csv_path: Path) -> int:
    if not log_path.is_file():
        print(f"No existe el log: {log_path}", file=sys.stderr)
        return 2
    print(f"Escaneando log: {log_path}")
    print(f"Catálogo único: {csv_path}")
    print("Se procesa el historial existente y luego las líneas nuevas. Ctrl+C para salir.")

    with log_path.open("r", encoding="utf-8", errors="replace") as log_file:
        # Initial pass catalogs values already present; then follow from EOF.
        for line in log_file:
            inspect_line(line, csv_path)
        log_file.seek(0, 2)

        while True:
            line = log_file.readline()
            if not line:
                try:
                    if log_path.stat().st_size < log_file.tell():
                        log_file.seek(0)
                except OSError:
                    pass
                time.sleep(0.25)
                continue
            inspect_line(line, csv_path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--log", type=Path, default=DEFAULT_LOG, help="ruta al log last_run")
    parser.add_argument("--csv", type=Path, default=CSV_PATH, help="CSV de catálogo (por defecto game_catalog.csv)")
    parser.add_argument("--watch", action="store_true", help="escanea el historial y sigue el log en vivo")
    args = parser.parse_args()
    if not args.watch:
        parser.print_help()
        return 0
    try:
        return watch(args.log, args.csv)
    except KeyboardInterrupt:
        print("\nEscaneo detenido.")
        return 0
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
