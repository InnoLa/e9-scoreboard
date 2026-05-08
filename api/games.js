// Vercel serverless function: proxies the vahockey schedules API.
// - Caches upstream response for 10 minutes (in-memory + edge cache).
// - Only fetches upstream on demand (no background polling).
// - All users of the deployed site share the same cached payload.

const TTL_MS = 10 * 60 * 1000;
const PAYLOAD = {
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
  FutureGames: "",
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

async function fetchUpstream() {
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
    body: JSON.stringify(PAYLOAD),
  });
  if (!r.ok) throw new Error("upstream HTTP " + r.status);
  const data = await r.json();
  if (data.result !== "success") throw new Error("upstream returned: " + data.result);
  return data;
}

export default async function handler(req, res) {
  const now = Date.now();
  const fresh = cache && (now - cachedAt) < TTL_MS;

  if (!fresh) {
    try {
      // Coalesce concurrent refreshes into a single upstream call.
      if (!inflight) inflight = fetchUpstream().finally(() => { inflight = null; });
      const data = await inflight;
      cache = data;
      cachedAt = Date.now();
    } catch (e) {
      if (!cache) {
        res.status(502).json({ error: e.message });
        return;
      }
      // Serve stale cache on upstream failure.
    }
  }

  // Edge cache: 10 min fresh, then serve stale up to 1 min while revalidating.
  res.setHeader("cache-control", "public, s-maxage=600, stale-while-revalidate=60");
  res.status(200).json({ ...cache, lastUpdated: cachedAt });
}
