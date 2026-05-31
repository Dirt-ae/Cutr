export const normalizeUtcTimestamp = (value) => {
  if (!value) return "";
  const raw = String(value).trim();
  const hasTimezone = /z$|[+-]\d{2}:?\d{2}$/i.test(raw);
  if (hasTimezone) return raw;

  // Keep timezone-naive timestamps as local wall-clock values.
  // This avoids shifting 12:34 local to 7:34 by incorrectly treating it as UTC.
  return raw.replace(" ", "T");
};

const getPreferredTimezone = (timezone) => {
  if (timezone) return timezone;
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
};

export const formatLocalUploadDateTime = (value, timezone = "") => {
  if (!value) return "";
  const date = new Date(normalizeUtcTimestamp(value));
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: getPreferredTimezone(timezone),
  }).format(date);
};

export const formatLocalUploadPopoutDate = (value, timezone = "") => {
  if (!value) return "";
  const date = new Date(normalizeUtcTimestamp(value));
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: getPreferredTimezone(timezone),
  }).format(date);
};
