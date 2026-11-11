const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(process.env.DB_PATH || 'data.db');

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS links (discord_id TEXT PRIMARY KEY, steam_id TEXT, riot_id TEXT, brawlhalla_id TEXT);
  CREATE TABLE IF NOT EXISTS opt_out (discord_id TEXT PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS dm_on (discord_id TEXT PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS guilds (guild_id TEXT PRIMARY KEY, timezone TEXT NOT NULL DEFAULT 'Europe/Istanbul', wrapped_auto INTEGER NOT NULL DEFAULT 1, last_wrapped TEXT);
  CREATE TABLE IF NOT EXISTS games (guild_id TEXT, name TEXT, role_id TEXT, PRIMARY KEY (guild_id, name));
  CREATE TABLE IF NOT EXISTS subscriptions (guild_id TEXT, game TEXT, user_id TEXT, PRIMARY KEY (guild_id, game, user_id));
  CREATE TABLE IF NOT EXISTS lfg (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, channel_id TEXT, message_id TEXT, host_id TEXT, game TEXT, created_at INTEGER, start_at INTEGER, slots INTEGER, note TEXT, status TEXT NOT NULL DEFAULT 'open', reminded INTEGER NOT NULL DEFAULT 0, started INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS lfg_messages (lfg_id INTEGER, message_id TEXT);
  CREATE TABLE IF NOT EXISTS lfg_members (lfg_id INTEGER, user_id TEXT, state TEXT, joined_at INTEGER, PRIMARY KEY (lfg_id, user_id));
  CREATE TABLE IF NOT EXISTS voice_minutes (guild_id TEXT, user_id TEXT, day TEXT, game TEXT NOT NULL DEFAULT '', minutes INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (guild_id, user_id, day, game));
  CREATE TABLE IF NOT EXISTS pair_minutes (guild_id TEXT, user_a TEXT, user_b TEXT, day TEXT, minutes INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (guild_id, user_a, user_b, day));
  CREATE TABLE IF NOT EXISTS channel_minutes (guild_id TEXT, day TEXT, minutes INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (guild_id, day));
  CREATE TABLE IF NOT EXISTS lol_matches (match_id TEXT, puuid TEXT, queue INTEGER, champion INTEGER, kills INTEGER, deaths INTEGER, assists INTEGER, win INTEGER, PRIMARY KEY (match_id, puuid));
  CREATE TABLE IF NOT EXISTS sessions (guild_id TEXT, user_id TEXT, start_at INTEGER, end_at INTEGER);
  CREATE TABLE IF NOT EXISTS cleanup (channel_id TEXT, message_id TEXT PRIMARY KEY, delete_at INTEGER);
  CREATE TABLE IF NOT EXISTS play_puzzles (game TEXT, mode TEXT, day TEXT, data TEXT, PRIMARY KEY (game, mode, day));
  CREATE TABLE IF NOT EXISTS emoji_sources (name TEXT PRIMARY KEY, stamp TEXT);
  CREATE TABLE IF NOT EXISTS emoji_names (name TEXT PRIMARY KEY, key TEXT);
  CREATE TABLE IF NOT EXISTS play_progress (user_id TEXT, game TEXT, mode TEXT, day TEXT, state TEXT, done INTEGER NOT NULL DEFAULT 0, guild_id TEXT, PRIMARY KEY (user_id, game, mode, day));
`);

for (const sql of [
  'ALTER TABLE links ADD COLUMN brawlhalla_id TEXT',
  'ALTER TABLE lfg ADD COLUMN extra INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE lfg ADD COLUMN image TEXT',
  'ALTER TABLE lfg ADD COLUMN ended_at INTEGER',
  "ALTER TABLE guilds ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Europe/Istanbul'",
  'ALTER TABLE guilds ADD COLUMN wrapped_auto INTEGER NOT NULL DEFAULT 1',
  'ALTER TABLE guilds ADD COLUMN last_wrapped TEXT',
  'ALTER TABLE guilds ADD COLUMN panel_channel TEXT',
  'ALTER TABLE guilds ADD COLUMN panel_message TEXT',
  'ALTER TABLE guilds ADD COLUMN use_roles INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE guilds ADD COLUMN play_channel TEXT',
  'ALTER TABLE guilds ADD COLUMN play_posted TEXT'
]) {
  try {
    db.exec(sql);
  } catch {}
}

function guildSettings(guildId) {
  db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)').run(guildId);
  return db.prepare('SELECT * FROM guilds WHERE guild_id = ?').get(guildId);
}

function setGuild(guildId, field, value) {
  guildSettings(guildId);
  db.prepare(`UPDATE guilds SET ${field} = ? WHERE guild_id = ?`).run(value, guildId);
}

function getLinks(discordId) {
  return db.prepare('SELECT * FROM links WHERE discord_id = ?').get(discordId);
}

function saveLinks(discordId, steamId, riotId, brawlhallaId) {
  db.prepare(`
    INSERT INTO links (discord_id, steam_id, riot_id, brawlhalla_id) VALUES (?, ?, ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET
      steam_id = COALESCE(excluded.steam_id, steam_id),
      riot_id = COALESCE(excluded.riot_id, riot_id),
      brawlhalla_id = COALESCE(excluded.brawlhalla_id, brawlhalla_id)
  `).run(discordId, steamId ?? null, riotId ?? null, brawlhallaId ?? null);
}

module.exports = { db, guildSettings, setGuild, getLinks, saveLinks };
