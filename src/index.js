process.loadEnvFile();
const { Client, GatewayIntentBits, Events, MessageFlags } = require('discord.js');
const commands = require('./commands');
const lfg = require('./commands/lfg');
const tracker = require('./tracker');
const cleanup = require('./cleanup');
const roles = require('./roles');
const play = require('./commands/play');
const web = require('./web');
const log = require('./log');
const { text } = require('./settings');
const { syncEmojis } = require('./assets');

process.on('unhandledRejection', err => log.error('Unhandled promise rejection:', err));
process.on('uncaughtException', err => log.error('Uncaught exception:', err));

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildPresences]
});

const buttons = {
  lfg: lfg.button,
  sub: lfg.subscribeButton,
  pick: lfg.pickButton,
  play: play.component
};

function every(name, ms, job) {
  setInterval(() => job().catch(err => log.error(`${name} failed:`, err)), ms);
}

client.once(Events.ClientReady, c => {
  log.info(`Logged in as ${c.user.tag} in ${c.guilds.cache.size} server(s): ${c.guilds.cache.map(g => g.name).join(', ')}`);
  log.info(`Log level: ${process.env.LOG_LEVEL || 'info'}`);
  for (const key of ['STEAM_KEY', 'RIOT_KEY', 'LEETIFY_KEY', 'FACEIT_KEY']) if (!process.env[key]) log.warn(`${key} is empty`);
  every('Voice tracker', 60000, () => tracker.tick(client));
  every('LFG', 30000, () => lfg.tick(client));
  every('Cleanup', 60000, () => cleanup.tick(client));
  every('Game roles', 30000, () => roles.tick(client));
  every('Daily answers', 60000, () => play.tick(client));
  syncEmojis(client).catch(err => log.error('Emoji sync failed:', err));
});

client.on(Events.ShardDisconnect, (event, id) => log.warn(`Disconnected from Discord (shard ${id}, code ${event.code})`));
client.on(Events.ShardReconnecting, id => log.warn(`Reconnecting to Discord (shard ${id})`));
client.on(Events.ShardResume, id => log.info(`Reconnected to Discord (shard ${id})`));
client.on(Events.ShardError, err => log.error('Discord connection error:', err));
client.on(Events.Error, err => log.error('Discord client error:', err));
client.on(Events.Warn, text => log.warn(`Discord: ${text}`));
client.on(Events.GuildCreate, guild => log.info(`Added to server ${guild.name}`));
client.on(Events.GuildDelete, guild => log.info(`Removed from server ${guild.name}`));

function describe(interaction) {
  const where = interaction.guild ? `${interaction.guild.name} #${interaction.channel?.name ?? '?'}` : 'DM';
  if (interaction.isChatInputCommand()) {
    const options = interaction.options.data.flatMap(o => o.options ? [o.name, ...o.options.map(x => `${x.name}:${x.value}`)] : [`${o.name}:${o.value}`]);
    return `${interaction.user.tag} used /${[interaction.commandName, ...options].join(' ')} in ${where}`;
  }
  return `${interaction.user.tag} clicked ${interaction.customId} in ${where}`;
}

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isAutocomplete()) return Promise.resolve(commands.get(interaction.commandName)?.autocomplete?.(interaction)).catch(err => log.debug(`Autocomplete failed: ${err.message}`));
  const started = Date.now();
  if (interaction.isChatInputCommand()) log.info(describe(interaction));
  else if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) log.debug(describe(interaction));

  try {
    if (interaction.isChatInputCommand()) await commands.get(interaction.commandName)?.execute(interaction);
    else if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) await buttons[interaction.customId.split(':')[0]]?.(interaction);
    log.debug(`Done in ${Date.now() - started}ms`);
  } catch (err) {
    log.error(`Failed: ${describe(interaction)}`, err);
    if (!interaction.isRepliable()) return;
    const message = { content: text('error'), flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) await interaction.followUp(message).catch(() => {});
    else await interaction.reply(message).catch(() => {});
  }
});

if (process.env.PUBLIC_URL) web.start();
log.info('Connecting to Discord...');
client.login(process.env.DISCORD_TOKEN).catch(err => {
  log.error('Login failed. Check DISCORD_TOKEN and the internet connection.', err);
  process.exit(1);
});
