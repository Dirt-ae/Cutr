# CUTRR Discord Bot Worker

This folder is the standalone Discord bot process for 24/7 hosting.

## Deploy on JustRunMy.App

1. Upload this folder as a Zip app.
2. Use `npm start` as the start command if the panel asks for one.
3. Add these environment variables in the host panel:
   - `DISCORD_BOT_TOKEN` - the Bot token from Discord Developer Portal > Bot > Token. Do not use the client secret, public key, or application id.
   - `DATABASE_URL`
   - `FRONTEND_URL`
   - `BUNNY_CDN_HOST`
4. Keep `DISCORD_GATEWAY_ENABLED=true` so the worker receives Discord reaction events.

The host should install dependencies from `package.json` automatically. Do not upload a real `.env` file with secrets inside the Zip; add secrets in the hosting panel instead.
