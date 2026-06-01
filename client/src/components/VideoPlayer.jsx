import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

const lockHighestHlsLevel = (hls) => {
  const highestLevel = hls.levels.reduce((bestIndex, level, index, levels) => {
    if (bestIndex < 0) return index;
    const best = levels[bestIndex];
    const score =
      (Number(level?.attrs?.["FRAME-RATE"] || level?.frameRate) || 0) * 1_000_000_000 +
      (Number(level?.height) || 0) * 1_000_000 +
      (Number(level?.bitrate) || 0);
    const bestScore =
      (Number(best?.attrs?.["FRAME-RATE"] || best?.frameRate) || 0) * 1_000_000_000 +
      (Number(best?.height) || 0) * 1_000_000 +
      (Number(best?.bitrate) || 0);
    return score > bestScore ? index : bestIndex;
  }, -1);
  if (highestLevel < 0) return;
  // Disable adaptive bitrate so playback doesn't start low and "randomly" jump later.
  // We want to consistently use the highest available rendition.
  if (hls.config) hls.config.abrEnabled = false;
  if ("autoLevelEnabled" in hls) hls.autoLevelEnabled = false;
  // Ensure all level selection / loading targets the top rendition.
  // `nextLoadLevel` controls which playlist/frag is loaded next when switching levels.
  if ("nextLoadLevel" in hls) hls.nextLoadLevel = highestLevel;
  if ("firstLevel" in hls) hls.firstLevel = highestLevel;
  hls.startLevel = highestLevel;
  hls.currentLevel = highestLevel;
  hls.loadLevel = highestLevel;
  hls.nextLevel = highestLevel;

  return highestLevel;
};

const VideoPlayer = forwardRef(function VideoPlayer({
  src,
  fallbackSrc,
  poster = "",
  autoPlay = false,
  volume = 1,
  className = "",
  onError,
  onTimeUpdate,
  onLoadedMetadata,
}, ref) {
  const videoRef = useRef(null);
  const onErrorRef = useRef(onError);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onLoadedMetadataRef = useRef(onLoadedMetadata);
  const [source, setSource] = useState(src || fallbackSrc || "");

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate;
  }, [onTimeUpdate]);

  useEffect(() => {
    onLoadedMetadataRef.current = onLoadedMetadata;
  }, [onLoadedMetadata]);

  useEffect(() => {
    setSource(src || fallbackSrc || "");
  }, [src, fallbackSrc]);

  useImperativeHandle(ref, () => ({
    seekTo(seconds) {
      const video = videoRef.current;
      if (!video || !Number.isFinite(Number(seconds))) return;
      video.currentTime = Math.max(0, Number(seconds));
      video.play().catch(() => {});
    },
  }), []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !source) return undefined;

    let hls;
    let cancelled = false;
    video.volume = Math.min(Math.max(volume, 0), 1);

    if (source.includes(".m3u8")) {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = source;
        if (autoPlay) video.play().catch(() => {});
      } else {
        import("hls.js").then(({ default: Hls }) => {
          if (cancelled || !videoRef.current || !Hls.isSupported()) {
            if (fallbackSrc && source !== fallbackSrc) setSource(fallbackSrc);
            return;
          }
          hls = new Hls({
            abrEnabled: false,
            abrEwmaDefaultEstimate: 100_000_000,
            autoStartLoad: false,
            capLevelToPlayerSize: false,
            maxBufferLength: 60,
            maxMaxBufferLength: 120,
            startFragPrefetch: true,
            startLevel: 0,
          });
          hls.loadSource(source);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            const highestLevel = lockHighestHlsLevel(hls);
            if (Number.isFinite(highestLevel) && highestLevel >= 0) {
              hls.startLevel = highestLevel;
            }
            hls.startLoad(0);
            if (autoPlay) video.play().catch(() => {});
          });
          hls.on(Hls.Events.LEVEL_LOADED, () => lockHighestHlsLevel(hls));
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data?.fatal && fallbackSrc && source !== fallbackSrc) {
              setSource(fallbackSrc);
            } else if (data?.fatal) {
              onErrorRef.current?.();
            }
          });
        });
      }
    } else {
      video.src = source;
      if (autoPlay) video.play().catch(() => {});
    }

    const handleLoadedMetadata = () => {
      onLoadedMetadataRef.current?.(video.currentTime || 0, video.duration || 0);
    };
    const handleTimeUpdate = () => {
      onTimeUpdateRef.current?.(video.currentTime || 0, video.duration || 0);
    };
    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("timeupdate", handleTimeUpdate);

    return () => {
      cancelled = true;
      if (hls) hls.destroy();
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeAttribute("src");
      video.load();
    };
  }, [autoPlay, fallbackSrc, source, volume]);

  return (
    <video
      ref={videoRef}
      poster={poster}
      controls
      playsInline
      preload="auto"
      onError={() => {
        if (fallbackSrc && source !== fallbackSrc) {
          setSource(fallbackSrc);
        } else {
          onErrorRef.current?.();
        }
      }}
      className={className}
    />
  );
});

export default VideoPlayer;
