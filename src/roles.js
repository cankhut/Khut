const { PermissionFlagsBits } = require('discord.js');
const { db, guildSettings, setGuild } = require('./db');
const log = require('./log');

const OFF = 0;
const ON = 1;
const TURNING_OFF = 2;
const TURNING_ON = 3;

const warned = new Set();

function canManage(guild) {
  return guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles);
}

function subscribers(guildId, game) {
  return db.prepare('SELECT user_id FROM subscriptions WHERE guild_id = ? AND game = ?').all(guildId, game).map(r => r.user_id);
}

async function giveRole(guild, roleId, users) {
  for (const user of users) await guild.members.addRole({ user, role: roleId }).catch(err => log.debug(`Role for ${user}: ${err.message}`));
}

async function sync(guild) {
  const mode = guildSettings(guild.id).use_roles;
  if (mode === OFF) return;
  if (!canManage(guild)) {
    if (!warned.has(guild.id)) log.warn(`Game roles: Khut needs the Manage Roles permission in ${guild.name}`);
    warned.add(guild.id);
    return;
  }
  warned.delete(guild.id);
  const games = db.prepare('SELECT name, role_id FROM games WHERE guild_id = ?').all(guild.id);
  const setRole = db.prepare('UPDATE games SET role_id = ? WHERE guild_id = ? AND name = ?');

  if (mode === TURNING_OFF) {
    for (const game of games.filter(g => g.role_id)) {
      await guild.roles.delete(game.role_id, 'Khut game roles turned off').catch(() => {});
      setRole.run(null, guild.id, game.name);
    }
    setGuild(guild.id, 'use_roles', OFF);
    log.info(`Game roles removed in ${guild.name}`);
    return;
  }

  for (const game of games) {
    const exists = game.role_id && guild.roles.cache.has(game.role_id);
    if (exists && mode === ON) continue;
    let roleId = game.role_id;
    if (!exists) {
      roleId = (await guild.roles.create({ name: game.name, mentionable: true, reason: 'Khut game role' })).id;
      setRole.run(roleId, guild.id, game.name);
    }
    const users = subscribers(guild.id, game.name);
    await giveRole(guild, roleId, users);
    log.info(`Game role ${game.name} ready in ${guild.name} (${users.length} subscriber(s))`);
  }
  if (mode === TURNING_ON) setGuild(guild.id, 'use_roles', ON);
}

function turn(guildId, on) {
  const mode = guildSettings(guildId).use_roles;
  if (on && mode !== ON && mode !== TURNING_ON) setGuild(guildId, 'use_roles', TURNING_ON);
  if (!on && mode !== OFF && mode !== TURNING_OFF) setGuild(guildId, 'use_roles', TURNING_OFF);
}

function isOn(guildId) {
  const mode = guildSettings(guildId).use_roles;
  return mode === ON || mode === TURNING_ON;
}

function roleFor(guild, game) {
  if (guildSettings(guild.id).use_roles !== ON) return null;
  const roleId = db.prepare('SELECT role_id FROM games WHERE guild_id = ? AND name = ?').get(guild.id, game)?.role_id;
  return roleId && guild.roles.cache.has(roleId) ? roleId : null;
}

async function setMember(guild, game, userId, on) {
  const roleId = guild && roleFor(guild, game);
  if (!roleId) return;
  await guild.members[on ? 'addRole' : 'removeRole']({ user: userId, role: roleId }).catch(err => log.warn(`Couldn't ${on ? 'give' : 'remove'} the ${game} role in ${guild.name}: ${err.message}`));
}

async function tick(client) {
  for (const guild of client.guilds.cache.values()) await sync(guild).catch(err => log.error(`Game roles failed in ${guild.name}:`, err));
}

module.exports = { sync, turn, isOn, canManage, roleFor, setMember, tick };
