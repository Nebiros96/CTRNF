const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("web/app.js", "utf8");
const functionSource = (name, nextName) => source.slice(source.indexOf(`function ${name}(`), source.indexOf(`function ${nextName}(`));
const context = vm.createContext({ profileMode: "time_trial" });
vm.runInContext(`${functionSource("clockCentis", "byTime")}\n${functionSource("clockFromSeconds", "ghostIcon")}\n${functionSource("profileGames", "showProfileState")}`, context);
const track = (overrides = {}) => ({ track_game: "Game", pb: "1:00:00", dev_time: "1:01:00", records: 2,
  top5: [{ beat_velo: true, beat_dev: true }], rally_available: true, rally_records: 2,
  rally_history: [{ value: 100 }, { value: 200 }], rally_pb: 200, rally_laps: 5, rally_score: 350, ...overrides });
let game = context.profileGames([track(), track({ pb: "1:02:00", top5: [{ beat_velo: true, beat_dev: false }] })])[0];
assert.equal(game.pb, "2:02:00");
assert.equal(game.dev_time, "2:02:00");
assert.equal(game.records, 4);
assert.equal(game.top5[0].beat_velo, true);
assert.equal(game.top5[0].beat_dev, false);
assert.equal(context.profileGames([track(), track({ pb: "null" })])[0].pb, "null");
context.profileMode = "rally_ring";
game = context.profileGames([track(), track({ rally_available: false, track_game: "Mod" })])[0];
assert.equal(context.profileGames([track(), track({ rally_available: false, track_game: "Mod" })]).length, 1);
assert.equal(game.rally_score, 350);
assert.equal(game.rally_average, 150);
vm.runInContext(`${functionSource("byTime", "leaderboardTimes")}\n${functionSource("profileTopEntries", "profileTopFive")}`, context);
const rankedTrack = {
  top5: ["1:00:00", "1:02:00", "1:03:00", "1:04:00", "1:05:00"].map((time_raw) => ({ time_raw })),
  references: [{ kind: "dev", reference: true, time_raw: "1:01:00" }],
  rally_history: [100, 500, 200, 400, 300, 600].map((value) => ({ value })),
};
const times = context.profileTopEntries(rankedTrack, true);
assert.equal(times.length, 5);
assert.equal(times[1].reference, true);
assert.equal(times[4].time_raw, "1:04:00");
rankedTrack.references[0].time_raw = "1:10:00";
assert.equal(context.profileTopEntries(rankedTrack, true).some((entry) => entry.reference), false);
assert.equal(Array.from(context.profileTopEntries(rankedTrack, false), (entry) => entry.value).join(","), "600,500,400,300,200");
console.log("Profile overview aggregation checks passed.");
