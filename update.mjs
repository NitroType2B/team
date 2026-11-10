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

// download each car picture once so the site can recolor it exactly
const cars = {};
for (const r of racers) {
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

await writeFile("data.json", JSON.stringify({ team: TEAM, updated: Math.floor(Date.now() / 1000), teamMeta, racers, cars, history }, null, 1));
await writeFile("debug.json", JSON.stringify({ carLookup: carDebug, carsFound: Object.keys(carFiles).length, roles: members.map(m => `${m.displayName}: ${m.role}`), memberships: members.map(m => `${m.displayName}: ${m.membership}`), teamInfo: info, firstMember: members[0] }, null, 1));
console.log(`Saved ${racers.length} racers`);
