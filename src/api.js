const STEAM_OFFSET = 76561197960265728n;

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const err = new Error(`${res.status} ${url}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function resolveVanity(name) {
  const data = await getJson(`https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${process.env.STEAM_KEY}&vanityurl=${encodeURIComponent(name)}`);
  return data.response.success === 1 ? data.response.steamid : null;
}

async function resolveSteamId(input) {
  const text = input.trim();
  let m = text.match(/steamcommunity\.com\/profiles\/(\d{17})/);
  if (m) return m[1];
  m = text.match(/steamcommunity\.com\/id\/([^\/?#]+)/);
  if (m) return resolveVanity(m[1]);
  if (/^\d{17}$/.test(text)) return text;
  if (/^\d{1,10}$/.test(text)) return (BigInt(text) + STEAM_OFFSET).toString();
  if (/^[\w-]{2,32}$/.test(text)) return resolveVanity(text);
  return null;
}

function steamToAccountId(steamId) {
  return (BigInt(steamId) - STEAM_OFFSET).toString();
}

async function steamProfile(steamId) {
  const data = await getJson(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${process.env.STEAM_KEY}&steamids=${steamId}`);
  const player = data.response.players[0];
  if (!player) {
    const err = new Error('Steam profile not found');
    err.status = 404;
    throw err;
  }
  return player;
}

const RIOT_LIMITS = [[20, 1000], [100, 120000]];
const riotSent = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function riotSlot() {
  for (;;) {
    const now = Date.now();
    while (riotSent.length && now - riotSent[0] > 120000) riotSent.shift();
    const wait = Math.max(0, ...RIOT_LIMITS.map(([limit, ms]) => {
      const recent = riotSent.filter(t => now - t < ms);
      return recent.length >= limit ? recent[recent.length - limit] + ms - now : 0;
    }));
    if (!wait) return riotSent.push(now);
    await sleep(wait + 50);
  }
}

async function riot(url) {
  await riotSlot();
  try {
    return await getJson(url, { 'X-Riot-Token': process.env.RIOT_KEY });
  } catch (err) {
    if (err.status !== 429) throw err;
    await sleep(10000);
    return riot(url);
  }
}

function splitRiotId(riotId) {
  const i = riotId.lastIndexOf('#');
  if (i < 1 || i === riotId.length - 1) return null;
  return [riotId.slice(0, i).trim(), riotId.slice(i + 1).trim()];
}

async function riotAccount(riotId) {
  const parts = splitRiotId(riotId);
  if (!parts) return null;
  return riot(`https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}`);
}

module.exports = { getJson, resolveSteamId, steamToAccountId, steamProfile, riot, riotAccount };
