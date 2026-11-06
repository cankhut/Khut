const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { db } = require('../db');
const { text } = require('../settings');

const data = new SlashCommandBuilder()
  .setName('dm')
  .setDescription('Get LFG pings for your games as a DM')
  .addSubcommand(s => s.setName('on').setDescription('Khut DMs you when someone looks for players in your games'))
  .addSubcommand(s => s.setName('off').setDescription('Only get pinged in the channel'));

async function execute(interaction) {
  const id = interaction.user.id;
  if (interaction.options.getSubcommand() === 'on') {
    db.prepare('INSERT OR IGNORE INTO dm_on VALUES (?)').run(id);
    return interaction.reply({ content: text('dm.on'), flags: MessageFlags.Ephemeral });
  }
  db.prepare('DELETE FROM dm_on WHERE discord_id = ?').run(id);
  await interaction.reply({ content: text('dm.off'), flags: MessageFlags.Ephemeral });
}

module.exports = { data, execute };
