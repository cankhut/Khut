const { SlashCommandBuilder, MessageFlags, InteractionContextType } = require('discord.js');
const { guildSettings } = require('../db');
const { wrappedEmbed } = require('../tracker');
const { text } = require('../settings');

const data = new SlashCommandBuilder()
  .setName('wrapped')
  .setDescription('Server voice Wrapped: who talked the most, top duo, most played game')
  .setContexts(InteractionContextType.Guild)
  .addStringOption(o => o.setName('period').setDescription('Default: this month').addChoices(
    { name: 'This month', value: 'month' },
    { name: 'Last month', value: 'last' },
    { name: 'This year', value: 'year' },
    { name: 'All time', value: 'all' }
  ));

async function execute(interaction) {
  const tz = guildSettings(interaction.guildId).timezone;
  const embed = wrappedEmbed(interaction.guildId, interaction.options.getString('period') ?? 'month', tz);
  if (!embed) return interaction.reply({ content: text('wrapped.none'), flags: MessageFlags.Ephemeral });
  await interaction.reply({ embeds: [embed] });
}

module.exports = { data, execute };
