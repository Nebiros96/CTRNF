#!/usr/bin/env python3
"""Descarga las imágenes del catálogo a web/catalog para empaquetarlas en el ejecutable.

Vuelve a ejecutarlo cuando agregues URLs en los CSV. Las que ya existen se omiten.
"""

from __future__ import annotations

import csv
import shutil
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urlparse

import time_trial_logger as core

EXTRA_URLS = (
    "https://static.wikia.nocookie.net/crashban/images/2/2a/Crash_Team_Racing_Nitro-Fueled_Emperor_Velo_XXVII_icon.png/revision/latest?cb=20200221032256",
    "https://crashteamranking.com/wp-content/uploads/avatars/1337/5ebd47f41417b-bpfull.png",
)
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
EXTENSIONS = {
    "image/webp": ".webp",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/avif": ".avif",
}
MAX_BYTES = 8 * 1024 * 1024


def read_table(path: Path) -> list[dict[str, str]]:
    if not path.is_file() or path.stat().st_size == 0:
        return []
    with path.open("r", newline="", encoding="utf-8-sig") as source:
        header = source.readline()
        delimiter = ";" if header.count(";") > header.count(",") else ","
        source.seek(0)
        return list(csv.DictReader(source, delimiter=delimiter))


def collect_urls() -> list[str]:
    found: set[str] = set(EXTRA_URLS)
    tables = (
        (core.SKINS_CSV_PATH, ("url",)),
        (core.CHARACTERS_CSV_PATH, ("url_mask", "url_character")),
        (core.TRACKS_CSV_PATH, ("url", "dev_url")),
        (core.ACHIEVEMENTS_CSV_PATH, ("url",)),
        (core.STORE_CATALOG_PATH, ("item_url",)),
    )
    for path, fields in tables:
        for row in read_table(path):
            for field in fields:
                value = (row.get(field) or "").strip()
                if value.startswith(("http://", "https://")):
                    found.add(value)
    return sorted(found)


def curl_path() -> str:
    for candidate in (shutil.which("curl"), shutil.which("curl.exe"), r"C:\Windows\System32\curl.exe"):
        if candidate and Path(candidate).is_file():
            return candidate
    raise SystemExit("No se encontró curl.exe. Hace falta para descargar las imágenes.")


def looks_like_image(data: bytes) -> bool:
    if len(data) < 12 or data.lstrip().startswith((b"<", b"<!")):
        return False
    if data.startswith((b"\x89PNG", b"\xff\xd8\xff", b"GIF87a", b"GIF89a")):
        return True
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return True
    return b"ftyp" in data[:32]


def content_type_of(header_file: Path) -> str:
    text = header_file.read_text(encoding="utf-8", errors="replace")
    content_type = ""
    for block in text.split("\r\n\r\n"):
        for line in block.splitlines():
            if line.lower().startswith("content-type:"):
                content_type = line.split(":", 1)[1].strip()
    return content_type.split(";", 1)[0].strip().lower()


def already_stored(stem: str) -> bool:
    return any((core.CATALOG_IMAGE_DIR / f"{stem}{extension}").is_file() for extension in EXTENSIONS.values())


def download(url: str, curl: str) -> str:
    stem = core.catalog_image_stem(url)
    if already_stored(stem):
        return "omitida"
    host = (urlparse(url).hostname or "").lower()
    referer = "https://crashbandicoot.fandom.com/" if "wikia" in host or "fandom" in host else f"https://{host}/"
    token = f"{threading.get_ident()}"
    body_tmp = core.CATALOG_IMAGE_DIR / f".{stem}.{token}.bin"
    header_tmp = core.CATALOG_IMAGE_DIR / f".{stem}.{token}.hdr"
    command = [
        curl,
        "--silent",
        "--show-error",
        "--fail",
        "--location",
        "--max-redirs",
        "3",
        "--max-time",
        "25",
        "--proto",
        "=https",
        "--proto-redir",
        "=https",
        "--referer",
        referer,
        "--user-agent",
        USER_AGENT,
        "--header",
        "Accept: image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8",
        "--output",
        str(body_tmp),
        "--dump-header",
        str(header_tmp),
        "--write-out",
        "%{http_code} %{url_effective}",
        url,
    ]
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        completed = subprocess.run(command, capture_output=True, timeout=30, creationflags=creationflags)
        report = completed.stdout.decode("utf-8", "replace").strip()
        status_text, _, final_url = report.partition(" ")
        final = urlparse(final_url)
        data = body_tmp.read_bytes() if body_tmp.is_file() else b""
        content_type = content_type_of(header_tmp) if header_tmp.is_file() else ""
        extension = EXTENSIONS.get(content_type)
        same_host = (final.hostname or "").lower() == host
        if completed.returncode != 0 or status_text != "200" or final.scheme != "https" or not same_host:
            raise RuntimeError(completed.stderr.decode("utf-8", "replace").strip() or status_text or "error")
        if extension is None or not looks_like_image(data) or not data or len(data) > MAX_BYTES:
            raise RuntimeError(f"respuesta no es una imagen ({content_type or 'sin tipo'}, {len(data)} bytes)")
        target = core.CATALOG_IMAGE_DIR / f"{stem}{extension}"
        temporary = core.CATALOG_IMAGE_DIR / f".{stem}.{token}.part"
        temporary.write_bytes(data)
        temporary.replace(target)
        return "nueva"
    finally:
        body_tmp.unlink(missing_ok=True)
        header_tmp.unlink(missing_ok=True)


def main() -> None:
    core.CATALOG_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    urls = collect_urls()
    curl = curl_path()
    failures: list[tuple[str, str]] = []
    counts = {"nueva": 0, "omitida": 0}
    print(f"Imágenes en catálogos: {len(urls)}")
    with ThreadPoolExecutor(max_workers=6) as pool:
        pending = {pool.submit(download, url, curl): url for url in urls}
        for finished in as_completed(pending):
            url = pending[finished]
            try:
                counts[finished.result()] += 1
            except Exception as exc:
                failures.append((url, str(exc)))
    if failures:
        print(f"Reintentando {len(failures)}...")
        retry = failures
        failures = []
        for url, _reason in retry:
            try:
                counts[download(url, curl)] += 1
            except Exception as exc:
                failures.append((url, str(exc)))
    total = sum(path.stat().st_size for path in core.CATALOG_IMAGE_DIR.iterdir() if path.is_file() and not path.name.startswith("."))
    print(f"Nuevas: {counts['nueva']} · ya estaban: {counts['omitida']} · fallidas: {len(failures)} · peso: {total / 1024 / 1024:.2f} MB")
    for url in EXTRA_URLS:
        print(core.catalog_image_url(url))
        print(url)
    for url, reason in failures:
        print("FALLO", reason)
        print(url)


if __name__ == "__main__":
    main()
