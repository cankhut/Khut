const { SlashCommandBuilder, InteractionContextType, EmbedBuilder } = require('discord.js');
const { guildSettings, setGuild } = require('../db');
const { text } = require('../settings');
const colors = require('../colors');
const core = require('../games/core');
const dlbuild = require('../games/dlbuild');
const lolhero = require('../games/lolhero');
const wftenno = require('../games/wftenno');
const log = require('../log');

const data = new SlashCommandBuilder()
  .setName('play')
  .setDescription('Daily guessing games')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand(s => s.setName('dlbuild').setDescription('Guess Deadlock heroes from their items in a real match')
    .addStringOption(o => o.setName('mode').setDescription('Which matches').setRequired(true).addChoices(
      { name: 'High rank (Ascendant+)', value: 'high' },
      { name: 'All ranks', value: 'all' }
    ))
    .addStringOption(o => o.setName('guess').setDescription('Hero name').setAutocomplete(true)))
  .addSubcommand(s => s.setName('lolhero').setDescription('Guess today\'s League of Legends champion')
    .addStringOption(o => o.setName('mode').setDescription('Game mode').setRequired(true).addChoices(
      { name: 'Classic', value: 'classic' },
      { name: 'Ability', value: 'ability' }
    ))
    .addStringOption(o => o.setName('guess').setDescription('Champion name').setAutocomplete(true)))
  .addSubcommand(s => s.setName('wftenno').setDescription('Guess today\'s Warframe')
    .addStringOption(o => o.setName('mode').setDescription('Game mode').setRequired(true).addChoices(
      { name: 'Classic', value: 'classic' },
      { name: 'Ability', value: 'ability' }
    ))
    .addStringOption(o => o.setName('guess').setDescription('Warframe name').setAutocomplete(true)));

const GAMES = { dlbuild, lolhero, wftenno };

async function execute(interaction) {
  const mode = interaction.options.getString('mode');
  return GAMES[interaction.options.getSubcommand()].play(interaction, mode, interaction.options.getString('guess'));
}

async function autocomplete(interaction) {
  if (interaction.options.getSubcommand() === 'dlbuild') return dlbuild.autocomplete(interaction, interaction.options.getString('mode') ?? 'high');
  await GAMES[interaction.options.getSubcommand()].autocomplete(interaction, interaction.options.getString('mode') ?? 'classic');
}

async function component(interaction) {
  const [, game, ...parts] = interaction.customId.split(':');
  if (game === 'dl') return dlbuild.component(interaction, parts);
  if (game === 'lol') return lolhero.component(interaction, parts);
  if (game === 'wf') return wftenno.component(interaction, parts);
}

const ANSWERS = [
  ['LoL classic', lolhero, 'classic'],
  ['LoL ability', lolhero, 'ability'],
  ['Warframe classic', wftenno, 'classic'],
  ['Warframe ability', wftenno, 'ability'],
  ['dlbuild high rank', dlbuild, 'high'],
  ['dlbuild all ranks', dlbuild, 'all']
];

async function postAnswers(guild, channelId, day) {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return log.warn(`Daily answers channel is gone in ${guild.name}`);
  const embed = new EmbedBuilder().setColor(colors.play).setTitle(text('play.answersTitle'));
  for (const [name, game, mode] of ANSWERS) {
    const value = await game.answer(mode, day).catch(err => log.warn(`Answer for ${name}: ${err.message}`));
    if (!value) continue;
    const found = core.finishedCount(guild.id, game.GAME, mode, day);
    embed.addFields({ name, value: `${value}${found ? `\n-# ${text('play.answersFound', { count: found })}` : ''}`, inline: true });
  }
  if (!embed.data.fields?.length) return;
  await channel.send({ embeds: [embed] });
  log.info(`Posted yesterday's answers in ${guild.name}`);
}

async function tick(client) {
  for (const guild of client.guilds.cache.values()) {
    const settings = guildSettings(guild.id);
    const day = core.today(guild.id);
    if (settings.play_posted === day) continue;
    setGuild(guild.id, 'play_posted', day);
    if (!settings.play_posted || !settings.play_channel) continue;
    await postAnswers(guild, settings.play_channel, core.previousDay(day)).catch(err => log.error(`Daily answers failed in ${guild.name}:`, err));
  }
}

module.exports = { data, execute, autocomplete, component, tick };
