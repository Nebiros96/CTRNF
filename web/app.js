const $ = (id) => document.getElementById(id);
let appState = null;
let lastTopSignature = "";
let lastCatalogSignature = "";
let assetVersion = "";
let openTrack = "";

function imageBox(container, url, alt, options = {}) {
  const imageClass = options.imageClass || "thumb";
  const fallbackClass = options.fallbackClass || "null-image";
  container.replaceChildren();
  if (!url || url === "null") {
    const placeholder = document.createElement("div");
    placeholder.className = fallbackClass;
    placeholder.textContent = "null";
    container.append(placeholder);
    return;
  }
  const image = document.createElement("img");
  image.className = imageClass;
  image.src = url;
  image.alt = alt || "";
  image.loading = "lazy";
  image.onerror = () => {
    const placeholder = document.createElement("div");
    placeholder.className = fallbackClass;
    placeholder.textContent = "null";
    image.replaceWith(placeholder);
  };
  container.append(image);
}

function find(rows, key, value) {
  return (rows || []).find((row) => (row[key] || "").trim() === value) || {};
}

function updateAsset(kind, raw) {
  if (!appState) return;
  raw = (raw || "").trim();
  const isTrack = kind === "track";
  const rows = isTrack ? appState.tracks : appState.skins;
  const row = find(rows, isTrack ? "track" : "skin", raw);
  const name = isTrack ? (row.track_clean || "null") : (row.character || "null");
  $(`${kind}-name`).textContent = name;
  if (!isTrack) $("skin-raw").textContent = raw || "null";

  const url = (row.url || "").trim();
  const image = $(`${kind}-image`);
  if (image.dataset.url !== url) {
    image.dataset.url = url;
    imageBox(image, url, name);
  }
}

function fillCards(box, records) {
  box.replaceChildren();
  if (!records.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Aún no hay tiempos guardados para esta pista.";
    box.append(empty);
    return;
  }

  for (const [index, record] of records.entries()) {
    const card = document.createElement("article");
    card.className = index === 0 ? "card top1" : "card";

    const rank = document.createElement("div");
    rank.className = "rank";
    rank.textContent = String(index + 1).padStart(2, "0");

    const imageWrap = document.createElement("div");
    if (record.skin_url) {
      const image = document.createElement("img");
      image.className = "thumb";
      image.src = record.skin_url;
      image.alt = record.character || "null";
      image.loading = "lazy";
      image.onerror = () => {
        const placeholder = document.createElement("div");
        placeholder.className = "null-image";
        placeholder.textContent = "null";
        image.replaceWith(placeholder);
      };
      imageWrap.append(image);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "null-image";
      placeholder.textContent = "null";
      imageWrap.append(placeholder);
    }

    const details = document.createElement("div");
    details.className = "details";
    const character = document.createElement("div");
    character.className = "trackname";
    character.textContent = record.character || "null";

    const pbLine = document.createElement("div");
    pbLine.className = "pb-line";
    const time = document.createElement("div");
    time.className = "pb";
    time.textContent = record.time_raw || "null";
    pbLine.append(time);
    if (String(record.pb) === "1") {
      const flag = document.createElement("div");
      flag.className = "pb-flag";
      flag.textContent = "PB";
      pbLine.append(flag);
    }

    const date = document.createElement("div");
    date.className = "date";
    date.textContent = record.date || "null";
    details.append(character, pbLine, date);
    card.append(rank, imageWrap, details);
    box.append(card);
  }
}

function renderCards(records) {
  fillCards($("cards"), records);
}

function statBlock(label, value, valueClass) {
  const wrap = document.createElement("div");
  const caption = document.createElement("div");
  caption.className = "stat-label";
  caption.textContent = label;
    const number = document.createElement("div");
    number.className = value === "null" ? `${valueClass} is-null` : valueClass;
    number.textContent = value;
  wrap.append(caption, number);
  return wrap;
}

function trackTile(track) {
  const tile = document.createElement("article");
  tile.className = "track-tile";
  tile.dataset.track = track.track || "";

  const preview = document.createElement("button");
  preview.type = "button";
  preview.className = "track-preview";
  preview.setAttribute("aria-expanded", "false");
  preview.setAttribute("aria-label", `Top 5 de ${track.track_clean || "pista"}`);

  const cover = document.createElement("div");
  cover.className = "cover-slot";
  imageBox(cover, track.url, track.track_clean || "", { imageClass: "cover", fallbackClass: "cover-fallback" });

  const info = document.createElement("div");
  info.className = "track-info";
  const title = document.createElement("div");
  title.className = "track-title";
  title.textContent = track.track_clean || "null";

  const stats = document.createElement("div");
  stats.className = "stat-grid";
  stats.append(
    statBlock("PB", track.pb || "null", "pb-value"),
    statBlock("Registros", String(track.records ?? 0), "count-value"),
  );

  const devLabel = document.createElement("div");
  devLabel.className = "stat-label";
  devLabel.textContent = "Desarrollador";

  const dev = document.createElement("div");
  dev.className = "dev-row";
  const icon = document.createElement("div");
  icon.className = "dev-slot";
  imageBox(icon, track.dev_url, track.dev_name || "", { imageClass: "dev-icon", fallbackClass: "dev-fallback" });
  const name = document.createElement("div");
  name.className = "dev-name";
  name.textContent = track.dev_name || "null";
  const devTime = document.createElement("div");
  devTime.className = "dev-time";
  devTime.textContent = track.dev_time || "null";
  dev.append(icon, name, devTime);

  const hint = document.createElement("div");
  hint.className = "open-hint";
  hint.textContent = "Ver top 5";
  info.append(title, stats, devLabel, dev, hint);
  preview.append(cover, info);

  const expand = document.createElement("div");
  expand.className = "track-expand";
  expand.hidden = true;
  const head = document.createElement("div");
  head.className = "tophead";
  const titles = document.createElement("div");
  const eyebrow = document.createElement("div");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Personal best";
  const heading = document.createElement("h2");
  heading.textContent = "Top 5";
  const trackName = document.createElement("span");
  trackName.textContent = track.track_clean || "null";
  titles.append(eyebrow, heading, trackName);
  const close = document.createElement("button");
  close.type = "button";
  close.className = "refresh";
  close.dataset.close = "1";
  close.textContent = "Cerrar";
  head.append(titles, close);
  const cards = document.createElement("div");
  cards.className = "cards";
  fillCards(cards, track.top5 || []);
  expand.append(head, cards);
  tile.append(preview, expand);
  return tile;
}

function applyOpen(scroll) {
  for (const tile of document.querySelectorAll(".track-tile")) {
    const open = tile.dataset.track === openTrack && openTrack !== "";
    tile.classList.toggle("open", open);
    const expand = tile.querySelector(".track-expand");
    if (expand) expand.hidden = !open;
    const hint = tile.querySelector(".open-hint");
    if (hint) hint.textContent = open ? "Ocultar top 5" : "Ver top 5";
    const preview = tile.querySelector(".track-preview");
    if (preview) preview.setAttribute("aria-expanded", open ? "true" : "false");
    if (open && scroll) {
      const nav = document.querySelector(".nav");
      const top = tile.getBoundingClientRect().top + window.scrollY - (nav?.offsetHeight || 0) - 12;
      window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    }
  }
}

function renderTrackGrid(rows) {
  const box = $("track-grid");
  $("track-count").textContent = `${rows.length} pistas`;
  box.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No hay pistas en el catálogo.";
    box.append(empty);
    return;
  }
  for (const track of rows) box.append(trackTile(track));
  applyOpen(false);
}

function setView(name) {
  $("view-register").hidden = name !== "register";
  $("view-tracks").hidden = name !== "tracks";
  for (const button of document.querySelectorAll(".nav-btn")) {
    const active = button.dataset.view === name;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  window.scrollTo({ top: 0 });
}

function showState(data) {
  appState = data;
  updateAsset("track", data.selected?.track);
  updateAsset("skin", data.selected?.skin);

  const connection = $("connection");
  connection.textContent = data.game_running
    ? "Juego detectado · last_run en vivo"
    : "Juego cerrado · última pista guardada";
  connection.className = `pill${data.game_running ? " live" : ""}`;

  const last = data.last_trial;
  $("last").textContent = last
    ? `${last.track_clean || "null"} · ${last.character || "null"} · ${last.time_raw || "null"}`
    : "null";
  $("leader-track").textContent = data.current_track?.track_clean || "null";

  const signature = JSON.stringify(data.top10 || []);
  if (signature !== lastTopSignature) {
    renderCards(data.top10 || []);
    lastTopSignature = signature;
  }

  const catalog = data.catalog || [];
  const catalogSignature = JSON.stringify(catalog);
  if (catalogSignature !== lastCatalogSignature) {
    renderTrackGrid(catalog);
    lastCatalogSignature = catalogSignature;
  }
}

async function refresh() {
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Error al leer datos");
    showState(data);
  } catch (error) {
    $("status").textContent = error.message;
    $("status").className = "status error";
  }
}

async function checkAssets() {
  try {
    const response = await fetch("/api/assets-version", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) return;
    if (assetVersion && data.version !== assetVersion) {
      window.location.reload();
      return;
    }
    assetVersion = data.version;
  } catch {
    // Keep the current UI usable while the backend is temporarily unavailable.
  }
}

for (const button of document.querySelectorAll(".nav-btn")) {
  button.addEventListener("click", () => setView(button.dataset.view));
}

$("track-grid").addEventListener("click", (event) => {
  if (event.target.closest("[data-close]")) {
    openTrack = "";
    applyOpen(false);
    return;
  }
  const preview = event.target.closest(".track-preview");
  if (!preview) return;
  const tile = preview.closest(".track-tile");
  if (!tile) return;
  const key = tile.dataset.track || "";
  openTrack = openTrack === key ? "" : key;
  applyOpen(true);
});

$("refresh").addEventListener("click", refresh);
$("save").addEventListener("click", async () => {
  const status = $("status");
  status.className = "status";
  status.textContent = "Guardando…";
  try {
    const response = await fetch("/api/record", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        track: appState?.selected?.track || "null",
        skin: appState?.selected?.skin || "null",
        time: $("time").value.trim(),
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No se pudo guardar");
    $("time").value = "";
    status.textContent = `Guardado #${data.record.id} · ${data.record.time_seconds} s`;
    await refresh();
  } catch (error) {
    status.textContent = error.message;
    status.className = "status error";
  }
});

$("time").addEventListener("keydown", (event) => {
  if (event.key === "Enter") $("save").click();
});

refresh();
checkAssets();
window.setInterval(refresh, 1500);
window.setInterval(checkAssets, 750);
