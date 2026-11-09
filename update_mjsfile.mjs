// Fetches team 2B stats from Nitro Type and saves them to data.json
import { readFile, writeFile } from "node:fs/promises";

const TEAM = "2B";
const H = { "User-Agent": "Mozilla/5.0 (compatible; TeamSiteBot/1.0)", "Accept": "application/json" };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(url) {
  const res = await fetch(url, { headers: H });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { throw new Error(`${url} -> HTTP ${res.status}, not JSON: ${text.slice(0, 120)}`); }
}

// look through an object (shallowest first) for the first matching key holding a simple value
function find(obj, keys) {
  const queue = [obj], seen = new Set();
  while (queue.length) {
    const o = queue.shift();
    if (!o || typeof o !== "object" || seen.has(o)) continue;
    seen.add(o);
    for (const k of keys) if (k in o && o[k] !== null && typeof o[k] !== "object") return o[k];
    queue.push(...Object.values(o));
  }
  return null;
}
const toSec = v => (v == null ? null : Number(v) > 1e12 ? Math.round(Number(v) / 1000) : Number(v));

const team = await getJson(`https://www.nitrotype.com/api/v2/teams/${TEAM}`);
const members = team?.results?.members;
if (!Array.isArray(members) || !members.length) throw new Error("No members found in team data");

let old = {};
try { old = JSON.parse(await readFile("data.json", "utf8")); } catch {}
const today = new Date().toISOString().slice(0, 10);

const racers = [];
let racerSample = null;
for (const m of members) {
  const username = m.username || find(m, ["username"]);
  const r = { username, displayName: m.displayName || username, role: m.status || m.role || "member" };
  r.teamRaces = Number(find(m, ["played"]) ?? 0);
  r.memberSince = toSec(find(m, ["joinStamp", "joined", "joinedStamp", "joinDate"]));
  r.lastRace = toSec(find(m, ["lastActivity", "lastRace", "lastRaceStamp", "lastPlayed", "lastActive"]));
  const typed = Number(find(m, ["typed"]) ?? 0), secs = Number(find(m, ["secs"]) ?? 0);
  r.avgSpeed = secs > 0 ? Math.round(typed / 5 / (secs / 60)) : null;
  r.carId = find(m, ["carID"]);

  // personal stats (lifetime races, highest speed, car picture)
  try {
    const p = await getJson(`https://www.nitrotype.com/api/v2/racers/${encodeURIComponent(username)}`);
    if (!racerSample) racerSample = p;
    r.lifetimeRaces = Number(find(p, ["racesPlayed", "races"]) ?? 0) || null;
    r.highSpeed = Number(find(p, ["highestSpeed", "bestSpeed", "wpm_high", "highSpeed"]) ?? 0) || null;
    const avg = Number(find(p, ["avgSpeed", "wpm_average", "averageSpeed"]) ?? 0);
    if (avg) r.avgSpeed = avg;
    r.car = find(p, ["carName", "current_car"]);
    r.carId = find(p, ["carID"]) ?? r.carId;
  } catch (e) { console.log("racer lookup failed for", username, e.message); }
  if (r.carId != null) r.carImage = `https://www.nitrotype.com/cars/${r.carId}_small_1.png`;
  racers.push(r);
  await sleep(400);
}

// remember team race totals per day so the site can show gains
const history = old.history || {};
for (const r of racers) {
  history[r.username] = { ...(history[r.username] || {}), [today]: r.teamRaces };
  const days = Object.keys(history[r.username]).sort();
  for (const d of days.slice(0, -60)) delete history[r.username][d];
}

await writeFile("data.json", JSON.stringify({ team: TEAM, updated: Math.floor(Date.now() / 1000), racers, history }, null, 1));
await writeFile("debug.json", JSON.stringify({ firstMember: members[0], racerSample }, null, 1).slice(0, 20000));
console.log(`Saved ${racers.length} racers`);
