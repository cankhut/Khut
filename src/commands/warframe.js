const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getJson } = require('../api');
const { warframeIcon } = require('../assets');
const { text } = require('../settings');
const colors = require('../colors');
const log = require('../log');

const WORLD_STATE = 'https://api.warframe.com/cdn/worldState.php';
const BOUNTIES = 'https://oracle.browse.wf/bounty-cycle';
const ARBITRATIONS = 'https://browse.wf/arbys.txt';
const ARBITRATION_TIERS = 'https://browse.wf/supplemental-data/arbyTiers.js';
const DATA = 'https://cdn.jsdelivr.net/npm/warframe-worldstate-data@3/data/';
const FILES = { nodes: 'solNodes.json', sortie: 'sortieData.json', missions: 'missionTypes.json', steelPath: 'steelPath.json', languages: 'languages.json' };
const ICONS = { day: '☀️', night: '🌙', warm: ['heat', '🔥'], cold: ['cold', '❄️'], fass: ['fass'], vome: ['vome'], corpus: ['corpus'], grineer: ['grineer'] };
const TITLES = { cetus: ['ostron', '🌄'], vallis: ['corpus', '🏔️'], cambion: ['infested', '🪱'], zariman: ['voidplume', '🚀'], duviri: ['duviri', '🌀'], steelPath: ['steel_essence', '⚔️'], archon: ['narmer', '👹'], sortie: ['sortie', '🎯'], baro: ['ducats', '🛒'], darvo: ['platinum', '💰'], arbitration: ['arbitration', '⚖️'] };
const FACTIONS = { corrupted: 'orokin', infestation: 'infested', 'the murmur': 'murmur' };
const DUVIRI = ['sorrow', 'fear', 'joy', 'anger', 'envy'];
const MINUTE = 60000;

const data = new SlashCommandBuilder()
  .setName('warframe')
  .setDescription('Warframe info')
  .addSubcommand(s => s.setName('cycle').setDescription('Open world cycles, missions, Baro, Darvo and news'));

let world = { at: 0 };
let tables = { at: 0 };

async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Khut Discord bot (https://github.com/cankhut/Khut)' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

async function worldState() {
  if (Date.now() - world.at > MINUTE) {
    const [data, bounties] = await Promise.all([getJson(WORLD_STATE), getJson(BOUNTIES).catch(() => null)]);
    world = { at: Date.now(), data: { ...data, bounties } };
  }
  return world.data;
}

async function lookups() {
  if (Date.now() - tables.at > 86400000) {
    const entries = await Promise.all(Object.entries(FILES).map(async ([key, file]) => [key, await getJson(DATA + file)]));
    const [schedule, tiers] = await Promise.all([getText(ARBITRATIONS), getText(ARBITRATION_TIERS)].map(p => p.catch(() => '')));
    tables = {
      at: schedule ? Date.now() : 0,
      ...Object.fromEntries(entries),
      arbitrations: new Map(schedule.trim().split('\n').map(line => line.split(',')).map(([hour, id]) => [Number(hour), id?.trim()])),
      tiers: Object.fromEntries([...tiers.matchAll(/(\w+): "(\w)"/g)].map(m => [m[1], m[2]]))
    };
  }
  return tables;
}

function date(value) {
  return Number(value?.$date?.$numberLong ?? value?.$date ?? 0);
}

function time(ms) {
  return `<t:${Math.floor(ms / 1000)}:R>`;
}

function ends(ms) {
  return text('warframe.ends', { time: time(ms) });
}

function title(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function icon(entry) {
  if (!entry) return '';
  if (typeof entry === 'string') return entry;
  return warframeIcon(entry[0]) || entry[1] || '';
}

function faction(name) {
  if (!name) return '';
  return `${warframeIcon(FACTIONS[name.toLowerCase()] ?? name)} ${name}`.trim();
}

function heading(key) {
  return `${icon(TITLES[key])} ${text(`warframe.${key}`)}`.trim();
}

function cycle(state, expiry) {
  return `${icon(ICONS[state])} **${title(state)}**\n${ends(expiry)}`.trim();
}

function bounty(w, tag) {
  return date(w.SyndicateMissions?.find(s => s.Tag === tag)?.Expiry);
}

function cetus(w, now, day, night) {
  const end = Math.floor(bounty(w, 'CetusSyndicate') / MINUTE) * MINUTE;
  if (!end) return '-';
  return end - now > 50 * MINUTE ? cycle(day, end - 50 * MINUTE) : cycle(night, end);
}

function zariman(w) {
  const b = w.bounties;
  if (!b?.zarimanFaction) return '-';
  return cycle(b.zarimanFaction === 'FC_GRINEER' ? 'grineer' : 'corpus', Math.floor(b.expiry / MINUTE) * MINUTE);
}

function vallis(now) {
  const toFull = 1600000 - ((now - Date.parse('2026-02-04T19:46:48Z')) % 1600000);
  return toFull > 1200000 ? cycle('warm', now + toFull - 1200000) : cycle('cold', now + toFull);
}

function duviri(now) {
  const delta = (Math.floor(now / 1000) - 52) % 36000;
  return cycle(DUVIRI[Math.floor(delta / 7200)], now + (7200 - (delta % 7200)) * 1000);
}

function steelPath(t, now) {
  const reward = t.steelPath.rotation[Math.floor((((now - Date.UTC(2020, 10, 16)) / 1000) % 4838400) / 604800)];
  const monday = new Date(now);
  monday.setUTCHours(0, 0, 0, 0);
  monday.setUTCDate(monday.getUTCDate() + 7 - ((monday.getUTCDay() + 6) % 7));
  return `**${reward.name}**\n${reward.cost} ${icon(['steel_essence'])} Steel Essence\n${ends(monday.getTime())}`.replace('  ', ' ');
}

function node(t, id) {
  return t.nodes[id]?.value ?? id;
}

function mission(t, type) {
  return t.missions[type]?.value ?? type;
}

function boss(t, id) {
  const b = t.sortie.bosses[id];
  return b ? `${warframeIcon(FACTIONS[b.faction?.toLowerCase()] ?? b.faction ?? '')} **${b.name}**`.trim() : `**${id}**`;
}

function archon(t, a) {
  if (!a) return '-';
  return [`**${t.sortie.bosses[a.Boss]?.name ?? a.Boss}**`, ...a.Missions.map(m => `${mission(t, m.missionType)} · ${node(t, m.node)}`), ends(date(a.Expiry))].join('\n');
}

function sortie(t, s) {
  if (!s) return '-';
  return [boss(t, s.Boss), ...s.Variants.map(v => `${mission(t, v.missionType)} · ${node(t, v.node)}\n-# ${t.sortie.modifierTypes[v.modifierType] ?? v.modifierType}`), ends(date(s.Expiry))].join('\n');
}

function baro(t, b, now) {
  if (!b) return '-';
  return date(b.Activation) <= now
    ? `${text('warframe.baroHere', { time: time(date(b.Expiry)) })}\n${node(t, b.Node)}\n${text('warframe.baroItems', { count: b.Manifest?.length ?? 0 })}`
    : `${text('warframe.baroComing', { time: time(date(b.Activation)) })}\n${node(t, b.Node)}`;
}

function arbitration(t, now) {
  const hour = Math.floor(now / 3600000) * 3600;
  const id = t.arbitrations.get(hour);
  const n = t.nodes[id];
  if (!n) return '-';
  return `**${n.type}**${n.enemy ? ` · ${faction(n.enemy)}` : ''}\n${n.value}${t.tiers[id] ? ` · ${text('warframe.tier', { tier: t.tiers[id] })}` : ''}\n${ends((hour + 3600) * 1000)}`;
}

function language(t, key) {
  return t.languages[key.toLowerCase()]?.value ?? key.split('/').pop();
}

function darvo(t, d) {
  if (!d) return '-';
  return `**${language(t, d.StoreItem)}**\n~~${d.OriginalPrice}~~ **${d.SalePrice}** ${icon(['platinum', '']) || 'platinum'} (-${d.Discount}%)\n${d.AmountSold}/${d.AmountTotal} sold\n${ends(date(d.Expiry))}`;
}

function news(t, events) {
  const latest = (events ?? [])
    .map(e => ({ message: e.Messages?.find(m => m.LanguageCode === 'en')?.Message, link: e.Prop || e.Links?.find(l => l.LanguageCode === 'en')?.Link, date: date(e.Date) }))
    .filter(n => n.message && n.link && n.date)
    .sort((a, b) => b.date - a.date)
    .slice(0, 5);
  const lines = latest.map(n => {
    const message = n.message.startsWith('/Lotus/') ? language(t, n.message) : n.message;
    const link = /^https?:\/\//.test(n.link) ? n.link : `https://${n.link}`;
    return `[${message.trim().replace(/[[\]]/g, '')}](${link.split('?')[0]}) · ${time(n.date)}`;
  });
  while (lines.join('\n').length > 1024) lines.pop();
  return lines.join('\n') || '-';
}

async function execute(interaction) {
  await interaction.deferReply();
  const [w, t] = await Promise.all([worldState(), lookups()]).catch(err => log.warn(`Warframe world state: ${err.message}`)) ?? [];
  if (!w || !t) return interaction.editReply(text('warframe.unavailable'));
  const now = Date.now();
  const embed = new EmbedBuilder()
    .setColor(colors.warframe)
    .setTitle(text('warframe.title'))
    .addFields(
      { name: heading('cetus'), value: cetus(w, now, 'day', 'night'), inline: true },
      { name: heading('vallis'), value: vallis(now), inline: true },
      { name: heading('cambion'), value: cetus(w, now, 'fass', 'vome'), inline: true },
      { name: heading('zariman'), value: zariman(w), inline: true },
      { name: heading('duviri'), value: duviri(now), inline: true },
      { name: heading('steelPath'), value: steelPath(t, now), inline: true },
      { name: heading('archon'), value: archon(t, w.LiteSorties?.[0]), inline: true },
      { name: heading('sortie'), value: sortie(t, w.Sorties?.[0]), inline: true },
      { name: heading('baro'), value: baro(t, w.VoidTraders?.[0], now), inline: true },
      { name: heading('arbitration'), value: arbitration(t, now), inline: true },
      { name: heading('darvo'), value: darvo(t, w.DailyDeals?.[0]), inline: true },
      { name: text('warframe.news'), value: news(t, w.Events) }
    )
    .setFooter({ text: text('warframe.footer') });
  await interaction.editReply({ embeds: [embed] });
}

module.exports = { data, execute };
