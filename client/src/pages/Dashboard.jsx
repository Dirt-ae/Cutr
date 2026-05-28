import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ExternalLink,
  Copy,
  Check,
  Calendar,
  HardDrive,
  Volume2,
  Edit3,
  Play,
  Trash2,
  X,
  Save,
  Image,
  RefreshCw,
} from "lucide-react";
import Modal from "../components/Modal";
import { useToast } from "../contexts/ToastContext";
import ThemeSettings from "../components/ThemeSettings";
import MainNav from "../components/MainNav";
import { API_URL } from "../utils/api";

export default function Dashboard({ user, logout }) {
  const { showToast } = useToast();
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({
    volume: 100,
    description: "",
    autoplay: true,
  });
  const [deleteModal, setDeleteModal] = useState({
    isOpen: false,
    videoId: null,
  });
  const [resetModal, setResetModal] = useState({
    isOpen: false,
    videoId: null,
  });
  const [thumbPicker, setThumbPicker] = useState(null);
  const [thumbnails, setThumbnails] = useState([]);
  const [thumbLoading, setThumbLoading] = useState(false);
  const [thumbVersions, setThumbVersions] = useState({});
  const [updatingThumb, setUpdatingThumb] = useState(null);
  const [themeSettingsOpen, setThemeSettingsOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);

  useEffect(() => {
    loadVideos();
  }, [user]);

  const loadVideos = async () => {
    setLoading(true);
    try {
      if (user) {
        // Signed-up user: fetch from API
        const token = localStorage.getItem("token");
        const res = await fetch(`${API_URL}/api/my-videos`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        setVideos(data);
      } else {
        // Anonymous: fetch by IDs from localStorage
        const anonVideoIds = JSON.parse(
          localStorage.getItem("anonVideos") || "[]",
        );
        if (anonVideoIds.length > 0) {
          const res = await fetch(`${API_URL}/api/videos/batch`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: anonVideoIds }),
          });
          const data = await res.json();
          if (Array.isArray(data)) {
            setVideos(data);
            // Update localStorage - remove IDs that no longer exist in DB
            const validIds = data.map((v) => v.id);
            localStorage.setItem("anonVideos", JSON.stringify(validIds));
          } else {
            setVideos([]);
            localStorage.setItem("anonVideos", JSON.stringify([]));
          }
        } else {
          setVideos([]);
        }
      }
    } catch (e) {
      showToast("Failed to load videos", "error");
    } finally {
      setLoading(false);
    }
  };

  const copyLink = (id) => {
    const video = videos.find((item) => item.id === id);
    navigator.clipboard.writeText(getShareUrl(id, video));
    setCopiedId(id);
    showToast("Link copied", "success");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const toggleSelected = (id) => {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((selectedId) => selectedId !== id)
        : [...current, id],
    );
  };

  const copySelectedLinks = () => {
    navigator.clipboard.writeText(
      selectedIds
        .map((id) => getShareUrl(id, videos.find((video) => video.id === id)))
        .join("\n"),
    );
    showToast(`${selectedIds.length} links copied`, "success");
  };

  const deleteSelectedVideos = async () => {
    const token = localStorage.getItem("token");
    if (!token || selectedIds.length === 0) return;
    try {
      await Promise.all(
        selectedIds.map((id) =>
          fetch(`${API_URL}/api/video/${id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
          }),
        ),
      );
      setVideos((current) =>
        current.filter((video) => !selectedIds.includes(video.id)),
      );
      setSelectedIds([]);
      showToast("Selected videos deleted", "success");
    } catch {
      showToast("Failed to delete selected videos", "error");
    }
  };

  const getShareUrl = (id, video) =>
    `${window.location.origin}/${id}${
      video?.isPrivate && video?.privateToken
        ? `?token=${video.privateToken}`
        : ""
    }`;
  const getPreviewUrl = (id) => `${API_URL}/video-stream/${id}`;
  const getThumbUrl = (id) => `${API_URL}/thumb/${id}${thumbVersions[id] ? `?t=${thumbVersions[id]}` : ""}`;

  const startEditing = (video) => {
    setEditingId(video.id);
    setEditForm({
      volume: video.volume || 100,
      description: video.description || "",
      autoplay: video.autoplay !== false,
      originalName: video.originalName || "",
    });
  };

  const saveSettings = async (videoId) => {
    const token = localStorage.getItem("token");
    if (!token) return; // Only signed-up users can save

    try {
      await fetch(`${API_URL}/api/video/${videoId}/settings`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(editForm),
      });

      // Update local state
      setVideos(
        videos.map((v) =>
          v.id === videoId
            ? {
                ...v,
                volume: editForm.volume,
                description: editForm.description,
                autoplay: editForm.autoplay,
                originalName: editForm.originalName,
              }
            : v,
        ),
      );
      setEditingId(null);
    } catch (e) {
      showToast("Failed to save settings", "error");
    }
  };

  const deleteVideo = async (videoId) => {
    const token = localStorage.getItem("token");
    if (!token) return;

    setDeleteModal({ isOpen: true, videoId });
  };

  const confirmDelete = async () => {
    const token = localStorage.getItem("token");
    if (!token || !deleteModal.videoId) return;

    try {
      await fetch(`${API_URL}/api/video/${deleteModal.videoId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      // Remove from local state
      setVideos(videos.filter((v) => v.id !== deleteModal.videoId));
      setDeleteModal({ isOpen: false, videoId: null });
      showToast("Video deleted", "success");
    } catch (e) {
      showToast("Failed to delete video", "error");
    }
  };

  const resetVideoLink = (videoId) => {
    setResetModal({ isOpen: true, videoId });
  };

  const confirmResetLink = async () => {
    const token = localStorage.getItem("token");
    if (!token || !resetModal.videoId) return;

    try {
      const res = await fetch(
        `${API_URL}/api/video/${resetModal.videoId}/reset-link`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reset link");
      setVideos((current) =>
        current.map((video) =>
          video.id === resetModal.videoId ? { ...video, id: data.id } : video,
        ),
      );
      setSelectedIds((current) =>
        current.map((id) => (id === resetModal.videoId ? data.id : id)),
      );
      setResetModal({ isOpen: false, videoId: null });
      showToast("Link reset", "success");
    } catch (e) {
      showToast(e.message || "Failed to reset link", "error");
    }
  };

  const togglePrivacy = async (video) => {
    const token = localStorage.getItem("token");
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/video/${video.id}/privacy`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ isPrivate: !video.isPrivate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update privacy");
      setVideos((current) =>
        current.map((item) =>
          item.id === video.id
            ? {
                ...item,
                isPrivate: data.isPrivate,
                privateToken: data.privateToken,
              }
            : item,
        ),
      );
      showToast(data.isPrivate ? "Private link enabled" : "Video is public", "success");
    } catch (e) {
      showToast(e.message || "Failed to update privacy", "error");
    }
  };

  const openThumbPicker = async (videoId) => {
    if (thumbPicker === videoId) {
      setThumbPicker(null);
      return;
    }
    const token = localStorage.getItem("token");
    if (!token) return;
    setThumbPicker(videoId);
    setThumbLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/video/${videoId}/thumbnails`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setThumbnails(data.thumbnails || []);
    } catch {
      showToast("Failed to load thumbnails", "error");
    } finally {
      setThumbLoading(false);
    }
  };

  const selectThumbnail = async (videoId, time) => {
    const token = localStorage.getItem("token");
    if (!token) return;
    setUpdatingThumb(time);
    try {
      const res = await fetch(`${API_URL}/api/video/${videoId}/thumbnail`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ time }),
      });
      if (!res.ok) throw new Error("Failed");
      showToast(
        "Thumbnail updated — may take a moment to update everywhere",
        "success",
      );
      setThumbVersions((prev) => ({ ...prev, [videoId]: Date.now() }));
      setThumbPicker(null);
    } catch (e) {
      console.error("selectThumbnail error:", e);
      showToast("Failed to set thumbnail", "error");
    } finally {
      setUpdatingThumb(null);
    }
  };

  const formatTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const formatBytes = (bytes) => {
    if (!bytes || isNaN(bytes)) return "Unknown";
    bytes = parseInt(bytes);
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.min(
      Math.floor(Math.log(bytes) / Math.log(k)),
      sizes.length - 1,
    );
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const formatExpiry = (dateStr) => {
    const date = new Date(dateStr);
    const now = new Date();
    const days = Math.round((date - now) / (1000 * 60 * 60 * 24));
    if (days < 0) return "Expired";
    if (days > 30) {
      const months = Math.floor(days / 30);
      return `${months} month${months > 1 ? "s" : ""} left`;
    }
    return `${days} day${days > 1 ? "s" : ""} left`;
  };

  const getLifetimeProgress = (video) => {
    const expiresAt = new Date(video.expiresAt).getTime();
    const createdAt = video.createdAt
      ? new Date(video.createdAt).getTime()
      : expiresAt - (user ? 180 : 14) * 24 * 60 * 60 * 1000;
    const total = Math.max(expiresAt - createdAt, 1);
    const elapsed = Math.min(Math.max(Date.now() - createdAt, 0), total);
    return Math.round((elapsed / total) * 100);
  };

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <div className="obsidian-ui min-h-screen text-white selection:bg-white/15">
      <MainNav
        user={user}
        logout={logout}
        onOpenSettings={() => setThemeSettingsOpen(true)}
      />

      {/* Main */}
      <main className="max-w-5xl mx-auto px-4 py-5 sm:px-6 sm:py-6">
        <div className="flex flex-col gap-3 mb-6 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-lg font-bold">Dashboard</h1>
          <Link
            to="/"
            className="touch-link flex items-center gap-1 text-xs text-white/60 hover:text-white transition-colors"
          >
            <ArrowLeft size={14} />
            Upload more
          </Link>
          {user && (
            <Link
              to="/forms"
              className="touch-link flex items-center gap-1 text-xs text-white/60 hover:text-white transition-colors"
            >
              Applications
            </Link>
          )}
        </div>

        {videos.length > 0 && (
          <div className="mb-4 flex flex-col gap-2 rounded-[22px] border border-white/10 bg-white/[0.03] p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  setSelectedIds(
                    selectedIds.length === videos.length
                      ? []
                      : videos.map((video) => video.id),
                  )
                }
                className="text-xs font-semibold text-white/70 hover:text-white"
              >
                {selectedIds.length === videos.length ? "Clear selection" : "Select all"}
              </button>
              {selectedIds.length > 0 && (
                <span className="text-xs text-white/35">
                  {selectedIds.length} selected
                </span>
              )}
            </div>
            {selectedIds.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={copySelectedLinks}
                  className="touch-button rounded-full bg-white/5 px-3 text-xs font-semibold text-white/70 hover:bg-white/10 hover:text-white"
                >
                  Copy links
                </button>
                {user && (
                  <button
                    onClick={deleteSelectedVideos}
                    className="touch-button rounded-full bg-red-500/10 px-3 text-xs font-semibold text-red-300 hover:bg-red-500/20"
                  >
                    Delete selected
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Features info for signed-up users */}

        {loading ? (
          <div className="text-white/40 text-center py-12 text-sm">
            Loading...
          </div>
        ) : videos.length === 0 ? (
          <div className="text-center py-12">
            <Play size={24} className="mx-auto mb-2 text-white/20" />
            <p className="text-white/40 text-sm">No videos yet</p>
            <Link to="/" className="text-white/60 text-xs underline">
              Upload one
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {videos.map((video) => (
              <div
                key={video.id}
                className="glass overflow-hidden rounded-[22px]"
              >
                {editingId === video.id ? (
                  // Edit Mode
                  <div className="space-y-3 p-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editForm.originalName}
                        onChange={(e) =>
                          setEditForm({
                            ...editForm,
                            originalName: e.target.value,
                          })
                        }
                        className="h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 text-base font-medium text-white focus:outline-none focus:border-white/30 sm:text-sm"
                        placeholder="Video title (shows in Discord embeds)"
                        maxLength={200}
                      />
                      <button
                        onClick={() => setEditingId(null)}
                        className="p-1 text-white/40 hover:text-white shrink-0"
                      >
                        <X size={14} />
                      </button>
                      <button
                        onClick={() => saveSettings(video.id)}
                        className="flex h-11 shrink-0 items-center gap-1 rounded-full bg-white px-3 text-xs font-medium text-black"
                      >
                        <Save size={12} />
                        Save
                      </button>
                    </div>

                    {/* Volume Slider */}
                    <div>
                      <label className="flex items-center gap-1 text-xs text-white/60 mb-1">
                        <Volume2 size={12} />
                        Volume: {editForm.volume}%
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={editForm.volume}
                        onChange={(e) =>
                          setEditForm({
                            ...editForm,
                            volume: parseInt(e.target.value),
                          })
                        }
                        className="w-full accent-white h-1"
                      />
                    </div>

                    {/* Description */}
                    <div>
                      <textarea
                        value={editForm.description}
                        onChange={(e) =>
                          setEditForm({
                            ...editForm,
                            description: e.target.value,
                          })
                        }
                        placeholder="Description..."
                        className="w-full bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-xs text-white resize-none focus:outline-none focus:border-white/30"
                        rows={1}
                        maxLength={500}
                      />
                    </div>

                    {/* Autoplay Toggle */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-white/60">Autoplay</span>
                      <button
                        onClick={() =>
                          setEditForm({
                            ...editForm,
                            autoplay: !editForm.autoplay,
                          })
                        }
                        className={`w-8 h-4 rounded-full transition-colors ${editForm.autoplay ? "bg-white" : "bg-white/20"}`}
                      >
                        <div
                          className={`w-3 h-3 rounded-full bg-black transition-transform ${editForm.autoplay ? "translate-x-4" : "translate-x-0.5"}`}
                        />
                      </button>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-xs text-white/60">Private link</span>
                      <button
                        onClick={() => togglePrivacy(video)}
                        className={`w-8 h-4 rounded-full transition-colors ${video.isPrivate ? "bg-white" : "bg-white/20"}`}
                      >
                        <div
                          className={`w-3 h-3 rounded-full bg-black transition-transform ${video.isPrivate ? "translate-x-4" : "translate-x-0.5"}`}
                        />
                      </button>
                    </div>

                    {/* Thumbnail Picker */}
                    <div className="border-t border-white/10 pt-3">
                      <button
                        onClick={() => openThumbPicker(video.id)}
                        className="touch-button flex items-center gap-1.5 text-xs text-white/50 hover:text-white transition-colors"
                      >
                        <Image size={12} />
                        {thumbPicker === video.id
                          ? "Hide Thumbnails"
                          : "Choose Thumbnail"}
                      </button>
                      {thumbPicker === video.id && (
                        <div className="mt-2">
                          {thumbLoading ? (
                            <p className="text-xs text-white/30">
                              Loading thumbnails...
                            </p>
                          ) : thumbnails.length === 0 ? (
                            <p className="text-xs text-white/30">
                              No thumbnails available yet
                            </p>
                          ) : (
                            <div className="grid grid-cols-3 gap-1 sm:grid-cols-5">
                              {thumbnails.map((thumb) => (
                                <button
                                  key={thumb.id}
                                  onClick={() =>
                                    selectThumbnail(video.id, thumb.id)
                                  }
                                  disabled={updatingThumb === thumb.id}
                                  className={`relative rounded overflow-hidden border transition-colors ${
                                    updatingThumb === thumb.id
                                      ? "border-white opacity-80"
                                      : "border-white/10 hover:border-white/40"
                                  }`}
                                >
                                  {updatingThumb === thumb.id && (
                                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
                                      <Loader2 size={16} className="animate-spin text-white" />
                                    </div>
                                  )}
                                  <img
                                    src={thumb.url}
                                    alt={`Thumbnail ${thumb.id}`}
                                    className="w-full aspect-video object-cover bg-white/5"
                                  />
                                </button>
                              ))}
                            </div>
                          )}
                          <p className="text-xs text-white/30 mt-1">
                            Pick a thumbnail for Discord embeds
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-white/35">
                        Discord Preview
                      </p>
                      <div className="flex gap-3">
                        <img
                          src={getThumbUrl(video.id)}
                          alt=""
                          className="h-14 w-24 rounded-lg object-cover"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold">
                            {editForm.originalName || "Untitled video"}
                          </p>
                          <p className="mt-1 truncate text-[11px] text-white/40">
                            {getShareUrl(video.id, video)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  // View Mode
                  <div className="flex h-full flex-col">
                    <Link
                      to={`/${video.id}`}
                      className="group relative block aspect-video overflow-hidden bg-black"
                    >
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          toggleSelected(video.id);
                        }}
                        className={`absolute bottom-2 left-2 z-10 grid h-6 w-6 place-items-center rounded-full border ${
                          selectedIds.includes(video.id)
                            ? "border-white bg-white text-black"
                            : "border-white/30 bg-black/60 text-transparent"
                        }`}
                        title="Select video"
                      >
                        <Check size={13} />
                      </button>
                      <video
                        src={getPreviewUrl(video.id)}
                        poster={getThumbUrl(video.id)}
                        muted
                        playsInline
                        preload="metadata"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                        onMouseEnter={(e) =>
                          e.currentTarget.play().catch(() => {})
                        }
                        onMouseLeave={(e) => {
                          e.currentTarget.pause();
                          e.currentTarget.currentTime = 0;
                        }}
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/20 opacity-85 transition-opacity group-hover:opacity-65" />
                      <div className="absolute left-2 top-2 rounded-md border border-white/10 bg-black/70 px-2 py-1 text-[10px] font-semibold text-white/80">
                        Expires {formatExpiry(video.expiresAt)}
                      </div>
                      <div className="absolute right-2 top-2 rounded-md border border-white/10 bg-black/70 px-2 py-1 text-[10px] font-semibold text-white/70">
                        {formatBytes(video.size)}
                      </div>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white shadow-2xl transition-transform group-hover:scale-105">
                          <Play size={20} fill="currentColor" />
                        </div>
                      </div>
                    </Link>

                    <div className="flex flex-1 flex-col p-3">
                      <Link
                        to={`/${video.id}`}
                        className="min-w-0 text-sm font-semibold text-white hover:text-white/80"
                      >
                        <span className="block truncate">
                          {video.originalName || "Untitled video"}
                        </span>
                      </Link>

                      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-white/45">
                        <span className="truncate">{getShareUrl(video.id, video)}</span>
                        <button
                          onClick={() => copyLink(video.id)}
                          className="inline-flex shrink-0 items-center gap-1 text-white/55 hover:text-white"
                          title="Copy link"
                        >
                          {copiedId === video.id ? (
                            <Check size={11} />
                          ) : (
                            <Copy size={11} />
                          )}
                          Copy
                        </button>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-white/45">
                        <span className="inline-flex items-center gap-1">
                          <Calendar size={12} />
                          {formatDate(video.createdAt || video.expiresAt)}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <HardDrive size={12} />
                          {formatBytes(video.size)}
                        </span>
                        {video.volume !== 100 && (
                          <span className="inline-flex items-center gap-1">
                            <Volume2 size={12} />
                            {video.volume}%
                          </span>
                        )}
                      </div>

                      <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-white/60 transition-all duration-700 ease-out"
                          style={{ width: `${getLifetimeProgress(video)}%` }}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 border-t border-white/[0.07] text-[11px] font-semibold text-white/50">
                      <Link
                        to={`/${video.id}`}
                        className="inline-flex h-11 items-center justify-center gap-1.5 border-r border-white/[0.07] hover:bg-white/[0.06] hover:text-white"
                      >
                        <ExternalLink size={12} />
                        Open
                      </Link>
                      <button
                        onClick={() => copyLink(video.id)}
                        className="inline-flex h-11 items-center justify-center gap-1.5 border-r border-white/[0.07] hover:bg-white/[0.06] hover:text-white"
                      >
                        {copiedId === video.id ? (
                          <Check size={12} />
                        ) : (
                          <Copy size={12} />
                        )}
                        {copiedId === video.id ? "Copied" : "Copy"}
                      </button>
                      {user && (
                        <div className="grid grid-cols-3">
                          <button
                            onClick={() => startEditing(video)}
                            className="inline-flex h-11 items-center justify-center hover:bg-white/[0.06] hover:text-white"
                            title="Edit video"
                          >
                            <Edit3 size={12} />
                          </button>
                          <button
                            onClick={() => resetVideoLink(video.id)}
                            className="inline-flex h-11 items-center justify-center border-l border-white/[0.07] hover:bg-white/[0.06] hover:text-white"
                            title="Reset share link"
                          >
                            <RefreshCw size={12} />
                          </button>
                          <button
                            onClick={() => deleteVideo(video.id)}
                            className="inline-flex h-11 items-center justify-center border-l border-white/[0.07] hover:bg-red-500/10 hover:text-red-300"
                            title="Delete video"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      )}
                      {!user && (
                        <Link
                          to="/register"
                          className="inline-flex h-11 items-center justify-center hover:bg-white/[0.06] hover:text-white"
                        >
                          Save
                        </Link>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Stats */}
        {videos.length > 0 && (
          <div className="mt-6 grid gap-2 sm:grid-cols-3">
            <div className="glass rounded-2xl p-3 text-center">
              <p className="text-lg font-bold">
                {user ? `${videos.length}/5` : videos.length}
              </p>
              <p className="text-white/40 text-xs">
                {user ? "Active Videos" : "Videos"}
              </p>
            </div>
            <div className="glass rounded-2xl p-3 text-center">
              <p className="text-lg font-bold">
                {formatBytes(videos.reduce((sum, v) => sum + (v.size || 0), 0))}
              </p>
              <p className="text-white/40 text-xs">Size</p>
            </div>
            <div className="glass rounded-2xl p-3 text-center">
              <p className="text-lg font-bold">{user ? "6mo" : "14d"}</p>
              <p className="text-white/40 text-xs">Retention</p>
            </div>
          </div>
        )}
      </main>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={deleteModal.isOpen}
        onClose={() => setDeleteModal({ isOpen: false, videoId: null })}
        title="Delete Video"
        size="sm"
      >
        <p className="text-sm mb-4">
          Are you sure you want to delete this video? This action cannot be
          undone.
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            onClick={() => setDeleteModal({ isOpen: false, videoId: null })}
            className="touch-button rounded-lg px-4 py-2 text-sm text-white/60 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={confirmDelete}
            className="touch-button rounded-lg bg-red-500 px-4 py-2 text-sm text-white transition-colors hover:bg-red-600"
          >
            Delete
          </button>
        </div>
      </Modal>

      <Modal
        isOpen={resetModal.isOpen}
        onClose={() => setResetModal({ isOpen: false, videoId: null })}
        title="Reset Share Link"
        size="sm"
      >
        <p className="text-sm mb-4">
          This creates a new share link. The old link will stop working
          immediately.
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            onClick={() => setResetModal({ isOpen: false, videoId: null })}
            className="touch-button rounded-lg px-4 py-2 text-sm text-white/60 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={confirmResetLink}
            className="touch-button rounded-lg bg-white px-4 py-2 text-sm text-black transition-colors hover:bg-white/90"
          >
            Reset Link
          </button>
        </div>
      </Modal>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] mt-8">
        <div className="max-w-5xl mx-auto px-4 py-4 flex flex-wrap justify-center gap-4 text-white/30 text-xs sm:px-6">
          <Link to="/info" className="hover:text-white/60 transition-colors">
            Info
          </Link>
          <Link to="/legal" className="hover:text-white/60 transition-colors">
            Legal
          </Link>
          <a
            href="https://discord.gg/JAbzJX4Jce"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-white/60 transition-colors"
          >
            Discord
          </a>
        </div>
        <div className="text-center text-xs text-white/20 pb-3">v1.0.0</div>
      </footer>

      {/* Theme Settings Modal */}
      <ThemeSettings
        isOpen={themeSettingsOpen}
        onClose={() => setThemeSettingsOpen(false)}
        user={user}
      />
    </div>
  );
}
