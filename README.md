# Khut

A Discord bot made for small groups. LFG pings, voice time tracking with Wrapped and player stats for Deadlock, Counter-Strike 2, League of Legends and Brawlhalla.

## Commands

All commands work in any channel. `/help` shows this list in Discord.

| Command | What it does |
|---|---|
| `/help` | Every command, with examples. |
| `/stats game player` | Deadlock, CS2, League or Brawlhalla stats. `player` = @user, Steam link / friend code, Riot ID (`Name#Tag`) or numeric Brawlhalla ID. Empty = you. |
| `/stats game:Discord player with` | Someone's voice time, or with `with:` the voice time between two people. |
| `/play dlbuild mode guess` | Daily Deadlock game: guess heroes from their items in a real match. |
| `/play lolhero mode guess` | Daily League game: Classic (champion properties) or Ability (a rotated, greyed ability icon). |
| `/leaderboard game period` | The best `/play` players in this server: dlbuild by points, lolhero by days solved (fewer guesses wins ties). This week, this month or all time. Counts games played in any server you share with Khut. |
| `/lfg game time players note` | Look for players. Time: `now`, `30m`, `2h`, `21:00`, `9pm`. Players: `3/6` if 3 of you are already together, or just `6`. Quietly pings everyone subscribed to that game, pings the group when full and reminds them 10 minutes before. Closes 2 hours after the start time and is deleted 12 hours after it closes or is cancelled. |
| `/games` | Subscribe to games so you get pinged when someone uses `/lfg` for them. Only you see it. |
| `/dm on` / `/dm off` | Also get those pings as a DM. |
| `/wrapped period` | Server voice Wrapped: this month, last month, this year or all time. |
| `/link` | Link your Steam, Riot and Brawlhalla accounts so people can use `player:@you`. |
| `/mydata` | See, pause or delete what Khut stores about you. |
| `/setup` | Admins: `games`, `roles`, `answers`, `addgame`, `removegame`, `wrapped`, `timezone`. |

Voice time only counts when 2 or more people are in a channel (AFK channel and bots are ignored).

At the start of each month, Wrapped is posted automatically in the server's **System Messages Channel** (Server Settings > Engagement). You can turn it off with `/setup wrapped auto:False`.

### Games

Everyone gets the same puzzle each day and plays it privately on one board that updates in place: press ✏️ **Guess** and pick a hero from the list (dlbuild) or type a champion (lolhero, small typos are fine). You can also use `guess:` in the command. Using the command again replaces your previous board. When someone finishes, Khut posts a spoiler-free result in that channel, with their streak if they finished the day before too. A new day starts at midnight in the server's timezone. With `/setup answers channel:#games` (or in the control panel), Khut posts yesterday's answers there after midnight.

- **dlbuild**: a real ranked match from two days earlier, picked from high rank (Ascendant+) or all ranks. 4 rounds, each with a different player. The board is laid out like Lockle: every player's souls, the Hidden King and Archmother totals and average ranks, and the player's items. Every wrong guess moves the match forward: 6:00, 12:00, 20:00, 25:00, then the end. 5 guesses per round, 25/18/15/12/10 points. After round 4 you can keep going with bonus rounds (up to 10 rounds) or stop; the result post updates with each bonus round. When the game is over, a button opens the match on Statlocker.
- **lolhero classic**: guess the champion. Each guess shows gender, positions, species, resource, range, regions and release year: 🟩 match, 🟧 partly, 🟥 no. After 6 wrong guesses one of their ability icons shows up as a clue.
- **lolhero ability**: guess the champion from one ability icon. It starts greyed out and rotated, gets its colour back after 3 wrong guesses and turns upright after 6.

Champion properties live in `data/lol-champions.json`. Gender follows each champion's official pronouns. When a new champion comes out, add them there; until then they can't be the Classic answer.

Failed `/stats` replies (player not found, private profile and so on) delete themselves after 2 hours.

League stats only count Summoner's Rift games (no ARAM, Arena or other game modes). Ranked KDA covers the current season.

Brawlhalla stats include lifetime account and legend performance plus ranked 1v1/3v3 data and ranked 2v2 team/partner stats. Use the numeric Brawlhalla ID shown at the top-right of the game's Inventory tab; Steam linking alone cannot identify a Brawlhalla account.

Hero and champion icons gets added to the bot as app emojis the first time it starts, this can take some time, the console prints `Icons ready` when done.

## 1. Install the tools

- [Node.js](https://nodejs.org) <sub><sup>(22.13 or newer)</sup></sub>
- [Git](https://git-scm.com)

## 2. Create the Discord bot

1. Go to <https://discord.com/developers/applications> > **New Application**, give it a name.
2. **General Information**: copy **Application ID** > `CLIENT_ID`.
3. **Bot** tab:
   - **Reset Token** > copy > `DISCORD_TOKEN`. Treat this like a password.
   - Turn **Public Bot** off, so only you can add it to servers.
   - Under **Privileged Gateway Intents**, turn on **Presence Intent**. <sub><sup>(this is used to see which game people are playing while in voice)</sup></sub>
4. **Installation** tab: set Install Link to **None**.
5. Invite it to your server with this link (replace `CLIENT_ID`):

   `https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot%20applications.commands&permissions=268454912`

   Permissions: View Channels, Send Messages, Embed Links, Manage Roles. <sub><sup>(Manage Roles is only used if you turn on game roles)</sup></sub>
6. In Discord, turn on **Settings > Advanced > Developer Mode**, right-click your server > **Copy Server ID** > `DEV_GUILD_ID`.

## 3. Get the API keys <sub><sup>(all free)</sup></sub>

| Key | Where | Notes |
|---|---|---|
| `STEAM_KEY` | <https://steamcommunity.com/dev/apikey> | Domain can be `localhost`. Your Steam account must not be limited. |
| `RIOT_KEY` | <https://developer.riotgames.com> | Register a product and apply for a **Personal API Key**. The default development key works for testing but it expires every 24 hours. |
| `FACEIT_KEY` | <https://developers.faceit.com> | Optional. Create an app, then a **Server side** API key. Adds FACEIT level, Elo and stats to CS2 cards. |
| `LEETIFY_KEY` | <https://leetify.com/app/developer> | Optional. Gives higher rate limits for Leetify. |

Deadlock stats come from deadlock-api.com and need no key.

Brawlhalla stats use the official [Brawlhalla Developer API v1](https://dev.brawlhalla.com/) and need no key. The API documents a limit of 2,000 requests per five minutes. The legend catalogue is cached in memory for six hours.

CS2 cards combine three sources, so they work for almost everyone:

- **Steam**: lifetime K/D, headshot %, win rate and hours. Needs the player's Steam **Game details** to be public. Covers CS:GO and CS2 together.
- **FACEIT**: level, Elo and stats, if they play FACEIT and `FACEIT_KEY` is set.
- **Leetify**: Premier, Competitive and Wingman ranks and ratings, if they use Leetify. Valve doesn't share Premier rating anywhere else.

## 4. Run it

```bash
git clone https://github.com/cankhut/khut.git
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

1. `/setup addgame game:Deadlock` <sub><sup>(repeat for each game)</sup></sub>
2. Everyone runs `/games` to pick their games.

For onboarding, make a channel people can read but not write in, give Khut **View Channel** and **Send Messages** there, and run `/setup games` in it. It posts a fixed game picker that updates by itself when you add or remove games. People can still change their games later with `/games`.

By default, `/lfg` quietly pings each subscriber. With `/setup roles on:True` Khut makes a role for each game instead, gives it to everyone subscribed and pings the role. `on:False` deletes those roles and goes back to pinging people directly. Each server picks its own. Khut needs **Manage Roles** for this, and its own role has to be above the game roles in Server Settings > Roles (new roles are placed right below it automatically).

The default timezone is Türkiye (`Europe/Istanbul`). Change it with `/setup timezone` if needed.

The bot only runs while `npm start` is running. Data is saved in `data.db`.

### Logs

The console shows every command, LFG event, failed API call and error with a timestamp. API keys are hidden in the logs. For more detail (every API call, button click and voice tick) set `LOG_LEVEL=debug` in `.env` and restart. `LOG_LEVEL=warn` shows only problems.

## Control panel <sub><sup>(optional)</sup></sub>

Instead of the terminal, you can run Khut from a page in your browser. On Windows, double-click **`Khut Panel.bat`**. Anywhere else, run:

```bash
npm run panel
```

Then open <http://localhost:3001>. From there you can:

- Fill in the API keys (saved to `.env`)
- Start, stop and restart the bot, register commands and watch the log
- Set the bot's status (Playing, Listening to, Watching, Competing in or a custom text) and its bio
- Copy the invite link
- Change each server's games, timezone and Wrapped
- Change embed colours and everything the bot says, with a live preview
- Change the `/play` result posts by number of guesses (lolhero) or points (dlbuild)
- Add game icons for LFG posts, small in front of the name or big at the top right
- Change the LFG and cleanup timings

Colours, texts, results, icons, status and timings are saved in `settings.json` and the bot picks up changes within a few seconds, no restart needed. Delete `settings.json` to go back to the defaults.

Closing the panel also stops the bot. Turn on **Start the bot when the panel opens** under **Limits** if the panel is how you host it.

The panel only listens on the computer it runs on. To use it for a bot on another machine (a home server, a VPS), run `npm run panel` there and connect with an SSH tunnel:

```bash
ssh -L 3001:localhost:3001 user@your-server
```

Then open <http://localhost:3001> on your own computer.

## Updating

```bash
git pull
npm install
npm run deploy
npm start
```

`npm run deploy` is only needed when commands or their descriptions changed. `data.db` updates itself.

## 5. Optional: one-click linking

`/link` with no options can read the Steam and Riot accounts already connected to someone's Discord profile. This needs a public HTTPS address for the bot:

1. Developer Portal > **OAuth2**: copy **Client Secret** > `CLIENT_SECRET`, and add the redirect `https://your-address/callback`.
2. Set `PUBLIC_URL=https://your-address` in `.env`.

Without this, `/link steam:... riot:...` works the same way. Brawlhalla IDs are always linked manually with `/link brawlhalla:<ID>`; Discord OAuth does not expose them.

## 6. Keep the keys private

- All keys live only in `.env`. `.gitignore` keeps `.env`, `settings.json` and `data.db` out of Git.
- Before every commit, `git status` should **NOT** list `.env`.
- **IF A KEY EVER LEAKS**, reset it right away on the site where you created it.

## Legal

- Khut isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.
- CS2 data from the Steam Web API, [FACEIT](https://www.faceit.com) and [Leetify](https://leetify.com/) (Data Provided by Leetify). Not affiliated with Valve, FACEIT or Leetify.
- League champion properties in `data/lol-champions.json` are compiled from the [League of Legends Wiki](https://wiki.leagueoflegends.com) (CC BY-SA). Ability icons come from Riot's Data Dragon.
- Deadlock data from [deadlock-api.com](https://deadlock-api.com), with links to [Statlocker](https://statlocker.gg) profiles. Not affiliated with Valve.
- Brawlhalla statistics from the [official Brawlhalla Developer API](https://dev.brawlhalla.com/). The bot is not affiliated with Blue Mammoth Games or Ubisoft. Character artwork and game logos remain the property of their respective owners; legend icon files are loaded from NexHalla.
- A Personal Riot API key is for your own server. Before opening the bot to the public, apply for a Production key.
- See [PRIVACY.md](PRIVACY.md) for what the bot stores.

## License

Khut is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).

You can use, change and share it, but if you share a changed version, or run a changed version as a bot other people use, you have to publish your source code under the same license.

Game icons, hero, champion and legend images and rank badges belong to their owners (Valve, Riot Games, Blue Mammoth Games / Ubisoft) or their respective asset hosts and are not covered by this license.
