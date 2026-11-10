const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, LabelBuilder, MessageFlags } = require('discord.js');
const { getJson } = require('../api');
const { emoji, deadlockHeroes, deadlockItems, playableHeroes } = require('../assets');
const { text, resultText } = require('../settings');
const colors = require('../colors');
const core = require('./core');
const log = require('../log');

const GAME = 'dlbuild';
const STAGES = [360, 720, 1200, 1500];
const GUESSES = 5;
const ROUNDS = 4;
const SCORE = [25, 18, 15, 12, 10];
const MODES = { high: { name: 'High rank', badge: 101 }, all: { name: 'All ranks', badge: 1 } };
const TEAMS = ['🟠 Hidden King', '🔵 Archmother'];
const NUMBERS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];

let ranks;

async function rankList() {
  if (!ranks) ranks = Object.fromEntries((await getJson('https://api.deadlock-api.com/v1/assets/ranks')).map(r => [r.tier, r]));
  return ranks;
}

async function rankName(badge) {
  const list = await rankList();
  if (!badge) return 'Unranked';
  return `${emoji(`rank_${Math.floor(badge / 10)}_${badge % 10}`)} ${list[Math.floor(badge / 10)]?.name ?? 'Rank'} ${badge % 10}`.trim();
}

function averageBadge(badges) {
  const valid = badges.filter(b => b > 0).map(b => (Math.floor(b / 10) - 1) * 6 + (b % 10) - 1);
  if (!valid.length) return 0;
  const avg = Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
  return (Math.floor(avg / 6) + 1) * 10 + (avg % 6) + 1;
}

async function build(mode, day) {
  const start = Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000) - 2 * 86400;
  const query = new URLSearchParams({
    include_info: 'true',
    game_mode: 'normal',
    match_mode: 'ranked',
    min_unix_timestamp: start,
    max_unix_timestamp: start + 86400,
    min_duration_s: 1800,
    min_average_badge: MODES[mode].badge,
    limit: 100,
    order_by: 'match_id',
    order_direction: 'desc'
  });
  const list = await getJson(`https://api.deadlock-api.com/v1/matches/metadata?${query}`);
  const shop = await deadlockItems();

  for (const row of core.shuffle(list, GAME, mode, day).slice(0, 6)) {
    const m = (await getJson(`https://api.deadlock-api.com/v1/matches/${row.match_id}/metadata`).catch(() => null))?.match_info;
    if (!m || m.players?.length !== 12) continue;
    const players = [...m.players]
      .sort((a, b) => a.team - b.team || a.assigned_lane - b.assigned_lane || a.player_slot - b.player_slot)
      .map(p => ({
        hero: p.hero_id,
        team: p.team,
        lane: p.assigned_lane,
        souls: [...STAGES, m.duration_s].map(t => p.stats.filter(s => s.time_stamp_s <= t).pop()?.net_worth ?? 0),
        items: p.items.filter(i => shop.has(i.item_id)).map(i => [i.item_id, i.game_time_s, i.sold_time_s])
      }));
    if (players.some(p => !p.items.length)) continue;
    return {
      matchId: row.match_id,
      played: String(row.start_time).slice(0, 10),
      duration: m.duration_s,
      teams: [0, 1].map(t => averageBadge(m.players.filter(p => p.team === t).map(p => p.player_rank_data?.initial_display_rank ?? 0))),
      players,
      targets: core.shuffle(players.map((_, i) => i), GAME, 'targets', mode, day).slice(0, ROUNDS)
    };
  }
  throw new Error(`No usable Deadlock match for ${mode} ${day}`);
}

function clock(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function souls(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function roundInfo(p, state, i) {
  const r = state.rounds[i];
  const hero = p.players[p.targets[i]].hero;
  const won = r.guesses.includes(hero);
  return { r, hero, won, over: won || r.guesses.length >= GUESSES, points: won ? SCORE[r.guesses.length - 1] : 0 };
}

function gridText(p, state) {
  return state.rounds.map((_, i) => {
    const { r, hero } = roundInfo(p, state, i);
    const squares = r.guesses.map(g => (g === hero ? '🟩' : '🟥'));
    return `${NUMBERS[i]} ${[...squares, ...Array(GUESSES - squares.length).fill('⬛')].join('')}`;
  }).join('\n');
}

function total(p, state) {
  return state.rounds.reduce((sum, _, i) => sum + roundInfo(p, state, i).points, 0);
}

async function render(p, state, mode, day, guildId, view, notice) {
  const heroes = await deadlockHeroes();
  const items = await deadlockItems();
  const heroName = id => `${emoji(`dl_${id}`)} ${heroes.get(id)?.name ?? 'Hero'}`.trim();
  const { r, hero, over } = roundInfo(p, state, state.round);
  const stage = over ? 4 : Math.min(r.guesses.length, 4);
  const shown = view == null ? stage : Math.min(view, stage);
  const time = shown === 4 ? p.duration : STAGES[shown];
  const target = p.targets[state.round];
  const revealed = new Set(p.targets.slice(0, state.round + (over ? 1 : 0)));
  const owned = p.players[target].items.filter(([, buy, sold]) => buy <= time && (!sold || sold > time));

  const teamField = async team => {
    const lines = p.players.map((pl, i) => [pl, i]).filter(([pl]) => pl.team === team).map(([pl, i]) => {
      const face = revealed.has(i) ? emoji(`dl_${pl.hero}`) || '🦸' : '👤';
      return i === target ? `➡️ ${face} **${souls(pl.souls[shown])}**` : `${face} ${souls(pl.souls[shown])}`;
    });
    return { name: TEAMS[team], value: [await rankName(p.teams[team]), ...lines].join('\n'), inline: true };
  };
  const teamSouls = team => souls(p.players.filter(pl => pl.team === team).reduce((sum, pl) => sum + pl.souls[shown], 0));

  const slots = Math.max(12, Math.ceil(owned.length / 6) * 6);
  const icons = Array.from({ length: slots }, (_, n) => (owned[n] ? emoji(`di_${owned[n][0]}`) || '🟫' : '⬛'));
  const grid = [];
  for (let n = 0; n < slots; n += 6) grid.push(icons.slice(n, n + 6).join(' '));
  const names = owned.map(([id]) => items.get(id)?.name ?? 'Item').join(' · ');

  const description = [];
  if (notice) description.push(notice, '');
  if (!over) description.push(text('play.dlHint'));
  if (state.done) description.push(text('play.dlDone', { points: total(p, state), time: `<t:${core.nextReset(guildId)}:R>` }), gridText(p, state));

  const embed = new EmbedBuilder()
    .setColor(colors.play)
    .setTitle(`dlbuild · ${MODES[mode].name} · Round ${state.round + 1}/${ROUNDS}`)
    .addFields(
      await teamField(0),
      { name: '​', value: `🟠 **${teamSouls(0)}**\n🕘 **${clock(time)}**\n🔵 **${teamSouls(1)}**`, inline: true },
      await teamField(1),
      { name: `🛒 Items at ${clock(time)}`, value: `${grid.join('\n')}${names ? `\n${names}` : ''}` }
    )
    .setFooter({ text: `Match played ${p.played} · Data from deadlock-api.com` });
  if (description.length) embed.setDescription(description.join('\n'));
  if (r.guesses.length) {
    embed.addFields({ name: 'Guesses', value: r.guesses.map(g => `${g === hero ? '✅' : '❌'} ${heroName(g)}`).join('\n') + (over ? '' : `\n${GUESSES - r.guesses.length} left`) });
  }

  const rows = [];
  if (stage > 0) {
    rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
      .setCustomId(`play:dl:${mode}:${day}:${state.round}:${r.guesses.length}:t`)
      .setPlaceholder('Look at an earlier time')
      .addOptions(Array.from({ length: stage + 1 }, (_, i) => ({ label: clock(i === 4 ? p.duration : STAGES[i]), value: String(i), default: i === shown })))));
  }
  if (!state.done) rows.push(core.guessRow(`play:dl:${mode}:${day}:g`));
  return { embeds: [embed], components: rows, files: [], attachments: [] };
}

function newState() {
  return { round: 0, rounds: [{ guesses: [] }], done: false };
}

async function load(mode, day) {
  return core.puzzle(GAME, mode, day, build);
}

function usedHeroes(p, state) {
  return new Set([...state.rounds[state.round].guesses, ...p.targets.slice(0, state.round).map(i => p.players[i].hero)]);
}

async function guess(interaction, mode, day, p, state, done, input) {
  if (done) return { content: text('play.finished', { time: `<t:${core.nextReset(interaction.guildId)}:R>` }) };
  const result = core.match(input, await playableHeroes(), h => h.name, h => h.id);
  if (!result.item) return { content: core.matchMessage(result) };
  const hero = result.item;
  if (usedHeroes(p, state).has(hero.id)) return { content: text('play.repeat', { name: hero.name }) };

  state.rounds[state.round].guesses.push(hero.id);
  const after = roundInfo(p, state, state.round);
  let notice;
  if (after.over) {
    const name = `${emoji(`dl_${after.hero}`)} ${(await deadlockHeroes()).get(after.hero)?.name ?? 'Hero'}`.trim();
    notice = text(after.won ? 'play.dlCorrect' : 'play.dlWrong', { hero: name, points: after.points });
    if (state.round === ROUNDS - 1) state.done = true;
    else {
      state.round++;
      state.rounds.push({ guesses: [] });
    }
  }
  core.save(interaction.user.id, GAME, mode, day, state, state.done, interaction.guildId);
  log.info(`${interaction.user.tag} guessed in dlbuild ${mode} round ${state.round + 1}${after.won ? ' (correct)' : ''}`);
  if (state.done) {
    await core.postResult(interaction, core.streak(interaction.user.id, GAME, mode, day) + resultText('dlbuild', total(p, state), { user: `<@${interaction.user.id}>`, mode: MODES[mode].name, points: total(p, state), grid: gridText(p, state) }));
  }
  return { notice };
}

async function heroModal(id, used) {
  const options = (await playableHeroes()).filter(h => !used.has(h.id));
  const size = Math.ceil(options.length / Math.ceil(options.length / 25));
  const modal = new ModalBuilder().setCustomId(id).setTitle(text('play.guessButton'));
  for (let i = 0, n = 0; i < options.length; i += size, n++) {
    const part = options.slice(i, i + size);
    modal.addLabelComponents(new LabelBuilder()
      .setLabel(part[0].name[0] === part[part.length - 1].name[0] ? part[0].name[0] : `${part[0].name[0]}–${part[part.length - 1].name[0]}`)
      .setStringSelectMenuComponent(new StringSelectMenuBuilder()
        .setCustomId(`h${n}`)
        .setPlaceholder(text('play.pickHero'))
        .setRequired(false)
        .setMinValues(0)
        .setMaxValues(1)
        .addOptions(part.map(h => {
          const icon = core.parseEmoji(emoji(`dl_${h.id}`));
          return { label: h.name, value: String(h.id), ...(icon ? { emoji: icon } : {}) };
        }))));
  }
  return modal;
}

async function play(interaction, mode, input) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const day = core.today(interaction.guildId);
  const p = await load(mode, day).catch(err => log.error(`dlbuild ${mode} ${day}:`, err));
  if (!p) return interaction.editReply(text('play.unavailable'));
  const saved = core.progress(interaction.user.id, GAME, mode, day);
  const state = saved?.state ?? newState();
  const result = input ? await guess(interaction, mode, day, p, state, saved?.done, input) : {};
  await interaction.editReply({ content: result.content ?? null, ...(await render(p, state, mode, day, interaction.guildId, null, result.notice)) });
  await core.replaceBoard(interaction, GAME, mode);
}

async function component(interaction, parts) {
  const [mode, day] = parts;
  const action = parts[parts.length - 1];
  if (day !== core.today(interaction.guildId)) return interaction.reply({ content: text('play.newDay'), flags: MessageFlags.Ephemeral });
  const p = core.storedPuzzle(GAME, mode, day);
  if (!p) return interaction.reply({ content: text('play.unavailable'), flags: MessageFlags.Ephemeral });
  const saved = core.progress(interaction.user.id, GAME, mode, day);
  const state = saved?.state ?? newState();
  if (action === 'g') return interaction.showModal(await heroModal(`play:dl:${mode}:${day}:m`, usedHeroes(p, state)));
  if (action === 'm') {
    const picked = [0, 1, 2, 3, 4].flatMap(n => {
      try {
        return interaction.fields.getStringSelectValues(`h${n}`);
      } catch {
        return [];
      }
    });
    if (picked.length !== 1) return interaction.update({ content: text('play.pickOne'), ...(await render(p, state, mode, day, interaction.guildId)) });
    const result = await guess(interaction, mode, day, p, state, saved?.done, picked[0]);
    return interaction.update({ content: result.content ?? null, ...(await render(p, state, mode, day, interaction.guildId, null, result.notice)) });
  }

  const [, , round, count] = parts;
  const fresh = Number(round) === state.round && Number(count) === state.rounds[state.round].guesses.length;
  await interaction.update({ content: null, ...(await render(p, state, mode, day, interaction.guildId, fresh ? Number(interaction.values[0]) : null)) });
}

async function autocomplete(interaction, mode) {
  const typed = core.normalize(interaction.options.getFocused());
  const day = core.today(interaction.guildId);
  const p = core.storedPuzzle(GAME, mode, day);
  const state = core.progress(interaction.user.id, GAME, mode, day)?.state;
  const used = p && state ? usedHeroes(p, state) : new Set();
  const list = (await playableHeroes()).filter(h => !used.has(h.id) && core.normalize(h.name).includes(typed));
  list.sort((a, b) => core.normalize(b.name).startsWith(typed) - core.normalize(a.name).startsWith(typed));
  await interaction.respond(list.slice(0, 25).map(h => ({ name: h.name, value: String(h.id) })));
}

async function answer(mode, day) {
  const p = core.storedPuzzle(GAME, mode, day);
  if (!p) return null;
  const heroes = await deadlockHeroes();
  return p.targets.map((i, n) => `${NUMBERS[n]} ${emoji(`dl_${p.players[i].hero}`)} ${heroes.get(p.players[i].hero)?.name ?? 'Hero'}`).join('\n');
}

module.exports = { GAME, MODES, play, component, autocomplete, answer, build };
