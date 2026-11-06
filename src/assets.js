const { getJson } = require('./api');
const log = require('./log');

const emojis = new Map();
let heroes;
let champions;
let ddragonVersion;

async function deadlockHeroes() {
  if (!heroes) heroes = new Map((await getJson('https://api.deadlock-api.com/v1/assets/heroes')).map(h => [h.id, h]));
  return heroes;
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

  for (const item of await wantedEmojis()) {
    if (emojis.has(item.name)) continue;
    for (const url of item.urls) {
      const image = await fetchImage(url).catch(() => null);
      if (!image) continue;
      const created = await client.application.emojis.create({ attachment: image, name: item.name }).catch(err => log.warn(`Emoji ${item.name}: ${err.message}`));
      if (created) emojis.set(created.name, created.toString());
      break;
    }
  }
  log.info(`Icons ready: ${emojis.size}`);
}

module.exports = { syncEmojis, heroLabel, championLabel, profileIconUrl };
