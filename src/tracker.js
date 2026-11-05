const { EmbedBuilder } = require('discord.js');
const { db, guildSettings, setGuild } = require('./db');
const { parts, dayKey, monthKey, monthRange, formatMinutes } = require('./time');

const active = new Map();

const addUser = db.prepare(`
  INSERT INTO voice_minutes (guild_id, user_id, day, game, minutes) VALUES (?, ?, ?, ?, 1)
  ON CONFLICT(guild_id, user_id, day, game) DO UPDATE SET minutes = minutes + 1
`);
const addPair = db.prepare(`
  INSERT INTO pair_minutes (guild_id, user_a, user_b, day, minutes) VALUES (?, ?, ?, ?, 1)
  ON CONFLICT(guild_id, user_a, user_b, day) DO UPDATE SET minutes = minutes + 1
`);
const addChannel = db.prepare(`
  INSERT INTO channel_minutes (guild_id, day, minutes) VALUES (?, ?, 1)
  ON CONFLICT(guild_id, day) DO UPDATE SET minutes = minutes + 1
`);
const addSession = db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)');

async function tick(client) {
  const now = Date.now();
  const optedOut = new Set(db.prepare('SELECT discord_id FROM opt_out').all().map(r => r.discord_id));
  const seen = new Set();

  for (const guild of client.guilds.cache.values()) {
    const settings = guildSettings(guild.id);
    const day = dayKey(settings.timezone, now);

    for (const channel of guild.channels.cache.values()) {
      if (!channel.isVoiceBased() || channel.id === guild.afkChannelId) continue;
      const members = [...channel.members.values()].filter(m => !m.user.bot && !optedOut.has(m.id));
      if (members.length < 2) continue;

      addChannel.run(guild.id, day);
      for (const member of members) {
        const game = member.presence?.activities.find(a => a.type === 0)?.name ?? '';
        addUser.run(guild.id, member.id, day, game);
        const key = `${guild.id}:${member.id}`;
        seen.add(key);
        const session = active.get(key);
        if (session) session.last = now;
        else active.set(key, { start: now, last: now });
      }

      const ids = members.map(m => m.id).sort();
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) addPair.run(guild.id, ids[i], ids[j], day);
      }
    }

    await postWrapped(guild, settings).catch(console.error);
  }

  for (const [key, session] of active) {
    if (seen.has(key)) continue;
    const [guildId, userId] = key.split(':');
    addSession.run(guildId, userId, session.start, session.last + 60000);
    active.delete(key);
  }
}

function wrappedEmbed(guildId, month, tz) {
  const from = `${month}-01`;
  const to = `${month}-31`;
  const [start, end] = monthRange(tz, month);
  const get = sql => db.prepare(sql).get(guildId, from, to);

  const total = get('SELECT SUM(minutes) AS m FROM channel_minutes WHERE guild_id = ? AND day BETWEEN ? AND ?').m;
  if (!total) return null;
  const top = get('SELECT user_id, SUM(minutes) AS m FROM voice_minutes WHERE guild_id = ? AND day BETWEEN ? AND ? GROUP BY user_id ORDER BY m DESC LIMIT 1');
  const duo = get('SELECT user_a, user_b, SUM(minutes) AS m FROM pair_minutes WHERE guild_id = ? AND day BETWEEN ? AND ? GROUP BY user_a, user_b ORDER BY m DESC LIMIT 1');
  const game = get("SELECT game, SUM(minutes) AS m FROM voice_minutes WHERE guild_id = ? AND day BETWEEN ? AND ? AND game != '' GROUP BY game ORDER BY m DESC LIMIT 1");

  const sessions = db.prepare('SELECT user_id, start_at, end_at FROM sessions WHERE guild_id = ? AND start_at >= ? AND start_at < ?').all(guildId, start, end);
  const longest = sessions.reduce((best, s) => (!best || s.end_at - s.start_at > best.end_at - best.start_at ? s : best), null);
  const lateScore = s => {
    const p = parts(tz, s.end_at);
    return (p.hour * 60 + p.minute + 12 * 60) % (24 * 60);
  };
  const latest = sessions.reduce((best, s) => (!best || lateScore(s) > lateScore(best) ? s : best), null);

  const [year, m] = month.split('-').map(Number);
  const title = new Date(Date.UTC(year, m - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const lines = [
    `⏱️ ${formatMinutes(total)} in voice together`,
    top && `👑 Most active: <@${top.user_id}> (${formatMinutes(top.m)})`,
    duo && `🤝 Top duo: <@${duo.user_a}> + <@${duo.user_b}> (${formatMinutes(duo.m)})`,
    game && `🎮 Most played: ${game.game} (${formatMinutes(game.m)})`,
    longest && `🔥 Longest session: <@${longest.user_id}> (${formatMinutes(Math.round((longest.end_at - longest.start_at) / 60000))})`,
    latest && (() => {
      const p = parts(tz, latest.end_at);
      return `🌙 Latest night: ${p.weekday}, ended ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
    })()
  ];

  return new EmbedBuilder().setTitle(`📊 ${title} Wrapped`).setDescription(lines.filter(Boolean).join('\n'));
}

async function postWrapped(guild, settings) {
  if (!settings.wrapped_channel) return;
  const month = monthKey(settings.timezone, Date.now(), -1);
  if (settings.last_wrapped === month) return;
  setGuild(guild.id, 'last_wrapped', month);

  const embed = wrappedEmbed(guild.id, month, settings.timezone);
  const channel = await guild.channels.fetch(settings.wrapped_channel).catch(() => null);
  if (embed && channel) await channel.send({ embeds: [embed] });
}

module.exports = { tick, wrappedEmbed };
