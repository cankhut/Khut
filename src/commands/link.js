const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { saveLinks } = require('../db');
const { resolveSteamId, riotAccount } = require('../api');
const { oauthUrl } = require('../web');
const { parsePlayerId } = require('../brawlhalla');
const wow = require('../wow');
const { text } = require('../settings');

const data = new SlashCommandBuilder()
  .setName('link')
  .setDescription('Link your Steam, Riot, Brawlhalla and WoW: Forever accounts')
  .addStringOption(o => o.setName('steam').setDescription('Steam profile link or friend code'))
  .addStringOption(o => o.setName('riot').setDescription('Name#Tag'))
  .addStringOption(o => o.setName('brawlhalla').setDescription('Brawlhalla ID (top-right of Inventory tab)'))
  .addStringOption(o => o.setName('wow').setDescription('WoW: Forever character, Name Surname'))
  .addStringOption(o => o.setName('wow_region').setDescription('WoW: Forever region (default EU)').addChoices(...wow.REGIONS.map(r => ({ name: r.toUpperCase(), value: r }))));

async function execute(interaction) {
  const steamInput = interaction.options.getString('steam');
  const riotInput = interaction.options.getString('riot');
  const brawlhallaInput = interaction.options.getString('brawlhalla');
  const wowInput = interaction.options.getString('wow');
  const ephemeral = { flags: MessageFlags.Ephemeral };

  if (!steamInput && !riotInput && !brawlhallaInput && !wowInput) {
    if (!process.env.PUBLIC_URL) {
      return interaction.reply({ content: text('link.usage'), ...ephemeral });
    }
    const button = new ButtonBuilder().setLabel(text('link.connectButton')).setStyle(ButtonStyle.Link).setURL(oauthUrl());
    return interaction.reply({
      content: text('link.connect'),
      components: [new ActionRowBuilder().addComponents(button)],
      ...ephemeral
    });
  }

  await interaction.deferReply(ephemeral);
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

  let wowCharacter = null;
  if (wowInput) {
    const region = interaction.options.getString('wow_region') ?? 'eu';
    const found = wow.hasKeys() ? await wow.character(region, wowInput).catch(() => null) : null;
    if (!found) return interaction.editReply(text('link.badWow'));
    wowCharacter = `${region}/${wow.slug(wowInput)}`;
    done.push(`WoW: Forever: ${[found.profile.name, found.profile.surname].filter(Boolean).join(' ')} (${region.toUpperCase()})`);
  }

  saveLinks(interaction.user.id, steamId, riotId, brawlhallaId, wowCharacter);
  await interaction.editReply(`${text('link.done')}\n${done.join('\n')}`);
}

module.exports = { data, execute };
