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

export const formatRelativeTime = (value) => {
  if (!value) return "—";
  const date = new Date(normalizeUtcTimestamp(value));
  if (Number.isNaN(date.getTime())) return "—";

  const diff = Date.now() - date.getTime();
  if (diff < 0) return "just now";

  const minutes = Math.floor(diff / (1000 * 60));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  return `${Math.floor(days / 30)}mo ago`;
};

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
