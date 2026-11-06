const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Show every Khut command');

const sections = [
  ['📊 Stats', [
    '`/stats game:Deadlock` — your Deadlock stats',
    '`/stats game:League player:Name#Tag` — someone\'s League stats',
    '`/stats game:CS2 player:@Talha` — works with @mentions, Steam links and friend codes',
    '`/stats game:Discord player:@Talha` — their voice time',
    '`/stats game:Discord player:@Talha with:@Jankat` — voice time between two people'
  ]],
  ['👥 Group', [
    '`/lfg game:Deadlock time:9pm players:3/6` — look for players (time: now, 30m, 2h, 21:00, 9pm · players: how many you have / team size)',
    '`/games` — subscribe to games so you get pinged when someone looks for players',
    '`/dm on` · `/dm off` — also get those pings as a DM'
  ]],
  ['🔄 Wrapped', [
    '`/wrapped` — server voice Wrapped for this month, last month, this year or all time'
  ]],
  ['🔗 Accounts', [
    '`/link steam:<profile link> riot:<Name#Tag>` — so people can look you up with @you',
    '`/mydata` — see, pause or delete what Khut stores about you'
  ]],
  ['⚙️ Admins', [
    '`/setup addgame` · `/setup removegame` · `/setup wrapped` · `/setup timezone`'
  ]]
];

async function execute(interaction) {
  const embed = new EmbedBuilder()
    .setColor(require('../colors').help)
    .setTitle('Khut commands')
    .addFields(sections.map(([name, lines]) => ({ name, value: lines.join('\n') })))
    .setFooter({ text: 'Khut · Open source (AGPL-3.0) · github.com/cankhut/khut' });
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

module.exports = { data, execute };
