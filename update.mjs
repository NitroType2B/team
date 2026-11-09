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

let old = {};
try { old = JSON.parse(await readFile("data.json", "utf8")); } catch {}
const today = new Date().toISOString().slice(0, 10);

const racers = members.map(m => ({
  username: m.username,
  displayName: m.displayName || m.username,
  role: m.role || "member",
  title: m.title || "",
  carId: m.carID ?? null,
  carImage: m.carID != null ? `https://www.nitrotype.com/cars/${m.carID}_small_1.png` : null,
  avgSpeed: m.avgSpeed ?? null,
  highSpeed: m.highestSpeed ?? null,
  lifetimeRaces: m.racesPlayed ?? null,
  teamRaces: m.played ?? 0,
  memberSince: m.joinStamp ?? null,
  lastRace: m.lastActivity ?? null
}));

// remember team race totals per day so the site can show gains
const history = old.history || {};
for (const r of racers) {
  history[r.username] = { ...(history[r.username] || {}), [today]: r.teamRaces };
  const days = Object.keys(history[r.username]).sort();
  for (const d of days.slice(0, -60)) delete history[r.username][d];
}

await writeFile("data.json", JSON.stringify({ team: TEAM, updated: Math.floor(Date.now() / 1000), racers, history }, null, 1));
await writeFile("debug.json", JSON.stringify({ firstMember: members[0] }, null, 1));
console.log(`Saved ${racers.length} racers`);
