import { useState, useEffect, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
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
  Loader2,
  RefreshCw,
  MoreVertical,
  Eye,
  Lock,
  Share2,
} from "lucide-react";
import Modal from "../components/Modal";
import { useToast } from "../contexts/ToastContext";
import MainNav from "../components/MainNav";
import VideoPlayer from "../components/VideoPlayer";
import BunnyPlayer from "../components/BunnyPlayer";
import { isPlaybackReady, isPlaybackFailed } from "../utils/videoReadiness";
import { API_URL } from "../utils/api";
import { formatLocalUploadPopoutDate } from "../utils/dates";
import { getOriginalPlaybackUrl, getSafePlaybackUrl } from "../utils/videoUrls";
import { getUploadProgressForStatus, getUploadStatusCopy } from "../utils/processingStatus";
import { APP_VERSION } from "../constants/version";

const getVideoCreatedTime = (video) => {
  const createdAt = video?.uploadedAtUtc || video?.createdAt;
  const time = createdAt ? new Date(createdAt).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
};

const sortVideosNewestFirst = (items = []) =>
  items
    .map((video, index) => ({ video, index }))
    .sort((left, right) => {
      const timeDifference =
        getVideoCreatedTime(right.video) - getVideoCreatedTime(left.video);
      if (timeDifference !== 0) return timeDifference;
      return left.index - right.index;
    })
    .map((item) => item.video);

export default function Dashboard({ user, logout }) {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const MAX_VIDEO_SIZE_MB = 100;
  const MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MB * 1024 * 1024;
  const MAX_PROCESSING_ATTEMPTS = 120;
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
  const [bulkDeleteModalOpen, setBulkDeleteModalOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [resetModal, setResetModal] = useState({
    isOpen: false,
    videoId: null,
  });
  const [thumbPicker, setThumbPicker] = useState(null);
  const [thumbnails, setThumbnails] = useState([]);
  const [thumbLoading, setThumbLoading] = useState(false);
  const [thumbVersions, setThumbVersions] = useState({});
  const [thumbnailOverrides, setThumbnailOverrides] = useState({});
  const [pendingThumbnails, setPendingThumbnails] = useState({});
  const [deleteAccountModalOpen, setDeleteAccountModalOpen] = useState(false);
  const [deleteAccountLoading, setDeleteAccountLoading] = useState(false);
  const [editModalVideo, setEditModalVideo] = useState(null);
  const [embedModalVideo, setEmbedModalVideo] = useState(null);
  const [privacyModalVideo, setPrivacyModalVideo] = useState(null);
  const [thumbnailModalVideo, setThumbnailModalVideo] = useState(null);
  const [embedConfig, setEmbedConfig] = useState({
    responsive: true,
    loop: true,
    autoplay: false,
    muted: false,
    controls: true,
  });
  const [privacyConfig, setPrivacyConfig] = useState({
    visibility: "public",
    domainPrivacy: false,
    allowedDomains: "",
    passwordProtection: false,
    password: "",
    allowDownloading: false,
    allowSharing: true,
    allowTimeComments: false,
  });
  const [privacySaving, setPrivacySaving] = useState(false);
  const [popoutVideoId, setPopoutVideoId] = useState(null);
  const [popoutVideoData, setPopoutVideoData] = useState(null);
  const [popoutLoading, setPopoutLoading] = useState(false);
  const [popoutError, setPopoutError] = useState(null);
  const [popoutProcessing, setPopoutProcessing] = useState(false);
  const popoutPollRef = useRef(null);
  const [openMenuId, setOpenMenuId] = useState(null);
  const fileInputRef = useRef(null);
  const pollIntervalsRef = useRef(new Map());
  const [uploadQueue, setUploadQueue] = useState([]);
  const uploadQueueRef = useRef([]);
  const uploadRunnerActiveRef = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [selectedVideoIds, setSelectedVideoIds] = useState([]);

  useEffect(() => {
    loadVideos();
  }, [user]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      setOpenMenuId(null);
    };

    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  useEffect(() => {
    uploadQueueRef.current = uploadQueue;
  }, [uploadQueue]);

  useEffect(() => {
    return () => {
      pollIntervalsRef.current.forEach(clearInterval);
      pollIntervalsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!location.search.includes("pick=1")) return;
    const timeout = setTimeout(() => {
      fileInputRef.current?.click();
    }, 120);
    return () => clearTimeout(timeout);
  }, [location.search]);

  const updateUploadItem = (localId, patch) => {
    setUploadQueue((current) => {
      const nextQueue = current.map((item) =>
        item.localId === localId ? { ...item, ...patch } : item,
      );
      uploadQueueRef.current = nextQueue;
      return nextQueue;
    });
  };

  const markUploadFailed = (localId, label = "Upload failed") => {
    updateUploadItem(localId, { status: "error", label, progress: 0 });
    showToast(label, "error");
  };

  const toggleVideoSelection = (videoId) => {
    setSelectedVideoIds((current) =>
      current.includes(videoId)
        ? current.filter((id) => id !== videoId)
        : [...current, videoId],
    );
  };

  const selectAllVideos = () => {
    setSelectedVideoIds(videos.map((video) => video.id));
  };

  const pollTranscodingStatus = (localId, videoId) => {
    let attempts = 0;
    const interval = setInterval(async () => {
      try {
        attempts += 1;
        const res = await fetch(`${API_URL}/api/video/${videoId}`);
        const data = await res.json();
        const status = Number(data.transcodingStatus);
        const progress = Number(data.encodeProgress) || 0;
        const statusCopy = getUploadStatusCopy({
          status,
          progress,
          processingMessage: data.processingMessage,
        });

        updateUploadItem(localId, {
          label: statusCopy.label,
          detail: statusCopy.detail,
          progress: getUploadProgressForStatus(status, progress),
        });

        if (isPlaybackReady(data)) {
          const token = localStorage.getItem("token");
          const embedRes = token
            ? await fetch(`${API_URL}/api/video/${videoId}/discord-embed-check`, {
                headers: { Authorization: `Bearer ${token}` },
              })
            : null;
          const embedData = embedRes ? await embedRes.json().catch(() => ({})) : { ready: true };

          if (embedData.ready === true) {
            clearInterval(interval);
            pollIntervalsRef.current.delete(localId);
            updateUploadItem(localId, {
              status: "ready",
              label: "Ready",
              detail: "Playback and Discord embed checks are complete.",
              progress: 100,
            });
            showToast("Video ready to share!", "success");
            loadVideos();
            setTimeout(() => {
              setUploadQueue((current) => {
                const nextQueue = current.filter((item) => item.localId !== localId);
                uploadQueueRef.current = nextQueue;
                return nextQueue;
              });
            }, 2500);
          } else {
            updateUploadItem(localId, {
              label: "Finalizing Discord embed...",
              detail: embedData.error || "Discord needs the MP4 preview metadata before embeds are marked ready.",
              progress: 100,
            });
          }
        } else if (isPlaybackFailed(data)) {
          clearInterval(interval);
          pollIntervalsRef.current.delete(localId);
          markUploadFailed(localId, "Video processing failed");
        } else if (attempts >= MAX_PROCESSING_ATTEMPTS) {
          clearInterval(interval);
          pollIntervalsRef.current.delete(localId);
          markUploadFailed(localId, "Processing took too long. Try upload again.");
        }
      } catch {
        if (attempts >= MAX_PROCESSING_ATTEMPTS) {
          clearInterval(interval);
          pollIntervalsRef.current.delete(localId);
          markUploadFailed(localId, "Could not check processing status");
        }
      }
    }, 3000);
    pollIntervalsRef.current.set(localId, interval);
  };

  const uploadFile = (queueItem) =>
    new Promise((resolve) => {
      const formData = new FormData();
      formData.append("video", queueItem.file);
      try {
        const uploadTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (uploadTimezone) formData.append("uploadTimezone", uploadTimezone);
      } catch {}

      const token = user ? localStorage.getItem("token") : null;
      const endpoint = user && token ? `${API_URL}/api/upload` : `${API_URL}/api/upload-anonymous`;
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 90);
          updateUploadItem(queueItem.localId, {
            status: "uploading",
            label: "Uploading to CUTRR",
            detail: `${progress}% uploaded before Bunny starts processing.`,
            progress,
          });
        }
      });

      xhr.addEventListener("load", () => {
        if (xhr.status !== 200) {
          let message = "Upload failed";
          try {
            const errorData = JSON.parse(xhr.responseText || "{}");
            message = errorData.error || message;
          } catch {}
          markUploadFailed(queueItem.localId, message);
          resolve(false);
          return;
        }
        const data = JSON.parse(xhr.responseText);
        if (!user || !token) {
          const anonVideos = JSON.parse(localStorage.getItem("anonVideos") || "[]");
          const nextAnonVideos = [data.id, ...anonVideos.filter((id) => id !== data.id)];
          localStorage.setItem("anonVideos", JSON.stringify(nextAnonVideos));
        }
        updateUploadItem(queueItem.localId, {
          status: "transcoding",
          label: "Sending video to Bunny",
          detail: "CUTRR saved the upload and Bunny is creating the video record.",
          progress: 92,
          videoId: data.id,
        });
        pollTranscodingStatus(queueItem.localId, data.id);
        resolve(true);
      });

      xhr.addEventListener("error", () => {
        markUploadFailed(queueItem.localId, "Network error during upload");
        resolve(false);
      });

      xhr.open("POST", endpoint);
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.send(formData);
    });

  const isVideoFile = (file) =>
    file.type.startsWith("video/") || /\.(mp4|webm|mov|avi|mkv)$/i.test(file.name)

  const addFiles = (files) => {
    if (user && !user.activeVideoUnlimited) {
      const activeLimit = Number.parseInt(user.activeVideoLimit || 5, 10);
      const queuedCount = uploadQueue.filter((item) => item.status !== "error").length;
      if (videos.length + queuedCount >= activeLimit) {
        showToast(
          `Active video limit reached. Your account includes ${activeLimit} active videos.`,
          "error",
        );
        return;
      }
    }

    const validFiles = [...files].filter((candidate) => {
      if (!isVideoFile(candidate)) {
        showToast(`${candidate.name}: only video files allowed`, "error");
        return false;
      }
      if (candidate.size > MAX_VIDEO_SIZE_BYTES) {
        showToast(`${candidate.name}: max size is ${MAX_VIDEO_SIZE_MB}MB`, "error");
        return false;
      }
      return true;
    });
    if (!validFiles.length) return;
    setUploadQueue((current) => {
      const nextQueue = [
        ...current,
        ...validFiles.map((file) => ({
        localId: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        file,
        status: "queued",
        label: "Starting upload...",
        progress: 0,
        })),
      ];
      uploadQueueRef.current = nextQueue;
      return nextQueue;
    });
  };

  useEffect(() => {
    if (uploadRunnerActiveRef.current) return;
    if (!uploadQueueRef.current.some((item) => item.status === "queued")) return;

    uploadRunnerActiveRef.current = true;
    setUploading(true);

    const run = async () => {
      try {
        while (true) {
          const queuedItem = uploadQueueRef.current.find((item) => item.status === "queued");
          if (!queuedItem) break;
          updateUploadItem(queuedItem.localId, {
            status: "starting",
            label: "Starting upload...",
            progress: Math.max(queuedItem.progress || 0, 1),
          });
          await uploadFile(queuedItem);
        }
      } finally {
        uploadRunnerActiveRef.current = false;
        setUploading(false);
        if (uploadQueueRef.current.some((item) => item.status === "queued")) {
          setUploadQueue((current) => [...current]);
        }
      }
    };

    run();
  }, [uploadQueue]);

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
        setVideos(sortVideosNewestFirst(Array.isArray(data) ? data : []));
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
            setVideos(sortVideosNewestFirst(data));
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

  useEffect(() => {
    if (!popoutVideoId) {
      setPopoutVideoData(null);
      setPopoutError(null);
      setPopoutProcessing(false);
      if (popoutPollRef.current) {
        clearTimeout(popoutPollRef.current);
        popoutPollRef.current = null;
      }
      return;
    }

    const fetchPopoutData = async () => {
      setPopoutLoading(true);
      setPopoutError(null);
      setPopoutProcessing(false);
      const token = localStorage.getItem("token");
      const requestOptions = token
        ? { headers: { Authorization: `Bearer ${token}` } }
        : undefined;
      try {
        const res = await fetch(`${API_URL}/api/video/${popoutVideoId}`, requestOptions);
        if (!res.ok) throw new Error("Video not found");
        const data = await res.json();

        if (!isPlaybackReady(data)) {
          setPopoutProcessing(true);
          setPopoutVideoData(data);

          let attempt = 0;
          let pollInFlight = false;
          const pollOnce = async () => {
            if (pollInFlight) return;
            pollInFlight = true;
            try {
              attempt += 1;
              const pollRes = await fetch(`${API_URL}/api/video/${popoutVideoId}`, requestOptions);
              const pollData = await pollRes.json();
              if (isPlaybackReady(pollData)) {
                popoutPollRef.current = null;
                setPopoutProcessing(false);
                setPopoutVideoData(pollData);
                return;
              }
              if (isPlaybackFailed(pollData)) {
                popoutPollRef.current = null;
                setPopoutProcessing(false);
                setPopoutError("Video processing failed");
                return;
              }
            } catch {}
            finally {
              pollInFlight = false;
            }

            popoutPollRef.current = setTimeout(pollOnce, getPopoutPollIntervalMs(attempt));
          };

          pollOnce();
        } else {
          setPopoutVideoData(data);
        }
      } catch (e) {
        setPopoutError(e.message || "Failed to load video");
      } finally {
        setPopoutLoading(false);
      }
    };

    fetchPopoutData();

    return () => {
      if (popoutPollRef.current) {
        clearTimeout(popoutPollRef.current);
        popoutPollRef.current = null;
      }
    };
  }, [popoutVideoId]);

  const openPopout = (videoOrId, e) => {
    if (e) {
      e.preventDefault();
    }
    const nextVideoId = typeof videoOrId === "object" ? videoOrId.id : videoOrId;
    if (typeof videoOrId === "object") setPopoutVideoData(videoOrId);
    setPopoutVideoId(nextVideoId);
  };

  const closePopout = () => {
    setPopoutVideoId(null);
    if (popoutPollRef.current) {
      clearTimeout(popoutPollRef.current);
      popoutPollRef.current = null;
    }
  };

  const getPopoutPollIntervalMs = (attempt) => {
    if (attempt >= 200) return 15000;
    if (attempt >= 100) return 10000;
    if (attempt >= 40) return 5000;
    return 3000;
  };

  const copyLink = (id) => {
    const video = videos.find((item) => item.id === id);
    navigator.clipboard.writeText(getShareUrl(id, video));
    setCopiedId(id);
    showToast("Link copied", "success");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getShareUrl = (id, video) =>
    `${window.location.origin}/${id}${
      video?.isPrivate && video?.privateToken
        ? `?token=${video.privateToken}`
        : ""
    }`;
  const getThumbUrl = (id, video) => {
    if (thumbnailOverrides[id]) return thumbnailOverrides[id];
    const params = new URLSearchParams();
    if (video?.isPrivate && video?.privateToken) params.set("token", video.privateToken);
    if (video?.thumbnailIndex != null) params.set("t", String(video.thumbnailIndex));
    if (thumbVersions[id] != null) params.set("v", String(thumbVersions[id]));
    const authToken = localStorage.getItem("token");
    if (authToken) params.set("authToken", authToken);
    const query = params.toString();
    return `${API_URL}/thumb/${id}${query ? `?${query}` : ""}`;
  };
  const getPlayerVolume = (video) =>
    Math.min(Math.max((video?.volume ?? 100) / 100, 0), 1);
  const getVideoAccessQuery = (video) => {
    const params = new URLSearchParams();
    if (video?.isPrivate && video?.privateToken) {
      params.set("token", video.privateToken);
    }
    const query = params.toString();
    return query ? `?${query}` : "";
  };

  const startEditing = (video) => {
    setEditingId(`modal-${video.id}`);
    setEditModalVideo(video);
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
      setVideos((current) =>
        sortVideosNewestFirst(
          current.map((v) =>
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
        ),
      );
      setEditingId(null);
      setEditModalVideo(null);
      showToast("Video updated", "success");
    } catch (e) {
      showToast("Failed to save settings", "error");
    }
  };

  const openEmbedModal = (video) => {
    if (video?.allowSharing === false) {
      showToast("Sharing is disabled for this video", "error");
      return;
    }
    setEmbedModalVideo(video);
  };

  const buildEmbedCode = (video) => {
    if (!video) return "";
    if (video.allowSharing === false) return "";
    const shareUrl = getShareUrl(video.id, video);
    const params = new URLSearchParams();
    if (embedConfig.loop) params.set("loop", "1");
    if (embedConfig.autoplay) params.set("autoplay", "1");
    if (embedConfig.muted) params.set("muted", "1");
    if (!embedConfig.controls) params.set("controls", "0");
    const src = `${shareUrl}${shareUrl.includes("?") ? "&" : "?"}${params.toString()}`;
    if (embedConfig.responsive) {
      return `<div style="position:relative;width:100%;height:0;padding-bottom:56.25%"><iframe src="${src}" allowfullscreen allow="autoplay; fullscreen" style="position:absolute;inset:0;width:100%;height:100%;border:0"></iframe></div>`;
    }
    return `<iframe src="${src}" width="960" height="540" allowfullscreen allow="autoplay; fullscreen" frameborder="0"></iframe>`;
  };

  const copyEmbedCode = () => {
    if (!embedModalVideo) return;
    navigator.clipboard.writeText(buildEmbedCode(embedModalVideo));
    showToast("Embed code copied", "success");
  };

  const openPrivacyModal = (video) => {
    if (!user) {
      showToast("Sign in to save privacy settings", "error");
      return;
    }
    setPrivacyModalVideo(video);
    setPrivacyConfig({
      visibility: video.visibility || (video.isPrivate ? "private" : "public"),
      domainPrivacy: video.domainPrivacy === true,
      allowedDomains: video.allowedDomains || "",
      passwordProtection: video.passwordProtection === true,
      password: "",
      allowDownloading: video.allowDownloading !== false,
      allowSharing: video.allowSharing !== false,
      allowTimeComments: video.allowTimeComments === true,
    });
  };

  const savePrivacySettings = async () => {
    if (!privacyModalVideo) return;
    const token = localStorage.getItem("token");
    if (!token) {
      showToast("Sign in to save privacy settings", "error");
      return;
    }
    if (
      privacyConfig.passwordProtection &&
      !privacyConfig.password.trim() &&
      !privacyModalVideo.passwordProtection
    ) {
      showToast("Enter a password to enable password protection", "error");
      return;
    }
    setPrivacySaving(true);
    try {
      const res = await fetch(
        `${API_URL}/api/video/${privacyModalVideo.id}/privacy-settings`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
           body: JSON.stringify({
             visibility: privacyConfig.visibility,
             allowDownloading: privacyConfig.allowDownloading,
             allowSharing: privacyConfig.allowSharing,
             domainPrivacy: privacyConfig.domainPrivacy,
             allowedDomains: privacyConfig.allowedDomains,
             passwordProtection: privacyConfig.passwordProtection,
             password: privacyConfig.password,
             allowTimeComments: privacyConfig.allowTimeComments,
           }),
         },
       );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save privacy");
      await loadVideos();
      showToast("Privacy settings saved", "success");
      setPrivacyModalVideo(null);
    } catch (e) {
      showToast(e.message || "Failed to save privacy", "error");
    } finally {
      setPrivacySaving(false);
    }
  };

  const openThumbnailModal = async (video) => {
    setThumbnailModalVideo(video);
    await openThumbPicker(video.id);
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
      setVideos((current) =>
        sortVideosNewestFirst(current.filter((v) => v.id !== deleteModal.videoId)),
      );
      setDeleteModal({ isOpen: false, videoId: null });
      showToast("Video deleted", "success");
    } catch (e) {
      showToast("Failed to delete video", "error");
    }
  };

  const confirmBulkDelete = async () => {
    const token = localStorage.getItem("token");
    if (!token || selectedVideoIds.length === 0 || bulkDeleting) return;

    setBulkDeleting(true);
    const idsToDelete = [...selectedVideoIds];
    try {
      const results = await Promise.allSettled(
        idsToDelete.map(async (videoId) => {
          const res = await fetch(`${API_URL}/api/video/${videoId}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) throw new Error(`Failed to delete ${videoId}`);
          return videoId;
        }),
      );

      const deletedIds = results
        .filter((result) => result.status === "fulfilled")
        .map((result) => result.value);
      const failedCount = results.length - deletedIds.length;

      if (deletedIds.length > 0) {
        setVideos((current) =>
          sortVideosNewestFirst(current.filter((video) => !deletedIds.includes(video.id))),
        );
        setSelectedVideoIds((current) =>
          current.filter((videoId) => !deletedIds.includes(videoId)),
        );
      }

      if (failedCount > 0) {
        showToast(`${failedCount} video${failedCount === 1 ? "" : "s"} could not be deleted`, "error");
      } else {
        showToast(`${deletedIds.length} video${deletedIds.length === 1 ? "" : "s"} deleted`, "success");
        setBulkDeleteModalOpen(false);
      }
    } catch (e) {
      showToast("Failed to delete selected videos", "error");
    } finally {
      setBulkDeleting(false);
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
        sortVideosNewestFirst(
          current.map((video) =>
            video.id === resetModal.videoId ? { ...video, id: data.id } : video,
          ),
        ),
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
        sortVideosNewestFirst(
          current.map((item) =>
            item.id === video.id
              ? {
                  ...item,
                  isPrivate: data.isPrivate,
                  privateToken: data.privateToken,
                  visibility: data.visibility || (data.isPrivate ? "private" : "public"),
                }
              : item,
          ),
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
    if (pendingThumbnails[videoId]) return;
    const selectedThumb = thumbnails.find((thumb) => thumb.id === time);
    const previousOverride = thumbnailOverrides[videoId];
    if (selectedThumb?.url) {
      setThumbnailOverrides((current) => ({
        ...current,
        [videoId]: selectedThumb.url,
      }));
    }
    setPendingThumbnails((current) => ({ ...current, [videoId]: time }));
    try {
      const res = await fetch(`${API_URL}/api/video/${videoId}/thumbnail`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ time }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed");
      showToast(
        "Thumbnail updated — may take a moment to update everywhere",
        "success",
      );
      setVideos((current) =>
        sortVideosNewestFirst(
          current.map((video) =>
            video.id === videoId
              ? { ...video, thumbnailIndex: data.thumbnailIndex || time }
              : video,
          ),
        ),
      );
      setThumbVersions((prev) => ({ ...prev, [videoId]: Date.now() }));
      setThumbPicker(null);
      setThumbnailModalVideo(null);
    } catch (e) {
      console.error("selectThumbnail error:", e);
      setThumbnailOverrides((current) => {
        const next = { ...current };
        if (previousOverride) {
          next[videoId] = previousOverride;
        } else {
          delete next[videoId];
        }
        return next;
      });
      showToast("Failed to set thumbnail", "error");
    } finally {
      setPendingThumbnails((current) => {
        const next = { ...current };
        delete next[videoId];
        return next;
      });
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
    return `${days} day${days > 1 ? "s" : ""} left`;
  };

  const getLifetimeProgress = (video) => {
    const expiresAt = new Date(video.expiresAt).getTime();
    const createdAt = video.uploadedAtUtc || video.createdAt
      ? new Date(video.uploadedAtUtc || video.createdAt).getTime()
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
  const formatPopoutDate = (video) =>
    formatLocalUploadPopoutDate(video?.uploadedAtUtc || video?.createdAt);
  const thumbnailModalVideoId = thumbnailModalVideo?.id;
  const VisibilityOption = ({ value, title, description }) => (
    <label className="flex cursor-pointer items-center gap-4 border-b border-[var(--panel-border)] py-4 last:border-b-0">
      <input
        type="radio"
        name="visibility"
        checked={privacyConfig.visibility === value}
        onChange={() =>
          setPrivacyConfig((current) => ({ ...current, visibility: value }))
        }
        className="h-4 w-4 accent-blue-600"
      />
      <span>
        <span className="block text-base font-medium text-[var(--page-fg)]">{title}</span>
        <span className="block text-sm text-[var(--muted-text)]">{description}</span>
      </span>
    </label>
  );
  const PrivacyToggle = ({ label, description, checked, onChange }) => (
    <div className="flex min-w-0 items-center justify-between gap-4 border-b border-[var(--panel-border)] py-4 last:border-b-0">
      <div className="min-w-0 pr-2">
        <p className="text-base font-semibold text-[var(--page-fg)]">{label}</p>
        <p className="text-sm text-[var(--muted-text)]">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-14 shrink-0 rounded-full border transition-colors ${
          checked ? "border-blue-500 bg-blue-600" : "border-[var(--muted-border)] bg-[var(--muted-bg)]"
        }`}
      >
        <span
          className="absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform"
          style={{ transform: checked ? "translateX(28px)" : "translateX(0)" }}
        />
      </button>
    </div>
  );
  const EmbedRadio = ({ checked, onChange, label }) => (
    <button
      type="button"
      onClick={onChange}
      className="inline-flex items-center gap-2 text-sm text-[var(--muted-text-strong)]"
    >
      <span
        className={`grid h-4 w-4 place-items-center rounded-full border ${
          checked ? "border-blue-500" : "border-[var(--muted-border)]"
        }`}
      >
        {checked && <span className="h-2 w-2 rounded-full bg-blue-500" />}
      </span>
      {label}
    </button>
  );
  const EmbedCheckbox = ({ checked, onChange, label }) => (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 text-sm text-[var(--muted-text-strong)]"
    >
      <span
        className={`grid h-4 w-4 place-items-center rounded border ${
          checked ? "border-blue-500 bg-blue-600" : "border-[var(--muted-border)] bg-[var(--input-bg)]"
        }`}
      >
        {checked && <Check size={12} className="text-white" />}
      </span>
      {label}
    </button>
  );

  const confirmDeleteAccount = async () => {
    const token = localStorage.getItem("token");
    if (!token || deleteAccountLoading) return;

    setDeleteAccountLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/me`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to delete account");

      localStorage.removeItem("anonVideos");
      setVideos([]);
      setDeleteAccountModalOpen(false);
      logout?.();
      navigate("/");
      showToast("Account deleted", "success");
    } catch (e) {
      showToast(e.message || "Failed to delete account", "error");
    } finally {
      setDeleteAccountLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-[var(--page-bg)] text-[var(--page-fg)] selection:bg-blue-500/15">
      <MainNav user={user} logout={logout} />

      {/* Main */}
      <main
        className="flex-1 px-4 py-8 sm:px-6 lg:px-8"
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          addFiles(event.dataTransfer.files);
        }}
      >
        <div className="mx-auto w-full max-w-5xl">
          {/* Upload button */}
          <div className="mb-8 flex justify-center">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex h-9 items-center justify-center gap-2 rounded bg-blue-600 px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
            >
              <Play size={14} />
              Upload video
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".mp4,.webm,.mov,.avi,.mkv"
              onChange={(event) => {
                addFiles(event.target.files);
                event.target.value = "";
              }}
              className="hidden"
            />
          </div>

          {uploadQueue.length > 0 && (
            <div className="mx-auto mb-6 w-full max-w-3xl rounded-lg border border-[var(--panel-border)] bg-[var(--panel-bg)] p-4">
              <div className="space-y-3">
                {uploadQueue.map((item) => (
                  <div key={item.localId} className="rounded-md bg-[var(--muted-bg)] p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="truncate text-sm text-[var(--muted-text-strong)]">
                        {item.file.name.replace(/\.[^/.]+$/, "")}
                      </p>
                      <div className="min-w-[12rem] text-right">
                        <p className="truncate text-xs text-[var(--muted-text)]">{item.label}</p>
                        <p className="mt-0.5 min-h-4 max-w-[18rem] truncate text-[11px] text-[var(--muted-text)] opacity-70">
                          {item.detail || "Waiting for the next upload step."}
                        </p>
                      </div>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--muted-bg-strong)]">
                      <div
                        className="h-full bg-blue-600 transition-all duration-300"
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {dragOver && (
            <div className="pointer-events-none fixed inset-0 z-[900] grid place-items-center bg-black/55">
              <div className="rounded-xl border border-white/30 bg-black/70 px-6 py-4 text-sm text-white">
                Drop video files to upload
              </div>
            </div>
          )}

          {loading ? (
            <div className="text-center py-12 text-sm text-gray-500">
              Loading...
            </div>
          ) : videos.length === 0 ? (
            <div className="text-center py-12">
              <Play size={24} className="mx-auto mb-2 text-gray-400" />
              <p className="text-gray-600 text-sm">No videos yet</p>
            </div>
          ) : (
            <div>
              {selectedVideoIds.length > 0 && (
                <div className="mb-4 flex flex-col gap-3 rounded-lg border border-[var(--panel-border)] bg-[var(--panel-bg)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-sm font-semibold text-[var(--muted-text-strong)]">
                    {selectedVideoIds.length} selected
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={selectAllVideos}
                      className="rounded-md border border-[var(--muted-border)] bg-[var(--muted-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--muted-text-strong)] hover:bg-[var(--muted-bg-strong)]"
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedVideoIds([])}
                      className="rounded-md border border-[var(--muted-border)] bg-[var(--muted-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--muted-text-strong)] hover:bg-[var(--muted-bg-strong)]"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={() => setBulkDeleteModalOpen(true)}
                      className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                    >
                      Delete selected
                    </button>
                  </div>
                </div>
              )}
              {/* Main Video List */}
              <div className="mx-auto grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {videos.map((video) => (
                  <div key={video.id} className="w-full max-w-[360px]">
                    {editingId === video.id ? (
                      // Edit mode
                      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="font-semibold text-gray-900">Edit Video</h3>
                          <button
                            onClick={() => setEditingId(null)}
                            className="grid h-8 w-8 place-items-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                            title="Cancel"
                          >
                            <X size={14} />
                          </button>
                        </div>

                        <img
                          src={getThumbUrl(video.id, video)}
                          alt=""
                          className="aspect-video w-full rounded-lg bg-gray-100 object-cover mb-4"
                        />

                        <div className="space-y-3">
                          <div>
                            <label className="block text-xs font-semibold text-gray-700 mb-1">
                              Video Title
                            </label>
                            <input
                              type="text"
                              value={editForm.originalName}
                              onChange={(e) =>
                                setEditForm({
                                  ...editForm,
                                  originalName: e.target.value,
                                })
                              }
                              className="w-full h-9 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                              placeholder="Video title"
                              maxLength={200}
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-gray-700 mb-1">
                              Description
                            </label>
                            <textarea
                              value={editForm.description}
                              onChange={(e) =>
                                setEditForm({
                                  ...editForm,
                                  description: e.target.value,
                                })
                              }
                              placeholder="Description..."
                              className="w-full h-20 resize-none rounded-md border border-gray-300 bg-white px-3 py-2 text-xs text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                              maxLength={500}
                            />
                          </div>

                          <div>
                            <label className="text-xs font-semibold text-gray-700 flex items-center gap-2 mb-2">
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
                              className="w-full h-1 accent-blue-600"
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <button
                              onClick={() =>
                                setEditForm({
                                  ...editForm,
                                  autoplay: !editForm.autoplay,
                                })
                              }
                              className={`h-9 rounded-md border text-xs font-semibold transition-colors ${
                                editForm.autoplay
                                  ? "border-blue-500 bg-blue-50 text-blue-600"
                                  : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                              }`}
                            >
                              Autoplay
                            </button>
                            <button
                              onClick={() => togglePrivacy(video)}
                              className={`h-9 rounded-md border text-xs font-semibold transition-colors ${
                                video.isPrivate
                                  ? "border-blue-500 bg-blue-50 text-blue-600"
                                  : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                              }`}
                            >
                              {video.isPrivate ? "Private" : "Public"}
                            </button>
                          </div>

                          <div className="border-t border-gray-200 pt-3">
                            <button
                              onClick={() => openThumbPicker(video.id)}
                              className="w-full inline-flex items-center justify-center gap-1.5 h-9 rounded-md border border-gray-300 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                            >
                              <Image size={12} />
                              {thumbPicker === video.id ? "Hide thumbnails" : "Choose thumbnail"}
                            </button>
                            {thumbPicker === video.id && (
                              <div className="mt-3">
                                {thumbLoading ? (
                                  <p className="text-xs text-gray-500">Loading thumbnails...</p>
                                ) : thumbnails.length === 0 ? (
                                  <p className="text-xs text-gray-500">No thumbnails available yet</p>
                                ) : (
                                  <div className="grid grid-cols-4 gap-1">
                                    {thumbnails.map((thumb) => {
                                      const pendingThumb = pendingThumbnails[video.id];
                                      const isPending = pendingThumb === thumb.id;
                                      return (
                                        <button
                                          key={thumb.id}
                                          onClick={() => selectThumbnail(video.id, thumb.id)}
                                          disabled={Boolean(pendingThumb)}
                                          className={`relative overflow-hidden rounded border transition-colors ${
                                            isPending
                                              ? "border-blue-500 opacity-90"
                                              : pendingThumb
                                                ? "border-gray-300 opacity-50"
                                                : "border-gray-300 hover:border-gray-400"
                                          }`}
                                        >
                                          {isPending && (
                                            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/55">
                                              <Loader2 size={14} className="animate-spin text-white" />
                                            </div>
                                          )}
                                          <img
                                            src={thumb.url}
                                            alt={`Thumbnail ${thumb.id}`}
                                            className="aspect-video w-full bg-gray-100 object-cover"
                                          />
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="flex gap-2 pt-2">
                            <button
                              onClick={() => setEditingId(null)}
                              className="flex-1 rounded-md px-3 h-9 text-sm text-gray-700 hover:bg-gray-100 transition-colors border border-gray-300"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => saveSettings(video.id)}
                              className="flex-1 inline-flex items-center justify-center gap-1 rounded-md bg-blue-600 px-3 h-9 text-xs font-semibold text-white hover:bg-blue-700 transition-colors"
                            >
                              <Save size={12} />
                              Save
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      // Normal card view
                      <div className="group rounded-lg border border-[var(--panel-border)] bg-[var(--panel-bg)] shadow-sm hover:shadow-md transition-shadow">
                        {/* Video Thumbnail */}
                        <div className="relative aspect-video w-full overflow-hidden rounded-t-lg bg-gray-900">
                          <button
                            type="button"
                            onClick={(e) => openPopout(video, e)}
                            className="h-full w-full"
                          >
                            <img
                              key={getThumbUrl(video.id, video)}
                              src={getThumbUrl(video.id, video)}
                              alt=""
                              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                            />
                            <div className="absolute inset-0 grid place-items-center bg-black/20 opacity-0 transition-opacity group-hover:opacity-100">
                              <Play size={24} fill="currentColor" className="text-white" />
                            </div>
                            <div className="absolute bottom-2 left-2 bg-yellow-400/90 px-2 py-1 rounded text-xs font-semibold text-black flex items-center gap-1">
                              <Calendar size={12} />
                              {formatExpiry(video.expiresAt)}
                            </div>
                          </button>
                          <button
                            type="button"
                            aria-pressed={selectedVideoIds.includes(video.id)}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleVideoSelection(video.id);
                            }}
                            className={`absolute left-1.5 top-1.5 z-10 grid h-5 w-5 place-items-center rounded border backdrop-blur transition-colors ${
                              selectedVideoIds.includes(video.id)
                                ? "border-blue-400 bg-blue-600/50 text-white"
                                : "border-white/40 bg-black/50 text-transparent hover:text-white"
                            }`}
                            title={selectedVideoIds.includes(video.id) ? "Deselect video" : "Select video"}
                          >
                            <Check size={11} />
                          </button>
                        </div>

                        {/* Card Content */}
                        <div className="p-4">
                          {/* Title */}
                          <button
                            type="button"
                            onClick={(e) => openPopout(video, e)}
                            className="block w-full text-left mb-2"
                          >
                            <h3 className="font-semibold text-[var(--page-fg)] truncate hover:text-blue-400 transition-colors text-sm">
                              {video.originalName || "Untitled video"}
                            </h3>
                          </button>

                          {/* URL and Copy */}
                          <div className="mb-3 flex items-center gap-2 rounded-md border px-2.5 py-2" style={{ borderColor: "var(--muted-border)", background: "var(--muted-bg-strong)" }}>
                            {video.allowSharing !== false ? (
                              <>
                                <button
                                  onClick={() => window.open(getShareUrl(video.id, video), "_blank", "noopener,noreferrer")}
                                  className="flex-1 min-w-0 truncate text-left text-[11px] text-blue-500 transition-colors hover:text-blue-600"
                                >
                                  {getShareUrl(video.id, video)}
                                </button>
                                <button
                                  onClick={() => copyLink(video.id)}
                                  className="grid h-6 w-6 shrink-0 place-items-center rounded transition-colors"
                                  style={{ background: "var(--muted-bg)", color: "var(--muted-text)" }}
                                  title="Copy link"
                                >
                                  {copiedId === video.id ? (
                                    <Check size={14} />
                                  ) : (
                                    <Copy size={14} />
                                  )}
                                </button>
                              </>
                            ) : (
                              <span className="text-[11px]" style={{ color: "var(--muted-text)" }}>
                                Sharing is disabled for this video
                              </span>
                            )}
                          </div>

                          {/* Action Buttons */}
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => openEmbedModal(video)}
                              disabled={video.allowSharing === false}
                              className={`flex-1 inline-flex h-8 items-center justify-center gap-1.5 rounded-md border text-xs font-semibold transition-colors ${
                                video.allowSharing === false
                                  ? "cursor-not-allowed"
                                  : ""
                              }`}
                              style={{
                                borderColor: "var(--muted-border)",
                                background: video.allowSharing === false ? "var(--muted-bg)" : "var(--muted-bg)",
                                color: video.allowSharing === false ? "var(--muted-text)" : "var(--muted-text-strong)",
                              }}
                              title="Embed"
                            >
                              <Share2 size={12} />
                              Embed
                            </button>
                            {user && (
                              <button
                                onClick={() => startEditing(video)}
                                className="flex-1 inline-flex h-8 items-center justify-center gap-1.5 rounded-md border text-xs font-semibold transition-colors"
                                style={{ borderColor: "var(--muted-border)", background: "var(--muted-bg)", color: "var(--muted-text-strong)" }}
                                title="Edit video"
                              >
                                <Edit3 size={12} />
                                Edit
                              </button>
                            )}
                            {/* More Menu */}
                            <div
                              className="relative"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <button
                                onClick={() => setOpenMenuId(openMenuId === video.id ? null : video.id)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors"
                                style={{ borderColor: "var(--muted-border)", background: "var(--muted-bg)", color: "var(--muted-text)" }}
                                title="More options"
                              >
                                <MoreVertical size={12} />
                              </button>

                              {openMenuId === video.id && (
                                <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-lg border shadow-lg" style={{ borderColor: "var(--panel-border)", background: "var(--panel-bg)" }}>
                                  <button
                                    onClick={() => {
                                      openPrivacyModal(video);
                                      setOpenMenuId(null);
                                    }}
                                    disabled={!user}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-black/5"
                                    style={{
                                      color: !user ? "var(--muted-text)" : "var(--muted-text-strong)",
                                      cursor: !user ? "not-allowed" : "pointer",
                                    }}
                                  >
                                    {video.isPrivate ? <Lock size={14} /> : <Eye size={14} />}
                                    Privacy settings
                                  </button>
                                  {user && (
                                    <>
                                      <button
                                        onClick={() => {
                                          openThumbnailModal(video);
                                          setOpenMenuId(null);
                                        }}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-black/5"
                                        style={{ color: "var(--muted-text-strong)" }}
                                      >
                                        <Image size={14} />
                                        Edit thumbnail
                                      </button>
                                      <button
                                        onClick={() => {
                                          resetVideoLink(video.id);
                                          setOpenMenuId(null);
                                        }}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-black/5"
                                        style={{ color: "var(--muted-text-strong)" }}
                                      >
                                        <RefreshCw size={14} />
                                        Replace video
                                      </button>
                                      <button
                                        onClick={() => {
                                          deleteVideo(video.id);
                                          setOpenMenuId(null);
                                        }}
                                        className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-2 border-t border-white/10"
                                      >
                                        <Trash2 size={14} />
                                        Delete
                                      </button>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

        {user && (
          <div className="mx-auto mt-10 flex max-w-5xl justify-end">
            <button
              onClick={() => setDeleteAccountModalOpen(true)}
              className="text-xs font-medium underline-offset-4 transition-colors hover:underline"
              style={{ color: "var(--muted-text)" }}
              onMouseEnter={(event) => {
                event.currentTarget.style.color = "var(--muted-text-strong)";
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.color = "var(--muted-text)";
              }}
            >
              Delete account
            </button>
          </div>
        )}
        </div>
      </main>

      {/* Footer */}
      <footer className="mx-auto mt-auto grid w-full grid-cols-1 items-center gap-4 border-t border-[var(--panel-border)] bg-[var(--panel-bg)] px-5 py-8 text-center text-xs text-gray-500 sm:px-8 md:grid-cols-3 md:text-left lg:px-12">
        <span>Discord video hosting for editors, creators, clips, previews, and quick video sharing.</span>
        <div className="text-center text-xs text-[#9ca3af]">v{APP_VERSION}</div>
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 font-medium md:justify-end">
          <Link to="/info" className="transition-colors hover:text-[var(--page-fg)]">
            Info
          </Link>
          <Link to="/resources" className="transition-colors hover:text-[var(--page-fg)]">
            Resources
          </Link>
          <Link to="/legal" className="transition-colors hover:text-[var(--page-fg)]">
            Legal
          </Link>
          <Link to="/forms" className="transition-colors hover:text-[var(--page-fg)]">
            Forms
          </Link>
          <a
            href="https://ko-fi.com/cutrr"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-[var(--page-fg)]"
          >
            Donations
          </a>
          <a
            href="https://discord.gg/JAbzJX4Jce"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-[var(--page-fg)]"
          >
            Discord
          </a>
        </div>
      </footer>

      {popoutVideoId && (
        <div
          className="fixed inset-0 z-[1400] flex items-center justify-center overflow-y-auto bg-black/85 px-4 py-6 backdrop-blur-[1px] sm:px-8"
          onClick={closePopout}
        >
          <button
            type="button"
            onClick={closePopout}
            className="fixed right-4 top-4 grid h-10 w-10 place-items-center text-white/80 transition-colors hover:text-white"
            aria-label="Close video"
          >
            <X size={24} />
          </button>

          <div className="relative w-full max-w-6xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-2">
              <h2 className="text-lg font-semibold text-white">
                {popoutVideoData?.originalName || "Video"}
              </h2>
              <p className="mt-1 text-xs text-white/55">
                {formatPopoutDate(popoutVideoData)}
              </p>
            </div>

            <div className="aspect-video w-full max-h-[calc(100dvh-6rem)] bg-black shadow-2xl shadow-black/50">
              {popoutLoading && !popoutVideoData ? (
                <div className="grid h-full place-items-center text-sm text-white/60">
                  Loading...
                </div>
              ) : popoutError ? (
                <div className="grid h-full place-items-center text-sm text-red-300">
                  {popoutError}
                </div>
              ) : popoutProcessing ? (
                <div className="grid h-full place-items-center px-4 text-center text-sm text-white/60">
                  <div>
                    <p className="font-semibold text-white/70">Checking Bunny processing</p>
                    <p className="mt-1 max-w-sm truncate text-xs text-white/40">
                      Waiting for the finished HLS stream before playback starts.
                    </p>
                  </div>
                </div>
              ) : (
                popoutVideoData?.playerUrl ? (
                  <BunnyPlayer
                    key={popoutVideoId}
                    src={popoutVideoData.playerUrl}
                    poster={popoutVideoData ? getThumbUrl(popoutVideoId, popoutVideoData) : ""}
                    autoPlay
                    volume={getPlayerVolume(popoutVideoData)}
                    title={popoutVideoData?.originalName || "CUTRR video"}
                    className="h-full w-full bg-black"
                  />
                ) : (
                  <VideoPlayer
                    key={popoutVideoId}
                    src={getSafePlaybackUrl(popoutVideoData)}
                    fallbackSrc={getOriginalPlaybackUrl(popoutVideoData, getVideoAccessQuery(popoutVideoData))}
                    poster={popoutVideoData ? getThumbUrl(popoutVideoId, popoutVideoData) : ""}
                    autoPlay
                    volume={getPlayerVolume(popoutVideoData)}
                    onError={() => setPopoutError("Video is still becoming available. Try again in a moment.")}
                    className="h-full w-full bg-black object-contain"
                  />
                )
              )}
            </div>
          </div>
        </div>
      )}

      <Modal
        isOpen={Boolean(embedModalVideo)}
        onClose={() => setEmbedModalVideo(null)}
        title="Embed video"
        size="md"
      >
        <div className="space-y-4">
          <textarea
            readOnly
            value={buildEmbedCode(embedModalVideo)}
            className="theme-input h-28 w-full resize-none rounded-md p-3 text-xs"
          />
          <div className="flex items-center gap-4 text-sm text-[var(--muted-text-strong)]">
            <EmbedRadio
              checked={embedConfig.responsive}
              onChange={() => setEmbedConfig((current) => ({ ...current, responsive: true }))}
              label="Responsive"
            />
            <EmbedRadio
              checked={!embedConfig.responsive}
              onChange={() => setEmbedConfig((current) => ({ ...current, responsive: false }))}
              label="Fixed"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm text-[var(--muted-text-strong)]">
            <EmbedCheckbox
              checked={embedConfig.loop}
              onChange={(value) => setEmbedConfig((current) => ({ ...current, loop: value }))}
              label="Loop"
            />
            <EmbedCheckbox
              checked={embedConfig.autoplay}
              onChange={(value) => setEmbedConfig((current) => ({ ...current, autoplay: value }))}
              label="Autoplay"
            />
            <EmbedCheckbox
              checked={embedConfig.muted}
              onChange={(value) => setEmbedConfig((current) => ({ ...current, muted: value }))}
              label="Mute audio"
            />
            <EmbedCheckbox
              checked={embedConfig.controls}
              onChange={(value) => setEmbedConfig((current) => ({ ...current, controls: value }))}
              label="Show controls"
            />
          </div>
          <div className="flex justify-end">
            <button
              onClick={copyEmbedCode}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
            >
              Copy
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(privacyModalVideo)}
        onClose={() => {
          if (!privacySaving) setPrivacyModalVideo(null);
        }}
        title="Privacy Settings"
        size="lg"
      >
        <div className="space-y-7">
          <div className="rounded border border-yellow-300/40 bg-yellow-300/10 px-5 py-4 text-base text-[var(--muted-text-strong)]">
            This video uses <button className="text-blue-500 underline">default privacy settings</button>
          </div>

          <section>
            <h3 className="mb-4 text-base font-semibold text-[var(--page-fg)]">Visibility</h3>
            <div>
              <VisibilityOption
                value="public"
                title="Public"
                description="Anyone with a link can view."
              />
              <VisibilityOption
                value="hidden"
                title="Hide on CUTRR"
                description="Private on your account, but embeddable anywhere."
              />
              <VisibilityOption
                value="private"
                title="Private"
                description="Only people with the private link will be able to view."
              />
            </div>
          </section>

          <section>
            <h3 className="mb-4 text-base font-semibold text-[var(--page-fg)]">Restrictions</h3>
            <PrivacyToggle
              label="Domain Privacy"
              description="Only embeddable on domains you specify."
              checked={privacyConfig.domainPrivacy}
              onChange={(value) =>
                setPrivacyConfig((current) => ({ ...current, domainPrivacy: value }))
              }
            />
            {privacyConfig.domainPrivacy && (
              <input
                type="text"
                value={privacyConfig.allowedDomains}
                onChange={(event) =>
                  setPrivacyConfig((current) => ({
                    ...current,
                    allowedDomains: event.target.value,
                  }))
                }
                placeholder="example.com, clips.example.com"
                className="theme-input mb-2 mt-3 h-10 w-full rounded-md px-3 text-sm"
              />
            )}
            <PrivacyToggle
              label="Password protection"
              description="Only people with the password can view."
              checked={privacyConfig.passwordProtection}
              onChange={(value) =>
                setPrivacyConfig((current) => ({ ...current, passwordProtection: value }))
              }
            />
            {privacyConfig.passwordProtection && (
              <input
                type="password"
                value={privacyConfig.password}
                onChange={(event) =>
                  setPrivacyConfig((current) => ({
                    ...current,
                    password: event.target.value,
                  }))
                }
                placeholder="Set or update video password"
                className="theme-input mt-3 h-10 w-full rounded-md px-3 text-sm"
              />
            )}
          </section>

          <section>
            <h3 className="mb-4 text-base font-semibold text-[var(--page-fg)]">Player preferences</h3>
            <PrivacyToggle
              label="Allow downloading"
              description="Add download options to your video page and player."
              checked={privacyConfig.allowDownloading}
              onChange={(value) =>
                setPrivacyConfig((current) => ({ ...current, allowDownloading: value }))
              }
            />
            <PrivacyToggle
              label="Allow sharing"
              description="Add share options to your video page and player."
              checked={privacyConfig.allowSharing}
              onChange={(value) =>
                setPrivacyConfig((current) => ({ ...current, allowSharing: value }))
              }
            />
            <PrivacyToggle
              label="Allow timed comments"
              description="Let signed-in viewers leave comments at specific timestamps."
              checked={privacyConfig.allowTimeComments}
              onChange={(value) =>
                setPrivacyConfig((current) => ({ ...current, allowTimeComments: value }))
              }
            />
          </section>

          <div className="flex justify-end gap-2">
            <button
              onClick={() => setPrivacyModalVideo(null)}
              disabled={privacySaving}
              className="theme-secondary-button rounded-lg px-4 py-2 text-sm transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={savePrivacySettings}
              disabled={privacySaving}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
            >
              {privacySaving && <Loader2 size={14} className="animate-spin" />}
              Save
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(thumbnailModalVideo)}
        onClose={() => setThumbnailModalVideo(null)}
        title="Edit Thumbnail"
        size="md"
      >
        <div className="space-y-3">
          {thumbLoading ? (
            <p className="text-sm text-[var(--muted-text)]">Loading thumbnails...</p>
          ) : thumbnails.length === 0 ? (
            <p className="text-sm text-[var(--muted-text)]">No thumbnails available yet.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {thumbnails.map((thumb) => {
                const pendingThumb = thumbnailModalVideoId
                  ? pendingThumbnails[thumbnailModalVideoId]
                  : null;
                const isPending = pendingThumb === thumb.id;
                return (
                  <button
                    key={thumb.id}
                    onClick={() =>
                      thumbnailModalVideoId &&
                      selectThumbnail(thumbnailModalVideoId, thumb.id)
                    }
                    disabled={!thumbnailModalVideoId || Boolean(pendingThumb)}
                    className={`relative overflow-hidden rounded border transition-colors ${
                      isPending
                        ? "border-blue-400 opacity-90"
                        : pendingThumb
                          ? "border-[var(--muted-border)] opacity-60"
                          : "border-[var(--muted-border)] hover:border-blue-400"
                    }`}
                  >
                    {isPending && (
                      <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/55">
                        <Loader2 size={14} className="animate-spin text-white" />
                      </div>
                    )}
                    <img
                      src={thumb.url}
                      alt={`Thumbnail ${formatTime(thumb.id)}`}
                      className="aspect-video w-full object-cover"
                    />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(editModalVideo)}
        onClose={() => {
          setEditModalVideo(null);
          setEditingId(null);
        }}
        title="Edit Video"
        size="md"
      >
        <div className="space-y-3">
          {editModalVideo && (
            <img
              src={getThumbUrl(editModalVideo.id, editModalVideo)}
              alt=""
              className="aspect-video w-full rounded-lg border border-[var(--panel-border)] object-cover"
            />
          )}
          <div>
            <label className="mb-1 block text-xs font-semibold text-[var(--muted-text-strong)]">Video Title</label>
            <input
              type="text"
              value={editForm.originalName}
              onChange={(event) =>
                setEditForm((current) => ({ ...current, originalName: event.target.value }))
              }
              className="theme-input h-9 w-full rounded-md px-3 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-[var(--muted-text-strong)]">Description</label>
            <textarea
              value={editForm.description}
              onChange={(event) =>
                setEditForm((current) => ({ ...current, description: event.target.value }))
              }
              className="theme-input h-20 w-full resize-none rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-semibold text-[var(--muted-text-strong)]">Volume</label>
              <span className="text-xs text-[var(--muted-text)]">{editForm.volume}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={editForm.volume}
              onChange={(event) =>
                setEditForm((current) => ({
                  ...current,
                  volume: Number(event.target.value),
                }))
              }
              className="w-full accent-blue-600"
            />
          </div>
          <button
            type="button"
            onClick={() =>
              setEditForm((current) => ({
                ...current,
                autoplay: !current.autoplay,
              }))
            }
            className="flex w-full items-center justify-between rounded-md border border-[var(--muted-border)] bg-[var(--muted-bg)] px-3 py-3 text-left"
          >
            <span>
              <span className="block text-sm font-semibold text-[var(--page-fg)]">Autoplay</span>
              <span className="block text-xs text-[var(--muted-text)]">Start playback automatically when possible.</span>
            </span>
            <span
              className={`relative h-7 w-14 shrink-0 rounded-full border transition-colors ${
                editForm.autoplay ? "border-blue-500 bg-blue-600" : "border-[var(--muted-border)] bg-[var(--muted-bg)]"
              }`}
            >
              <span
                className="absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform"
                style={{ transform: editForm.autoplay ? "translateX(28px)" : "translateX(0)" }}
              />
            </span>
          </button>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setEditModalVideo(null);
                setEditingId(null);
              }}
              className="theme-secondary-button rounded-lg px-4 py-2 text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => editModalVideo && saveSettings(editModalVideo.id)}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
            >
              Save
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={deleteModal.isOpen}
        onClose={() => setDeleteModal({ isOpen: false, videoId: null })}
        title="Delete Video"
        size="sm"
      >
        <p className="mb-4 text-sm text-[var(--muted-text-strong)]">
          Are you sure you want to delete this video? This action cannot be
          undone.
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            onClick={() => setDeleteModal({ isOpen: false, videoId: null })}
            className="theme-secondary-button rounded-lg px-4 py-2 text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={confirmDelete}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white transition-colors hover:bg-red-700"
          >
            Delete
          </button>
        </div>
      </Modal>

      <Modal
        isOpen={bulkDeleteModalOpen}
        onClose={() => {
          if (!bulkDeleting) setBulkDeleteModalOpen(false);
        }}
        title="Delete Selected Videos"
        size="sm"
      >
        <p className="mb-4 text-sm text-[var(--muted-text-strong)]">
          Delete {selectedVideoIds.length} selected video{selectedVideoIds.length === 1 ? "" : "s"}? This action cannot be undone.
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            onClick={() => setBulkDeleteModalOpen(false)}
            disabled={bulkDeleting}
            className="theme-secondary-button rounded-lg px-4 py-2 text-sm transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={confirmBulkDelete}
            disabled={bulkDeleting}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm text-white transition-colors hover:bg-red-700 disabled:opacity-60"
          >
            {bulkDeleting && <Loader2 size={14} className="animate-spin" />}
            Delete selected
          </button>
        </div>
      </Modal>

      <Modal
        isOpen={deleteAccountModalOpen}
        onClose={() => {
          if (!deleteAccountLoading) setDeleteAccountModalOpen(false);
        }}
        title="Delete Account"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm leading-6 text-[var(--muted-text-strong)]">
            Warning: deleting your account permanently removes all of your
            videos, forms, and account information. We do not save a backup.
          </p>
          <p className="text-sm leading-6 text-[var(--muted-text)]">
            If you make a new account with the same email later, your old
            videos and any extra video allowance you bought will not come back.
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              onClick={() => setDeleteAccountModalOpen(false)}
              disabled={deleteAccountLoading}
              className="theme-secondary-button rounded-lg px-4 py-2 text-sm transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={confirmDeleteAccount}
              disabled={deleteAccountLoading}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm text-white transition-colors hover:bg-red-700 disabled:opacity-60"
            >
              {deleteAccountLoading && <Loader2 size={14} className="animate-spin" />}
              Delete forever
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={resetModal.isOpen}
        onClose={() => setResetModal({ isOpen: false, videoId: null })}
        title="Reset Share Link"
        size="sm"
      >
        <p className="mb-4 text-sm text-[var(--muted-text-strong)]">
          This creates a new share link. The old link will stop working
          immediately.
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            onClick={() => setResetModal({ isOpen: false, videoId: null })}
            className="theme-secondary-button rounded-lg px-4 py-2 text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={confirmResetLink}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700"
          >
            Reset Link
          </button>
        </div>
      </Modal>

    </div>
  );
}
