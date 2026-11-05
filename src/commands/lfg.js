const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, InteractionContextType } = require('discord.js');
const { db, guildSettings } = require('../db');
const { parseStart } = require('../time');

const data = new SlashCommandBuilder()
  .setName('lfg')
  .setDescription('Look for players')
  .setContexts(InteractionContextType.Guild)
  .addStringOption(o => o.setName('game').setDescription('Game').setRequired(true).setAutocomplete(true).setMaxLength(50))
  .addStringOption(o => o.setName('time').setDescription('now, 30m, 2h, 21:00 or 9pm (default: now)'))
  .addIntegerOption(o => o.setName('slots').setDescription('Players needed, including you (default: 5)').setMinValue(2).setMaxValue(20))
  .addStringOption(o => o.setName('note').setDescription('Extra info').setMaxLength(200));

function getGroup(id) {
  return db.prepare('SELECT * FROM lfg WHERE id = ?').get(id);
}

function getMembers(id, state) {
  return db.prepare('SELECT user_id FROM lfg_members WHERE lfg_id = ? AND state = ? ORDER BY joined_at').all(id, state).map(m => m.user_id);
}

function card(id) {
  const group = getGroup(id);
  const players = getMembers(id, 'in');
  const maybe = getMembers(id, 'maybe');
  const ts = Math.floor(group.start_at / 1000);

  const embed = new EmbedBuilder()
    .setTitle(`🎮 ${group.game}`)
    .setDescription([`Host: <@${group.host_id}>`, `🕘 <t:${ts}:F> (<t:${ts}:R>)`, group.note].filter(Boolean).join('\n'))
    .addFields(
      { name: `👥 ${players.length}/${group.slots}`, value: players.map(u => `<@${u}>`).join('\n') || '-', inline: true },
      { name: '🤔 Maybe', value: maybe.map(u => `<@${u}>`).join('\n') || '-', inline: true }
    );

  if (group.status !== 'open') {
    embed.setFooter({ text: group.status === 'cancelled' ? 'Cancelled' : 'Closed' });
    return { embeds: [embed], components: [] };
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`lfg:in:${id}`).setLabel('Join').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`lfg:maybe:${id}`).setLabel('Maybe').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`lfg:leave:${id}`).setLabel('Leave').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`lfg:cancel:${id}`).setLabel('Cancel').setStyle(ButtonStyle.Danger)
  );
  return { embeds: [embed], components: [row] };
}

function ping(users, text) {
  return { content: `${users.map(u => `<@${u}>`).join(' ')} ${text}`.trim(), allowedMentions: { users } };
}

async function autocomplete(interaction) {
  const typed = interaction.options.getFocused().toLowerCase();
  const games = db.prepare('SELECT name FROM games WHERE guild_id = ? ORDER BY name').all(interaction.guildId);
  await interaction.respond(games.filter(g => g.name.toLowerCase().includes(typed)).slice(0, 25).map(g => ({ name: g.name, value: g.name })));
}

async function execute(interaction) {
  const settings = guildSettings(interaction.guildId);
  const game = interaction.options.getString('game');
  const start = parseStart(interaction.options.getString('time'), settings.timezone);
  if (!start) return interaction.reply({ content: 'Time format: now, 30m, 2h, 21:00 or 9pm', flags: MessageFlags.Ephemeral });

  const channel = settings.lfg_channel
    ? await interaction.client.channels.fetch(settings.lfg_channel).catch(() => interaction.channel)
    : interaction.channel;

  const { lastInsertRowid } = db.prepare('INSERT INTO lfg (guild_id, channel_id, host_id, game, created_at, start_at, slots, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(interaction.guildId, channel.id, interaction.user.id, game, Date.now(), start, interaction.options.getInteger('slots') ?? 5, interaction.options.getString('note'));
  const id = Number(lastInsertRowid);
  db.prepare('INSERT INTO lfg_members VALUES (?, ?, ?, ?)').run(id, interaction.user.id, 'in', Date.now());

  const role = db.prepare('SELECT role_id FROM games WHERE guild_id = ? AND name = ?').get(interaction.guildId, game);
  const message = await channel.send({
    content: role ? `<@&${role.role_id}>` : undefined,
    allowedMentions: { roles: role ? [role.role_id] : [] },
    ...card(id)
  });
  db.prepare('UPDATE lfg SET message_id = ? WHERE id = ?').run(message.id, id);

  await interaction.reply({ content: channel.id === interaction.channelId ? 'Posted!' : `Posted in <#${channel.id}>!`, flags: MessageFlags.Ephemeral });
}

async function button(interaction) {
  const [, action, rawId] = interaction.customId.split(':');
  const id = Number(rawId);
  const group = getGroup(id);
  const user = interaction.user.id;
  const ephemeral = { flags: MessageFlags.Ephemeral };

  if (!group || group.status !== 'open') return interaction.reply({ content: 'This group is closed.', ...ephemeral });

  if (action === 'cancel') {
    if (user !== group.host_id) return interaction.reply({ content: 'Only the host can cancel.', ...ephemeral });
    db.prepare("UPDATE lfg SET status = 'cancelled' WHERE id = ?").run(id);
    return interaction.update(card(id));
  }

  if (action === 'leave') {
    db.prepare('DELETE FROM lfg_members WHERE lfg_id = ? AND user_id = ?').run(id, user);
  } else {
    const players = getMembers(id, 'in').filter(u => u !== user);
    if (action === 'in' && players.length >= group.slots) return interaction.reply({ content: 'This group is full.', ...ephemeral });
    db.prepare('INSERT INTO lfg_members VALUES (?, ?, ?, ?) ON CONFLICT(lfg_id, user_id) DO UPDATE SET state = excluded.state')
      .run(id, user, action, Date.now());
  }

  await interaction.update(card(id));

  const players = getMembers(id, 'in');
  if (action === 'in' && players.length === group.slots) {
    await interaction.followUp(ping(players, `squad is full for **${group.game}**, get in voice!`));
  }
}

async function tick(client) {
  const now = Date.now();
  for (const group of db.prepare("SELECT * FROM lfg WHERE status = 'open'").all()) {
    const channel = await client.channels.fetch(group.channel_id).catch(() => null);
    if (!channel) {
      db.prepare("UPDATE lfg SET status = 'closed' WHERE id = ?").run(group.id);
      continue;
    }

    const players = getMembers(group.id, 'in');
    const lead = group.start_at - group.created_at;

    if (lead > 15 * 60000 && !group.reminded && group.start_at - now <= 10 * 60000) {
      db.prepare('UPDATE lfg SET reminded = 1 WHERE id = ?').run(group.id);
      await channel.send(ping(players, `**${group.game}** starts <t:${Math.floor(group.start_at / 1000)}:R> (${players.length}/${group.slots})`));
    }

    if (lead > 60000 && !group.started && now >= group.start_at) {
      db.prepare('UPDATE lfg SET started = 1 WHERE id = ?').run(group.id);
      await channel.send(ping(players, `time to play **${group.game}**!`));
    }

    if (now >= group.start_at + 2 * 3600000) {
      db.prepare("UPDATE lfg SET status = 'closed' WHERE id = ?").run(group.id);
      await channel.messages.edit(group.message_id, card(group.id)).catch(() => {});
    }
  }
}

function panel(guildId) {
  const games = db.prepare('SELECT name FROM games WHERE guild_id = ? ORDER BY name').all(guildId).slice(0, 25);
  const rows = [];
  for (let i = 0; i < games.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(
      games.slice(i, i + 5).map(g => new ButtonBuilder().setCustomId(`role:${g.name}`).setLabel(g.name).setStyle(ButtonStyle.Secondary))
    ));
  }
  const embed = new EmbedBuilder()
    .setTitle('🎮 Pick your games')
    .setDescription(games.length
      ? 'Click a game to get pinged when someone uses /lfg for it. Click again to stop.'
      : 'No games yet. An admin can add them with /setup addgame.');
  return { embeds: [embed], components: rows };
}

async function refreshPanel(guild) {
  const settings = guildSettings(guild.id);
  if (!settings.lfg_channel || !settings.panel_message) return;
  const channel = await guild.channels.fetch(settings.lfg_channel).catch(() => null);
  await channel?.messages.edit(settings.panel_message, panel(guild.id)).catch(() => {});
}

async function roleButton(interaction) {
  const name = interaction.customId.slice('role:'.length);
  const game = db.prepare('SELECT role_id FROM games WHERE guild_id = ? AND name = ?').get(interaction.guildId, name);
  const ephemeral = { flags: MessageFlags.Ephemeral };
  if (!game) return interaction.reply({ content: 'This game was removed.', ...ephemeral });

  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (member.roles.cache.has(game.role_id)) {
    await member.roles.remove(game.role_id);
    return interaction.reply({ content: `You won't be pinged for **${name}** anymore.`, ...ephemeral });
  }
  await member.roles.add(game.role_id);
  await interaction.reply({ content: `You'll be pinged for **${name}**.`, ...ephemeral });
}

module.exports = { data, execute, autocomplete, button, roleButton, tick, panel, refreshPanel };
