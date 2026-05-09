export default async (request, context) => {
  const userAgent = request.headers.get('user-agent') || '';
  const isBot = userAgent.includes('Discordbot') || userAgent.includes('Twitterbot');
  
  if (!isBot) {
    // Not a bot — let the normal SPA handle it
    return context.next();
  }
  
  const url = new URL(request.url);
  const path = url.pathname;
  
  // Only intercept video ID paths (8-char hex)
  const videoIdMatch = path.match(/^\/([a-f0-9]{8})$/);
  if (!videoIdMatch) {
    return context.next();
  }
  
  // Proxy to Railway backend which serves OG tags
  const backendUrl = `https://cutr-production.up.railway.app${path}`;
  
  try {
    const response = await fetch(backendUrl, {
      headers: {
        'User-Agent': userAgent,
        'X-Forwarded-Host': url.host,
        'X-Forwarded-Proto': url.protocol.replace(':', '')
      }
    });
    
    const html = await response.text();
    
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
        'Cache-Control': 'public, max-age=300'
      }
    });
  } catch (e) {
    // Fallback to normal SPA
    return context.next();
  }
};

export const config = {
  path: '/*',
  excludedPath: ['/api/*', '/embed/*', '/video-stream/*', '/thumb/*']
};
