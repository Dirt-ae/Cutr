const BACKEND_ORIGIN = "https://cutr.onrender.com";

const BOT_UA =
  /Discordbot|Twitterbot|Slackbot|facebookexternalhit|LinkedInBot|TelegramBot/i;

const isBotRequest = (userAgent = "") => BOT_UA.test(userAgent);

const isVideoIdPath = (pathname = "") => /^\/[a-f0-9]{8}$/i.test(pathname);

const isJudgePath = (pathname = "") => /^\/judge\/[^/]+(?:\/\d+)?\/?$/i.test(pathname);

const shouldHandleBotPreview = (pathname = "") =>
  isVideoIdPath(pathname) || isJudgePath(pathname);

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const buildFallbackOgHtml = ({
  pageUrl,
  title,
  description,
  ogType = "website",
  siteName = "CUTRR",
}) =>
  `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="robots" content="noindex, nofollow">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:type" content="${escapeHtml(ogType)}">
  <meta property="og:url" content="${escapeHtml(pageUrl)}">
  <meta property="og:site_name" content="${escapeHtml(siteName)}">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
</head>
<body></body>
</html>`;

export default async (request, context) => {
  const userAgent = request.headers.get("user-agent") || "";
  if (!isBotRequest(userAgent)) return context.next();

  const url = new URL(request.url);
  if (!shouldHandleBotPreview(url.pathname)) return context.next();

  const pageUrl = url.toString();
  const backendUrl = new URL(url.pathname, BACKEND_ORIGIN);
  backendUrl.search = url.search;

  const backendHeaders = {
    "User-Agent": userAgent,
    "X-Forwarded-Host": url.host,
    "X-Forwarded-Proto": url.protocol.replace(":", ""),
  };

  const fetchOgHtml = async () =>
    fetch(backendUrl.toString(), {
      headers: backendHeaders,
    });

  const isJudge = isJudgePath(url.pathname);

  try {
    let response = await fetchOgHtml();

    if ([502, 503, 504].includes(response.status)) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      response = await fetchOgHtml();
    }

    const html = await response.text();
    const isHtml =
      html.includes("<!DOCTYPE html") ||
      html.includes("<!doctype html") ||
      html.includes("<html");

    if (!isHtml) {
      const title = isJudge
        ? "CUTRR judge panel preview unavailable"
        : response.status === 404
          ? "Video not found | CUTRR"
          : "CUTRR video preview unavailable";
      const description = isJudge
        ? "Try opening the judge link again in a moment."
        : response.status === 404
          ? "This CUTRR link is no longer available."
          : "Try opening the link again in a moment.";

      return new Response(
        buildFallbackOgHtml({
          pageUrl,
          title,
          description,
          siteName: isJudge ? "CUTRR Judging" : "CUTRR",
        }),
        {
          status: response.status >= 400 ? response.status : 503,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
          },
        },
      );
    }

    return new Response(html, {
      status: response.status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": response.ok ? "public, max-age=300" : "no-store",
      },
    });
  } catch (error) {
    console.error("discord-og fetch failed:", error);
    return new Response(
      buildFallbackOgHtml({
        pageUrl,
        title: isJudge
          ? "CUTRR judge panel preview unavailable"
          : "CUTRR video preview unavailable",
        description: "Try opening the link again in a moment.",
        siteName: isJudge ? "CUTRR Judging" : "CUTRR",
      }),
      {
        status: 503,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
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
