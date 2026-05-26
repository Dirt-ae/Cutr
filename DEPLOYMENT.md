# Deployment Guide

## Deploy to Netlify (Client) & Railway (Server)

### Step 1: Deploy Server to Railway

1. Go to [railway.app](https://railway.app) and sign up/login
2. Click "New Project" → "Deploy from GitHub"
3. Select your repository
4. Railway will detect it's a Node.js project
5. Add environment variables in Railway settings:
   - `DATABASE_URL`: Your Neon PostgreSQL connection string
   - `BUNNY_API_KEY`: `3e15bca1-2a64-4852-bf2b7c7e1668-151e-4fe4`
   - `BUNNY_LIBRARY_ID`: `646595`
   - `BUNNY_CDN_HOST`: `vz-c6b9f2b4-a75.b-cdn.net`
   - `JWT_SECRET`: `cutr-super-secret-jwt-key-2024`
   - `PORT`: `3001`
   - Optional for YouTube imports that require sign-in:
     - `YT_DLP_COOKIES_BASE64`: Base64-encoded Netscape cookies.txt export
     - Or `YT_DLP_COOKIES_PATH`: Path to a cookies.txt file on the server
     - For local development only, `YT_DLP_COOKIES_FROM_BROWSER`: Browser profile name such as `chrome`
6. Click "Deploy"
7. Copy the Railway URL (e.g., `https://your-app.railway.app`)

### Step 2: Deploy Client to Netlify

1. Go to [netlify.com](https://netlify.com) and sign up/login
2. Click "Add new site" → "Import an existing project"
3. Connect to your GitHub repository
4. Configure build settings:
   - Build command: `npm run build`
   - Publish directory: `client/dist`
5. Add environment variable:
   - `VITE_API_URL`: Your Railway URL (e.g., `https://your-app.railway.app`)
6. Click "Deploy site"
7. Your site will be live at `https://your-site.netlify.app`

### Step 3: Test

1. Visit your Netlify URL
2. Upload a video
3. Share the link in Discord
4. Discord should show the video preview with title and thumbnail

## Notes

- The Discord Open Graph support requires a real domain to work properly
- Railway provides a free tier for the server
- Netlify provides free hosting for the client
- Make sure your Neon PostgreSQL database is accessible from Railway
