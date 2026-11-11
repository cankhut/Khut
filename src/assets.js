const { getJson } = require('./api');
const log = require('./log');
const { db } = require('./db');
const { settings } = require('./settings');
const { loadLegendCatalog, legendIconUrl } = require('./brawlhalla');

const emojis = new Map();
let heroes;
let items;
let champions;
let ddragonVersion;
const championDetails = new Map();
let brawlhallaCatalogueAvailable = false;

async function deadlockHeroes() {
  if (!heroes) heroes = new Map((await getJson('https://api.deadlock-api.com/v1/assets/heroes')).map(h => [h.id, h]));
  return heroes;
}

async function deadlockItems() {
  if (!items) items = new Map((await getJson('https://api.deadlock-api.com/v1/assets/items')).filter(i => i.type === 'upgrade').map(i => [i.id, i]));
  return items;
}

async function playableHeroes() {
  return [...(await deadlockHeroes()).values()].filter(h => h.player_selectable && !h.disabled).sort((a, b) => a.name.localeCompare(b.name));
}

async function lolChampionDetail(id) {
  await lolChampions();
  if (!championDetails.has(id)) {
    const { data } = await getJson(`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/data/en_US/champion/${id}.json`);
    championDetails.set(id, data[id]);
  }
  return championDetails.get(id);
}

function ddragon(path) {
  return `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/${path}`;
}

async function lolChampions() {
  if (!champions) {
    [ddragonVersion] = await getJson('https://ddragon.leagueoflegends.com/api/versions.json');
    const { data } = await getJson(`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/data/en_US/champion.json`);
    champions = new Map(Object.values(data).map(c => [Number(c.key), c]));
  }
  return champions;
}

async function profileIconUrl(id) {
  await lolChampions();
  return `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/profileicon/${id}.png`;
}

function emoji(name) {
  return emojis.get(name) ?? '';
}

function gameEmojiName(game) {
  return `game_${game.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`.slice(0, 32);
}

function gameEmoji(game) {
  return emoji(gameEmojiName(game));
}

async function heroLabel(id) {
  const hero = (await deadlockHeroes()).get(id);
  return `${emoji(`dl_${id}`)} ${hero?.name ?? `Hero ${id}`}`.trim();
}

async function championLabel(key) {
  const champion = (await lolChampions()).get(key);
  return `${emoji(`lol_${key}`)} ${champion?.name ?? `Champion ${key}`}`.trim();
}

async function fetchImage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Khut Discord bot (https://github.com/cankhut/khut)' } });
  if (!res.ok || !res.headers.get('content-type')?.startsWith('image/')) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  return buffer.length <= 256000 ? buffer : null;
}

function slug(name) {
  return name.normalize('NFD').toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function wantedEmojis() {
  const list = [];
  const taken = new Set();
  const add = (key, base, tag, urls, extra = {}) => {
    let name = slug(base).padEnd(2, '0').slice(0, 26);
    if (taken.has(name)) name = `${name}_${tag}`;
    for (let n = 2; taken.has(name); n++) name = `${name.replace(/\d+$/, '')}${n}`;
    taken.add(name);
    list.push({ key, name, urls, ...extra });
  };
  for (const hero of (await deadlockHeroes()).values()) {
    if (!hero.player_selectable || hero.disabled) continue;
    const image = hero.images?.minimap_image ?? hero.images?.icon_image_small;
    if (image) add(`dl_${hero.id}`, hero.name, 'dl', [image]);
  }
  for (const rank of await getJson('https://api.deadlock-api.com/v1/assets/ranks')) {
    for (let sub = 1; sub <= 6; sub++) {
      const url = rank.images?.[`small_subrank${sub}`];
      if (url) add(`rank_${rank.tier}_${sub}`, `${rank.name}${sub}`, 'rank', [url]);
    }
  }
  for (const item of [...(await deadlockItems()).values()].sort((a, b) => Number(!!b.shopable) - Number(!!a.shopable))) {
    if (item.shop_image) add(`di_${item.id}`, item.name, 'item', [item.shop_image], { fresh: true });
  }
  for (const champion of (await lolChampions()).values()) {
    const file = encodeURIComponent(`${champion.name.replace(/ /g, '_')}_OriginalCircle.png`);
    add(`lol_${champion.key}`, champion.name, 'lol', [
      `https://wiki.leagueoflegends.com/en-us/images/thumb/${file}/96px-${file}`,
      `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/champion/${champion.image.full}`
    ]);
  }
  for (const game of settings.icons.games) {
    if (game.name && game.url && !game.big) list.push({ key: gameEmojiName(game.name), name: gameEmojiName(game.name), urls: [game.url], stamp: game.url, game: game.name });
  }
  let legends;
  try {
    legends = await loadLegendCatalog();
    brawlhallaCatalogueAvailable = true;
  } catch (err) {
    brawlhallaCatalogueAvailable = false;
    log.warn(`Brawlhalla legend icons unavailable: ${err.message}`);
    legends = new Map();
  }
  for (const legend of legends.values()) {
    if (legend.bio_name) add(`bh_${legend.legend_id}`, legend.bio_name, 'bh', [legendIconUrl(legend.bio_name)]);
  }
  return list;
}

const OLD_NAME = /^(dl|rank|di|lol|game|bh)_/;

async function syncEmojis(client) {
  const existing = await client.application.emojis.fetch();
  const byName = new Map([...existing.values()].map(e => [e.name, e]));
  const owner = new Map(db.prepare('SELECT name, key FROM emoji_names').all().map(r => [r.name, r.key]));
  for (const e of existing.values()) {
    const key = owner.get(e.name) ?? (OLD_NAME.test(e.name) ? e.name : null);
    if (key) emojis.set(key, e.toString());
  }

  const wanted = await wantedEmojis();
  for (const item of wanted) {
    let found = byName.get(item.name);
    if (found && owner.get(item.name) !== item.key && item.name !== item.key) {
      await found.delete().catch(err => log.warn(`Emoji ${item.name}: ${err.message}`));
      byName.delete(item.name);
      found = null;
    }
    let stamp = item.stamp;
    if (item.fresh) {
      const res = await fetch(item.urls[0], { method: 'HEAD' }).catch(() => null);
      stamp = res?.ok ? res.headers.get('etag') ?? res.headers.get('last-modified') : null;
    }
    if (stamp && found && stamp !== db.prepare('SELECT stamp FROM emoji_sources WHERE name = ?').get(item.name)?.stamp) {
      await found.delete().catch(err => log.warn(`Emoji ${item.name}: ${err.message}`));
      byName.delete(item.name);
      found = null;
    }
    if (found) {
      emojis.set(item.key, found.toString());
      continue;
    }
    for (const url of item.urls) {
      const image = await fetchImage(url).catch(() => null);
      if (!image) continue;
      const created = await client.application.emojis.create({ attachment: image, name: item.name }).catch(err => log.warn(`Emoji ${item.name}: ${err.message}`));
      if (created) {
        emojis.set(item.key, created.toString());
        byName.set(created.name, created);
        db.prepare('INSERT OR REPLACE INTO emoji_names (name, key) VALUES (?, ?)').run(created.name, item.key);
        if (stamp) db.prepare('INSERT OR REPLACE INTO emoji_sources (name, stamp) VALUES (?, ?)').run(created.name, stamp);
      }
      break;
    }
    if (item.game && !byName.has(item.name)) log.warn(`Couldn't load the icon for ${item.game}. Check the link in the panel.`);
  }

  const names = new Set(wanted.map(w => w.name));
  for (const e of byName.values()) {
    const keepUnverifiedBrawlhallaIcon = (owner.get(e.name) ?? e.name).startsWith('bh_') && !brawlhallaCatalogueAvailable;
    if (!keepUnverifiedBrawlhallaIcon && (owner.has(e.name) || OLD_NAME.test(e.name)) && !names.has(e.name)) {
      await e.delete().catch(err => log.warn(`Emoji ${e.name}: ${err.message}`));
      if (emojis.get(owner.get(e.name) ?? e.name) === e.toString()) emojis.delete(owner.get(e.name) ?? e.name);
    }
  }
  log.info(`Icons ready: ${emojis.size}`);
}

module.exports = { syncEmojis, emoji, gameEmoji, heroLabel, championLabel, profileIconUrl, deadlockHeroes, deadlockItems, playableHeroes, lolChampions, lolChampionDetail, ddragon, fetchImage };
