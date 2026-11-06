const { EmbedBuilder } = require('discord.js');
const { db } = require('./db');
const { riot, riotAccount } = require('./api');
const { championLabel, profileIconUrl } = require('./assets');
const colors = require('./colors');
const icons = require('./icons');

const PLATFORMS = {
  br1: ['americas', 'br'],
  eun1: ['europe', 'eune'],
  euw1: ['europe', 'euw'],
  jp1: ['asia', 'jp'],
  kr: ['asia', 'kr'],
  la1: ['americas', 'lan'],
  la2: ['americas', 'las'],
  me1: ['europe', 'me'],
  na1: ['americas', 'na'],
  oc1: ['sea', 'oce'],
  ru: ['europe', 'ru'],
  sg2: ['sea', 'sg'],
  tr1: ['europe', 'tr'],
  tw2: ['sea', 'tw'],
  vn2: ['sea', 'vn']
};

const SOLO = 420;
const FLEX = 440;
const NORMALS = [400, 430, 480, 490];
const SEASON_CAP = 300;
const NOTICE = 'Not endorsed by Riot Games. Riot Games and all associated properties are trademarks of Riot Games, Inc.';

const loading = new Set();

const saveMatch = db.prepare('INSERT OR IGNORE INTO lol_matches VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
const getMatch = db.prepare('SELECT * FROM lol_matches WHERE match_id = ? AND puuid = ?');

function pct(wins, total) {
  return total ? Math.round(wins / total * 100) : 0;
}

function kda(rows) {
  const avg = key => (rows.reduce((s, r) => s + r[key], 0) / rows.length).toFixed(1);
  return `${avg('kills')} / ${avg('deaths')} / ${avg('assists')} KDA`;
}

function matchNumber(id) {
  return Number(id.split('_')[1]);
}

async function matchIds(route, puuid, queue, total) {
  const ids = [];
  for (let start = 0; start < total; start += 100) {
    const page = await riot(`https://${route}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=${queue}&start=${start}&count=${Math.min(100, total - start)}`);
    ids.push(...page);
    if (page.length < 100) break;
  }
  return ids;
}

async function loadMatch(route, puuid, id) {
  if (getMatch.get(id, puuid)) return;
  const match = await riot(`https://${route}.api.riotgames.com/lol/match/v5/matches/${id}`);
  const p = match.info.participants.find(x => x.puuid === puuid);
  saveMatch.run(id, puuid, match.info.queueId, p.championId, p.kills, p.deaths, p.assists, p.win ? 1 : 0);
}

async function lookup(riotId) {
  const account = await riotAccount(riotId);
  if (!account) return null;
  const { region } = await riot(`https://europe.api.riotgames.com/riot/account/v1/region/by-game/lol/by-puuid/${account.puuid}`);
  const platform = region.toLowerCase();
  const [route, opgg] = PLATFORMS[platform];
  const entries = await riot(`https://${platform}.api.riotgames.com/lol/league/v4/entries/by-puuid/${account.puuid}`);
  const summoner = await riot(`https://${platform}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${account.puuid}`);
  const solo = entries.find(e => e.queueType === 'RANKED_SOLO_5x5');
  const flex = entries.find(e => e.queueType === 'RANKED_FLEX_SR');

  const soloIds = solo ? await matchIds(route, account.puuid, SOLO, Math.min(SEASON_CAP, solo.wins + solo.losses)) : [];
  const flexIds = flex ? await matchIds(route, account.puuid, FLEX, Math.min(SEASON_CAP, flex.wins + flex.losses)) : [];
  const normalIds = [];
  for (const queue of NORMALS) normalIds.push(...await matchIds(route, account.puuid, queue, 20));
  const recentIds = [...new Set([...soloIds.slice(0, 20), ...flexIds.slice(0, 20), ...normalIds])]
    .sort((a, b) => matchNumber(b) - matchNumber(a))
    .slice(0, 20);

  return { account, route, opgg, icon: await profileIconUrl(summoner.profileIconId), solo, flex, soloIds, flexIds, recentIds, all: [...new Set([...recentIds, ...soloIds, ...flexIds])] };
}

async function buildEmbed(data) {
  const { account, opgg, icon, solo, flex, soloIds, flexIds, recentIds, all } = data;
  const rows = ids => ids.map(id => getMatch.get(id, account.puuid)).filter(Boolean);
  const loaded = rows(all).length;

  const queueField = (name, entry, ids) => {
    const games = rows(ids);
    const lines = entry
      ? [`**${entry.tier[0]}${entry.tier.slice(1).toLowerCase()} ${entry.rank}** ${entry.leaguePoints} LP`, `${pct(entry.wins, entry.wins + entry.losses)}% WR (${entry.wins + entry.losses} games)`]
      : ['Unranked'];
    if (games.length) lines.push(kda(games));
    return { name, value: lines.join('\n'), inline: true };
  };

  const recent = rows(recentIds);
  const ranked = rows([...soloIds, ...flexIds]);
  const topSource = ranked.length ? ranked : recent;
  const counts = {};
  for (const r of topSource) {
    counts[r.champion] ??= { games: 0, wins: 0 };
    counts[r.champion].games++;
    counts[r.champion].wins += r.win;
  }
  const top = await Promise.all(Object.entries(counts).sort((a, b) => b[1].games - a[1].games).slice(0, 3)
    .map(async ([key, s], i) => `${i + 1}. ${await championLabel(Number(key))} — ${s.games} game${s.games === 1 ? '' : 's'} · ${pct(s.wins, s.games)}% WR`));

  const embed = new EmbedBuilder()
    .setAuthor({ name: `${account.gameName}#${account.tagLine}`, iconURL: icon })
    .setColor(colors.lol)
    .setTitle(`League of Legends · ${opgg.toUpperCase()}`)
    .setURL(`https://op.gg/lol/summoners/${opgg}/${encodeURIComponent(account.gameName)}-${encodeURIComponent(account.tagLine)}`)
    .addFields(
      { name: `Last ${recent.length} Summoner's Rift games`, value: recent.length ? `${pct(recent.filter(r => r.win).length, recent.length)}% WR\n${kda(recent)}` : 'No games yet' },
      queueField('Ranked Solo/Duo · season', solo, soloIds),
      queueField('Ranked Flex · season', flex, flexIds),
      { name: ranked.length ? 'Top champions (ranked, this season)' : `Top champions (last ${recent.length})`, value: top.join('\n') || '-' }
    )
    .setFooter({ text: `League of Legends · ${NOTICE}`, iconURL: icons.lol });

  if (loaded < all.length) embed.setDescription(`⏳ Loading season games: ${loaded}/${all.length}. Card will get updated.`);
  return embed;
}

async function lolStats(riotId, onUpdate) {
  const data = await lookup(riotId);
  if (!data) return null;
  const missing = data.all.filter(id => !getMatch.get(id, data.account.puuid));
  let budget = 60;

  while (missing.length && budget--) await loadMatch(data.route, data.account.puuid, missing.shift());

  if (missing.length && !loading.has(data.account.puuid)) {
    loading.add(data.account.puuid);
    (async () => {
      for (const id of missing) await loadMatch(data.route, data.account.puuid, id);
      await onUpdate(await buildEmbed(data));
    })().catch(console.error).finally(() => loading.delete(data.account.puuid));
  }

  return buildEmbed(data);
}

module.exports = { lolStats };
