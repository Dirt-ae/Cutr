const STATUS_COPY = {
  0: {
    label: "Waiting in Bunny queue",
    detail: "Bunny accepted the upload and is preparing the encode job.",
  },
  1: {
    label: "Bunny is ingesting the file",
    detail: "The original file is being checked before playback versions are made.",
  },
  2: {
    label: "Bunny is preparing playback",
    detail: "The video is being analyzed and packaged for streaming.",
  },
  3: {
    label: "Encoding playback versions",
    detail: "Bunny is building the HLS stream and highest-quality rendition.",
  },
  4: {
    label: "Finalizing playback",
    detail: "Encoding is complete; CUTRR is checking that the stream is available.",
  },
  9: {
    label: "Generating captions",
    detail: "Bunny is finishing caption metadata before the video is marked ready.",
  },
};

export const getUploadStatusCopy = ({
  status,
  progress = 0,
  processingMessage = "",
  fallbackLabel = "Processing video",
  fallbackDetail = "CUTRR is checking the latest Bunny processing state.",
} = {}) => {
  const numericStatus = Number(status);
  const copy = STATUS_COPY[numericStatus] || {
    label: fallbackLabel,
    detail: processingMessage || fallbackDetail,
  };
  const safeProgress = Math.max(0, Math.min(100, Math.round(Number(progress) || 0)));
  const progressDetail =
    safeProgress > 0 && safeProgress < 100
      ? `${copy.detail} ${safeProgress}% complete.`
      : copy.detail;

  return {
    label: copy.label,
    detail: processingMessage && processingMessage !== "Video is still processing."
      ? processingMessage
      : progressDetail,
  };
};

export const getUploadProgressForStatus = (status, progress = 0) => {
  const safeProgress = Math.max(0, Math.min(100, Number(progress) || 0));
  const numericStatus = Number(status);
  if (numericStatus === 0) return Math.max(94, safeProgress);
  if (numericStatus === 1 || numericStatus === 2) return Math.max(96, safeProgress);
  if (numericStatus === 3) return Math.max(98, safeProgress);
  if (numericStatus === 4) return 100;
  if (numericStatus === 9) return 99;
  return Math.max(92, safeProgress);
};

