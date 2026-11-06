const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { saveLinks } = require('../db');
const { resolveSteamId, riotAccount } = require('../api');
const { oauthUrl } = require('../web');
const { text } = require('../settings');

const data = new SlashCommandBuilder()
  .setName('link')
  .setDescription('Link your Steam and Riot accounts')
  .addStringOption(o => o.setName('steam').setDescription('Steam profile link or friend code'))
  .addStringOption(o => o.setName('riot').setDescription('Name#Tag'));

async function execute(interaction) {
  const steamInput = interaction.options.getString('steam');
  const riotInput = interaction.options.getString('riot');
  const ephemeral = { flags: MessageFlags.Ephemeral };

  if (!steamInput && !riotInput) {
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

  saveLinks(interaction.user.id, steamId, riotId);
  await interaction.editReply(`${text('link.done')}\n${done.join('\n')}`);
}

module.exports = { data, execute };
