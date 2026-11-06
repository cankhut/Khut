const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { db, getLinks } = require('../db');

const data = new SlashCommandBuilder()
  .setName('mydata')
  .setDescription('See or control what the bot stores about you')
  .addStringOption(o => o.setName('action').setDescription('What to do').setRequired(true).addChoices(
    { name: 'Show what is stored', value: 'show' },
    { name: 'Unlink my accounts', value: 'unlink' },
    { name: 'Pause voice tracking', value: 'pause' },
    { name: 'Resume voice tracking', value: 'resume' },
    { name: 'Delete everything about me', value: 'delete' }
  ));

async function execute(interaction) {
  const id = interaction.user.id;
  const action = interaction.options.getString('action');
  const reply = content => interaction.reply({ content, flags: MessageFlags.Ephemeral });

  if (action === 'show') {
    const links = getLinks(id);
    const minutes = db.prepare('SELECT COALESCE(SUM(minutes), 0) AS m FROM voice_minutes WHERE user_id = ?').get(id).m;
    const paused = db.prepare('SELECT 1 FROM opt_out WHERE discord_id = ?').get(id);
    const subs = db.prepare('SELECT game FROM subscriptions WHERE user_id = ? AND guild_id = ?').all(id, interaction.guildId ?? '').map(r => r.game);
    return reply([
      `Steam: ${links?.steam_id ?? '-'}`,
      `Riot: ${links?.riot_id ?? '-'}`,
      `Voice minutes stored: ${minutes}`,
      `Voice tracking: ${paused ? 'paused' : 'on'}`,
      `LFG pings here: ${subs.join(', ') || '-'}`,
      `LFG DMs: ${db.prepare('SELECT 1 FROM dm_on WHERE discord_id = ?').get(id) ? 'on' : 'off'}`
    ].join('\n'));
  }

  if (action === 'unlink') {
    db.prepare('DELETE FROM links WHERE discord_id = ?').run(id);
    return reply('Your Steam and Riot links are removed.');
  }

  if (action === 'pause') {
    db.prepare('INSERT OR IGNORE INTO opt_out VALUES (?)').run(id);
    return reply('Voice tracking paused. Your old data stays until you delete it.');
  }

  if (action === 'resume') {
    db.prepare('DELETE FROM opt_out WHERE discord_id = ?').run(id);
    return reply('Voice tracking is on again.');
  }

  if (action === 'delete') {
    db.prepare('DELETE FROM links WHERE discord_id = ?').run(id);
    db.prepare('DELETE FROM voice_minutes WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM pair_minutes WHERE user_a = ? OR user_b = ?').run(id, id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM lfg_members WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM subscriptions WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM dm_on WHERE discord_id = ?').run(id);
    db.prepare('INSERT OR IGNORE INTO opt_out VALUES (?)').run(id);
    return reply('Everything about you is deleted and voice tracking is paused. Use /mydata Resume voice tracking to turn it back on.');
  }
}

module.exports = { data, execute };
