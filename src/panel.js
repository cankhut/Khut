const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.join(__dirname, '..');
process.chdir(root);

const ENV_FILE = path.join(root, '.env');
const ENV_KEYS = ['DISCORD_TOKEN', 'CLIENT_ID', 'DEV_GUILD_ID', 'STEAM_KEY', 'RIOT_KEY', 'LEETIFY_KEY', 'FACEIT_KEY', 'CLIENT_SECRET', 'PUBLIC_URL', 'PORT', 'LOG_LEVEL', 'PANEL_PORT'];

function readEnv() {
  const env = {};
  if (!fs.existsSync(ENV_FILE)) return env;
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

function writeEnv(values) {
  const env = { ...readEnv(), ...values };
  const keys = [...ENV_KEYS, ...Object.keys(env).filter(k => !ENV_KEYS.includes(k))];
  fs.writeFileSync(ENV_FILE, keys.map(k => `${k}=${String(env[k] ?? '').replace(/[\r\n]/g, '')}`).join('\n') + '\n');
}

const { settings, defaults, save } = require('./settings');
const { db, guildSettings, setGuild } = require('./db');
const { panel } = require('./commands/lfg');
const { validTimezone } = require('./time');
const roles = require('./roles');

const logs = [];
let logId = 0;
let bot = null;
let stopping = false;
let startedAt = 0;

function addLog(line) {
  logs.push({ id: ++logId, line });
  if (logs.length > 1000) logs.shift();
}

function run(file, onExit) {
  const child = spawn(process.execPath, [file], { cwd: root });
  for (const stream of [child.stdout, child.stderr]) {
    let rest = '';
    stream.on('data', chunk => {
      const lines = (rest + chunk).split(/\r?\n/);
      rest = lines.pop();
      lines.filter(l => !l.includes('ExperimentalWarning') && !l.includes('--trace-warnings')).forEach(addLog);
    });
  }
  child.on('exit', code => onExit?.(code));
  return child;
}

function startBot() {
  if (bot) return;
  stopping = false;
  startedAt = Date.now();
  addLog('[Panel] Starting the bot...');
  bot = run('src/index.js', code => {
    bot = null;
    addLog(`[Panel] Bot stopped${code ? ` (exit code ${code})` : ''}.`);
    if (!stopping && code && Date.now() - startedAt < 30000) {
      addLog('[Panel] The bot stopped right after starting. Check the keys and the log above.');
    } else if (!stopping && code && settings.panel.restartOnCrash) {
      addLog('[Panel] Restarting in 5 seconds...');
      setTimeout(startBot, 5000);
    }
  });
}

function stopBot() {
  return new Promise(resolve => {
    if (!bot) return resolve();
    stopping = true;
    bot.once('exit', () => resolve());
    bot.kill();
  });
}

function deploy() {
  addLog('[Panel] Registering commands...');
  run('src/deploy.js');
}

async function discord(method, route, body) {
  const token = readEnv().DISCORD_TOKEN;
  if (!token) throw new Error('Add the bot token on the Keys page first.');
  const res = await fetch(`https://discord.com/api/v10${route}`, {
    method,
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Discord said ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}

async function refreshPicker(guildId) {
  const g = guildSettings(guildId);
  if (!g.panel_message) return;
  const view = panel(guildId);
  await discord('PATCH', `/channels/${g.panel_channel}/messages/${g.panel_message}`, { content: view.content, components: view.components.map(c => c.toJSON()) }).catch(err => addLog(`[Panel] Couldn't update the game picker: ${err.message}`));
}

async function guilds() {
  const list = await discord('GET', '/users/@me/guilds');
  const channels = Object.fromEntries(await Promise.all(list.map(async g => [g.id, (await discord('GET', `/guilds/${g.id}/channels`).catch(() => []))
    .filter(c => c.type === 0 || c.type === 5).sort((a, b) => a.position - b.position).map(c => ({ id: c.id, name: c.name }))])));
  return list.map(g => {
    const s = guildSettings(g.id);
    const games = db.prepare('SELECT name, (SELECT COUNT(*) FROM subscriptions s WHERE s.guild_id = g.guild_id AND s.game = g.name) AS subs FROM games g WHERE guild_id = ? ORDER BY name').all(g.id);
    return { id: g.id, name: g.name, icon: g.icon && `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64`, timezone: s.timezone, wrapped: !!s.wrapped_auto, roles: roles.isOn(g.id), picker: !!s.panel_message, playChannel: s.play_channel, channels: channels[g.id], games };
  });
}

function onlyChanges(next) {
  const out = {};
  for (const section of Object.keys(defaults)) {
    out[section] = {};
    for (const [key, value] of Object.entries(next[section] ?? {})) {
      if (key in defaults[section] && JSON.stringify(value) !== JSON.stringify(defaults[section][key])) out[section][key] = value;
    }
  }
  return out;
}

const routes = {
  'GET /api/state': () => {
    const env = readEnv();
    return {
      env,
      settings,
      defaults,
      running: !!bot,
      invite: env.CLIENT_ID ? `https://discord.com/oauth2/authorize?client_id=${env.CLIENT_ID}&scope=bot%20applications.commands&permissions=268454912` : null
    };
  },
  'GET /api/logs': (body, url) => {
    const after = Number(url.searchParams.get('after') || 0);
    return { logs: logs.filter(l => l.id > after), running: !!bot };
  },
  'POST /api/env': body => {
    writeEnv(body);
    return { message: bot ? 'Saved. Restart the bot to use the new values.' : 'Saved.' };
  },
  'POST /api/settings': body => {
    save(onlyChanges(body));
    return { message: 'Saved. The bot picks this up within a few seconds.' };
  },
  'POST /api/start': () => {
    startBot();
    return { message: 'Starting.' };
  },
  'POST /api/stop': async () => {
    await stopBot();
    return { message: 'Stopped.' };
  },
  'POST /api/restart': async () => {
    await stopBot();
    startBot();
    return { message: 'Restarting.' };
  },
  'POST /api/deploy': () => {
    deploy();
    return { message: 'Registering commands. Watch the log.' };
  },
  'GET /api/guilds': guilds,
  'POST /api/guild': async body => {
    if (body.timezone !== undefined) {
      if (!validTimezone(body.timezone)) throw new Error('Unknown timezone. Use a name like Europe/Istanbul.');
      setGuild(body.id, 'timezone', body.timezone);
    }
    if (body.wrapped !== undefined) setGuild(body.id, 'wrapped_auto', body.wrapped ? 1 : 0);
    if (body.roles !== undefined) roles.turn(body.id, body.roles);
    if (body.playChannel !== undefined) setGuild(body.id, 'play_channel', body.playChannel || null);
    if (body.addGame) {
      const name = String(body.addGame).trim().slice(0, 50);
      if (!name) throw new Error('Type a game name.');
      if (db.prepare('SELECT COUNT(*) AS n FROM games WHERE guild_id = ?').get(body.id).n >= 25) throw new Error('Up to 25 games are supported.');
      db.prepare('INSERT OR IGNORE INTO games VALUES (?, ?, NULL)').run(body.id, name);
      await refreshPicker(body.id);
    }
    if (body.removeGame) {
      const roleId = db.prepare('SELECT role_id FROM games WHERE guild_id = ? AND name = ?').get(body.id, body.removeGame)?.role_id;
      if (roleId) await discord('DELETE', `/guilds/${body.id}/roles/${roleId}`).catch(() => {});
      db.prepare('DELETE FROM games WHERE guild_id = ? AND name = ?').run(body.id, body.removeGame);
      db.prepare('DELETE FROM subscriptions WHERE guild_id = ? AND game = ?').run(body.id, body.removeGame);
      await refreshPicker(body.id);
    }
    return { message: 'Saved.', guilds: await guilds() };
  }
};

const port = Number(readEnv().PANEL_PORT || 3001);
const allowedHosts = [`localhost:${port}`, `127.0.0.1:${port}`];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const send = (status, type, data) => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(data);
  };

  if (!allowedHosts.includes(req.headers.host)) return send(403, 'text/plain', 'Forbidden');

  if (req.method === 'GET' && url.pathname === '/') {
    return send(200, 'text/html; charset=utf-8', fs.readFileSync(path.join(__dirname, 'panel.html')));
  }

  const handler = routes[`${req.method} ${url.pathname}`];
  if (!handler) return send(404, 'text/plain', 'Not found');
  if (req.method === 'POST' && !req.headers['content-type']?.startsWith('application/json')) return send(415, 'text/plain', 'JSON only');

  try {
    let body = {};
    if (req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      body = raw ? JSON.parse(raw) : {};
    }
    send(200, 'application/json', JSON.stringify(await handler(body, url)));
  } catch (err) {
    send(400, 'application/json', JSON.stringify({ error: err.message }));
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Khut panel: http://localhost:${port}`);
  console.log('Closing this window stops the panel and the bot.');
  if (process.argv.includes('--open')) {
    const url = `http://localhost:${port}`;
    const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
    spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  }
  if (settings.panel.autoStart) startBot();
});

process.on('SIGINT', async () => {
  await stopBot();
  process.exit(0);
});
