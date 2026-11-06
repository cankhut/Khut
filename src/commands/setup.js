const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, InteractionContextType } = require('discord.js');
const { db, setGuild } = require('../db');
const { validTimezone } = require('../time');

const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Server settings (admins)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand(s => s.setName('addgame').setDescription('Add a game people can subscribe to')
    .addStringOption(o => o.setName('game').setDescription('Game name').setRequired(true).setMaxLength(50)))
  .addSubcommand(s => s.setName('removegame').setDescription('Remove a game from /games')
    .addStringOption(o => o.setName('game').setDescription('Game name').setRequired(true).setAutocomplete(true)))
  .addSubcommand(s => s.setName('wrapped').setDescription('Turn the automatic monthly Wrapped post on or off')
    .addBooleanOption(o => o.setName('auto').setDescription('Post Wrapped automatically at the start of each month').setRequired(true)))
  .addSubcommand(s => s.setName('timezone').setDescription('Server timezone for LFG times and Wrapped')
    .addStringOption(o => o.setName('timezone').setDescription('Like Europe/Istanbul or America/Toronto').setRequired(true)));

async function autocomplete(interaction) {
  const typed = interaction.options.getFocused().toLowerCase();
  const games = db.prepare('SELECT name FROM games WHERE guild_id = ? ORDER BY name').all(interaction.guildId);
  await interaction.respond(games.filter(g => g.name.toLowerCase().includes(typed)).slice(0, 25).map(g => ({ name: g.name, value: g.name })));
}

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;
  const reply = content => interaction.reply({ content, flags: MessageFlags.Ephemeral });

  if (sub === 'addgame') {
    const name = interaction.options.getString('game').trim();
    if (db.prepare('SELECT 1 FROM games WHERE guild_id = ? AND name = ?').get(guild.id, name)) return reply(`**${name}** already exists.`);
    if (db.prepare('SELECT COUNT(*) AS n FROM games WHERE guild_id = ?').get(guild.id).n >= 25) return reply('Up to 25 games are supported.');
    db.prepare('INSERT INTO games VALUES (?, ?, NULL)').run(guild.id, name);
    return reply(`Added **${name}**.`);
  }

  if (sub === 'removegame') {
    const name = interaction.options.getString('game');
    const game = db.prepare('SELECT role_id FROM games WHERE guild_id = ? AND name = ?').get(guild.id, name);
    if (!game) return reply(`**${name}** isn't on the list.`);
    if (game.role_id) await guild.roles.delete(game.role_id).catch(() => {});
    db.prepare('DELETE FROM games WHERE guild_id = ? AND name = ?').run(guild.id, name);
    db.prepare('DELETE FROM subscriptions WHERE guild_id = ? AND game = ?').run(guild.id, name);
    return reply(`Removed **${name}**.`);
  }

  if (sub === 'wrapped') {
    const auto = interaction.options.getBoolean('auto');
    setGuild(guild.id, 'wrapped_auto', auto ? 1 : 0);
    return reply(auto
      ? "Wrapped will be posted automatically in the server's system messages channel at the start of each month."
      : 'Automatic Wrapped is off. Anyone can still use /wrapped.');
  }

  if (sub === 'timezone') {
    const tz = interaction.options.getString('timezone').trim();
    if (!validTimezone(tz)) return reply('Unknown timezone. Use a name like Europe/Istanbul or America/Toronto.');
    setGuild(guild.id, 'timezone', tz);
    return reply(`Timezone set to **${tz}**.`);
  }
}

module.exports = { data, execute, autocomplete };
