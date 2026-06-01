import { API_URL } from "./api";

export const getSafePlaybackUrl = (video) => {
  const url = String(video?.url || "");
  if (!url) return "";
  if (!/\/playlist\.m3u8(?:\?|$)/.test(url)) return url;

  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.pathname.startsWith("/hls/")) return url;
    const query = parsed.search || "";
    return `${API_URL}/hls/${video.id}/playlist.m3u8${query}`;
  } catch {
    return video?.id ? `${API_URL}/hls/${video.id}/playlist.m3u8` : url;
  }
};

export const getOriginalPlaybackUrl = (video, fallbackQuery = "") => {
  if (video?.originalUrl) return String(video.originalUrl);
  return video?.id ? `${API_URL}/video-stream/${video.id}${fallbackQuery}` : "";
};
