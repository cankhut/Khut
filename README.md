# Khut

A Discord bot for game groups: LFG pings, voice time tracking with a monthly Wrapped, and player stats for Deadlock, Counter-Strike 2 and League of Legends.

## Commands

| Command | What it does |
|---|---|
| `/stats game player` | Stats for Deadlock, CS2 or League. Valorant shows a tracker.gg profile link. `player` = @user, Steam profile link / friend code, or Riot ID (`Name#Tag`). Empty = you. |
| `/link` | Link your Steam and Riot accounts (`/link steam:... riot:Name#Tag`, or the Connect button if enabled). |
| `/lfg game time slots note` | Post a group. Time: `now`, `30m`, `2h`, `21:00`, `9pm`. Pings the game's role, pings everyone when full, reminds 10 min before. |
| `/voicetime player` | Voice time this week / month / all time, plus top games. |
| `/leaderboard period` | Most voice time on the server. |
| `/duo player period` | Who someone spends the most voice time with. |
| `/mydata action` | Show, unlink, pause tracking, or delete everything stored about you. |
| `/setup ...` | Admins: `lfg`, `addgame`, `removegame`, `wrapped`, `timezone`. |

Voice time only counts when 2+ people are in a channel (AFK channel and bots ignored).

## 1. Install the tools

- [Node.js](https://nodejs.org) 22.13 or newer (the LTS version is fine)
- [Git](https://git-scm.com)

## 2. Create the Discord bot

1. Go to <https://discord.com/developers/applications> → **New Application**, name it.
2. **General Information**: copy **Application ID** → `CLIENT_ID`.
3. **Bot** tab:
   - **Reset Token** → copy → `DISCORD_TOKEN`. Treat this like a password.
   - Turn **Public Bot** off, so only you can add it to servers.
   - Under **Privileged Gateway Intents**, turn on **Presence Intent** (used to see which game people are playing while in voice).
4. **Installation** tab: set Install Link to **None**.
5. Invite it to your server with this link (replace `CLIENT_ID`):

   `https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot%20applications.commands&permissions=268454912`

   Permissions: View Channels, Send Messages, Embed Links, Manage Roles (for game ping roles).
6. In Discord, turn on **Settings → Advanced → Developer Mode**, right-click your server → **Copy Server ID** → `DEV_GUILD_ID`.

## 3. Get the API keys (all free)

| Key | Where | Notes |
|---|---|---|
| `STEAM_KEY` | <https://steamcommunity.com/dev/apikey> | Domain can be `localhost`. Your Steam account must not be limited. |
| `RIOT_KEY` | <https://developer.riotgames.com> | Register a product and apply for a **Personal API Key**. The default development key works for testing but expires every 24 hours. |
| `LEETIFY_KEY` | <https://leetify.com/app/developer> | Optional, gives higher rate limits for CS2 stats. |

Deadlock stats use deadlock-api.com and need no key.

## 4. Run it

```bash
git clone <your repo url>
cd khut
npm install
cp .env.example .env
```

Fill in `.env`, then:

```bash
npm run deploy
npm start
```

`npm run deploy` registers the slash commands. Run it again whenever commands change. With `DEV_GUILD_ID` set, they appear instantly in that server. Leave it empty to register them everywhere the bot is.

Then in Discord:

1. `/setup addgame game:Deadlock` (repeat for each game)
2. `/setup lfg channel:#lfg` (posts the game picker there)
3. `/setup wrapped channel:#general`

The default timezone is Türkiye (`Europe/Istanbul`). Change it with `/setup timezone` if needed.

The bot only runs while `npm start` is running. Data is saved in `data.db`, so back that file up.

## 5. Optional: one-click linking

`/link` with no options can read the Steam and Riot accounts already connected to someone's Discord profile. This needs a public HTTPS address for the bot:

1. Developer Portal → **OAuth2**: copy **Client Secret** → `CLIENT_SECRET`, and add the redirect `https://your-address/callback`.
2. Set `PUBLIC_URL=https://your-address` in `.env`.

Without this, `/link steam:... riot:...` works the same way.

## 6. Keep the keys private

- All keys live only in `.env`. `.gitignore` keeps `.env` and `data.db` out of Git.
- Before every commit, `git status` should **not** list `.env`.
- If a key ever leaks, reset it right away on the site where you created it.

## Legal

- Khut isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.
- CS2 data provided by [Leetify](https://leetify.com/). Not affiliated with Leetify.
- Deadlock data from [deadlock-api.com](https://deadlock-api.com). Not affiliated with Valve.
- Valorant stats are not fetched: Riot only allows them through a production key with Riot Sign On, where each player opts in. `/stats` links to the player's tracker.gg profile instead.
- A Personal Riot API key is for your own server. Before opening the bot to the public, apply for a Production key.
- See [PRIVACY.md](PRIVACY.md) for what the bot stores.
