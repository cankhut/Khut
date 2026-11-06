const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { db, getLinks, guildSettings } = require('../db');
const { getJson, resolveSteamId, steamToAccountId, steamProfile } = require('../api');
const { heroLabel } = require('../assets');
const { lolStats } = require('../lol');
const colors = require('../colors');
const icons = require('../icons');
const { periodStart, formatMinutes } = require('../time');

const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('Show a player\'s game stats')
  .addStringOption(o => o.setName('game').setDescription('Game').setRequired(true).addChoices(
    { name: 'Deadlock', value: 'deadlock' },
    { name: 'CS2', value: 'cs2' },
    { name: 'League', value: 'lol' },
    { name: 'Discord', value: 'discord' }
  ))
  .addStringOption(o => o.setName('player').setDescription('@user, Steam link / friend code or Riot ID'))
  .addUserOption(o => o.setName('with').setDescription('DISCORD ONLY: show voice time between player and this person'));

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

let ranks;
async function rankInfo(rankNumber) {
  if (!ranks) ranks = Object.fromEntries((await getJson('https://api.deadlock-api.com/v1/assets/ranks')).map(r => [r.tier, r]));
  const rank = ranks[Math.floor(rankNumber / 10)];
  return { name: `${rank?.name ?? 'Rank'} ${rankNumber % 10}`, icon: rank?.images?.chalk ?? rank?.images?.large };
}

function progressBar(flat) {
  const pos = flat % 7000;
  const [current, max] = pos >= 5000 ? [pos - 5000, 2000] : [pos % 1000, 1000];
  const filled = Math.round(current / max * 10);
  return `${'▰'.repeat(filled)}${'▱'.repeat(10 - filled)} ${current.toLocaleString('en-US')}/${max.toLocaleString('en-US')}`;
}

async function deadlockEmbed(steamId) {
  const accountId = steamToAccountId(steamId);
  const [profile, history, rank] = await Promise.all([
    steamProfile(steamId),
    getJson(`https://api.deadlock-api.com/v1/players/${accountId}/match-history`),
    getJson(`https://api.deadlock-api.com/v1/players/${accountId}/rank`).catch(() => null)
  ]);
  if (!history.length) return null;

  const won = m => m.match_result === m.player_team;
  const toKda = m => [m.player_kills, m.player_deaths, m.player_assists];
  const ranked = history.filter(m => m.match_mode === 4);
  const badge = rank?.badge || ranked.find(m => m.ranked_display_badge)?.ranked_display_badge;
  const info = badge ? await rankInfo(badge) : null;
  const progress = rank?.badge ? rank.last_match?.player_rank_final_flat_progress : null;
  const rankLines = [info ? `**${info.name}**` : 'Unranked'];
  if (progress != null && badge < 110) rankLines.push(progressBar(progress));

  const top = await Promise.all(topBy(history, m => m.hero_id, won)
    .map(async ([id, s], i) => `${i + 1}. ${await heroLabel(Number(id))} — ${s.games} game${s.games === 1 ? '' : 's'} · ${pct(s.wins, s.games)}% WR`));

  const embed = new EmbedBuilder()
    .setAuthor({ name: profile.personaname, iconURL: profile.avatarfull, url: profile.profileurl })
    .setColor(colors.deadlock)
    .setTitle('Deadlock')
    .setURL(`https://statlocker.gg/profile/${accountId}`)
    .addFields(
      { name: 'Overall', value: `${pct(history.filter(won).length, history.length)}% WR (${history.length} games)\n${kda(history.map(toKda))} KDA`, inline: true },
      { name: 'Ranked', value: `${rankLines.join('\n')}\n${pct(ranked.filter(won).length, ranked.length)}% WR (${ranked.length} games)\n${kda(ranked.map(toKda))} KDA`, inline: true },
      { name: 'Top heroes', value: top.join('\n') },
      { name: '\u200b', value: `[Statlocker profile](https://statlocker.gg/profile/${accountId}) · [Steam profile](${profile.profileurl})` }
    )
    .setFooter({ text: 'Deadlock · Data from deadlock-api.com', iconURL: icons.deadlock });

  if (info?.icon) embed.setThumbnail(info.icon);
  return embed;
}

const CS_RANKS = ['Unranked', 'Silver I', 'Silver II', 'Silver III', 'Silver IV', 'Silver Elite', 'Silver Elite Master', 'Gold Nova I', 'Gold Nova II', 'Gold Nova III', 'Gold Nova Master', 'Master Guardian I', 'Master Guardian II', 'Master Guardian Elite', 'Distinguished Master Guardian', 'Legendary Eagle', 'Legendary Eagle Master', 'Supreme Master First Class', 'Global Elite'];

async function csEmbed(steamId) {
  const headers = process.env.LEETIFY_KEY ? { _leetify_key: process.env.LEETIFY_KEY } : {};
  const [profile, lt] = await Promise.all([
    steamProfile(steamId),
    getJson(`https://api-public.cs-prod.leetify.com/v3/profile?steam64_id=${steamId}`, headers)
  ]);

  const premierGames = (lt.recent_matches ?? []).filter(m => m.rank_type === 11 && m.rank > 0);
  const premier = lt.ranks?.premier || premierGames[0]?.rank;
  const premierBest = Math.max(premier ?? 0, ...premierGames.map(m => m.rank));
  const maps = (lt.ranks?.competitive ?? []).filter(m => m.rank > 0).sort((a, b) => b.rank - a.rank);
  const name = map => map.replace(/^(de|cs)_/, '').replace(/^./, c => c.toUpperCase());

  const ranks = [`Premier: ${premier ? `**${premier.toLocaleString('en-US')}**${premierBest > premier ? ` (best ${premierBest.toLocaleString('en-US')})` : ''}` : 'Unranked'}`];
  if (maps.length) ranks.push(`Competitive: **${CS_RANKS[maps[0].rank]}** (${name(maps[0].map_name)})`);
  if (lt.ranks?.wingman) ranks.push(`Wingman: **${CS_RANKS[lt.ranks.wingman]}**`);
  if (lt.ranks?.faceit) ranks.push(`FACEIT: **Level ${lt.ranks.faceit}** (${lt.ranks.faceit_elo} Elo)`);

  const embed = new EmbedBuilder()
    .setAuthor({ name: profile.personaname, iconURL: profile.avatarfull, url: profile.profileurl })
    .setColor(colors.cs2)
    .setTitle('Counter-Strike 2')
    .setURL(`https://leetify.com/app/profile/${steamId}`)
    .addFields(
      { name: 'Ranks', value: ranks.join('\n') },
      { name: 'Overall', value: `${Math.round(lt.winrate * 100)}% WR (${lt.total_matches} games)\nLeetify rating ${lt.ranks?.leetify > 0 ? '+' : ''}${lt.ranks?.leetify ?? '-'}` },
      { name: 'Ratings', value: `Aim ${Math.round(lt.rating.aim)} · Positioning ${Math.round(lt.rating.positioning)} · Utility ${Math.round(lt.rating.utility)}` }
    );

  if (lt.bans?.length) embed.addFields({ name: '⚠️ Bans', value: lt.bans.map(b => b.platform).join(', ') });
  embed.addFields({ name: '\u200b', value: `[**Data Provided by Leetify**](https://leetify.com/) · [Profile](https://leetify.com/app/profile/${steamId})` });
  embed.setFooter({ text: 'Counter-Strike 2', iconURL: icons.cs2 });
  return embed;
}

function voiceMinutes(guildId, sql, args, tz) {
  return ['week', 'month', 'all'].map(period => db.prepare(sql).get(guildId, ...args, periodStart(period, tz)).m);
}

async function discordEmbed(interaction, userId, withUser) {
  const guildId = interaction.guildId;
  const tz = guildSettings(guildId).timezone;
  const member = await interaction.guild.members.fetch(userId);
  const periods = ['This week', 'This month', 'All time'];

  if (withUser) {
    const [a, b] = [userId, withUser.id].sort();
    const totals = voiceMinutes(guildId, 'SELECT COALESCE(SUM(minutes), 0) AS m FROM pair_minutes WHERE guild_id = ? AND user_a = ? AND user_b = ? AND day >= ?', [a, b], tz);
    return new EmbedBuilder()
      .setAuthor({ name: `${member.displayName} & ${withUser.displayName}`, iconURL: member.displayAvatarURL() })
      .setColor(colors.discord)
      .setTitle('🎙️ Voice time together')
      .setFooter({ text: 'Discord', iconURL: icons.discord })
      .addFields(periods.map((name, i) => ({ name, value: formatMinutes(totals[i]), inline: true })));
  }

  const totals = voiceMinutes(guildId, 'SELECT COALESCE(SUM(minutes), 0) AS m FROM voice_minutes WHERE guild_id = ? AND user_id = ? AND day >= ?', [userId], tz);
  const games = db.prepare("SELECT game, SUM(minutes) AS m FROM voice_minutes WHERE guild_id = ? AND user_id = ? AND game != '' GROUP BY game ORDER BY m DESC LIMIT 3").all(guildId, userId);
  const duos = db.prepare(`
    SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END AS other, SUM(minutes) AS m
    FROM pair_minutes WHERE guild_id = ? AND (user_a = ? OR user_b = ?)
    GROUP BY other ORDER BY m DESC LIMIT 3
  `).all(userId, guildId, userId, userId);

  return new EmbedBuilder()
    .setAuthor({ name: member.displayName, iconURL: member.displayAvatarURL() })
    .setColor(colors.discord)
    .setTitle('🎙️ Voice time')
    .setFooter({ text: 'Discord', iconURL: icons.discord })
    .addFields(
      ...periods.map((name, i) => ({ name, value: formatMinutes(totals[i]), inline: true })),
      { name: 'Most played in voice', value: games.map((g, i) => `${i + 1}. ${g.game} — ${formatMinutes(g.m)}`).join('\n') || 'Nothing yet', inline: true },
      { name: 'Spends the most time with', value: duos.map((d, i) => `${i + 1}. <@${d.other}> — ${formatMinutes(d.m)}`).join('\n') || 'Nobody yet', inline: true }
    );
}

async function execute(interaction) {
  await interaction.deferReply();
  const game = interaction.options.getString('game');
  const input = interaction.options.getString('player');

  try {
    let embed;
    if (game === 'discord') {
      if (!interaction.guildId) return interaction.editReply('Discord stats only work inside a server.');
      const userId = input ? mentionedUser(input) : interaction.user.id;
      if (!userId) return interaction.editReply('For Discord, mention someone in player, like @Emre.');
      embed = await discordEmbed(interaction, userId, interaction.options.getUser('with'));
    } else if (game === 'lol') {
      const riotId = riotIdFor(input, interaction.user.id);
      if (!riotId) return interaction.editReply('No Riot ID found. Use a Riot ID like Name#Tag.');
      embed = await lolStats(riotId, update => interaction.editReply({ embeds: [update] }));
    } else {
      const steamId = await steamIdFor(input, interaction.user.id);
      if (!steamId) return interaction.editReply('No Steam account found. Use their Steam profile link or friend code.');
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
