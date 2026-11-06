const { db } = require('./db');
const log = require('./log');

function later(message, ms) {
  db.prepare('INSERT INTO cleanup VALUES (?, ?, ?)').run(message.channelId, message.id, Date.now() + ms);
}

async function tick(client) {
  const due = db.prepare('SELECT * FROM cleanup WHERE delete_at <= ?').all(Date.now());
  for (const row of due) {
    const channel = await client.channels.fetch(row.channel_id).catch(() => null);
    await channel?.messages.delete(row.message_id)
      .then(() => log.debug(`Deleted old message ${row.message_id}`))
      .catch(err => log.debug(`Couldn't delete message ${row.message_id}: ${err.message}`));
    db.prepare('DELETE FROM cleanup WHERE message_id = ?').run(row.message_id);
  }
}

module.exports = { later, tick };
