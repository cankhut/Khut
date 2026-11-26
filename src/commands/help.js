const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Show every Khut command');

const sections = [
  ['📊 Stats', [
    '`/stats deadlock` — your Deadlock stats',
    '`/stats league player:Name#Tag` — someone\'s League stats',
    '`/stats cs2 player:@Talha` — works with @mentions, Steam links and friend codes',
    '`/stats brawlhalla player:1234567` — lifetime, ranked 1v1/2v2/3v3, combat and legend stats',
    '`/stats discord player:@Talha` — their voice time',
    '`/stats discord player:@Talha with:@Jankat` — voice time between two people'
  ]],
  ['🎲 Games', [
    '`/play dlbuild mode:High rank guess:Haze` — guess Deadlock heroes from their items in a real match',
    '`/play lolhero mode:Classic guess:Ahri` — guess today\'s League champion (also Ability mode)',
    '`/play framedle mode:Classic guess:Excalibur` — guess today\'s Warframe (also Ability mode)',
    '`/leaderboard game:dlbuild` — the best players in this server this week, this month or all time'
  ]],
  ['🌍 Warframe', [
    '`/warframe cycle` — open world cycles, Archon Hunt, Sortie, Steel Path, Baro, Darvo and news'
  ]],
  ['👥 Group', [
    '`/lfg game:Deadlock time:9pm players:3/6` — look for players (time: now, 30m, 2h, 21:00, 9pm · players: how many you have / team size)',
    '`/lfg game:Deadlock note:<GIF link>` or `image:` — show a GIF or picture on the post',
    '`/games` — subscribe to games so you get pinged when someone looks for players',
    '`/dm on` · `/dm off` — also get those pings as a DM'
  ]],
  ['🔄 Wrapped', [
    '`/wrapped` — server voice Wrapped for this month, last month, this year or all time'
  ]],
  ['🐉 WoW: Forever', [
    '`/stats wow character` — your linked characters. Add `name:@Talha` for theirs, or `name:<Name Surname>` for anyone',
    '`/stats wow guild name:<guild>` — a guild\'s members, classes and leaders',
    '`/price wow item:<item>` — auction house prices for Alliance, Horde and Blackwater'
  ]],
  ['🔗 Accounts', [
    '`/link steam:<profile link> riot:<Name#Tag> brawlhalla:<ID> wow:<Name Surname>` — link accounts for @mentions (repeat `wow:` for more characters)',
    '`/unlink account:<account>` — remove one linked account or character',
    '`/mydata` — see, pause or delete what Khut stores about you'
  ]],
  ['⚙️ Admins', [
    '`/setup games` — post a fixed game picker in this channel (for onboarding or a rules-like channel)',
    '`/setup answers` — post yesterday\'s /play answers in a channel',
    '`/setup roles` — make a role for each game and ping the role in LFG posts instead of each person',
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
