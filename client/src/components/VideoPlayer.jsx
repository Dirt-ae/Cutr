import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

const getHighestHlsLevel = (levels = []) => {
  return levels.reduce((bestIndex, level, index, levelList) => {
    if (bestIndex < 0) return index;
    const best = levelList[bestIndex];
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
};

const lockHighestHlsLevel = (hls) => {
  const highestLevel = getHighestHlsLevel(hls.levels);
  if (highestLevel < 0) return;
  setHlsLevel(hls, highestLevel);

  return highestLevel;
};

const getLevelLabel = (level) => {
  if (!level) return "Unknown";
  const height = Number(level.height) || 0;
  const bitrate = Number(level.bitrate) || 0;

  if (height > 0) return `${height}p`;
  if (bitrate > 0) return `${Math.round(bitrate / 1000)} kbps`;
  return "Unknown";
};

const getUniqueLevelLabel = (level, levelList, index) => {
  const label = getLevelLabel(level);
  const duplicateCount = levelList.filter((item) => getLevelLabel(item) === label).length;

  if (duplicateCount <= 1) return label;
  const frameRate = Number(level?.attrs?.["FRAME-RATE"] || level?.frameRate) || 0;
  const bitrate = Number(level?.bitrate) || 0;

  if (frameRate > 0) return `${label} ${Math.round(frameRate)}fps`;
  if (bitrate > 0) return `${label} ${Math.round(bitrate / 1000)}kbps`;
  return `${label} #${index + 1}`;
};

const setHlsLevel = (hls, levelIndex) => {
  if (!hls) return;

  if (levelIndex === -1) {
    if (hls.config) hls.config.abrEnabled = true;
    hls.currentLevel = -1;
    hls.loadLevel = -1;
    hls.nextLevel = -1;
    return;
  }

  if (hls.config) hls.config.abrEnabled = false;
  if ("autoLevelEnabled" in hls) hls.autoLevelEnabled = false;
  if ("nextLoadLevel" in hls) hls.nextLoadLevel = levelIndex;
  if ("firstLevel" in hls) hls.firstLevel = levelIndex;
  hls.startLevel = levelIndex;
  hls.currentLevel = levelIndex;
  hls.loadLevel = levelIndex;
  hls.nextLevel = levelIndex;
};

const getQualityOptions = (levels = []) => {
  return levels
    .map((level, index, levelList) => ({
      value: String(index),
      sortHeight: Number(level.height) || 0,
      sortBitrate: Number(level.bitrate) || 0,
      label: getUniqueLevelLabel(level, levelList, index),
    }))
    .sort((left, right) => {
      if (right.sortHeight !== left.sortHeight) return right.sortHeight - left.sortHeight;
      return right.sortBitrate - left.sortBitrate;
    });
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
  const hlsRef = useRef(null);
  const [source, setSource] = useState(src || fallbackSrc || "");
  const [qualityOptions, setQualityOptions] = useState([]);
  const [selectedQuality, setSelectedQuality] = useState("");

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
    setQualityOptions([]);
    setSelectedQuality("");
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
    hlsRef.current = null;
    setQualityOptions([]);
    setSelectedQuality("");
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
          hlsRef.current = hls;
          hls.loadSource(source);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            const highestLevel = lockHighestHlsLevel(hls);
            if (Number.isFinite(highestLevel) && highestLevel >= 0) {
              hls.startLevel = highestLevel;
              setSelectedQuality(String(highestLevel));
            }
            setQualityOptions(getQualityOptions(hls.levels));
            hls.startLoad(0);
            if (autoPlay) video.play().catch(() => {});
          });
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
      if (hlsRef.current === hls) hlsRef.current = null;
      if (hls) hls.destroy();
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeAttribute("src");
      video.load();
    };
  }, [autoPlay, fallbackSrc, source, volume]);

  const handleQualityChange = (event) => {
    const nextQuality = event.target.value;
    const nextLevel = Number(nextQuality);

    setSelectedQuality(nextQuality);
    setHlsLevel(hlsRef.current, nextLevel);
  };

  return (
    <div className="relative w-full">
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
      {qualityOptions.length > 1 && (
        <label className="absolute right-3 top-3 z-10 flex items-center gap-2 rounded-full border border-white/15 bg-black/70 px-3 py-1.5 text-xs font-medium text-white shadow-lg backdrop-blur">
          <span className="hidden sm:inline">Quality</span>
          <select
            value={selectedQuality}
            onChange={handleQualityChange}
            className="cursor-pointer bg-transparent text-white outline-none"
            aria-label="Video quality"
          >
            <option value="-1" className="bg-black text-white">Auto</option>
            {qualityOptions.map((option) => (
              <option key={option.value} value={option.value} className="bg-black text-white">
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
});

export default VideoPlayer;
