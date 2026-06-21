const clampDimensions = (width, height) => {
  const safeWidth = Number(width);
  const safeHeight = Number(height);
  if (!Number.isFinite(safeWidth) || !Number.isFinite(safeHeight) || safeWidth <= 0 || safeHeight <= 0) {
    return null;
  }
  return { width: safeWidth, height: safeHeight };
};

export const getAdaptiveVideoFrameStyle = (width, height) => {
  const dimensions = clampDimensions(width, height);
  if (!dimensions) {
    return {
      className: "mx-auto w-full max-h-[min(80dvh,900px)] aspect-video bg-black",
      style: undefined,
    };
  }

  return {
    className: "mx-auto w-full max-h-[min(80dvh,900px)] bg-black",
    style: { aspectRatio: `${dimensions.width} / ${dimensions.height}` },
  };
};

export const getVideoDimensionsFromEvent = (videoEl) => {
  if (!videoEl) return null;
  return clampDimensions(videoEl.videoWidth, videoEl.videoHeight);
};
