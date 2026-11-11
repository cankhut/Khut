const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, InteractionContextType } = require('discord.js');
const { db, guildSettings } = require('../db');
const { parseStart } = require('../time');
const colors = require('../colors');
const log = require('../log');
const { settings, text } = require('../settings');
const roles = require('../roles');
const { gameEmoji } = require('../assets');

const data = new SlashCommandBuilder()
  .setName('lfg')
  .setDescription('Looking For Players')
  .setContexts(InteractionContextType.Guild)
  .addStringOption(o => o.setName('game').setDescription('Game').setRequired(true).setAutocomplete(true).setMaxLength(50))
  .addStringOption(o => o.setName('time').setDescription('now, 30m, 2h, 21:00 or 9pm'))
  .addStringOption(o => o.setName('players').setDescription('current player amount / team size, like 3/6 or just 6 (default: 1/5)').setMaxLength(5))
  .addStringOption(o => o.setName('note').setDescription('Extra info, a GIF link works too').setMaxLength(200))
  .addAttachmentOption(o => o.setName('image').setDescription('A picture or GIF to show on the post'));

function getGroup(id) {
  return db.prepare('SELECT * FROM lfg WHERE id = ?').get(id);
}

function getMembers(id) {
  return db.prepare("SELECT user_id FROM lfg_members WHERE lfg_id = ? AND state = 'in' ORDER BY joined_at").all(id).map(m => m.user_id);
}

function parsePlayers(input) {
  const m = (input || '1/5').replace(/\s/g, '').match(/^(?:(\d+)\/)?(\d+)$/);
  if (!m) return null;
  const have = Number(m[1] ?? 1);
  const size = Number(m[2]);
  if (have < 1 || size < 2 || size > 20 || have >= size) return null;
  return { extra: have - 1, size };
}

function card(id) {
  const group = getGroup(id);
  const players = getMembers(id);
  const ts = Math.floor(group.start_at / 1000);
  const list = players.map(u => `<@${u}>`);
  if (group.extra) list.push(text(group.extra === 1 ? 'lfg.other' : 'lfg.others', { count: group.extra }));

  const icon = settings.icons.games.find(g => g.big && g.url && g.name.toLowerCase() === group.game.toLowerCase());
  const embed = new EmbedBuilder()
    .setTitle(icon ? group.game : `${gameEmoji(group.game) || '🎮'} ${group.game}`)
    .setDescription(`${text('lfg.host', { host: `<@${group.host_id}>` })}\n🕘 <t:${ts}:F> (<t:${ts}:R>)${group.note ? `\n\n${group.note}` : ''}`)
    .addFields({ name: `👥 ${players.length + group.extra}/${group.slots}`, value: list.join('\n') || '-' })
    .setThumbnail(icon?.url ?? null)
    .setImage(group.image ?? null)
    .setColor(group.status === 'cancelled' ? colors.lfgCancelled : group.status !== 'open' ? colors.lfgClosed : players.length + group.extra >= group.slots ? colors.lfgFull : colors.lfgOpen);

  if (group.status !== 'open') {
    embed.setFooter({ text: text(group.status === 'cancelled' ? 'lfg.footerCancelled' : 'lfg.footerClosed') });
    return { embeds: [embed], components: [] };
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`lfg:in:${id}`).setLabel(text('lfg.join')).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`lfg:leave:${id}`).setLabel(text('lfg.leave')).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`lfg:cancel:${id}`).setLabel(text('lfg.cancel')).setStyle(ButtonStyle.Danger)
  );
  return { embeds: [embed], components: [row] };
}

function track(id, message) {
  db.prepare('INSERT INTO lfg_messages VALUES (?, ?)').run(id, message.id);
}

function ping(users, text) {
  return { content: `${users.map(u => `<@${u}>`).join(' ')} ${text}`.trim(), allowedMentions: { users } };
}

function noteLink(note) {
  const link = note?.match(/https?:\/\/\S+/)?.[0];
  if (!link || !URL.canParse(link)) return null;
  return { link, url: new URL(link), rest: note.replace(link, '').trim() || null };
}

function isTenorPage(url) {
  return /^(www\.)?tenor\.com$/.test(url.hostname);
}

function directMedia(url) {
  if (isTenorPage(url)) return null;
  if (/\.(png|jpe?g|gif|webp)$/i.test(url.pathname)) return url.href;
  if (url.hostname.endsWith('giphy.com')) {
    const id = url.pathname.split('/').filter(Boolean).pop()?.split('-').pop();
    return id ? `https://media.giphy.com/media/${id}/giphy.gif` : null;
  }
  return null;
}

async function tenorMedia(link) {
  const res = await fetch(link, { headers: { 'User-Agent': 'Khut Discord bot (https://github.com/cankhut/Khut)' }, signal: AbortSignal.timeout(10000) });
  if (res.headers.get('content-type')?.startsWith('image/')) return res.url;
  return (await res.text()).match(/property="og:image" content="([^"]+)"/)?.[1] ?? null;
}

async function addMedia(interaction, id, upload, found) {
  if (upload?.contentType?.startsWith('image/')) {
    const name = `lfg.${upload.name.split('.').pop().toLowerCase()}`;
    db.prepare('UPDATE lfg SET image = ? WHERE id = ?').run(`attachment://${name}`, id);
    return interaction.editReply({ ...card(id), files: [{ attachment: upload.url, name }] });
  }
  if (!found || !isTenorPage(found.url)) return;
  const image = await tenorMedia(found.link).catch(err => log.warn(`Tenor link failed: ${err.message}`));
  if (!image) return;
  db.prepare('UPDATE lfg SET image = ?, note = ? WHERE id = ?').run(image, found.rest, id);
  await interaction.editReply(card(id));
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
  if (!start) return interaction.reply({ content: text('lfg.badTime'), flags: MessageFlags.Ephemeral });
  const players = parsePlayers(interaction.options.getString('players'));
  if (!players) return interaction.reply({ content: text('lfg.badPlayers'), flags: MessageFlags.Ephemeral });

  const upload = interaction.options.getAttachment('image');
  const found = noteLink(interaction.options.getString('note'));
  const image = upload || !found ? null : directMedia(found.url);
  const note = image ? found.rest : interaction.options.getString('note');

  const { lastInsertRowid } = db.prepare('INSERT INTO lfg (guild_id, channel_id, host_id, game, created_at, start_at, slots, extra, note, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(interaction.guildId, interaction.channelId, interaction.user.id, game, Date.now(), start, players.size, players.extra, note, image);
  const id = Number(lastInsertRowid);
  db.prepare('INSERT INTO lfg_members VALUES (?, ?, ?, ?)').run(id, interaction.user.id, 'in', Date.now());

  const subscribers = db.prepare('SELECT user_id FROM subscriptions WHERE guild_id = ? AND game = ? AND user_id != ?')
    .all(interaction.guildId, game, interaction.user.id).map(r => r.user_id);
  const role = roles.roleFor(interaction.guild, game);
  const notify = role
    ? { content: text('lfg.pingRole', { role: `<@&${role}>` }), allowedMentions: { roles: [role] } }
    : { content: subscribers.length ? text('lfg.pingUsers', { users: subscribers.map(u => `<@${u}>`).join(' ') }) : undefined, allowedMentions: { users: subscribers } };
  await interaction.reply({ ...notify, ...card(id) });
  const message = await interaction.fetchReply();
  db.prepare('UPDATE lfg SET message_id = ? WHERE id = ?').run(message.id, id);
  await addMedia(interaction, id, upload, found).catch(err => log.warn(`LFG #${id} image failed: ${err.message}`));
  log.info(`LFG #${id} ${game} by ${interaction.user.tag} in ${interaction.guild.name}, ${role ? 'role' : `${subscribers.length} subscriber(s)`} pinged`);
  await dmSubscribers(interaction, subscribers, game, start, message.url);
}

async function dmSubscribers(interaction, subscribers, game, start, url) {
  const wantDm = new Set(db.prepare('SELECT discord_id FROM dm_on').all().map(r => r.discord_id));
  const when = start - Date.now() > 60000 ? text('lfg.dmStarts', { time: `<t:${Math.floor(start / 1000)}:R>` }) : '';
  const message = {
    content: text('lfg.dm', { host: interaction.user.displayName, game, server: interaction.guild.name }) + when,
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel(text('lfg.dmButton')).setStyle(ButtonStyle.Link).setURL(url))]
  };
  const results = await Promise.allSettled(subscribers.filter(u => wantDm.has(u)).map(async u => (await interaction.client.users.fetch(u)).send(message)));
  for (const r of results.filter(r => r.status === 'rejected')) log.warn(`LFG DM failed: ${r.reason.message}`);
}

async function button(interaction) {
  const [, action, rawId] = interaction.customId.split(':');
  const id = Number(rawId);
  const group = getGroup(id);
  const user = interaction.user.id;
  const ephemeral = { flags: MessageFlags.Ephemeral };

  if (!group || group.status !== 'open') return interaction.reply({ content: text('lfg.groupClosed'), ...ephemeral });

  if (action === 'cancel') {
    if (user !== group.host_id) return interaction.reply({ content: text('lfg.onlyHost'), ...ephemeral });
    db.prepare("UPDATE lfg SET status = 'cancelled', ended_at = ? WHERE id = ?").run(Date.now(), id);
    log.info(`LFG #${id} cancelled`);
    return interaction.update(card(id));
  }

  if (action === 'leave') {
    db.prepare('DELETE FROM lfg_members WHERE lfg_id = ? AND user_id = ?').run(id, user);
  } else if (action === 'in') {
    if (getMembers(id).includes(user)) return interaction.reply({ content: text('lfg.alreadyIn'), ...ephemeral });
    if (getMembers(id).length + group.extra >= group.slots) return interaction.reply({ content: text('lfg.groupFull'), ...ephemeral });
    db.prepare('INSERT INTO lfg_members VALUES (?, ?, ?, ?)').run(id, user, 'in', Date.now());
  }

  await interaction.update(card(id));

  const players = getMembers(id);
  if (action === 'in' && players.length + group.extra === group.slots) {
    track(id, await interaction.followUp(ping(players, text('lfg.squadFull', { game: group.game }))));
  }
}

async function tick(client) {
  const now = Date.now();
  for (const group of db.prepare("SELECT * FROM lfg WHERE status = 'open'").all()) {
    const channel = await client.channels.fetch(group.channel_id).catch(() => null);
    if (!channel) {
      db.prepare("UPDATE lfg SET status = 'deleted' WHERE id = ?").run(group.id);
      continue;
    }

    const players = getMembers(group.id);
    const lead = group.start_at - group.created_at;

    const remind = settings.limits.lfgReminderMinutes * 60000;
    if (lead > remind + 5 * 60000 && !group.reminded && group.start_at - now <= remind) {
      db.prepare('UPDATE lfg SET reminded = 1 WHERE id = ?').run(group.id);
      track(group.id, await channel.send(ping(players, text('lfg.reminder', { game: group.game, time: `<t:${Math.floor(group.start_at / 1000)}:R>`, count: `${players.length + group.extra}/${group.slots}` }))));
    }

    if (lead > 60000 && !group.started && now >= group.start_at) {
      db.prepare('UPDATE lfg SET started = 1 WHERE id = ?').run(group.id);
      track(group.id, await channel.send(ping(players, text('lfg.start', { game: group.game }))));
    }

    if (now >= group.start_at + settings.limits.lfgCloseHours * 3600000) {
      db.prepare("UPDATE lfg SET status = 'closed', ended_at = ? WHERE id = ?").run(now, group.id);
      log.info(`LFG #${group.id} closed`);
      await channel.messages.edit(group.message_id, card(group.id)).catch(() => {});
    }
  }

  const old = db.prepare("SELECT * FROM lfg WHERE status IN ('closed', 'cancelled') AND COALESCE(ended_at, start_at + 7200000) <= ?").all(now - settings.limits.lfgDeleteHours * 3600000);
  for (const group of old) {
    const channel = await client.channels.fetch(group.channel_id).catch(() => null);
    const ids = [group.message_id, ...db.prepare('SELECT message_id FROM lfg_messages WHERE lfg_id = ?').all(group.id).map(r => r.message_id)];
    for (const messageId of ids.filter(Boolean)) await channel?.messages.delete(messageId).catch(() => {});
    db.prepare("UPDATE lfg SET status = 'deleted' WHERE id = ?").run(group.id);
    db.prepare('DELETE FROM lfg_messages WHERE lfg_id = ?').run(group.id);
    log.info(`LFG #${group.id} deleted`);
  }
}

const games = new SlashCommandBuilder()
  .setName('games')
  .setDescription('Select and subscribe to games you want to get notified about')
  .setContexts(InteractionContextType.Guild);

function picker(guildId, userId) {
  const list = db.prepare(`
    SELECT g.name, s.user_id IS NOT NULL AS on_ FROM games g
    LEFT JOIN subscriptions s ON s.guild_id = g.guild_id AND s.game = g.name AND s.user_id = ?
    WHERE g.guild_id = ? ORDER BY g.name
  `).all(userId, guildId).slice(0, 25);
  if (!list.length) return { content: text('games.none'), components: [] };
  return {
    content: text('games.picker'),
    components: gameRows(list.map(g => ({ ...g, id: 'sub' })), g => g.on_ ? ButtonStyle.Success : ButtonStyle.Secondary)
  };
}

function gameRows(list, style) {
  const rows = [];
  for (let i = 0; i < list.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(list.slice(i, i + 5).map(g => new ButtonBuilder()
      .setCustomId(`${g.id}:${g.name}`)
      .setLabel(g.name)
      .setStyle(style(g)))));
  }
  return rows;
}

function panel(guildId) {
  const list = db.prepare('SELECT name FROM games WHERE guild_id = ? ORDER BY name').all(guildId).slice(0, 25);
  return {
    content: list.length
      ? text('games.panel')
      : text('games.none'),
    components: gameRows(list.map(g => ({ id: 'pick', name: g.name })), () => ButtonStyle.Secondary)
  };
}

async function refreshPanel(guild) {
  const settings = guildSettings(guild.id);
  if (!settings.panel_message) return;
  const channel = await guild.channels.fetch(settings.panel_channel).catch(() => null);
  await channel?.messages.edit(settings.panel_message, panel(guild.id)).catch(err => log.warn(`Couldn't update the games panel in ${guild.name}: ${err.message}`));
}

async function postPanel(interaction) {
  const settings = guildSettings(interaction.guildId);
  const old = settings.panel_message && await interaction.guild.channels.fetch(settings.panel_channel).catch(() => null);
  await old?.messages.delete(settings.panel_message).catch(() => {});
  const message = await interaction.channel.send(panel(interaction.guildId));
  db.prepare('UPDATE guilds SET panel_channel = ?, panel_message = ? WHERE guild_id = ?').run(message.channelId, message.id, interaction.guildId);
  log.info(`Games panel posted in #${interaction.channel.name} (${interaction.guild.name})`);
}

function toggle(guildId, game, userId) {
  const args = [guildId, game, userId];
  if (db.prepare('DELETE FROM subscriptions WHERE guild_id = ? AND game = ? AND user_id = ?').run(...args).changes) return false;
  if (!db.prepare('SELECT 1 FROM games WHERE guild_id = ? AND name = ?').get(guildId, game)) return null;
  db.prepare('INSERT INTO subscriptions VALUES (?, ?, ?)').run(...args);
  return true;
}

async function pickButton(interaction) {
  const game = interaction.customId.slice('pick:'.length);
  const on = toggle(interaction.guildId, game, interaction.user.id);
  if (on !== null) await roles.setMember(interaction.guild, game, interaction.user.id, on);
  if (on === null) return interaction.reply({ content: text('games.gone', { game }), flags: MessageFlags.Ephemeral });
  log.info(`${interaction.user.tag} ${on ? 'subscribed to' : 'unsubscribed from'} ${game} (panel)`);
  const view = picker(interaction.guildId, interaction.user.id);
  await interaction.reply({ ...view, content: `${text(on ? 'games.subscribed' : 'games.unsubscribed', { game })}\n${view.content}`, flags: MessageFlags.Ephemeral });
}

async function executeGames(interaction) {
  await interaction.reply({ ...picker(interaction.guildId, interaction.user.id), flags: MessageFlags.Ephemeral });
}

async function subscribeButton(interaction) {
  const game = interaction.customId.slice('sub:'.length);
  const on = toggle(interaction.guildId, game, interaction.user.id);
  if (on !== null) await roles.setMember(interaction.guild, game, interaction.user.id, on);
  if (on !== null) log.info(`${interaction.user.tag} ${on ? 'subscribed to' : 'unsubscribed from'} ${game}`);
  await interaction.update(picker(interaction.guildId, interaction.user.id));
}

module.exports = { data, execute, autocomplete, button, subscribeButton, pickButton, panel, postPanel, refreshPanel, tick, games: { data: games, execute: executeGames } };
