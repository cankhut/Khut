# Privacy

## What the bot stores

- **Linked accounts**: your Discord ID with the Steam ID, Riot ID, Brawlhalla ID and WoW: Forever characters you linked. If the bot's owner turned on `/linkfor`, they can link these for you too. Remove any of them with `/unlink`.
- **Voice time**: minutes per day spent in voice with at least one other person, who you were with, and the game shown in your Discord status at that time.
- **Voice sessions**: start and end times, used for the monthly Wrapped.
- **LFG groups**: groups you hosted or joined, the games you subscribed to with `/games`, and whether you turned on DMs with `/dm`.
- **Games**: your guesses and results in `/play` games, for the days you played. Your scores show on `/leaderboard` in every server you share with Khut.

The console log shows who used which command and when. It is only visible to whoever runs the bot.

## What it does not store

- Messages, voice audio, or anything from DMs.
- Game stats for Deadlock, CS2, Brawlhalla and WoW: Forever. They are fetched live each time `/stats` or `/price` is used. WoW auction prices are kept in memory for up to 30 minutes.

For League of Legends, Khut keeps a short summary of each Summoner's Rift match it has looked up (champion, kills, deaths, assists, win or loss) so it doesn't have to download the same match from Riot again.

## Your control

Use `/mydata` to see what is stored, unlink accounts, pause voice tracking, or delete everything about you.

Data is not sold or shared. It is only shown inside the Discord servers that use the bot.
