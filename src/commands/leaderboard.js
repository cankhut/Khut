const { SlashCommandBuilder, InteractionContextType, EmbedBuilder } = require('discord.js');
const { db } = require('../db');
const { text } = require('../settings');
const colors = require('../colors');
const core = require('../games/core');
const dlbuild = require('../games/dlbuild');

const PERIODS = { week: 'This week', month: 'This month', all: 'All time' };
const MEDALS = ['🥇', '🥈', '🥉'];

const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('The best /play players in this server')
  .setContexts(InteractionContextType.Guild)
  .addStringOption(o => o.setName('game').setDescription('Which game').setRequired(true).addChoices(
    { name: 'dlbuild', value: 'dlbuild' },
    { name: 'lolhero', value: 'lolhero' },
    { name: 'wftenno', value: 'wftenno' }
  ))
  .addStringOption(o => o.setName('period').setDescription('Time range (this week if empty)').addChoices(
    { name: 'This week', value: 'week' },
    { name: 'This month', value: 'month' },
    { name: 'All time', value: 'all' }
  ));

const members = new Map();

async function isMember(guild, userId) {
  const key = `${guild.id}:${userId}`;
  const hit = members.get(key);
  if (hit && Date.now() - hit.at < 600000) return hit.yes;
  const yes = Boolean(await guild.members.fetch({ user: userId, force: true }).catch(() => null));
  members.set(key, { at: Date.now(), yes });
  return yes;
}

function since(period, today) {
  if (period === 'all') return '0000-00-00';
  if (period === 'month') return `${today.slice(0, 7)}-01`;
  const day = new Date(`${today}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

function scores(game, from) {
  const rows = db.prepare('SELECT user_id, mode, day, state, done FROM play_progress WHERE game = ? AND day >= ?').all(game, from);
  const players = new Map();
  for (const row of rows) {
    const state = JSON.parse(row.state);
    const p = players.get(row.user_id) ?? { id: row.user_id, points: 0, games: 0, solved: 0, guesses: 0 };
    if (game === 'dlbuild') {
      p.points += dlbuild.points(row.mode, row.day, state);
      p.games++;
    } else if (row.done) {
      p.solved++;
      p.guesses += state.guesses.length;
    }
    players.set(row.user_id, p);
  }
  const list = [...players.values()].filter(p => (game === 'dlbuild' ? p.games : p.solved));
  return game === 'dlbuild'
    ? list.sort((a, b) => b.points - a.points)
    : list.sort((a, b) => b.solved - a.solved || a.guesses / a.solved - b.guesses / b.solved);
}

function line(game, place, p) {
  const vars = { place: MEDALS[place] ?? `**${place + 1}.**`, user: `<@${p.id}>` };
  return game === 'dlbuild'
    ? text('leaderboard.dlRow', { ...vars, points: p.points, games: p.games })
    : text('leaderboard.lolRow', { ...vars, solved: p.solved, average: (p.guesses / p.solved).toFixed(1) });
}

async function execute(interaction) {
  await interaction.deferReply();
  const game = interaction.options.getString('game');
  const period = interaction.options.getString('period') ?? 'week';
  const list = scores(game, since(period, core.today(interaction.guildId)));

  const here = [];
  for (const p of list) {
    if (await isMember(interaction.guild, p.id)) here.push(p);
    if (here.length >= 10 && here.some(h => h.id === interaction.user.id)) break;
  }

  const lines = here.slice(0, 10).map((p, i) => line(game, i, p));
  const mine = here.findIndex(p => p.id === interaction.user.id);
  if (mine >= 10) lines.push('', text('leaderboard.you', { line: line(game, mine, here[mine]) }));

  const embed = new EmbedBuilder()
    .setColor(colors.leaderboard)
    .setTitle(text('leaderboard.title', { game, period: PERIODS[period] }))
    .setDescription(lines.length ? lines.join('\n') : text('leaderboard.empty', { game }))
    .setFooter({ text: text('leaderboard.footer') });
  await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
}

module.exports = { data, execute };
