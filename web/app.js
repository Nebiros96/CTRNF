const $ = (id) => document.getElementById(id);
const DEV_BEAT_ICON = "/catalog/0f07c126a90e73a7.png";
const VELO_BEAT_ICON = "/catalog/e48c99fa6e3ef42a.webp";
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
let pendingAlbumCharacterId = "";
let profileTrack = "";
let profileSignature = "";
let profileBestRelative = 0;
let profileSort = { key: "track", direction: 1 };
let profileMode = "time_trial";

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
  image.alt = alt || "";
  image.loading = "lazy";
  image.onerror = () => {
    const placeholder = document.createElement("div");
    placeholder.className = fallbackClass;
    placeholder.textContent = "null";
    image.replaceWith(placeholder);
  };
  image.src = url;
  container.append(image);
}

function find(rows, key, value) {
  return (rows || []).find((row) => (row[key] || "").trim() === value) || {};
}

function skinPrettyName(raw) {
  const row = find(appState?.skins, "skin", (raw || "").trim());
  return (row.skin_name || "").trim();
}

function paintConnection(data) {
  const connection = $("connection");
  if (!data.log_found) {
    connection.textContent = "last_run log not found · set the path in ⚙";
    connection.className = "pill offline";
    return;
  }
  connection.textContent = data.game_running ? "Online" : "Game closed";
  connection.className = data.game_running ? "pill live" : "pill offline";
}

function knownSkin(raw) {
  const value = (raw || "").trim();
  if (!value || value.toLowerCase() === "null" || value.toLowerCase() === "none") return null;
  const row = find(appState?.skins, "skin", value);
  if (!(row.character || "").trim() && !(row.skin_name || "").trim()) return null;
  return row;
}

function paintCharacterBox(nameId, detailId, imageId, raw) {
  const row = knownSkin(raw);
  const image = $(imageId);
  if (!row) {
    $(nameId).textContent = "Choose a character";
    $(detailId).textContent = "";
    if (image.dataset.url !== "") {
      image.dataset.url = "";
      image.className = "null-image";
      image.replaceChildren();
    }
    return;
  }
  const name = row.character || "null";
  $(nameId).textContent = name;
  $(detailId).textContent = (row.skin_name || "").trim();
  const url = (row.url || "").trim();
  if (image.dataset.url !== url) {
    image.dataset.url = url;
    image.className = "null-image";
    imageBox(image, url, name);
  }
}

function updateAsset(kind, raw) {
  if (!appState) return;
  raw = (raw || "").trim();
  if (kind !== "track") {
    paintCharacterBox("skin-name", "skin-raw", "skin-image", raw);
    return;
  }
  const row = find(appState.tracks, "track", raw);
  const name = row.track_clean || "null";
  $("track-name").textContent = name;
  const url = (row.url || "").trim();
  const image = $("track-image");
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
  const ranked = [...(rows || []), ...(developer ? [developer] : [])].sort(byTime);
  const top = ranked.slice(0, 10);
  if (developer && !top.includes(developer)) top.push({ ...developer, separated: true });
  return top;
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
    paintIndicator("ind-average", "null");
    paintIndicator("ind-absolute", "null");
    paintIndicator("ind-relative", "null");
    paintIndicator("ind-stdev", "null");
    return;
  }
  paintIndicator("ind-records", String(stats.records ?? 0));
  paintIndicator("ind-average", stats.average == null ? "null" : clockFromSeconds(stats.average));
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

function ghostRow(entry) {
  const row = document.createElement("div");
  row.className = "ghost-row";
  const slot = document.createElement("div");
  slot.className = "ghost-slot";
  ghostIcon(slot, entry.url, entry.name);
  const name = document.createElement("div");
  name.className = "ghost-name";
  name.textContent = entry.name || "null";
  const time = document.createElement("div");
  time.className = "ghost-time";
  time.textContent = entry.time || "null";
  row.append(slot, name, time);
  return row;
}

function renderGhosts(data) {
  const key = (data.selected?.track || data.current_track?.track || "").trim();
  const catalogTrack = (data.catalog || []).find((item) => item.track === key) || {};
  const rawTrack = (data.tracks || []).find((item) => (item.track || "").trim() === key) || {};
  const references = catalogTrack.references || [];
  const velo = references.find((item) => item.kind === "velo");
  const dev = references.find((item) => item.kind === "dev");
  const pb = (data.top10 || []).find((row) => row.time_raw && row.time_raw !== "null");
  const devName = dev?.character || catalogTrack.dev_name || rawTrack.dev_name || "null";
  const entries = [
    { name: "Velo", time: velo?.time_raw || clockFromSeconds(rawTrack.velo_time), url: VELO_BEAT_ICON },
    { name: devName, time: dev?.time_raw || catalogTrack.dev_time || clockFromSeconds(rawTrack.dev_time), url: (dev?.skin_url || catalogTrack.dev_url || rawTrack.dev_url || "").trim() },
    { name: "Personal Best", time: pb?.time_raw || "null", url: (pb?.skin_url || "").trim() },
  ].sort((a, b) => clockCentis(a.time) - clockCentis(b.time));
  const signature = JSON.stringify({ key, entries });
  if (signature === lastGhostSignature) return;
  lastGhostSignature = signature;
  const list = $("ghost-list");
  list.replaceChildren();
  for (const entry of entries) list.append(ghostRow(entry));
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
  if (last.beat_dev) icons.push([DEV_BEAT_ICON, "Beats the developer"]);
  if (last.beat_velo) icons.push([VELO_BEAT_ICON, "Beats Velo"]);
  if (icons.length) {
    const wrap = document.createElement("div");
    wrap.className = "beat-icons";
    for (const [src, alt] of icons) {
      const image = document.createElement("img");
      image.alt = alt;
      image.title = alt;
      image.src = src;
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
    delta.title = "Gap to the previous PB";
  }
}

function fillCards(box, records, options = {}) {
  box.replaceChildren();
  if (!records.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = options.scoreMode ? "No scores saved for this track yet." : "No times saved for this track yet.";
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
  for (const record of records) {
    if (record.separated) {
      const separator = document.createElement("div");
      separator.className = "leaderboard-separator";
      separator.setAttribute("role", "separator");
      separator.setAttribute("aria-label", "Developer outside the top 10");
      box.append(separator);
    }
    const reference = Boolean(record.reference);
    const numbered = !reference || options.numberReferences;
    if (!reference) playerRank += 1;
    if (numbered) listRank += 1;
    const card = document.createElement("article");
    card.className = "card";
    if (reference) card.classList.add("reference");
    if (reference && record.kind === "dev") card.classList.add("reference-dev");

    const rank = document.createElement("div");
    rank.className = numbered ? "rank" : "rank is-ref";
    const realRank = Number(record.rank);
    const shownRank = reference && Number.isInteger(realRank) ? realRank : (options.numberReferences ? listRank : playerRank);
    const cappedDeveloperRank = reference && record.kind === "dev" && shownRank > 99;
    if (cappedDeveloperRank) rank.classList.add("rank-compact");
    rank.textContent = numbered
      ? (cappedDeveloperRank ? "99+" : String(shownRank).padStart(2, "0"))
      : (record.kind === "velo" ? "VEL" : "DEV");

    const imageWrap = document.createElement("div");
    imageBox(imageWrap, record.skin_url, record.character || "null", {
      imageClass: "thumb",
      fallbackClass: "null-image",
    });

    const details = document.createElement("div");
    details.className = "details";
    const character = document.createElement("div");
    character.className = "trackname";
    const who = document.createElement("span");
    who.textContent = record.character || "null";
    character.append(who);
    const prettySkin = record.reference ? "" : skinPrettyName(record.skin);
    if (prettySkin) {
      const skin = document.createElement("span");
      skin.className = "racer-skin";
      skin.textContent = ` - ${prettySkin}`;
      character.append(skin);
    }

    const pbLine = document.createElement("div");
    pbLine.className = "pb-line";
    const time = document.createElement("div");
    time.className = "pb";
    time.textContent = options.scoreMode ? `${formatScore(record.score)} pts` : (record.time_raw || "null");
    pbLine.append(time);

    const date = document.createElement("div");
    date.className = "date";
    date.textContent = reference
      ? (record.kind === "velo" ? "Velo" : "Developer")
      : (record.date || "null");
    details.append(character, pbLine, date);
    card.append(rank, imageWrap, details);

    const badges = [];
    if (!reference && record.beat_dev) badges.push([DEV_BEAT_ICON, "Beats the developer"]);
    if (!reference && record.beat_velo) badges.push([VELO_BEAT_ICON, "Beats Velo"]);
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
          image.alt = alt;
          image.title = alt;
          image.src = src;
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

function paintGlobalMultiplier(raw, storeBonus) {
  const box = $("progress-global");
  box.replaceChildren();
  const always = Number(storeBonus?.always) || 0;
  const shown = (Number(raw) || 0) + always;
  const copy = document.createElement("div");
  copy.className = "global-mult-copy";
  const eyebrow = document.createElement("div");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Global multiplier";
  const titleRow = document.createElement("div");
  titleRow.className = "global-mult-title";
  const help = document.createElement("div");
  help.className = "multiplier-help";
  const helpButton = document.createElement("button");
  helpButton.type = "button";
  helpButton.className = "multiplier-info";
  helpButton.textContent = "⚠";
  helpButton.title = "How the multiplier is calculated";
  helpButton.setAttribute("aria-label", "See how the multiplier is calculated");
  helpButton.setAttribute("aria-expanded", "false");
  const details = document.createElement("div");
  details.className = "multiplier-help-popover";
  details.hidden = true;
  details.textContent = "Each unlocked skin adds: Basic 0.001 · Exotic 0.002 · Legendary 0.003 · Beenox 0.005 · Ultra 0.01. Each unlocked trophy and purchased store item adds its unconditional bonus. Conditional store bonuses are added only when their requirements are met.";
  helpButton.addEventListener("click", () => {
    details.hidden = !details.hidden;
    helpButton.setAttribute("aria-expanded", String(!details.hidden));
  });
  help.append(helpButton, details);
  titleRow.append(eyebrow, help);
  const value = document.createElement("div");
  value.className = "global-mult-value";
  value.textContent = formatFactor(shown).slice(1);
  const note = document.createElement("p");
  note.className = "hero-rule";
  note.textContent = "Your next Ring Rally uses this value with any character. Matching store conditions add extra bonuses.";
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
    { key: "ultra", label: "Ultra" },
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
  box.replaceChildren();
  const grid = document.createElement("div");
  grid.className = "skin-totals-grid";
  for (const { key, label } of types) {
    const item = totals[key];
    const ratio = item.total ? item.unlocked / item.total : 0;
    const card = document.createElement("div");
    card.className = `skin-total type-${key}`;
    const pie = document.createElement("div");
    pie.className = "skin-pie";
    pie.style.setProperty("--p", ratio.toFixed(4));
    pie.setAttribute("role", "img");
    pie.setAttribute("aria-label", `${label}: ${item.unlocked} of ${item.total}`);
    const copy = document.createElement("div");
    copy.className = "skin-total-copy";
    const name = document.createElement("div");
    name.className = "skin-total-name";
    name.textContent = label;
    const count = document.createElement("div");
    count.className = "skin-total-count";
    count.textContent = `${item.unlocked} / ${item.total}`;
    copy.append(name, count);
    card.append(pie, copy);
    grid.append(card);
  }
  box.append(grid);
}

function paintProgressHero(character) {
  const hero = $("progress-hero");
  hero.replaceChildren();
  if (!character) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Choose a character.";
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
    mask.alt = character.mask || "";
    mask.src = character.url_mask;
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
  runs.textContent = runCount ? `${runCount} ${runCount === 1 ? "record" : "records"}` : "No records";

  const stats = document.createElement("div");
  stats.className = "progress-stats";
  stats.append(progressStat("Progression points", formatScore(character.points), "is-points"));

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
    caption.textContent = "This character has no skins in the catalog.";
  } else if (!character.next) {
    fill.style.width = "100%";
    bar.setAttribute("aria-valuenow", "100");
    caption.textContent = "Album complete.";
  } else {
    const next = character.next;
    const goal = Number(next.threshold) || 0;
    const width = goal ? Math.max(0, Math.min(100, (Number(character.points) / goal) * 100)) : 0;
    fill.style.width = `${width}%`;
    bar.setAttribute("aria-valuenow", String(Math.round(width)));
    caption.textContent = `${formatScore(character.points)} / ${formatScore(goal)} · ${formatScore(next.remaining)} to go for ${next.skin_name} (${next.skin_type})`;
  }
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  bar.append(fill);

  copy.append(eyebrow, title, maskLine, runs, stats, bar, caption);
  const album = document.createElement("div");
  album.className = "hero-album";
  const albumLabel = document.createElement("div");
  albumLabel.className = "stat-label";
  albumLabel.textContent = "Album";
  const albumValue = document.createElement("div");
  albumValue.className = "hero-album-value";
  albumValue.textContent = `${character.unlocked} of ${character.total_skins}`;
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
    empty.textContent = "This character has no skins in the catalog.";
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
        ? `${skin.skin_name} unlocked`
        : `${skin.skin_name} · ${formatScore(skin.threshold)} progression pts`;
    }
    const name = document.createElement("div");
    name.className = "skin-title";
    name.textContent = skin.skin_name || "null";
    const type = document.createElement("div");
    type.className = `skin-type type-${(skin.skin_type || "").toLowerCase()}`;
    type.textContent = skin.skin_type || "null";
    const state = document.createElement("div");
    state.className = "skin-state";
    state.textContent = skin.unlocked ? "Unlocked" : `${formatScore(skin.threshold)} pts`;
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

function kpiCell(label, value, extra) {
  const box = document.createElement("div");
  box.className = "kpi";
  const name = document.createElement("div");
  name.className = "stat-label";
  name.textContent = label;
  const number = document.createElement("div");
  number.className = "kpi-value";
  number.append(document.createTextNode(value));
  if (extra) {
    const note = document.createElement("span");
    note.className = "kpi-extra";
    note.textContent = extra;
    number.append(note);
  }
  box.append(name, number);
  return box;
}

function paintProgressTotal(characters, records, unlocked, skins) {
  const box = $("progress-total");
  const total = characters.reduce((sum, row) => sum + (Number(row.points) || 0), 0);
  const percent = skins ? Math.round((unlocked / skins) * 100) : 0;
  box.replaceChildren();
  box.append(
    kpiCell("Total points", formatScore(total)),
    kpiCell("Records", String(records ?? 0)),
    kpiCell("Unlocked skins", `${unlocked} of ${skins}`, `· ${percent}%`),
  );
}

function paintProgress(characters, multiplier, records, unlocked, skins, storeBonus) {
  const roster = $("progress-roster");
  const scroll = roster.scrollTop;
  const query = progressQuery.trim().toLocaleLowerCase("es");
  roster.replaceChildren();
  const groups = [];
  for (const character of characters) {
    if (query && !(character.character || "").toLocaleLowerCase("es").includes(query)) continue;
    const label = character.game_base || "Other";
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
    empty.textContent = query ? "No characters match." : "No characters in the catalog.";
    roster.append(empty);
  }
  for (const group of groups) {
    const block = document.createElement("section");
    block.className = "roster-group";
    let sectionUnlocked = 0;
    let sectionTotal = 0;
    for (const row of characters) {
      if ((row.game_base || "Other") !== group.label) continue;
      sectionUnlocked += Number(row.unlocked) || 0;
      sectionTotal += Number(row.total_skins) || 0;
    }
    const label = document.createElement("div");
    label.className = "roster-label";
    label.textContent = `${group.label} (${sectionUnlocked}/${sectionTotal})`;
    block.append(label);
    for (const character of group.characters) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "roster-item";
      const skinsTotal = Number(character.total_skins) || 0;
      const skinsUnlocked = Number(character.unlocked) || 0;
      if (skinsUnlocked < skinsTotal) button.classList.add("is-locked");
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
  paintProgressTotal(characters, records, unlocked, skins);
  paintSkinTotals(characters);
  paintGlobalMultiplier(multiplier, storeBonus);
  paintProgressHero(selected);
  paintAlbum(selected);
}

const SAVE_LOCK_MESSAGE = "Open the game to save a record.";

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
      status.textContent = "Ready";
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

function selectedTrackRow() {
  return find(appState?.tracks, "track", (appState?.selected?.track || "").trim());
}

function inputCentis(raw) {
  const value = String(raw || "").trim();
  const triple = /^(\d+):(\d{2}):(\d{2})$/.exec(value);
  if (triple) return Number(triple[1]) * 6000 + Number(triple[2]) * 100 + Number(triple[3]);
  const dotted = /^(?:(\d{1,2}):)?(\d{1,2})[.,](\d{1,2})$/.exec(value);
  if (!dotted) return null;
  return Number(dotted[1] || 0) * 6000 + Number(dotted[2]) * 100 + Number(dotted[3].padEnd(2, "0"));
}

function impossibleTimeError(raw) {
  const track = selectedTrackRow();
  const seconds = Number(String(track.time_threshold || "").trim().replace(",", "."));
  if (!Number.isFinite(seconds)) return "";
  const entered = inputCentis(raw);
  if (entered == null || entered > Math.round(seconds * 100)) return "";
  const name = track.track_clean || "this track";
  return `That time can't be saved. The limit for ${name} is ${clockFromSeconds(track.time_threshold)}.`;
}

function impossibleScoreError(raw) {
  const track = selectedTrackRow();
  const limit = Number(String(track.score_threshold || "").trim());
  const score = Number(raw);
  if (!Number.isInteger(limit) || !Number.isFinite(score) || score < limit) return "";
  const name = track.track_clean || "this track";
  return `That score can't be saved. The limit for ${name} is ${formatScore(limit)}.`;
}

function timeInputError(raw) {
  const value = raw.trim();
  const triple = /^(\d+):(\d{2}):(\d{2})$/.exec(value);
  if (triple) {
    if (Number(triple[2]) > 59 || Number(triple[3]) > 99) {
      return "seconds must be 00–59 and hundredths 00–99";
    }
    return "";
  }
  const dotted = /^(?:(\d{1,2}):)?(\d{1,2})[.,](\d{1,2})$/.exec(value);
  if (!dotted) return "use M:SS:CC, M:SS.CC, or SS.CC";
  const centiseconds = Number(dotted[3].padEnd(2, "0"));
  if (Number(dotted[2]) > 59 || centiseconds > 99) {
    return "seconds must be 00–59 and hundredths 00–99";
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
    detail: isTrack ? "" : (skinPrettyName(value) || "null"),
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
    ? [["Score", formatScore(draft.score)], ["Laps", formatScore(draft.laps)]]
    : [["Time", draft.time]];
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
  $("confirm-ok").textContent = "Confirm";
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
      setStatus("rally-status", "enter a whole score, no decimals (e.g. 100452)", true);
      return;
    }
    if (!/^\d+$/.test(laps)) {
      setStatus("rally-status", "enter the lap count as a whole number", true);
      return;
    }
    const scoreLimit = impossibleScoreError(score);
    if (scoreLimit) {
      setStatus("rally-status", scoreLimit, true);
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
  const error = timeInputError(time) || impossibleTimeError(time);
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
    $("confirm-status").textContent = "The game must be running to save a record.";
    $("confirm-status").className = "status error";
    syncSaveLocks(false);
    return;
  }
  $("confirm-ok").disabled = true;
  $("confirm-ok").textContent = "Saving…";
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
    if (!response.ok) throw new Error(data.error || "Couldn't save");
    if (draft.mode === "rally_ring") {
      $("score").value = "";
      $("laps").value = "";
      const note = data.record.notes ? ` · ${data.record.notes}` : "";
      const savedMult = Number(data.record.multiplier);
      const detail = Number.isFinite(savedMult) && savedMult > 0
        ? `${formatScore(data.record.score_mult)} progression pts (${formatFactor(savedMult)})`
        : `${formatScore(data.record.score)} pts`;
      setStatus("rally-status", `Saved #${data.record.id} · ${detail}${note}`, false);
      const played = find(appState?.skins, "skin", (draft.skin?.raw || "").trim());
      pendingAlbumCharacterId = String(played.character_id || "").trim() || "*";
    } else {
      $("time").value = "";
      setStatus("status", `Saved #${data.record.id} · ${data.record.time_seconds} s`, false);
    }
    closeConfirm();
    openResume(draft, data.record || {}, Array.isArray(data.unlocks) ? data.unlocks : []);
    await refresh();
  } catch (error) {
    $("confirm-ok").disabled = false;
    $("confirm-ok").textContent = "Confirm";
    $("confirm-status").textContent = error.message;
    $("confirm-status").className = "status error";
    setStatus(draft.statusId, error.message, true);
  }
}

function showProgressState(data) {
  appState = data;
  syncSaveLocks(Boolean(data.game_running));
  paintConnection(data);
  const characters = data.progression || [];
  const records = data.summary?.records ?? 0;
  const unlocked = data.summary?.unlocked ?? characters.reduce((sum, row) => sum + (Number(row.unlocked) || 0), 0);
  const skins = data.summary?.skins ?? characters.reduce((sum, row) => sum + (Number(row.total_skins) || 0), 0);
  if (pendingAlbumCharacterId) {
    const wanted = pendingAlbumCharacterId === "*" ? String(data.active_character_id || "") : pendingAlbumCharacterId;
    pendingAlbumCharacterId = "";
    const match = characters.find((row) => String(row.character_id) === wanted);
    if (match) {
      if (String(progressCharacterId) !== String(match.character_id)) progressScrolledId = "";
      progressCharacterId = match.character_id;
    }
  }
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
    store: data.store_bonus,
    records,
    unlocked,
    skins,
    characters,
  });
  if (signature === progressSignature) return;
  progressSignature = signature;
  paintProgress(characters, data.multiplier, records, unlocked, skins, data.store_bonus);
}

let trophySignature = "";

function formatTrophyCount(value) {
  const number = Math.trunc(Math.abs(Number(value) || 0));
  if (number < 1_000_000) return formatScore(number);
  const millions = Math.round((number / 1_000_000) * 10) / 10;
  const text = Number.isInteger(millions) ? formatScore(millions) : millions.toFixed(1);
  return `${text} M`;
}

function formatTrophyAmount(trophy) {
  const target = Number(trophy.target) || 0;
  let current = Number(trophy.current) || 0;
  if (target > 0 && current > target) current = target;
  if (trophy.unit === "milli") {
    return `${(current / 1000).toFixed(3)} / ${(target / 1000).toFixed(3)}`;
  }
  return `${formatTrophyCount(current)} / ${formatTrophyCount(target)}`;
}

function formatTrophyDate(value) {
  if (!value) return "Locked";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getFullYear()}`;
}

const TROPHY_GROUPS = [
  { key: "time trial", listId: "trophy-list-time-trial", countId: "trophy-count-time-trial" },
  { key: "ring rally", listId: "trophy-list-ring-rally", countId: "trophy-count-ring-rally" },
  { key: "bonus", listId: "trophy-list-bonus", countId: "trophy-count-bonus" },
];

function trophyGroupKey(trophy) {
  const mode = (trophy.game_mode || "").toLowerCase();
  if (mode.includes("time")) return "time trial";
  if (mode.includes("bonus")) return "bonus";
  return "ring rally";
}

function trophyArticle(trophy) {
  const row = document.createElement("article");
  const tier = (trophy.type || "").toLowerCase();
  row.className = `trophy${trophy.unlocked ? " unlocked" : " locked"}${tier ? ` tier-${tier}` : ""}`;
  const icon = document.createElement("div");
  icon.className = "trophy-icon";
  imageBox(icon, trophy.url, trophy.name, { imageClass: "trophy-art", fallbackClass: "trophy-fallback" });
  const body = document.createElement("div");
  body.className = "trophy-body";
  const head = document.createElement("div");
  head.className = "trophy-title-row";
  const title = document.createElement("h3");
  title.textContent = trophy.name;
  head.append(title);
  const bonus = Number(trophy.mult) > 0 ? `+${trophy.mult}` : "";
  const tierText = [trophy.tier || trophy.type, bonus].filter(Boolean).join(" ");
  if (tierText) {
    const tierLabel = document.createElement("span");
    tierLabel.className = "trophy-tier";
    tierLabel.textContent = tierText;
    head.append(tierLabel);
  }
  const meta = document.createElement("p");
  meta.className = "trophy-meta";
  meta.textContent = trophy.description ?? trophy.meta ?? "";
  const progress = document.createElement("div");
  progress.className = "trophy-progress";
  const amount = document.createElement("div");
  amount.className = "trophy-amount";
  amount.textContent = formatTrophyAmount(trophy);
  progress.append(amount);
  body.append(head, meta, progress);
  const date = document.createElement("div");
  date.className = "trophy-date";
  date.textContent = trophy.unlocked ? formatTrophyDate(trophy.unlocked_at) : "Locked";
  row.append(icon, body, date);
  return row;
}

function paintTrophies(trophies) {
  const grouped = new Map(TROPHY_GROUPS.map((group) => [group.key, []]));
  for (const trophy of trophies) {
    const key = trophyGroupKey(trophy);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(trophy);
  }
  for (const group of TROPHY_GROUPS) {
    const list = $(group.listId);
    const rows = grouped.get(group.key) || [];
    list.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No trophies in this group.";
      list.append(empty);
    } else {
      for (const trophy of rows) list.append(trophyArticle(trophy));
    }
    const unlocked = rows.filter((row) => row.unlocked).length;
    $(group.countId).textContent = `${unlocked} of ${rows.length}`;
  }
}

function showTrophyState(data) {
  appState = data;
  syncSaveLocks(Boolean(data.game_running));
  paintConnection(data);
  const trophies = data.trophies || [];
  const signature = JSON.stringify({ multiplier: data.multiplier, trophies });
  if (signature === trophySignature) return;
  trophySignature = signature;
  paintTrophies(trophies);
}

let storeSignature = "";
let storeCategory = "skin";
let pendingStoreBuy = "";

function formatCoins(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function closeStoreHelp() {
  for (const popover of document.querySelectorAll(".store-help-popover")) popover.hidden = true;
  for (const button of document.querySelectorAll(".store-help-button")) button.setAttribute("aria-expanded", "false");
}

function storeHelpButton(item) {
  const lines = Array.isArray(item.help) ? item.help.filter(Boolean) : [];
  if (!lines.length) return null;
  const wrap = document.createElement("div");
  wrap.className = "store-help";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "store-help-button";
  button.innerHTML = '<i class="fa-solid fa-circle-info" aria-hidden="true"></i>';
  button.title = "Bonus";
  button.setAttribute("aria-label", `Bonus for ${item.name}`);
  button.setAttribute("aria-expanded", "false");
  const popover = document.createElement("div");
  popover.className = "store-help-popover";
  popover.hidden = true;
  for (const line of lines) {
    const row = document.createElement("p");
    row.textContent = line;
    popover.append(row);
  }
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = popover.hidden;
    closeStoreHelp();
    if (!willOpen) return;
    popover.hidden = false;
    button.setAttribute("aria-expanded", "true");
    const rect = button.getBoundingClientRect();
    const width = 190;
    let left = rect.right - width;
    if (left < 8) left = Math.min(rect.left, window.innerWidth - width - 8);
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    popover.style.top = `${Math.round(rect.bottom + 8)}px`;
    popover.style.left = `${Math.round(left)}px`;
    popover.style.width = `${width}px`;
  });
  wrap.append(button, popover);
  return wrap;
}

function storeCard(item, coinIcon) {
  const card = document.createElement("article");
  card.className = "store-card";
  const frame = document.createElement("div");
  frame.className = "store-frame";
  imageBox(frame, item.url, item.name, { imageClass: "store-art", fallbackClass: "store-fallback" });
  card.append(frame);
  if (item.level != null) {
    const level = document.createElement("span");
    level.className = "store-level";
    level.textContent = `LV ${item.level}`;
    card.append(level);
  }

  const name = document.createElement("h3");
  name.className = "store-name";
  name.textContent = item.name;
  card.append(name);

  const price = document.createElement("div");
  price.className = "store-price";
  const coin = document.createElement("img");
  coin.src = coinIcon || "/wumpacoin.webp";
  coin.alt = "";
  const amount = document.createElement("span");
  amount.textContent = formatCoins(item.price);
  price.append(coin, amount);
  card.append(price);

  {
    const details = document.createElement("div");
    details.className = "avatar-bonuses";
    const heading = document.createElement("div");
    heading.className = "avatar-bonuses-title";
    heading.textContent = "Bonuses";
    details.append(heading);
    for (const line of Array.isArray(item.help) ? item.help : []) {
      if (line.startsWith("×") && line.includes("Wumpacoins")) continue;
      const row = document.createElement("p");
      row.textContent = line;
      details.append(row);
    }
    if (Number(item.bonus_coins) !== 1 && Number(item.bonus_coins) > 0) {
      const row = document.createElement("p");
      row.className = "avatar-coins-bonus";
      const icon = document.createElement("img");
      icon.src = coinIcon || "/wumpacoin.webp";
      icon.alt = "";
      const text = document.createElement("span");
      text.textContent = `×${item.bonus_coins} Wumpacoins from every new race`;
      row.append(icon, text);
      details.append(row);
    }
    card.append(details);
  }

  if (!item.purchased) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button store-buy";
    if (item.locked) {
      button.disabled = true;
      button.textContent = "Locked";
      const requirement = document.createElement("p");
      requirement.className = "store-requirement";
      requirement.textContent = `Requires: ${item.unlock_name}`;
      card.append(requirement);
    } else if (!item.affordable) {
      button.disabled = true;
      button.textContent = "Not enough";
    } else if (pendingStoreBuy === item.id) {
      button.textContent = "Confirm";
      button.addEventListener("click", () => buyStoreItem(item.id, true));
    } else {
      button.textContent = "Buy";
      button.addEventListener("click", () => buyStoreItem(item.id, false));
    }
    card.append(button);
  }
  return card;
}

function paintStore(data) {
  const items = data.items || [];
  const signature = JSON.stringify({ balance: data.balance, pending: pendingStoreBuy, category: storeCategory, items });
  $("store-balance").textContent = formatCoins(data.balance);
  const purchasedBonusMilli = items.reduce((sum, item) => sum + (item.purchased ? Math.round((Number(item.bonus_all) || 0) * 1000) : 0), 0);
  $("store-bonus").textContent = `+${(purchasedBonusMilli / 1000).toFixed(3)}`;
  if (signature === storeSignature) return;
  storeSignature = signature;
  closeStoreHelp();
  const categoryItems = items.filter((item) => item.item_category === storeCategory);
  const pending = categoryItems.filter((item) => !item.purchased);
  const purchased = categoryItems.filter((item) => item.purchased);
  const grid = $("store-grid");
  grid.classList.toggle("store-grid-avatars", storeCategory === "Avatar");
  grid.replaceChildren();
  if (!pending.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = purchased.length ? "Everything in this category is already purchased." : "No items in this category.";
    grid.append(empty);
  } else {
    for (const item of pending) grid.append(storeCard(item, data.coin_icon));
  }
  const owned = $("store-owned");
  const ownedGrid = $("store-owned-grid");
  ownedGrid.classList.toggle("store-grid-avatars", storeCategory === "Avatar");
  owned.hidden = purchased.length === 0;
  $("store-owned-summary").textContent = `Purchased · ${purchased.length}`;
  ownedGrid.replaceChildren();
  for (const item of purchased) ownedGrid.append(storeCard(item, data.coin_icon));
}

document.querySelectorAll(".store-category").forEach((button) => {
  button.addEventListener("click", () => {
    storeCategory = button.dataset.category;
    pendingStoreBuy = "";
    document.querySelectorAll(".store-category").forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-pressed", String(active));
    });
    $("store-status").textContent = "";
    if (appState && appState.mode === "store") paintStore(appState);
  });
});

function showStoreState(data) {
  appState = data;
  syncSaveLocks(Boolean(data.game_running));
  paintConnection(data);
  paintStore(data);
}

async function buyStoreItem(itemId, confirmed) {
  const status = $("store-status");
  if (!confirmed) {
    pendingStoreBuy = itemId;
    storeSignature = "";
    if (appState && appState.mode === "store") paintStore(appState);
    status.textContent = "Confirm the purchase. It applies on the next Ring Rally.";
    status.className = "status";
    return;
  }
  pendingStoreBuy = "";
  status.textContent = "Buying…";
  status.className = "status";
  try {
    const response = await fetch("/api/store/buy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_id: itemId }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Couldn't buy that item");
    storeSignature = "";
    status.textContent = "Purchased. The bonus applies on the next Ring Rally.";
    status.className = "status";
    await refresh();
  } catch (error) {
    storeSignature = "";
    status.textContent = error.message;
    status.className = "status error";
    await refresh();
  }
}

function showProfileState(data) {
  paintConnection(data);
  const signature = JSON.stringify(data);
  if (signature === profileSignature) return;
  profileSignature = signature;
  const root = $("profile-content");
  const tracks = data.catalog || [];
  profileBestRelative = Math.min(0, ...tracks.map((track) => profileDevDifference(track).relativeValue).filter((value) => value != null));
  const official = tracks.filter((track) => track.rally_available);
  const favorite = data.favorite;
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"})[char]);
  const sortValue = (track) => {
    const difference = profileDevDifference(track);
    switch (profileSort.key) {
      case "trial": { const value = clockCentis(track.pb); return Number.isFinite(value) ? value : null; }
      case "absolute": return difference.absoluteValue;
      case "relative": return difference.relativeValue;
      case "trialRuns": return track.records;
      case "rally": return track.rally_pb;
      case "rallyRuns": return track.rally_available ? track.rally_records : null;
      case "average": return track.rally_available ? track.rally_average : null;
      case "laps": return track.rally_available ? track.rally_laps : null;
      default: return track.track_clean || "";
    }
  };
  const visibleTracks = profileMode === "rally_ring" ? tracks.filter((track) => track.rally_available) : tracks;
  const sortedTracks = [...visibleTracks].sort((a, b) => {
    const left = sortValue(a), right = sortValue(b);
    if (left == null || right == null) return left == null ? (right == null ? 0 : 1) : -1;
    const comparison = typeof left === "string" ? left.localeCompare(right) : left - right;
    return comparison * profileSort.direction || (a.track_clean || "").localeCompare(b.track_clean || "");
  });
  const columns = profileMode === "time_trial"
    ? [["track", "Track"], ["trial", "Personal best"], ["absolute", "PB vs dev (abs)"], ["relative", "PB vs dev (rel)"], ["trialRuns", "Runs"], ["reference", "Reference"]]
    : [["track", "Track"], ["rally", "Personal best"], ["rallyRuns", "Runs"], ["average", "Average"], ["laps", "Laps"]];
  const tableRow = (track) => {
    const name = `<td><button type="button" class="profile-track-button" data-track="${escape(track.track)}">${escape(track.track_clean)}</button></td>`;
    if (profileMode === "time_trial") {
      const best = track.top5?.[0];
      const icons = `${best?.beat_velo ? `<img class="profile-beat-icon" src="${VELO_BEAT_ICON}" alt="Velo beaten" title="Velo beaten">` : ""}${best?.beat_dev ? `<img class="profile-beat-icon" src="${DEV_BEAT_ICON}" alt="Developer beaten" title="Developer beaten">` : ""}`;
      const difference = profileDevDifference(track);
      return `<tr>${name}<td>${track.pb === "null" ? "—" : escape(track.pb)}</td><td>${difference.absolute}</td><td><span style="color:${profileRelativeColor(difference.relativeValue)}">${difference.relative}</span></td><td>${track.records}</td><td>${icons || "—"}</td></tr>`;
    }
    if (!track.rally_available) return `<tr>${name}<td>N/A</td><td>—</td><td>—</td><td>—</td></tr>`;
    return `<tr>${name}<td>${track.rally_pb == null ? "—" : formatScore(track.rally_pb)}</td><td>${track.rally_records}</td><td>${track.rally_average == null ? "—" : formatScore(Math.round(track.rally_average))}</td><td>${formatScore(track.rally_laps ?? 0)}</td></tr>`;
  };
  const devs = official.filter((track) => track.dev_time_surpass).length;
  root.innerHTML = `
    <section class="panel profile-hero">
      <div class="profile-avatar">${favorite?.url ? `<img src="${escape(favorite.url)}" alt="${escape(favorite.character || "Favorite character")}">` : '<span>?</span>'}</div>
      <div><div class="eyebrow">Player profile</div><h2>${escape(data.user_name || "Your racing journey")}</h2>
      <p>${favorite ? `${escape(favorite.skin_name || "Default skin")} · Most used skin across both modes (${data.favorite_runs} records)` : "Log a race to reveal your most used skin."}</p></div>
    </section>
    <div class="profile-stats">
      ${[["Time Trial", data.trial_records], ["Ring Rally", data.rally_records], ["Developers beaten", `${devs} / ${official.length}`], ["Skins unlocked", `${data.skins_unlocked} / ${data.skins_total}`], ["Trophies unlocked", `${data.trophies_unlocked} / ${data.trophies_total}`]].map(([label, value]) => `<div class="panel profile-stat"><div class="stat-label">${label}</div><div class="kpi-value">${value}</div></div>`).join("")}
    </div>
    <section class="panel profile-tracks"><div class="profile-heading"><div><div class="eyebrow">Your complete record</div><h2>Track overview</h2></div><div class="profile-mode-label"><span>Mode</span><div class="profile-mode" role="group" aria-label="Track overview mode">${[["time_trial", "Time Trial"], ["rally_ring", "Ring Rally"]].map(([mode, label]) => `<button type="button" class="profile-mode-button${profileMode === mode ? " active" : ""}" data-mode="${mode}" aria-pressed="${profileMode === mode}">${label}</button>`).join("")}</div></div></div>
      <div class="profile-table-wrap"><table><thead><tr>${columns.map(([key, label]) => key === "reference" ? `<th scope="col">${label}</th>` : `<th scope="col"${profileSort.key === key ? ` aria-sort="${profileSort.direction === 1 ? "ascending" : "descending"}"` : ""}><button type="button" class="profile-sort" data-sort="${key}">${label} <span aria-hidden="true">${profileSort.key === key ? (profileSort.direction === 1 ? "↑" : "↓") : "↕"}</span></button></th>`).join("")}</tr></thead><tbody>${sortedTracks.map(tableRow).join("")}</tbody></table></div>
      ${profileMode === "time_trial" ? `<p class="profile-legend"><img class="profile-beat-icon" src="${VELO_BEAT_ICON}" alt=""> Velo beaten · <img class="profile-beat-icon" src="${DEV_BEAT_ICON}" alt=""> Developer beaten</p>` : ""}
    </section>`;
  root.querySelectorAll(".profile-mode-button").forEach((button) => button.addEventListener("click", () => {
    if (profileMode === button.dataset.mode) return;
    profileMode = button.dataset.mode;
    profileSort = { key: "track", direction: 1 };
    profileSignature = "";
    showProfileState(data);
    root.querySelector(`.profile-mode-button[data-mode="${profileMode}"]`)?.focus({ preventScroll: true });
  }));
  root.querySelectorAll(".profile-sort").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.sort;
      profileSort = { key, direction: profileSort.key === key ? -profileSort.direction : (["rally", "trialRuns", "rallyRuns", "average", "laps"].includes(key) ? -1 : 1) };
      profileSignature = "";
      showProfileState(data);
      root.querySelector(`.profile-sort[data-sort="${key}"]`)?.focus({ preventScroll: true });
    });
  });
  root.querySelectorAll(".profile-track-button").forEach((button) => {
    button.addEventListener("click", () => {
      if (profileTrack === button.dataset.track) {
        profileTrack = "";
        $("profile-detail-row")?.remove();
        button.setAttribute("aria-expanded", "false");
        return;
      }
      profileTrack = button.dataset.track;
      renderProfileDetail(data, true);
    });
  });
  if (profileTrack) renderProfileDetail(data);
}

function renderProfileDetail(data, focus = false) {
  const track = data.catalog.find((item) => item.track === profileTrack);
  const button = [...document.querySelectorAll(".profile-track-button")].find((item) => item.dataset.track === profileTrack);
  if (!track || !button) return;
  $("profile-detail-row")?.remove();
  const row = document.createElement("tr");
  row.id = "profile-detail-row";
  row.className = "profile-detail-row";
  const cell = document.createElement("td");
  cell.colSpan = profileMode === "time_trial" ? 6 : 5;
  const detail = document.createElement("div");
  detail.className = "profile-detail";
  cell.append(detail);
  row.append(cell);
  button.closest("tr").after(row);
  button.setAttribute("aria-expanded", "true");
  document.querySelectorAll(".profile-track-button").forEach((item) => {
    if (item !== button) item.setAttribute("aria-expanded", "false");
  });
  const heading = document.createElement("div");
  heading.className = "profile-detail-heading";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "refresh";
  close.textContent = "Close";
  close.addEventListener("click", () => {
    profileTrack = "";
    row.remove();
    button.setAttribute("aria-expanded", "false");
    document.querySelectorAll(".profile-track-button").forEach((button) => {
      if (button.dataset.track === track.track) button.focus();
    });
  });
  heading.append(profileDevIndicators(track), close);
  const charts = document.createElement("div");
  charts.className = "profile-charts";
  charts.append(profileChart("Time Trial", track.trial_history, true, track.dev_time), profileChart("Ring Rally", track.rally_history, false));
  detail.append(heading, charts);
  if (focus) close.focus({ preventScroll: true });
}

function profileDevDifference(track) {
  const devCentis = clockCentis(track.dev_time);
  const values = (track.trial_history || []).map((item) => item.value);
  if (!Number.isFinite(devCentis) || devCentis <= 0 || !values.length) return { absolute: "—", relative: "—", absoluteValue: null, relativeValue: null };
  const deltaCentis = Math.round(Math.min(...values) * 100) - devCentis;
  const sign = deltaCentis < 0 ? "−" : deltaCentis > 0 ? "+" : "";
  const absolute = Math.abs(deltaCentis);
  return {
    absolute: `${sign}${String(Math.floor(absolute / 100)).padStart(2, "0")}:${String(absolute % 100).padStart(2, "0")}`,
    relative: `${sign}${Math.abs(deltaCentis / devCentis * 100).toFixed(2)}%`,
    absoluteValue: deltaCentis,
    relativeValue: deltaCentis / devCentis * 100,
  };
}

function profileRelativeColor(value) {
  if (value == null) return "var(--muted)";
  const ratio = profileBestRelative < 0 ? Math.max(0, Math.min(1, value / profileBestRelative)) : 0;
  return `hsl(${Math.round(ratio * 120)} 75% 68%)`;
}

function profileDevIndicators(track) {
  const difference = profileDevDifference(track);
  const indicators = document.createElement("div");
  indicators.className = "profile-dev-indicators";
  const entries = [["PB vs developer", difference.absolute], ["Relative difference", difference.relative]];
  for (const [label, value] of entries) {
    const item = document.createElement("div");
    const caption = document.createElement("span");
    const number = document.createElement("strong");
    caption.textContent = label;
    number.textContent = value;
    if (label === "Relative difference") number.style.color = profileRelativeColor(difference.relativeValue);
    item.append(caption, number);
    indicators.append(item);
  }
  return indicators;
}

function profileChart(name, history, isTime, devTime) {
  const card = document.createElement("section");
  card.className = "profile-chart";
  const title = document.createElement("h4");
  title.textContent = name;
  card.append(title);
  if (!history?.length) {
    const empty = document.createElement("p");
    empty.className = "profile-chart-empty";
    empty.textContent = "No records for this track yet.";
    card.append(empty);
    return card;
  }
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 500 205");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${name}: ${history.length} records in recorded order. ${isTime ? "Lower is better." : "Higher is better."}`);
  const values = history.map((item) => item.value);
  const devCentis = isTime ? clockCentis(devTime) : Infinity;
  const reference = Number.isFinite(devCentis) && devCentis > 0 ? devCentis / 100 : null;
  const rangeValues = reference == null ? values : [...values, reference];
  const min = Math.min(...rangeValues), max = Math.max(...rangeValues);
  const padding = Math.max((max - min) * 0.12, isTime ? 0.5 : Math.max(max * 0.05, 1));
  const low = min - padding, high = max + padding;
  const x = (i) => history.length === 1 ? 275 : 64 + i * 420 / (history.length - 1);
  const y = (v) => 15 + (high - v) * 155 / (high - low);
  const format = (v) => isTime ? `${Math.floor(v / 60)}:${(v % 60).toFixed(2).padStart(5, "0")}` : Math.round(v).toLocaleString("en-US");
  for (let i = 0; i < 3; i++) {
    const v = high - (high - low) * i / 2;
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", "64"); line.setAttribute("x2", "484"); line.setAttribute("y1", y(v)); line.setAttribute("y2", y(v)); line.setAttribute("class", "chart-grid");
    const label = document.createElementNS(ns, "text");
    label.setAttribute("x", "57"); label.setAttribute("y", y(v) + 4); label.setAttribute("text-anchor", "end"); label.textContent = format(v);
    svg.append(line, label);
  }
  if (reference != null) {
    const area = document.createElementNS(ns, "rect");
    area.setAttribute("x", "64"); area.setAttribute("width", "420");
    area.setAttribute("y", y(reference)); area.setAttribute("height", 170 - y(reference));
    area.setAttribute("class", "chart-reference-area");
    const tip = document.createElementNS(ns, "title");
    tip.textContent = `Faster than developer: ${devTime}`;
    area.append(tip); svg.append(area);
  }
  const rawStep = Math.max(1, (history.length - 1) / 4);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 5, 10].map((factor) => factor * magnitude).find((value) => value >= rawStep);
  for (let race = 1; race <= history.length; race += step) {
    const label = document.createElementNS(ns, "text");
    label.setAttribute("x", x(race - 1)); label.setAttribute("y", "188");
    label.setAttribute("text-anchor", "middle"); label.textContent = String(race);
    svg.append(label);
  }
  const axisLabel = document.createElementNS(ns, "text");
  axisLabel.setAttribute("x", "274"); axisLabel.setAttribute("y", "203");
  axisLabel.setAttribute("text-anchor", "middle"); axisLabel.textContent = "Race number";
  svg.append(axisLabel);
  const polyline = document.createElementNS(ns, "polyline");
  polyline.setAttribute("points", history.map((item, i) => `${x(i)},${y(item.value)}`).join(" "));
  polyline.setAttribute("class", isTime ? "chart-line trial" : "chart-line rally");
  svg.append(polyline);
  history.forEach((item, i) => {
    const dot = document.createElementNS(ns, "circle");
    dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(item.value)); dot.setAttribute("r", "3.5"); dot.setAttribute("class", isTime ? "chart-dot trial" : "chart-dot rally");
    const tip = document.createElementNS(ns, "title");
    tip.textContent = `#${i + 1} · ${item.label || format(item.value)} · ${item.date || "Date unavailable"}`;
    dot.append(tip); svg.append(dot);
  });
  const caption = document.createElement("p");
  caption.textContent = `${history.length} ${history.length === 1 ? "record" : "records"} · oldest to newest · ${isTime ? "lower" : "higher"} is better`;
  if (reference != null) {
    const legend = document.createElement("p");
    legend.className = "chart-reference-legend";
    legend.textContent = `Shaded area: faster than developer (${devTime})`;
    card.append(svg, legend, caption);
  } else card.append(svg, caption);
  return card;
}

function setView(name) {
  $("view-profile").hidden = name !== "profile";
  $("view-register").hidden = name !== "register";
  $("view-rally").hidden = name !== "rally";
  $("view-progress").hidden = name !== "progress";
  $("view-trophies").hidden = name !== "trophies";
  $("view-store").hidden = name !== "store";
  pendingStoreBuy = "";
  currentMode = name === "profile" ? "profile" : name === "rally" ? "rally_ring" : name === "progress" ? "rally_progress" : name === "trophies" ? "rally_trophies" : name === "store" ? "store" : "time_trial";
  for (const button of document.querySelectorAll(".nav-btn")) {
    const active = button.dataset.view === name;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  window.scrollTo({ top: 0 });
  refresh();
}

const TRACK_GAME_ORDER = ["Crash Team Racing", "Crash Nitro Kart", "CTR Nitro Fueled", "Mod"];

function closeTrackMenus(except) {
  for (const menu of document.querySelectorAll(".track-menu.open")) {
    if (menu === except) continue;
    menu.classList.remove("open");
    menu.querySelector(".track-menu-button")?.setAttribute("aria-expanded", "false");
    const panel = menu.querySelector(".track-menu-panel");
    if (panel) panel.hidden = true;
  }
}

function setTrackMenuOpen(menu, open) {
  if (!menu) return;
  if (!open) {
    closeTrackMenus();
    return;
  }
  closeTrackMenus(menu);
  menu.classList.add("open");
  menu.querySelector(".track-menu-button").setAttribute("aria-expanded", "true");
  const panel = menu.querySelector(".track-menu-panel");
  panel.hidden = false;
  panel.querySelector(".track-menu-option[aria-selected='true']")?.scrollIntoView({ block: "nearest" });
}

function chooseTrackMenu(menu, track, name) {
  menu.dataset.value = track;
  menu.querySelector(".track-menu-value").textContent = name;
  for (const option of menu.querySelectorAll(".track-menu-option")) {
    option.setAttribute("aria-selected", option.dataset.track === track ? "true" : "false");
  }
  setTrackMenuOpen(menu, false);
  menu.dispatchEvent(new Event("change"));
}

function paintTrackMenu(menu, rows, current) {
  const signature = JSON.stringify(rows);
  const panel = menu.querySelector(".track-menu-panel");
  if (menu.dataset.signature !== signature) {
    menu.dataset.signature = signature;
    panel.replaceChildren();
    const groups = new Map();
    for (const row of rows) {
      const game = (row.game || "").trim() || "Other";
      if (!groups.has(game)) groups.set(game, []);
      groups.get(game).push(row);
    }
    const names = [...groups.keys()].sort((a, b) => {
      const left = TRACK_GAME_ORDER.indexOf(a);
      const right = TRACK_GAME_ORDER.indexOf(b);
      return (left < 0 ? 99 : left) - (right < 0 ? 99 : right);
    });
    for (const name of names) {
      const group = document.createElement("div");
      group.className = "track-menu-group";
      const label = document.createElement("div");
      label.className = "track-menu-label";
      label.textContent = name;
      group.append(label);
      for (const row of groups.get(name)) {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "track-menu-option";
        option.setAttribute("role", "option");
        option.dataset.track = row.track;
        option.textContent = row.name;
        option.addEventListener("click", () => chooseTrackMenu(menu, row.track, row.name));
        group.append(option);
      }
      panel.append(group);
    }
  }
  const chosen = rows.find((row) => row.track === current)
    || rows.find((row) => row.track === menu.dataset.value)
    || rows[0];
  menu.dataset.value = chosen?.track || "";
  menu.querySelector(".track-menu-value").textContent = chosen?.name || "Choose a track";
  for (const option of panel.querySelectorAll(".track-menu-option")) {
    option.setAttribute("aria-selected", option.dataset.track === menu.dataset.value ? "true" : "false");
  }
}

function renderTrackPicker(data) {
  const picker = $("track-picker");
  const name = $("track-name");
  const running = Boolean(data.game_running);
  const rows = (data.catalog || [])
    .filter((item) => item.track)
    .map((item) => ({ track: item.track, name: item.track_clean || item.track, game: item.track_game || "" }));
  const canPick = !running && rows.length > 0;
  name.hidden = canPick;
  picker.hidden = !canPick;
  if (!canPick) {
    setTrackMenuOpen(picker, false);
    return;
  }
  paintTrackMenu(picker, rows, data.current_track?.track || data.selected?.track || "");
}

function showState(data) {
  appState = data;
  syncSaveLocks(Boolean(data.game_running));
  if (data.game_running) browsedTrackByMode.time_trial = "";
  updateAsset("track", data.selected?.track);
  updateAsset("skin", data.selected?.skin);
  renderTrackPicker(data);

  paintConnection(data);

  renderLastTrial(data.last_trial);
  renderGhosts(data);
  renderIndicators(data);
  $("leader-track").textContent = data.current_track?.track_clean || "null";
  const catalogRows = data.catalog || [];
  const officialRows = catalogRows.filter((track) => String(track.track_game || "").toLowerCase() !== "mod");
  const summary = data.summary || {};
  const records = summary.records ?? catalogRows.reduce((total, track) => total + (Number(track.records) || 0), 0);
  const tracks = summary.tracks ?? officialRows.length;
  const devsBeaten = officialRows.some((track) => "dev_time_surpass" in track)
    ? officialRows.reduce((total, track) => total + (Number(track.dev_time_surpass) === 1 ? 1 : 0), 0)
    : (summary.devs_beaten ?? 0);
  $("kpi-trial-records").textContent = String(records);
  $("kpi-trial-devs").textContent = `${devsBeaten} of ${tracks}`;

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
  paintConnection(data);
  const track = data.current_track?.track_clean || "null";
  $("rally-leader-track").textContent = track;
  renderRallyTrackPicker(data);
  $("kpi-rally-records").textContent = String(data.summary?.records ?? 0);
  $("kpi-rally-tracks").textContent = String((data.catalog || []).filter((row) => Number(row.records) > 0).length);
  const stats = data.indicators;
  paintIndicator("rally-ind-records", String(stats?.records ?? 0));
  paintIndicator("rally-ind-laps", formatScore(stats?.total_laps ?? 0));
  paintIndicator("rally-ind-average", stats?.average_score == null ? "null" : formatScore(Math.round(stats.average_score)));
  fillCards($("rally-cards"), data.top10 || [], { scoreMode: true });
  const last = data.last_trial;
  $("rally-last").textContent = last
    ? `${last.track_clean || "null"} · ${last.character || "null"} · ${formatScore(last.score)} pts`
    : "null";
  $("rally-last-notes").textContent = "";
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
      delta.title = "Gap to the previous PB";
    }
  }
}

function updateRallyAsset(kind, raw) {
  raw = (raw || "").trim();
  if (kind !== "track") {
    paintCharacterBox("rally-skin-name", "rally-skin-raw", "rally-skin-image", raw);
    return;
  }
  const row = find(appState.tracks, "track", raw);
  const name = row.track_clean || "null";
  $("rally-track-name").textContent = name;
  const box = $("rally-track-image");
  const url = (row.url || "").trim();
  if (box.dataset.url !== url) { box.dataset.url = url; imageBox(box, url, name); }
}

function renderRallyTrackPicker(data) {
  const picker = $("rally-track-picker");
  const name = $("rally-track-name");
  const rows = (data.catalog || [])
    .filter((item) => item.track)
    .map((item) => ({ track: item.track, name: item.track_clean || item.track, game: item.track_game || "" }));
  const canPick = !data.game_running && rows.length > 0;
  name.hidden = canPick;
  picker.hidden = !canPick;
  if (!canPick) {
    setTrackMenuOpen(picker, false);
    return;
  }
  paintTrackMenu(picker, rows, data.current_track?.track || data.selected?.track || "");
}

function paintHeaderCoins(data) {
  if (data.balance == null || data.balance === "") return;
  $("header-coin-balance").textContent = formatCoins(data.balance);
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
    if (!response.ok) throw new Error(data.error || "Couldn't load data");
    paintHeaderCoins(data);
    if (currentMode === "profile") showProfileState(data);
    else if (currentMode === "rally_ring") showRallyState(data);
    else if (currentMode === "rally_progress") showProgressState(data);
    else if (currentMode === "rally_trophies") showTrophyState(data);
    else if (currentMode === "store") showStoreState(data);
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
  browsedTrackByMode.time_trial = $("track-picker").dataset.value;
  refresh();
});
$("rally-track-picker").addEventListener("change", () => {
  browsedTrackByMode.rally_ring = $("rally-track-picker").dataset.value;
  refresh();
});
for (const menu of document.querySelectorAll(".track-menu")) {
  menu.querySelector(".track-menu-button").addEventListener("click", () => {
    setTrackMenuOpen(menu, !menu.classList.contains("open"));
  });
}
document.addEventListener("click", (event) => {
  if (!event.target.closest(".store-help")) closeStoreHelp();
  if (event.target.closest(".track-menu")) return;
  closeTrackMenus();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeTrackMenus();
    closeStoreHelp();
  }
});
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
  if (unlockMode(items) === "progress") return "Progress toward the next skin";
  if (skins && trophies) return "Congratulations, you unlocked the following";
  if (skins === 1) return "Congratulations, you unlocked a skin";
  if (skins > 1) return "Congratulations, you unlocked these skins";
  if (trophies === 1) return "Congratulations, you unlocked a trophy";
  return "Congratulations, you unlocked these trophies";
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

function paintResume(draft, record) {
  const box = $("unlock-resume");
  box.replaceChildren();
  const track = document.createElement("div");
  track.className = "unlock-resume-track";
  track.textContent = draft.track?.name || "null";
  const who = document.createElement("div");
  who.className = "unlock-resume-who";
  const skinName = draft.skin?.name || "null";
  const skinDetail = draft.skin?.detail && draft.skin.detail !== "null" ? ` · ${draft.skin.detail}` : "";
  who.textContent = `${skinName}${skinDetail}`;
  const result = document.createElement("div");
  result.className = "unlock-resume-result";
  if (draft.mode === "rally_ring") {
    const laps = Number(record.laps);
    const lapText = Number.isFinite(laps) ? ` · ${formatScore(laps)} ${laps === 1 ? "lap" : "laps"}` : "";
    result.textContent = `${formatScore(record.score)} pts${lapText}`;
  } else {
    result.textContent = record.time_raw || draft.time || "null";
  }
  const coins = document.createElement("div");
  coins.className = "unlock-coins";
  const icon = document.createElement("img");
  icon.src = "/wumpacoin.webp";
  icon.alt = "";
  const amount = document.createElement("strong");
  amount.textContent = `+${formatCoins(record.wumpas)}`;
  const label = document.createElement("span");
  label.textContent = "Wumpacoins";
  coins.append(icon, amount, label);
  box.append(track, who, result);
  const breakdown = document.createElement("div");
  breakdown.className = "resume-breakdown";
  const addRow = (label, value) => {
    const row = document.createElement("div");
    const title = document.createElement("span");
    const amount = document.createElement("strong");
    title.textContent = label;
    amount.textContent = value;
    row.append(title, amount);
    breakdown.append(row);
  };
  if (draft.mode === "rally_ring" && record.multiplier != null) {
    addRow("Global score bonus", `+${Number(record.multiplier).toFixed(3)}`);
    addRow("Progression points", formatScore(record.score_mult));
  }
  const detail = record.wumpa_breakdown;
  if (detail && Object.hasOwn(detail, "base")) {
    addRow("Track Wumpacoins", formatCoins(detail.base));
    if (detail.weekend_multiplier > 1) addRow("Weekend bonus", `×${detail.weekend_multiplier}`);
    if (Number(detail.coin_multiplier) > 1) addRow(`Wumpacoin bonus ×${detail.coin_multiplier}`, `+${formatCoins(detail.multiplier_bonus)}`);
    if (detail.flat_bonus) addRow("Extra Wumpacoins", `+${formatCoins(detail.flat_bonus)}`);
  }
  if (breakdown.childElementCount) box.append(breakdown);
  box.append(coins);
}

let resumeFocus = "score";

function openResume(draft, record, items) {
  paintResume(draft, record);
  const list = $("unlock-list");
  list.replaceChildren();
  const cards = Array.isArray(items) ? items : [];
  for (const item of cards) list.append(paintUnlockItem(item));
  const hasCards = cards.length > 0;
  resumeFocus = draft.focusId || (draft.mode === "rally_ring" ? "score" : "time");
  $("unlock-eyebrow").textContent = draft.mode === "rally_ring" ? "Ring Rally" : "Time Trial";
  $("unlock-title").textContent = "Resume";
  $("unlock-lead").hidden = !hasCards;
  $("unlock-lead").textContent = hasCards ? unlockHeadline(cards) : "";
  list.hidden = !hasCards;
  $("unlock-modal").hidden = false;
  document.querySelector("main").inert = true;
  window.setTimeout(() => $("unlock-ok").focus(), 0);
}

function closeUnlocks() {
  $("unlock-modal").hidden = true;
  document.querySelector("main").inert = false;
  const field = $(resumeFocus);
  if (field) field.focus();
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
