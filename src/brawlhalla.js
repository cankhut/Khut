const { getJson } = require('./api');
const log = require('./log');

const API_ROOT = 'https://api.brawlhalla.com/v1';
const LEGEND_CACHE_MS = 6 * 60 * 60 * 1000;

let legendCache;
let legendCacheExpires = 0;
let legendCachePromise;

function parsePlayerId(value) {
  const id = String(value ?? '').trim();
  if (!/^\d{1,15}$/.test(id)) return null;

  const numeric = Number(id);
  return Number.isSafeInteger(numeric) && numeric > 0 ? String(numeric) : null;
}

async function playerStats(brawlhallaId, mode) {
  const query = new URLSearchParams({
    brawlhalla_id: brawlhallaId,
    mode
  });
  return getJson(`${API_ROOT}/player/stats?${query}`);
}

async function loadLegendCatalog() {
  if (legendCache && Date.now() < legendCacheExpires) return legendCache;
  if (legendCachePromise) return legendCachePromise;

  legendCachePromise = (async () => {
    const first = await getJson(`${API_ROOT}/static/legends?page=1&max_results=100`);
    const rows = [...(first.legends ?? [])];
    const totalPages = Math.max(1, Number(first.total_pages) || 1);

    for (let page = 2; page <= totalPages; page++) {
      const next = await getJson(`${API_ROOT}/static/legends?page=${page}&max_results=100`);
      rows.push(...(next.legends ?? []));
    }

    if (!rows.length) throw new Error('Brawlhalla legend catalogue was empty');

    legendCache = new Map(rows.map(legend => [Number(legend.legend_id), legend]));
    legendCacheExpires = Date.now() + LEGEND_CACHE_MS;
    return legendCache;
  })();

  try {
    return await legendCachePromise;
  } catch (err) {
    legendCachePromise = null;
    legendCache = null;
    legendCacheExpires = 0;
    throw err;
  } finally {
    if (legendCache) legendCachePromise = null;
  }
}

async function optionalRankedStats(brawlhallaId, mode) {
  try {
    return await playerStats(brawlhallaId, mode);
  } catch (err) {
    if (err.status === 429) throw err;
    log.warn(`Brawlhalla ${mode} stats unavailable for ${brawlhallaId}: ${err.status ?? err.message}`);
    return err.status === 404 ? null : { unavailable: true };
  }
}

async function optionalPlayerTeams(brawlhallaId) {
  const query = new URLSearchParams({ brawlhalla_id: brawlhallaId });
  try {
    return await getJson(`${API_ROOT}/player/teams?${query}`);
  } catch (err) {
    if (err.status === 429) throw err;
    log.warn(`Brawlhalla 2v2 teams unavailable for ${brawlhallaId}: ${err.status ?? err.message}`);
    return err.status === 404 ? null : { unavailable: true };
  }
}

async function getPlayer(brawlhallaId) {
  const [all, ranked1v1, ranked3v3, teams, legends] = await Promise.all([
    playerStats(brawlhallaId, 'all'),
    optionalRankedStats(brawlhallaId, 'ranked_1v1'),
    optionalRankedStats(brawlhallaId, 'ranked_3v3'),
    optionalPlayerTeams(brawlhallaId),
    loadLegendCatalog().catch(err => {
      log.warn(`Brawlhalla legend catalogue unavailable: ${err.message}`);
      return new Map();
    })
  ]);

  if (!all?.brawlhalla_id) {
    const err = new Error('Brawlhalla player not found');
    err.status = 404;
    throw err;
  }

  return { all, ranked1v1, ranked3v3, teams, legends };
}

function legendIconUrl(name) {
  const file = `Portrait_${name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9&]/g, '')}.png`;
  return `https://brawlhalla.wiki.gg/images/${encodeURIComponent(file)}`;
}

module.exports = { parsePlayerId, getPlayer, loadLegendCatalog, legendIconUrl };
