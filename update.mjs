// Fetches team 2B stats from Nitro Type and saves them to data.json
import { readFile, writeFile } from "node:fs/promises";

const TEAM = "2B";
const H = { "User-Agent": "Mozilla/5.0 (compatible; TeamSiteBot/1.0)", "Accept": "application/json" };

const res = await fetch(`https://www.nitrotype.com/api/v2/teams/${TEAM}`, { headers: H });
const text = await res.text();
let team;
try { team = JSON.parse(text); } catch { throw new Error(`HTTP ${res.status}, not JSON: ${text.slice(0, 120)}`); }
const members = team?.results?.members;
if (!Array.isArray(members) || !members.length) throw new Error("No members found in team data");

// find the car picture file names (carID -> file name)
const carFiles = {};
const carDebug = [];
function readCars(text) {
  const re = /"carID":(\d+)(?:(?!"carID")[\s\S]){0,800}?"smallSrc":"([^"]+)"/g;
  let m, n = 0;
  while ((m = re.exec(text))) { carFiles[m[1]] = m[2].replace(/\\\//g, "/"); n++; }
  return n;
}
async function getText(url) {
  const r = await fetch(url, { headers: { ...H, Accept: "*/*" } });
  return r.text();
}
try {
  for (const u of ["https://www.nitrotype.com/api/v2/cars", "https://www.nitrotype.com/api/cars"]) {
    try { const n = readCars(await getText(u)); carDebug.push(`${u}: ${n}`); if (n) break; } catch (e) { carDebug.push(`${u}: ${e.message}`); }
  }
  if (!Object.keys(carFiles).length) {
    const home = await getText("https://www.nitrotype.com/");
    carDebug.push("home: " + readCars(home));
    if (!Object.keys(carFiles).length) {
      const srcs = [...home.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => new URL(m[1], "https://www.nitrotype.com/").href);
      for (const u of srcs) {
        try { const n = readCars(await getText(u)); carDebug.push(`${u}: ${n}`); if (n) break; } catch (e) { carDebug.push(`${u}: ${e.message}`); }
      }
    }
  }
} catch (e) { carDebug.push("car lookup failed: " + e.message); }
console.log("Cars found:", Object.keys(carFiles).length);

// who is the captain? Nitro Type may mark it in the team info; this name is the backup
const CAPTAIN_NAME = "Sub 2 PickleNT on YT";
const info = team.results.info || {};
const captainIds = new Set(Object.entries(info)
  .filter(([k, v]) => /captain|owner|leader|creator/i.test(k) && (typeof v === "number" || typeof v === "string"))
  .map(([, v]) => String(v)));

// team details for the home page (formed date and page views come from Nitro Type's team info)
function numFrom(re, min) {
  for (const src of [info, team.results]) for (const [k, v] of Object.entries(src || {})) {
    if (re.test(k) && typeof v !== "object" && Number(v) > (min || 0)) return Number(v);
  }
  return null;
}
const teamMeta = {
  tag: info.tag || TEAM,
  name: info.name || "2B Determined",
  formedStamp: numFrom(/creat|form|found|start/i, 1e9) || Date.parse("2026-10-25") / 1000,
  views: numFrom(/view/i, 0)
};

let old = {};
try { old = JSON.parse(await readFile("data.json", "utf8")); } catch {}
const today = new Date().toISOString().slice(0, 10);

const racers = members.map(m => ({
  username: m.username,
  displayName: m.displayName || m.username,
  role: (m.role === "captain" || captainIds.has(String(m.userID)) || m.displayName === CAPTAIN_NAME) ? "captain" : (m.role || "member"),
  title: m.title || "",
  membership: m.membership || "",
  carId: m.carID ?? null,
  carHue: m.carHueAngle ?? 0,
  carFile: carFiles[m.carID] || null,
  carImage: carFiles[m.carID] ? `https://www.nitrotype.com/cars/${carFiles[m.carID]}` : null,
  avgSpeed: m.avgSpeed ?? null,
  highSpeed: m.highestSpeed ?? null,
  lifetimeRaces: m.racesPlayed ?? null,
  teamRaces: m.played ?? 0,
  memberSince: m.joinStamp ?? null,
  lastRace: m.lastActivity ?? null
}));

// ---- everyone with a website account who is NOT on the team: look up their car and stats ----
// The website saves a public list of racer names in Firestore (collection "publicRacers"); we read it here.
const extrasDebug = [];
const teamNames = new Set(racers.map(r => r.username.toLowerCase()));
let wanted = [];
try {
  const cfg = await readFile("firebase-config.js", "utf8");
  const pid = cfg.match(/projectId:\s*"([^"]+)"/)?.[1], key = cfg.match(/apiKey:\s*"([^"]+)"/)?.[1];
  if (!pid || !key) throw new Error("projectId/apiKey not found in firebase-config.js");
  let token = "";
  do {
    const u = `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/publicRacers?pageSize=300&key=${key}${token ? "&pageToken=" + token : ""}`;
    const r = await fetch(u);
    const j = await r.json();
    if (!r.ok) throw new Error(`Firestore HTTP ${r.status}: ${JSON.stringify(j).slice(0, 160)}`);
    for (const d of j.documents || []) { const n = d.fields?.racer?.stringValue; if (n) wanted.push(n); }
    token = j.nextPageToken || "";
  } while (token);
  extrasDebug.push(`public racer list: ${wanted.length}`);
} catch (e) { extrasDebug.push("public racer list failed: " + e.message); }
wanted = [...new Set(wanted)].filter(n => !teamNames.has(n.toLowerCase())).slice(0, 150);

// pull a racer's numbers out of whatever Nitro Type sends back (JSON or a web page)
function pickRacer(text, name) {
  const lower = name.toLowerCase();
  let obj = null;
  try {
    const walk = v => {
      if (obj || !v || typeof v !== "object") return;
      if (typeof v.username === "string" && v.username.toLowerCase() === lower && (v.carID != null || v.avgSpeed != null || v.racesPlayed != null)) { obj = v; return; }
      for (const k of Object.keys(v)) walk(v[k]);
    };
    walk(JSON.parse(text));
  } catch {}
  if (!obj) {
    const i = text.toLowerCase().indexOf(`"username":"${lower}"`);
    if (i < 0) return null;
    const w = text.slice(Math.max(0, i - 1500), i + 2500), num = k => { const m = w.match(new RegExp(`"${k}":\\s*"?(-?[\\d.]+)`)); return m ? Number(m[1]) : null; };
    obj = { username: name, carID: num("carID"), carHueAngle: num("carHueAngle"), avgSpeed: num("avgSpeed"), highestSpeed: num("highestSpeed"), racesPlayed: num("racesPlayed"), displayName: w.match(/"displayName":"([^"]*)"/)?.[1], title: w.match(/"title":"([^"]*)"/)?.[1], membership: w.match(/"membership":"([^"]*)"/)?.[1] };
  }
  return obj;
}
const extras = [];
for (const name of wanted) {
  let found = null;
  const tries = [`https://www.nitrotype.com/api/v2/racers/${encodeURIComponent(name)}`, `https://www.nitrotype.com/racer/${encodeURIComponent(name)}`];
  for (const u of tries) {
    try {
      const rr = await fetch(u, { headers: { ...H, Accept: "application/json,text/html,*/*" } });
      const t = await rr.text();
      found = pickRacer(t, name);
      extrasDebug.push(`${name} ${u.includes("/api/") ? "api" : "page"}: HTTP ${rr.status} ${found ? "ok" : "no data (" + t.slice(0, 90).replace(/\s+/g, " ") + ")"}`);
      if (found) break;
    } catch (e) { extrasDebug.push(`${name}: ${e.message}`); }
    await new Promise(r => setTimeout(r, 300));
  }
  const prev = (old.extras || []).find(x => x.username.toLowerCase() === name.toLowerCase());
  if (found) {
    extras.push({
      username: found.username || name, displayName: found.displayName || found.username || name, title: found.title || "", membership: found.membership || "",
      carId: found.carID ?? null, carHue: found.carHueAngle ?? 0, carFile: carFiles[found.carID] || null,
      carImage: carFiles[found.carID] ? `https://www.nitrotype.com/cars/${carFiles[found.carID]}` : null,
      avgSpeed: found.avgSpeed ?? null, highSpeed: found.highestSpeed ?? null, lifetimeRaces: found.racesPlayed ?? null
    });
  } else if (prev) extras.push(prev);
  await new Promise(r => setTimeout(r, 300));
}

// download each car picture once so the site can recolor it exactly
const cars = {};
for (const r of racers.concat(extras)) {
  if (!r.carFile || cars[r.carFile]) continue;
  if (old.cars?.[r.carFile]) { cars[r.carFile] = old.cars[r.carFile]; continue; }
  try {
    const rr = await fetch(r.carImage, { headers: { "User-Agent": H["User-Agent"] } });
    if (!rr.ok) throw new Error("HTTP " + rr.status);
    const type = rr.headers.get("content-type") || "image/png";
    cars[r.carFile] = `data:${type};base64,` + Buffer.from(await rr.arrayBuffer()).toString("base64");
  } catch (e) { carDebug.push("car download failed " + r.carFile + ": " + e.message); }
}

// remember team race totals per day so the site can show gains
const history = old.history || {};
for (const r of racers) {
  history[r.username] = { ...(history[r.username] || {}), [today]: r.teamRaces };
  const days = Object.keys(history[r.username]).sort();
  for (const d of days.slice(0, -60)) delete history[r.username][d];
}

// save a snapshot of every racer's totals so giveaways can count races between two moments
// each racer = [team races, lifetime races, letters typed, seconds typing]
const nowS = Math.floor(Date.now() / 1000);
let snaps = [];
try { snaps = JSON.parse(await readFile("snapshots.json", "utf8")).snaps || []; } catch {}
const snapRacers = {};
for (const m of members) snapRacers[m.username] = [m.played ?? 0, m.racesPlayed ?? 0, m.typed ?? 0, m.secs ?? 0];
snaps.push({ t: nowS, r: snapRacers });
// keep every run for 3 days, then one per hour for a month, then one per 6 hours (up to 120 days)
const kept = [], seenBuckets = new Set();
for (const sn of snaps.sort((a, b) => b.t - a.t)) {
  const age = nowS - sn.t;
  if (age > 120 * 86400) continue;
  const bucket = age <= 3 * 86400 ? "r" + sn.t : age <= 30 * 86400 ? "h" + Math.floor(sn.t / 3600) : "q" + Math.floor(sn.t / 21600);
  if (seenBuckets.has(bucket)) continue;
  seenBuckets.add(bucket); kept.push(sn);
}
kept.sort((a, b) => a.t - b.t);
await writeFile("snapshots.json", JSON.stringify({ snaps: kept }));

await writeFile("data.json", JSON.stringify({ team: TEAM, updated: Math.floor(Date.now() / 1000), teamMeta, racers, extras, cars, history }, null, 1));
await writeFile("debug.json", JSON.stringify({ carLookup: carDebug, extras: extrasDebug, carsFound: Object.keys(carFiles).length, roles: members.map(m => `${m.displayName}: ${m.role}`), memberships: members.map(m => `${m.displayName}: ${m.membership}`), teamInfo: info, firstMember: members[0] }, null, 1));
console.log(`Saved ${racers.length} racers`);
