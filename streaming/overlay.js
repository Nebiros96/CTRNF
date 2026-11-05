const card = document.querySelector("#overlay");
const cardKind = document.body.dataset.card || "pb";
const skinImage = document.getElementById("skin");
const devImage = document.getElementById("dev-icon");
const medal = document.getElementById("medal");
let signature = "";

function setText(id, value) {
  const node = document.getElementById(id);
  if (!node) return;
  const next = value || "";
  if (node.textContent !== next) node.textContent = next;
}

function setImage(img, url) {
  if (!img) return;
  if (!url) {
    img.classList.add("is-off");
    img.removeAttribute("src");
    return;
  }
  img.classList.remove("is-off");
  if (img.getAttribute("src") !== url) img.src = url;
}

function paintDelta(data) {
  const delta = document.getElementById("delta");
  if (!delta) return;
  setText("delta", data.delta || "");
  const gap = data.delta_centis;
  delta.className = "delta" + (gap < 0 ? " ahead" : gap > 0 ? " behind" : gap === 0 ? " even" : "");
}

function paintWho(data) {
  setText("track", data.track_clean || "");
  setText("character", data.character || "—");
  setText("skin-name", data.skin_name ? ` - ${data.skin_name}` : "");
  setText("date", data.date || "");
  setImage(skinImage, data.skin_url || "");
}

function recordLabel(count) {
  const total = Number(count) || 0;
  return total === 1 ? "1 registro" : `${total} registros`;
}

function applyOverlay(data) {
  const next = JSON.stringify(data);
  if (next === signature) return;
  signature = next;
  if (!data || !data.active) {
    card.hidden = true;
    return;
  }

  card.hidden = false;
  paintWho(data);
  paintDelta(data);

  if (cardKind === "last") {
    setText("time", data.time || "—");
    setText("count", recordLabel(data.records));
    return;
  }

  if (cardKind === "rally") {
    setText("score", data.score || "—");
    if (medal) medal.classList.toggle("is-off", !data.score);
    return;
  }

  setText("pb", data.pb || "—");
  const pb = document.getElementById("pb");
  if (pb) pb.className = "clock" + (data.beat_dev ? " ahead" : "");
  if (medal) medal.classList.toggle("is-off", !data.pb);
  setText("dev", data.dev_time || "—");
  setImage(devImage, data.dev_url || "");
}

function hideBroken(event) {
  event.currentTarget.classList.add("is-off");
}

if (skinImage) skinImage.addEventListener("error", hideBroken);
if (devImage) devImage.addEventListener("error", hideBroken);

async function tick() {
  try {
    const response = await fetch(`/api/overlay?card=${cardKind}`, { cache: "no-store" });
    if (!response.ok) return;
    applyOverlay(await response.json());
  } catch (_error) {
    // Si el servidor parpadea, se conserva el último cuadro.
  }
}

tick();
setInterval(tick, 1000);
