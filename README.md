# Crash™ Team Racing NF - Dashboard (v1.1)

A personal dashboard for Crash Team Racing Nitro-Fueled, built for the native port by [Ryu7w7](https://github.com/Ryu7w7/OCTR-NitroFueled-PC).

## Before the first launch

* It is strongly recommended to start the game from the port before opening the executable. That creates the log file the executable reads.
* The executable may not find the log on its own. If that happens, choose the file from the executable by browsing to the installed port.
* Open `CTRNF.exe`. The launcher starts the app and the dashboard opens in the browser. Your records stay on the computer, in `%LOCALAPPDATA%\CTRNF\data`, and they remain there when you update. If a newer release exists, the launcher offers to download it and replace `CTRNF.exe` for you. Your records are not touched.

![Version 1.0 of the executable](utils/ejecutable.JPG)

## Time Trial

Choose the track you just ran, enter the time, and save it. The format is minutes, seconds, and hundredths, for example `1:25:03`.

The top 10 for that track sits on the right: rank, skin, time, date, and the gap to your best. First place has a gold edge. Below that, in the same view, are the game's ghost times so you can compare them with the run you just saved.

![Time Trial at Retro Stadium, with the record form and the track top 10](utils/TimeTrial.JPG)

For the current track you also see how many times you logged it, how much you improved since the first time, and how close your attempts are to each other.

![Track stats: records, absolute gain, relative gain, and standard deviation](utils/TTStats.JPG)

## Ring Rally

The same action, now with a score. Enter the points and the lap count. The track top 10 sorts from highest to lowest and marks when that attempt was your best, or how many points it fell short.

![Ring Rally at Jungle Boogie, with the score form and the track top 10](utils/RingRally.JPG)

## Skin album

The album groups skins by character and by rarity: Basic, Exotic, Legendary, Beenox, and Ultra. At the top you see how many you have unlocked and the global multiplier the next race uses, with any character.

![Dr. N. Gin's skin album, with progress by rarity and the global multiplier](utils/SkinsAlbum.JPG)

## Trophies

Each trophy shows your progress, its tier, and how much it adds to the multiplier. A completed trophy shows the date.

![Trophy list with progress, tier, and unlock date](utils/Trophies.JPG)

## Store

The store opens with 5,000 Wumpacoins. That amount is the first row of a new wallet and is not added again. Races you already saved stay as they are and do not pay coins. From this version on, each saved Time Trial or Ring Rally pays the amount set for that track. Ring Rally pays more. Friday, Saturday, and Sunday pay double.

Purchased items add their flat bonus to the Skin Album multiplier. A conditional bonus applies only on the next Ring Rally when the race matches it: a Crash Team Racing character, a mask, or that exact track.

## OBS overlays

![Streaming overlay](utils/overlayTT.jpg)

## Backup

In Settings you can export a ZIP with your Time Trial times, your Ring Rally scores, and your Wumpacoin wallet. On startup the program tries to find the game log. If it does not appear, you choose it once and that path stays on the computer; you can change it if you move the game. Importing a backup only fills a record that is still empty.

Every track has a limit so an impossible time or an out-of-range score is not saved. Those limits come from the glitchless world records published on [crashteamranking.com](https://crashteamranking.com/), with a 5% margin. They were updated on October 31, 2026.

Crash Team Racing Nitro-Fueled is an Activision trademark. This dashboard is a fan project and is not associated with the game.
