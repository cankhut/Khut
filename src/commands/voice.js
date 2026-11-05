const { SlashCommandBuilder, EmbedBuilder, InteractionContextType } = require('discord.js');
const { db, guildSettings } = require('../db');
const { periodStart, formatMinutes } = require('../time');

const PERIODS = [
  { name: 'This week', value: 'week' },
  { name: 'This month', value: 'month' },
  { name: 'All time', value: 'all' }
];

const voicetime = new SlashCommandBuilder()
  .setName('voicetime')
  .setDescription('Time spent in voice with others')
  .setContexts(InteractionContextType.Guild)
  .addUserOption(o => o.setName('player').setDescription('Empty = you'));

const leaderboard = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('Most time in voice')
  .setContexts(InteractionContextType.Guild)
  .addStringOption(o => o.setName('period').setDescription('Default: this week').addChoices(...PERIODS));

const duo = new SlashCommandBuilder()
  .setName('duo')
  .setDescription('Who someone spends the most voice time with')
  .setContexts(InteractionContextType.Guild)
  .addUserOption(o => o.setName('player').setDescription('Empty = you'))
  .addStringOption(o => o.setName('period').setDescription('Default: all time').addChoices(...PERIODS));

function minutesSince(guildId, userId, since) {
  return db.prepare('SELECT COALESCE(SUM(minutes), 0) AS m FROM voice_minutes WHERE guild_id = ? AND user_id = ? AND day >= ?').get(guildId, userId, since).m;
}

async function executeVoicetime(interaction) {
  const user = interaction.options.getUser('player') ?? interaction.user;
  const tz = guildSettings(interaction.guildId).timezone;
  const games = db.prepare("SELECT game, SUM(minutes) AS m FROM voice_minutes WHERE guild_id = ? AND user_id = ? AND game != '' GROUP BY game ORDER BY m DESC LIMIT 3")
    .all(interaction.guildId, user.id);

  const embed = new EmbedBuilder()
    .setTitle(`🎙️ ${user.displayName}`)
    .addFields(
      ...PERIODS.map(p => ({ name: p.name, value: formatMinutes(minutesSince(interaction.guildId, user.id, periodStart(p.value, tz))), inline: true })),
      { name: 'Top games in voice', value: games.map((g, i) => `${i + 1}. ${g.game} (${formatMinutes(g.m)})`).join('\n') || '-' }
    );
  await interaction.reply({ embeds: [embed] });
}

async function executeLeaderboard(interaction) {
  const period = interaction.options.getString('period') ?? 'week';
  const since = periodStart(period, guildSettings(interaction.guildId).timezone);
  const rows = db.prepare('SELECT user_id, SUM(minutes) AS m FROM voice_minutes WHERE guild_id = ? AND day >= ? GROUP BY user_id ORDER BY m DESC LIMIT 10')
    .all(interaction.guildId, since);

  const embed = new EmbedBuilder()
    .setTitle(`🏆 Voice leaderboard · ${PERIODS.find(p => p.value === period).name}`)
    .setDescription(rows.map((r, i) => `${i + 1}. <@${r.user_id}> — ${formatMinutes(r.m)}`).join('\n') || 'No voice time yet.');
  await interaction.reply({ embeds: [embed] });
}

async function executeDuo(interaction) {
  const user = interaction.options.getUser('player') ?? interaction.user;
  const period = interaction.options.getString('period') ?? 'all';
  const since = periodStart(period, guildSettings(interaction.guildId).timezone);
  const rows = db.prepare(`
    SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END AS other, SUM(minutes) AS m
    FROM pair_minutes WHERE guild_id = ? AND (user_a = ? OR user_b = ?) AND day >= ?
    GROUP BY other ORDER BY m DESC LIMIT 5
  `).all(user.id, interaction.guildId, user.id, user.id, since);

  const embed = new EmbedBuilder()
    .setTitle(`🤝 ${user.displayName}'s duos · ${PERIODS.find(p => p.value === period).name}`)
    .setDescription(rows.map((r, i) => `${i + 1}. <@${r.other}> — ${formatMinutes(r.m)}`).join('\n') || 'No voice time together yet.');
  await interaction.reply({ embeds: [embed] });
}

module.exports = [
  { data: voicetime, execute: executeVoicetime },
  { data: leaderboard, execute: executeLeaderboard },
  { data: duo, execute: executeDuo }
];
