import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Filter,
  Loader2,
  Play,
  Search,
  Users,
  UserPlus,
  UserMinus,
  Shield,
  Square,
  CheckSquare,
  Trash2,
  User,
  Video,
  Flag,
  ExternalLink,
} from "lucide-react";
import Modal from "../components/Modal";
import { useToast } from "../contexts/ToastContext";
import MainNav from "../components/MainNav";
import { API_URL } from "../utils/api";

const emptyOverview = {
  stats: {
    totalUsers: 0,
    activeVideos: 0,
    totalForms: 0,
    pendingSubmissions: 0,
  },
  recentUsers: [],
  forms: [],
};

const emptyResourceForm = {
  title: "",
  url: "",
  category: "",
  description: "",
  sortOrder: 0,
  isPublished: true,
};

const normalizeWebsiteUrl = (value) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

const isValidWebsiteUrl = (value) => {
  const normalized = normalizeWebsiteUrl(value);
  if (!normalized || /\s/.test(normalized)) return false;
  return /^https?:\/\/[^/?#]+\.[^/?#]+([/?#].*)?$/i.test(normalized);
};

export default function AdminPanel({ user, logout }) {
  const { showToast } = useToast();
  const token = localStorage.getItem("token");
  const [overview, setOverview] = useState(emptyOverview);
  const [videos, setVideos] = useState([]);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingVideos, setLoadingVideos] = useState(true);
  const [search, setSearch] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [deleteModal, setDeleteModal] = useState({
    isOpen: false,
    video: null,
  });
  const [deletingId, setDeletingId] = useState(null);
  const [playingId, setPlayingId] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    type: "all",
    minSize: "",
    maxSize: "",
    sortBy: "newest",
  });
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState("videos"); // videos, users, reports, resources
  const [users, setUsers] = useState([]);
  const [userSearch, setUserSearch] = useState("");
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [actingOnUser, setActingOnUser] = useState(null);
  const [allowanceDrafts, setAllowanceDrafts] = useState({});
  const [reports, setReports] = useState([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [actingOnReport, setActingOnReport] = useState(null);
  const [resources, setResources] = useState([]);
  const [loadingResources, setLoadingResources] = useState(false);
  const [resourceForm, setResourceForm] = useState(emptyResourceForm);
  const [editingResourceId, setEditingResourceId] = useState(null);
  const [savingResource, setSavingResource] = useState(false);
  const [actingOnResource, setActingOnResource] = useState(null);

  useEffect(() => {
    if (!user?.isAdmin || !token) return;
    loadOverview();
  }, [user, token]);

  useEffect(() => {
    if (!user?.isAdmin || !token) return;
    if (activeTab === "videos") loadVideos(activeQuery, filters);
    else if (activeTab === "users") loadUsers(userSearch);
    else if (activeTab === "reports") loadReports();
    else if (activeTab === "resources") loadResources();
  }, [user, token, activeQuery, filters, activeTab, userSearch]);

  const loadOverview = async () => {
    setLoadingOverview(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/overview`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load overview");
      setOverview(data);
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setLoadingOverview(false);
    }
  };

  const loadVideos = async (query = "", filterOptions = {}) => {
    setLoadingVideos(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("search", query.trim());
      if (filterOptions.type && filterOptions.type !== "all")
        params.set("type", filterOptions.type);
      if (filterOptions.minSize) params.set("minSize", filterOptions.minSize);
      if (filterOptions.maxSize) params.set("maxSize", filterOptions.maxSize);
      if (filterOptions.sortBy && filterOptions.sortBy !== "newest")
        params.set("sortBy", filterOptions.sortBy);

      const suffix = params.toString();
      const res = await fetch(
        `${API_URL}/api/admin/videos${suffix ? `?${suffix}` : ""}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load videos");
      setVideos(Array.isArray(data) ? data : []);
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setLoadingVideos(false);
    }
  };

  const loadUsers = async (query = "") => {
    setLoadingUsers(true);
    try {
      const res = await fetch(
        `${API_URL}/api/admin/users${query ? `?search=${encodeURIComponent(query)}` : ""}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load users");
      setUsers(Array.isArray(data) ? data : []);
      setAllowanceDrafts({});
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setLoadingUsers(false);
    }
  };

  const loadReports = async () => {
    setLoadingReports(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/reports`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load reports");
      setReports(Array.isArray(data) ? data : []);
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setLoadingReports(false);
    }
  };

  const loadResources = async () => {
    setLoadingResources(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/resources`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load resources");
      setResources(Array.isArray(data) ? data : []);
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setLoadingResources(false);
    }
  };

  const resetResourceForm = () => {
    setResourceForm(emptyResourceForm);
    setEditingResourceId(null);
  };

  const editResource = (resource) => {
    setEditingResourceId(resource.id);
    setResourceForm({
      title: resource.title || "",
      url: resource.url || "",
      category: resource.category || "",
      description: resource.description || "",
      sortOrder: resource.sortOrder || 0,
      isPublished: resource.isPublished !== false,
    });
  };

  const saveResource = async (event) => {
    event.preventDefault();
    if (!resourceForm.title.trim()) {
      showToast("Title is required", "error");
      return;
    }
    if (!resourceForm.category.trim()) {
      showToast("Category is required", "error");
      return;
    }
    const normalizedUrl = normalizeWebsiteUrl(resourceForm.url);
    if (!isValidWebsiteUrl(normalizedUrl)) {
      showToast("Enter a valid website URL, like https://example.com", "error");
      return;
    }

    setSavingResource(true);
    try {
      const endpoint = editingResourceId
        ? `${API_URL}/api/admin/resources/${editingResourceId}`
        : `${API_URL}/api/admin/resources`;
      const res = await fetch(endpoint, {
        method: editingResourceId ? "PATCH" : "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...resourceForm, url: normalizedUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save resource");

      setResources((current) => {
        const next = editingResourceId
          ? current.map((resource) => (resource.id === data.id ? data : resource))
          : [...current, data];
        return next.sort((a, b) =>
          a.category.localeCompare(b.category) ||
          (a.sortOrder || 0) - (b.sortOrder || 0) ||
          a.title.localeCompare(b.title)
        );
      });
      resetResourceForm();
      showToast(editingResourceId ? "Resource updated" : "Resource created", "success");
    } catch (e) {
      const message = String(e.message || "");
      showToast(
        message.toLowerCase().includes("expected pattern")
          ? "Enter a valid website URL, like https://example.com"
          : message,
        "error",
      );
    } finally {
      setSavingResource(false);
    }
  };

  const deleteResource = async (resource) => {
    if (!confirm(`Delete ${resource.title}?`)) return;
    setActingOnResource(resource.id);
    try {
      const res = await fetch(`${API_URL}/api/admin/resources/${resource.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to delete resource");
      setResources((current) => current.filter((item) => item.id !== resource.id));
      if (editingResourceId === resource.id) resetResourceForm();
      showToast("Resource deleted", "success");
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setActingOnResource(null);
    }
  };

  const deleteReport = async (id) => {
    setActingOnReport(id);
    try {
      const res = await fetch(`${API_URL}/api/admin/reports/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete report");
      }
      setReports((current) => current.filter((r) => r.id !== id));
      showToast("Report cleared", "success");
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setActingOnReport(null);
    }
  };

  const toggleAdmin = async (targetUser) => {
    if (targetUser.id === user.id) return;
    setActingOnUser(targetUser.id);
    try {
      const res = await fetch(`${API_URL}/api/admin/users/${targetUser.id}/toggle-admin`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update role");
      
      setUsers(current => current.map(u => 
        u.id === targetUser.id ? { ...u, isAdmin: data.isAdmin } : u
      ));
      showToast(`Updated ${targetUser.email}`, "success");
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setActingOnUser(null);
    }
  };

  const getAllowanceDraft = (targetUser) => {
    const draft = allowanceDrafts[targetUser.id] || {};
    return {
      activeVideoLimit:
        draft.activeVideoLimit ?? targetUser.activeVideoLimit ?? 5,
      activeVideoUnlimited:
        draft.activeVideoUnlimited ?? targetUser.activeVideoUnlimited ?? false,
    };
  };

  const setAllowanceDraft = (targetUser, patch) => {
    setAllowanceDrafts((current) => ({
      ...current,
      [targetUser.id]: {
        ...getAllowanceDraft(targetUser),
        ...patch,
      },
    }));
  };

  const saveUploadAllowance = async (targetUser) => {
    const draft = getAllowanceDraft(targetUser);
    const activeVideoLimit = Number.parseInt(draft.activeVideoLimit, 10);
    if (!Number.isFinite(activeVideoLimit) || activeVideoLimit < 1) {
      showToast("Active video limit must be at least 1", "error");
      return;
    }

    setActingOnUser(targetUser.id);
    try {
      const res = await fetch(
        `${API_URL}/api/admin/users/${targetUser.id}/upload-allowance`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            activeVideoLimit,
            activeVideoUnlimited: draft.activeVideoUnlimited === true,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error || "Failed to update upload allowance");

      setUsers((current) =>
        current.map((u) =>
          u.id === targetUser.id
            ? {
                ...u,
                activeVideoLimit: data.activeVideoLimit,
                activeVideoUnlimited: data.activeVideoUnlimited,
              }
            : u,
        ),
      );
      setAllowanceDrafts((current) => {
        const next = { ...current };
        delete next[targetUser.id];
        return next;
      });
      showToast(`Updated upload allowance for ${targetUser.email}`, "success");
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setActingOnUser(null);
    }
  };

  const deleteUser = async (targetUser) => {
    if (targetUser.id === user.id) return;
    if (!confirm(`Are you sure you want to delete ${targetUser.email}? This will also delete all their videos.`)) return;
    
    setActingOnUser(targetUser.id);
    try {
      const res = await fetch(`${API_URL}/api/admin/users/${targetUser.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete user");
      
      setUsers(current => current.filter(u => u.id !== targetUser.id));
      showToast(`User deleted`, "success");
      loadOverview();
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setActingOnUser(null);
    }
  };

  const submitSearch = (e) => {
    e.preventDefault();
    setActiveQuery(search);
  };

  const confirmDelete = async () => {
    if (!deleteModal.video || !token) return;
    setDeletingId(deleteModal.video.id);
    try {
      const res = await fetch(`${API_URL}/api/admin/video/${deleteModal.video.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete video");
      setVideos((current) =>
        current.filter((video) => video.id !== deleteModal.video.id),
      );
      setDeleteModal({ isOpen: false, video: null });
      showToast("Video deleted", "success");
      loadOverview();
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setDeletingId(null);
    }
  };

  const stats = useMemo(
    () => [
      { label: "Users", value: overview.stats.totalUsers, tone: "text-white" },
      {
        label: "Active Videos",
        value: overview.stats.activeVideos,
        tone: "text-white",
      },
      { label: "Forms", value: overview.stats.totalForms, tone: "text-white" },
      {
        label: "Pending Reviews",
        value: overview.stats.pendingSubmissions,
        tone:
          overview.stats.pendingSubmissions > 0 ? "text-amber-300" : "text-white",
      },
    ],
    [overview],
  );

  const formatDate = (value) =>
    new Date(value).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

  const formatBytes = (bytes) => {
    if (!bytes) return "Unknown";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(
      Math.floor(Math.log(bytes) / Math.log(1024)),
      units.length - 1,
    );
    return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
  };

  const ageLabel = (createdAt) => {
    const diff = Date.now() - new Date(createdAt).getTime();
    const hours = Math.max(1, Math.floor(diff / (1000 * 60 * 60)));
    if (hours < 24) return `${hours}h old`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d old`;
    const months = Math.floor(days / 30);
    return `${months}mo old`;
  };

  const toggleSelect = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === videos.length && videos.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(videos.map((v) => v.id)));
    }
  };

  const bulkDelete = async () => {
    if (selectedIds.size === 0 || !token) return;
    if (
      !confirm(`Are you sure you want to delete ${selectedIds.size} videos?`)
    ) {
      return;
    }

    setIsBulkDeleting(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/videos/bulk-delete`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Bulk delete failed");

      showToast(`Deleted ${data.deletedCount} videos`, "success");
      setVideos((current) =>
        current.filter((v) => !selectedIds.has(v.id)),
      );
      setSelectedIds(new Set());
      loadOverview();
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setIsBulkDeleting(false);
    }
  };

  if (!user?.isAdmin) {
    return (
      <div className="obsidian-ui min-h-screen text-white">
        <main className="max-w-xl mx-auto px-6 py-12 text-center">
          <Shield size={24} className="mx-auto mb-3 text-white/30" />
          <h1 className="text-xl font-bold mb-2">Admin panel</h1>
          <p className="text-sm text-white/50">
            You need an admin account to open this area.
          </p>
          <Link
            to="/admin-login"
            className="inline-flex items-center justify-center h-9 px-4 mt-4 rounded-full bg-white text-black text-sm font-medium"
          >
            Admin Login
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="obsidian-ui min-h-screen text-white selection:bg-white/15">
      <MainNav user={user} logout={logout} />

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-5 sm:px-6 sm:py-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Shield size={16} className="text-red-300" />
              <p className="text-[10px] uppercase tracking-[0.22em] text-red-300/80">
                Admin Control
              </p>
            </div>
            <h1 className="text-xl font-bold tracking-tight">Moderation Panel</h1>
          </div>

          <div className="grid w-full grid-cols-2 gap-1 rounded-xl border border-white/5 bg-white/5 p-1 sm:w-auto sm:flex sm:flex-wrap sm:items-center sm:justify-end">
            <button
              onClick={() => setActiveTab("videos")}
              className={`flex h-11 items-center justify-center gap-2 rounded-lg px-3 text-xs font-bold transition-all sm:px-5 ${
                activeTab === "videos" 
                  ? "bg-white text-black shadow-lg" 
                  : "text-white/50 hover:text-white"
              }`}
            >
              <Video size={14} />
              Videos
            </button>
            <button
              onClick={() => setActiveTab("users")}
              className={`flex h-11 items-center justify-center gap-2 rounded-lg px-3 text-xs font-bold transition-all sm:px-5 ${
                activeTab === "users" 
                  ? "bg-white text-black shadow-lg" 
                  : "text-white/50 hover:text-white"
              }`}
            >
              <Users size={14} />
              Users
            </button>
            <button
              onClick={() => setActiveTab("reports")}
              className={`flex h-11 items-center justify-center gap-2 rounded-lg px-3 text-xs font-bold transition-all sm:px-5 ${
                activeTab === "reports" 
                  ? "bg-white text-black shadow-lg" 
                  : "text-white/50 hover:text-white"
              }`}
            >
              <Flag size={14} />
              Reports
            </button>
            <button
              onClick={() => setActiveTab("resources")}
              className={`flex h-11 items-center justify-center gap-2 rounded-lg px-3 text-xs font-bold transition-all sm:px-5 ${
                activeTab === "resources"
                  ? "bg-white text-black shadow-lg"
                  : "text-white/50 hover:text-white"
              }`}
            >
              <ExternalLink size={14} />
              Resources
            </button>
          </div>
        </div>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="glass rounded-[22px] p-4">
              <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">
                {stat.label}
              </p>
              {loadingOverview ? (
                <div className="mt-2 flex items-center gap-2 text-white/30">
                  <Loader2 size={14} className="animate-spin" />
                  <span className="text-sm">Loading</span>
                </div>
              ) : (
                <p className={`mt-2 text-3xl font-bold tracking-tight ${stat.tone}`}>
                  {stat.value}
                </p>
              )}
            </div>
          ))}
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="glass rounded-[22px] p-4 flex flex-col">
            {activeTab === "videos" && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                  <form onSubmit={submitSearch} className="flex-1 min-w-0">
                    <div className="relative">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search video ID, uploader, title..."
                        className="h-11 w-full rounded-xl border border-white/10 bg-black/40 pl-9 pr-3 text-base text-white focus:outline-none focus:border-white/30 sm:text-sm"
                      />
                    </div>
                  </form>
                  <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                    <button
                      onClick={() => setShowFilters(!showFilters)}
                      className={`inline-flex h-11 flex-1 items-center justify-center rounded-xl px-4 text-xs transition-colors sm:flex-none ${
                        showFilters || filters.type !== "all" || filters.sortBy !== "newest"
                          ? "bg-white text-black font-semibold"
                          : "bg-white/5 text-white/70 hover:bg-white/10"
                      }`}
                    >
                      <Filter size={12} className="mr-1.5" />
                      Filters
                    </button>
                    <button
                      onClick={() => loadVideos(activeQuery, filters)}
                      className="inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-white/5 px-4 text-xs text-white/70 hover:bg-white/10 transition-colors sm:flex-none"
                    >
                      Refresh
                    </button>
                  </div>
                </div>

                {showFilters && (
                  <div className="mb-6 grid gap-4 p-4 rounded-2xl bg-white/[0.03] border border-white/10 sm:grid-cols-2 animate-in fade-in slide-in-from-top-2">
                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase tracking-wider text-white/40">Uploader Type</label>
                      <select
                        value={filters.type}
                        onChange={(e) => setFilters({ ...filters, type: e.target.value })}
                        className="h-11 w-full rounded-lg border border-white/10 bg-black/40 px-2 text-base text-white focus:outline-none sm:text-xs"
                      >
                        <option value="all">All Uploaders</option>
                        <option value="registered">Registered</option>
                        <option value="anonymous">Anonymous</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase tracking-wider text-white/40">Sort By</label>
                      <select
                        value={filters.sortBy}
                        onChange={(e) => setFilters({ ...filters, sortBy: e.target.value })}
                        className="h-11 w-full rounded-lg border border-white/10 bg-black/40 px-2 text-base text-white focus:outline-none sm:text-xs"
                      >
                        <option value="newest">Newest First</option>
                        <option value="oldest">Oldest First</option>
                        <option value="largest">Largest First</option>
                        <option value="smallest">Smallest First</option>
                      </select>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3 mb-4 px-1">
                  <button
                    onClick={toggleSelectAll}
                    className="touch-button inline-flex items-center gap-2 text-xs text-white/50 hover:text-white transition-colors"
                  >
                    {selectedIds.size === videos.length && videos.length > 0 ? (
                      <CheckSquare size={14} className="text-white" />
                    ) : (
                      <Square size={14} />
                    )}
                    {selectedIds.size === videos.length && videos.length > 0 ? "Deselect All" : "Select All"}
                  </button>
                </div>

                <div className="space-y-3">
                  {loadingVideos ? (
                    <div className="flex items-center gap-2 py-8 text-sm text-white/35">
                      <Loader2 size={16} className="animate-spin" />
                      Loading videos...
                    </div>
                  ) : videos.length === 0 ? (
                    <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-8 text-center text-sm text-white/45">
                      No videos found.
                    </div>
                  ) : (
                    videos.map((video) => (
                      <div
                        key={video.id}
                        className={`rounded-[22px] border transition-all ${
                          selectedIds.has(video.id)
                            ? "border-white/40 bg-white/[0.08]"
                            : "border-white/10 bg-white/[0.02] hover:border-white/20"
                        } p-4 group/item`}
                      >
                        <div className="flex flex-col md:flex-row gap-5">
                          <div className="w-full md:w-48 aspect-video bg-black rounded-xl overflow-hidden shrink-0 border border-white/10 relative group">
                            {playingId === video.id ? (
                              <iframe
                                src={`${API_URL}/embed/${video.id}?autoplay=true&volume=15`}
                                className="w-full h-full border-0"
                                allow="autoplay; fullscreen"
                              />
                            ) : (
                              <button
                                onClick={() => setPlayingId(video.id)}
                                className="relative h-full w-full"
                              >
                                <img
                                  src={`${API_URL}/thumb/${video.id}`}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                                <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <Play size={24} className="text-white" fill="currentColor" />
                                </div>
                              </button>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleSelect(video.id);
                              }}
                              className={`absolute left-2 top-2 z-10 flex h-11 w-11 items-center justify-center rounded-full border shadow-lg transition-all sm:h-8 sm:w-8 ${
                                selectedIds.has(video.id)
                                  ? "bg-white border-white text-black"
                                  : "bg-black/60 border-white/20 text-white/40 opacity-0 group-hover:opacity-100"
                              }`}
                            >
                              {selectedIds.has(video.id) ? (
                                <CheckSquare size={12} strokeWidth={3} />
                              ) : (
                                <div className="w-2 h-2 rounded-full border border-current" />
                              )}
                            </button>
                          </div>

                          <div className="flex-1 min-w-0 flex flex-col justify-between">
                            <div>
                              <div className="flex flex-wrap items-center gap-2 mb-2">
                                <p className="text-sm font-semibold truncate">{video.originalName || "Untitled"}</p>
                                <span className="text-[10px] text-white/30 uppercase tracking-widest">{video.id}</span>
                              </div>
                              <div className="grid gap-x-4 gap-y-1 text-[11px] text-white/40 sm:grid-cols-2">
                                <p className="truncate">Uploader: {video.owner?.email || "Anonymous"}</p>
                                <p>Size: {formatBytes(video.size)}</p>
                                <p>Uploaded: {ageLabel(video.createdAt)}</p>
                                <p>Expires: {formatDate(video.expiresAt)}</p>
                              </div>
                            </div>
                            <div className="mt-4 flex flex-wrap items-center gap-2">
                              <Link
                                to={`/${video.id}`}
                                target="_blank"
                                className="touch-link inline-flex rounded-lg border border-white/10 px-3 text-xs text-white/60 hover:text-white transition-colors"
                              >
                                View Page
                              </Link>
                              <button
                                onClick={() => setDeleteModal({ isOpen: true, video })}
                                className="touch-button inline-flex gap-1 rounded-lg bg-red-500/10 px-3 text-xs font-bold text-red-400 hover:bg-red-500 hover:text-white transition-all"
                              >
                                <Trash2 size={12} />
                                Delete
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}

            {activeTab === "users" && (
              <div className="flex flex-col flex-1">
                <div className="relative mb-6">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                  <input
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Search users by email..."
                    className="w-full h-11 rounded-xl border border-white/10 bg-black/40 pl-10 pr-4 text-sm text-white focus:outline-none focus:border-white/30 transition-all"
                  />
                </div>

                <div className="space-y-3">
                  {loadingUsers ? (
                    <div className="py-8 text-center text-white/35">
                      <Loader2 size={24} className="animate-spin mx-auto mb-2" />
                      <p className="text-sm">Loading users...</p>
                    </div>
                  ) : users.length === 0 ? (
                    <div className="p-8 text-center text-white/35 border border-dashed border-white/5 rounded-2xl text-sm">
                      No users found.
                    </div>
                  ) : (
                    users.map((u) => {
                      const allowance = getAllowanceDraft(u);
                      return (
                        <div
                        key={u.id}
                        className="group/user flex flex-col gap-4 rounded-2xl border border-white/8 bg-white/[0.02] p-4 transition-all hover:bg-white/[0.04] sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex items-center gap-4 min-w-0">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center border ${
                            u.isAdmin ? "bg-white text-black border-white" : "bg-white/5 border-white/10 text-white/30"
                          }`}>
                            {u.isAdmin ? <Shield size={18} /> : <User size={18} />}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold truncate">{u.email}</p>
                            <p className="text-[10px] text-white/30 mt-0.5">{u.id}</p>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-4 sm:justify-end">
                          <div className="hidden sm:flex flex-col items-end mr-2">
                            <span className="text-xs font-bold text-white/70">{u.activeVideoCount || 0} Active</span>
                            <span className="text-[10px] text-white/30">
                              {u.activeVideoUnlimited ? "Unlimited" : `${u.activeVideoLimit || 5} max`} - {u.videoCount} total
                            </span>
                            <span className="text-[10px] text-white/30">{formatBytes(u.totalStorage)}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <label className="flex h-11 items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 text-[11px] text-white/60">
                              <input
                                type="checkbox"
                                checked={allowance.activeVideoUnlimited === true}
                                onChange={(e) =>
                                  setAllowanceDraft(u, {
                                    activeVideoUnlimited: e.target.checked,
                                  })
                                }
                                className="h-4 w-4 accent-white"
                              />
                              Unlimited
                            </label>
                            <input
                              type="number"
                              min="1"
                              value={allowance.activeVideoLimit}
                              disabled={allowance.activeVideoUnlimited === true}
                              onChange={(e) =>
                                setAllowanceDraft(u, {
                                  activeVideoLimit: e.target.value,
                                })
                              }
                              className="h-11 w-20 rounded-lg border border-white/10 bg-black/30 px-3 text-xs text-white focus:outline-none focus:border-white/30 disabled:opacity-40"
                              title="Active video limit"
                            />
                            <button
                              onClick={() => saveUploadAllowance(u)}
                              disabled={actingOnUser === u.id}
                              className="h-11 rounded-lg bg-white px-3 text-xs font-semibold text-black transition-colors hover:bg-white/85 disabled:opacity-50"
                            >
                              Save
                            </button>
                          </div>
                          <div className="flex items-center gap-1 sm:opacity-0 sm:transition-opacity sm:group-hover/user:opacity-100">
                            <button
                              onClick={() => toggleAdmin(u)}
                              disabled={actingOnUser === u.id || u.id === user.id}
                              className={`grid h-11 w-11 place-items-center rounded-lg transition-all ${
                                u.isAdmin ? "text-red-400 hover:bg-red-500/10" : "text-white/40 hover:bg-white hover:text-black"
                              }`}
                              title={u.isAdmin ? "Demote" : "Promote"}
                            >
                              {u.isAdmin ? <UserMinus size={16} /> : <UserPlus size={16} />}
                            </button>
                            <button
                              onClick={() => deleteUser(u)}
                              disabled={actingOnUser === u.id || u.id === user.id}
                              className="grid h-11 w-11 place-items-center rounded-lg text-white/40 transition-all hover:bg-red-500 hover:text-white"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {activeTab === "reports" && (
              <div className="flex flex-col flex-1">
                <div className="mb-6 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Flag size={16} className="text-red-400" />
                    Video Reports
                  </h3>
                  <button
                    onClick={loadReports}
                    className="text-[11px] font-bold text-white/40 hover:text-white transition-colors"
                  >
                    Refresh
                  </button>
                </div>

                <div className="space-y-4">
                  {loadingReports ? (
                    <div className="py-20 flex flex-col items-center justify-center text-white/20">
                      <Loader2 size={32} className="animate-spin mb-4" />
                      <p className="text-sm">Loading reports...</p>
                    </div>
                  ) : reports.length === 0 ? (
                    <div className="py-20 flex flex-col items-center justify-center text-white/20 border-2 border-dashed border-white/5 rounded-[32px]">
                      <Flag size={48} className="mb-4 opacity-10" />
                      <p className="text-sm">No active reports. Everything looks clean!</p>
                    </div>
                  ) : (
                    reports.map((report) => (
                      <div
                        key={report.id}
                        className="glass rounded-2xl border border-white/10 p-5 hover:bg-white/[0.04] transition-all"
                      >
                        <div className="flex flex-col gap-4">
                          <div className="flex flex-wrap items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-red-500 text-white uppercase tracking-wider">
                                  Reported
                                </span>
                                <span className="text-white/30 text-[10px]">
                                  {formatDate(report.created_at)}
                                </span>
                              </div>
                              <h4 className="text-sm font-bold text-white truncate mb-1">
                                Video: {report.video_name || "Unknown"}
                              </h4>
                              <p className="text-xs text-white/40">ID: {report.video_id}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Link
                                to={`/${report.video_id}`}
                                target="_blank"
                                className="h-8 px-3 rounded-lg bg-white/5 border border-white/10 text-white/60 text-xs font-bold hover:bg-white/10 hover:text-white transition-all flex items-center gap-2"
                              >
                                <Play size={12} />
                                View
                              </Link>
                              <button
                                onClick={() => deleteReport(report.id)}
                                disabled={actingOnReport === report.id}
                                className="h-8 px-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold hover:bg-emerald-500 hover:text-white transition-all flex items-center gap-2"
                              >
                                {actingOnReport === report.id ? <Loader2 size={12} className="animate-spin" /> : <CheckSquare size={12} />}
                                Clear
                              </button>
                              <button
                                onClick={() => setDeleteModal({ isOpen: true, video: { id: report.video_id, originalName: report.video_name } })}
                                className="h-8 w-8 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center hover:bg-red-500 hover:text-white transition-all"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                          <div className="rounded-xl bg-black/40 border border-red-500/10 p-3">
                            <p className="text-xs text-white/70 leading-relaxed italic">
                              "{report.reason}"
                            </p>
                          </div>
                          <div className="text-[10px] text-white/20 font-medium uppercase tracking-widest">
                            Reported from IP: {report.reporter_ip}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {activeTab === "resources" && (
              <div className="flex flex-col flex-1">
                <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <ExternalLink size={16} className="text-white/60" />
                    Resources
                  </h3>
                  <button
                    onClick={loadResources}
                    className="text-[11px] font-bold text-white/40 hover:text-white transition-colors"
                  >
                    Refresh
                  </button>
                </div>

                <form
                  onSubmit={saveResource}
                  noValidate
                  className="mb-6 rounded-[22px] border border-white/10 bg-white/[0.03] p-4 space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-bold">
                        {editingResourceId ? "Edit resource" : "Add resource"}
                      </h4>
                      <p className="mt-1 text-xs text-white/40">
                        These links appear on the public Resources page.
                      </p>
                    </div>
                    {editingResourceId && (
                      <button
                        type="button"
                        onClick={resetResourceForm}
                        className="h-9 rounded-xl bg-white/5 px-4 text-xs font-bold text-white/60 hover:bg-white/10 hover:text-white transition-colors"
                      >
                        Cancel Edit
                      </button>
                    )}
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase tracking-wider text-white/40">Title</label>
                      <input
                        value={resourceForm.title}
                        onChange={(e) => setResourceForm({ ...resourceForm, title: e.target.value })}
                        maxLength={140}
                        required
                        className="w-full h-10 rounded-xl border border-white/10 bg-black/40 px-3 text-sm text-white focus:outline-none focus:border-white/30"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase tracking-wider text-white/40">URL</label>
                      <input
                        value={resourceForm.url}
                        onChange={(e) => setResourceForm({ ...resourceForm, url: e.target.value })}
                        maxLength={500}
                        required
                        placeholder="https://example.com"
                        className="w-full h-10 rounded-xl border border-white/10 bg-black/40 px-3 text-sm text-white focus:outline-none focus:border-white/30"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase tracking-wider text-white/40">Category</label>
                      <input
                        value={resourceForm.category}
                        onChange={(e) => setResourceForm({ ...resourceForm, category: e.target.value })}
                        maxLength={80}
                        required
                        placeholder="Editing, Assets, Learning..."
                        className="w-full h-10 rounded-xl border border-white/10 bg-black/40 px-3 text-sm text-white focus:outline-none focus:border-white/30"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase tracking-wider text-white/40">Sort Order</label>
                      <input
                        type="number"
                        value={resourceForm.sortOrder}
                        onChange={(e) => setResourceForm({ ...resourceForm, sortOrder: e.target.value })}
                        className="w-full h-10 rounded-xl border border-white/10 bg-black/40 px-3 text-sm text-white focus:outline-none focus:border-white/30"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] uppercase tracking-wider text-white/40">Description</label>
                    <textarea
                      value={resourceForm.description}
                      onChange={(e) => setResourceForm({ ...resourceForm, description: e.target.value })}
                      maxLength={600}
                      rows={3}
                      className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30 resize-none"
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <label className="inline-flex items-center gap-3 text-xs font-bold text-white/70">
                      <input
                        type="checkbox"
                        checked={resourceForm.isPublished}
                        onChange={(e) => setResourceForm({ ...resourceForm, isPublished: e.target.checked })}
                        className="h-4 w-4 accent-white"
                      />
                      Published
                    </label>
                    <button
                      type="submit"
                      disabled={savingResource}
                      className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-5 text-xs font-bold text-black hover:bg-white/90 transition-colors disabled:opacity-60"
                    >
                      {savingResource && <Loader2 size={14} className="animate-spin" />}
                      {editingResourceId ? "Save Changes" : "Create Resource"}
                    </button>
                  </div>
                </form>

                <div className="space-y-3">
                  {loadingResources ? (
                    <div className="py-20 flex flex-col items-center justify-center text-white/20">
                      <Loader2 size={32} className="animate-spin mb-4" />
                      <p className="text-sm">Loading resources...</p>
                    </div>
                  ) : resources.length === 0 ? (
                    <div className="py-20 flex flex-col items-center justify-center text-white/20 border-2 border-dashed border-white/5 rounded-[32px]">
                      <ExternalLink size={48} className="mb-4 opacity-10" />
                      <p className="text-sm">No resources yet.</p>
                    </div>
                  ) : (
                    resources.map((resource) => (
                      <div
                        key={resource.id}
                        className="rounded-2xl border border-white/8 bg-white/[0.02] p-4 hover:bg-white/[0.04] transition-all"
                      >
                        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                          <div className="min-w-0">
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              <h4 className="text-sm font-bold truncate">{resource.title}</h4>
                              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/55">
                                {resource.category}
                              </span>
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                                resource.isPublished
                                  ? "bg-emerald-400/10 text-emerald-300"
                                  : "bg-white/5 text-white/35"
                              }`}>
                                {resource.isPublished ? "Published" : "Hidden"}
                              </span>
                              <span className="text-[10px] uppercase tracking-wider text-white/25">
                                Sort {resource.sortOrder || 0}
                              </span>
                            </div>
                            <a
                              href={resource.url}
                              target="_blank"
                              rel="noreferrer"
                              className="block truncate text-xs text-white/40 hover:text-white transition-colors"
                            >
                              {resource.url}
                            </a>
                            {resource.description && (
                              <p className="mt-2 max-w-2xl text-xs leading-relaxed text-white/55">
                                {resource.description}
                              </p>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <a
                              href={resource.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-white/50 hover:bg-white/10 hover:text-white transition-colors"
                              title="Open"
                            >
                              <ExternalLink size={14} />
                            </a>
                            <button
                              onClick={() => editResource(resource)}
                              className="h-9 rounded-xl bg-white/5 px-4 text-xs font-bold text-white/60 hover:bg-white/10 hover:text-white transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => deleteResource(resource)}
                              disabled={actingOnResource === resource.id}
                              className="inline-flex h-9 items-center gap-2 rounded-xl bg-red-500/10 px-4 text-xs font-bold text-red-400 hover:bg-red-500 hover:text-white transition-colors disabled:opacity-60"
                            >
                              {actingOnResource === resource.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="glass rounded-[22px] p-4">
              <h2 className="text-base font-semibold mb-3">Recent users</h2>
              {loadingOverview ? (
                <div className="flex items-center gap-2 text-sm text-white/35">
                  <Loader2 size={16} className="animate-spin" />
                  Loading...
                </div>
              ) : (
                <div className="space-y-3">
                  {overview.recentUsers.map((account) => (
                    <div
                      key={account.id}
                      className="rounded-2xl border border-white/8 bg-white/[0.02] p-3 hover:bg-white/[0.04] transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <p className="text-sm font-medium truncate">{account.email}</p>
                        {account.isAdmin && (
                          <span className="text-[9px] font-bold text-white/40 uppercase tracking-widest">Admin</span>
                        )}
                      </div>
                      <p className="text-[10px] text-white/45">
                        Joined {formatDate(account.createdAt)} • {account.videoCount} videos
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="glass rounded-[22px] p-4">
              <h2 className="text-base font-semibold mb-3">Forms Snapshot</h2>
              {loadingOverview ? (
                <div className="flex items-center gap-2 text-sm text-white/35">
                  <Loader2 size={16} className="animate-spin" />
                  Loading...
                </div>
              ) : (
                <div className="space-y-3">
                  {overview.forms.map((form) => (
                    <div
                      key={form.id}
                      className="rounded-2xl border border-white/8 bg-white/[0.02] p-3 hover:bg-white/[0.04] transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <p className="text-sm font-medium truncate">{form.name}</p>
                        <span className={`w-2 h-2 rounded-full ${form.isOpen ? "bg-emerald-400" : "bg-white/20"}`} />
                      </div>
                      <p className="text-[10px] text-white/45">
                        Owner: {form.ownerEmail}
                      </p>
                      <p className="text-[10px] text-white/45 mt-0.5">
                        {form.pendingCount} pending • {form.submissionCount} total
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-[22px] border border-red-500/20 bg-red-500/5 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle size={16} className="mt-0.5 text-red-400 shrink-0" />
                <div>
                  <h2 className="text-sm font-bold text-red-200">Moderation Note</h2>
                  <p className="mt-1 text-[11px] leading-relaxed text-red-200/60">
                    Removal is permanent. Content involving minors or illegal acts must be deleted immediately. Review the IP logs if forensic follow-up is required.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="fixed inset-x-3 bottom-4 z-[100] animate-in fade-in slide-in-from-bottom-6 duration-500 sm:bottom-8 sm:left-1/2 sm:right-auto sm:-translate-x-1/2">
          <div className="glass flex w-full flex-col gap-3 rounded-2xl border border-white/20 bg-black/60 px-4 py-4 shadow-2xl backdrop-blur-3xl sm:w-auto sm:min-w-[400px] sm:flex-row sm:items-center sm:gap-8 sm:px-6">
            <div className="flex items-center gap-3 border-white/10 sm:gap-4 sm:border-r sm:pr-8">
              <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-lg font-bold text-black">
                {selectedIds.size}
              </div>
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-bold text-white">Items Selected</span>
                <span className="text-[10px] uppercase tracking-widest text-white/40">Queue</span>
              </div>
            </div>
            
            <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-4">
              <button
                onClick={() => setSelectedIds(new Set())}
                className="h-10 rounded-xl px-4 text-xs font-bold text-white/50 transition-all hover:text-white sm:px-5"
              >
                Cancel
              </button>
              <button
                onClick={bulkDelete}
                disabled={isBulkDeleting}
                className="flex h-10 min-w-0 items-center gap-2.5 rounded-xl bg-red-500 px-4 text-xs font-bold text-white shadow-xl shadow-red-500/20 transition-all hover:bg-red-400 disabled:opacity-50 sm:px-6"
              >
                {isBulkDeleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}

      <Modal
        isOpen={deleteModal.isOpen}
        onClose={() => setDeleteModal({ isOpen: false, video: null })}
        title="Delete Video"
        size="sm"
      >
        <p className="text-sm leading-relaxed text-white/60">
          Are you sure you want to delete <span className="text-white font-bold">{deleteModal.video?.originalName || deleteModal.video?.id}</span>? 
          This action is permanent and will remove the file from Bunny.net and our database.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={() => setDeleteModal({ isOpen: false, video: null })}
            className="h-10 px-4 text-sm font-bold text-white/40 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={confirmDelete}
            disabled={deletingId === deleteModal.video?.id}
            className="h-10 px-6 rounded-xl bg-red-500 text-white text-sm font-bold hover:bg-red-600 transition-colors disabled:opacity-60 flex items-center gap-2"
          >
            {deletingId === deleteModal.video?.id && <Loader2 size={16} className="animate-spin" />}
            Confirm Delete
          </button>
        </div>
      </Modal>
    </div>
  );
}
