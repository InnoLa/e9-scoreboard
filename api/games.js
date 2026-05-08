// Vercel serverless function: proxies the vahockey schedules API.
// - Caches upstream response for 10 minutes (in-memory + edge cache).
// - Only fetches upstream on demand (no background polling).
// - Makes two parallel calls (FutureGames=n past+today, FutureGames=y future+today)
//   and merges, because the upstream's empty-string handling is environment-dependent.

const TTL_MS = 10 * 60 * 1000;

const BASE_PAYLOAD = {
  CustomerID: "1",
  Season: "2027",
  League: "bhlparity",
  Program: "",
  TeamID: "",
  Team: "",
  Location: "",
  Schedules: "",
  Columns: ["GameDateF","StartTime","LocationName","LiveBarn","OpponentName3","WinLoss","GameScore"],
  GroupBy: ["ProgramName","CurrTeamName"],
  ShowDropDowns: "y",
  NumOfDays: "",
  IncludeOtherLeagues: "y",
  LiveBarnURL: "http://www.elite9hockey.com/livebarn/",
  BoxScoreURL: "",
  LinkBehaviour: "",
  GamesEvents: "g",
  NumOfRecords: "",
  DateFormat: "%a %c/%d",
  GameStatus: "",
  StartDate: "",
  EndDate: "",
  TagIDS: "",
  LiveUnpublished: "l",
  OrderBy: "",
  OrderByAscDesc: "",
  Iframe: "y",
  token: "be7f2c2620b5c1af9fa6618733c7d78c",
  displayDivision: "n",
  Division: "",
  DivisionGroupNameSelector: "",
  DivisionDisplay: "",
  parent: "https://www.elite9hockey.com/",
};

let cache = null;
let cachedAt = 0;
let inflight = null;

async function fetchOne(futureFlag) {
  const r = await fetch("https://widgets.vahockey.com/schedules/get", {
    method: "POST",
    headers: {
      "accept": "application/json, text/plain, */*",
      "content-type": "application/json",
      "origin": "https://widgets.vahockey.com",
      "referer": "https://widgets.vahockey.com/schedules",
      "x-requested-with": "XMLHttpRequest",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({ ...BASE_PAYLOAD, FutureGames: futureFlag }),
  });
  if (!r.ok) throw new Error("upstream HTTP " + r.status);
  const data = await r.json();
  if (data.result !== "success") throw new Error("upstream returned: " + data.result);
  return data;
}

// Build a stable key per game record so we can dedupe across the two calls
// (a game played today shows up in both past and future responses).
function gameKey(g) {
  return [g.GameDate, g.StartTime, g.CurrTeamID, g.OpponentTeamID].join("|");
}

function mergeGames(past, future) {
  // Both responses have the same shape: Games[Program][Team] = [game,...]
  // Merge into a single tree, deduping by gameKey.
  const merged = {};
  const seen = new Set();
  for (const src of [past, future]) {
    const programs = (src && src.Games) || {};
    for (const [progName, teams] of Object.entries(programs)) {
      for (const [teamName, list] of Object.entries(teams)) {
        for (const game of list) {
          const k = gameKey(game) + "|" + progName + "|" + teamName;
          if (seen.has(k)) continue;
          seen.add(k);
          if (!merged[progName]) merged[progName] = {};
          if (!merged[progName][teamName]) merged[progName][teamName] = [];
          merged[progName][teamName].push(game);
        }
      }
    }
  }
  return merged;
}

async function fetchUpstream() {
  const [past, future] = await Promise.all([
    fetchOne("n").catch(() => null),
    fetchOne("y").catch(() => null),
  ]);
  if (!past && !future) throw new Error("both upstream calls failed");
  const Games = mergeGames(past, future);
  // Use whichever response has the most fields as the base for top-level keys.
  const base = future || past;
  return { ...base, Games, result: "success" };
}

export default async function handler(req, res) {
  const now = Date.now();
  const fresh = cache && (now - cachedAt) < TTL_MS;

  if (!fresh) {
    try {
      if (!inflight) inflight = fetchUpstream().finally(() => { inflight = null; });
      const data = await inflight;
      cache = data;
      cachedAt = Date.now();
    } catch (e) {
      if (!cache) {
        res.status(502).json({ error: e.message });
        return;
      }
    }
  }

  res.setHeader("cache-control", "public, s-maxage=600, stale-while-revalidate=60");
  res.status(200).json({ ...cache, lastUpdated: cachedAt });
}
