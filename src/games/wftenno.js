const { EmbedBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const DATA = require('../../data/warframes.json');
const { warframeLabel, warframeIcon, warframeImage, fetchImage } = require('../assets');
const { text, resultText, streakText } = require('../settings');
const colors = require('../colors');
const png = require('../png');
const core = require('./core');
const log = require('../log');

const GAME = 'wftenno';
const MODES = { classic: { name: 'Classic' }, ability: { name: 'Ability' } };
const ATTRS = ['sex', 'playstyle', 'progenitor', 'aura', 'year', 'armor'];
const NUMBERS = ['year', 'armor'];
const CLUE_AFTER = 6;
const COLOUR_AFTER = 3;
const UPRIGHT_AFTER = 6;
const SHOWN = 15;
const BACKDROP = [30, 31, 34];
const POOL = Object.keys(DATA).sort((a, b) => a.localeCompare(b));

const icons = new Map();

async function build(mode, day) {
  const name = core.shuffle(POOL, GAME, mode, day)[0];
  const count = DATA[name].abilities.length;
  return {
    name,
    slot: core.seed(GAME, mode, 'slot', day) % count,
    turns: 1 + (core.seed(GAME, mode, 'turns', day) % 3),
    clue: core.seed(GAME, mode, 'clue', day) % count
  };
}

function ability(p, slot = p.slot) {
  const [name, file] = DATA[p.name].abilities[slot];
  return { name, url: warframeImage(file) };
}

async function abilityImage(url, wrong, turns) {
  if (!icons.has(url)) {
    const buffer = await fetchImage(url);
    if (!buffer) throw new Error(`Couldn't load ${url}`);
    icons.set(url, png.backdrop(png.decode(buffer), BACKDROP));
  }
  let image = icons.get(url);
  if (wrong < UPRIGHT_AFTER) image = png.rotate(image, turns);
  if (wrong < COLOUR_AFTER) image = png.grey(image);
  return png.encode(png.scale(image, 2));
}

function cell(guess, answer, attr) {
  if (NUMBERS.includes(attr)) return guess === answer ? `🟩 ${guess}` : `🟥 ${guess} ${answer > guess ? '⬆️' : '⬇️'}`;
  const g = [].concat(guess);
  const a = [].concat(answer);
  const square = g.length === a.length && g.every(v => a.includes(v)) ? '🟩' : g.some(v => a.includes(v)) ? '🟧' : '🟥';
  return `${square} ${g.map(v => (attr === 'progenitor' ? `${warframeIcon(v)} ${v}`.trim() : v)).join(', ')}`;
}

function plural(count) {
  return count === 1 ? 'guess' : 'guesses';
}

function solved(p, state) {
  return text('play.solved', { name: warframeLabel(p.name), count: state.guesses.length, guesses: plural(state.guesses.length) });
}

function renderClassic(p, state, mode, day) {
  const answer = DATA[p.name];
  const won = state.guesses.includes(p.name);
  const wrong = state.guesses.filter(n => n !== p.name).length;
  const rows = [...state.guesses].reverse().slice(0, SHOWN).map(n => `${warframeLabel(n)}\n${ATTRS.map(a => cell(DATA[n][a], answer[a], a)).join(' · ')}`);
  const intro = won ? solved(p, state) : `${text('play.wfClassicIntro')}\n${text('play.wfHint')}`;
  const embed = new EmbedBuilder()
    .setColor(colors.play)
    .setTitle('wftenno · Classic')
    .setDescription([intro, ...rows].join('\n\n'))
    .setFooter({ text: 'Sex · Playstyle · Progenitor · Aura polarity · Release year · Armor' });
  if (won) embed.setThumbnail(warframeImage(answer.portrait));
  else if (wrong >= CLUE_AFTER) embed.addFields({ name: text('play.wfClue'), value: '​' }).setThumbnail(ability(p, p.clue).url);
  return { embeds: [embed], components: won ? [] : [core.guessRow(`play:wf:${mode}:${day}:g`)], files: [], attachments: [] };
}

async function renderAbility(p, state, mode, day) {
  const won = state.guesses.includes(p.name);
  const wrong = state.guesses.filter(n => n !== p.name).length;
  const a = ability(p);
  const image = await abilityImage(a.url, won ? UPRIGHT_AFTER : wrong, p.turns);
  const description = won ? `${solved(p, state)}\n**${a.name}** (${p.slot + 1})` : `${text('play.wfAbilityIntro')}\n${text('play.wfHint')}`;
  const embed = new EmbedBuilder()
    .setColor(colors.play)
    .setTitle('wftenno · Ability')
    .setDescription(description)
    .setImage('attachment://ability.png');
  const wrongs = [...state.guesses].reverse().filter(n => n !== p.name).slice(0, 20).map(n => `❌ ${warframeLabel(n)}`);
  if (wrongs.length) embed.addFields({ name: `Guesses (${wrong} wrong)`, value: wrongs.join('\n') });
  return { embeds: [embed], components: won ? [] : [core.guessRow(`play:wf:${mode}:${day}:g`)], files: [new AttachmentBuilder(image, { name: 'ability.png' })], attachments: [] };
}

async function render(mode, day, p, state) {
  return mode === 'classic' ? renderClassic(p, state, mode, day) : renderAbility(p, state, mode, day);
}

async function guess(interaction, mode, day, p, state, done, input) {
  if (done) return text('play.finished', { time: `<t:${core.nextReset(interaction.guildId)}:R>` });
  const result = core.match(input, POOL, n => n, n => n);
  if (!result.item) return core.matchMessage(result);
  const name = result.item;
  if (state.guesses.includes(name)) return text('play.repeat', { name });
  state.guesses.push(name);
  const won = name === p.name;
  core.save(interaction.user.id, GAME, mode, day, state, won, interaction.guildId);
  log.info(`${interaction.user.tag} guessed in wftenno ${mode}${won ? ' (correct)' : ''}`);
  if (won) {
    await core.postResult(interaction, streakText(core.streak(interaction.user.id, GAME, mode, day), resultText('wftenno', state.guesses.length, { user: `<@${interaction.user.id}>`, mode: MODES[mode].name, count: state.guesses.length, guesses: plural(state.guesses.length) })));
  }
  return null;
}

async function play(interaction, mode, input) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const day = core.today(interaction.guildId);
  const p = await core.puzzle(GAME, mode, day, build).catch(err => log.error(`wftenno ${mode} ${day}:`, err));
  if (!p) return interaction.editReply(text('play.unavailable'));
  const saved = core.progress(interaction.user.id, GAME, mode, day);
  const state = saved?.state ?? { guesses: [] };
  const content = input ? await guess(interaction, mode, day, p, state, saved?.done, input) : null;
  const board = await render(mode, day, p, state).catch(err => log.error(`wftenno ${mode} ${day}:`, err));
  if (!board) return interaction.editReply(text('play.unavailable'));
  await interaction.editReply({ content, ...board });
  await core.replaceBoard(interaction, GAME, mode);
}

async function component(interaction, parts) {
  const [mode, day, action] = parts;
  if (day !== core.today(interaction.guildId)) return interaction.reply({ content: text('play.newDay'), flags: MessageFlags.Ephemeral });
  if (action === 'g') return interaction.showModal(core.guessModal(`play:wf:${mode}:${day}:m`, 'Warframe'));
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
  const list = POOL.filter(n => !guessed.has(n) && core.normalize(n).includes(typed));
  list.sort((a, b) => core.normalize(b).startsWith(typed) - core.normalize(a).startsWith(typed));
  await interaction.respond(list.slice(0, 25).map(n => ({ name: n, value: n })));
}

async function answer(mode, day) {
  const p = await core.puzzle(GAME, mode, day, build);
  const label = warframeLabel(p.name);
  return mode === 'classic' ? label : `${label} · ${ability(p).name} (${p.slot + 1})`;
}

module.exports = { GAME, MODES, play, component, autocomplete, answer, build, cell };
