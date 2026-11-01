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
let currentMode = "rally_ring";
let progressCharacterId = "";
let progressQuery = "";
let progressSignature = "";
let progressScrolledId = "";

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

function formatFactor(raw) {
  const value = Number(raw);
  return `×${(1 + (Number.isFinite(value) ? value : 0)).toFixed(3)}`;
}

function progressStat(label, value, extraClass) {
  const box = document.createElement("div");
  box.className = extraClass ? `progress-stat ${extraClass}` : "progress-stat";
  const name = document.createElement("div");
  name.className = "stat-label";
  name.textContent = label;
  const number = document.createElement("div");
  number.className = "progress-stat-value";
  number.textContent = value;
  box.append(name, number);
  return box;
}

function paintGlobalMultiplier(raw) {
  const box = $("progress-global");
  box.replaceChildren();
  const copy = document.createElement("div");
  copy.className = "global-mult-copy";
  const eyebrow = document.createElement("div");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Multiplicador global";
  const titleRow = document.createElement("div");
  titleRow.className = "global-mult-title";
  const help = document.createElement("div");
  help.className = "multiplier-help";
  const helpButton = document.createElement("button");
  helpButton.type = "button";
  helpButton.className = "multiplier-info";
  helpButton.textContent = "⚠";
  helpButton.title = "Cómo se calcula el multiplicador";
  helpButton.setAttribute("aria-label", "Ver cómo se calcula el multiplicador");
  helpButton.setAttribute("aria-expanded", "false");
  const details = document.createElement("div");
  details.className = "multiplier-help-popover";
  details.hidden = true;
  details.textContent = "Cada skin desbloqueada suma: Basic 0.001 · Exotic 0.002 · Legendary 0.003 · Beenox 0.005. Cada trofeo desbloqueado suma su bonus.";
  helpButton.addEventListener("click", () => {
    details.hidden = !details.hidden;
    helpButton.setAttribute("aria-expanded", String(!details.hidden));
  });
  help.append(helpButton, details);
  titleRow.append(eyebrow, help);
  const value = document.createElement("div");
  value.className = "global-mult-value";
  value.textContent = formatFactor(raw).slice(1);
  const note = document.createElement("p");
  note.className = "hero-rule";
  note.textContent = "La siguiente carrera usa este valor, con cualquier personaje.";
  copy.append(titleRow, note);
  box.append(value, copy);
}

function paintSkinTotals(characters) {
  const box = $("skin-totals");
  const types = [
    { key: "basic", label: "Basic" },
    { key: "exotic", label: "Exotic" },
    { key: "legendary", label: "Legendary" },
    { key: "beenox", label: "Beenox" },
  ];
  const totals = Object.fromEntries(types.map(({ key }) => [key, { unlocked: 0, total: 0 }]));
  for (const character of characters) {
    for (const skin of character.skins || []) {
      const key = (skin.skin_type || "").trim().toLowerCase();
      if (!totals[key]) continue;
      totals[key].total += 1;
      if (skin.unlocked) totals[key].unlocked += 1;
    }
  }
  const unlockedTotal = Object.values(totals).reduce((sum, item) => sum + item.unlocked, 0);
  const allSkins = Object.values(totals).reduce((sum, item) => sum + item.total, 0);
  box.replaceChildren();
  const heading = document.createElement("div");
  heading.className = "skin-totals-heading";
  const title = document.createElement("div");
  title.className = "eyebrow";
  title.textContent = "Skins desbloqueadas";
  const overall = document.createElement("div");
  overall.className = "skin-totals-overall";
  overall.textContent = `${unlockedTotal} de ${allSkins}`;
  heading.append(title, overall);
  const grid = document.createElement("div");
  grid.className = "skin-totals-grid";
  for (const { key, label } of types) {
    const item = totals[key];
    const card = document.createElement("div");
    card.className = `skin-total type-${key}`;
    const name = document.createElement("div");
    name.className = "skin-total-name";
    name.textContent = label;
    const count = document.createElement("div");
    count.className = "skin-total-count";
    count.textContent = `${item.unlocked} / ${item.total}`;
    const track = document.createElement("div");
    track.className = "skin-total-track";
    const fill = document.createElement("div");
    fill.className = `skin-total-fill type-${key}`;
    fill.style.width = `${item.total ? (item.unlocked / item.total) * 100 : 0}%`;
    track.append(fill);
    card.append(name, count, track);
    grid.append(card);
  }
  box.append(heading, grid);
}

function paintProgressHero(character) {
  const hero = $("progress-hero");
  hero.replaceChildren();
  if (!character) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Elige un personaje.";
    hero.append(empty);
    return;
  }

  const portrait = document.createElement("div");
  portrait.className = "hero-portrait";
  imageBox(portrait, character.url_character, character.character, {
    imageClass: "hero-photo",
    fallbackClass: "hero-fallback",
  });

  const copy = document.createElement("div");
  copy.className = "hero-copy";
  const eyebrow = document.createElement("div");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = character.game_base || "Ring Rally";
  const title = document.createElement("h2");
  title.textContent = character.character || "null";
  const maskLine = document.createElement("div");
  maskLine.className = "hero-mask";
  if (character.url_mask) {
    const mask = document.createElement("img");
    mask.className = "mask-icon";
    mask.src = character.url_mask;
    mask.alt = character.mask || "";
    maskLine.append(mask);
  }
  if (character.mask) {
    const maskName = document.createElement("span");
    maskName.textContent = character.mask;
    maskLine.append(maskName);
  }
  const runs = document.createElement("div");
  runs.className = "hero-runs";
  const runCount = Number(character.runs) || 0;
  runs.textContent = runCount ? `${runCount} ${runCount === 1 ? "registro" : "registros"}` : "Sin registros";

  const stats = document.createElement("div");
  stats.className = "progress-stats";
  stats.append(progressStat("Puntos de progresión", formatScore(character.points), "is-points"));

  const bar = document.createElement("div");
  bar.className = "unlock-track";
  bar.setAttribute("role", "progressbar");
  const fill = document.createElement("div");
  fill.className = "unlock-fill";
  const caption = document.createElement("div");
  caption.className = "unlock-caption";
  if (!character.total_skins) {
    fill.style.width = "0%";
    bar.setAttribute("aria-valuenow", "0");
    caption.textContent = "Este personaje no tiene skins en el catálogo.";
  } else if (!character.next) {
    fill.style.width = "100%";
    bar.setAttribute("aria-valuenow", "100");
    caption.textContent = "Álbum completo.";
  } else {
    const next = character.next;
    const goal = Number(next.threshold) || 0;
    const width = goal ? Math.max(0, Math.min(100, (Number(character.points) / goal) * 100)) : 0;
    fill.style.width = `${width}%`;
    bar.setAttribute("aria-valuenow", String(Math.round(width)));
    caption.textContent = `${formatScore(character.points)} / ${formatScore(goal)} · faltan ${formatScore(next.remaining)} para ${next.skin_name} (${next.skin_type})`;
  }
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  bar.append(fill);

  const costs = document.createElement("p");
  costs.className = "hero-rule";
  costs.textContent = "El álbum sigue el orden de las skins. Cada Basic suma 500,000 · Exotic 2,000,000 · Legendary 5,000,000 · Beenox 10,000,000 al total acumulado.";

  copy.append(eyebrow, title, maskLine, runs, stats, bar, caption, costs);
  if (Number(character.base_points) !== Number(character.points)) {
    const base = document.createElement("p");
    base.className = "hero-rule";
    base.textContent = `Puntaje base acumulado ${formatScore(character.base_points)} pts. La barra usa la suma ya multiplicada.`;
    copy.append(base);
  }
  const album = document.createElement("div");
  album.className = "hero-album";
  const albumLabel = document.createElement("div");
  albumLabel.className = "stat-label";
  albumLabel.textContent = "Álbum";
  const albumValue = document.createElement("div");
  albumValue.className = "hero-album-value";
  albumValue.textContent = `${character.unlocked} de ${character.total_skins}`;
  album.append(albumLabel, albumValue);
  hero.append(portrait, copy, album);
}

function paintAlbum(character) {
  const album = $("progress-album");
  album.replaceChildren();
  if (!character) return;
  if (!character.skins || !character.skins.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Este personaje no tiene skins en el catálogo.";
    album.append(empty);
    return;
  }
  character.skins.forEach((skin, index) => {
    const card = document.createElement("article");
    card.className = `skin-card${skin.unlocked ? " unlocked" : " locked"}${skin.is_next ? " next" : ""}`;
    const order = document.createElement("div");
    order.className = "skin-order";
    order.textContent = String(index + 1).padStart(2, "0");
    const frame = document.createElement("div");
    frame.className = "skin-frame";
    imageBox(frame, skin.url, skin.skin_name, { imageClass: "skin-art", fallbackClass: "null-image" });
    const art = frame.querySelector("img");
    if (art) {
      art.title = skin.unlocked
        ? `${skin.skin_name} desbloqueada`
        : `${skin.skin_name} · ${formatScore(skin.threshold)} pts de progresión`;
    }
    const name = document.createElement("div");
    name.className = "skin-title";
    name.textContent = skin.skin_name || "null";
    const type = document.createElement("div");
    type.className = `skin-type type-${(skin.skin_type || "").toLowerCase()}`;
    type.textContent = skin.skin_type || "null";
    const state = document.createElement("div");
    state.className = "skin-state";
    state.textContent = skin.unlocked ? "Desbloqueada" : `${formatScore(skin.threshold)} pts`;
    card.append(order, frame, name, type, state);
    if (skin.unlocked) {
      const mark = document.createElement("div");
      mark.className = "skin-check";
      mark.textContent = "✓";
      card.append(mark);
    }
    if (skin.is_next && character.next) {
      const mini = document.createElement("div");
      mini.className = "unlock-track mini";
      const fill = document.createElement("div");
      fill.className = "unlock-fill";
      const goal = Number(character.next.threshold) || 0;
      const width = goal ? (Number(character.points) / goal) * 100 : 0;
      fill.style.width = `${Math.max(0, Math.min(100, width))}%`;
      mini.append(fill);
      card.append(mini);
    }
    album.append(card);
  });
}

function paintProgressTotal(characters) {
  const box = $("progress-total");
  const total = characters.reduce((sum, row) => sum + (Number(row.points) || 0), 0);
  box.replaceChildren();
  const value = document.createElement("div");
  value.className = "progress-total-value";
  value.textContent = formatScore(total);
  const eyebrow = document.createElement("div");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Puntos totales";
  box.append(value, eyebrow);
}

function paintProgress(characters, multiplier) {
  const roster = $("progress-roster");
  const scroll = roster.scrollTop;
  const query = progressQuery.trim().toLocaleLowerCase("es");
  roster.replaceChildren();
  const groups = [];
  for (const character of characters) {
    if (query && !(character.character || "").toLocaleLowerCase("es").includes(query)) continue;
    const label = character.game_base || "Otros";
    let group = groups.find((item) => item.label === label);
    if (!group) {
      group = { label, characters: [] };
      groups.push(group);
    }
    group.characters.push(character);
  }
  if (!groups.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = query ? "Ningún personaje coincide." : "No hay personajes en el catálogo.";
    roster.append(empty);
  }
  for (const group of groups) {
    const block = document.createElement("section");
    block.className = "roster-group";
    const label = document.createElement("div");
    label.className = "roster-label";
    label.textContent = group.label;
    block.append(label);
    for (const character of group.characters) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "roster-item";
      if (character.character_id === progressCharacterId) {
        button.classList.add("active");
        button.setAttribute("aria-current", "true");
      }
      if (Number(character.points) > 0) button.classList.add("has-points");
      const photo = document.createElement("div");
      photo.className = "roster-photo";
      imageBox(photo, character.url_character, character.character, {
        imageClass: "roster-photo-img",
        fallbackClass: "null-image",
      });
      const text = document.createElement("div");
      text.className = "roster-copy";
      const name = document.createElement("div");
      name.className = "roster-name";
      name.textContent = character.character || "null";
      const meta = document.createElement("div");
      meta.className = "roster-meta";
      meta.textContent = `${character.unlocked}/${character.total_skins}`;
      const track = document.createElement("div");
      track.className = "roster-bar";
      const barFill = document.createElement("div");
      barFill.className = "roster-bar-fill";
      const partial = character.next ? Number(character.next.progress) || 0 : 0;
      const toward = character.total_skins
        ? (Number(character.unlocked) + (character.next ? partial : 0)) / character.total_skins
        : 0;
      barFill.style.width = `${Math.max(0, Math.min(100, toward * 100))}%`;
      track.append(barFill);
      text.append(name, meta, track);
      button.append(photo, text);
      button.addEventListener("click", () => {
        progressCharacterId = character.character_id;
        progressSignature = "";
        if (appState && appState.mode === "rally_progress") showProgressState(appState);
      });
      block.append(button);
    }
    roster.append(block);
  }
  roster.scrollTop = scroll;
  const activeButton = roster.querySelector(".roster-item.active");
  if (activeButton && progressCharacterId !== progressScrolledId) {
    activeButton.scrollIntoView({ block: "nearest" });
    progressScrolledId = progressCharacterId;
  }
  const selected = characters.find((row) => row.character_id === progressCharacterId) || null;
  paintProgressTotal(characters);
  paintSkinTotals(characters);
  paintGlobalMultiplier(multiplier);
  paintProgressHero(selected);
  paintAlbum(selected);
}

const SAVE_LOCK_MESSAGE = "Abre el juego para guardar un registro.";

function syncSaveLocks(running) {
  for (const statusId of ["status", "rally-status"]) {
    const buttonId = statusId === "status" ? "save" : "rally-save";
    const button = $(buttonId);
    const status = $(statusId);
    button.disabled = !running;
    button.title = running ? "" : SAVE_LOCK_MESSAGE;
    if (!running) {
      status.dataset.lock = "1";
      status.textContent = SAVE_LOCK_MESSAGE;
      status.className = "status error";
    } else if (status.dataset.lock === "1") {
      status.dataset.lock = "";
      status.textContent = "Listo";
      status.className = "status";
    }
  }
}

function setStatus(id, message, isError) {
  const status = $(id);
  status.dataset.lock = "";
  status.textContent = message;
  status.className = isError ? "status error" : "status";
}

function timeInputError(raw) {
  const value = raw.trim();
  const triple = /^(\d+):(\d{2}):(\d{2})$/.exec(value);
  if (triple) {
    if (Number(triple[2]) > 59 || Number(triple[3]) > 99) {
      return "segundos deben estar entre 00 y 59 y centésimas entre 00 y 99";
    }
    return "";
  }
  const dotted = /^(?:(\d{1,2}):)?(\d{1,2})[.,](\d{1,2})$/.exec(value);
  if (!dotted) return "usa M:SS:CC, M:SS.CC o SS.CC";
  const centiseconds = Number(dotted[3].padEnd(2, "0"));
  if (Number(dotted[2]) > 59 || centiseconds > 99) {
    return "segundos deben estar entre 00 y 59 y centésimas entre 00 y 99";
  }
  return "";
}

function assetSnapshot(kind, raw) {
  const value = (raw || "").trim();
  const isTrack = kind === "track";
  const row = find(isTrack ? appState?.tracks : appState?.skins, isTrack ? "track" : "skin", value);
  return {
    raw: value || "null",
    name: isTrack ? (row.track_clean || "null") : (row.character || "null"),
    detail: isTrack ? "" : (value || "null"),
    url: (row.url || "").trim(),
  };
}

let pendingRecord = null;
let confirmReturnFocus = "time";

function paintConfirmAsset(kind, snapshot) {
  const image = $(`confirm-${kind}-image`);
  delete image.dataset.url;
  imageBox(image, snapshot.url, snapshot.name);
  $(`confirm-${kind}-name`).textContent = snapshot.name;
  if (kind === "skin") $("confirm-skin-raw").textContent = snapshot.detail;
}

function paintConfirmMetrics(draft) {
  const box = $("confirm-metrics");
  const rows = draft.mode === "rally_ring"
    ? [["Puntaje", formatScore(draft.score)], ["Vueltas", formatScore(draft.laps)]]
    : [["Tiempo", draft.time]];
  box.classList.toggle("single", rows.length === 1);
  box.replaceChildren();
  for (const [label, value] of rows) {
    const metric = document.createElement("div");
    metric.className = "confirm-metric";
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = label;
    const strong = document.createElement("strong");
    strong.textContent = value;
    metric.append(meta, strong);
    box.append(metric);
  }
}

function openConfirm(draft) {
  pendingRecord = draft;
  confirmReturnFocus = draft.focusId;
  paintConfirmAsset("track", draft.track);
  paintConfirmAsset("skin", draft.skin);
  paintConfirmMetrics(draft);
  $("confirm-card").classList.toggle("confirm-rally", draft.mode === "rally_ring");
  $("confirm-status").textContent = "";
  $("confirm-status").className = "status";
  $("confirm-ok").disabled = false;
  $("confirm-ok").textContent = "Confirmar";
  $("confirm-modal").hidden = false;
  document.querySelector("main").inert = true;
  window.setTimeout(() => $("confirm-ok").focus(), 0);
}

function closeConfirm() {
  $("confirm-modal").hidden = true;
  pendingRecord = null;
  document.querySelector("main").inert = false;
  const target = $(confirmReturnFocus);
  if (target) target.focus();
}

function confirmIsBusy() {
  return Boolean(pendingRecord) && $("confirm-ok").disabled;
}

function requestSave(mode) {
  if (!$("confirm-modal").hidden) return;
  if (!appState?.game_running) {
    syncSaveLocks(false);
    return;
  }
  if (mode === "rally_ring") {
    const score = $("score").value.trim();
    const laps = $("laps").value.trim();
    if (!/^\d+$/.test(score)) {
      setStatus("rally-status", "ingresa un puntaje entero sin decimales (ej. 100452)", true);
      return;
    }
    if (!/^\d+$/.test(laps)) {
      setStatus("rally-status", "ingresa el número de vueltas como entero", true);
      return;
    }
    openConfirm({
      mode,
      focusId: "score",
      statusId: "rally-status",
      track: assetSnapshot("track", appState.selected?.track),
      skin: assetSnapshot("skin", appState.selected?.skin),
      score,
      laps,
    });
    return;
  }
  const time = $("time").value.trim();
  const error = timeInputError(time);
  if (error) {
    setStatus("status", error, true);
    return;
  }
  openConfirm({
    mode: "time_trial",
    focusId: "time",
    statusId: "status",
    track: assetSnapshot("track", appState.selected?.track),
    skin: assetSnapshot("skin", appState.selected?.skin),
    time,
  });
}

async function commitConfirm() {
  const draft = pendingRecord;
  if (!draft || confirmIsBusy()) return;
  if (!appState?.game_running) {
    $("confirm-status").textContent = "El juego tiene que estar abierto para guardar un registro.";
    $("confirm-status").className = "status error";
    syncSaveLocks(false);
    return;
  }
  $("confirm-ok").disabled = true;
  $("confirm-ok").textContent = "Guardando…";
  $("confirm-status").textContent = "";
  try {
    const payload = draft.mode === "rally_ring"
      ? { mode: "rally_ring", track: draft.track.raw, skin: draft.skin.raw, score: draft.score, laps: draft.laps }
      : { track: draft.track.raw, skin: draft.skin.raw, time: draft.time };
    const response = await fetch("/api/record", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No se pudo guardar");
    if (draft.mode === "rally_ring") {
      $("score").value = "";
      $("laps").value = "";
      const note = data.record.notes ? ` · ${data.record.notes}` : "";
      const savedMult = Number(data.record.multiplier);
      const detail = Number.isFinite(savedMult) && savedMult > 0
        ? `${formatScore(data.record.score_mult)} pts de progresión (${formatFactor(savedMult)})`
        : `${formatScore(data.record.score)} pts`;
      setStatus("rally-status", `Guardado #${data.record.id} · ${detail}${note}`, false);
    } else {
      $("time").value = "";
      setStatus("status", `Guardado #${data.record.id} · ${data.record.time_seconds} s`, false);
    }
    closeConfirm();
    if (draft.mode === "rally_ring" && Array.isArray(data.unlocks) && data.unlocks.length) openUnlocks(data.unlocks);
    await refresh();
  } catch (error) {
    $("confirm-ok").disabled = false;
    $("confirm-ok").textContent = "Confirmar";
    $("confirm-status").textContent = error.message;
    $("confirm-status").className = "status error";
    setStatus(draft.statusId, error.message, true);
  }
}

function showProgressState(data) {
  appState = data;
  syncSaveLocks(Boolean(data.game_running));
  const connection = $("connection");
  connection.textContent = !data.log_found ? "No se encontró el archivo .log · configura la ruta ⚙" : data.game_running
    ? "Juego detectado · last_run en vivo"
    : "Juego cerrado · álbum de Ring Rally";
  connection.className = `pill${data.game_running ? " live" : ""}`;
  const characters = data.progression || [];
  const unlocked = data.summary?.unlocked ?? characters.reduce((sum, row) => sum + (Number(row.unlocked) || 0), 0);
  const skins = data.summary?.skins ?? characters.reduce((sum, row) => sum + (Number(row.total_skins) || 0), 0);
  $("kpi-records").textContent = String(data.summary?.records ?? 0);
  $("kpi-devs").parentElement.querySelector(".stat-label").textContent = "Skins desbloqueadas";
  $("kpi-devs").textContent = `${unlocked} de ${skins}`;
  if (!progressCharacterId || !characters.some((row) => row.character_id === progressCharacterId)) {
    progressCharacterId = data.active_character_id
      || characters.find((row) => Number(row.points) > 0)?.character_id
      || characters[0]?.character_id
      || "";
  }
  const signature = JSON.stringify({
    id: progressCharacterId,
    query: progressQuery,
    multiplier: data.multiplier,
    characters,
  });
  if (signature === progressSignature) return;
  progressSignature = signature;
  paintProgress(characters, data.multiplier);
}

let trophySignature = "";

function formatTrophyAmount(trophy) {
  const current = Number(trophy.current) || 0;
  const target = Number(trophy.target) || 0;
  if (trophy.unit === "milli") {
    return `${(current / 1000).toFixed(3)} / ${(target / 1000).toFixed(3)}`;
  }
  return `${formatScore(current)} / ${formatScore(target)}`;
}

function formatTrophyDate(value) {
  if (!value) return "Sin desbloquear";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" });
}

function paintTrophies(trophies) {
  const list = $("trophy-list");
  list.replaceChildren();
  if (!trophies.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No hay trofeos en achievements.csv.";
    list.append(empty);
    return;
  }
  for (const trophy of trophies) {
    const row = document.createElement("article");
    const tier = (trophy.type || "").toLowerCase();
    row.className = `trophy${trophy.unlocked ? " unlocked" : " locked"} tier-${tier}`;
    const icon = document.createElement("div");
    icon.className = "trophy-icon";
    imageBox(icon, trophy.url, trophy.name, { imageClass: "trophy-art", fallbackClass: "trophy-fallback" });
    const body = document.createElement("div");
    body.className = "trophy-body";
    const head = document.createElement("div");
    head.className = "trophy-title-row";
    const title = document.createElement("h3");
    title.textContent = trophy.name;
    const tierLabel = document.createElement("span");
    tierLabel.className = "trophy-tier";
    tierLabel.textContent = `${trophy.tier || trophy.type} +${trophy.mult}`;
    head.append(title, tierLabel);
    const meta = document.createElement("p");
    meta.className = "trophy-meta";
    meta.textContent = trophy.description ?? trophy.meta ?? "";
    const progress = document.createElement("div");
    progress.className = "trophy-progress";
    const amount = document.createElement("div");
    amount.className = "trophy-amount";
    amount.textContent = formatTrophyAmount(trophy);
    const bar = document.createElement("div");
    bar.className = "unlock-track";
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    const width = Math.max(0, Math.min(100, Number(trophy.progress) * 100));
    bar.setAttribute("aria-valuenow", String(Math.round(width)));
    const fill = document.createElement("div");
    fill.className = "unlock-fill";
    fill.style.width = `${width}%`;
    bar.append(fill);
    progress.append(amount, bar);
    body.append(head, meta, progress);
    const date = document.createElement("div");
    date.className = "trophy-date";
    date.textContent = trophy.unlocked ? formatTrophyDate(trophy.unlocked_at) : "Sin desbloquear";
    row.append(icon, body, date);
    list.append(row);
  }
}

function showTrophyState(data) {
  appState = data;
  syncSaveLocks(Boolean(data.game_running));
  const connection = $("connection");
  connection.textContent = !data.log_found ? "No se encontró el archivo .log · configura la ruta ⚙" : data.game_running
    ? "Juego detectado · last_run en vivo"
    : "Juego cerrado · trofeos de Ring Rally";
  connection.className = `pill${data.game_running ? " live" : ""}`;
  const trophies = data.trophies || [];
  const unlocked = data.summary?.unlocked ?? trophies.filter((row) => row.unlocked).length;
  const total = data.summary?.trophies ?? trophies.length;
  $("kpi-records").textContent = String(data.summary?.records ?? 0);
  $("kpi-devs").parentElement.querySelector(".stat-label").textContent = "Trofeos";
  $("kpi-devs").textContent = `${unlocked} de ${total}`;
  $("trophy-count").textContent = `${unlocked} de ${total}`;
  const signature = JSON.stringify({ multiplier: data.multiplier, trophies });
  if (signature === trophySignature) return;
  trophySignature = signature;
  paintTrophies(trophies);
}

function setView(name) {
  $("view-register").hidden = name !== "register";
  $("view-rally").hidden = name !== "rally";
  $("view-progress").hidden = name !== "progress";
  $("view-trophies").hidden = name !== "trophies";
  currentMode = name === "rally" ? "rally_ring" : name === "progress" ? "rally_progress" : name === "trophies" ? "rally_trophies" : "time_trial";
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
  syncSaveLocks(Boolean(data.game_running));
  if (data.game_running) browsedTrackByMode.time_trial = "";
  updateAsset("track", data.selected?.track);
  updateAsset("skin", data.selected?.skin);
  renderTrackPicker(data);

  const connection = $("connection");
  connection.textContent = !data.log_found ? "No se encontró el archivo .log · configura la ruta ⚙" : data.game_running
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
  syncSaveLocks(Boolean(data.game_running));
  if (data.game_running) browsedTrackByMode.rally_ring = "";
  updateRallyAsset("track", data.selected?.track);
  updateRallyAsset("skin", data.selected?.skin);
  const conn = $("connection");
  conn.textContent = !data.log_found ? "No se encontró el archivo .log · configura la ruta ⚙" : data.game_running ? "Juego detectado · last_run en vivo" : "Juego cerrado · pista del último registro";
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
  const mult = Number(last?.multiplier);
  const boosted = Number(last?.score_mult);
  let headline = last ? `${last.track_clean || "null"} · ${last.character || "null"} · ${formatScore(last.score)} pts` : "null";
  if (last && Number.isFinite(mult) && mult > 0 && Number.isFinite(boosted)) {
    headline += ` · progresión ${formatScore(boosted)} (${formatFactor(mult)})`;
  }
  $("rally-last").textContent = headline;
  $("rally-last-notes").textContent = last?.notes || "";
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
    else if (currentMode === "rally_progress") showProgressState(data);
    else if (currentMode === "rally_trophies") showTrophyState(data);
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
$("progress-search").addEventListener("input", () => {
  progressQuery = $("progress-search").value;
  progressSignature = "";
  if (appState && appState.mode === "rally_progress") showProgressState(appState);
});

$("rally-save").addEventListener("click", () => requestSave("rally_ring"));
$("score").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  requestSave("rally_ring");
});
$("laps").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  requestSave("rally_ring");
});
$("rally-refresh").addEventListener("click", refresh);

$("refresh").addEventListener("click", refresh);
$("save").addEventListener("click", () => requestSave("time_trial"));
$("time").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  requestSave("time_trial");
});

function unlockMode(items) {
  return items.some((item) => item.status !== "progress") ? "unlocked" : "progress";
}

function unlockHeadline(items) {
  const skins = items.filter((item) => item.kind === "skin").length;
  const trophies = items.filter((item) => item.kind === "trophy").length;
  if (unlockMode(items) === "progress") return "Así va la siguiente skin";
  if (skins && trophies) return "Felicidades, has desbloqueado lo siguiente";
  if (skins === 1) return "Felicidades, has desbloqueado la siguiente skin";
  if (skins > 1) return "Felicidades, has desbloqueado las siguientes skins";
  if (trophies === 1) return "Felicidades, has desbloqueado el siguiente trofeo";
  return "Felicidades, has desbloqueado los siguientes trofeos";
}

function paintUnlockItem(item) {
  const card = document.createElement("article");
  const tier = (item.type || "").toLowerCase();
  const locked = item.status === "progress";
  card.className = `unlock-item${locked ? " locked" : " unlocked"}${tier ? ` tier-${tier}` : ""}`;
  const icon = document.createElement("div");
  icon.className = "unlock-icon";
  imageBox(icon, item.url, item.name, { imageClass: "unlock-art", fallbackClass: "null-image" });
  const copy = document.createElement("div");
  copy.className = "unlock-copy";
  const label = document.createElement("div");
  label.className = "meta";
  label.textContent = item.kind === "trophy" && item.tier ? `${item.label} · ${item.tier}` : (item.label || "");
  const name = document.createElement("strong");
  name.textContent = item.name || "null";
  const detail = document.createElement("p");
  detail.className = "unlock-detail";
  detail.textContent = item.detail || "";
  const progress = document.createElement("div");
  progress.className = "unlock-progress";
  const amount = document.createElement("div");
  amount.className = "unlock-amount";
  amount.textContent = formatTrophyAmount(item);
  const bar = document.createElement("div");
  bar.className = "unlock-track";
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  const width = Math.max(0, Math.min(100, Number(item.progress) * 100));
  bar.setAttribute("aria-valuenow", String(Math.round(width)));
  const fill = document.createElement("div");
  fill.className = "unlock-fill";
  fill.style.width = `${width}%`;
  bar.append(fill);
  progress.append(amount, bar);
  copy.append(label, name, detail, progress);
  card.append(icon, copy);
  return card;
}

function openUnlocks(items) {
  const list = $("unlock-list");
  list.replaceChildren();
  for (const item of items) list.append(paintUnlockItem(item));
  $("unlock-title").textContent = unlockMode(items) === "progress" ? "En progreso" : "Felicidades";
  $("unlock-lead").textContent = unlockHeadline(items);
  $("unlock-modal").hidden = false;
  document.querySelector("main").inert = true;
  window.setTimeout(() => $("unlock-ok").focus(), 0);
}

function closeUnlocks() {
  $("unlock-modal").hidden = true;
  document.querySelector("main").inert = false;
  const score = $("score");
  if (score) score.focus();
}

$("confirm-ok").addEventListener("click", () => { commitConfirm(); });
$("confirm-correct").addEventListener("click", () => {
  if (!confirmIsBusy()) closeConfirm();
});
$("confirm-modal").addEventListener("click", (event) => {
  if (event.target.closest("[data-confirm-dismiss]") && !confirmIsBusy()) closeConfirm();
});
$("unlock-ok").addEventListener("click", closeUnlocks);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!$("unlock-modal").hidden) {
    event.preventDefault();
    closeUnlocks();
    return;
  }
  if (!$("confirm-modal").hidden && !confirmIsBusy()) {
    event.preventDefault();
    closeConfirm();
  }
});

refresh();
checkAssets();
window.setInterval(refresh, 1500);
window.setInterval(checkAssets, 750);
