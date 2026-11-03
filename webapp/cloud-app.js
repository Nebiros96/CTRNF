import { createClient } from "@supabase/supabase-js";

const $ = (id) => document.getElementById(id);
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;
const state = { user: null, tracks: [], skins: [], characters: [], achievements: [], mode: "rally_ring", pending: null, progression: [], trophies: [], globalMilli: 0, progressSignature: "", progressCharacterId: "", progressSummary: null };
const TIME_TABLE = import.meta.env.VITE_SUPABASE_TIME_TRIALS_TABLE || "time_trials";
const RALLY_TABLE = import.meta.env.VITE_SUPABASE_RALLY_TABLE || "rally_ring";

function setStatus(id, message, error = false) {
  const node = $(id); node.textContent = message; node.className = `status${error ? " error" : ""}`;
}
function table(text, delimiter) {
  const lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const headers = lines.shift().split(delimiter).map((v) => v.trim());
  return lines.map((line) => {
    const cells = []; let cell = ""; let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"' && line[i + 1] === '"' && quoted) { cell += '"'; i++; }
      else if (char === '"') quoted = !quoted;
      else if (char === delimiter && !quoted) { cells.push(cell); cell = ""; }
      else cell += char;
    }
    cells.push(cell);
    return Object.fromEntries(headers.map((header, i) => [header, (cells[i] || "").trim()]));
  });
}
async function loadCsv(path) {
  const response = await fetch(path); if (!response.ok) throw new Error(`No se pudo cargar ${path}`);
  const text = await response.text(); const first = text.split(/\r?\n/, 1)[0];
  return table(text, (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ";" : ",");
}
async function loadCatalogs() {
  [state.tracks, state.skins, state.characters, state.achievements] = await Promise.all([
    loadCsv("/game_tracks.csv"), loadCsv("/game_skins.csv"), loadCsv("/game_characters.csv"), loadCsv("/achievements.csv"),
  ]);
  populateSelect("track-picker", state.tracks, "track", "track_clean");
  populateSelect("rally-track-picker", state.tracks, "track", "track_clean");
  populateSelect("skin-picker", state.skins, "skin", "skin_name", (row) => `${row.character} · ${row.skin_name || row.skin}`);
  populateSelect("rally-skin-picker", state.skins, "skin", "skin_name", (row) => `${row.character} · ${row.skin_name || row.skin}`);
  updateAssets("time_trial"); updateAssets("rally_ring"); $("catalog-version").textContent = `${state.tracks.length} pistas · ${state.skins.length} skins · ${state.achievements.length} trofeos`;
}
function populateSelect(id, rows, valueKey, labelKey, format) {
  const select = $(id); select.replaceChildren();
  for (const row of rows) { const option = document.createElement("option"); option.value = row[valueKey]; option.textContent = format ? format(row) : row[labelKey]; select.append(option); }
}
function trackFor(mode) { return state.tracks.find((row) => row.track === $(`${mode === "time_trial" ? "" : "rally-"}track-picker`).value) || {}; }
function skinFor(mode) { return state.skins.find((row) => row.skin === $(`${mode === "time_trial" ? "" : "rally-"}skin-picker`).value) || {}; }
function paintImage(id, url, alt) {
  const box = $(id); box.replaceChildren();
  if (!url || url === "null") { box.textContent = "null"; box.className = "null-image"; return; }
  const img = document.createElement("img"); img.className = "thumb"; img.src = url; img.alt = alt || ""; img.onerror = () => { box.textContent = "null"; box.className = "null-image"; }; box.className = "asset-image"; box.append(img);
}
function updateAssets(mode) {
  const prefix = mode === "time_trial" ? "" : "rally-"; const track = trackFor(mode); const skin = skinFor(mode);
  $(`${prefix}track-name`).textContent = track.track_clean || "Selecciona una pista";
  $(`${prefix}skin-name`).textContent = skin.character || "Selecciona una skin";
  $(`${prefix}skin-raw`).textContent = skin.skin || "";
  paintImage(`${prefix}track-image`, track.url, track.track_clean); paintImage(`${prefix}skin-image`, skin.url, skin.character);
  $(`${mode === "time_trial" ? "leader" : "rally-leader"}-track`).textContent = track.track_clean || "Selecciona una pista";
  if (mode === "time_trial") renderGhosts(track);
  refreshRecords(mode);
}
function ghostImage(slot, url, alt) {
  slot.replaceChildren();
  if (!url) { const fallback = document.createElement("div"); fallback.className = "ghost-fallback"; fallback.textContent = "?"; slot.append(fallback); return; }
  const image = document.createElement("img"); image.className = "ghost-icon"; image.src = url; image.alt = alt; image.onerror = () => { slot.replaceChildren(); const fallback = document.createElement("div"); fallback.className = "ghost-fallback"; fallback.textContent = "?"; slot.append(fallback); }; slot.append(image);
}
function timeFromSeconds(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === "") return "null";
  const value = Number(String(raw).replace(",", ".")); if (!Number.isFinite(value)) return "null";
  const centis = Math.round(value * 100); const mins = Math.floor(centis / 6000); const secs = Math.floor((centis % 6000) / 100); const frac = centis % 100;
  return `${mins}:${String(secs).padStart(2, "0")}:${String(frac).padStart(2, "0")}`;
}
function renderGhosts(track) {
  $("ghost-velo-time").textContent = timeFromSeconds(track.velo_time);
  $("ghost-dev-name").textContent = track.dev_name || "null";
  $("ghost-dev-time").textContent = timeFromSeconds(track.dev_time);
  ghostImage($("ghost-velo-icon"), "https://static.wikia.nocookie.net/crashban/images/2/2a/Crash_Team_Racing_Nitro-Fueled_Emperor_Velo_XXVII_icon.png/revision/latest?cb=20200221032256", "Velo");
  ghostImage($("ghost-dev-icon"), track.dev_url, track.dev_name || "Desarrollador");
}
function selected(mode) { return { track: trackFor(mode), skin: skinFor(mode) }; }
function currentInput(mode) { return mode === "time_trial" ? $("time").value.trim() : $("score").value.trim(); }
function validTime(raw) {
  const value = raw.trim(); let match = /^(\d+):(\d{2}):(\d{2})$/.exec(value);
  if (!match) match = /^(?:(\d{1,2}):)?(\d{1,2})[.,](\d{1,2})$/.exec(value);
  if (!match) return false;
  const seconds = Number(match[2]); const centiseconds = Number(match[3].padEnd(2, "0"));
  return seconds <= 59 && centiseconds <= 99;
}
function seconds(raw) {
  let match = /^(\d+):(\d{2}):(\d{2})$/.exec(raw);
  if (match) return Number(match[1]) * 60 + Number(match[2]) + Number(match[3]) / 100;
  match = /^(?:(\d{1,2}):)?(\d{1,2})[.,](\d{1,2})$/.exec(raw);
  return Number(match[1] || 0) * 60 + Number(match[2]) + Number(match[3].padEnd(2, "0")) / 100;
}
function showConfirm(mode) {
  const pair = selected(mode); const input = currentInput(mode);
  if (!pair.track.track || !pair.skin.skin) return setStatus(mode === "time_trial" ? "status" : "rally-status", "Elige una pista y una skin.", true);
  if (mode === "time_trial" && !validTime(input)) return setStatus("status", "Usa M:SS:CC, M:SS.CC o SS.CC.", true);
  if (mode === "rally_ring" && (!/^\d+$/.test(input) || !/^\d+$/.test($("laps").value))) return setStatus("rally-status", "Ingresa puntaje y vueltas como números enteros.", true);
  state.pending = { mode, track: pair.track, skin: pair.skin, input, laps: $("laps").value.trim() };
  $("confirm-copy").textContent = mode === "time_trial"
    ? `${pair.track.track_clean} · ${pair.skin.character} / ${pair.skin.skin_name || pair.skin.skin} · ${input}`
    : `${pair.track.track_clean} · ${pair.skin.character} / ${pair.skin.skin_name || pair.skin.skin} · ${Number(input).toLocaleString("en-US")} pts · ${state.pending.laps} vueltas`;
  setStatus("confirm-status", "Se guardará en tu cuenta."); $("confirm-modal").hidden = false; document.querySelector("main#dashboard").inert = true; $("confirm-ok").focus();
}
const UNLOCK_COST = { basic: 500000, exotic: 2000000, legendary: 5000000, beenox: 10000000 };
const BONUS_MILLI = { basic: 1, exotic: 2, legendary: 3, beenox: 5 };
function achievementKind(row) {
  const notes = (row.notes || "").trim().toLowerCase(); const name = (row.name || "").toLowerCase();
  if (notes.startsWith("multiplier")) return { kind: "multiplier", targetMilli: Math.round(Number(String(row.goal).replace(",", ".")) * 1000) };
  if (notes.includes("unlock all") && notes.includes("achievement")) return { kind: "platinum" };
  if (notes.includes("single character")) return { kind: "character_points", target: Number(row.goal) || 0 };
  if (notes === "laps") return { kind: "laps", target: Number(row.goal) || 0 };
  if (notes === "any combination") return { kind: "races", target: Number(row.goal) || 0 };
  if (notes === "any skins") return { kind: "skin_count", target: Number(row.goal) || 0 };
  if (notes === "all skins") return { kind: "all_skins" };
  if (["basic", "exotic", "legendary", "beenox"].includes(notes)) return { kind: "skin_type", skinType: notes };
  if (notes.includes("base points") && name.includes("race")) return { kind: "single_race", target: Number(row.goal) || 0 };
  if (notes.includes("base points") && name.includes("mask")) {
    const found = ["Aku Aku", "Uka Uka", "Velo", "Sparx"].find((club) => notes.includes(club.toLowerCase()));
    return { kind: "mask_points", target: Number(row.goal) || 0, club: found };
  }
  if (notes.includes("base points")) return { kind: "total_points", target: Number(row.goal) || 0 };
  if (name.includes("track")) return { kind: "all_tracks", game: notes };
  if (name.includes("character")) return { kind: "all_characters", game: notes };
  return { kind: "other", target: Number(row.goal) || 0 };
}
function scoreWithMultiplier(score, milli) { return Math.floor((score * (1000 + Math.max(0, milli)) + 500) / 1000); }
function progressionState(rows) {
  const bySkin = new Map(state.skins.map((skin) => [skin.skin, skin]));
  const byCharacter = new Map(state.characters.map((character) => [String(character.character_id), character]));
  const ladders = new Map();
  for (const skin of state.skins) {
    const id = String(skin.character_id || ""); if (!id) continue;
    if (!ladders.has(id)) ladders.set(id, []);
    ladders.get(id).push(skin);
  }
  const characterRows = new Map();
  for (const [id, skins] of ladders) {
    skins.sort((a, b) => Number(a.skin_id) - Number(b.skin_id)); let threshold = 0;
    const ladder = skins.map((skin) => { const cost = UNLOCK_COST[(skin.skin_type || "").toLowerCase()] || 0; threshold += cost; return { ...skin, cost, threshold }; });
    characterRows.set(id, { profile: byCharacter.get(id) || {}, ladder, points: 0, base: 0, runs: 0 });
  }
  const ids = new Set(state.achievements.map((row) => row.id)); const unlockedAt = new Map(); const seenTracks = new Set(); const seenCharacters = new Set();
  let baseTotal = 0; let maxScore = 0; let totalLaps = 0; let races = 0;
  const baseByCharacter = new Map(); const baseByClub = new Map(); const ordered = [...rows].sort((a, b) => Number(a.id) - Number(b.id));
  let milli = 0; const trophyDefinitions = state.achievements.map((item) => ({ ...item, ...achievementKind(item) }));
  for (const row of ordered) {
    const raw = Number(row.score) || 0; const skin = bySkin.get(row.skin); const id = String(skin?.character_id || "");
    const entity = characterRows.get(id); const legacy = Number(row.multiplier || 0) === 0 && milli > 0; const scoreMult = legacy ? scoreWithMultiplier(raw, milli) : Number(row.score_mult) || scoreWithMultiplier(raw, Math.round(Number(row.multiplier || 0) * 1000));
    baseTotal += raw; maxScore = Math.max(maxScore, raw); totalLaps += Number(row.laps) || 0; races += 1;
    if (row.track) seenTracks.add(row.track);
    if (id) {
      seenCharacters.add(id); if (entity) { entity.base += raw; entity.points += scoreMult; entity.runs += 1; }
      baseByCharacter.set(id, (baseByCharacter.get(id) || 0) + raw);
      const mask = (entity?.profile.mask || "").toLowerCase();
      for (const club of ["Aku Aku", "Uka Uka", "Velo", "Sparx"]) if (mask === "any" || mask.includes(club.toLowerCase())) baseByClub.set(club, (baseByClub.get(club) || 0) + raw);
    }
    const skinBonus = [...characterRows.values()].reduce((sum, character) => sum + character.ladder.filter((item) => item.threshold <= character.points).reduce((value, item) => value + (BONUS_MILLI[(item.skin_type || "").toLowerCase()] || 0), 0), 0);
    const regular = trophyDefinitions.filter((item) => !["multiplier", "platinum"].includes(item.kind));
    let earned = 0;
    const currentFor = (ach) => {
      if (ach.kind === "total_points") return baseTotal;
      if (ach.kind === "single_race") return maxScore;
      if (ach.kind === "laps") return totalLaps;
      if (ach.kind === "races") return races;
      if (ach.kind === "skin_count") return [...characterRows.values()].reduce((sum, c) => sum + c.ladder.filter((s) => s.threshold <= c.points).length, 0);
      if (ach.kind === "skin_type") return [...characterRows.values()].reduce((sum, c) => sum + c.ladder.filter((s) => s.threshold <= c.points && (s.skin_type || "").toLowerCase() === ach.skinType).length, 0);
      if (ach.kind === "all_skins") return [...characterRows.values()].reduce((sum, c) => sum + c.ladder.filter((s) => s.threshold <= c.points).length, 0);
      if (ach.kind === "all_tracks") { const tracks = state.tracks.filter((t) => (t.track_game || "").toLowerCase() === (ach.game || "").toLowerCase()); return tracks.filter((t) => seenTracks.has(t.track)).length; }
      if (ach.kind === "all_characters") { const chars = state.characters.filter((c) => (c.game_base || "").toLowerCase() === (ach.game || "").toLowerCase()); return chars.filter((c) => seenCharacters.has(String(c.character_id))).length; }
      if (ach.kind === "mask_points") return baseByClub.get(ach.club) || 0;
      if (ach.kind === "character_points") return Math.max(0, ...baseByCharacter.values());
      return 0;
    };
    const targetFor = (ach) => {
      if (ach.kind === "all_tracks") return state.tracks.filter((t) => (t.track_game || "").toLowerCase() === (ach.game || "").toLowerCase()).length;
      if (ach.kind === "all_characters") return state.characters.filter((c) => (c.game_base || "").toLowerCase() === (ach.game || "").toLowerCase()).length;
      if (ach.kind === "skin_type") return [...characterRows.values()].reduce((sum, c) => sum + c.ladder.filter((s) => (s.skin_type || "").toLowerCase() === ach.skinType).length, 0);
      if (ach.kind === "all_skins") return [...characterRows.values()].reduce((sum, c) => sum + c.ladder.length, 0);
      return ach.target || 0;
    };
    for (const ach of regular) if (targetFor(ach) > 0 && currentFor(ach) >= targetFor(ach)) { earned += Math.round(Number(String(ach.mult).replace(",", ".")) * 1000) || 0; if (!unlockedAt.has(String(ach.id))) unlockedAt.set(String(ach.id), row.captured_at); }
    const bonusBeforeTrophies = skinBonus + earned;
    const multiAch = trophyDefinitions.find((item) => item.kind === "multiplier");
    const multiUnlocked = multiAch && bonusBeforeTrophies >= multiAch.targetMilli;
    if (multiUnlocked && !unlockedAt.has(String(multiAch.id))) unlockedAt.set(String(multiAch.id), row.captured_at);
    const platinum = trophyDefinitions.find((item) => item.kind === "platinum");
    const otherCount = regular.length + (multiAch ? 1 : 0); const unlockedOthers = regular.filter((ach) => {
      if (ach.kind === "all_tracks") return currentFor(ach) === state.tracks.filter((t) => (t.track_game || "").toLowerCase() === (ach.game || "").toLowerCase()).length;
      if (ach.kind === "all_characters") return currentFor(ach) === state.characters.filter((c) => (c.game_base || "").toLowerCase() === (ach.game || "").toLowerCase()).length;
      return targetFor(ach) > 0 && currentFor(ach) >= targetFor(ach);
    }).length + (multiUnlocked ? 1 : 0);
    const platinumUnlocked = platinum && unlockedOthers >= otherCount;
    if (platinumUnlocked && !unlockedAt.has(String(platinum.id))) unlockedAt.set(String(platinum.id), row.captured_at);
    milli = bonusBeforeTrophies + (multiUnlocked ? Math.round(Number(String(multiAch.mult).replace(",", ".")) * 1000) || 0 : 0) + (platinumUnlocked ? Math.round(Number(String(platinum.mult).replace(",", ".")) * 1000) || 0 : 0);
  }
  state.globalMilli = milli;
  state.progression = [...characterRows.entries()].map(([id, entity]) => {
    const { profile, ladder, points, base, runs } = entity; const unlocked = ladder.filter((skin) => skin.threshold <= points); const next = ladder.find((skin) => skin.threshold > points);
    return { character_id: id, character: profile.character || ladder[0]?.character || "null", game_base: profile.game_base || "", mask: profile.mask || "", url_mask: profile.url_mask || "", url_character: profile.url_character || "", points, base_points: base, runs, unlocked: unlocked.length, total_skins: ladder.length, next: next ? { ...next, remaining: next.threshold - points, progress: Math.max(0, Math.min(1, (points - (next.threshold - next.cost)) / next.cost)) } : null, skins: ladder.map((skin) => ({ ...skin, unlocked: skin.threshold <= points, is_next: skin.skin_id === next?.skin_id })) };
  }).sort((a, b) => Number(a.character_id) - Number(b.character_id));
  const skinBonus = [...characterRows.values()].reduce((sum, c) => sum + c.ladder.filter((s) => s.threshold <= c.points).reduce((value, s) => value + (BONUS_MILLI[(s.skin_type || "").toLowerCase()] || 0), 0), 0);
  const achieved = new Set();
  const trophyRows = trophyDefinitions.map((row) => {
    const ach = { ...row, ...achievementKind(row) }; let current = 0; let target = Number(row.goal) || 0;
    if (ach.kind === "multiplier") { current = skinBonus + state.achievements.reduce((sum, item) => sum + (unlockedAt.has(String(item.id)) ? Math.round(Number(String(item.mult).replace(",", ".")) * 1000) || 0 : 0), 0); target = ach.targetMilli; }
    else if (ach.kind === "platinum") { current = state.achievements.filter((item) => item.id !== row.id && unlockedAt.has(String(item.id))).length; target = state.achievements.length - 1; }
    else current = (ach.kind === "total_points" ? baseTotal : ach.kind === "single_race" ? maxScore : ach.kind === "laps" ? totalLaps : ach.kind === "races" ? races : ach.kind === "mask_points" ? (baseByClub.get(ach.club) || 0) : ach.kind === "character_points" ? Math.max(0, ...baseByCharacter.values()) : ach.kind === "all_tracks" ? state.tracks.filter((t) => (t.track_game || "").toLowerCase() === (ach.game || "").toLowerCase() && seenTracks.has(t.track)).length : ach.kind === "all_characters" ? state.characters.filter((c) => (c.game_base || "").toLowerCase() === (ach.game || "").toLowerCase() && seenCharacters.has(String(c.character_id))).length : ach.kind === "skin_type" ? [...characterRows.values()].reduce((sum, c) => sum + c.ladder.filter((s) => s.threshold <= c.points && (s.skin_type || "").toLowerCase() === ach.skinType).length, 0) : [...characterRows.values()].reduce((sum, c) => sum + c.ladder.filter((s) => s.threshold <= c.points).length, 0));
    const unlocked = ach.kind === "multiplier" ? current >= target : ach.kind === "platinum" ? current >= target : ach.kind === "all_tracks" ? current === state.tracks.filter((t) => (t.track_game || "").toLowerCase() === (ach.game || "").toLowerCase()).length : ach.kind === "all_characters" ? current === state.characters.filter((c) => (c.game_base || "").toLowerCase() === (ach.game || "").toLowerCase()).length : ach.kind === "skin_type" ? current === [...characterRows.values()].reduce((sum, c) => sum + c.ladder.filter((s) => (s.skin_type || "").toLowerCase() === ach.skinType).length, 0) : ach.kind === "all_skins" ? current === [...characterRows.values()].reduce((sum, c) => sum + c.ladder.length, 0) : target > 0 && current >= target;
    if (unlocked) achieved.add(String(row.id));
    if (["all_tracks", "all_characters", "skin_type", "all_skins"].includes(ach.kind)) target = ach.kind === "all_tracks" ? state.tracks.filter((t) => (t.track_game || "").toLowerCase() === (ach.game || "").toLowerCase()).length : ach.kind === "all_characters" ? state.characters.filter((c) => (c.game_base || "").toLowerCase() === (ach.game || "").toLowerCase()).length : ach.kind === "skin_type" ? [...characterRows.values()].reduce((sum, c) => sum + c.ladder.filter((s) => (s.skin_type || "").toLowerCase() === ach.skinType).length, 0) : [...characterRows.values()].reduce((sum, c) => sum + c.ladder.length, 0);
    return { id: row.id, name: row.name, notes: row.notes, description: row.description, type: row.type, tier: ({ bronze: "Bronce", silver: "Plata", gold: "Oro", platinum: "Platino" })[(row.type || "").toLowerCase()] || row.type, mult: row.mult, url: row.url, current, target, progress: target ? Math.min(1, current / target) : 0, unlocked, unlocked_at: unlockedAt.get(String(row.id)) || null };
  });
  state.trophies = trophyRows; state.progressSignature = JSON.stringify({ rows, progression: state.progression, trophies: state.trophies, milli });
  return { baseTotal, races, unlockedSkins: state.progression.reduce((sum, c) => sum + c.unlocked, 0), allSkins: state.progression.reduce((sum, c) => sum + c.total_skins, 0) };
}
function previewRallyMultiplier(history, track, skin, score, laps) {
  progressionState(history);
  let multiplier = state.globalMilli; let adjusted = scoreWithMultiplier(score, multiplier);
  const saved = { multiplier: state.globalMilli, progression: state.progression, trophies: state.trophies, signature: state.progressSignature };
  for (let attempt = 0; attempt < 64; attempt++) {
    const simulated = [...history, { id: String(Math.max(0, ...history.map((row) => Number(row.id) || 0)) + 1), track, skin, score, laps, score_mult: adjusted, multiplier: multiplier / 1000, captured_at: new Date().toISOString() }];
    progressionState(simulated); const next = state.globalMilli;
    if (next === multiplier) break;
    multiplier = next; adjusted = scoreWithMultiplier(score, multiplier);
  }
  state.globalMilli = saved.multiplier; state.progression = saved.progression; state.trophies = saved.trophies; state.progressSignature = saved.signature;
  return { multiplier, scoreMult: scoreWithMultiplier(score, multiplier) };
}
async function commit() {
  const draft = state.pending; if (!draft) return; const mode = draft.mode;
  $("confirm-ok").disabled = true; $("confirm-ok").textContent = "Guardando…";
  try {
    const tableName = mode === "time_trial" ? TIME_TABLE : RALLY_TABLE;
    const rows = await supabase.from(tableName).select("id").limit(1);
    if (rows.error) throw rows.error;
    let priorQuery = supabase.from(tableName).select("id").eq("user_id", state.user.id).eq("track", draft.track.track);
    priorQuery = mode === "time_trial" ? priorQuery.order("time_seconds", { ascending: true }).limit(1) : priorQuery.order("score", { ascending: false }).limit(1);
    const { data: priorRows, error: priorError } = await priorQuery;
    if (priorError) throw priorError;
    let pb = 0; let delta = 0; let scoreMult = 0; let recordMultiplier = 0;
    if (mode === "time_trial") {
      const value = seconds(draft.input); const previous = priorRows?.[0]; pb = !previous || value < Number(previous.time_seconds) ? 1 : 0; delta = previous ? Number((value - Number(previous.time_seconds)).toFixed(2)) : 0;
    } else {
      const value = Number(draft.input); const previous = priorRows?.[0]; pb = !previous || value > Number(previous.score) ? 1 : 0; delta = previous ? value - Number(previous.score) : 0;
      const { data: history, error: historyError } = await supabase.from(RALLY_TABLE).select("id,skin,track,score,laps,score_mult,multiplier,notes,captured_at").eq("user_id", state.user.id).order("id", { ascending: true });
      if (historyError) throw historyError;
      const calculated = previewRallyMultiplier(history || [], draft.track.track, draft.skin.skin, value, Number(draft.laps)); recordMultiplier = calculated.multiplier; scoreMult = calculated.scoreMult;
    }
    const payload = mode === "time_trial"
      ? { track_id: Number(draft.track.track_id), track: draft.track.track, skin_id: Number(draft.skin.skin_id), skin: draft.skin.skin, time_raw: draft.input, time_seconds: seconds(draft.input), pb, delta_pb: delta, captured_at: new Date().toISOString(), user_id: state.user.id }
      : { track_id: Number(draft.track.track_id), track: draft.track.track, skin_id: Number(draft.skin.skin_id), skin: draft.skin.skin, score: Number(draft.input), laps: Number(draft.laps), pb, delta_pb: delta, score_mult: scoreMult, multiplier: recordMultiplier / 1000, notes: "", captured_at: new Date().toISOString(), user_id: state.user.id };
    const { data, error } = await supabase.from(tableName).insert(payload).select().single();
    if (error) throw error;
    $("confirm-modal").hidden = true; document.querySelector("main#dashboard").inert = false; $(mode === "time_trial" ? "time" : "score").value = ""; if (mode === "rally_ring") $("laps").value = "";
    setStatus(mode === "time_trial" ? "status" : "rally-status", `Guardado #${data.id}${mode === "rally_ring" ? ` · ${Number(data.score_mult).toLocaleString("en-US")} pts de progresión (×${(1 + Number(data.multiplier)).toFixed(3)})` : ""}.`, false); state.pending = null; await refreshRecords(mode);
  } catch (error) {
    setStatus("confirm-status", error.message || "No se pudo guardar. Revisa la configuración y las políticas de Supabase.", true);
  } finally { $("confirm-ok").disabled = false; $("confirm-ok").textContent = "Confirmar"; }
}
function timeValue(row) { const value = Number(row.time_seconds); return Number.isFinite(value) ? value : seconds(row.time_raw); }
function recordCard(row, mode, rank) {
  const card = document.createElement("article"); card.className = `card${rank === 1 ? " top1" : ""}`;
  const n = document.createElement("div"); n.className = "rank"; n.textContent = `#${rank}`;
  const art = document.createElement("div"); art.className = "card-art"; paintImageOn(art, state.skins.find((skin) => skin.skin === row.skin)?.url, row.skin);
  const details = document.createElement("div"); details.className = "details";
  const title = document.createElement("div"); title.className = "trackname"; title.textContent = row.skin || "Skin";
  const character = state.skins.find((skin) => skin.skin === row.skin)?.character || ""; const sub = document.createElement("div"); sub.className = "character"; sub.textContent = `${character} · ${new Date(row.captured_at).toLocaleDateString("es-CO")}`;
  const result = document.createElement("div"); result.className = "pb"; result.textContent = mode === "time_trial" ? row.time_raw : `${Number(row.score).toLocaleString("en-US")} pts`;
  details.append(title, sub, result); card.append(n, art, details); return card;
}
function paintImageOn(box, url, alt) { box.replaceChildren(); if (!url) { box.textContent = "null"; box.className = "null-image"; return; } const img = document.createElement("img"); img.src = url; img.alt = alt; img.loading = "lazy"; img.onerror = () => { box.replaceChildren(document.createTextNode("null")); }; box.className = "card-image"; box.append(img); }
async function refreshRecords(mode = state.mode) {
  if (!supabase || !state.user || !state.tracks.length) return;
  const isTrial = mode === "time_trial"; const track = trackFor(mode); if (!track.track) return;
  const tableName = isTrial ? TIME_TABLE : RALLY_TABLE; const order = isTrial ? "time_seconds" : "score";
  let query = supabase.from(tableName).select("*").eq("user_id", state.user.id).eq("track", track.track);
  if (isTrial) query = query.order(order, { ascending: true });
  else query = query.order(order, { ascending: false });
  const { data, error } = await query.limit(10);
  if (error) { setStatus(isTrial ? "status" : "rally-status", error.message, true); return; }
  const board = isTrial ? $("cards") : $("rally-cards"); board.replaceChildren();
  for (const [index, row] of (data || []).entries()) board.append(recordCard(row, mode, index + 1));
  if (!data?.length) { const empty = document.createElement("div"); empty.className = "empty"; empty.textContent = "Aún no tienes registros en esta pista."; board.append(empty); }
  if (isTrial) { $("trial-pb").textContent = data?.[0]?.time_raw || "—"; $("trial-count").textContent = `${data?.length || 0} registros`; }
  else { const best = (data || [])[0]; $("rally-pb").textContent = best ? `${Number(best.score).toLocaleString("en-US")} pts` : "—"; $("rally-count").textContent = `${data?.length || 0} registros`; }
  if (mode === "rally_ring") await refreshProgression();
}
async function refreshProgression() {
  const { data, error } = await supabase.from(RALLY_TABLE).select("id,skin,track,score,laps,score_mult,multiplier,notes,captured_at").eq("user_id", state.user.id).order("id", { ascending: true });
  if (error) { setStatus("rally-status", error.message, true); return; }
  const summary = progressionState(data || []);
  $("kpi-records").textContent = String(data?.length || 0);
  state.progressSummary = summary;
  if (state.mode === "progress") renderProgress(summary);
  else if (state.mode === "trophies") renderTrophies();
}
function setView(view) {
  for (const name of ["register", "rally", "progress", "trophies"]) $(`view-${name}`).hidden = name !== view;
  state.mode = view === "register" ? "time_trial" : view === "rally" ? "rally_ring" : view;
  document.querySelectorAll(".nav-btn").forEach((button) => { const active = button.dataset.view === view; button.classList.toggle("active", active); if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current"); });
  if (view === "progress" || view === "trophies") refreshProgression(); refreshRecords(state.mode);
}
function renderProgress(summary = state.progressSummary) {
  const characters = state.progression;
  $("progress-total").replaceChildren(); const totalValue = document.createElement("div"); totalValue.className = "progress-total-value"; totalValue.textContent = Number(summary?.baseTotal || 0).toLocaleString("en-US"); const totalLabel = document.createElement("div"); totalLabel.className = "eyebrow"; totalLabel.textContent = "Puntos base totales de Ring Rally"; $("progress-total").append(totalValue, totalLabel);
  if (!state.progressCharacterId || !characters.some((row) => row.character_id === state.progressCharacterId)) state.progressCharacterId = characters.find((row) => row.runs > 0)?.character_id || characters[0]?.character_id || "";
  const roster = $("progress-roster"); const scroll = roster.scrollTop; roster.replaceChildren(); const query = $("progress-search").value.trim().toLocaleLowerCase("es"); let group = null;
  for (const character of characters) {
    if (query && !character.character.toLocaleLowerCase("es").includes(query)) continue;
    if (!group || group.dataset.game !== character.game_base) { group = document.createElement("section"); group.className = "roster-group"; group.dataset.game = character.game_base; const label = document.createElement("div"); label.className = "roster-label"; label.textContent = character.game_base || "Otros"; group.append(label); roster.append(group); }
    const button = document.createElement("button"); button.type = "button"; button.className = `roster-item${character.character_id === state.progressCharacterId ? " active" : ""}${character.points > 0 ? " has-points" : ""}`;
    const photo = document.createElement("div"); photo.className = "roster-photo"; paintImageOn(photo, character.url_character, character.character);
    const copy = document.createElement("div"); copy.className = "roster-copy"; const name = document.createElement("div"); name.className = "roster-name"; name.textContent = character.character; const meta = document.createElement("div"); meta.className = "roster-meta"; meta.textContent = `${character.unlocked}/${character.total_skins}`;
    const bar = document.createElement("div"); bar.className = "roster-bar"; const fill = document.createElement("div"); fill.className = "roster-bar-fill"; const progress = character.total_skins ? (character.unlocked + (character.next?.progress || 0)) / character.total_skins : 0; fill.style.width = `${Math.max(0, Math.min(100, progress * 100))}%`; bar.append(fill); copy.append(name, meta, bar); button.append(photo, copy);
    button.addEventListener("click", () => { state.progressCharacterId = character.character_id; renderProgress(summary); }); group.append(button);
  }
  if (!roster.children.length) { const empty = document.createElement("div"); empty.className = "empty"; empty.textContent = query ? "Ningún personaje coincide." : "No hay personajes en el catálogo."; roster.append(empty); }
  roster.scrollTop = scroll;
  const selected = characters.find((row) => row.character_id === state.progressCharacterId); paintProgressTotalCloud(summary); paintSkinTotalsCloud(characters); paintGlobalMultiplierCloud(); paintProgressHeroCloud(selected); paintAlbumCloud(selected);
}
function paintProgressTotalCloud(summary) {
  const box = $("progress-total"); box.replaceChildren(); const value = document.createElement("div"); value.className = "progress-total-value"; value.textContent = Number(summary?.baseTotal || 0).toLocaleString("en-US"); const label = document.createElement("div"); label.className = "eyebrow"; label.textContent = "Puntos totales"; box.append(value, label);
}
function paintSkinTotalsCloud(characters) {
  const box = $("skin-totals"); box.replaceChildren(); const types = [{ key: "basic", label: "Basic" }, { key: "exotic", label: "Exotic" }, { key: "legendary", label: "Legendary" }, { key: "beenox", label: "Beenox" }]; const totals = Object.fromEntries(types.map(({ key }) => [key, { unlocked: 0, total: 0 }]));
  for (const character of characters) for (const skin of character.skins) { const key = (skin.skin_type || "").toLowerCase(); if (!totals[key]) continue; totals[key].total++; if (skin.unlocked) totals[key].unlocked++; }
  const all = Object.values(totals).reduce((sum, item) => sum + item.total, 0); const owned = Object.values(totals).reduce((sum, item) => sum + item.unlocked, 0); const header = document.createElement("div"); header.className = "skin-totals-heading"; const label = document.createElement("div"); label.className = "eyebrow"; label.textContent = "Skins desbloqueadas"; const amount = document.createElement("div"); amount.className = "skin-totals-overall"; amount.textContent = `${owned} de ${all}`; header.append(label, amount); const grid = document.createElement("div"); grid.className = "skin-totals-grid";
  for (const { key, label: typeLabel } of types) { const item = totals[key]; const card = document.createElement("div"); card.className = `skin-total type-${key}`; const name = document.createElement("div"); name.className = "skin-total-name"; name.textContent = typeLabel; const count = document.createElement("div"); count.className = "skin-total-count"; count.textContent = `${item.unlocked} / ${item.total}`; const track = document.createElement("div"); track.className = "skin-total-track"; const fill = document.createElement("div"); fill.className = `skin-total-fill type-${key}`; fill.style.width = `${item.total ? item.unlocked / item.total * 100 : 0}%`; track.append(fill); card.append(name, count, track); grid.append(card); }
  box.append(header, grid);
}
function paintGlobalMultiplierCloud() {
  const box = $("progress-global"); box.replaceChildren(); const copy = document.createElement("div"); copy.className = "global-mult-copy"; const titleRow = document.createElement("div"); titleRow.className = "global-mult-title"; const label = document.createElement("div"); label.className = "eyebrow"; label.textContent = "Multiplicador global"; const help = document.createElement("div"); help.className = "multiplier-help"; const button = document.createElement("button"); button.type = "button"; button.className = "multiplier-info"; button.textContent = "i"; button.setAttribute("aria-label", "Ver cómo se calcula el multiplicador"); button.setAttribute("aria-expanded", "false"); const detail = document.createElement("div"); detail.className = "multiplier-help-popover"; detail.hidden = true; detail.textContent = "Cada skin suma: Basic 0.001 · Exotic 0.002 · Legendary 0.003 · Beenox 0.005. Los trofeos suman el bonus mostrado."; button.addEventListener("click", () => { detail.hidden = !detail.hidden; button.setAttribute("aria-expanded", String(!detail.hidden)); }); help.append(button, detail); titleRow.append(label, help); const value = document.createElement("div"); value.className = "global-mult-value"; value.textContent = `×${(1 + state.globalMilli / 1000).toFixed(3)}`; const note = document.createElement("p"); note.className = "hero-rule"; note.textContent = "La siguiente carrera usa este valor con cualquier personaje."; copy.append(titleRow, note); box.append(value, copy);
}
function paintProgressHeroCloud(character) {
  const hero = $("progress-hero"); hero.replaceChildren(); if (!character) { const empty = document.createElement("div"); empty.className = "empty"; empty.textContent = "No hay personajes en el catálogo."; hero.append(empty); return; }
  const portrait = document.createElement("div"); portrait.className = "hero-portrait"; paintImageOn(portrait, character.url_character, character.character); const copy = document.createElement("div"); copy.className = "hero-copy"; const eyebrow = document.createElement("div"); eyebrow.className = "eyebrow"; eyebrow.textContent = character.game_base || "Ring Rally"; const title = document.createElement("h2"); title.textContent = character.character; const maskLine = document.createElement("div"); maskLine.className = "hero-mask"; if (character.url_mask) { const icon = document.createElement("img"); icon.className = "mask-icon"; icon.src = character.url_mask; icon.alt = character.mask || ""; maskLine.append(icon); } if (character.mask) { const mask = document.createElement("span"); mask.textContent = character.mask; maskLine.append(mask); }
  const runs = document.createElement("div"); runs.className = "hero-runs"; runs.textContent = character.runs ? `${character.runs} ${character.runs === 1 ? "registro" : "registros"}` : "Sin registros"; const stats = document.createElement("div"); stats.className = "progress-stats"; const stat = document.createElement("div"); stat.className = "progress-stat is-points"; const statLabel = document.createElement("div"); statLabel.className = "stat-label"; statLabel.textContent = "Puntos de progresión"; const points = document.createElement("div"); points.className = "progress-stat-value"; points.textContent = Number(character.points).toLocaleString("en-US"); stat.append(statLabel, points); stats.append(stat);
  const bar = document.createElement("div"); bar.className = "unlock-track"; bar.setAttribute("role", "progressbar"); bar.setAttribute("aria-valuemin", "0"); bar.setAttribute("aria-valuemax", "100"); const fill = document.createElement("div"); fill.className = "unlock-fill"; const caption = document.createElement("div"); caption.className = "unlock-caption"; const next = character.next; const percent = next?.progress ? Math.min(100, next.progress * 100) : next ? 0 : 100; fill.style.width = `${percent}%`; bar.setAttribute("aria-valuenow", String(Math.round(percent))); caption.textContent = next ? `${Number(character.points).toLocaleString("en-US")} / ${Number(next.threshold).toLocaleString("en-US")} · faltan ${Number(next.remaining).toLocaleString("en-US")} para ${next.skin_name} (${next.skin_type})` : "Álbum completo."; bar.append(fill); const costs = document.createElement("p"); costs.className = "hero-rule"; costs.textContent = "El álbum sigue el orden de las skins. Costos: Basic 500,000 · Exotic 2,000,000 · Legendary 5,000,000 · Beenox 10,000,000."; copy.append(eyebrow, title, maskLine, runs, stats, bar, caption, costs);
  if (character.base_points !== character.points) { const base = document.createElement("p"); base.className = "hero-rule"; base.textContent = `Puntaje base acumulado ${Number(character.base_points).toLocaleString("en-US")} pts. El álbum usa puntos ya multiplicados.`; copy.append(base); }
  const count = document.createElement("div"); count.className = "hero-album"; const countLabel = document.createElement("div"); countLabel.className = "stat-label"; countLabel.textContent = "Álbum"; const countValue = document.createElement("div"); countValue.className = "hero-album-value"; countValue.textContent = `${character.unlocked} de ${character.total_skins}`; count.append(countLabel, countValue); hero.append(portrait, copy, count);
}
function paintAlbumCloud(character) {
  const album = $("progress-album"); album.replaceChildren(); if (!character) return; if (!character.skins.length) { const empty = document.createElement("div"); empty.className = "empty"; empty.textContent = "Este personaje no tiene skins en el catálogo."; album.append(empty); return; }
  character.skins.forEach((skin, index) => { const card = document.createElement("article"); card.className = `skin-card${skin.unlocked ? " unlocked" : " locked"}${skin.is_next ? " next" : ""}`; const order = document.createElement("div"); order.className = "skin-order"; order.textContent = String(index + 1).padStart(2, "0"); const frame = document.createElement("div"); frame.className = "skin-frame"; paintImageOn(frame, skin.url, skin.skin_name); const art = frame.querySelector("img"); if (art) art.className = "skin-art"; const name = document.createElement("div"); name.className = "skin-title"; name.textContent = skin.skin_name || skin.skin; const type = document.createElement("div"); type.className = `skin-type type-${(skin.skin_type || "").toLowerCase()}`; type.textContent = skin.skin_type || ""; const label = document.createElement("div"); label.className = "skin-state"; label.textContent = skin.unlocked ? "Desbloqueada" : `${Number(skin.threshold).toLocaleString("en-US")} pts`; card.append(order, frame, name, type, label); if (skin.unlocked) { const check = document.createElement("div"); check.className = "skin-check"; check.textContent = "✓"; card.append(check); } if (skin.is_next && character.next) { const mini = document.createElement("div"); mini.className = "unlock-track mini"; const miniFill = document.createElement("div"); miniFill.className = "unlock-fill"; miniFill.style.width = `${Math.max(0, Math.min(100, Number(character.next.progress) * 100))}%`; mini.append(miniFill); card.append(mini); } album.append(card); });
}
function renderTrophies() {
  const list = $("trophy-list"); list.replaceChildren(); const trophies = state.trophies || []; const unlocked = trophies.filter((row) => row.unlocked).length; $("trophy-count").textContent = `${unlocked} de ${trophies.length}`;
  if (!trophies.length) { const empty = document.createElement("div"); empty.className = "empty"; empty.textContent = "No hay logros en el catálogo."; list.append(empty); return; }
  for (const row of trophies) {
    const item = document.createElement("article"); item.className = `trophy ${row.unlocked ? "unlocked" : "locked"} tier-${(row.type || "").toLowerCase()}`;
    const art = document.createElement("div"); art.className = "trophy-icon"; paintImageOn(art, row.url, row.name);
    const copy = document.createElement("div"); copy.className = "trophy-body"; const head = document.createElement("div"); head.className = "trophy-title-row"; const title = document.createElement("h3"); title.textContent = row.name; const tier = document.createElement("span"); tier.className = "trophy-tier"; tier.textContent = `${row.tier || row.type} +${row.mult}`; head.append(title, tier);
    const desc = document.createElement("p"); desc.className = "trophy-meta"; desc.textContent = row.description || row.notes || "";
    const progress = document.createElement("div"); progress.className = "trophy-progress"; const amount = document.createElement("div"); amount.className = "trophy-amount"; amount.textContent = `${Number(row.current || 0).toLocaleString("en-US")} / ${Number(row.target || 0).toLocaleString("en-US")}`;
    const bar = document.createElement("div"); bar.className = "unlock-track"; const fill = document.createElement("div"); fill.className = "unlock-fill"; fill.style.width = `${Math.max(0, Math.min(100, Number(row.progress || 0) * 100))}%`; bar.append(fill); progress.append(amount, bar); copy.append(head, desc, progress);
    const date = document.createElement("div"); date.className = "trophy-date"; date.textContent = row.unlocked ? new Date(row.unlocked_at || Date.now()).toLocaleDateString("es-CO") : "Sin desbloquear"; item.append(art, copy, date); list.append(item);
  }
}
function paintAuthMode(mode) {
  const signup = mode === "signup"; $("confirm-wrap").hidden = !signup; $("auth-password").autocomplete = signup ? "new-password" : "current-password"; $("auth-submit").textContent = signup ? "Crear cuenta" : "Iniciar sesión";
  $("login-tab").classList.toggle("active", !signup); $("signup-tab").classList.toggle("active", signup); $("login-tab").setAttribute("aria-selected", String(!signup)); $("signup-tab").setAttribute("aria-selected", String(signup)); setStatus("auth-status", signup ? "Tu cuenta se usará para guardar tu progreso." : "Usa el correo y contraseña de tu cuenta.");
}
async function showSession(session) {
  if (!session) { state.user = null; $("dashboard").hidden = true; $("auth-screen").hidden = false; return; }
  state.user = session.user; $("account-email").textContent = session.user.email || "Cuenta de jugador"; $("auth-screen").hidden = true; $("dashboard").hidden = false;
  try { await loadCatalogs(); $("cloud-connection").textContent = "Supabase listo · captura manual"; $("cloud-connection").classList.add("live"); await refreshRecords(state.mode); }
  catch (error) { $("cloud-connection").textContent = "Error al cargar catálogos"; setStatus("status", error.message, true); }
}
$("login-tab").addEventListener("click", () => paintAuthMode("login")); $("signup-tab").addEventListener("click", () => paintAuthMode("signup"));
$("auth-form").addEventListener("submit", async (event) => {
  event.preventDefault(); if (!supabase) return setStatus("auth-status", "Completa .env.local con la URL y la clave pública de Supabase, y reinicia la web.", true);
  const email = $("auth-email").value.trim(); const password = $("auth-password").value; const signup = $("signup-tab").classList.contains("active");
  if (signup && password !== $("auth-confirm").value) return setStatus("auth-status", "Las contraseñas no coinciden.", true);
  $("auth-submit").disabled = true; setStatus("auth-status", signup ? "Creando cuenta…" : "Iniciando sesión…");
  try {
    const result = signup ? await supabase.auth.signUp({ email, password }) : await supabase.auth.signInWithPassword({ email, password });
    if (result.error) throw result.error;
    if (signup && !result.data.session) { setStatus("auth-status", "Cuenta creada. Confirma el correo y luego inicia sesión."); return; }
    await showSession(result.data.session);
  } catch (error) { setStatus("auth-status", error.message || "No se pudo completar el acceso.", true); }
  finally { $("auth-submit").disabled = false; }
});
$("signout").addEventListener("click", async () => { if (supabase) await supabase.auth.signOut(); await showSession(null); });
document.querySelectorAll(".nav-btn").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
for (const id of ["track-picker", "skin-picker"]) $(id).addEventListener("change", () => updateAssets("time_trial"));
for (const id of ["rally-track-picker", "rally-skin-picker"]) $(id).addEventListener("change", () => updateAssets("rally_ring"));
$("progress-search").addEventListener("input", () => renderProgress());
$("save").addEventListener("click", () => showConfirm("time_trial")); $("rally-save").addEventListener("click", () => showConfirm("rally_ring"));
$("refresh").addEventListener("click", () => refreshRecords("time_trial")); $("rally-refresh").addEventListener("click", () => refreshRecords("rally_ring")); $("confirm-ok").addEventListener("click", commit);
$("confirm-correct").addEventListener("click", () => { $("confirm-modal").hidden = true; $("dashboard").inert = false; state.pending = null; });
$("confirm-modal").addEventListener("click", (event) => { if (event.target.closest("[data-confirm-dismiss]")) $("confirm-correct").click(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !$("confirm-modal").hidden) $("confirm-correct").click(); });

if (!supabase) {
  $("cloud-connection").textContent = "Falta configurar Supabase";
  const missing = [!SUPABASE_URL && "VITE_SUPABASE_URL", !SUPABASE_KEY && "VITE_SUPABASE_ANON_KEY"].filter(Boolean);
  setStatus("auth-status", `Vite no cargó: ${missing.join(" y ")}. Reinicia el servidor desde la carpeta CTRNF.`, true);
}
else supabase.auth.getSession().then(({ data }) => showSession(data.session)).catch((error) => setStatus("auth-status", error.message, true));
if (supabase) supabase.auth.onAuthStateChange((_event, session) => {
  const newId = session?.user?.id || null; const previousId = state.user?.id || null;
  if (newId !== previousId) window.setTimeout(() => showSession(session), 0);
});
