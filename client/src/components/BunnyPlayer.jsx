import { useEffect, useMemo, useRef } from "react";

const PLAYER_JS_SRC = "https://assets.mediadelivery.net/playerjs/playerjs-latest.min.js";
let playerJsPromise;

const loadPlayerJs = () => {
  if (window.playerjs?.Player) return Promise.resolve(window.playerjs);
  if (playerJsPromise) return playerJsPromise;

  playerJsPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector(`script[src="${PLAYER_JS_SRC}"]`);

    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(window.playerjs), { once: true });
      existingScript.addEventListener("error", reject, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = PLAYER_JS_SRC;
    script.async = true;
    script.onload = () => resolve(window.playerjs);
    script.onerror = reject;
    document.head.appendChild(script);
  });

  return playerJsPromise;
};

const buildBunnyPlayerUrl = ({ src, autoPlay = false, poster = "" }) => {
  if (!src) return "";

  try {
    const url = new URL(src);
    url.searchParams.set("responsive", "true");
    url.searchParams.set("preload", "true");
    url.searchParams.set("autoplay", autoPlay ? "true" : "false");
    url.searchParams.set("muted", "false");
    url.searchParams.set("default_quality", "max");
    url.searchParams.set("forbidden_quality", "Auto");
    if (poster) url.searchParams.set("thumbnail", poster);
    return url.toString();
  } catch {
    return src;
  }
};

export default function BunnyPlayer({
  src,
  poster = "",
  autoPlay = false,
  volume = 1,
  className = "",
  title = "Bunny Stream video player",
}) {
  const iframeRef = useRef(null);
  const playerRef = useRef(null);
  const instanceId = useMemo(() => crypto.randomUUID?.() || String(Date.now()), []);
  const playerUrl = useMemo(() => {
    if (!src) return "";
    const url = buildBunnyPlayerUrl({ src, autoPlay, poster });

    try {
      const parsedUrl = new URL(url);
      parsedUrl.searchParams.set("cutrrPlayer", instanceId);
      return parsedUrl.toString();
    } catch {
      return url;
    }
  }, [autoPlay, instanceId, poster, src]);

  useEffect(() => {
    let cancelled = false;
    playerRef.current = null;

    if (!playerUrl || !iframeRef.current) return undefined;

    loadPlayerJs()
      .then((playerjs) => {
        if (cancelled || !iframeRef.current || !playerjs?.Player) return;

        const player = new playerjs.Player(iframeRef.current);
        playerRef.current = player;

        player.on("ready", () => {
          const normalizedVolume = Math.round(Math.min(Math.max(volume, 0), 1) * 100);

          if (player.supports("method", "setVolume")) {
            player.setVolume(normalizedVolume);
          }

          if (normalizedVolume <= 0 && player.supports("method", "mute")) {
            player.mute();
          } else if (player.supports("method", "unmute")) {
            player.unmute();
          }
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (playerRef.current?.off) playerRef.current.off();
      playerRef.current = null;
    };
  }, [playerUrl, volume]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    const normalizedVolume = Math.round(Math.min(Math.max(volume, 0), 1) * 100);
    if (player.supports?.("method", "setVolume")) player.setVolume(normalizedVolume);
    if (normalizedVolume <= 0 && player.supports?.("method", "mute")) {
      player.mute();
    } else if (player.supports?.("method", "unmute")) {
      player.unmute();
    }
  }, [volume]);

  if (!playerUrl) return null;

  return (
    <iframe
      ref={iframeRef}
      src={playerUrl}
      title={title}
      loading="lazy"
      allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
      allowFullScreen
      className={className}
      style={{ border: 0 }}
    />
  );
}
