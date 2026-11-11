const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'settings.json');

const defaults = {
  colors: {
    deadlock: '#69E799',
    cs2: '#FF9800',
    lol: '#3EA6AE',
    brawlhalla: '#D7A644',
    discord: '#5865F2',
    wrapped: '#FEE75C',
    help: '#5865F2',
    lfgOpen: '#689F38',
    lfgFull: '#EF6C00',
    lfgClosed: '#4F545C',
    lfgCancelled: '#ED4245',
    play: '#1238E0',
    leaderboard: '#F1C40F'
  },
  limits: {
    lfgReminderMinutes: 10,
    lfgCloseHours: 2,
    lfgDeleteHours: 12,
    errorDeleteHours: 2,
    voiceMinPeople: 2
  },
  results: {
    lolhero: [
      { max: 1, text: "🤯 {user} found today's lolhero {mode} on the **first** try!" },
      { max: 3, text: "⚡ {user} found today's lolhero {mode} in **{count}** {guesses}" },
      { max: 6, text: "{user} found today's lolhero {mode} in **{count}** {guesses}" },
      { max: 99, text: "😅 {user} found today's lolhero {mode} in **{count}** {guesses}. Got there in the end!" }
    ],
    dlbuild: [
      { min: 90, text: "🏆 {user} finished today's dlbuild ({mode}) with **{points}** points\n{grid}" },
      { min: 50, text: "{user} finished today's dlbuild ({mode}) with **{points}** points\n{grid}" },
      { min: 0, text: "😵 {user} finished today's dlbuild ({mode}) with **{points}** points\n{grid}" }
    ],
    streak: [
      { min: 2, place: 'before', text: '{days}x streak 🔥' }
    ]
  },
  icons: {
    games: []
  },
  status: {
    type: 'None',
    text: '',
    bio: ''
  },
  panel: {
    autoStart: false,
    restartOnCrash: true
  },
  texts: {
    'error': 'Something went wrong.',

    'stats.notFound': "Couldn't find stats for that player.",
    'stats.rateLimit': 'Too many lookups right now. Try again in a minute.',
    'stats.noMatches': 'No match data found for that player.',
    'stats.noSteam': 'No Steam account found. Use their Steam profile link or friend code.',
    'stats.noSteamLinked': 'No Steam account linked. Use /link or a Steam profile link.',
    'stats.noRiot': 'No Riot ID found. Use a Riot ID like Name#Tag.',
    'stats.noRiotLinked': 'No Riot ID linked. Use /link or a Riot ID like Name#Tag.',
    'stats.noBrawlhalla': 'Enter a numeric Brawlhalla ID (shown at the top-right of the Inventory tab), or link it with /link.',
    'stats.noBrawlhallaLinked': 'No Brawlhalla ID linked. Use /link brawlhalla:<ID> first.',
    'stats.noCs': "No CS2 stats found. Their Steam game details are private and they aren't on Leetify or FACEIT.",
    'stats.discordServerOnly': 'Discord stats only work inside a server.',
    'stats.discordMention': 'For Discord, mention someone in player, like @Emre.',

    'card.unranked': 'Unranked',
    'card.dlTitle': 'Deadlock',
    'card.dlOverall': 'Overall',
    'card.dlRanked': 'Ranked',
    'card.dlTopHeroes': 'Top heroes',
    'card.csTitle': 'Counter-Strike 2',
    'card.csRanks': 'Ranks',
    'card.csLifetime': 'Lifetime (Steam)',
    'card.csPlaytime': 'Playtime',
    'card.csRatings': 'Ratings',
    'card.csBans': '⚠️ Bans',
    'card.lolTitle': 'League of Legends · {region}',
    'card.lolRecent': "Last {count} Summoner's Rift games",
    'card.lolNoGames': 'No games yet',
    'card.lolSolo': 'Ranked Solo/Duo · season',
    'card.lolFlex': 'Ranked Flex · season',
    'card.lolTopRanked': 'Top champions (ranked, this season)',
    'card.lolTopRecent': 'Top champions (last {count})',
    'card.lolLoading': '⏳ Loading season games: {loaded}/{total}. Card will get updated.',
    'card.bhTitle': 'Player Statistics',
    'card.bhRanked': '🏆 Ranked {queue}',
    'card.bhTeams': '🛡️ Ranked 2v2 Teams',
    'card.bhLifetime': '📊 Lifetime',
    'card.bhCombat': '⚔️ Combat',
    'card.bhMostPlayed': '⭐ Most Played Legends',
    'card.bhTopRanked': '🎖️ Top 1v1 Legends',
    'card.bhNoRanked': 'No ranked {queue} matches recorded this season.',
    'card.bhRankedDown': 'Ranked {queue} stats are temporarily unavailable.',
    'card.bhNoTeams': 'No ranked 2v2 teams found.',
    'card.bhTeamsDown': 'Ranked 2v2 stats are temporarily unavailable.',
    'card.bhNoLegends': 'No legend playtime data.',
    'card.bhNoRankedLegends': 'No ranked legend data.',

    'lfg.pingUsers': '-# 🔔 ||{users}||',
    'lfg.pingRole': '-# 🔔 {role}',
    'lfg.host': 'Host: {host}',
    'lfg.join': 'Join',
    'lfg.leave': 'Leave',
    'lfg.cancel': 'Cancel',
    'lfg.footerCancelled': 'Cancelled',
    'lfg.footerClosed': 'Closed',
    'lfg.other': '+{count} other',
    'lfg.others': '+{count} others',
    'lfg.badTime': 'Time format: now, 30m, 2h, 21:00 or 9pm',
    'lfg.badPlayers': 'Players format: 3/6 or just 6.',
    'lfg.groupClosed': 'This group is closed.',
    'lfg.onlyHost': 'Only the host can cancel.',
    'lfg.alreadyIn': "You're already in.",
    'lfg.groupFull': 'This group is full.',
    'lfg.squadFull': 'squad is full for **{game}**.',
    'lfg.reminder': '**{game}** starts {time} ({count})',
    'lfg.start': 'time to play **{game}**!',
    'lfg.dm': '🎮 **{host}** is looking for **{game}** players in **{server}**.',
    'lfg.dmStarts': ' Starts {time}.',
    'lfg.dmButton': 'Take Me There',

    'games.picker': 'Green means you subscribed to that game. Click to turn on or off.',
    'games.none': 'No games yet. An admin can add them with /setup addgame.',
    'games.panel': '## 🎮 Pick your games\nClick a game to get notified when someone is looking for players. Click it again to turn it off.\nYou can change this later with `/games`.',
    'games.subscribed': '✅ Subscribed to **{game}**.',
    'games.unsubscribed': '❌ Unsubscribed from **{game}**.',
    'games.gone': "**{game}** isn't on the list anymore.",

    'dm.on': "DMs on. You'll also get a DM for LFG posts in the games you subscribed to.",
    'dm.off': "DMs off. You'll only be pinged in the channel.",

    'play.unavailable': "Today's puzzle couldn't be loaded. Try again in a few minutes.",
    'play.newDay': "This board is from an earlier day. Use /play again for today's puzzle.",
    'play.finished': "You already finished today's puzzle. The next one starts {time}.",
    'play.unknown': "Couldn't find that name. Check the spelling and try again.",
    'play.didYouMean': 'Did you mean {names}?',
    'play.guessButton': 'Guess',
    'play.pickHero': 'Pick a hero',
    'play.pickOne': 'Pick one hero from one of the lists.',
    'play.repeat': 'You already guessed {name}.',
    'play.classicIntro': "Guess today's champion. Each guess shows how close it is: 🟩 match · 🟧 partly · 🟥 no",
    'play.abilityIntro': 'Which champion has this ability? It gets its colour back after 3 wrong guesses and turns upright after 6.',
    'play.clue': '🔍 Clue: one of their abilities',
    'play.solved': '🎉 It was **{name}**! Found in {count} {guesses}.',
    'play.dlCorrect': '✅ It was **{hero}**! +{points} points',
    'play.dlWrong': '❌ It was **{hero}**.',
    'play.dlDone': '🏁 Done! **{points}** points. The next one starts {time}.',
    'play.dlMore': '**{points}** points so far. Keep going with a bonus round? Each one is another hero from the same match, for the same points.',
    'play.dlChoose': 'Press **Keep going** for a bonus round, or **Stop** to end the game.',
    'play.keepGoing': 'Keep going',
    'play.stop': 'Stop',
    'play.statlocker': 'Match on Statlocker',
    'leaderboard.title': '🏆 {game} · {period}',
    'leaderboard.dlRow': '{place} {user} · **{points}** points · {games} played',
    'leaderboard.lolRow': '{place} {user} · **{solved}** solved · {average} guesses on average',
    'leaderboard.you': 'You: {line}',
    'leaderboard.empty': 'Nobody in this server has played {game} in this time yet.',
    'leaderboard.footer': 'Scores from every server you share with Khut',
    'play.dlHint': 'Press ✏️ **Guess** to type a hero.',
    'play.lolHint': 'Press ✏️ **Guess** to type a champion.',
    'play.answersTitle': "📅 Yesterday's answers",
    'play.answersFound': '{count} found it here',

    'link.usage': 'Use `/link steam:<profile link or friend code> riot:<Name#Tag> brawlhalla:<ID>`',
    'link.connect': 'This reads the Steam and Riot accounts connected to your Discord profile. Brawlhalla IDs cannot be read from Discord, so add yours with `/link brawlhalla:<ID>`.',
    'link.connectButton': 'Connect with Discord',
    'link.badSteam': "Couldn't find that Steam account.",
    'link.badRiot': "Couldn't find that Riot ID.",
    'link.badBrawlhalla': 'Brawlhalla ID must be a positive number. Find it at the top-right of the Inventory tab.',
    'link.done': 'Linked!',

    'mydata.unlink': 'Your Steam, Riot and Brawlhalla links are removed.',
    'mydata.pause': 'Voice tracking paused. Your old data stays until you delete it.',
    'mydata.resume': 'Voice tracking is on again.',
    'mydata.delete': 'Everything about you is deleted and voice tracking is paused. Use /mydata Resume voice tracking to turn it back on.',

    'wrapped.none': 'No voice time recorded yet.',

    'setup.added': 'Added **{game}**.',
    'setup.exists': '**{game}** already exists.',
    'setup.limit': 'Up to 25 games are supported.',
    'setup.removed': 'Removed **{game}**.',
    'setup.unknown': "**{game}** isn't on the list.",
    'setup.wrappedOn': "Wrapped will be posted automatically in the server's system messages channel at the start of each month.",
    'setup.wrappedOff': 'Automatic Wrapped is off. Anyone can still use /wrapped.',
    'setup.timezone': 'Timezone set to **{timezone}**.',
    'setup.badTimezone': 'Unknown timezone. Use a name like Europe/Istanbul or America/Toronto.',
    'setup.answers': 'Yesterday\'s /play answers will be posted in {channel} after midnight.',
    'setup.answersOff': 'Yesterday\'s /play answers won\'t be posted anymore.',
    'setup.rolesOn': 'Game roles are on. Khut makes a role for each game, gives it to subscribers and LFG posts ping the role.',
    'setup.rolesOff': 'Game roles are off. Khut deleted its game roles and pings subscribers directly again.',
    'setup.noManageRoles': 'Khut needs the Manage Roles permission for game roles.',
    'setup.panelPosted': 'Posted. It updates by itself when you add or remove games.',
    'setup.panelFailed': "I can't post here. Give Khut View Channel and Send Messages in this channel."
  }
};

const settings = {};

function load() {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {}
  for (const key of Object.keys(defaults)) settings[key] = { ...defaults[key], ...saved[key] };
}

function save(next) {
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2));
  load();
}

function color(name) {
  return parseInt(settings.colors[name].slice(1), 16);
}

function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
}

function text(key, vars = {}) {
  return fill(settings.texts[key] ?? defaults.texts[key], vars);
}

function streakText(days, message) {
  const row = [...settings.results.streak].sort((a, b) => b.min - a.min).find(r => days >= r.min);
  if (!row) return message;
  const tag = fill(row.text, { days });
  if (row.place !== 'after') return `${tag} ${message}`;
  const [first, ...rest] = message.split('\n');
  return [`${first} ${tag}`, ...rest].join('\n');
}

function resultText(game, value, vars) {
  const rows = settings.results[game]?.length ? settings.results[game] : defaults.results[game];
  const sorted = game === 'lolhero' ? [...rows].sort((a, b) => a.max - b.max) : [...rows].sort((a, b) => b.min - a.min);
  const row = sorted.find(r => (game === 'lolhero' ? value <= r.max : value >= r.min)) ?? sorted[sorted.length - 1];
  return fill(row.text, vars);
}

load();
fs.watchFile(FILE, { interval: 2000 }, load).unref();

module.exports = { settings, defaults, save, color, text, resultText, streakText };
