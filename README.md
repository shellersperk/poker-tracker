# Poker Tracker

A personal poker bankroll tracker, built as a installable web app (PWA) for Android.

## What it does

- **Check in** to a new session: location and game use a smart default (matches your most common spot for this day-of-week + time-of-day, falling back to your last session), buy-in defaults to what you last put in at that spot.
- **Add-on** any time during a session — running total invested is always visible.
- **Cash out** (defaults to $0 for a bust), then optionally log **Good**, **Bad**, and **Needs Action** notes for the session.
- Instant report after cash-out: session profit, profit/hour, this month's P&L, and year-to-date P&L.
- Full history with expandable notes, CSV export, and optional live sync to a Google Sheet.
- Works offline (service worker caches the app shell) — your data is on the device either way.

## Running it locally (to try it now)

From this folder:

```powershell
python -m http.server 8743
```

Then open `http://localhost:8743/index.html` on this computer, or `http://<this-pc's-LAN-IP>:8743/index.html` from your phone if it's on the same Wi-Fi (installability as a home-screen app needs HTTPS or `localhost`, so LAN testing works for trying it out but not for "Add to Home Screen").

## Getting it onto your Android phone for real

A PWA needs to be served over **HTTPS** to be installable with offline support. The easiest free option is **GitHub Pages**:

1. Create a new GitHub repo (can be private) and push this folder to it.
2. In the repo's Settings → Pages, set the source to the `main` branch, root folder.
3. GitHub gives you a URL like `https://<you>.github.io/<repo>/`.
4. Open that URL in Chrome on your Android phone.
5. Tap the **⋮** menu → **Add to Home screen** (Chrome may also prompt automatically).

You now have an app icon that opens full-screen, works offline, and keeps your data on the phone.

*(I didn't create or push a repo myself — that's a step worth doing deliberately since it's a GitHub account action. Say the word and I'll set it up.)*

## Setting up Google Sheets sync (optional)

This app has no backend server, so sync works through a small Google Apps Script you deploy from your own Google account — a one-time, 5 minute setup.

1. Create a new Google Sheet (e.g. "Poker Sessions").
2. In the Sheet, go to **Extensions → Apps Script**.
3. Delete the placeholder code and paste in the contents of [`appsscript/Code.gs`](appsscript/Code.gs) from this folder.
4. Click **Deploy → New deployment**.
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   (This makes the URL the only thing protecting it — fine for a personal bankroll log, but don't share the URL.)
5. Click **Deploy**, authorize it with your Google account when prompted.
6. Copy the **Web app URL** it gives you (ends in `/exec`).
7. In Poker Tracker, go to **Settings → Google Sheets Sync**, paste the URL, tap **Save**.

Every time you cash out, the session is sent to your Sheet automatically and verified — Apps Script's response is checked, so a session only clears from the sync queue once it's actually confirmed written. If you were offline or the URL is wrong, it stays queued and retries next time the app opens (or when you tap **Sync Now**, which will tell you plainly if anything failed).

## Backup

Settings → **Export CSV** any time, or History → the ⇩ icon, for a spreadsheet file with every completed session (profit, duration, profit/hour, all three notes fields) — useful for digging into leaks in Excel/Sheets beyond what's built into the app.

## Data & privacy

All session data lives in the phone's local storage first; Google Sheets sync is optional and additive. Clearing your browser site data for this app (or using "Clear All Data" in Settings) deletes it permanently — export a CSV first if you want a backup.
