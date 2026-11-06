const http = require('node:http');
const { saveLinks } = require('./db');

function redirectUri() {
  return `${process.env.PUBLIC_URL}/callback`;
}

function oauthUrl() {
  return `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri())}&scope=identify%20connections`;
}

async function discord(path, token) {
  const res = await fetch(`https://discord.com/api${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Discord ${res.status}`);
  return res.json();
}

async function handleCallback(code) {
  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri()
    })
  });
  if (!tokenRes.ok) throw new Error(`Token ${tokenRes.status}`);
  const { access_token } = await tokenRes.json();

  const user = await discord('/users/@me', access_token);
  const connections = await discord('/users/@me/connections', access_token);
  const steam = connections.find(c => c.type === 'steam');
  const riot = connections.find(c => c.type === 'riotgames' && c.name?.includes('#'));

  if (!steam && !riot) return 'No Steam or Riot account found in your Discord connections.';
  saveLinks(user.id, steam?.id, riot?.name);
  return `Linked ${[steam && `Steam (${steam.name})`, riot && `Riot (${riot.name})`].filter(Boolean).join(' and ')}. You can close this tab.`;
}

function start() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, process.env.PUBLIC_URL);
    const code = url.searchParams.get('code');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');

    if (url.pathname !== '/callback' || !code) {
      res.statusCode = 404;
      return res.end('Not found');
    }

    try {
      res.end(await handleCallback(code));
    } catch (err) {
      console.error(err);
      res.statusCode = 400;
      res.end('Linking failed. Run /link again.');
    }
  });
  server.listen(process.env.PORT || 3000, () => console.log(`Link server on port ${process.env.PORT || 3000}`));
}

module.exports = { start, oauthUrl };
