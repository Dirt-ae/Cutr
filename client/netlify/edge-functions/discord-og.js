const BACKEND_ORIGIN = "https://cutr.onrender.com";

export default async (request, context) => {
  const userAgent = request.headers.get("user-agent") || "";
  const isBot =
    userAgent.includes("Discordbot") ||
    userAgent.includes("Twitterbot") ||
    userAgent.includes("Slackbot") ||
    userAgent.includes("facebookexternalhit");

  if (!isBot) return context.next();

  const url = new URL(request.url);
  const videoIdMatch = url.pathname.match(/^\/([a-f0-9]{8})$/i);
  if (!videoIdMatch) return context.next();

  const backendUrl = new URL(url.pathname, BACKEND_ORIGIN);
  backendUrl.search = url.search;

  try {
    const response = await fetch(backendUrl, {
      headers: {
        "User-Agent": userAgent,
        "X-Forwarded-Host": url.host,
        "X-Forwarded-Proto": url.protocol.replace(":", ""),
      },
    });

    if (!response.ok) return context.next();

    const html = await response.text();
    return new Response(html, {
      status: response.status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch {
    return context.next();
  }
};

export const config = {
  path: "/*",
  excludedPath: [
    "/api/*",
    "/embed/*",
    "/hls/*",
    "/video-stream/*",
    "/thumb/*",
    "/download/*",
  ],
};
