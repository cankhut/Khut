process.loadEnvFile();
const { REST, Routes } = require('discord.js');
const commands = require('./commands');

const rest = new REST().setToken(process.env.DISCORD_TOKEN);
const body = [...commands.values()].map(c => c.data.toJSON());
const route = process.env.DEV_GUILD_ID
  ? Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.DEV_GUILD_ID)
  : Routes.applicationCommands(process.env.CLIENT_ID);

rest.put(route, { body })
  .then(() => console.log(`Registered ${body.length} commands.`))
  .catch(console.error);
