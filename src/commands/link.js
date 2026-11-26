const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { saveLinks, wowCharacters, addWowCharacter } = require('../db');
const { resolveSteamId, riotAccount } = require('../api');
const { oauthUrl } = require('../web');
const { parsePlayerId } = require('../brawlhalla');
const wow = require('../wow');
const { settings, text } = require('../settings');

const MAX_WOW = 10;

function accountOptions(builder) {
  return builder
    .addStringOption(o => o.setName('steam').setDescription('Steam profile link or friend code'))
    .addStringOption(o => o.setName('riot').setDescription('Name#Tag'))
    .addStringOption(o => o.setName('brawlhalla').setDescription('Brawlhalla ID (top-right of Inventory tab)'))
    .addStringOption(o => o.setName('wow').setDescription('Add a WoW: Forever character, Name Surname'))
    .addStringOption(o => o.setName('wow_region').setDescription('WoW: Forever region (default EU)').addChoices(...wow.REGIONS.map(r => ({ name: r.toUpperCase(), value: r }))));
}

const data = accountOptions(new SlashCommandBuilder()
  .setName('link')
  .setDescription('Link your Steam, Riot, Brawlhalla and WoW: Forever accounts'));

function inputs(interaction) {
  return ['steam', 'riot', 'brawlhalla', 'wow'].map(name => interaction.options.getString(name));
}

async function link(interaction, userId) {
  const [steamInput, riotInput, brawlhallaInput, wowInput] = inputs(interaction);
  const done = [];

  let steamId = null;
  if (steamInput) {
    steamId = await resolveSteamId(steamInput).catch(() => null);
    if (!steamId) return interaction.editReply(text('link.badSteam'));
    done.push(`Steam: https://steamcommunity.com/profiles/${steamId}`);
  }

  let riotId = null;
  if (riotInput) {
    const account = await riotAccount(riotInput).catch(() => null);
    if (!account) return interaction.editReply(text('link.badRiot'));
    riotId = `${account.gameName}#${account.tagLine}`;
    done.push(`Riot: ${riotId}`);
  }

  const brawlhallaId = brawlhallaInput ? parsePlayerId(brawlhallaInput) : null;
  if (brawlhallaInput && !brawlhallaId) return interaction.editReply(text('link.badBrawlhalla'));
  if (brawlhallaId) done.push(`Brawlhalla ID: ${brawlhallaId}`);

  let character = null;
  if (wowInput) {
    const region = interaction.options.getString('wow_region') ?? 'eu';
    const slug = wow.slug(wowInput);
    const owned = wowCharacters(userId);
    if (owned.length >= MAX_WOW && !owned.some(c => c.region === region && c.slug === slug)) return interaction.editReply(text('link.wowLimit', { count: MAX_WOW }));
    const found = wow.hasKeys() ? await wow.profile(region, wowInput).catch(() => null) : null;
    if (!found) return interaction.editReply(text('link.badWow'));
    character = { region, slug };
    done.push(`WoW: Forever: ${[found.name, found.surname].filter(Boolean).join(' ')} (${region.toUpperCase()})`);
  }

  saveLinks(userId, steamId, riotId, brawlhallaId);
  if (character) addWowCharacter(userId, character.region, character.slug);
  const head = userId === interaction.user.id ? text('link.done') : text('link.forDone', { user: `<@${userId}>` });
  await interaction.editReply({ content: `${head}\n${done.join('\n')}`, allowedMentions: { parse: [] } });
}

async function execute(interaction) {
  const ephemeral = { flags: MessageFlags.Ephemeral };
  if (!inputs(interaction).some(Boolean)) {
    if (!process.env.PUBLIC_URL) return interaction.reply({ content: text('link.usage'), ...ephemeral });
    const button = new ButtonBuilder().setLabel(text('link.connectButton')).setStyle(ButtonStyle.Link).setURL(oauthUrl());
    return interaction.reply({ content: text('link.connect'), components: [new ActionRowBuilder().addComponents(button)], ...ephemeral });
  }
  await interaction.deferReply(ephemeral);
  await link(interaction, interaction.user.id);
}

async function isOwner(interaction) {
  const app = await interaction.client.application.fetch();
  const ids = app.owner?.members ? [...app.owner.members.keys()] : [app.owner?.id];
  return ids.includes(interaction.user.id);
}

const forOthers = {
  data: accountOptions(new SlashCommandBuilder()
    .setName('linkfor')
    .setDescription('Bot owner only: link accounts for someone else')
    .setDefaultMemberPermissions(0)
    .addUserOption(o => o.setName('user').setDescription('Who to link them for').setRequired(true))),
  async execute(interaction) {
    const ephemeral = { flags: MessageFlags.Ephemeral };
    if (!settings.commands.linkFor) return interaction.reply({ content: text('link.forOff'), ...ephemeral });
    if (!await isOwner(interaction)) return interaction.reply({ content: text('link.forOwner'), ...ephemeral });
    if (!inputs(interaction).some(Boolean)) return interaction.reply({ content: text('link.usage'), ...ephemeral });
    await interaction.deferReply(ephemeral);
    await link(interaction, interaction.options.getUser('user').id);
  }
};

module.exports = { data, execute, forOthers };
