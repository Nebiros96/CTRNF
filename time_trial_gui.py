#!/usr/bin/env python3
"""Local API server for the CTRNF dashboard in web/."""

from __future__ import annotations

import argparse
import csv
import ctypes
import json
import re
import subprocess
import threading
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import time_trial_logger as core

ROOT = Path(__file__).resolve().parent
WEB_DIR = ROOT / "web"
DATA_DIR = ROOT / "data"
TRACKS_CSV = DATA_DIR / "game_tracks.csv"
SKINS_CSV = DATA_DIR / "game_skins.csv"
RESULTS_CSV = core.CSV_PATH


def read_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists() or path.stat().st_size == 0:
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        header = source.readline()
        delimiter = ";" if header.count(";") > header.count(",") else ","
        source.seek(0)
        return list(csv.DictReader(source, delimiter=delimiter))


def display_date(value: str) -> str:
    try:
        return datetime.fromisoformat(value).strftime("%d/%m/%Y")
    except (TypeError, ValueError):
        return "null"


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
        self.metadata = {"track": "", "skin": ""}
        self.game_running = is_game_running()
        if self.game_running and core.DEFAULT_LOG.is_file():
            core.scan_existing_log(core.DEFAULT_LOG, self.metadata)
        self.log = None
        if core.DEFAULT_LOG.is_file():
            self.log = core.DEFAULT_LOG.open("r", encoding="utf-8", errors="replace")
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
        if running_now and not was_running and core.DEFAULT_LOG.is_file():
            live_meta = {"track": "", "skin": ""}
            core.scan_existing_log(core.DEFAULT_LOG, live_meta)
            with self.lock:
                self.metadata = live_meta
                if self.log:
                    self.log.close()
                self.log = core.DEFAULT_LOG.open("r", encoding="utf-8", errors="replace")
                self.log.seek(0, 2)

    def get_payload(self) -> dict:
        self.refresh_game_status()
        self.poll_log()
        tracks = read_csv(TRACKS_CSV)
        skins = read_csv(SKINS_CSV)
        results = read_csv(RESULTS_CSV)
        skin_by_raw = {row.get("skin", ""): row for row in skins}
        track_by_raw = {row.get("track", ""): row for row in tracks}

        with self.lock:
            running = self.game_running
            selected_track = self.metadata.get("track", "") if running else ""
        if not running and not selected_track and results:
            selected_track = (results[-1].get("track") or "").strip()
        current_track = track_by_raw.get(selected_track, {})

        track_times: list[dict] = []
        for row in results:
            track = (row.get("track") or "null").strip()
            if track != selected_track:
                continue
            skin = (row.get("skin") or "null").strip()
            try:
                seconds = float(row.get("time_seconds", ""))
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
                    "seconds": seconds,
                    "time_raw": (row.get("time_raw") or "").strip() or "null",
                    "date": display_date(row.get("captured_at", "")),
                    "pb": (row.get("pb") or "0").strip(),
                }
            )
        top10 = sorted(track_times, key=lambda item: item["seconds"])[:10]

        newest = results[-1] if results else None
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
                "time_raw": (newest.get("time_raw") or "").strip() or "null",
            }
        with self.lock:
            selected = dict(self.metadata)
        if not running and last:
            selected = {"track": last["track"], "skin": last["skin"]}

        return {
            "tracks": tracks,
            "skins": skins,
            "selected": selected,
            "game_running": running,
            "current_track": {
                "track": selected_track,
                "track_clean": (current_track.get("track_clean") or "").strip() or "null",
            },
            "last_trial": last,
            "top10": top10,
        }


STATE = DashboardState()


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
            payload = json.dumps(STATE.get_payload(), ensure_ascii=False).encode("utf-8")
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
        if urlparse(self.path).path != "/api/record":
            self._send(404, b"Not found", "text/plain; charset=utf-8")
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            data = json.loads(self.rfile.read(size).decode("utf-8"))
            record = core.save_record(
                str(data.get("track") or "null"),
                str(data.get("skin") or "null"),
                str(data.get("time") or ""),
                RESULTS_CSV,
            )
            body = json.dumps({"record": record}, ensure_ascii=False).encode("utf-8")
            self._send(200, body, "application/json; charset=utf-8")
        except (ValueError, OSError, csv.Error, json.JSONDecodeError) as exc:
            body = json.dumps({"error": str(exc)}, ensure_ascii=False).encode("utf-8")
            self._send(400, body, "application/json; charset=utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8899, help="puerto local del dashboard (por defecto: 8899)")
    args = parser.parse_args()

    if not WEB_DIR.is_dir():
        raise SystemExit(f"No existe la carpeta de interfaz: {WEB_DIR}")
    parser_port = args.port
    if not 1 <= parser_port <= 65535:
        parser.error("el puerto debe estar entre 1 y 65535")
    server = None
    for port in (parser_port, *range(parser_port + 1, min(parser_port + 16, 65536))):
        try:
            server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
            break
        except OSError:
            continue
    if server is None:
        raise SystemExit(f"No hay puertos locales disponibles desde {parser_port} hasta {min(parser_port + 15, 65535)}.")

    url = f"http://127.0.0.1:{server.server_address[1]}/"
    print(f"Time Trial dashboard: {url}")
    print("Deja este servidor abierto; web/ se recarga automáticamente al editar la interfaz. Ctrl+C para cerrar.")
    webbrowser.open(url)
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        print("\nDashboard cerrado.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
