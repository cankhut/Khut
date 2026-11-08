const { EmbedBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const DATA = require('../../data/lol-champions.json');
const { lolChampions, lolChampionDetail, championLabel, ddragon, fetchImage } = require('../assets');
const { text, result } = require('../settings');
const colors = require('../colors');
const png = require('../png');
const core = require('./core');
const log = require('../log');

const GAME = 'lolhero';
const MODES = { classic: { name: 'Classic' }, ability: { name: 'Ability' } };
const ATTRS = ['gender', 'positions', 'species', 'resource', 'range', 'regions', 'year'];
const KEYS = ['Passive', 'Q', 'W', 'E', 'R'];
const CLUE_AFTER = 6;
const COLOUR_AFTER = 3;
const UPRIGHT_AFTER = 6;
const SHOWN = 15;

const icons = new Map();

async function pool(mode) {
  return [...(await lolChampions()).values()].filter(c => mode !== 'classic' || DATA[c.key]).sort((a, b) => a.name.localeCompare(b.name));
}

async function build(mode, day) {
  const champ = core.shuffle(await pool(mode), GAME, mode, day)[0];
  return {
    key: Number(champ.key),
    id: champ.id,
    slot: core.seed(GAME, mode, 'slot', day) % 5,
    turns: 1 + (core.seed(GAME, mode, 'turns', day) % 3),
    clue: 1 + (core.seed(GAME, mode, 'clue', day) % 4)
  };
}

async function ability(p, slot = p.slot) {
  const c = await lolChampionDetail(p.id);
  return slot === 0
    ? { name: c.passive.name, url: ddragon(`img/passive/${c.passive.image.full}`) }
    : { name: c.spells[slot - 1].name, url: ddragon(`img/spell/${c.spells[slot - 1].image.full}`) };
}

async function abilityImage(url, wrong, turns) {
  if (!icons.has(url)) {
    const buffer = await fetchImage(url);
    if (!buffer) throw new Error(`Couldn't load ${url}`);
    icons.set(url, png.decode(buffer));
  }
  let image = icons.get(url);
  if (wrong < UPRIGHT_AFTER) image = png.rotate(image, turns);
  if (wrong < COLOUR_AFTER) image = png.grey(image);
  return png.encode(png.scale(image, 3));
}

function cell(guess, answer, attr) {
  if (attr === 'year') return guess === answer ? `🟩 ${guess}` : `🟥 ${guess} ${answer > guess ? '⬆️' : '⬇️'}`;
  const g = [].concat(guess);
  const a = [].concat(answer);
  const square = g.length === a.length && g.every(v => a.includes(v)) ? '🟩' : g.some(v => a.includes(v)) ? '🟧' : '🟥';
  return `${square} ${g.join(', ')}`;
}

function plural(count) {
  return count === 1 ? 'guess' : 'guesses';
}

async function renderClassic(p, state, mode, day) {
  const answer = DATA[p.key];
  const won = state.guesses.includes(p.key);
  const wrong = state.guesses.filter(k => k !== p.key).length;
  const rows = [];
  for (const key of [...state.guesses].reverse().slice(0, SHOWN)) {
    rows.push(`${await championLabel(key)}\n${ATTRS.map(a => cell(DATA[key][a], answer[a], a)).join(' · ')}`);
  }
  const intro = won ? text('play.solved', { name: await championLabel(p.key), count: state.guesses.length, guesses: plural(state.guesses.length) }) : `${text('play.classicIntro')}\n${text('play.lolHint', { mode: MODES[mode].name })}`;
  const embed = new EmbedBuilder()
    .setColor(colors.play)
    .setTitle('lolhero · Classic')
    .setDescription([intro, ...rows].join('\n\n'))
    .setFooter({ text: 'Gender · Position · Species · Resource · Range · Region · Release year' });
  if (won) embed.setThumbnail(ddragon(`img/champion/${p.id}.png`));
  else if (wrong >= CLUE_AFTER) {
    embed.addFields({ name: text('play.clue'), value: '​' }).setThumbnail((await ability(p, p.clue)).url);
  }
  return { embeds: [embed], components: won ? [] : [core.guessRow(`play:lol:${mode}:${day}:g`)], files: [], attachments: [] };
}

async function renderAbility(p, state, mode, day) {
  const won = state.guesses.includes(p.key);
  const wrong = state.guesses.filter(k => k !== p.key).length;
  const a = await ability(p);
  const image = await abilityImage(a.url, won ? UPRIGHT_AFTER : wrong, p.turns);
  const description = won
    ? `${text('play.solved', { name: await championLabel(p.key), count: state.guesses.length, guesses: plural(state.guesses.length) })}\n**${a.name}** (${KEYS[p.slot]})`
    : `${text('play.abilityIntro')}\n${text('play.lolHint', { mode: MODES[mode].name })}`;
  const embed = new EmbedBuilder()
    .setColor(colors.play)
    .setTitle('lolhero · Ability')
    .setDescription(description)
    .setImage('attachment://ability.png');
  const wrongs = [];
  for (const key of [...state.guesses].reverse().filter(k => k !== p.key).slice(0, 20)) wrongs.push(`❌ ${await championLabel(key)}`);
  if (wrongs.length) embed.addFields({ name: `Guesses (${wrong} wrong)`, value: wrongs.join('\n') });
  return { embeds: [embed], components: won ? [] : [core.guessRow(`play:lol:${mode}:${day}:g`)], files: [new AttachmentBuilder(image, { name: 'ability.png' })], attachments: [] };
}

function render(mode, day, p, state) {
  return mode === 'classic' ? renderClassic(p, state, mode, day) : renderAbility(p, state, mode, day);
}

async function guess(interaction, mode, day, p, state, done, input) {
  if (done) return text('play.finished', { time: `<t:${core.nextReset(interaction.guildId)}:R>` });
  const result = core.match(input, await pool(mode), c => c.name, c => c.key);
  if (!result.item) return core.matchMessage(result);
  const key = Number(result.item.key);
  if (state.guesses.includes(key)) return text('play.repeat', { name: result.item.name });
  state.guesses.push(key);
  const won = key === p.key;
  core.save(interaction.user.id, GAME, mode, day, state, won, interaction.guildId);
  log.info(`${interaction.user.tag} guessed in lolhero ${mode}${won ? ' (correct)' : ''}`);
  if (won) {
    await core.postResult(interaction, result('lolhero', state.guesses.length, { user: `<@${interaction.user.id}>`, mode: MODES[mode].name, count: state.guesses.length, guesses: plural(state.guesses.length) }));
  }
  return null;
}

async function play(interaction, mode, input) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const day = core.today(interaction.guildId);
  const p = await core.puzzle(GAME, mode, day, build).catch(err => log.error(`lolhero ${mode} ${day}:`, err));
  if (!p) return interaction.editReply(text('play.unavailable'));
  const saved = core.progress(interaction.user.id, GAME, mode, day);
  const state = saved?.state ?? { guesses: [] };
  const content = input ? await guess(interaction, mode, day, p, state, saved?.done, input) : null;
  await interaction.editReply({ content, ...(await render(mode, day, p, state)) });
  await core.replaceBoard(interaction, GAME, mode);
}

async function component(interaction, parts) {
  const [mode, day, action] = parts;
  if (day !== core.today(interaction.guildId)) return interaction.reply({ content: text('play.newDay'), flags: MessageFlags.Ephemeral });
  if (action === 'g') return interaction.showModal(core.guessModal(`play:lol:${mode}:${day}:m`, 'Champion'));
  const p = core.storedPuzzle(GAME, mode, day);
  if (!p) return interaction.reply({ content: text('play.unavailable'), flags: MessageFlags.Ephemeral });
  const saved = core.progress(interaction.user.id, GAME, mode, day);
  const state = saved?.state ?? { guesses: [] };
  const content = await guess(interaction, mode, day, p, state, saved?.done, interaction.fields.getTextInputValue('guess'));
  await interaction.update({ content, ...(await render(mode, day, p, state)) });
}

async function autocomplete(interaction, mode) {
  const typed = core.normalize(interaction.options.getFocused());
  const day = core.today(interaction.guildId);
  const guessed = new Set(core.progress(interaction.user.id, GAME, mode, day)?.state.guesses ?? []);
  const list = (await pool(mode)).filter(c => !guessed.has(Number(c.key)) && core.normalize(c.name).includes(typed));
  list.sort((a, b) => core.normalize(b.name).startsWith(typed) - core.normalize(a.name).startsWith(typed));
  await interaction.respond(list.slice(0, 25).map(c => ({ name: c.name, value: c.key })));
}

async function answer(mode, day) {
  const p = await core.puzzle(GAME, mode, day, build);
  const label = await championLabel(p.key);
  if (mode === 'classic') return label;
  const a = await ability(p);
  return `${label} · ${a.name} (${KEYS[p.slot]})`;
}

module.exports = { GAME, MODES, play, component, autocomplete, answer, build, cell };
