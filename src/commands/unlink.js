const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { db, getLinks, wowCharacters, removeWowCharacters } = require('../db');
const { slugName } = require('../wowcards');
const { text } = require('../settings');

const ACCOUNTS = { steam: ['Steam', 'steam_id'], riot: ['Riot', 'riot_id'], brawlhalla: ['Brawlhalla', 'brawlhalla_id'] };

const data = new SlashCommandBuilder()
  .setName('unlink')
  .setDescription('Remove a linked account or WoW: Forever character')
  .addStringOption(o => o.setName('account').setDescription('What to remove').setRequired(true).addChoices(
    { name: 'Steam', value: 'steam' },
    { name: 'Riot', value: 'riot' },
    { name: 'Brawlhalla', value: 'brawlhalla' },
    { name: 'WoW: Forever character', value: 'wow' },
    { name: 'Everything', value: 'all' }
  ))
  .addStringOption(o => o.setName('character').setDescription('WoW: Forever only. Empty: all your characters').setAutocomplete(true));

async function execute(interaction) {
  const id = interaction.user.id;
  const account = interaction.options.getString('account');
  const reply = content => interaction.reply({ content, flags: MessageFlags.Ephemeral });

  if (account === 'all') {
    db.prepare('DELETE FROM links WHERE discord_id = ?').run(id);
    removeWowCharacters(id);
    return reply(text('mydata.unlink'));
  }
  if (account === 'wow') {
    const input = interaction.options.getString('character')?.trim();
    const target = input && wowCharacters(id).find(c => `${c.region}/${c.slug}` === input || c.slug === input.toLowerCase().replace(/\s+/g, '-'));
    if (input && !target) return reply(text('unlink.nothing'));
    if (!removeWowCharacters(id, target?.region, target?.slug)) return reply(text('unlink.nothing'));
    return reply(text('unlink.done', { what: target ? `${slugName(target.slug)} (${target.region.toUpperCase()})` : 'WoW: Forever' }));
  }
  const [name, column] = ACCOUNTS[account];
  if (!getLinks(id)?.[column]) return reply(text('unlink.nothing'));
  db.prepare(`UPDATE links SET ${column} = NULL WHERE discord_id = ?`).run(id);
  return reply(text('unlink.done', { what: name }));
}

async function autocomplete(interaction) {
  await interaction.respond(wowCharacters(interaction.user.id).map(c => ({ name: `${slugName(c.slug)} (${c.region.toUpperCase()})`, value: `${c.region}/${c.slug}` })));
}

module.exports = { data, execute, autocomplete };
