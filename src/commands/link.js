const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { saveLinks } = require('../db');
const { resolveSteamId, riotAccount } = require('../api');
const { oauthUrl } = require('../web');

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
      return interaction.reply({ content: 'Use `/link steam:<profile link or friend code> riot:<Name#Tag>`', ...ephemeral });
    }
    const button = new ButtonBuilder().setLabel('Connect with Discord').setStyle(ButtonStyle.Link).setURL(oauthUrl());
    return interaction.reply({
      content: 'This reads the Steam and Riot accounts already connected to your Discord profile. Or use `/link steam:... riot:...` to add them yourself.',
      components: [new ActionRowBuilder().addComponents(button)],
      ...ephemeral
    });
  }

  await interaction.deferReply(ephemeral);
  const done = [];

  let steamId = null;
  if (steamInput) {
    steamId = await resolveSteamId(steamInput).catch(() => null);
    if (!steamId) return interaction.editReply("Couldn't find that Steam account.");
    done.push(`Steam: https://steamcommunity.com/profiles/${steamId}`);
  }

  let riotId = null;
  if (riotInput) {
    const account = await riotAccount(riotInput).catch(() => null);
    if (!account) return interaction.editReply("Couldn't find that Riot ID.");
    riotId = `${account.gameName}#${account.tagLine}`;
    done.push(`Riot: ${riotId}`);
  }

  saveLinks(interaction.user.id, steamId, riotId);
  await interaction.editReply(`Linked!\n${done.join('\n')}`);
}

module.exports = { data, execute };
