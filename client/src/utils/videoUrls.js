import { API_URL } from "./api";

const HLS_PLAYLIST_PATH = /\/playlist\.m3u8(?:\?|$)/;

const getStringValue = (value) => String(value || "");

const buildHlsPlaylistUrl = (videoId, query = "") =>
  `${API_URL}/hls/${videoId}/playlist.m3u8${query}`;

const buildOriginalStreamUrl = (videoId, query = "") =>
  `${API_URL}/video-stream/${videoId}${query}`;

const isHlsPlaylistUrl = (url) => HLS_PLAYLIST_PATH.test(url);

const parsePlaybackUrl = (url) => new URL(url, window.location.origin);

export const getSafePlaybackUrl = (video) => {
  const url = getStringValue(video?.url);
  if (!url || !isHlsPlaylistUrl(url)) return url;
  if (!video?.id) return url;

  try {
    const parsed = parsePlaybackUrl(url);
    if (parsed.pathname.startsWith("/hls/")) return url;
    return buildHlsPlaylistUrl(video.id, parsed.search);
  } catch {
    return buildHlsPlaylistUrl(video.id);
  }
};

export const getOriginalPlaybackUrl = (video, fallbackQuery = "") => {
  const originalUrl = getStringValue(video?.originalUrl);
  if (originalUrl) return originalUrl;
  return video?.id ? buildOriginalStreamUrl(video.id, fallbackQuery) : "";
};
