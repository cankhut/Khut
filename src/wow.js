const { getJson } = require('./api');
const log = require('./log');

const REGIONS = ['eu', 'us', 'kr', 'tw'];
const RULESETS = { 1: 'PvP', 2: 'Normal', 3: 'Roleplay', 15: 'Roleplay PvP' };
const HOUSES = { 1: [110, 113, 116], 2: [111, 114, 117], 3: [119, 120, 121], 15: [123, 124, 125] };
const FACTIONS = ['alliance', 'horde', 'blackwater'];
const HIDDEN_ITEMS = /^(monster - |test |unused |deprecated )|\btest\b|\[dnt\]/i;

let token = { value: null, expires: 0 };
const searches = new Map();
const items = new Map();
const prices = new Map();

function hasKeys() {
  return !!(process.env.BLIZZARD_ID && process.env.BLIZZARD_SECRET);
}

async function accessToken() {
  if (Date.now() < token.expires) return token.value;
  const res = await fetch('https://oauth.battle.net/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.BLIZZARD_ID}:${process.env.BLIZZARD_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error(`Blizzard login failed (${res.status})`);
  const data = await res.json();
  token = { value: data.access_token, expires: Date.now() + (data.expires_in - 300) * 1000 };
  return token.value;
}

async function blizzard(region, namespace, path) {
  const separator = path.includes('?') ? '&' : '?';
  return getJson(`https://${region}.api.blizzard.com${path}${separator}namespace=${namespace}-forever-${region}&locale=en_US`, { Authorization: `Bearer ${await accessToken()}` });
}

function slug(text) {
  return text.trim().toLowerCase().replace(/\s+/g, '-');
}

function profile(region, name) {
  return blizzard(region, 'profile', `/profile/wow/character/${encodeURIComponent(slug(name))}`);
}

async function character(region, name) {
  const base = `/profile/wow/character/${encodeURIComponent(slug(name))}`;
  const profile = await blizzard(region, 'profile', base);
  const part = path => blizzard(region, 'profile', `${base}/${path}`).catch(() => null);
  const [equipment, media, professions, pvp, specializations, reputations, statistics] = await Promise.all(
    ['equipment', 'character-media', 'professions', 'pvp-summary', 'specializations', 'reputations', 'statistics'].map(part)
  );
  return { profile, equipment, media, professions, pvp, specializations, reputations, statistics };
}

async function guild(region, name) {
  const base = `/data/wow/guild/${encodeURIComponent(slug(name))}`;
  const [info, roster] = await Promise.all([blizzard(region, 'profile', base), blizzard(region, 'profile', `${base}/roster`).catch(() => null)]);
  return { info, members: roster?.members ?? [] };
}

async function searchItems(region, text) {
  const key = `${region}:${text.toLowerCase()}`;
  if (!searches.has(key)) {
    if (searches.size > 500) searches.clear();
    const data = await blizzard(region, 'static', `/data/wow/search/item?name.en_US=${encodeURIComponent(text)}&_pageSize=50`);
    searches.set(key, data.results.map(r => ({ id: r.data.id, name: r.data.name.en_US, quality: r.data.quality?.type })).filter(i => i.name && !HIDDEN_ITEMS.test(i.name)));
  }
  return searches.get(key);
}

async function item(region, id) {
  if (!items.has(id)) {
    const [info, media] = await Promise.all([blizzard(region, 'static', `/data/wow/item/${id}`), blizzard(region, 'static', `/data/wow/media/item/${id}`).catch(() => null)]);
    items.set(id, { id, name: info.name, quality: info.quality?.type, icon: media?.assets?.find(a => a.key === 'icon')?.value ?? null });
  }
  return items.get(id);
}

function addPrice(map, id, unit, quantity) {
  const entry = map.get(id) ?? { min: Infinity, quantity: 0 };
  entry.min = Math.min(entry.min, unit);
  entry.quantity += quantity;
  map.set(id, entry);
}

async function house(region, ruleset, id) {
  const path = `/data/wow/ruleset/${ruleset}/auctions/${id}`;
  const [auctions, commodities] = await Promise.all([blizzard(region, 'dynamic', path), blizzard(region, 'dynamic', `${path}/commodities`)]);
  const map = new Map();
  for (const a of auctions.auctions ?? []) if (a.buyout) addPrice(map, a.item.id, Math.round(a.buyout / a.quantity), a.quantity);
  for (const a of commodities.auctions ?? []) addPrice(map, a.item.id, a.unit_price, a.quantity);
  return map;
}

async function auctionHouses(region, ruleset) {
  const key = `${region}:${ruleset}`;
  const cached = prices.get(key);
  if (cached && Date.now() - cached.at < 30 * 60000) return cached.data;
  const data = (async () => {
    const result = {};
    for (const [i, id] of HOUSES[ruleset].entries()) result[FACTIONS[i]] = await house(region, ruleset, id);
    log.info(`WoW auction data loaded for ${region.toUpperCase()} ${RULESETS[ruleset]}`);
    return { houses: result, at: Date.now() };
  })();
  prices.set(key, { at: Date.now(), data });
  data.catch(() => prices.delete(key));
  return data;
}

module.exports = { REGIONS, RULESETS, FACTIONS, hasKeys, slug, profile, character, guild, searchItems, item, auctionHouses };
