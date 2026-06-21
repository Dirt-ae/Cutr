# Deployment Guide

## Local Development

1. Install dependencies: `npm run install:all`
2. Create server env vars in your shell or `server/.env`:
   - `DATABASE_URL`
   - `BUNNY_API_KEY`
   - `BUNNY_LIBRARY_ID`
   - `BUNNY_CDN_HOST`
   - `JWT_SECRET`
   - `ADMIN_EMAIL`
   - `ADMIN_PASSWORD`
   - `PORT` (optional)
3. Optional client env:
   - `VITE_API_URL` (defaults to the dev proxy; on `cutrr.xyz` the client talks directly to Render)
4. Start everything: `npm run dev`

## Deploy Backend To Render

The backend is a Node/Express app and runs on Render (`https://cutr.onrender.com`).

Set these Render env vars:

- `DATABASE_URL` — **Use the Supabase pooler URL on Render, not the direct URL.** Render does not support IPv6, and Supabase direct hosts (`db.*.supabase.co`) are IPv6-only.
  - In Supabase: **Project Settings → Connect → Session pooler → URI**
  - Shape: `postgresql://postgres.rmbfgxiuydvurziniogy:YOUR_PASSWORD@aws-0-us-east-1.pooler.supabase.com:5432/postgres`
  - Note the username is `postgres.rmbfgxiuydvurziniogy`, not just `postgres`
  - Local dev can keep using the direct URL: `postgresql://postgres:YOUR_PASSWORD@db.rmbfgxiuydvurziniogy.supabase.co:5432/postgres`
- `BUNNY_API_KEY`
- `BUNNY_LIBRARY_ID`
- `BUNNY_CDN_HOST`
- `JWT_SECRET`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `FRONTEND_URL=https://cutrr.xyz`
- `FRONTEND_ORIGINS=https://cutrr.xyz,https://www.cutrr.xyz`
- `NODE_ENV=production`

Restart/redeploy Render after changing env vars.

Verify the database connection after deploy:

```text
GET https://cutr.onrender.com/healthz/db
```

You should get `{"ok":true,"database":"connected"}`. If you see `ENETUNREACH` or IPv6 in the error, switch Render to the Supabase **pooler** URL above (not `db.*.supabase.co`).

## Deploy Frontend To Netlify

The frontend is a Vite/React SPA deployed from this repo via Git.

1. In [Netlify](https://app.netlify.com), create a site from Git and connect `https://github.com/Dirt-ae/Cutr`.
2. Netlify reads the root `netlify.toml` automatically:
   - **Base directory:** `client`
   - **Build command:** `npm ci && npm run build`
   - **Publish directory:** `dist`
3. Add your custom domain (`cutrr.xyz` / `www.cutrr.xyz`) in Netlify DNS settings.
4. Optional build env var:
   - `VITE_API_URL` — only needed if you want to override the default Render API URL

What Netlify handles:

- Static hosting of the React app from `client/dist`
- Proxy rewrites for `/api/*`, `/embed/*`, `/hls/*`, `/video-stream/*`, `/thumb/*`, and `/download/*` to Render
- SPA fallback for client-side routes
- `discord-og` edge function for Discord/Twitter link previews on 8-character video URLs

Local Netlify preview:

```bash
npx netlify dev
```

## Test

1. Open `https://cutrr.xyz`
2. Hard refresh with `Ctrl+F5`
3. Test navigation, uploads, login, forms, and Discord link previews
4. If API calls fail, check Render logs and confirm `FRONTEND_ORIGINS` includes your Netlify domain
