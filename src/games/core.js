const crypto = require('node:crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle, Routes } = require('discord.js');
const { text } = require('../settings');
const { db, guildSettings } = require('../db');
const { dayKey, parts, localToUtc } = require('../time');
const log = require('../log');

const building = new Map();
const boards = new Map();

function today(guildId) {
  return dayKey(guildSettings(guildId).timezone);
}

function previousDay(day) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function nextReset(guildId) {
  const tz = guildSettings(guildId).timezone;
  const p = parts(tz);
  return Math.floor(localToUtc(tz, p.year, p.month, p.day + 1) / 1000);
}

function seed(...key) {
  return crypto.createHash('sha256').update(key.join(':')).digest().readUInt32BE(0);
}

function shuffle(list, ...key) {
  return list.map((value, i) => [seed(...key, i), value]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
}

function storedPuzzle(game, mode, day) {
  const row = db.prepare('SELECT data FROM play_puzzles WHERE game = ? AND mode = ? AND day = ?').get(game, mode, day);
  return row ? JSON.parse(row.data) : null;
}

async function puzzle(game, mode, day, build) {
  const stored = storedPuzzle(game, mode, day);
  if (stored) return stored;
  const key = `${game}:${mode}:${day}`;
  if (!building.has(key)) {
    building.set(key, build(mode, day).then(data => {
      db.prepare('INSERT OR IGNORE INTO play_puzzles VALUES (?, ?, ?, ?)').run(game, mode, day, JSON.stringify(data));
      log.info(`Puzzle ready: ${key}`);
    }).finally(() => building.delete(key)));
  }
  await building.get(key);
  return storedPuzzle(game, mode, day);
}

function progress(userId, game, mode, day) {
  const row = db.prepare('SELECT state, done FROM play_progress WHERE user_id = ? AND game = ? AND mode = ? AND day = ?').get(userId, game, mode, day);
  return row ? { state: JSON.parse(row.state), done: !!row.done } : null;
}

function save(userId, game, mode, day, state, done, guildId) {
  db.prepare(`
    INSERT INTO play_progress VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, game, mode, day) DO UPDATE SET state = excluded.state, done = excluded.done, guild_id = excluded.guild_id
  `).run(userId, game, mode, day, JSON.stringify(state), done ? 1 : 0, guildId);
}

function finishedCount(guildId, game, mode, day) {
  return db.prepare('SELECT COUNT(*) AS n FROM play_progress WHERE guild_id = ? AND game = ? AND mode = ? AND day = ? AND done = 1').get(guildId, game, mode, day).n;
}

function streak(userId, game, mode, day) {
  const done = db.prepare('SELECT done FROM play_progress WHERE user_id = ? AND game = ? AND mode = ? AND day = ?');
  let days = 0;
  while (done.get(userId, game, mode, day)?.done) {
    days++;
    day = previousDay(day);
  }
  return days >= 2 ? `${text('play.streak', { days })} ` : '';
}

async function postResult(interaction, content) {
  await interaction.channel?.send({ content, allowedMentions: { parse: [] } }).catch(err => log.debug(`Couldn't post a game result: ${err.message}`));
}

function normalize(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = next;
    }
  }
  return row[b.length];
}

function match(input, list, name, id) {
  const n = normalize(input);
  if (!n) return { suggestions: [] };
  const exact = list.find(x => String(id(x)) === String(input) || normalize(name(x)) === n);
  if (exact) return { item: exact };
  for (const test of [x => normalize(name(x)).startsWith(n), x => normalize(name(x)).includes(n)]) {
    const found = list.filter(test);
    if (found.length === 1) return { item: found[0] };
    if (found.length > 1) return { suggestions: found.slice(0, 5).map(name) };
  }
  const close = list.map(x => [x, distance(n, normalize(name(x)))]).filter(([, d]) => d <= 2).sort((a, b) => a[1] - b[1]);
  if (close.length && (close.length === 1 || close[0][1] < close[1][1])) return { item: close[0][0] };
  return { suggestions: close.slice(0, 5).map(([x]) => name(x)) };
}

function matchMessage(result) {
  return result.suggestions.length ? text('play.didYouMean', { names: result.suggestions.map(s => `**${s}**`).join(', ') }) : text('play.unknown');
}

function guessRow(id) {
  return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(id).setLabel(text('play.guessButton')).setEmoji('✏️').setStyle(ButtonStyle.Primary));
}

function guessModal(id, label) {
  return new ModalBuilder().setCustomId(id).setTitle(text('play.guessButton')).addLabelComponents(new LabelBuilder()
    .setLabel(label)
    .setTextInputComponent(new TextInputBuilder().setCustomId('guess').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(40)));
}

async function replaceBoard(interaction, game, mode) {
  const key = `${interaction.user.id}:${game}:${mode}`;
  const previous = boards.get(key);
  boards.set(key, { token: interaction.token, at: Date.now() });
  if (previous && Date.now() - previous.at < 14 * 60000) {
    await interaction.client.rest.delete(Routes.webhookMessage(interaction.applicationId, previous.token)).catch(() => {});
  }
}

function parseEmoji(value) {
  const m = value?.match(/<a?:(\w+):(\d+)>/);
  return m ? { name: m[1], id: m[2] } : undefined;
}

module.exports = { today, previousDay, nextReset, seed, shuffle, storedPuzzle, puzzle, progress, save, finishedCount, streak, postResult, parseEmoji, normalize, match, matchMessage, guessRow, guessModal, replaceBoard };
