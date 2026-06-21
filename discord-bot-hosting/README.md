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

Create `.env` in the PebbleHost **File Manager** (same folder as `bot.js`). PebbleHost
does not have a separate environment-variables screen for bot hosting — the `.env`
file is how secrets are configured.

## PebbleHost setup

1. In the File Manager, delete PebbleHost's example `bot.js`, `index.js`, and
   `package.json` if they're there, then upload the three files above to the root.
   - If you upload a `.zip`, the files must be at the TOP LEVEL of the zip
     (extract should produce `bot.js`, not `discord-bot-hosting/bot.js`).
2. Open `bot.js` in the File Manager and confirm the first line is
   `import fs from "fs";`. If it still says `Hello World! ... example application`,
   the real file did not upload.
3. **Settings → Bot Start File → `bot.js`**.
4. Create or edit `.env` in the File Manager with:
   - `DISCORD_BOT_TOKEN` — Bot token (Discord Developer Portal → Bot → Token).
   - `DATABASE_URL` — **Supabase Session pooler URL** (not `db.*.supabase.co`).
     In Supabase: Dashboard → Connect → **Session pooler** → copy URI.
     Host must be `*.pooler.supabase.com`, user `postgres.[project-ref]`.
   - `FRONTEND_URL` — `https://cutrr.xyz`.
   - `DISCORD_EMBED_URL` — `https://cutrr.xyz` (optional).
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
