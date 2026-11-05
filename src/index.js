process.loadEnvFile();
const { Client, GatewayIntentBits, Events, MessageFlags } = require('discord.js');
const commands = require('./commands');
const lfg = require('./commands/lfg');
const tracker = require('./tracker');
const web = require('./web');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildPresences]
});

const buttons = {
  lfg: lfg.button,
  role: lfg.roleButton
};

client.once(Events.ClientReady, c => {
  console.log(`Logged in as ${c.user.tag}`);
  setInterval(() => tracker.tick(client).catch(console.error), 60000);
  setInterval(() => lfg.tick(client).catch(console.error), 30000);
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) await commands.get(interaction.commandName)?.execute(interaction);
    else if (interaction.isAutocomplete()) await commands.get(interaction.commandName)?.autocomplete?.(interaction);
    else if (interaction.isButton()) await buttons[interaction.customId.split(':')[0]]?.(interaction);
  } catch (err) {
    console.error(err);
    if (!interaction.isRepliable()) return;
    const message = { content: 'Something went wrong.', flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) await interaction.followUp(message).catch(() => {});
    else await interaction.reply(message).catch(() => {});
  }
});

if (process.env.PUBLIC_URL) web.start();
client.login(process.env.DISCORD_TOKEN);
