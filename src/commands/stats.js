const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getLinks } = require('../db');
const { getJson, resolveSteamId, steamToAccountId, steamProfile, riot, riotAccount } = require('../api');

const DL_RANKS = ['Obscurus', 'Initiate', 'Seeker', 'Alchemist', 'Arcanist', 'Ritualist', 'Emissary', 'Archon', 'Oracle', 'Phantom', 'Ascendant', 'Eternus'];

const LOL_PLATFORMS = {
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

const RIOT_NOTICE = 'Not endorsed by Riot Games. Riot Games and all associated properties are trademarks of Riot Games, Inc.';

const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('Show a player\'s game stats')
  .addStringOption(o => o.setName('game').setDescription('Game').setRequired(true).addChoices(
    { name: 'Deadlock', value: 'deadlock' },
    { name: 'Counter-Strike 2', value: 'cs2' },
    { name: 'League of Legends', value: 'lol' },
    { name: 'Valorant', value: 'val' }
  ))
  .addStringOption(o => o.setName('player').setDescription('@user, Steam profile link / friend code, or Riot ID (Name#Tag). Empty = you'));

function pct(wins, total) {
  return total ? Math.round(wins / total * 100) : 0;
}

function kda(list) {
  if (!list.length) return '-';
  const avg = i => (list.reduce((s, x) => s + x[i], 0) / list.length).toFixed(1);
  return `${avg(0)} / ${avg(1)} / ${avg(2)}`;
}

function topBy(games, key, won) {
  const counts = {};
  for (const g of games) {
    const k = key(g);
    counts[k] ??= { games: 0, wins: 0 };
    counts[k].games++;
    if (won(g)) counts[k].wins++;
  }
  return Object.entries(counts).sort((a, b) => b[1].games - a[1].games).slice(0, 3);
}

function mentionedUser(input) {
  return input?.trim().match(/^<@!?(\d+)>$/)?.[1];
}

async function steamIdFor(input, selfId) {
  const userId = input ? mentionedUser(input) : selfId;
  if (userId) return getLinks(userId)?.steam_id ?? null;
  return resolveSteamId(input);
}

function riotIdFor(input, selfId) {
  const userId = input ? mentionedUser(input) : selfId;
  if (userId) return getLinks(userId)?.riot_id ?? null;
  return input.includes('#') ? input.trim() : null;
}

let heroNames;
async function heroName(id) {
  if (!heroNames) {
    const heroes = await getJson('https://api.deadlock-api.com/v1/assets/heroes');
    heroNames = Object.fromEntries(heroes.map(h => [h.id, h.name]));
  }
  return heroNames[id] ?? `Hero ${id}`;
}

async function deadlockEmbed(steamId) {
  const [profile, history] = await Promise.all([
    steamProfile(steamId),
    getJson(`https://api.deadlock-api.com/v1/players/${steamToAccountId(steamId)}/match-history`)
  ]);
  if (!history.length) return null;

  const won = m => m.match_result === m.player_team;
  const toKda = m => [m.player_kills, m.player_deaths, m.player_assists];
  const ranked = history.filter(m => m.match_mode === 4);
  const badge = ranked.find(m => m.ranked_display_badge)?.ranked_display_badge;
  const rank = badge ? `${DL_RANKS[Math.floor(badge / 10)] ?? 'Rank'} ${badge % 10}` : 'Unranked';
  const top = await Promise.all(topBy(history, m => m.hero_id, won)
    .map(async ([id, s], i) => `${i + 1}. ${await heroName(Number(id))} — ${s.games} game${s.games === 1 ? '' : 's'} · ${pct(s.wins, s.games)}% WR`));

  return new EmbedBuilder()
    .setTitle(profile.personaname)
    .setURL(profile.profileurl)
    .setThumbnail(profile.avatarfull)
    .setDescription('Deadlock')
    .addFields(
      { name: 'Overall', value: `${pct(history.filter(won).length, history.length)}% WR (${history.length} games)\n${kda(history.map(toKda))} KDA` },
      { name: 'Ranked', value: `${rank}\n${pct(ranked.filter(won).length, ranked.length)}% WR (${ranked.length} games)\n${kda(ranked.map(toKda))} KDA` },
      { name: 'Top heroes', value: top.join('\n') }
    )
    .setFooter({ text: 'Data from deadlock-api.com' });
}

async function csEmbed(steamId) {
  const headers = process.env.LEETIFY_KEY ? { _leetify_key: process.env.LEETIFY_KEY } : {};
  const [profile, lt] = await Promise.all([
    steamProfile(steamId),
    getJson(`https://api-public.cs-prod.leetify.com/v3/profile?steam64_id=${steamId}`, headers)
  ]);

  const embed = new EmbedBuilder()
    .setTitle(profile.personaname)
    .setURL(profile.profileurl)
    .setThumbnail(profile.avatarfull)
    .setDescription('Counter-Strike 2')
    .addFields(
      { name: 'Ranks', value: `Premier: ${lt.ranks?.premier ?? '-'}\nFACEIT: ${lt.ranks?.faceit ? `Level ${lt.ranks.faceit} (${lt.ranks.faceit_elo} Elo)` : '-'}` },
      { name: 'Overall', value: `${Math.round(lt.winrate * 100)}% WR (${lt.total_matches} games)` },
      { name: 'Ratings', value: `Aim ${Math.round(lt.rating.aim)} · Positioning ${Math.round(lt.rating.positioning)} · Utility ${Math.round(lt.rating.utility)}` }
    );

  if (lt.bans?.length) embed.addFields({ name: '⚠️ Bans', value: lt.bans.map(b => b.platform).join(', ') });
  embed.addFields({ name: '​', value: `[**Data Provided by Leetify**](https://leetify.com/) · [Profile](https://leetify.com/app/profile/${steamId})` });
  return embed;
}

async function lolEmbed(riotId) {
  const account = await riotAccount(riotId);
  if (!account) return null;
  const { region } = await riot(`https://europe.api.riotgames.com/riot/account/v1/region/by-game/lol/by-puuid/${account.puuid}`);
  const platform = region.toLowerCase();
  const [route, opgg] = LOL_PLATFORMS[platform];

  const entries = await riot(`https://${platform}.api.riotgames.com/lol/league/v4/entries/by-puuid/${account.puuid}`);
  const solo = entries.find(e => e.queueType === 'RANKED_SOLO_5x5');

  const ids = await riot(`https://${route}.api.riotgames.com/lol/match/v5/matches/by-puuid/${account.puuid}/ids?count=20`);
  const games = [];
  for (const id of ids) {
    const match = await riot(`https://${route}.api.riotgames.com/lol/match/v5/matches/${id}`);
    games.push({ ...match.info.participants.find(p => p.puuid === account.puuid), queueId: match.info.queueId });
  }

  const ranked = games.filter(g => g.queueId === 420);
  const toKda = g => [g.kills, g.deaths, g.assists];
  const top = topBy(games, g => g.championName, g => g.win)
    .map(([champ, s], i) => `${i + 1}. ${champ} — ${s.games} game${s.games === 1 ? '' : 's'} · ${pct(s.wins, s.games)}% WR`);
  const rankLine = solo
    ? `${solo.tier} ${solo.rank} ${solo.leaguePoints} LP\n${pct(solo.wins, solo.wins + solo.losses)}% WR (${solo.wins + solo.losses} games)`
    : 'Unranked';

  return new EmbedBuilder()
    .setTitle(`${account.gameName}#${account.tagLine}`)
    .setURL(`https://op.gg/lol/summoners/${opgg}/${encodeURIComponent(account.gameName)}-${encodeURIComponent(account.tagLine)}`)
    .setDescription(`League of Legends · ${opgg.toUpperCase()}`)
    .addFields(
      { name: `Overall (last ${games.length})`, value: `${pct(games.filter(g => g.win).length, games.length)}% WR\n${kda(games.map(toKda))} KDA` },
      { name: 'Ranked Solo/Duo', value: `${rankLine}\n${kda(ranked.map(toKda))} KDA (recent)` },
      { name: 'Top champions (recent)', value: top.join('\n') || '-' }
    )
    .setFooter({ text: RIOT_NOTICE });
}

async function valEmbed(riotId) {
  const account = await riotAccount(riotId);
  if (!account) return null;
  const name = `${account.gameName}#${account.tagLine}`;
  const url = `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(name)}/overview`;
  return new EmbedBuilder()
    .setTitle(name)
    .setURL(url)
    .setDescription(`Valorant\nRiot only shares Valorant stats with apps players sign in to, so the bot can't show them here. [Open the tracker.gg profile](${url})`)
    .setFooter({ text: RIOT_NOTICE });
}

async function execute(interaction) {
  await interaction.deferReply();
  const game = interaction.options.getString('game');
  const input = interaction.options.getString('player');

  try {
    let embed;
    if (game === 'lol' || game === 'val') {
      const riotId = riotIdFor(input, interaction.user.id);
      if (!riotId) return interaction.editReply('No Riot ID found. Use a Riot ID like Name#Tag, or link one with /link.');
      embed = game === 'lol' ? await lolEmbed(riotId) : await valEmbed(riotId);
    } else {
      const steamId = await steamIdFor(input, interaction.user.id);
      if (!steamId) return interaction.editReply('No Steam account found. Use their Steam profile link or friend code, or link one with /link.');
      embed = game === 'deadlock' ? await deadlockEmbed(steamId) : await csEmbed(steamId);
    }
    if (!embed) return interaction.editReply('No match data found for that player.');
    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error(err);
    await interaction.editReply(err.status === 429 ? 'Too many lookups right now. Try again in a minute.' : "Couldn't find stats for that player.");
  }
}

module.exports = { data, execute };
