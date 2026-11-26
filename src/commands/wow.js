const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const wow = require('../wow');
const { getLinks } = require('../db');
const { wowIcon } = require('../assets');
const { text } = require('../settings');
const colors = require('../colors');
const log = require('../log');

const QUALITY = { POOR: '⬛', COMMON: '⬜', UNCOMMON: '🟩', RARE: '🟦', EPIC: '🟪', LEGENDARY: '🟧', ARTIFACT: '🟨', HEIRLOOM: '🟨' };
const HIDDEN_SLOTS = ['SHIRT', 'TABARD'];
const regionOption = o => o.setName('region').setDescription('Region (default EU)').addChoices(...wow.REGIONS.map(r => ({ name: r.toUpperCase(), value: r })));

const data = new SlashCommandBuilder()
  .setName('wow')
  .setDescription('World of Warcraft: Forever')
  .addSubcommand(s => s.setName('character').setDescription('Show a WoW: Forever character')
    .addStringOption(o => o.setName('name').setDescription('Name Surname, or @user if they used /link'))
    .addStringOption(regionOption))
  .addSubcommand(s => s.setName('guild').setDescription('Show a WoW: Forever guild')
    .addStringOption(o => o.setName('name').setDescription('Guild name').setRequired(true))
    .addStringOption(regionOption))
  .addSubcommand(s => s.setName('price').setDescription('Auction house prices for an item')
    .addStringOption(o => o.setName('item').setDescription('Item name').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('ruleset').setDescription('Ruleset (default: your linked character, or Normal)').addChoices(...Object.entries(wow.RULESETS).map(([id, name]) => ({ name, value: id }))))
    .addStringOption(regionOption));

function time(ms) {
  return `<t:${Math.floor(ms / 1000)}:R>`;
}

function itemLink(id, name) {
  return `[${name.replace(/[[\]]/g, '')}](https://www.wowhead.com/forever/item=${id})`;
}

function money(copper) {
  const parts = [[Math.floor(copper / 10000), 'gold', 'g'], [Math.floor(copper / 100) % 100, 'silver', 's'], [copper % 100, 'copper', 'c']];
  return parts.filter(([n], i) => n || (i === 2 && copper < 100)).map(([n, key, short]) => `${n}${wowIcon(key) || short}`).join(' ');
}

function raceIcon(race, gender) {
  return wowIcon(`race_${race.id === 96 ? 95 : race.id}_${gender === 'FEMALE' ? 'female' : 'male'}`);
}

function linked(userId) {
  const value = getLinks(userId)?.wow_character;
  if (!value) return null;
  const [region, name] = value.split('/');
  return { region, name };
}

function target(interaction) {
  const input = interaction.options.getString('name');
  const region = interaction.options.getString('region');
  const mention = input?.trim().match(/^<@!?(\d+)>$/)?.[1];
  if (input && !mention) return { name: input, region: region ?? 'eu' };
  const link = linked(mention ?? interaction.user.id);
  return link && { name: link.name, region: region ?? link.region };
}

function activeSpec(c) {
  const group = c.specializations?.specialization_groups?.find(g => g.is_active);
  return group?.specializations?.[0]?.specialization?.name ?? null;
}

function characterEmbed(c, region) {
  const p = c.profile;
  const media = Object.fromEntries((c.media?.assets ?? []).map(a => [a.key, a.value]));
  const spec = activeSpec(c);
  const lines = [
    `${raceIcon(p.race, p.gender.type)} ${p.race.name} ${wowIcon(`class_${p.character_class.id}`)} ${p.character_class.name} · ${text('wow.level', { level: p.level })}${spec ? ` · ${spec}` : ''}`,
    `${wowIcon(p.faction.type.toLowerCase())} ${p.faction.name} · ${p.ruleset?.name ?? '-'} · ${region.toUpperCase()}`
  ];
  if (p.guild) lines.push(`<${p.guild.name}>`);
  if (p.last_login_timestamp) lines.push(text('wow.lastOnline', { time: time(p.last_login_timestamp) }));
  const embed = new EmbedBuilder()
    .setColor(colors.wow)
    .setAuthor({ name: `${p.name} ${p.surname ?? ''}`.trim(), iconURL: media.avatar })
    .setDescription(lines.join('\n'))
    .setFooter({ text: text('wow.footer', { region: region.toUpperCase() }) });
  if (media['main-raw']) embed.setImage(media['main-raw']);

  const professions = [...(c.professions?.primaries ?? []), ...(c.professions?.secondaries ?? [])].map(x => {
    const tier = x.tiers?.[0];
    return `${wowIcon(`profession_${x.profession.id}`)} ${x.profession.name}${tier ? ` ${tier.skill_points}/${tier.max_skill_points}` : ''}`.trim();
  });
  if (professions.length) embed.addFields({ name: text('wow.professions'), value: professions.join('\n'), inline: true });

  const s = c.statistics;
  if (s) {
    const stats = [`${text('wow.health')} ${s.health}`, `${s.power_type?.name ?? text('wow.power')} ${s.power}`];
    if (s.attack_power) stats.push(`${text('wow.attackPower')} ${s.attack_power}`);
    if (s.spell_power) stats.push(`${text('wow.spellPower')} ${s.spell_power}`);
    if (s.melee_crit?.value) stats.push(`${text('wow.crit')} ${s.melee_crit.value.toFixed(1)}%`);
    embed.addFields({ name: text('wow.stats'), value: stats.join('\n'), inline: true });
  }

  if (c.pvp) {
    const played = (c.pvp.pvp_map_statistics ?? []).reduce((sum, m) => sum + m.match_statistics.played, 0);
    const won = (c.pvp.pvp_map_statistics ?? []).reduce((sum, m) => sum + m.match_statistics.won, 0);
    const pvp = [text('wow.kills', { count: c.pvp.honorable_kills ?? 0 })];
    if (played) pvp.push(text('wow.battlegrounds', { won, played }));
    if (c.pvp.pvp_rank) pvp.push(text('wow.rank', { rank: c.pvp.pvp_rank }));
    embed.addFields({ name: text('wow.pvp'), value: pvp.join('\n'), inline: true });
  }

  const reputations = (c.reputations?.reputations ?? []).filter(r => r.standing).sort((a, b) => b.standing.tier - a.standing.tier || b.standing.value - a.standing.value).slice(0, 4);
  if (reputations.length) embed.addFields({ name: text('wow.reputation'), value: reputations.map(r => `${r.faction.name} · ${r.standing.name}`).join('\n') });

  const gear = (c.equipment?.equipped_items ?? []).filter(i => !HIDDEN_SLOTS.includes(i.slot.type)).map(i => `${QUALITY[i.quality?.type] ?? '⬜'} ${itemLink(i.item.id, i.name)}`);
  const half = Math.ceil(gear.length / 2);
  if (gear.length) {
    embed.addFields(
      { name: text('wow.gear'), value: gear.slice(0, half).join('\n'), inline: true },
      { name: '​', value: gear.slice(half).join('\n') || '​', inline: true }
    );
  }
  return embed;
}

function guildEmbed(g, region) {
  const info = g.info;
  const members = g.members.map(m => m.character).filter(Boolean);
  const classes = {};
  for (const m of members) classes[m.playable_class?.id] = (classes[m.playable_class?.id] ?? 0) + 1;
  const maxLevel = members.filter(m => m.level >= 60).length;
  const lines = [
    `${wowIcon(info.faction.type.toLowerCase())} ${info.faction.name} · ${info.ruleset?.name ?? '-'} · ${region.toUpperCase()}`,
    text('wow.members', { count: info.member_count ?? members.length }),
    text('wow.founded', { time: `<t:${Math.floor(info.created_timestamp / 1000)}:D>` })
  ];
  const embed = new EmbedBuilder()
    .setColor(colors.wow)
    .setTitle(`<${info.name}>`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: text('wow.footer', { region: region.toUpperCase() }) });
  const classList = Object.entries(classes).sort((a, b) => b[1] - a[1]).map(([id, count]) => `${wowIcon(`class_${id}`) || id} ${count}`);
  if (classList.length) embed.addFields({ name: text('wow.classes'), value: classList.join(' · ') });
  if (members.length) embed.addFields({ name: text('wow.levels'), value: text('wow.maxLevel', { count: maxLevel, total: members.length }), inline: true });
  const leaders = g.members.filter(m => m.rank <= 1).sort((a, b) => a.rank - b.rank).slice(0, 6)
    .map(m => `${wowIcon(`class_${m.character.playable_class?.id}`)} ${m.character.name} ${m.character.surname ?? ''}${m.rank === 0 ? ` (${text('wow.guildMaster')})` : ''}`.trim());
  if (leaders.length) embed.addFields({ name: text('wow.leaders'), value: leaders.join('\n'), inline: true });
  return embed;
}

async function priceEmbed(region, ruleset, id) {
  const [info, auctions] = await Promise.all([wow.item(region, id), wow.auctionHouses(region, ruleset)]);
  const embed = new EmbedBuilder()
    .setColor(colors.wow)
    .setTitle(info.name)
    .setURL(`https://www.wowhead.com/forever/item=${id}`)
    .setDescription(`${QUALITY[info.quality] ?? ''} ${wow.RULESETS[ruleset]} · ${region.toUpperCase()} · ${text('wow.updated', { time: time(auctions.at) })}`.trim())
    .setFooter({ text: text('wow.footer', { region: region.toUpperCase() }) });
  if (info.icon) embed.setThumbnail(info.icon);
  for (const faction of wow.FACTIONS) {
    const entry = auctions.houses[faction].get(id);
    const value = entry ? `${money(entry.min)}\n${text('wow.forSale', { count: entry.quantity })}` : text('wow.notListed');
    embed.addFields({ name: `${wowIcon(faction)} ${text(`wow.${faction}`)}`.trim(), value, inline: true });
  }
  return embed;
}

async function execute(interaction) {
  if (!wow.hasKeys()) return interaction.reply({ content: text('wow.noKeys'), flags: MessageFlags.Ephemeral });
  const sub = interaction.options.getSubcommand();
  await interaction.deferReply();
  try {
    if (sub === 'character') {
      const who = target(interaction);
      if (!who) return interaction.editReply(text('wow.notLinked'));
      const c = await wow.character(who.region, who.name);
      return interaction.editReply({ embeds: [characterEmbed(c, who.region)] });
    }
    if (sub === 'guild') {
      const region = interaction.options.getString('region') ?? 'eu';
      const g = await wow.guild(region, interaction.options.getString('name'));
      return interaction.editReply({ embeds: [guildEmbed(g, region)] });
    }
    const link = linked(interaction.user.id);
    const region = interaction.options.getString('region') ?? link?.region ?? 'eu';
    const id = Number(interaction.options.getString('item'));
    let ruleset = interaction.options.getString('ruleset');
    if (!ruleset && link) ruleset = String((await wow.character(link.region, link.name).catch(() => null))?.profile?.ruleset?.id ?? '');
    if (!wow.RULESETS[ruleset]) ruleset = '2';
    if (!id) {
      const found = (await wow.searchItems(region, interaction.options.getString('item')))[0];
      if (!found) return interaction.editReply(text('wow.itemNotFound'));
      return interaction.editReply({ embeds: [await priceEmbed(region, ruleset, found.id)] });
    }
    return interaction.editReply({ embeds: [await priceEmbed(region, ruleset, id)] });
  } catch (err) {
    if (err.status === 404) return interaction.editReply(text(sub === 'guild' ? 'wow.guildNotFound' : sub === 'price' ? 'wow.itemNotFound' : 'wow.notFound'));
    log.warn(`WoW ${sub}: ${err.message}`);
    return interaction.editReply(text('wow.unavailable'));
  }
}

async function autocomplete(interaction) {
  const typed = interaction.options.getFocused().trim();
  if (typed.length < 2 || !wow.hasKeys()) return interaction.respond([]);
  const region = interaction.options.getString('region') ?? 'eu';
  const results = await wow.searchItems(region, typed).catch(() => []);
  await interaction.respond(results.slice(0, 25).map(i => ({ name: `${QUALITY[i.quality] ?? ''} ${i.name}`.trim().slice(0, 100), value: String(i.id) })));
}

module.exports = { data, execute, autocomplete };
