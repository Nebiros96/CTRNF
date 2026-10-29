const $ = (id) => document.getElementById(id);
let appState = null;
let lastTopSignature = "";
let assetVersion = "";

function imageBox(container, url, alt) {
  container.replaceChildren();
  if (!url || url === "null") {
    const placeholder = document.createElement("div");
    placeholder.className = "null-image";
    placeholder.textContent = "null";
    container.append(placeholder);
    return;
  }
  const image = document.createElement("img");
  image.className = "thumb";
  image.src = url;
  image.alt = alt || "";
  image.loading = "lazy";
  image.onerror = () => {
    const placeholder = document.createElement("div");
    placeholder.className = "null-image";
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

function renderCards(records) {
  const box = $("cards");
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
