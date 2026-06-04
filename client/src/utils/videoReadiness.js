export const isPlaybackReady = (video) => {
  if (!video) return false;
  return video.processingState === "ready";
};

export const isPlaybackFailed = (video) => {
  if (!video) return false;
  return (
    video.processingState === "failed" ||
    video.transcodingStatus === 5 ||
    video.transcodingStatus === "error"
  );
};
