const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { db, getLinks, guildSettings } = require('../db');
const { getJson, resolveSteamId, steamToAccountId, steamProfile } = require('../api');
const { heroLabel, emoji } = require('../assets');
const { getPlayer: getBrawlhallaPlayer, parsePlayerId, legendIconUrl, profileUrl: brawlhallaProfileUrl } = require('../brawlhalla');
const { lolStats } = require('../lol');
const colors = require('../colors');
const icons = require('../icons');
const { periodStart, formatMinutes } = require('../time');
const { later } = require('../cleanup');
const log = require('../log');
const { settings, text } = require('../settings');

const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('Show a player\'s game stats')
  .addStringOption(o => o.setName('game').setDescription('Game').setRequired(true).addChoices(
    { name: 'Deadlock', value: 'deadlock' },
    { name: 'CS2', value: 'cs2' },
    { name: 'League', value: 'lol' },
    { name: 'Brawlhalla', value: 'brawlhalla' },
    { name: 'Discord', value: 'discord' }
  ))
  .addStringOption(o => o.setName('player').setDescription('@user, Brawlhalla ID, Steam link / friend code or Riot ID'))
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

function brawlhallaIdFor(input, selfId) {
  const userId = input ? mentionedUser(input) : selfId;
  if (userId) return getLinks(userId)?.brawlhalla_id ?? null;
  return parsePlayerId(input);
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

function statMap(data) {
  return Object.fromEntries((data?.playerstats?.stats ?? []).map(x => [x.name, x.value]));
}

async function faceitData(steamId) {
  if (!process.env.FACEIT_KEY) return null;
  const headers = { Authorization: `Bearer ${process.env.FACEIT_KEY}` };
  const player = await getJson(`https://open.faceit.com/data/v4/players?game=cs2&game_player_id=${steamId}`, headers).catch(() => null);
  if (!player?.games?.cs2) return null;
  const stats = await getJson(`https://open.faceit.com/data/v4/players/${player.player_id}/stats/cs2`, headers).catch(() => null);
  return { player, game: player.games.cs2, lifetime: stats?.lifetime ?? {} };
}

async function csEmbed(steamId) {
  const key = process.env.STEAM_KEY;
  const leetifyHeaders = process.env.LEETIFY_KEY ? { _leetify_key: process.env.LEETIFY_KEY } : {};
  const [profile, steamStats, owned, bans, lt, fc] = await Promise.all([
    steamProfile(steamId),
    getJson(`https://api.steampowered.com/ISteamUserStats/GetUserStatsForGame/v2/?key=${key}&steamid=${steamId}&appid=730`).then(statMap).catch(() => ({})),
    getJson(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${key}&steamid=${steamId}&include_played_free_games=1&appids_filter%5B0%5D=730`).then(d => d.response?.games?.[0]).catch(() => null),
    getJson(`https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/?key=${key}&steamids=${steamId}`).then(d => d.players?.[0]).catch(() => null),
    getJson(`https://api-public.cs-prod.leetify.com/v3/profile?steam64_id=${steamId}`, leetifyHeaders).catch(() => null),
    faceitData(steamId)
  ]);

  const hasSteam = steamStats.total_kills > 0;
  if (!hasSteam && !lt && !fc) return text('stats.noCs');

  const embed = new EmbedBuilder()
    .setAuthor({ name: profile.personaname, iconURL: profile.avatarfull, url: profile.profileurl })
    .setColor(colors.cs2)
    .setTitle('Counter-Strike 2')
    .setURL(lt ? `https://leetify.com/app/profile/${steamId}` : `https://csstats.gg/player/${steamId}`);

  const ranks = [];
  if (lt) {
    const premierGames = (lt.recent_matches ?? []).filter(m => m.rank_type === 11 && m.rank > 0);
    const premier = lt.ranks?.premier || premierGames[0]?.rank;
    const premierBest = Math.max(premier ?? 0, ...premierGames.map(m => m.rank));
    const maps = (lt.ranks?.competitive ?? []).filter(m => m.rank > 0).sort((a, b) => b.rank - a.rank);
    const name = map => map.replace(/^(de|cs)_/, '').replace(/^./, c => c.toUpperCase());
    ranks.push(`Premier: ${premier ? `**${premier.toLocaleString('en-US')}**${premierBest > premier ? ` (best ${premierBest.toLocaleString('en-US')})` : ''}` : 'Unranked'}`);
    if (maps.length) ranks.push(`Competitive: **${CS_RANKS[maps[0].rank]}** (${name(maps[0].map_name)})`);
    if (lt.ranks?.wingman) ranks.push(`Wingman: **${CS_RANKS[lt.ranks.wingman]}**`);
  }
  if (fc) ranks.push(`FACEIT: **Level ${fc.game.skill_level}** (${fc.game.faceit_elo} Elo)`);
  else if (lt?.ranks?.faceit) ranks.push(`FACEIT: **Level ${lt.ranks.faceit}** (${lt.ranks.faceit_elo} Elo)`);
  if (ranks.length) embed.addFields({ name: 'Ranks', value: ranks.join('\n') });

  const hours = owned ? Math.round(owned.playtime_forever / 60) : Math.round((steamStats.total_time_played ?? 0) / 3600);
  if (hasSteam) {
    const lines = [`${(steamStats.total_kills / Math.max(1, steamStats.total_deaths)).toFixed(2)} K/D · ${pct(steamStats.total_kills_headshot ?? 0, steamStats.total_kills)}% HS`];
    if (steamStats.total_matches_played) lines.push(`${pct(steamStats.total_matches_won ?? 0, steamStats.total_matches_played)}% WR (${steamStats.total_matches_played.toLocaleString('en-US')} matches)`);
    if (hours) lines.push(`${hours.toLocaleString('en-US')} hours played`);
    embed.addFields({ name: 'Lifetime (Steam)', value: lines.join('\n'), inline: true });
  } else if (hours) {
    embed.addFields({ name: 'Playtime', value: `${hours.toLocaleString('en-US')} hours played`, inline: true });
  }

  if (fc && fc.lifetime.Matches) {
    const l = fc.lifetime;
    embed.addFields({ name: 'FACEIT', value: `${l['Win Rate %'] ?? '-'}% WR (${Number(l.Matches).toLocaleString('en-US')} matches)\n${l['Average K/D Ratio'] ?? '-'} K/D · ${l['Average Headshots %'] ?? '-'}% HS`, inline: true });
  }

  if (lt) {
    embed.addFields(
      { name: 'Leetify', value: `${Math.round(lt.winrate * 100)}% WR (${lt.total_matches} games)\nRating ${lt.ranks?.leetify > 0 ? '+' : ''}${lt.ranks?.leetify ?? '-'}`, inline: true },
      { name: 'Ratings', value: `Aim ${Math.round(lt.rating.aim)} · Positioning ${Math.round(lt.rating.positioning)} · Utility ${Math.round(lt.rating.utility)}` }
    );
  }

  if (bans?.NumberOfVACBans || bans?.NumberOfGameBans) {
    const list = [bans.NumberOfVACBans && `${bans.NumberOfVACBans} VAC`, bans.NumberOfGameBans && `${bans.NumberOfGameBans} game`].filter(Boolean).join(', ');
    const total = bans.NumberOfVACBans + bans.NumberOfGameBans;
    embed.addFields({ name: '⚠️ Bans', value: `${list} ban${total === 1 ? '' : 's'} (last one ${bans.DaysSinceLastBan} days ago)` });
  }

  const links = [];
  if (lt) links.push(`[**Data Provided by Leetify**](https://leetify.com/app/profile/${steamId})`);
  if (fc) links.push(`[FACEIT](${fc.player.faceit_url.replace('{lang}', 'en')})`);
  links.push(`[csstats.gg](https://csstats.gg/player/${steamId})`, `[Steam profile](${profile.profileurl})`);
  embed.addFields({ name: '\u200b', value: links.join(' · ') });
  embed.setFooter({ text: hasSteam ? 'Counter-Strike 2 · Steam lifetime stats include CS:GO' : 'Counter-Strike 2', iconURL: icons.cs2 });
  return embed;
}


function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function numberText(value) {
  return Math.round(numberValue(value)).toLocaleString('en-US');
}

function xpProgress(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const raw = Number(value);
  const percent = Math.max(0, Math.min(100, raw <= 1 ? raw * 100 : raw));
  const filled = Math.round(percent / 10);
  return `${'▰'.repeat(filled)}${'▱'.repeat(10 - filled)} ${percent.toFixed(0)}%`;
}

function rankedSummary(data, mode) {
  const games = numberValue(data?.games);
  const wins = numberValue(data?.wins);
  if (data?.unavailable) return `Ranked ${mode} stats are temporarily unavailable.`;
  if (!data || games < 1) return `No ranked ${mode} matches recorded this season.`;

  const losses = Math.max(0, games - wins);
  const lines = [
    `**${data.tier || 'Ranked'}** · **${numberText(data.rating)} Elo**`,
    `${numberText(wins)}W – ${numberText(losses)}L · **${pct(wins, games)}% WR** (${numberText(games)} games)`
  ];
  if (numberValue(data.peak_rating) > 0 && numberValue(data.peak_rating) !== numberValue(data.rating)) {
    lines.push(`Peak: ${numberText(data.peak_rating)} Elo`);
  }
  if (data.region) lines.push(`Region: **${data.region}**`);
  if (numberValue(data.global_rank) > 0) lines.push(`Global rank: **#${numberText(data.global_rank)}**`);
  const regionalRanks = (data.region_ranks ?? [])
    .filter(rank => numberValue(rank.rank) > 0)
    .slice(0, 3)
    .map(rank => `${rank.region} #${numberText(rank.rank)}`);
  if (regionalRanks.length) lines.push(`Regional: ${regionalRanks.join(' · ')}`);
  return lines.join('\n');
}

async function brawlhallaEmbed(brawlhallaId) {
  const { all, ranked1v1, ranked3v3, teams, legends } = await getBrawlhallaPlayer(brawlhallaId);
  const legendStats = Array.isArray(all.legends) ? all.legends : [];
  const legendInfo = id => legends.get(Number(id));
  const legendLabel = id => `${emoji(`bh_${id}`)} ${legendInfo(id)?.bio_name ?? `Legend ${id}`}`.trim();

  const totalGames = numberValue(all.games);
  const totalWins = numberValue(all.wins);
  const totalLosses = Math.max(0, totalGames - totalWins);
  const sum = key => legendStats.reduce((total, legend) => total + numberValue(legend[key]), 0);
  const knockouts = sum('kos');
  const falls = sum('falls');
  const damageDealt = sum('damage_dealt');
  const damageTaken = sum('damage_taken');
  const suicides = sum('suicides');

  const mostPlayed = [...legendStats]
    .filter(legend => numberValue(legend.games) > 0)
    .sort((a, b) => numberValue(b.games) - numberValue(a.games))
    .slice(0, 3);
  const mostPlayedLines = mostPlayed.map(legend => {
    const games = numberValue(legend.games);
    const wins = numberValue(legend.wins);
    return `▪️ **${legendLabel(legend.legend_id)}** (${numberText(games)}g, ${pct(wins, games)}% WR)`;
  });

  const rankedLegends = [...(ranked1v1?.legends ?? [])]
    .filter(legend => numberValue(legend.games) > 0)
    .sort((a, b) => numberValue(b.rating) - numberValue(a.rating))
    .slice(0, 3);
  const rankedLegendLines = rankedLegends.map(legend => {
    const games = numberValue(legend.games);
    const wins = numberValue(legend.wins);
    return `▪️ **${legendLabel(legend.legend_id)}** · ${numberText(legend.rating)} Elo (${pct(wins, games)}% WR)`;
  });

  const teamList = Array.isArray(teams?.teams?.ranked_2v2) ? teams.teams.ranked_2v2 : [];
  const teamLines = [...teamList]
    .filter(team => numberValue(team.games) > 0)
    .sort((a, b) => numberValue(b.games) - numberValue(a.games))
    .slice(0, 2)
    .map((team, index) => {
      const firstIsPlayer = String(team.brawlhalla_id_one) === String(brawlhallaId);
      const partner = firstIsPlayer ? team.username_two : team.username_one;
      const games = numberValue(team.games);
      const wins = numberValue(team.wins);
      const losses = Math.max(0, games - wins);
      return `**${index + 1}. ${partner || 'Partner'}** · ${numberText(team.rating)} Elo · ${numberText(wins)}W/${numberText(losses)}L`;
    });
  const teamSummary = teams?.unavailable
    ? 'Ranked 2v2 stats are temporarily unavailable.'
    : teamLines.join('\n') || 'No ranked 2v2 teams found.';

  const lifetimeLines = [
    `**${pct(totalWins, totalGames)}% WR** · ${numberText(totalWins)}W / ${numberText(totalLosses)}L`,
    `${numberText(totalGames)} games played`
  ];
  if (all.level != null) lifetimeLines.push(`Level **${numberText(all.level)}**${xpProgress(all.xp_percentage) ? ` · ${xpProgress(all.xp_percentage)}` : ''}`);

  const combatLines = [
    `KOs **${numberText(knockouts)}** · Falls **${numberText(falls)}** · K/F **${falls ? (knockouts / falls).toFixed(2) : '—'}**`,
    `Damage dealt **${numberText(damageDealt)}** · taken **${numberText(damageTaken)}**`
  ];
  if (suicides > 0) combatLines.push(`Suicides **${numberText(suicides)}**`);

  const embed = new EmbedBuilder()
    .setColor(colors.brawlhalla)
    .setAuthor({ name: `${all.name || 'Brawlhalla player'} · Brawlhalla`, url: brawlhallaProfileUrl() })
    .setTitle('Player Statistics')
    .setURL(brawlhallaProfileUrl())
    .setDescription(`Brawlhalla ID: \`${brawlhallaId}\` · [Search on NexHalla](https://nexhalla.com/)`)
    .addFields(
      { name: '🏆 Ranked 1v1', value: rankedSummary(ranked1v1, '1v1'), inline: true },
      { name: '🏆 Ranked 3v3', value: rankedSummary(ranked3v3, '3v3'), inline: true },
      { name: '🛡️ Ranked 2v2 Teams', value: teamSummary, inline: true },
      { name: '📊 Lifetime', value: lifetimeLines.join('\n'), inline: true },
      { name: '⚔️ Combat', value: combatLines.join('\n'), inline: true },
      { name: '⭐ Most Played Legends', value: mostPlayedLines.join('\n') || 'No legend playtime data.', inline: true },
      { name: '🎖️ Top 1v1 Legends', value: rankedLegendLines.join('\n') || 'No ranked legend data.', inline: true }
    )
    .setFooter({ text: 'Brawlhalla · Official Developer API v1', iconURL: icons.brawlhalla });

  const featuredLegend = mostPlayed[0] ?? rankedLegends[0];
  const featuredInfo = featuredLegend ? legendInfo(featuredLegend.legend_id) : null;
  if (featuredInfo?.bio_name) embed.setThumbnail(legendIconUrl(featuredInfo.bio_name));
  else if (icons.brawlhalla) embed.setThumbnail(icons.brawlhalla);
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

async function fail(interaction, message) {
  log.info(`/stats reply: ${message}`);
  later(await interaction.editReply({ content: message, embeds: [] }), settings.limits.errorDeleteHours * 3600000);
}

async function execute(interaction) {
  await interaction.deferReply();
  const game = interaction.options.getString('game');
  const input = interaction.options.getString('player');

  try {
    let embed;
    if (game === 'discord') {
      if (!interaction.guildId) return fail(interaction, text('stats.discordServerOnly'));
      const userId = input ? mentionedUser(input) : interaction.user.id;
      if (!userId) return fail(interaction, text('stats.discordMention'));
      embed = await discordEmbed(interaction, userId, interaction.options.getUser('with'));
    } else if (game === 'lol') {
      const riotId = riotIdFor(input, interaction.user.id);
      if (!riotId) return fail(interaction, text(input ? 'stats.noRiot' : 'stats.noRiotLinked'));
      log.info(`/stats League lookup: ${riotId}`);
      embed = await lolStats(riotId, update => interaction.editReply({ embeds: [update] }));
    } else if (game === 'brawlhalla') {
      const userId = input ? mentionedUser(input) : interaction.user.id;
      const brawlhallaId = brawlhallaIdFor(input, interaction.user.id);
      if (!brawlhallaId) return fail(interaction, text(userId ? 'stats.noBrawlhallaLinked' : 'stats.noBrawlhalla'));
      log.info(`/stats Brawlhalla lookup: ${brawlhallaId}`);
      embed = await brawlhallaEmbed(brawlhallaId);
    } else {
      const steamId = await steamIdFor(input, interaction.user.id);
      if (!steamId) return fail(interaction, text(input ? 'stats.noSteam' : 'stats.noSteamLinked'));
      log.info(`/stats ${game} lookup: ${steamId}`);
      embed = game === 'deadlock' ? await deadlockEmbed(steamId) : await csEmbed(steamId);
    }
    if (!embed) return fail(interaction, text('stats.noMatches'));
    if (typeof embed === 'string') return fail(interaction, embed);
    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    log.error(`/stats ${game} ${input ?? '(self)'} failed:`, err);
    await fail(interaction, text(err.status === 429 ? 'stats.rateLimit' : 'stats.notFound'));
  }
}

module.exports = { data, execute };
