const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const wow = require('./wow');
const { wowCharacters } = require('./db');
const { wowIcon } = require('./assets');
const { parseEmoji } = require('./games/core');
const { text } = require('./settings');
const colors = require('./colors');
const log = require('./log');

const QUALITY = { POOR: '⬛', COMMON: '⬜', UNCOMMON: '🟩', RARE: '🟦', EPIC: '🟪', LEGENDARY: '🟧', ARTIFACT: '🟨', HEIRLOOM: '🟨' };
const HIDDEN_SLOTS = ['SHIRT', 'TABARD'];
const regionOption = o => o.setName('region').setDescription('Region (default EU)').addChoices(...wow.REGIONS.map(r => ({ name: r.toUpperCase(), value: r })));

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

function fullName(p) {
  return [p.name, p.surname].filter(Boolean).join(' ');
}

function slugName(slug) {
  return slug.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
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
    .setAuthor({ name: fullName(p), iconURL: media.avatar })
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

async function displayName(interaction, userId) {
  const member = await interaction.guild?.members.fetch(userId).catch(() => null);
  return member?.displayName ?? (await interaction.client.users.fetch(userId).catch(() => null))?.displayName ?? 'Someone';
}

async function listView(interaction, invoker, userId) {
  const chars = wowCharacters(userId);
  const profiles = await Promise.all(chars.map(c => wow.profile(c.region, c.slug).catch(() => null)));
  const lines = chars.map((c, i) => {
    const p = profiles[i];
    if (!p) return `❔ **${slugName(c.slug)}** · ${c.region.toUpperCase()} · ${text('wow.notLoaded')}`;
    return `${raceIcon(p.race, p.gender.type)}${wowIcon(`class_${p.character_class.id}`)} **${fullName(p)}** · ${text('wow.level', { level: p.level })} · ${p.ruleset?.name ?? '-'} · ${c.region.toUpperCase()}${p.guild ? ` · <${p.guild.name}>` : ''}`;
  });
  const embed = new EmbedBuilder()
    .setColor(colors.wow)
    .setTitle(text('wow.characters', { user: await displayName(interaction, userId) }))
    .setDescription(lines.join('\n'))
    .setFooter({ text: text('wow.pick') });
  const buttons = chars.map((c, i) => {
    const p = profiles[i];
    const button = new ButtonBuilder()
      .setCustomId(`wow:c:${invoker}:${userId}:${c.region}:${c.slug}`.slice(0, 100))
      .setLabel((p ? fullName(p) : slugName(c.slug)).slice(0, 80))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!p);
    const icon = p && parseEmoji(wowIcon(`class_${p.character_class.id}`));
    if (icon) button.setEmoji(icon);
    return button;
  });
  const rows = [];
  for (let n = 0; n < buttons.length; n += 5) rows.push(new ActionRowBuilder().addComponents(buttons.slice(n, n + 5)));
  return { content: '', embeds: [embed], components: rows };
}

function backRow(invoker, userId) {
  return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`wow:l:${invoker}:${userId}`).setLabel(text('wow.back')).setStyle(ButtonStyle.Secondary).setEmoji('↩️'));
}

function failText(err, sub) {
  if (err.status === 404) return text(sub === 'guild' ? 'wow.guildNotFound' : sub === 'price' ? 'wow.itemNotFound' : 'wow.notFound');
  log.warn(`WoW ${sub}: ${err.message}`);
  return text('wow.unavailable');
}

async function stats(interaction) {
  if (!wow.hasKeys()) return interaction.reply({ content: text('wow.noKeys'), flags: MessageFlags.Ephemeral });
  const sub = interaction.options.getSubcommand();
  const input = interaction.options.getString('name')?.trim();
  const region = interaction.options.getString('region');
  await interaction.deferReply();
  try {
    if (sub === 'guild') {
      const g = await wow.guild(region ?? 'eu', input);
      return interaction.editReply({ embeds: [guildEmbed(g, region ?? 'eu')] });
    }
    const mention = input?.match(/^<@!?(\d+)>$/)?.[1];
    if (input && !mention) {
      const c = await wow.character(region ?? 'eu', input);
      return interaction.editReply({ embeds: [characterEmbed(c, region ?? 'eu')] });
    }
    const userId = mention ?? interaction.user.id;
    const chars = wowCharacters(userId);
    if (!chars.length) return interaction.editReply({ content: mention ? text('wow.noneLinked', { user: `<@${userId}>` }) : text('wow.notLinked'), allowedMentions: { parse: [] } });
    if (chars.length === 1) {
      const c = await wow.character(chars[0].region, chars[0].slug);
      return interaction.editReply({ embeds: [characterEmbed(c, chars[0].region)] });
    }
    return interaction.editReply(await listView(interaction, interaction.user.id, userId));
  } catch (err) {
    return interaction.editReply(failText(err, sub));
  }
}

async function component(interaction) {
  const [, action, invoker, userId, region, slug] = interaction.customId.split(':');
  if (interaction.user.id !== invoker) return interaction.reply({ content: text('wow.notYours'), flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate();
  if (action === 'l') return interaction.editReply(await listView(interaction, invoker, userId));
  try {
    const c = await wow.character(region, slug);
    await interaction.editReply({ embeds: [characterEmbed(c, region)], components: [backRow(invoker, userId)] });
  } catch (err) {
    await interaction.followUp({ content: failText(err, 'character'), flags: MessageFlags.Ephemeral });
  }
}

async function price(interaction) {
  if (!wow.hasKeys()) return interaction.reply({ content: text('wow.noKeys'), flags: MessageFlags.Ephemeral });
  await interaction.deferReply();
  try {
    const own = wowCharacters(interaction.user.id)[0];
    const region = interaction.options.getString('region') ?? own?.region ?? 'eu';
    let ruleset = interaction.options.getString('ruleset');
    if (!ruleset && own) ruleset = String((await wow.profile(own.region, own.slug).catch(() => null))?.ruleset?.id ?? '');
    if (!wow.RULESETS[ruleset]) ruleset = '2';
    let id = Number(interaction.options.getString('item'));
    if (!id) id = (await wow.searchItems(region, interaction.options.getString('item')))[0]?.id;
    if (!id) return interaction.editReply(text('wow.itemNotFound'));
    return interaction.editReply({ embeds: [await priceEmbed(region, ruleset, id)] });
  } catch (err) {
    return interaction.editReply(failText(err, 'price'));
  }
}

async function priceAutocomplete(interaction) {
  const typed = interaction.options.getFocused().trim();
  if (typed.length < 2 || !wow.hasKeys()) return interaction.respond([]);
  const region = interaction.options.getString('region') ?? 'eu';
  const results = await wow.searchItems(region, typed).catch(() => []);
  await interaction.respond(results.slice(0, 25).map(i => ({ name: `${QUALITY[i.quality] ?? ''} ${i.name}`.trim().slice(0, 100), value: String(i.id) })));
}

module.exports = { regionOption, slugName, stats, component, price, priceAutocomplete };
