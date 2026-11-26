const { SlashCommandBuilder } = require('discord.js');
const wow = require('../wow');
const wowcards = require('../wowcards');

const data = new SlashCommandBuilder()
  .setName('price')
  .setDescription('Market prices')
  .addSubcommand(s => s.setName('wow').setDescription('WoW: Forever auction house prices for Alliance, Horde and Blackwater')
    .addStringOption(o => o.setName('item').setDescription('Item name').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('ruleset').setDescription('Ruleset (default: your linked character\'s, or Normal)').addChoices(...Object.entries(wow.RULESETS).map(([id, name]) => ({ name, value: id }))))
    .addStringOption(wowcards.regionOption));

async function execute(interaction) {
  if (interaction.options.getSubcommand() === 'wow') return wowcards.price(interaction);
}

async function autocomplete(interaction) {
  if (interaction.options.getSubcommand() === 'wow') return wowcards.priceAutocomplete(interaction);
}

module.exports = { data, execute, autocomplete };
