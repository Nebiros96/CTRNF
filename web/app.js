const $ = (id) => document.getElementById(id);
const DEV_BEAT_ICON = "https://crashteamranking.com/wp-content/uploads/avatars/1337/5ebd47f41417b-bpfull.png";
const VELO_BEAT_ICON = "https://static.wikia.nocookie.net/crashban/images/2/2a/Crash_Team_Racing_Nitro-Fueled_Emperor_Velo_XXVII_icon.png/revision/latest?cb=20200221032256";
let appState = null;
let lastTopSignature = "";
let assetVersion = "";
let lastTrialSignature = "";
let lastGhostSignature = "";
const browsedTrackByMode = { time_trial: "", rally_ring: "" };
let refreshSerial = 0;
let currentMode = "time_trial";

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

function clockCentis(raw) {
  const match = /^(\d+):(\d{2}):(\d{2})$/.exec(raw || "");
  if (!match) return Number.POSITIVE_INFINITY;
  return Number(match[1]) * 6000 + Number(match[2]) * 100 + Number(match[3]);
}

function byTime(a, b) {
  const delta = clockCentis(a.time_raw) - clockCentis(b.time_raw);
  if (delta) return delta;
  return (a.reference ? 1 : 0) - (b.reference ? 1 : 0);
}

function leaderboardTimes(rows, catalog, trackKey) {
  const track = (catalog || []).find((item) => item.track === trackKey);
  const developer = (track?.references || []).find((item) => item.kind === "dev");
  return [...(rows || []), ...(developer ? [developer] : [])].sort(byTime);
}

function formatDelta(centis) {
  const seconds = Math.floor(centis / 100);
  const frac = centis % 100;
  return `+ ${String(seconds).padStart(2, "0")}:${String(frac).padStart(2, "0")}`;
}

function formatPbGap(raw) {
  const value = Number(String(raw ?? "").replace(",", "."));
  if (!Number.isFinite(value)) return "";
  const centis = Math.round(Math.abs(value) * 100);
  const seconds = Math.floor(centis / 100);
  const frac = centis % 100;
  const body = `${String(seconds).padStart(2, "0")}:${String(frac).padStart(2, "0")}`;
  if (value < 0) return `− ${body}`;
  if (value > 0) return `+ ${body}`;
  return body;
}

function formatScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "null";
  return Math.trunc(Math.abs(number)).toLocaleString("en-US");
}

function formatSpread(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return "null";
  const centis = Math.round(Math.abs(value) * 100);
  const seconds = Math.floor(centis / 100);
  const frac = centis % 100;
  return `${String(seconds).padStart(2, "0")}:${String(frac).padStart(2, "0")}`;
}

function formatRelative(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return "null";
  const body = `${Math.abs(value).toFixed(1)}%`;
  if (value < 0) return `− ${body}`;
  if (value > 0) return `+ ${body}`;
  return body;
}

function paintIndicator(id, text, tone) {
  const node = $(id);
  node.textContent = text;
  node.classList.remove("better", "worse", "even");
  if (tone) node.classList.add(tone);
}

function renderIndicators(data) {
  const stats = data.indicators;
  if (!stats) {
    paintIndicator("ind-records", "null");
    paintIndicator("ind-absolute", "null");
    paintIndicator("ind-relative", "null");
    paintIndicator("ind-stdev", "null");
    return;
  }
  paintIndicator("ind-records", String(stats.records ?? 0));
  const absolute = Number(stats.absolute);
  const relative = Number(stats.relative);
  paintIndicator(
    "ind-absolute",
    Number.isFinite(absolute) ? (formatPbGap(stats.absolute) || "00:00") : "null",
    absolute < 0 ? "better" : absolute > 0 ? "worse" : Number.isFinite(absolute) ? "even" : "",
  );
  paintIndicator(
    "ind-relative",
    formatRelative(stats.relative),
    relative < 0 ? "better" : relative > 0 ? "worse" : Number.isFinite(relative) ? "even" : "",
  );
  paintIndicator("ind-stdev", Number.isFinite(Number(stats.stdev)) ? formatSpread(stats.stdev) : "null");
}

function clockFromSeconds(raw) {
  const normalized = String(raw || "").trim().replace(",", ".");
  if (!normalized) return "null";
  const value = Number(normalized);
  if (!Number.isFinite(value)) return "null";
  const centis = Math.round(value * 100);
  const minutes = Math.floor(centis / 6000);
  const rest = centis % 6000;
  const seconds = Math.floor(rest / 100);
  const frac = rest % 100;
  return `${minutes}:${String(seconds).padStart(2, "0")}:${String(frac).padStart(2, "0")}`;
}

function ghostIcon(slot, url, alt) {
  if (slot.dataset.url === url) return;
  slot.dataset.url = url;
  imageBox(slot, url, alt, { imageClass: "ghost-icon", fallbackClass: "ghost-fallback" });
}

function renderGhosts(data) {
  const key = (data.selected?.track || data.current_track?.track || "").trim();
  const catalogTrack = (data.catalog || []).find((item) => item.track === key) || {};
  const rawTrack = (data.tracks || []).find((item) => (item.track || "").trim() === key) || {};
  const references = catalogTrack.references || [];
  const velo = references.find((item) => item.kind === "velo");
  const dev = references.find((item) => item.kind === "dev");
  const devName = dev?.character || catalogTrack.dev_name || rawTrack.dev_name || "null";
  const devUrl = (dev?.skin_url || catalogTrack.dev_url || rawTrack.dev_url || "").trim();
  const veloTime = velo?.time_raw || clockFromSeconds(rawTrack.velo_time);
  const devTime = dev?.time_raw || catalogTrack.dev_time || clockFromSeconds(rawTrack.dev_time);
  const signature = JSON.stringify({ key, devName, devUrl, veloTime, devTime });
  if (signature === lastGhostSignature) return;
  lastGhostSignature = signature;
  $("ghost-dev-name").textContent = devName;
  $("ghost-velo-time").textContent = veloTime || "null";
  $("ghost-dev-time").textContent = devTime || "null";
  ghostIcon($("ghost-velo-icon"), VELO_BEAT_ICON, "Velo");
  ghostIcon($("ghost-dev-icon"), devUrl, devName);
}

function renderLastTrial(last) {
  const signature = JSON.stringify(last || null);
  if (signature === lastTrialSignature) return;
  lastTrialSignature = signature;

  const title = $("last");
  const badges = $("last-badges");
  const delta = $("last-delta");
  badges.replaceChildren();
  delta.textContent = "";
  delta.className = "last-delta";
  delta.removeAttribute("title");

  if (!last) {
    title.textContent = "null";
    return;
  }

  title.textContent = `${last.track_clean || "null"} · ${last.character || "null"} · ${last.time_raw || "null"}`;

  const icons = [];
  if (last.beat_dev) icons.push([DEV_BEAT_ICON, "Supera al desarrollador"]);
  if (last.beat_velo) icons.push([VELO_BEAT_ICON, "Supera a Velo"]);
  if (icons.length) {
    const wrap = document.createElement("div");
    wrap.className = "beat-icons";
    for (const [src, alt] of icons) {
      const image = document.createElement("img");
      image.src = src;
      image.alt = alt;
      image.title = alt;
      wrap.append(image);
    }
    badges.append(wrap);
  }
  if (String(last.pb) === "1") {
    const flag = document.createElement("div");
    flag.className = "pb-flag";
    flag.textContent = "PB";
    badges.append(flag);
  }

  const raw = String(last.delta_pb ?? "").trim();
  const value = Number(raw.replace(",", "."));
  const firstMark = String(last.pb) === "1" && value === 0;
  if (raw && Number.isFinite(value) && !firstMark) {
    delta.textContent = formatPbGap(raw);
    delta.classList.add(value < 0 ? "better" : value > 0 ? "worse" : "even");
    delta.title = "Diferencia respecto al PB anterior";
  }
}

function fillCards(box, records, options = {}) {
  box.replaceChildren();
  if (!records.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = options.scoreMode ? "Aún no hay puntajes guardados para esta pista." : "Aún no hay tiempos guardados para esta pista.";
    box.append(empty);
    return;
  }

  const bestCentis = records.reduce((best, record) => {
    const centis = options.scoreMode ? Number(record.score) : clockCentis(record.time_raw);
    if (options.scoreMode) return centis > best ? centis : best;
    return centis < best ? centis : best;
  }, options.scoreMode ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY);

  let playerRank = 0;
  let listRank = 0;
  let markedBest = false;
  for (const record of records) {
    const reference = Boolean(record.reference);
    const numbered = !reference || options.numberReferences;
    if (!reference) playerRank += 1;
    if (numbered) listRank += 1;
    const isBest = !reference && !markedBest;
    if (isBest) markedBest = true;

    const card = document.createElement("article");
    card.className = isBest ? "card top1" : "card";
    if (reference) card.classList.add("reference");
    if (reference && record.kind === "dev") card.classList.add("reference-dev");

    const rank = document.createElement("div");
    rank.className = numbered ? "rank" : "rank is-ref";
    const realRank = Number(record.rank);
    const shownRank = reference && Number.isInteger(realRank) ? realRank : (options.numberReferences ? listRank : playerRank);
    rank.textContent = numbered
      ? String(shownRank).padStart(2, "0")
      : (record.kind === "velo" ? "VEL" : "DEV");

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
    time.textContent = options.scoreMode ? `${formatScore(record.score)} pts` : (record.time_raw || "null");
    pbLine.append(time);

    const date = document.createElement("div");
    date.className = "date";
    date.textContent = reference
      ? (record.kind === "velo" ? "Velo" : "Desarrollador")
      : (record.date || "null");
    details.append(character, pbLine, date);
    card.append(rank, imageWrap, details);

    const badges = [];
    if (!reference && record.beat_dev) badges.push([DEV_BEAT_ICON, "Supera al desarrollador"]);
    if (!reference && record.beat_velo) badges.push([VELO_BEAT_ICON, "Supera a Velo"]);
    const showPb = String(record.pb) === "1";
    if (showPb) card.classList.add("has-pb");
    if (badges.length) card.classList.add(badges.length > 1 ? "beats-two" : "beats-one");
    if (showPb || badges.length) {
      const corner = document.createElement("div");
      corner.className = "card-corner";
      if (badges.length) {
        const icons = document.createElement("div");
        icons.className = "beat-icons";
        for (const [src, alt] of badges) {
          const image = document.createElement("img");
          image.src = src;
          image.alt = alt;
          image.title = alt;
          icons.append(image);
        }
        corner.append(icons);
      }
      if (showPb) {
        const flag = document.createElement("div");
        flag.className = "pb-flag";
        flag.textContent = "PB";
        corner.append(flag);
      }
      card.append(corner);
    }

    if (!reference || options.gapOnReferences) {
      const delta = options.scoreMode ? bestCentis - Number(record.score) : clockCentis(record.time_raw) - bestCentis;
      if (Number.isFinite(delta) && delta > 0) {
        const gap = document.createElement("div");
        gap.className = "delta";
        gap.textContent = options.scoreMode ? `− ${formatScore(delta)} pts` : formatDelta(delta);
        card.classList.add("has-delta");
        card.append(gap);
      }
    }
    box.append(card);
  }
}

function setView(name) {
  $("view-register").hidden = name !== "register";
  $("view-rally").hidden = name !== "rally";
  currentMode = name === "rally" ? "rally_ring" : "time_trial";
  for (const button of document.querySelectorAll(".nav-btn")) {
    const active = button.dataset.view === name;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  window.scrollTo({ top: 0 });
  refresh();
}

function renderTrackPicker(data) {
  const picker = $("track-picker");
  const name = $("track-name");
  const running = Boolean(data.game_running);
  const rows = (data.catalog || [])
    .filter((item) => item.track)
    .map((item) => ({ track: item.track, name: item.track_clean || item.track }));
  const canPick = !running && rows.length > 0;
  name.hidden = canPick;
  picker.hidden = !canPick;
  if (!canPick) return;

  const signature = JSON.stringify(rows);
  if (picker.dataset.signature !== signature) {
    picker.dataset.signature = signature;
    picker.replaceChildren();
    for (const row of rows) {
      const option = document.createElement("option");
      option.value = row.track;
      option.textContent = row.name;
      picker.append(option);
    }
  }
  const current = data.current_track?.track || data.selected?.track || "";
  if (current && picker.value !== current) picker.value = current;
}

function showState(data) {
  appState = data;
  if (data.game_running) browsedTrackByMode.time_trial = "";
  updateAsset("track", data.selected?.track);
  updateAsset("skin", data.selected?.skin);
  renderTrackPicker(data);

  const connection = $("connection");
  connection.textContent = data.game_running
    ? "Juego detectado · last_run en vivo"
    : "Juego cerrado · elige una pista";
  connection.className = `pill${data.game_running ? " live" : ""}`;

  renderLastTrial(data.last_trial);
  renderGhosts(data);
  renderIndicators(data);
  $("leader-track").textContent = data.current_track?.track_clean || "null";
  const catalogRows = data.catalog || [];
  const summary = data.summary || {};
  const records = summary.records ?? catalogRows.reduce((total, track) => total + (Number(track.records) || 0), 0);
  const tracks = summary.tracks ?? catalogRows.length;
  const devsBeaten = catalogRows.some((track) => "dev_time_surpass" in track)
    ? catalogRows.reduce((total, track) => total + (Number(track.dev_time_surpass) === 1 ? 1 : 0), 0)
    : (summary.devs_beaten ?? 0);
  $("kpi-records").textContent = String(records);
  $("kpi-devs").parentElement.querySelector(".stat-label").textContent = "Desarrolladores superados";
  $("kpi-devs").textContent = `${devsBeaten} de ${tracks}`;

  const board = leaderboardTimes(data.top10 || [], catalogRows, data.current_track?.track || "");
  const signature = JSON.stringify(board);
  if (signature !== lastTopSignature) {
    fillCards($("cards"), board, { gapOnReferences: true, numberReferences: true });
    lastTopSignature = signature;
  }
}

function showRallyState(data) {
  appState = data;
  if (data.game_running) browsedTrackByMode.rally_ring = "";
  updateRallyAsset("track", data.selected?.track);
  updateRallyAsset("skin", data.selected?.skin);
  const conn = $("connection");
  conn.textContent = data.game_running ? "Juego detectado · last_run en vivo" : "Juego cerrado · pista del último registro";
  conn.className = `pill${data.game_running ? " live" : ""}`;
  const track = data.current_track?.track_clean || "null";
  $("rally-leader-track").textContent = track;
  renderRallyTrackPicker(data);
  $("kpi-records").textContent = String(data.summary?.records ?? 0);
  $("kpi-devs").parentElement.querySelector(".stat-label").textContent = "Pistas con puntaje";
  $("kpi-devs").textContent = `${(data.catalog || []).filter((row) => Number(row.records) > 0).length} pistas`;
  fillCards($("rally-cards"), data.top10 || [], { scoreMode: true });
  const firstCard = $("rally-cards").querySelector(".card");
  if (firstCard) firstCard.classList.add("top1");
  const last = data.last_trial;
  $("rally-last").textContent = last ? `${last.track_clean || "null"} · ${last.character || "null"} · ${formatScore(last.score)} pts` : "null";
  const delta = $("rally-last-delta");
  const badges = $("rally-last-badges");
  badges.replaceChildren();
  delta.textContent = "";
  delta.className = "last-delta";
  if (last && String(last.pb) === "1") {
    const flag = document.createElement("div"); flag.className = "pb-flag"; flag.textContent = "PB"; badges.append(flag);
  }
  if (last && last.delta_pb !== "" && Number.isFinite(Number(last.delta_pb))) {
    const gap = Number(last.delta_pb);
    if (String(last.pb) !== "1" || gap !== 0) {
      delta.textContent = `${gap > 0 ? "+ " : gap < 0 ? "− " : ""}${formatScore(gap)} pts`;
      delta.classList.add(gap > 0 ? "better" : gap < 0 ? "worse" : "even");
      delta.title = "Diferencia respecto al PB anterior";
    }
  }
}

function updateRallyAsset(kind, raw) {
  raw = (raw || "").trim();
  const isTrack = kind === "track";
  const row = find(isTrack ? appState.tracks : appState.skins, isTrack ? "track" : "skin", raw);
  const name = isTrack ? (row.track_clean || "null") : (row.character || "null");
  $(`rally-${kind}-name`).textContent = name;
  if (!isTrack) $("rally-skin-raw").textContent = raw || "null";
  const box = $(`rally-${kind}-image`);
  const url = (row.url || "").trim();
  if (box.dataset.url !== url) { box.dataset.url = url; imageBox(box, url, name); }
}

function renderRallyTrackPicker(data) {
  const picker = $("rally-track-picker");
  const name = $("rally-track-name");
  const rows = (data.catalog || []).filter((item) => item.track).map((item) => ({ track: item.track, name: item.track_clean || item.track }));
  const canPick = !data.game_running && rows.length > 0;
  name.hidden = canPick;
  picker.hidden = !canPick;
  if (!canPick) return;
  const signature = JSON.stringify(rows);
  if (picker.dataset.signature !== signature) {
    picker.dataset.signature = signature;
    picker.replaceChildren();
    for (const row of rows) { const option = document.createElement("option"); option.value = row.track; option.textContent = row.name; picker.append(option); }
  }
  const current = data.current_track?.track || data.selected?.track || "";
  if (current && picker.value !== current) picker.value = current;
}

async function refresh() {
  const requestId = ++refreshSerial;
  const track = browsedTrackByMode[currentMode];
  const params = new URLSearchParams({ mode: currentMode });
  if (track) params.set("track", track);
  const url = `/api/state?${params}`;
  try {
    const response = await fetch(url, { cache: "no-store" });
    const data = await response.json();
    if (requestId !== refreshSerial) return;
    if (!response.ok) throw new Error(data.error || "Error al leer datos");
    if (currentMode === "rally_ring") showRallyState(data);
    else showState(data);
  } catch (error) {
    if (requestId !== refreshSerial) return;
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

$("track-picker").addEventListener("change", () => {
  browsedTrackByMode.time_trial = $("track-picker").value;
  refresh();
});
$("rally-track-picker").addEventListener("change", () => { browsedTrackByMode.rally_ring = $("rally-track-picker").value; refresh(); });

$("rally-save").addEventListener("click", async () => {
  const status = $("rally-status");
  status.className = "status"; status.textContent = "Guardando…";
  try {
    const response = await fetch("/api/record", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "rally_ring", track: appState?.selected?.track || "null", skin: appState?.selected?.skin || "null", score: $("score").value.trim(), laps: $("laps").value.trim() }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No se pudo guardar");
    $("score").value = "";
    $("laps").value = "";
    status.textContent = `Guardado #${data.record.id} · ${formatScore(data.record.score)} pts`;
    await refresh();
  } catch (error) { status.textContent = error.message; status.className = "status error"; }
});
$("score").addEventListener("keydown", (event) => { if (event.key === "Enter") $("rally-save").click(); });
$("laps").addEventListener("keydown", (event) => { if (event.key === "Enter") $("rally-save").click(); });
$("rally-refresh").addEventListener("click", refresh);

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
