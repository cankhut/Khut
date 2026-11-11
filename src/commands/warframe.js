const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getJson } = require('../api');
const { text } = require('../settings');
const colors = require('../colors');
const log = require('../log');

const ICONS = { day: '☀️', night: '🌙', warm: '🔥', cold: '❄️' };

const data = new SlashCommandBuilder()
  .setName('warframe')
  .setDescription('Warframe info')
  .addSubcommand(s => s.setName('cycle').setDescription('Open world cycles, missions, Baro, Darvo and news'));

let cache = { at: 0 };

async function worldState() {
  if (Date.now() - cache.at > 60000) cache = { at: Date.now(), data: await getJson('https://api.warframestat.us/pc/?language=en') };
  return cache.data;
}

function time(value) {
  return `<t:${Math.floor(Date.parse(value) / 1000)}:R>`;
}

function title(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function cycle(c) {
  return c ? `${ICONS[c.state] ?? ''} **${title(c.state)}**\n${text('warframe.ends', { time: time(c.expiry) })}`.trim() : '-';
}

function archon(a) {
  if (!a) return '-';
  return [`**${a.boss}**`, ...a.missions.map(m => `${m.type} · ${m.node}`), text('warframe.ends', { time: time(a.expiry) })].join('\n');
}

function sortie(s) {
  if (!s) return '-';
  return [`**${s.boss}**`, ...s.variants.map(v => `${v.missionType} · ${v.node}\n-# ${v.modifier}`), text('warframe.ends', { time: time(s.expiry) })].join('\n');
}

function steelPath(s) {
  if (!s?.currentReward) return '-';
  return `**${s.currentReward.name}**\n${s.currentReward.cost} Steel Essence\n${text('warframe.ends', { time: time(s.expiry) })}`;
}

function baro(b) {
  if (!b) return '-';
  return b.active
    ? `${text('warframe.baroHere', { time: time(b.expiry) })}\n${b.location}\n${text('warframe.baroItems', { count: b.inventory.length })}`
    : `${text('warframe.baroComing', { time: time(b.activation) })}\n${b.location}`;
}

function darvo(deals) {
  const d = deals?.[0];
  if (!d) return '-';
  return `**${d.item}** · ~~${d.originalPrice}~~ **${d.salePrice}** platinum (-${d.discount}%) · ${d.sold}/${d.total} sold\n${text('warframe.ends', { time: time(d.expiry) })}`;
}

function news(list) {
  const latest = (list ?? []).filter(n => Date.parse(n.date) > 0).sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 5);
  const lines = latest.map(n => `[${n.message.replace(/[[\]]/g, '')}](${n.link.split('?')[0]}) · ${time(n.date)}`);
  while (lines.join('\n').length > 1024) lines.pop();
  return lines.join('\n') || '-';
}

async function execute(interaction) {
  await interaction.deferReply();
  const w = await worldState().catch(err => log.warn(`Warframe world state: ${err.message}`));
  if (!w) return interaction.editReply(text('warframe.unavailable'));
  const embed = new EmbedBuilder()
    .setColor(colors.warframe)
    .setTitle(text('warframe.title'))
    .addFields(
      { name: text('warframe.cetus'), value: cycle(w.cetusCycle), inline: true },
      { name: text('warframe.vallis'), value: cycle(w.vallisCycle), inline: true },
      { name: text('warframe.cambion'), value: cycle(w.cambionCycle), inline: true },
      { name: text('warframe.zariman'), value: cycle(w.zarimanCycle), inline: true },
      { name: text('warframe.duviri'), value: cycle(w.duviriCycle), inline: true },
      { name: text('warframe.steelPath'), value: steelPath(w.steelPath), inline: true },
      { name: text('warframe.archon'), value: archon(w.archonHunt), inline: true },
      { name: text('warframe.sortie'), value: sortie(w.sortie), inline: true },
      { name: text('warframe.baro'), value: baro(w.voidTrader), inline: true },
      { name: text('warframe.darvo'), value: darvo(w.dailyDeals) },
      { name: text('warframe.news'), value: news(w.news) }
    )
    .setFooter({ text: text('warframe.footer') });
  await interaction.editReply({ embeds: [embed] });
}

module.exports = { data, execute };
