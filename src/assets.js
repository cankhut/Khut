const { getJson } = require('./api');
const log = require('./log');
const { db } = require('./db');
const { settings } = require('./settings');

const emojis = new Map();
let heroes;
let items;
let champions;
let ddragonVersion;
const championDetails = new Map();

async function deadlockHeroes() {
  if (!heroes) heroes = new Map((await getJson('https://api.deadlock-api.com/v1/assets/heroes')).map(h => [h.id, h]));
  return heroes;
}

async function deadlockItems() {
  if (!items) items = new Map((await getJson('https://api.deadlock-api.com/v1/assets/items')).filter(i => i.type === 'upgrade').map(i => [i.id, i]));
  return items;
}

async function playableHeroes() {
  return [...(await deadlockHeroes()).values()].filter(h => h.player_selectable && !h.disabled && !h.in_development).sort((a, b) => a.name.localeCompare(b.name));
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

async function wantedEmojis() {
  const list = [];
  for (const hero of (await deadlockHeroes()).values()) {
    const image = hero.images?.minimap_image ?? hero.images?.icon_image_small;
    if (image) list.push({ name: `dl_${hero.id}`, urls: [image] });
  }
  for (const rank of await getJson('https://api.deadlock-api.com/v1/assets/ranks')) {
    for (let sub = 1; sub <= 6; sub++) {
      const url = rank.images?.[`small_subrank${sub}`];
      if (url) list.push({ name: `rank_${rank.tier}_${sub}`, urls: [url] });
    }
  }
  for (const item of (await deadlockItems()).values()) {
    if (item.shop_image) list.push({ name: `di_${item.id}`, urls: [item.shop_image], fresh: true });
  }
  for (const game of settings.icons.games) {
    if (game.name && game.url && !game.big) list.push({ name: gameEmojiName(game.name), urls: [game.url], stamp: game.url, game: game.name });
  }
  for (const champion of (await lolChampions()).values()) {
    const file = encodeURIComponent(`${champion.name.replace(/ /g, '_')}_OriginalCircle.png`);
    list.push({
      name: `lol_${champion.key}`,
      urls: [
        `https://wiki.leagueoflegends.com/en-us/images/thumb/${file}/96px-${file}`,
        `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/champion/${champion.image.full}`
      ]
    });
  }
  return list;
}

async function syncEmojis(client) {
  const existing = await client.application.emojis.fetch();
  for (const e of existing.values()) emojis.set(e.name, e.toString());

  const wanted = await wantedEmojis();
  for (const e of existing.values()) {
    if (e.name.startsWith('game_') && !wanted.some(w => w.name === e.name)) {
      await e.delete().catch(err => log.warn(`Emoji ${e.name}: ${err.message}`));
      emojis.delete(e.name);
    }
  }

  for (const item of wanted) {
    let stamp = item.stamp;
    if (item.fresh) {
      const res = await fetch(item.urls[0], { method: 'HEAD' }).catch(() => null);
      stamp = res?.ok ? res.headers.get('etag') ?? res.headers.get('last-modified') : null;
    }
    if (stamp) {
      const saved = db.prepare('SELECT stamp FROM emoji_sources WHERE name = ?').get(item.name)?.stamp;
      if (stamp !== saved && emojis.has(item.name)) {
        const old = existing.find(e => e.name === item.name);
        if (old) await old.delete().catch(err => log.warn(`Emoji ${item.name}: ${err.message}`));
        emojis.delete(item.name);
      }
    }
    if (emojis.has(item.name)) continue;
    for (const url of item.urls) {
      const image = await fetchImage(url).catch(() => null);
      if (!image) continue;
      const created = await client.application.emojis.create({ attachment: image, name: item.name }).catch(err => log.warn(`Emoji ${item.name}: ${err.message}`));
      if (created) emojis.set(created.name, created.toString());
      if (created && stamp) db.prepare('INSERT OR REPLACE INTO emoji_sources (name, stamp) VALUES (?, ?)').run(item.name, stamp);
      break;
    }
    if (item.game && !emojis.has(item.name)) log.warn(`Couldn't load the icon for ${item.game}. Check the link in the panel.`);
  }
  log.info(`Icons ready: ${emojis.size}`);
}

module.exports = { syncEmojis, emoji, gameEmoji, heroLabel, championLabel, profileIconUrl, deadlockHeroes, deadlockItems, playableHeroes, lolChampions, lolChampionDetail, ddragon, fetchImage };
