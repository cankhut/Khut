const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, InteractionContextType } = require('discord.js');
const { db, setGuild } = require('../db');
const { validTimezone } = require('../time');
const { postPanel, refreshPanel } = require('./lfg');
const roles = require('../roles');
const log = require('../log');
const { text } = require('../settings');

const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Server settings (admins)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand(s => s.setName('games').setDescription('Post a fixed game picker in this channel, like for onboarding'))
  .addSubcommand(s => s.setName('roles').setDescription('Make a role for each game and ping the role in LFG posts')
    .addBooleanOption(o => o.setName('on').setDescription('On: one role per game. Off: ping subscribers directly').setRequired(true)))
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

  if (sub === 'games') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await postPanel(interaction);
    } catch (err) {
      log.warn(`Games panel failed in ${guild.name}: ${err.message}`);
      return interaction.editReply(text('setup.panelFailed'));
    }
    return interaction.editReply(text('setup.panelPosted'));
  }

  if (sub === 'roles') {
    const on = interaction.options.getBoolean('on');
    if (!roles.canManage(guild)) return reply(text('setup.noManageRoles'));
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    roles.turn(guild.id, on);
    await roles.sync(guild);
    return interaction.editReply(text(on ? 'setup.rolesOn' : 'setup.rolesOff'));
  }

  if (sub === 'addgame') {
    const name = interaction.options.getString('game').trim();
    if (db.prepare('SELECT 1 FROM games WHERE guild_id = ? AND name = ?').get(guild.id, name)) return reply(text('setup.exists', { game: name }));
    if (db.prepare('SELECT COUNT(*) AS n FROM games WHERE guild_id = ?').get(guild.id).n >= 25) return reply(text('setup.limit'));
    db.prepare('INSERT INTO games VALUES (?, ?, NULL)').run(guild.id, name);
    await reply(text('setup.added', { game: name }));
    await roles.sync(guild).catch(err => log.warn(`Game role for ${name} failed: ${err.message}`));
    return refreshPanel(guild);
  }

  if (sub === 'removegame') {
    const name = interaction.options.getString('game');
    const game = db.prepare('SELECT role_id FROM games WHERE guild_id = ? AND name = ?').get(guild.id, name);
    if (!game) return reply(text('setup.unknown', { game: name }));
    if (game.role_id) await guild.roles.delete(game.role_id).catch(() => {});
    db.prepare('DELETE FROM games WHERE guild_id = ? AND name = ?').run(guild.id, name);
    db.prepare('DELETE FROM subscriptions WHERE guild_id = ? AND game = ?').run(guild.id, name);
    await reply(text('setup.removed', { game: name }));
    return refreshPanel(guild);
  }

  if (sub === 'wrapped') {
    const auto = interaction.options.getBoolean('auto');
    setGuild(guild.id, 'wrapped_auto', auto ? 1 : 0);
    return reply(text(auto ? 'setup.wrappedOn' : 'setup.wrappedOff'));
  }

  if (sub === 'timezone') {
    const tz = interaction.options.getString('timezone').trim();
    if (!validTimezone(tz)) return reply(text('setup.badTimezone'));
    setGuild(guild.id, 'timezone', tz);
    return reply(text('setup.timezone', { timezone: tz }));
  }
}

module.exports = { data, execute, autocomplete };
