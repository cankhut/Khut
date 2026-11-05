const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags, InteractionContextType } = require('discord.js');
const { db, guildSettings, setGuild } = require('../db');
const { validTimezone, monthKey } = require('../time');
const { panel, refreshPanel } = require('./lfg');

const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Server settings (admins)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand(s => s.setName('lfg').setDescription('Set the LFG channel and post the game picker there')
    .addChannelOption(o => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
  .addSubcommand(s => s.setName('addgame').setDescription('Add a game and its ping role')
    .addStringOption(o => o.setName('game').setDescription('Game name').setRequired(true).setMaxLength(50)))
  .addSubcommand(s => s.setName('removegame').setDescription('Remove a game and its ping role')
    .addStringOption(o => o.setName('game').setDescription('Game name').setRequired(true).setAutocomplete(true)))
  .addSubcommand(s => s.setName('wrapped').setDescription('Set the channel for the monthly Wrapped post')
    .addChannelOption(o => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
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

  if (sub === 'lfg') {
    const channel = interaction.options.getChannel('channel');
    const message = await channel.send(panel(guild.id));
    setGuild(guild.id, 'lfg_channel', channel.id);
    setGuild(guild.id, 'panel_message', message.id);
    return reply(`LFG posts will go to <#${channel.id}>. Game picker posted.`);
  }

  if (sub === 'addgame') {
    const name = interaction.options.getString('game').trim();
    if (db.prepare('SELECT 1 FROM games WHERE guild_id = ? AND name = ?').get(guild.id, name)) return reply(`**${name}** already exists.`);
    if (db.prepare('SELECT COUNT(*) AS n FROM games WHERE guild_id = ?').get(guild.id).n >= 25) return reply('The game picker holds up to 25 games.');
    const role = await guild.roles.create({ name, mentionable: true, reason: 'LFG game role' });
    db.prepare('INSERT INTO games VALUES (?, ?, ?)').run(guild.id, name, role.id);
    await refreshPanel(guild);
    return reply(`Added **${name}** with role <@&${role.id}>.`);
  }

  if (sub === 'removegame') {
    const name = interaction.options.getString('game');
    const game = db.prepare('SELECT role_id FROM games WHERE guild_id = ? AND name = ?').get(guild.id, name);
    if (!game) return reply(`**${name}** isn't on the list.`);
    await guild.roles.delete(game.role_id).catch(() => {});
    db.prepare('DELETE FROM games WHERE guild_id = ? AND name = ?').run(guild.id, name);
    await refreshPanel(guild);
    return reply(`Removed **${name}**.`);
  }

  if (sub === 'wrapped') {
    const channel = interaction.options.getChannel('channel');
    setGuild(guild.id, 'wrapped_channel', channel.id);
    setGuild(guild.id, 'last_wrapped', monthKey(guildSettings(guild.id).timezone, Date.now(), -1));
    return reply(`Monthly Wrapped will be posted in <#${channel.id}> at the start of each month.`);
  }

  if (sub === 'timezone') {
    const tz = interaction.options.getString('timezone').trim();
    if (!validTimezone(tz)) return reply('Unknown timezone. Use a name like Europe/Istanbul or America/Toronto.');
    setGuild(guild.id, 'timezone', tz);
    return reply(`Timezone set to **${tz}**.`);
  }
}

module.exports = { data, execute, autocomplete };
