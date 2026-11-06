const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'settings.json');

const defaults = {
  colors: {
    deadlock: '#69E799',
    cs2: '#FF9800',
    lol: '#3EA6AE',
    discord: '#5865F2',
    wrapped: '#FEE75C',
    help: '#5865F2',
    lfgOpen: '#689F38',
    lfgFull: '#EF6C00',
    lfgClosed: '#4F545C',
    lfgCancelled: '#ED4245'
  },
  limits: {
    lfgReminderMinutes: 10,
    lfgCloseHours: 2,
    lfgDeleteHours: 12,
    errorDeleteHours: 2,
    voiceMinPeople: 2
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
    'stats.noCs': "No CS2 stats found. Their Steam game details are private and they aren't on Leetify or FACEIT.",
    'stats.discordServerOnly': 'Discord stats only work inside a server.',
    'stats.discordMention': 'For Discord, mention someone in player, like @Emre.',

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

    'link.usage': 'Use `/link steam:<profile link or friend code> riot:<Name#Tag>`',
    'link.connect': 'This reads the Steam and Riot accounts already connected to your Discord profile. Or use `/link steam:... riot:...` to add them yourself.',
    'link.connectButton': 'Connect with Discord',
    'link.badSteam': "Couldn't find that Steam account.",
    'link.badRiot': "Couldn't find that Riot ID.",
    'link.done': 'Linked!',

    'mydata.unlink': 'Your Steam and Riot links are removed.',
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

function text(key, vars = {}) {
  return (settings.texts[key] ?? defaults.texts[key]).replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
}

load();
fs.watchFile(FILE, { interval: 2000 }, load).unref();

module.exports = { settings, defaults, save, color, text };
