# Privacy

## What the bot stores

- **Linked accounts**: your Discord ID with the Steam ID and Riot ID you linked.
- **Voice time**: minutes per day spent in voice with at least one other person, who you were with, and the game shown in your Discord status at that time.
- **Voice sessions**: start and end times, used for the monthly Wrapped.
- **LFG groups**: groups you hosted or joined, the games you subscribed to with `/games`, and whether you turned on DMs with `/dm`.

- **Games**: your guesses and results in `/play` games, for the days you played.

The console log shows who used which command and when. It is only visible to whoever runs the bot.

## What it does not store

- Messages, voice audio, or anything from DMs.
- Game stats for Deadlock and CS2. They are fetched live each time `/stats` is used.

For League of Legends, Khut keeps a short summary of each Summoner's Rift match it has looked up (champion, kills, deaths, assists, win or loss) so it doesn't have to download the same match from Riot again.

## Your control

Use `/mydata` to see what is stored, unlink accounts, pause voice tracking, or delete everything about you.

Data is not sold or shared. It is only shown inside the Discord servers that use the bot.
