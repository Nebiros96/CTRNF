#!/usr/bin/env python3
"""Local API server for the CTRNF dashboard in web/."""

from __future__ import annotations

import argparse
import csv
import ctypes
import json
import os
import re
import subprocess
import sys
import threading
import urllib.error
import urllib.request
import webbrowser
import zipfile
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import time_trial_logger as core

ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
WEB_DIR = ROOT / "web"
LOGO_PATH = ROOT / "utils" / "logo_by_LexiLoo826.png"
## Art cover used in the launcher window.
COVER_PATH = ROOT / "utils" / "fondo_launcher.png"
ICON_PATH = ROOT / "utils" / "ctrnf.ico"
APP_NAME = "CTR Nitro Fueled - Personal Dashboard"
APP_VERSION = "CTR - v0.2.0-alpha.1"
APP_VERSION_TAG = APP_VERSION.rsplit(" ", 1)[-1]
GITHUB_REPO = "Nebiros96/CTRNF"
GITHUB_RELEASES_API = f"https://api.github.com/repos/{GITHUB_REPO}/releases?per_page=100"
GITHUB_RELEASES_URL = f"https://github.com/{GITHUB_REPO}/releases"
DATA_DIR = core.USER_DATA_DIR
TRACKS_CSV = core.TRACKS_CSV_PATH
SKINS_CSV = core.SKINS_CSV_PATH
RESULTS_CSV = core.CSV_PATH
RALLY_RESULTS_CSV = core.RALLY_RING_CSV_PATH
VELO_SKIN = "SystemData_availableDrivers_55_skins_0_outfit"
SETTINGS_PATH = DATA_DIR / "settings.json"
PORTABLE_LOG_NAMES = ("last_run.log", "last_run_*.log")


def version_key(value: str) -> tuple[int, int, int, int, int] | None:
    match = re.search(r"v?(\d+)\.(\d+)\.(\d+)(?:[-.]?(alpha|beta|rc)(?:[.-]?(\d+))?)?", value or "", re.IGNORECASE)
    if not match:
        return None
    major, minor, patch, stage, stage_number = match.groups()
    stage_rank = {"alpha": 0, "beta": 1, "rc": 2, None: 3}[stage.casefold() if stage else None]
    return int(major), int(minor), int(patch), stage_rank, int(stage_number or 0)


def find_log_file() -> Path | None:
    configured = core.DEFAULT_LOG
    if configured.is_file():
        return configured
    roots = [Path(os.environ.get("USERPROFILE", "")) / "Documents", Path("C:/CTRNF"), Path("C:/Games"), Path("D:/Games")]
    candidates: list[Path] = []
    for root in roots:
        if not root.is_dir():
            continue
        try:
            for pattern in PORTABLE_LOG_NAMES:
                candidates.extend(root.glob(pattern))
                if pattern.endswith("*.log"):
                    candidates.extend(root.glob(f"**/{pattern}"))
        except OSError:
            continue
    candidates = [path for path in candidates if path.is_file()]
    return max(candidates, key=lambda path: path.stat().st_mtime) if candidates else None


def set_log_file(path: Path | None) -> None:
    core.DEFAULT_LOG = path or Path("last_run.log")
    settings = {"log_path": str(path) if path else ""}
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_PATH.write_text(json.dumps(settings, ensure_ascii=False, indent=2), encoding="utf-8")


DATA_FILES = {"time_trials.csv": RESULTS_CSV, "rally_ring.csv": RALLY_RESULTS_CSV}


def export_data(path: Path) -> None:
    if path.exists():
        raise ValueError("Ese archivo ya existe. Elige otro nombre para conservar el respaldo existente.")
    available = [(name, source) for name, source in DATA_FILES.items() if source.is_file()]
    if not available:
        raise ValueError("No hay registros para exportar todavía.")
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, source in available:
            archive.write(source, arcname=name)


def import_data(path: Path) -> list[str]:
    with zipfile.ZipFile(path, "r") as archive:
        names = set(archive.namelist())
        selected = names.intersection(DATA_FILES)
        if not selected:
            raise ValueError("El archivo no contiene time_trials.csv ni rally_ring.csv.")
        staged = {}
        schemas = {
            "time_trials.csv": {"id", "track", "skin", "time_raw", "time_seconds", "captured_at"},
            "rally_ring.csv": {"id", "track", "skin", "score", "laps", "captured_at"},
        }
        for name in selected:
            raw = archive.read(name).decode("utf-8-sig")
            delimiter = ";" if raw.splitlines()[0].count(";") > raw.splitlines()[0].count(",") else ","
            reader = csv.DictReader(raw.splitlines(), delimiter=delimiter)
            if not schemas[name].issubset(set(reader.fieldnames or [])):
                raise ValueError(f"El esquema de {name} no es compatible.")
            rows = list(reader)
            if any(not row.get("id") for row in rows):
                raise ValueError(f"{name} contiene filas sin ID.")
            staged[name] = raw.encode("utf-8-sig")
        conflicts = [name for name in selected if DATA_FILES[name].exists() and DATA_FILES[name].stat().st_size > 0]
        if conflicts:
            raise ValueError("Importación cancelada: ya hay datos en " + ", ".join(sorted(conflicts)) + ". Exporta una copia y mueve/renombra esos CSV para restaurar.")
        for name, content in staged.items():
            DATA_FILES[name].parent.mkdir(parents=True, exist_ok=True)
            target = DATA_FILES[name]
            temporary = target.with_suffix(target.suffix + ".import.tmp")
            temporary.write_bytes(content)
            temporary.replace(target)
        return sorted(staged)


def read_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists() or path.stat().st_size == 0:
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        header = source.readline()
        delimiter = ";" if header.count(";") > header.count(",") else ","
        source.seek(0)
        return list(csv.DictReader(source, delimiter=delimiter))


def trophies_payload(running: bool) -> dict:
    core.ensure_rally_progression(RALLY_RESULTS_CSV)
    results = read_csv(RALLY_RESULTS_CSV)
    built = core.build_trophies(results)
    return {
        "mode": "rally_trophies",
        "game_running": running,
        "log_found": core.DEFAULT_LOG.is_file(),
        "trophies": built["trophies"],
        "multiplier": built["multiplier"],
        "summary": {
            "records": len(results),
            "unlocked": built["unlocked"],
            "trophies": built["total"],
        },
    }


def progress_payload(running: bool) -> dict:
    core.ensure_rally_progression(RALLY_RESULTS_CSV)
    results = read_csv(RALLY_RESULTS_CSV)
    built = core.build_rally_progression(results)
    return {
        "mode": "rally_progress",
        "game_running": running,
        "log_found": core.DEFAULT_LOG.is_file(),
        "progression": built["characters"],
        "active_character_id": built["active_character_id"],
        "multiplier": built["multiplier"],
        "summary": {
            "records": len(results),
            "unlocked": built["unlocked"],
            "skins": built["total_skins"],
        },
    }


def display_date(value: str) -> str:
    try:
        return datetime.fromisoformat(value).strftime("%d/%m/%Y")
    except (TypeError, ValueError):
        return "null"


def to_centis(value: str) -> int | None:
    raw = (value or "").strip().replace(",", ".")
    if not raw:
        return None
    if raw[:1] in "+-":
        raw = raw[1:]
    if "." in raw:
        whole, frac = raw.split(".", 1)
        frac = (frac + "00")[:2]
    else:
        whole, frac = raw, "00"
    if not whole.isdigit() or not frac.isdigit():
        return None
    return int(whole) * 100 + int(frac)


def dev_clock(value: str) -> str:
    total = to_centis(value)
    if total is None:
        return (value or "").strip() or "null"
    minutes, rest = divmod(total, 6_000)
    seconds, centis = divmod(rest, 100)
    return f"{minutes}:{seconds:02d}:{centis:02d}"


def beat_flags(time_seconds: str, dev_time: str, velo_time: str) -> dict[str, bool]:
    player = to_centis(time_seconds)
    dev = to_centis(dev_time)
    velo = to_centis(velo_time)
    return {
        "beat_dev": player is not None and dev is not None and player < dev,
        "beat_velo": player is not None and velo is not None and player < velo,
    }


def trial_card(row: dict[str, str], skin_by_raw: dict[str, dict[str, str]]) -> dict | None:
    try:
        seconds = float(row.get("time_seconds", ""))
    except (TypeError, ValueError):
        return None
    skin = (row.get("skin") or "null").strip()
    skin_data = skin_by_raw.get(skin, {})
    return {
        "seconds": seconds,
        "time_seconds": (row.get("time_seconds") or "").strip(),
        "character": (skin_data.get("character") or "").strip() or "null",
        "skin_url": (skin_data.get("url") or "").strip(),
        "time_raw": (row.get("time_raw") or "").strip() or "null",
        "date": display_date(row.get("captured_at", "")),
        "pb": (row.get("pb") or "0").strip(),
        "beat_dev": False,
        "beat_velo": False,
    }


def reference_entry(kind: str, character: str, skin_url: str, raw_time: str) -> dict | None:
    if to_centis(raw_time) is None:
        return None
    return {
        "kind": kind,
        "reference": True,
        "character": character or "null",
        "skin_url": skin_url,
        "time_raw": dev_clock(raw_time),
    }


def track_indicators(rows: list[dict[str, str]]) -> dict:
    ordered: list[tuple[int, float]] = []
    for row in rows:
        try:
            seconds = float(row.get("time_seconds", ""))
        except (TypeError, ValueError):
            continue
        try:
            row_id = int(row.get("id", ""))
        except (TypeError, ValueError):
            row_id = 10**12
        ordered.append((row_id, seconds))
    if not ordered:
        return {"records": len(rows), "absolute": None, "relative": None, "stdev": None}
    ordered.sort(key=lambda item: item[0])
    values = [seconds for _, seconds in ordered]
    first = values[0]
    delta = min(values) - first
    mean = sum(values) / len(values)
    variance = sum((value - mean) ** 2 for value in values) / len(values)
    return {
        "records": len(rows),
        "absolute": round(delta, 2),
        "relative": round(delta / first * 100, 1) if first else None,
        "stdev": round(variance ** 0.5, 2),
    }


def developer_rank(entries: list[dict], raw_time: str) -> int | None:
    target = to_centis(raw_time)
    if target is None:
        return None
    ahead = sum(
        1
        for item in entries
        if (player := to_centis(item.get("time_seconds", ""))) is not None and player <= target
    )
    return ahead + 1


def track_catalog(
    tracks: list[dict[str, str]],
    results: list[dict[str, str]],
    skin_by_raw: dict[str, dict[str, str]],
) -> list[dict]:
    velo_skin = skin_by_raw.get(VELO_SKIN, {})
    velo_name = (velo_skin.get("character") or "").strip() or "Emperor Velo XXVII"
    velo_url = (velo_skin.get("url") or "").strip()
    grouped: dict[str, list[dict]] = {}
    counts: dict[str, int] = {}
    for row in results:
        track = (row.get("track") or "").strip()
        if not track:
            continue
        counts[track] = counts.get(track, 0) + 1
        card = trial_card(row, skin_by_raw)
        if card:
            grouped.setdefault(track, []).append(card)

    catalog = []
    for track_row in tracks:
        key = (track_row.get("track") or "").strip()
        entries = sorted(grouped.get(key, []), key=lambda item: item["seconds"])
        dev_time = track_row.get("dev_time") or ""
        velo_time = track_row.get("velo_time") or ""
        for item in entries:
            flags = beat_flags(item.get("time_seconds", ""), dev_time, velo_time)
            item["beat_dev"] = flags["beat_dev"]
            item["beat_velo"] = flags["beat_velo"]
        dev_time_surpass = 1 if any(item.get("beat_dev") for item in entries) else 0
        dev_entry = reference_entry(
            "dev",
            (track_row.get("dev_name") or "").strip() or "null",
            (track_row.get("dev_url") or "").strip(),
            dev_time,
        )
        if dev_entry is not None:
            dev_entry["rank"] = developer_rank(entries, dev_time)
        references = [
            entry
            for entry in (
                dev_entry,
                reference_entry("velo", velo_name, velo_url, velo_time),
            )
            if entry
        ]
        catalog.append(
            {
                "track": key,
                "track_clean": (track_row.get("track_clean") or "").strip() or "null",
                "url": (track_row.get("url") or "").strip(),
                "dev_time": dev_clock(track_row.get("dev_time") or ""),
                "dev_name": (track_row.get("dev_name") or "").strip() or "null",
                "dev_url": (track_row.get("dev_url") or "").strip(),
                "dev_time_surpass": dev_time_surpass,
                "pb": entries[0]["time_raw"] if entries else "null",
                "records": counts.get(key, 0),
                "references": references,
                "top5": [
                    {k: value for k, value in item.items() if k not in {"seconds", "time_seconds"}}
                    for item in entries[:5]
                ],
            }
        )
    return catalog


def catalog_track(value: str, track_by_raw: dict[str, dict]) -> str:
    """Return the catalog key when value is a real course. Hub and menus are not."""
    text = (value or "").strip()
    if not text or text.casefold() in {"null", "none"}:
        return ""
    folded = text.casefold()
    for key in track_by_raw:
        if key.casefold() == folded:
            return key
    return ""


def is_game_running() -> bool:
    if not hasattr(subprocess, "CREATE_NO_WINDOW"):
        return False
    try:
        result = subprocess.run(
            ["tasklist", "/FO", "CSV", "/NH"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=3,
            creationflags=subprocess.CREATE_NO_WINDOW,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return False

    recognized = {"shadps4", "sacredfire", "crashteamracingnitrofueled"}
    process_ids = []
    for row in csv.reader(result.stdout.splitlines()):
        if len(row) < 2:
            continue
        process_name = re.sub(r"[^a-z0-9]", "", row[0].casefold())
        if process_name.endswith("exe"):
            process_name = process_name[:-3]
        if process_name in recognized and row[1].isdigit():
            process_ids.append(int(row[1]))
    if not process_ids:
        return False

    user32 = ctypes.windll.user32
    visible_process = False

    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    def inspect_window(hwnd, _lparam):
        nonlocal visible_process
        if not user32.IsWindowVisible(hwnd):
            return True
        owner_pid = ctypes.c_ulong()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner_pid))
        if owner_pid.value in process_ids:
            visible_process = True
            return False
        return True

    user32.EnumWindows(inspect_window, 0)
    return visible_process


class DashboardState:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        detected = find_log_file()
        if detected and detected != core.DEFAULT_LOG:
            set_log_file(detected)
        self.metadata = {"track": "", "skin": ""}
        self.game_running = is_game_running()
        self.log = None
        self._open_log(seed=self.game_running)

    def _open_log(self, *, seed: bool = False) -> None:
        if self.log:
            self.log.close()
        self.log = None
        path = core.DEFAULT_LOG
        if not path.is_file():
            path = find_log_file()
            if path:
                core.DEFAULT_LOG = path
        if not path.is_file():
            return
        if seed:
            core.scan_existing_log(path, self.metadata)
        self.log = path.open("r", encoding="utf-8", errors="replace")
        self.log.seek(0, 2)

    def poll_log(self) -> None:
        with self.lock:
            if not self.log:
                return
            try:
                if core.DEFAULT_LOG.stat().st_size < self.log.tell():
                    self.log.seek(0)
                while True:
                    line = self.log.readline()
                    if not line:
                        break
                    core.extract_metadata(line, self.metadata)
            except OSError:
                return

    def refresh_game_status(self) -> None:
        running_now = is_game_running()
        with self.lock:
            was_running = self.game_running
            self.game_running = running_now
        if running_now and not was_running:
            with self.lock:
                self.metadata = {"track": "", "skin": ""}
                self._open_log(seed=True)

    def update_log(self, path: Path | None) -> dict:
        with self.lock:
            set_log_file(path)
            self.metadata = {"track": "", "skin": ""}
            self._open_log(seed=self.game_running)
        return {"log_path": str(path) if path and path.is_file() else "", "log_found": bool(path and path.is_file())}

    def get_payload(self, browse_track: str = "", mode: str = "time_trial") -> dict:
        self.refresh_game_status()
        self.poll_log()
        if mode == "rally_progress":
            with self.lock:
                running = self.game_running
            return progress_payload(running)
        if mode == "rally_trophies":
            with self.lock:
                running = self.game_running
            return trophies_payload(running)
        tracks = read_csv(TRACKS_CSV)
        skins = read_csv(SKINS_CSV)
        rally_mode = mode == "rally_ring"
        results_path = RALLY_RESULTS_CSV if rally_mode else RESULTS_CSV
        if rally_mode:
            core.ensure_rally_progression(RALLY_RESULTS_CSV)
        results = read_csv(results_path)
        skin_by_raw = {row.get("skin", ""): row for row in skins}
        track_by_raw = {row.get("track", ""): row for row in tracks}

        browse_track = (browse_track or "").strip()
        with self.lock:
            running = self.game_running
            live_meta = dict(self.metadata)
        newest = results[-1] if results else None
        live_track = catalog_track(live_meta.get("track", ""), track_by_raw)
        last_saved = catalog_track((newest.get("track") if newest else "") or "", track_by_raw)
        # After a race the game loads the hub. That level is not a course, so the
        # panel keeps the track of this mode's last saved record. The live skin stays.
        if running and live_track:
            selected_track = live_track
        elif not running and browse_track in track_by_raw:
            selected_track = browse_track
        else:
            selected_track = last_saved
        current_track = track_by_raw.get(selected_track, {})

        track_times: list[dict] = []
        for row in results:
            track = (row.get("track") or "null").strip()
            if track != selected_track:
                continue
            skin = (row.get("skin") or "null").strip()
            try:
                value = int(row.get("score", "")) if rally_mode else float(row.get("time_seconds", ""))
            except (TypeError, ValueError):
                continue
            skin_data = skin_by_raw.get(skin, {})
            track_times.append(
                {
                    "track": track,
                    "track_clean": (current_track.get("track_clean") or "").strip() or "null",
                    "skin": skin,
                    "character": (skin_data.get("character") or "").strip() or "null",
                    "skin_url": (skin_data.get("url") or "").strip(),
                    "seconds": value,
                    "time_raw": (row.get("score") if rally_mode else row.get("time_raw") or "").strip() or "null",
                    "score": (row.get("score") or "").strip(),
                    "laps": (row.get("laps") or "").strip(),
                    "date": display_date(row.get("captured_at", "")),
                    "pb": (row.get("pb") or "0").strip(),
                    **({"beat_dev": False, "beat_velo": False} if rally_mode else beat_flags(
                        row.get("time_seconds", ""),
                        current_track.get("dev_time", ""),
                        current_track.get("velo_time", ""),
                    )),
                }
            )
        top10 = sorted(track_times, key=lambda item: item["seconds"], reverse=rally_mode)[:10]

        last = None
        if newest:
            track = (newest.get("track") or "null").strip()
            skin = (newest.get("skin") or "null").strip()
            track_data = track_by_raw.get(track, {})
            skin_data = skin_by_raw.get(skin, {})
            last = {
                "track": track,
                "track_clean": (track_data.get("track_clean") or "").strip() or "null",
                "character": (skin_data.get("character") or "").strip() or "null",
                "skin": skin,
                "time_raw": (newest.get("score") if rally_mode else newest.get("time_raw") or "").strip() or "null",
                "score": (newest.get("score") or "").strip(),
                "laps": (newest.get("laps") or "").strip(),
                "pb": (newest.get("pb") or "0").strip(),
                "delta_pb": (newest.get("delta_pb") or "").strip(),
                **(
                    {
                        "score_mult": (newest.get("score_mult") or "").strip(),
                        "multiplier": (newest.get("multiplier") or "").strip(),
                        "notes": (newest.get("notes") or "").strip(),
                    }
                    if rally_mode
                    else {}
                ),
                **({"beat_dev": False, "beat_velo": False} if rally_mode else beat_flags(
                    newest.get("time_seconds", ""),
                    track_data.get("dev_time", ""),
                    track_data.get("velo_time", ""),
                )),
            }
        live_skin = (live_meta.get("skin") or "").strip()
        if running:
            selected = {"track": selected_track, "skin": live_skin}
        else:
            last_skin = (newest.get("skin") or "").strip() if newest else ""
            selected = {"track": selected_track, "skin": last_skin or live_skin}

        catalog = track_catalog(tracks, results, skin_by_raw) if not rally_mode else [
            {
                "track": row.get("track", ""),
                "track_clean": row.get("track_clean", ""),
                "records": sum(1 for result in results if result.get("track") == row.get("track")),
                "url": row.get("url", ""),
            }
            for row in tracks
        ]
        devs_beaten = sum(track.get("dev_time_surpass", 0) for track in catalog)
        return {
            "tracks": tracks,
            "skins": skins,
            "selected": selected,
            "game_running": running,
            "log_found": core.DEFAULT_LOG.is_file(),
            "current_track": {
                "track": selected_track,
                "track_clean": (current_track.get("track_clean") or "").strip() or "null",
            },
            "last_trial": last,
            "top10": top10,
            "catalog": catalog,
            "summary": {
                "records": len(results),
                "devs_beaten": 0 if rally_mode else devs_beaten,
                "tracks": len(catalog),
            },
            "mode": "rally_ring" if rally_mode else "time_trial",
            "indicators": None if rally_mode else track_indicators(
                [row for row in results if (row.get("track") or "").strip() == selected_track]
            ),
        }


STATE = DashboardState()


class DashboardServer(ThreadingHTTPServer):
    """One dashboard owns the port. A second launch must move to the next free port."""

    allow_reuse_address = False


class Handler(BaseHTTPRequestHandler):
    server_version = "CTRTimeTrialDashboard/1.0"

    def log_message(self, format: str, *args) -> None:
        return

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/state":
            browse = parse_qs(urlparse(self.path).query).get("track", [""])[0]
            mode = parse_qs(urlparse(self.path).query).get("mode", ["time_trial"])[0]
            payload = json.dumps(STATE.get_payload(browse, mode), ensure_ascii=False).encode("utf-8")
            self._send(200, payload, "application/json; charset=utf-8")
            return
        if path == "/api/assets-version":
            try:
                version = "|".join(
                    f"{name}:{(WEB_DIR / name).stat().st_mtime_ns}:{(WEB_DIR / name).stat().st_size}"
                    for name in ("index.html", "style.css", "app.js")
                )
                self._send(200, json.dumps({"version": version}).encode("utf-8"), "application/json; charset=utf-8")
            except OSError as exc:
                self._send(500, json.dumps({"error": str(exc)}).encode("utf-8"), "application/json; charset=utf-8")
            return

        if path in {"/logo.png", "/favicon.ico"}:
            try:
                self._send(200, LOGO_PATH.read_bytes(), "image/png")
            except OSError:
                self._send(404, b"Logo not found", "text/plain; charset=utf-8")
            return

        files = {
            "/": ("index.html", "text/html; charset=utf-8"),
            "/index.html": ("index.html", "text/html; charset=utf-8"),
            "/style.css": ("style.css", "text/css; charset=utf-8"),
            "/app.js": ("app.js", "text/javascript; charset=utf-8"),
        }
        entry = files.get(path)
        if entry:
            filename, content_type = entry
            try:
                self._send(200, (WEB_DIR / filename).read_bytes(), content_type)
            except OSError:
                self._send(404, b"Dashboard asset not found", "text/plain; charset=utf-8")
            return
        self._send(404, b"Not found", "text/plain; charset=utf-8")

    def do_POST(self) -> None:
        route = urlparse(self.path).path
        if route != "/api/record":
            self._send(404, b"Not found", "text/plain; charset=utf-8")
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            data = json.loads(self.rfile.read(size).decode("utf-8"))
            STATE.refresh_game_status()
            with STATE.lock:
                game_running = STATE.game_running
            if not game_running:
                raise ValueError("El juego tiene que estar abierto para guardar un registro.")
            mode = str(data.get("mode") or "time_trial")
            unlocks: list = []
            if mode == "rally_ring":
                record, unlocks = core.save_rally_record(str(data.get("track") or "null"), str(data.get("skin") or "null"), str(data.get("score") or ""), str(data.get("laps") or ""), RALLY_RESULTS_CSV)
            else:
                record = core.save_record(str(data.get("track") or "null"), str(data.get("skin") or "null"), str(data.get("time") or ""), RESULTS_CSV)
            body = json.dumps({"record": record, "unlocks": unlocks}, ensure_ascii=False).encode("utf-8")
            self._send(200, body, "application/json; charset=utf-8")
        except (ValueError, OSError, csv.Error, json.JSONDecodeError) as exc:
            body = json.dumps({"error": str(exc)}, ensure_ascii=False).encode("utf-8")
            self._send(400, body, "application/json; charset=utf-8")


def create_dashboard_server(parser_port: int = 8899) -> DashboardServer:
    if not WEB_DIR.is_dir():
        raise FileNotFoundError(f"No existe la carpeta de interfaz: {WEB_DIR}")
    if not 1 <= parser_port <= 65535:
        raise ValueError("el puerto debe estar entre 1 y 65535")
    server = None
    for port in (parser_port, *range(parser_port + 1, min(parser_port + 16, 65536))):
        try:
            server = DashboardServer(("127.0.0.1", port), Handler)
            break
        except OSError:
            continue
    if server is None:
        raise OSError(f"No hay puertos locales disponibles desde {parser_port} hasta {min(parser_port + 15, 65535)}.")
    return server


def run_server_only(parser_port: int = 8899) -> None:
    server = create_dashboard_server(parser_port)

    url = f"http://127.0.0.1:{server.server_address[1]}/"
    print(f"CTR Nitro-Fueled dashboard: {url}")
    print(f"Time Trial CSV: {RESULTS_CSV}")
    print(f"Rally Ring CSV: {RALLY_RESULTS_CSV}")
    print("Deja este servidor abierto; web/ se recarga automáticamente al editar la interfaz. Ctrl+C para cerrar.")
    webbrowser.open(url)
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        print("\nDashboard cerrado.")
    finally:
        server.server_close()


class DashboardLauncher:
    BG = "#10131b"
    PANEL = "#1a202c"
    LINE = "#303b4e"
    TEXT = "#f2f5fa"
    MUTED = "#a8b2c2"
    ACCENT = "#f3a712"
    BLUE = "#145da0"
    BLUE_HOVER = "#1d78c1"
    GOOD = "#68d391"

    def __init__(self, root, parser_port: int = 8899) -> None:
        import tkinter as tk
        from tkinter import filedialog, ttk

        self.tk = tk
        self.filedialog = filedialog
        self.root = root
        self.parser_port = parser_port
        self.server = None
        self.server_thread = None
        self.url = ""
        self.closing = False
        self.root.title(APP_NAME)
        self.root.configure(bg=self.BG)
        self.root.resizable(True, True)
        screen_width = self.root.winfo_screenwidth()
        screen_height = self.root.winfo_screenheight()
        window_width = max(900, min(1000, screen_width - 40))
        window_height = max(680, min(840, screen_height - 90))
        self.root.minsize(min(900, window_width), 680)
        self.root.geometry(f"{window_width}x{window_height}")
        self.root.protocol("WM_DELETE_WINDOW", self.close)
        if ICON_PATH.is_file():
            try:
                self.root.iconbitmap(str(ICON_PATH))
            except tk.TclError:
                pass

        style = ttk.Style(root)
        style.theme_use("clam")
        style.configure("Launcher.TFrame", background=self.BG)
        style.configure("Panel.TFrame", background=self.PANEL)
        style.configure("Title.TLabel", background=self.BG, foreground=self.TEXT, font=("Segoe UI", 18, "bold"))
        style.configure("Eyebrow.TLabel", background=self.BG, foreground=self.ACCENT, font=("Segoe UI", 9, "bold"))
        style.configure("Body.TLabel", background=self.BG, foreground=self.MUTED, font=("Segoe UI", 10))
        style.configure("PanelTitle.TLabel", background=self.PANEL, foreground=self.TEXT, font=("Segoe UI", 15, "bold"))
        style.configure("Status.TLabel", background=self.PANEL, foreground=self.MUTED, font=("Segoe UI", 10))
        style.configure("Accent.TButton", font=("Segoe UI", 13, "bold"), padding=(16, 15), background=self.BLUE, foreground=self.TEXT)
        style.map("Accent.TButton", background=[("active", self.BLUE_HOVER), ("disabled", "#35465b")])
        style.configure("Secondary.TButton", font=("Segoe UI", 10), padding=(12, 8), background="#202838", foreground=self.TEXT)
        style.map("Secondary.TButton", background=[("active", "#303b4e")])
        style.configure("Side.TFrame", background="#151b26")
        style.configure("SideTitle.TLabel", background="#151b26", foreground=self.MUTED, font=("Segoe UI", 9, "bold"))
        style.configure("SideActive.TLabel", background=self.BLUE, foreground=self.TEXT, font=("Segoe UI", 10, "bold"), padding=(12, 11))
        style.configure("SideLabel.TLabel", background="#151b26", foreground=self.MUTED, font=("Segoe UI", 8, "bold"))
        style.configure("SideValue.TLabel", background="#151b26", foreground=self.TEXT, font=("Segoe UI", 9), wraplength=185)
        style.configure("Footer.TLabel", background=self.BG, foreground=self.MUTED, font=("Segoe UI", 9))
        style.configure("Nav.TButton", font=("Segoe UI", 10), padding=(12, 10), background="#151b26", foreground=self.TEXT, anchor="w")
        style.map("Nav.TButton", background=[("active", "#202838")])
        style.configure("NavActive.TButton", font=("Segoe UI", 10, "bold"), padding=(12, 10), background=self.BLUE, foreground=self.TEXT, anchor="w")
        style.map("NavActive.TButton", background=[("active", self.BLUE_HOVER)])
        style.configure("Settings.TButton", font=("Segoe UI", 10, "bold"), padding=(12, 9), background=self.BLUE, foreground=self.TEXT)
        style.map("Settings.TButton", background=[("active", self.BLUE_HOVER)])
        style.configure("Update.TFrame", background="#142b46")
        style.configure("Update.TLabel", background="#142b46", foreground=self.TEXT, font=("Segoe UI", 9))
        style.configure("UpdateLink.TButton", font=("Segoe UI", 9, "bold"), padding=(9, 5), background=self.BLUE, foreground=self.TEXT)
        style.map("UpdateLink.TButton", background=[("active", self.BLUE_HOVER)])
        style.configure("UpdateQuiet.TButton", font=("Segoe UI", 9), padding=(8, 5), background="#202838", foreground=self.TEXT)
        style.map("UpdateQuiet.TButton", background=[("active", "#303b4e")])

        shell = ttk.Frame(root, style="Launcher.TFrame", padding=(18, 14))
        shell.pack(fill="both", expand=True)
        top = ttk.Frame(shell, style="Panel.TFrame", padding=5)
        top.pack(fill="x")
        self.cover = None
        if COVER_PATH.is_file():
            try:
                self.cover = tk.PhotoImage(file=str(COVER_PATH))
                tk.Label(top, image=self.cover, bg=self.PANEL, borderwidth=0).pack(anchor="center")
            except tk.TclError:
                self.cover = None

        self.release_url = GITHUB_RELEASES_URL
        self.dismissed_update = False
        self.update_banner = ttk.Frame(shell, style="Update.TFrame", padding=(12, 8))
        self.update_banner.pack(fill="x", pady=(8, 0))
        self.update_status_var = tk.StringVar(value="Comprobando actualizaciones…")
        ttk.Label(self.update_banner, textvariable=self.update_status_var, style="Update.TLabel", wraplength=520).pack(side="left", fill="x", expand=True, padx=(2, 12))
        update_actions = ttk.Frame(self.update_banner, style="Update.TFrame")
        update_actions.pack(side="right")
        self.update_button = ttk.Button(update_actions, text="Actualizar ahora", style="UpdateLink.TButton", command=self.open_latest_release, state="disabled")
        self.update_button.pack(side="left")
        self.news_button = ttk.Button(update_actions, text="Ver Releases", style="UpdateQuiet.TButton", command=self.open_latest_release)
        self.news_button.pack(side="left", padx=(6, 0))
        self.dismiss_button = ttk.Button(update_actions, text="Ahora no", style="UpdateQuiet.TButton", command=self.dismiss_update, state="disabled")
        self.dismiss_button.pack(side="left", padx=(6, 0))
        self.review_button = ttk.Button(update_actions, text="Revisar", style="UpdateQuiet.TButton", command=self.check_updates)
        self.review_button.pack(side="left", padx=(6, 0))
        self.update_button.pack_forget()
        self.dismiss_button.pack_forget()

        content = ttk.Frame(shell, style="Launcher.TFrame")
        content.pack(fill="both", expand=True, pady=(14, 0))
        sidebar = ttk.Frame(content, style="Side.TFrame", width=220, padding=(12, 16))
        sidebar.pack(side="left", fill="y", padx=(0, 14))
        sidebar.pack_propagate(False)
        ttk.Label(sidebar, text="NAVEGACIÓN", style="SideTitle.TLabel").pack(anchor="w", padx=8, pady=(4, 13))
        self.server_nav_button = ttk.Button(sidebar, text="▰   Servidor", style="NavActive.TButton", command=self.show_server_page)
        self.server_nav_button.pack(fill="x")
        self.settings_nav_button = ttk.Button(sidebar, text="⚙   Configuración", style="Nav.TButton", command=self.show_settings_page)
        self.settings_nav_button.pack(fill="x", pady=(5, 0))
        ttk.Label(sidebar, text="ESTADO", style="SideLabel.TLabel").pack(anchor="w", padx=8, pady=(27, 6))
        self.side_state_var = tk.StringVar(value="Detenido")
        ttk.Label(sidebar, textvariable=self.side_state_var, style="SideValue.TLabel").pack(anchor="w", padx=8)
        ttk.Label(sidebar, text="CONEXIÓN", style="SideLabel.TLabel").pack(anchor="w", padx=8, pady=(20, 6))
        ttk.Label(sidebar, text="Solo en este equipo", style="SideValue.TLabel").pack(anchor="w", padx=8)
        ttk.Label(sidebar, text="DATOS PERSONALES", style="SideLabel.TLabel").pack(anchor="w", padx=8, pady=(20, 6))
        ttk.Label(sidebar, text="%LOCALAPPDATA%\\CTRNF\\\ndata", style="SideValue.TLabel").pack(anchor="w", padx=8)

        self.workspace = ttk.Frame(content, style="Launcher.TFrame")
        self.workspace.pack(side="left", fill="both", expand=True)
        self.server_page = ttk.Frame(self.workspace, style="Panel.TFrame", padding=(26, 24))
        self.server_page.pack(fill="both", expand=True)
        card = self.server_page
        ttk.Label(card, text="JUEGO  /  SERVIDOR LOCAL", style="Eyebrow.TLabel", background=self.PANEL).pack(anchor="w")
        ttk.Label(card, text="Conecta tu dashboard", style="PanelTitle.TLabel").pack(anchor="w", pady=(7, 0))
        ttk.Label(card, text="Arranca el servidor para registrar partidas y consultar tu progreso.", style="Status.TLabel", wraplength=600).pack(anchor="w", pady=(6, 18))
        self.status_var = tk.StringVar(value="Servidor detenido")
        self.status_label = ttk.Label(card, textvariable=self.status_var, style="Status.TLabel", wraplength=600)
        self.status_label.pack(anchor="w", pady=(0, 18))
        self.start_button = ttk.Button(card, text="INICIAR SERVIDOR", style="Accent.TButton", command=self.start)
        self.start_button.pack(fill="x")
        actions = ttk.Frame(card, style="Panel.TFrame")
        actions.pack(fill="x", pady=(12, 0))
        self.open_button = ttk.Button(actions, text="Abrir dashboard", style="Secondary.TButton", command=self.open_dashboard, state="disabled")
        self.open_button.pack(side="left", padx=(10, 0))
        self.stop_button = ttk.Button(actions, text="Detener", style="Secondary.TButton", command=self.stop, state="disabled")
        self.stop_button.pack(side="right")
        ttk.Separator(card, orient="horizontal").pack(fill="x", pady=(25, 14))
        ttk.Label(card, text="La interfaz se abrirá en tu navegador predeterminado. El servidor permanece activo mientras esta ventana esté abierta.", style="Status.TLabel", wraplength=600).pack(anchor="w")

        self.settings_page = ttk.Frame(self.workspace, style="Panel.TFrame", padding=(20, 16))
        ttk.Label(self.settings_page, text="CONFIGURACIÓN  /  PREFERENCIAS LOCALES", style="Eyebrow.TLabel", background=self.PANEL).pack(anchor="w")
        ttk.Label(self.settings_page, text="Configuración", style="PanelTitle.TLabel").pack(anchor="w", pady=(7, 0))

        log_panel = ttk.Frame(self.settings_page, style="Panel.TFrame")
        log_panel.pack(fill="x", pady=(14, 0))
        ttk.Label(log_panel, text="Archivo de registro del juego", style="PanelTitle.TLabel").pack(anchor="w")
        ttk.Label(log_panel, text="Se busca automáticamente al iniciar. Si no se encuentra, selecciona el archivo .log de tu instalación.", style="Status.TLabel", wraplength=600).pack(anchor="w", pady=(6, 10))
        self.log_path_var = tk.StringVar(value="Buscando archivo de log…")
        ttk.Label(log_panel, textvariable=self.log_path_var, style="Status.TLabel", wraplength=600).pack(anchor="w", pady=(0, 10))
        ttk.Button(log_panel, text="Elegir archivo .log…", style="Secondary.TButton", command=self.choose_log).pack(anchor="w")

        backup_panel = ttk.Frame(self.settings_page, style="Panel.TFrame")
        backup_panel.pack(fill="x", pady=(20, 0))
        ttk.Label(backup_panel, text="Importar y exportar datos", style="PanelTitle.TLabel").pack(anchor="w")
        ttk.Label(backup_panel, text="Exporta los CSV personales en un respaldo ZIP. La importación solo restaura datasets vacíos; no reemplaza registros existentes.", style="Status.TLabel", wraplength=600).pack(anchor="w", pady=(6, 10))
        self.data_count_var = tk.StringVar(value="")
        ttk.Label(backup_panel, textvariable=self.data_count_var, style="Status.TLabel").pack(anchor="w", pady=(0, 12))
        backup_actions = ttk.Frame(backup_panel, style="Panel.TFrame")
        backup_actions.pack(fill="x")
        ttk.Button(backup_actions, text="Exportar respaldo…", style="Settings.TButton", command=self.export_backup).pack(side="left")
        ttk.Button(backup_actions, text="Importar respaldo…", style="Secondary.TButton", command=self.import_backup).pack(side="left", padx=(10, 0))

        self.settings_status_var = tk.StringVar(value="")
        self.settings_status_label = ttk.Label(self.settings_page, textvariable=self.settings_status_var, style="Status.TLabel", wraplength=600)
        self.settings_status_label.pack(anchor="w", pady=(12, 0))
        self.refresh_settings()

        footer = ttk.Frame(shell, style="Launcher.TFrame")
        footer.pack(side="bottom", fill="x", pady=(12, 0))
        ttk.Label(footer, text=APP_VERSION, style="Footer.TLabel").pack(side="left", anchor="w")
        ttk.Label(footer, text="Desarrollado por Julián Gómez", style="Footer.TLabel").pack(side="right", anchor="e")
        self.check_updates()

    def start(self) -> None:
        self.start_button.configure(state="disabled")
        self.status_var.set("Iniciando servidor…")
        threading.Thread(target=self._start_server, daemon=True).start()

    def check_updates(self) -> None:
        self.review_button.configure(state="disabled")
        self.update_status_var.set("Comprobando actualizaciones de GitHub…")
        threading.Thread(target=self._fetch_releases, daemon=True).start()

    def _fetch_releases(self) -> None:
        state = "error"
        release = None
        try:
            request = urllib.request.Request(
                GITHUB_RELEASES_API,
                headers={"Accept": "application/vnd.github+json", "User-Agent": "CTRNF-Personal-Dashboard"},
            )
            with urllib.request.urlopen(request, timeout=5) as response:
                releases = json.loads(response.read().decode("utf-8"))
            available = []
            for item in releases:
                if item.get("draft"):
                    continue
                key = version_key(item.get("tag_name", ""))
                if key is not None:
                    available.append((key, item))
            if not available:
                state = "none"
            else:
                latest_key, latest = max(available, key=lambda pair: pair[0])
                current_key = version_key(APP_VERSION_TAG)
                if current_key is not None and latest_key > current_key:
                    state, release = "update", latest
                else:
                    state, release = "current", latest
        except urllib.error.HTTPError as exc:
            state = "none" if exc.code == 404 else "error"
        except (OSError, ValueError, json.JSONDecodeError):
            state = "error"
        try:
            self.root.after(0, lambda: self._show_release_state(state, release))
        except self.tk.TclError:
            pass

    def _show_release_state(self, state: str, release: dict | None) -> None:
        self.review_button.configure(state="normal")
        self.update_button.pack_forget()
        self.dismiss_button.pack_forget()
        self.update_button.configure(state="disabled")
        self.dismiss_button.configure(state="disabled")
        self.release_url = GITHUB_RELEASES_URL
        if state == "update" and release:
            tag = release.get("tag_name", "Nueva versión")
            self.release_url = release.get("html_url") or GITHUB_RELEASES_URL
            self.update_status_var.set(f"Nueva actualización disponible: {tag}  ·  instalada {APP_VERSION_TAG}")
            self.update_button.configure(state="normal")
            self.dismiss_button.configure(state="normal")
            self.update_button.pack(side="left", before=self.news_button)
            self.dismiss_button.pack(side="left", before=self.review_button, padx=(6, 0))
            self.news_button.configure(text="Novedades")
        elif state == "current" and release:
            self.update_status_var.set(f"Estás al día: {APP_VERSION_TAG}. Última publicada: {release.get('tag_name', APP_VERSION_TAG)}.")
            self.news_button.configure(text="Ver Releases")
        elif state == "none":
            self.update_status_var.set("Aún no hay versiones publicadas. El aviso aparecerá aquí cuando publiques una GitHub Release.")
            self.news_button.configure(text="Ver Releases")
        else:
            self.update_status_var.set("No se pudo comprobar GitHub Releases. Puedes volver a intentarlo.")
            self.news_button.configure(text="Ver Releases")

    def open_latest_release(self) -> None:
        webbrowser.open(self.release_url)

    def dismiss_update(self) -> None:
        self.dismissed_update = True
        self.update_banner.pack_forget()

    def show_server_page(self) -> None:
        self.settings_page.pack_forget()
        self.server_page.pack(fill="both", expand=True)
        self.server_nav_button.configure(style="NavActive.TButton")
        self.settings_nav_button.configure(style="Nav.TButton")

    def show_settings_page(self) -> None:
        self.server_page.pack_forget()
        self.settings_page.pack(fill="both", expand=True)
        self.server_nav_button.configure(style="Nav.TButton")
        self.settings_nav_button.configure(style="NavActive.TButton")
        self.refresh_settings()

    def refresh_settings(self) -> None:
        log_path = core.DEFAULT_LOG
        if not log_path.is_file():
            detected = find_log_file()
            if detected:
                STATE.update_log(detected)
                log_path = detected
        self.log_path_var.set(f"{log_path.parent}\n{log_path.name}" if log_path.is_file() else "No se encontró un archivo .log. Selecciona la ruta manualmente.")
        tt_count = len(read_csv(RESULTS_CSV))
        rally_count = len(read_csv(RALLY_RESULTS_CSV))
        self.data_count_var.set(f"Time Trial: {tt_count} registros     ·     Rally Ring: {rally_count} registros")

    def choose_log(self) -> None:
        chosen = self.filedialog.askopenfilename(
            parent=self.root,
            title="Seleccionar el log del juego",
            filetypes=(("Archivo de registro", "*.log"), ("Todos los archivos", "*.*")),
        )
        if not chosen:
            return
        try:
            STATE.update_log(Path(chosen))
            self.settings_status_var.set("Ruta del log guardada.")
            self.settings_status_label.configure(foreground=self.GOOD)
            self.refresh_settings()
        except (OSError, ValueError) as exc:
            self.settings_status_var.set(str(exc))
            self.settings_status_label.configure(foreground="#ff8585")

    def export_backup(self) -> None:
        chosen = self.filedialog.asksaveasfilename(
            parent=self.root,
            title="Exportar respaldo CTRNF",
            initialfile="CTRNF-respaldo.zip",
            defaultextension=".zip",
            filetypes=(("Respaldo CTRNF", "*.zip"),),
        )
        if not chosen:
            return
        try:
            export_data(Path(chosen))
            self.settings_status_var.set("Respaldo exportado correctamente.")
            self.settings_status_label.configure(foreground=self.GOOD)
        except (OSError, ValueError, zipfile.BadZipFile) as exc:
            self.settings_status_var.set(str(exc))
            self.settings_status_label.configure(foreground="#ff8585")

    def import_backup(self) -> None:
        chosen = self.filedialog.askopenfilename(
            parent=self.root,
            title="Importar respaldo CTRNF",
            filetypes=(("Respaldo CTRNF", "*.zip"),),
        )
        if not chosen:
            return
        try:
            imported = import_data(Path(chosen))
            self.settings_status_var.set("Importados: " + ", ".join(imported))
            self.settings_status_label.configure(foreground=self.GOOD)
            self.refresh_settings()
        except (OSError, ValueError, zipfile.BadZipFile, UnicodeDecodeError, csv.Error) as exc:
            self.settings_status_var.set(str(exc))
            self.settings_status_label.configure(foreground="#ff8585")

    def _start_server(self) -> None:
        try:
            server = create_dashboard_server(self.parser_port)
            self.server = server
            self.url = f"http://127.0.0.1:{server.server_address[1]}/"
            self.server_thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.5}, daemon=True)
            self.server_thread.start()
            if self.closing:
                server.shutdown()
                server.server_close()
                return
            try:
                self.root.after(0, self._server_started)
            except self.tk.TclError:
                server.shutdown()
                server.server_close()
        except Exception as exc:
            self.root.after(0, lambda message=str(exc): self._server_failed(message))

    def _server_started(self) -> None:
        self.status_var.set(f"Servidor activo en el puerto {self.server.server_address[1]}")
        self.side_state_var.set("● Activo")
        self.status_label.configure(foreground=self.GOOD)
        self.open_button.configure(state="normal")
        self.stop_button.configure(state="normal")
        self.start_button.configure(state="disabled")
        self.open_dashboard()

    def _server_failed(self, message: str) -> None:
        self.status_var.set(f"No se pudo iniciar el servidor: {message}")
        self.side_state_var.set("No disponible")
        self.status_label.configure(foreground="#ff8585")
        self.start_button.configure(state="normal")

    def open_dashboard(self) -> None:
        if self.url:
            webbrowser.open(self.url)

    def stop(self) -> None:
        server = self.server
        if not server:
            return
        self.server = None
        self.url = ""
        self.open_button.configure(state="disabled")
        self.stop_button.configure(state="disabled")
        self.start_button.configure(state="normal")
        self.status_var.set("Servidor detenido")
        self.side_state_var.set("Detenido")
        self.status_label.configure(foreground=self.MUTED)
        threading.Thread(target=lambda: (server.shutdown(), server.server_close()), daemon=True).start()

    def close(self) -> None:
        self.closing = True
        self.stop()
        self.root.destroy()


def run_launcher(parser_port: int = 8899) -> None:
    import tkinter as tk

    root = tk.Tk()
    DashboardLauncher(root, parser_port)
    root.mainloop()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8899, help="puerto local del dashboard (por defecto: 8899)")
    parser.add_argument("--server-only", action="store_true", help="inicia el servidor sin la ventana lanzadora")
    args = parser.parse_args()
    if args.server_only:
        run_server_only(args.port)
    else:
        run_launcher(args.port)


if __name__ == "__main__":
    main()
