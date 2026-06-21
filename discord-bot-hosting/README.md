# CUTRR Discord Bot — PebbleHost

Standalone 24/7 Discord bot worker for CUTRR. The website runs on Netlify
(`cutrr.xyz`); this bot runs separately on PebbleHost and talks to the same
database.

## Files to upload (to the server ROOT)

Upload these into the PebbleHost file manager root — the same folder that holds
`package.json`. Do NOT nest them inside a subfolder.

- `bot.js`
- `discordBot.js`
- `package.json`

Do NOT upload `.env` (it holds secrets). Set those in the PebbleHost panel.

## PebbleHost setup

1. In the File Manager, delete PebbleHost's example `bot.js`, `index.js`, and
   `package.json` if they're there, then upload the three files above to the root.
   - If you upload a `.zip`, the files must be at the TOP LEVEL of the zip
     (extract should produce `bot.js`, not `discord-bot-hosting/bot.js`).
2. Open `bot.js` in the File Manager and confirm the first line is
   `import fs from "fs";`. If it still says `Hello World! ... example application`,
   the real file did not upload.
3. **Settings → Bot Start File → `bot.js`**.
4. Add environment variables in the panel:
   - `DISCORD_BOT_TOKEN` — Bot token (Discord Developer Portal → Bot → Token).
   - `DATABASE_URL` — Postgres/Supabase connection string.
   - `FRONTEND_URL` — `https://cutrr.xyz`.
   - `DISCORD_EMBED_URL` — `https://cutrr.xyz` (or your API origin if separate).
   - `BUNNY_CDN_HOST` — your Bunny CDN hostname.
   - `DISCORD_GATEWAY_ENABLED` — `true`.
5. Start the server. PebbleHost runs `npm install` from `package.json`, then
   launches `bot.js`.

## Expected healthy logs

```
Database connection ready.
Database schema ready.
Discord reminder loop running every 3600000ms.
```

If you see `Hello World! This is an example application.`, the uploaded `bot.js`
is still PebbleHost's placeholder — re-upload to the root and re-check step 2.

## Notes

- On boot, the worker ensures the judging tables/columns exist, so criteria
  judging works without manual SQL.
- Node 20+ required (PebbleHost's image provides this).
