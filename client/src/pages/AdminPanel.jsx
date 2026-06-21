import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  BarChart3,
  CheckSquare,
  Clock,
  ExternalLink,
  FileText,
  Flag,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Shield,
  Square,
  Trash2,
  User,
  UserMinus,
  UserPlus,
  Users,
  Video,
  X,
} from "lucide-react";
import Modal from "../components/Modal";
import { useToast } from "../contexts/ToastContext";
import MainNav from "../components/MainNav";
import Select from "../components/Select";
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
  const [deleteModal, setDeleteModal] = useState({ isOpen: false, video: null });
  const [deletingId, setDeletingId] = useState(null);
  const [playingId, setPlayingId] = useState(null);
  const [filters, setFilters] = useState({ type: "all", sortBy: "newest" });
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState("videos");
  const [users, setUsers] = useState([]);
  const [userSearch, setUserSearch] = useState("");
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [actingOnUser, setActingOnUser] = useState(null);
  const [allowanceDrafts, setAllowanceDrafts] = useState({});
  const [deleteUserModal, setDeleteUserModal] = useState({ isOpen: false, targetUser: null });
  const [reports, setReports] = useState([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [actingOnReport, setActingOnReport] = useState(null);
  const [resources, setResources] = useState([]);
  const [loadingResources, setLoadingResources] = useState(false);
  const [resourceForm, setResourceForm] = useState(emptyResourceForm);
  const [editingResourceId, setEditingResourceId] = useState(null);
  const [savingResource, setSavingResource] = useState(false);
  const [actingOnResource, setActingOnResource] = useState(null);
  const [deleteResourceModal, setDeleteResourceModal] = useState({ isOpen: false, resource: null });

  const videoSearchDebounce = useRef(null);
  const userSearchDebounce = useRef(null);

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
  }, [user, token, activeQuery, filters, activeTab]);

  // Debounced video search
  useEffect(() => {
    if (activeTab !== "videos") return;
    clearTimeout(videoSearchDebounce.current);
    videoSearchDebounce.current = setTimeout(() => {
      setActiveQuery(search.trim());
    }, 380);
    return () => clearTimeout(videoSearchDebounce.current);
  }, [search, activeTab]);

  // Debounced user search
  useEffect(() => {
    if (activeTab !== "users") return;
    clearTimeout(userSearchDebounce.current);
    userSearchDebounce.current = setTimeout(() => {
      loadUsers(userSearch);
    }, 380);
    return () => clearTimeout(userSearchDebounce.current);
  }, [userSearch, activeTab]);

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
      if (filterOptions.sortBy && filterOptions.sortBy !== "newest")
        params.set("sortBy", filterOptions.sortBy);
      const suffix = params.toString();
      const res = await fetch(
        `${API_URL}/api/admin/videos${suffix ? `?${suffix}` : ""}`,
        { headers: { Authorization: `Bearer ${token}` } },
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
        { headers: { Authorization: `Bearer ${token}` } },
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
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const saveResource = async (event) => {
    event.preventDefault();
    if (!resourceForm.title.trim()) { showToast("Title is required", "error"); return; }
    if (!resourceForm.category.trim()) { showToast("Category is required", "error"); return; }
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
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...resourceForm, url: normalizedUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save resource");
      setResources((current) => {
        const next = editingResourceId
          ? current.map((r) => (r.id === data.id ? data : r))
          : [...current, data];
        return next.sort(
          (a, b) =>
            a.category.localeCompare(b.category) ||
            (a.sortOrder || 0) - (b.sortOrder || 0) ||
            a.title.localeCompare(b.title),
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

  const deleteResource = (resource) => {
    setDeleteResourceModal({ isOpen: true, resource });
  };

  const confirmDeleteResource = async () => {
    const resource = deleteResourceModal.resource;
    if (!resource) return;
    setDeleteResourceModal({ isOpen: false, resource: null });
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
      setUsers((current) =>
        current.map((u) => (u.id === targetUser.id ? { ...u, isAdmin: data.isAdmin } : u)),
      );
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
      activeVideoLimit: draft.activeVideoLimit ?? targetUser.activeVideoLimit ?? 5,
      activeVideoUnlimited: draft.activeVideoUnlimited ?? targetUser.activeVideoUnlimited ?? false,
    };
  };

  const setAllowanceDraft = (targetUser, patch) => {
    setAllowanceDrafts((current) => ({
      ...current,
      [targetUser.id]: { ...getAllowanceDraft(targetUser), ...patch },
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
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            activeVideoLimit,
            activeVideoUnlimited: draft.activeVideoUnlimited === true,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update upload allowance");
      setUsers((current) =>
        current.map((u) =>
          u.id === targetUser.id
            ? { ...u, activeVideoLimit: data.activeVideoLimit, activeVideoUnlimited: data.activeVideoUnlimited }
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

  const deleteUser = (targetUser) => {
    if (targetUser.id === user.id) return;
    setDeleteUserModal({ isOpen: true, targetUser });
  };

  const confirmDeleteUser = async () => {
    const targetUser = deleteUserModal.targetUser;
    if (!targetUser) return;
    setDeleteUserModal({ isOpen: false, targetUser: null });
    setActingOnUser(targetUser.id);
    try {
      const res = await fetch(`${API_URL}/api/admin/users/${targetUser.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete user");
      setUsers((current) => current.filter((u) => u.id !== targetUser.id));
      showToast("User deleted", "success");
      loadOverview();
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setActingOnUser(null);
    }
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
      setVideos((current) => current.filter((v) => v.id !== deleteModal.video.id));
      setDeleteModal({ isOpen: false, video: null });
      if (data.bunnyOk === false) {
        showToast("Deleted from database — Bunny.net removal may have failed", "error");
      } else {
        showToast("Video deleted", "success");
      }
      loadOverview();
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setDeletingId(null);
    }
  };

  const toggleSelect = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = () => {
    if (selectedIds.size === videos.length && videos.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(videos.map((v) => v.id)));
    }
  };

  const bulkDelete = async () => {
    if (selectedIds.size === 0 || !token) return;
    setIsBulkDeleting(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/videos/bulk-delete`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Bulk delete failed");
      showToast(`Deleted ${data.deletedCount} videos`, "success");
      setVideos((current) => current.filter((v) => !selectedIds.has(v.id)));
      setSelectedIds(new Set());
      loadOverview();
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const stats = useMemo(
    () => [
      { label: "Total Users", value: overview.stats.totalUsers, Icon: Users, color: "text-sky-300", bg: "bg-sky-400/10" },
      { label: "Active Videos", value: overview.stats.activeVideos, Icon: Video, color: "text-violet-300", bg: "bg-violet-400/10" },
      { label: "Forms", value: overview.stats.totalForms, Icon: FileText, color: "text-emerald-300", bg: "bg-emerald-400/10" },
      {
        label: "Pending Reviews",
        value: overview.stats.pendingSubmissions,
        Icon: Clock,
        color: overview.stats.pendingSubmissions > 0 ? "text-amber-300" : "text-white/50",
        bg: overview.stats.pendingSubmissions > 0 ? "bg-amber-400/10" : "bg-white/5",
      },
    ],
    [overview],
  );

  const tabs = [
    { id: "videos", label: "Videos", Icon: Video, count: videos.length },
    { id: "users", label: "Users", Icon: Users, count: users.length },
    { id: "reports", label: "Reports", Icon: Flag, count: reports.length },
    { id: "resources", label: "Resources", Icon: ExternalLink, count: 0 },
  ];

  const formatDate = (value) =>
    new Date(value).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

  const formatBytes = (bytes) => {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return "—";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
  };

  const ageLabel = (createdAt) => {
    const diff = Date.now() - new Date(createdAt).getTime();
    const hours = Math.max(1, Math.floor(diff / (1000 * 60 * 60)));
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return `${Math.floor(days / 30)}mo ago`;
  };

  if (!user?.isAdmin) {
    return (
      <div className="obsidian-ui min-h-screen text-white">
        <main className="max-w-xl mx-auto px-6 py-12 text-center">
          <Shield size={24} className="mx-auto mb-3 text-white/30" />
          <h1 className="text-xl font-bold mb-2">Admin panel</h1>
          <p className="text-sm text-white/50">You need an admin account to open this area.</p>
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

      <main className="mx-auto max-w-5xl space-y-5 px-4 py-5 sm:px-6 sm:py-7">
        {/* Page header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-red-500/15">
              <Shield size={16} className="text-red-400" />
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-red-300/70">
                Admin
              </p>
              <h1 className="text-lg font-bold leading-tight tracking-tight">
                Control Panel
              </h1>
            </div>
          </div>
          <p className="text-[11px] text-white/30">
            Signed in as <span className="text-white/55 font-medium">{user?.email}</span>
          </p>
        </div>

        {/* Stat cards */}
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="glass rounded-2xl p-4">
              <div className="flex items-center gap-2.5 mb-3">
                <div className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${stat.bg}`}>
                  <stat.Icon size={14} className={stat.color} />
                </div>
                <p className="text-[10px] uppercase tracking-[0.16em] text-white/35 leading-none">
                  {stat.label}
                </p>
              </div>
              {loadingOverview ? (
                <div className="h-8 w-12 rounded-lg bg-white/5 animate-pulse" />
              ) : (
                <p className={`text-3xl font-bold tracking-tight ${stat.color}`}>
                  {stat.value}
                </p>
              )}
            </div>
          ))}
        </section>

        {/* Tab navigation */}
        <div className="glass rounded-2xl p-1">
          <div className="grid grid-cols-4 gap-1">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              const showBadge = tab.count > 0;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-bold transition-all ${
                    isActive
                      ? "bg-white text-black shadow-lg"
                      : "text-white/45 hover:text-white hover:bg-white/5"
                  }`}
                >
                  <tab.Icon size={13} />
                  <span className="hidden sm:inline">{tab.label}</span>
                  {showBadge && (
                    <span
                      className={`min-w-[18px] rounded-full px-1 text-center text-[9px] font-bold tabular-nums ${
                        isActive
                          ? "bg-black/15 text-black/60"
                          : tab.id === "reports"
                          ? "bg-red-500/20 text-red-300"
                          : "bg-white/10 text-white/50"
                      }`}
                    >
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── VIDEOS TAB ── */}
        {activeTab === "videos" && (
          <div className="glass rounded-[22px] p-4 sm:p-5">
            {/* Search + filters row */}
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by title, uploader, ID…"
                  className="h-9 w-full rounded-xl border border-white/10 bg-black/30 pl-9 pr-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/25"
                />
              </div>
              <div className="w-36 shrink-0">
                <Select
                  value={filters.type}
                  onChange={(val) => setFilters({ ...filters, type: val })}
                  ariaLabel="Uploader type"
                  options={[
                    { value: "all", label: "All uploaders" },
                    { value: "registered", label: "Registered" },
                    { value: "anonymous", label: "Anonymous" },
                  ]}
                />
              </div>
              <div className="w-36 shrink-0">
                <Select
                  value={filters.sortBy}
                  onChange={(val) => setFilters({ ...filters, sortBy: val })}
                  ariaLabel="Sort order"
                  options={[
                    { value: "newest", label: "Newest first" },
                    { value: "oldest", label: "Oldest first" },
                    { value: "largest", label: "Largest first" },
                    { value: "smallest", label: "Smallest first" },
                  ]}
                />
              </div>
              <button
                onClick={() => loadVideos(activeQuery, filters)}
                title="Refresh"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
              >
                <RefreshCw size={14} />
              </button>
            </div>

            {/* Selection toolbar */}
            <div className="mb-3 flex min-h-[36px] items-center gap-3">
              {selectedIds.size > 0 ? (
                <div className="flex w-full items-center gap-3 rounded-xl bg-white/[0.06] px-3 py-2">
                  <span className="text-xs font-bold text-white">
                    {selectedIds.size} selected
                  </span>
                  <button
                    onClick={() => setSelectedIds(new Set())}
                    className="text-xs text-white/40 hover:text-white transition-colors"
                  >
                    Clear
                  </button>
                  <button
                    onClick={bulkDelete}
                    disabled={isBulkDeleting}
                    className="ml-auto flex items-center gap-1.5 rounded-lg bg-red-500 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-red-400 disabled:opacity-60"
                  >
                    {isBulkDeleting ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Trash2 size={12} />
                    )}
                    Delete {selectedIds.size}
                  </button>
                </div>
              ) : videos.length > 0 ? (
                <button
                  onClick={toggleSelectAll}
                  className="flex items-center gap-1.5 text-xs text-white/30 transition-colors hover:text-white/60"
                >
                  <Square size={13} />
                  Select all
                </button>
              ) : null}
            </div>

            {/* Video list */}
            {loadingVideos ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-14 animate-pulse rounded-xl bg-white/[0.03]" />
                ))}
              </div>
            ) : videos.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-white/25">
                <Video size={40} className="mb-3 opacity-30" />
                <p className="text-sm">No videos found.</p>
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="mt-3 text-xs text-white/40 hover:text-white underline transition-colors"
                  >
                    Clear search
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-1.5">
                {videos.map((video) => (
                  <div
                    key={video.id}
                    className={`group flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-all ${
                      selectedIds.has(video.id)
                        ? "border-white/30 bg-white/[0.07]"
                        : "border-white/[0.06] bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]"
                    }`}
                  >
                    {/* Checkbox */}
                    <button
                      onClick={() => toggleSelect(video.id)}
                      className={`shrink-0 transition-colors ${
                        selectedIds.has(video.id) ? "text-white" : "text-white/20 hover:text-white/60"
                      }`}
                    >
                      {selectedIds.has(video.id) ? (
                        <CheckSquare size={14} strokeWidth={2.5} />
                      ) : (
                        <Square size={14} />
                      )}
                    </button>

                    {/* Thumbnail */}
                    <div className="relative h-[40px] w-[72px] shrink-0 overflow-hidden rounded-lg bg-black border border-white/10">
                      {playingId === video.id ? (
                        <iframe
                          src={`${API_URL}/embed/${video.id}?autoplay=true&volume=15`}
                          className="absolute inset-0 h-full w-full border-0"
                          allow="autoplay; fullscreen"
                        />
                      ) : (
                        <button
                          onClick={() => setPlayingId(video.id)}
                          className="group/thumb relative h-full w-full"
                        >
                          <img
                            src={`${API_URL}/thumb/${video.id}`}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover/thumb:opacity-100">
                            <Play size={14} className="text-white" fill="currentColor" />
                          </div>
                        </button>
                      )}
                    </div>

                    {/* Title + uploader */}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium leading-tight">
                        {video.originalName || "Untitled"}
                      </p>
                      <p className="truncate text-[11px] text-white/35">
                        {video.owner?.email || "Anonymous"}{" "}
                        <span className="text-white/20">· {video.id}</span>
                      </p>
                    </div>

                    {/* Meta */}
                    <div className="hidden shrink-0 items-center gap-4 text-[11px] text-white/30 md:flex">
                      <span className="w-14 text-right">{formatBytes(video.size)}</span>
                      <span className="w-14 text-right">{ageLabel(video.createdAt)}</span>
                    </div>

                    {/* Actions */}
                    <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 sm:opacity-100">
                      <Link
                        to={`/${video.id}`}
                        target="_blank"
                        className="grid h-8 w-8 place-items-center rounded-lg text-white/35 transition-colors hover:bg-white/10 hover:text-white"
                        title="View page"
                      >
                        <ExternalLink size={13} />
                      </Link>
                      <button
                        onClick={() => setDeleteModal({ isOpen: true, video })}
                        className="grid h-8 w-8 place-items-center rounded-lg text-white/35 transition-colors hover:bg-red-500/15 hover:text-red-400"
                        title="Delete"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── USERS TAB ── */}
        {activeTab === "users" && (
          <div className="glass rounded-[22px] p-4 sm:p-5">
            <div className="relative mb-4">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
              <input
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Search users by email…"
                className="h-9 w-full rounded-xl border border-white/10 bg-black/30 pl-9 pr-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/25"
              />
            </div>

            {loadingUsers ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-24 animate-pulse rounded-xl bg-white/[0.03]" />
                ))}
              </div>
            ) : users.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-white/25">
                <Users size={40} className="mb-3 opacity-30" />
                <p className="text-sm">No users found.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {users.map((u) => {
                  const allowance = getAllowanceDraft(u);
                  return (
                    <div
                      key={u.id}
                      className="rounded-2xl border border-white/8 bg-white/[0.025] p-4 transition-colors hover:bg-white/[0.04]"
                    >
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
                        {/* User info */}
                        <div className="flex min-w-0 flex-1 items-start gap-3">
                          <div
                            className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border ${
                              u.isAdmin
                                ? "border-white bg-white text-black"
                                : "border-white/10 bg-black/25 text-white/35"
                            }`}
                          >
                            {u.isAdmin ? <Shield size={15} /> : <User size={15} />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-sm font-semibold">{u.email}</p>
                              {u.isAdmin && (
                                <span className="rounded-full border border-white/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white/50">
                                  Admin
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 text-[10px] text-white/30">ID {u.id}</p>
                            <div className="mt-2.5 flex flex-wrap gap-2 text-xs">
                              <div className="rounded-lg bg-black/25 px-2.5 py-1.5">
                                <p className="text-[9px] uppercase tracking-wider text-white/30">Active</p>
                                <p className="mt-0.5 font-semibold text-white/75">{u.activeVideoCount || 0}</p>
                              </div>
                              <div className="rounded-lg bg-black/25 px-2.5 py-1.5">
                                <p className="text-[9px] uppercase tracking-wider text-white/30">Plan</p>
                                <p className="mt-0.5 font-semibold text-white/75">
                                  {u.activeVideoUnlimited ? "Unlimited" : `${u.activeVideoLimit || 5} max`}
                                </p>
                              </div>
                              <div className="rounded-lg bg-black/25 px-2.5 py-1.5">
                                <p className="text-[9px] uppercase tracking-wider text-white/30">Storage</p>
                                <p className="mt-0.5 font-semibold text-white/75">{formatBytes(u.totalStorage)}</p>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Controls */}
                        <div className="rounded-xl border border-white/8 bg-black/15 p-3 xl:w-80">
                          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                            <div>
                              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/35">
                                Video limit
                              </label>
                              <input
                                type="number"
                                min="1"
                                value={allowance.activeVideoLimit}
                                disabled={allowance.activeVideoUnlimited === true}
                                onChange={(e) => setAllowanceDraft(u, { activeVideoLimit: e.target.value })}
                                className="h-9 w-full rounded-lg border border-white/10 bg-black/35 px-3 text-sm text-white focus:outline-none focus:border-white/25 disabled:opacity-40"
                              />
                            </div>
                            <button
                              onClick={() => saveUploadAllowance(u)}
                              disabled={actingOnUser === u.id}
                              className="self-end h-9 rounded-lg bg-white px-4 text-xs font-semibold text-black transition-colors hover:bg-white/85 disabled:opacity-50"
                            >
                              Save
                            </button>
                          </div>
                          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                            <label className="flex items-center gap-2 text-xs text-white/55">
                              <input
                                type="checkbox"
                                checked={allowance.activeVideoUnlimited === true}
                                onChange={(e) => setAllowanceDraft(u, { activeVideoUnlimited: e.target.checked })}
                                className="h-3.5 w-3.5 accent-white"
                              />
                              Unlimited videos
                            </label>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => toggleAdmin(u)}
                                disabled={actingOnUser === u.id || u.id === user.id}
                                className={`grid h-9 w-9 place-items-center rounded-lg transition-all disabled:opacity-40 ${
                                  u.isAdmin
                                    ? "text-red-400 hover:bg-red-500/15"
                                    : "text-white/40 hover:bg-white hover:text-black"
                                }`}
                                title={u.isAdmin ? "Demote from admin" : "Promote to admin"}
                              >
                                {actingOnUser === u.id ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : u.isAdmin ? (
                                  <UserMinus size={14} />
                                ) : (
                                  <UserPlus size={14} />
                                )}
                              </button>
                              <button
                                onClick={() => deleteUser(u)}
                                disabled={actingOnUser === u.id || u.id === user.id}
                                className="grid h-9 w-9 place-items-center rounded-lg text-white/35 transition-all hover:bg-red-500 hover:text-white disabled:opacity-40"
                                title="Delete user"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── REPORTS TAB ── */}
        {activeTab === "reports" && (
          <div className="glass rounded-[22px] p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Flag size={15} className="text-red-400" />
                <h3 className="text-sm font-bold">Video Reports</h3>
                {reports.length > 0 && (
                  <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-300">
                    {reports.length}
                  </span>
                )}
              </div>
              <button
                onClick={loadReports}
                className="flex items-center gap-1.5 text-[11px] text-white/35 transition-colors hover:text-white"
              >
                <RefreshCw size={12} />
                Refresh
              </button>
            </div>

            {loadingReports ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-28 animate-pulse rounded-xl bg-white/[0.03]" />
                ))}
              </div>
            ) : reports.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-white/20">
                <Flag size={44} className="mb-4 opacity-20" />
                <p className="text-sm font-medium">No active reports</p>
                <p className="mt-1 text-[11px]">Everything looks clean!</p>
              </div>
            ) : (
              <div className="space-y-3">
                {reports.map((report) => (
                  <div
                    key={report.id}
                    className="rounded-2xl border border-white/10 bg-white/[0.025] p-4 transition-colors hover:bg-white/[0.04]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="mb-1.5 flex flex-wrap items-center gap-2">
                          <span className="rounded bg-red-500 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
                            Reported
                          </span>
                          <span className="text-[10px] text-white/30">{formatDate(report.created_at)}</span>
                        </div>
                        <h4 className="mb-0.5 truncate text-sm font-semibold">
                          {report.video_name || "Unknown video"}
                        </h4>
                        <p className="text-[10px] text-white/30">ID: {report.video_id}</p>
                        <div className="mt-2.5 rounded-lg bg-black/40 border border-red-500/10 px-3 py-2">
                          <p className="text-xs italic leading-relaxed text-white/65">"{report.reason}"</p>
                        </div>
                        <p className="mt-2 text-[10px] text-white/20">Reporter IP: {report.reporter_ip}</p>
                      </div>
                      <div className="flex shrink-0 flex-col gap-1.5">
                        <Link
                          to={`/${report.video_id}`}
                          target="_blank"
                          className="flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-bold text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                        >
                          <Play size={11} />
                          View
                        </Link>
                        <button
                          onClick={() => deleteReport(report.id)}
                          disabled={actingOnReport === report.id}
                          className="flex h-8 items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 text-xs font-bold text-emerald-400 transition-colors hover:bg-emerald-500 hover:text-white disabled:opacity-60"
                        >
                          {actingOnReport === report.id ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : (
                            <CheckSquare size={11} />
                          )}
                          Clear
                        </button>
                        <button
                          onClick={() =>
                            setDeleteModal({
                              isOpen: true,
                              video: { id: report.video_id, originalName: report.video_name },
                            })
                          }
                          className="grid h-8 w-full place-items-center rounded-lg border border-red-500/20 bg-red-500/10 text-xs font-bold text-red-400 transition-colors hover:bg-red-500 hover:text-white"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── RESOURCES TAB ── */}
        {activeTab === "resources" && (
          <div className="glass rounded-[22px] p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ExternalLink size={15} className="text-white/50" />
                <h3 className="text-sm font-bold">Public Resources</h3>
              </div>
              <button
                onClick={loadResources}
                className="flex items-center gap-1.5 text-[11px] text-white/35 transition-colors hover:text-white"
              >
                <RefreshCw size={12} />
                Refresh
              </button>
            </div>

            {/* Add / edit form */}
            <form
              onSubmit={saveResource}
              noValidate
              className="mb-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-bold">
                    {editingResourceId ? "Edit resource" : "Add resource"}
                  </h4>
                  <p className="mt-0.5 text-xs text-white/35">
                    Links appear on the public Resources page.
                  </p>
                </div>
                {editingResourceId && (
                  <button
                    type="button"
                    onClick={resetResourceForm}
                    className="flex items-center gap-1.5 rounded-xl bg-white/5 px-3 py-1.5 text-xs font-bold text-white/55 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <X size={12} />
                    Cancel
                  </button>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/35">
                    Title <span className="text-red-400">*</span>
                  </label>
                  <input
                    value={resourceForm.title}
                    onChange={(e) => setResourceForm({ ...resourceForm, title: e.target.value })}
                    maxLength={140}
                    required
                    className="w-full h-9 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white focus:outline-none focus:border-white/25"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/35">
                    URL <span className="text-red-400">*</span>
                  </label>
                  <input
                    value={resourceForm.url}
                    onChange={(e) => setResourceForm({ ...resourceForm, url: e.target.value })}
                    maxLength={500}
                    placeholder="https://example.com"
                    required
                    className="w-full h-9 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/25"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/35">
                    Category <span className="text-red-400">*</span>
                  </label>
                  <input
                    value={resourceForm.category}
                    onChange={(e) => setResourceForm({ ...resourceForm, category: e.target.value })}
                    maxLength={80}
                    placeholder="Editing, Assets, Learning…"
                    required
                    className="w-full h-9 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/25"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/35">
                    Sort order
                  </label>
                  <input
                    type="number"
                    value={resourceForm.sortOrder}
                    onChange={(e) => setResourceForm({ ...resourceForm, sortOrder: e.target.value })}
                    className="w-full h-9 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white focus:outline-none focus:border-white/25"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/35">
                  Description
                </label>
                <textarea
                  value={resourceForm.description}
                  onChange={(e) => setResourceForm({ ...resourceForm, description: e.target.value })}
                  maxLength={600}
                  rows={2}
                  className="w-full resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:outline-none focus:border-white/25"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-white/60">
                  <input
                    type="checkbox"
                    checked={resourceForm.isPublished}
                    onChange={(e) => setResourceForm({ ...resourceForm, isPublished: e.target.checked })}
                    className="h-3.5 w-3.5 accent-white"
                  />
                  Published
                </label>
                <button
                  type="submit"
                  disabled={savingResource}
                  className="flex h-9 items-center gap-2 rounded-xl bg-white px-5 text-xs font-bold text-black transition-colors hover:bg-white/90 disabled:opacity-60"
                >
                  {savingResource && <Loader2 size={13} className="animate-spin" />}
                  {editingResourceId ? "Save Changes" : "Create Resource"}
                </button>
              </div>
            </form>

            {/* Resource list */}
            {loadingResources ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-16 animate-pulse rounded-xl bg-white/[0.03]" />
                ))}
              </div>
            ) : resources.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-white/20">
                <ExternalLink size={40} className="mb-3 opacity-20" />
                <p className="text-sm">No resources yet.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {resources.map((resource) => (
                  <div
                    key={resource.id}
                    className="group rounded-2xl border border-white/8 bg-white/[0.02] p-3.5 transition-colors hover:bg-white/[0.04]"
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <h4 className="truncate text-sm font-semibold">{resource.title}</h4>
                          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/50">
                            {resource.category}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                              resource.isPublished
                                ? "bg-emerald-400/10 text-emerald-300"
                                : "bg-white/5 text-white/30"
                            }`}
                          >
                            {resource.isPublished ? "Live" : "Hidden"}
                          </span>
                        </div>
                        <a
                          href={resource.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block truncate text-xs text-white/35 transition-colors hover:text-white/70"
                        >
                          {resource.url}
                        </a>
                        {resource.description && (
                          <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-white/50">
                            {resource.description}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <a
                          href={resource.url}
                          target="_blank"
                          rel="noreferrer"
                          className="grid h-8 w-8 place-items-center rounded-xl bg-white/5 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
                          title="Open link"
                        >
                          <ExternalLink size={13} />
                        </a>
                        <button
                          onClick={() => editResource(resource)}
                          className="h-8 rounded-xl bg-white/5 px-3 text-xs font-bold text-white/55 transition-colors hover:bg-white/10 hover:text-white"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteResource(resource)}
                          disabled={actingOnResource === resource.id}
                          className="flex h-8 items-center gap-1.5 rounded-xl bg-red-500/10 px-3 text-xs font-bold text-red-400 transition-colors hover:bg-red-500 hover:text-white disabled:opacity-60"
                        >
                          {actingOnResource === resource.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Trash2 size={12} />
                          )}
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Moderation note */}
        <div className="flex items-start gap-3 rounded-2xl border border-red-500/15 bg-red-500/[0.04] px-4 py-3">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-red-400/70" />
          <p className="text-[11px] leading-relaxed text-red-200/50">
            All deletions are <strong className="text-red-200/70 font-semibold">permanent</strong>. Content involving minors or illegal acts must be removed immediately. Review IP logs if forensic follow-up is needed.
          </p>
        </div>
      </main>

      {/* Delete video modal */}
      <Modal
        isOpen={deleteModal.isOpen}
        onClose={() => setDeleteModal({ isOpen: false, video: null })}
        title="Delete Video"
        size="sm"
      >
        <p className="text-sm leading-relaxed text-white/60">
          Permanently delete{" "}
          <span className="font-bold text-white">
            {deleteModal.video?.originalName || deleteModal.video?.id}
          </span>
          ? This will remove it from Bunny.net and the database.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={() => setDeleteModal({ isOpen: false, video: null })}
            className="h-10 px-4 text-sm font-bold text-white/40 transition-colors hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={confirmDelete}
            disabled={deletingId === deleteModal.video?.id}
            className="flex h-10 items-center gap-2 rounded-xl bg-red-500 px-6 text-sm font-bold text-white transition-colors hover:bg-red-600 disabled:opacity-60"
          >
            {deletingId === deleteModal.video?.id && (
              <Loader2 size={15} className="animate-spin" />
            )}
            Delete Permanently
          </button>
        </div>
      </Modal>

      {/* Delete user modal */}
      <Modal
        isOpen={deleteUserModal.isOpen}
        onClose={() => setDeleteUserModal({ isOpen: false, targetUser: null })}
        title="Delete User"
        size="sm"
      >
        <p className="text-sm leading-relaxed text-white/60">
          Permanently delete{" "}
          <span className="font-bold text-white">{deleteUserModal.targetUser?.email}</span>?
          This will also delete all of their videos.
        </p>
        <div className="mt-1 rounded-xl bg-amber-500/10 border border-amber-500/20 px-3 py-2">
          <p className="text-xs text-amber-300/80">This action cannot be undone.</p>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={() => setDeleteUserModal({ isOpen: false, targetUser: null })}
            className="h-10 px-4 text-sm font-bold text-white/40 transition-colors hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={confirmDeleteUser}
            className="flex h-10 items-center gap-2 rounded-xl bg-red-500 px-6 text-sm font-bold text-white transition-colors hover:bg-red-600"
          >
            <Trash2 size={15} />
            Delete User
          </button>
        </div>
      </Modal>

      {/* Delete resource modal */}
      <Modal
        isOpen={deleteResourceModal.isOpen}
        onClose={() => setDeleteResourceModal({ isOpen: false, resource: null })}
        title="Delete Resource"
        size="sm"
      >
        <p className="text-sm leading-relaxed text-white/60">
          Remove{" "}
          <span className="font-bold text-white">{deleteResourceModal.resource?.title}</span>{" "}
          from the public Resources page?
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={() => setDeleteResourceModal({ isOpen: false, resource: null })}
            className="h-10 px-4 text-sm font-bold text-white/40 transition-colors hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={confirmDeleteResource}
            className="flex h-10 items-center gap-2 rounded-xl bg-red-500 px-6 text-sm font-bold text-white transition-colors hover:bg-red-600"
          >
            <Trash2 size={15} />
            Delete
          </button>
        </div>
      </Modal>

      {/* Floating bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="fixed inset-x-4 bottom-5 z-[100] animate-in fade-in slide-in-from-bottom-4 sm:inset-x-auto sm:left-1/2 sm:bottom-8 sm:-translate-x-1/2">
          <div className="glass flex w-full items-center gap-4 rounded-2xl border border-white/20 bg-black/70 px-5 py-3.5 shadow-2xl backdrop-blur-3xl sm:w-auto sm:min-w-[380px]">
            <div className="flex items-center gap-3 border-r border-white/10 pr-4">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white font-bold text-sm text-black">
                {selectedIds.size}
              </div>
              <div>
                <p className="text-sm font-bold text-white leading-none">Selected</p>
                <p className="text-[10px] uppercase tracking-widest text-white/35">Videos</p>
              </div>
            </div>
            <div className="flex flex-1 items-center justify-end gap-3">
              <button
                onClick={() => setSelectedIds(new Set())}
                className="text-xs font-bold text-white/40 transition-colors hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={bulkDelete}
                disabled={isBulkDeleting}
                className="flex h-9 items-center gap-2 rounded-xl bg-red-500 px-5 text-xs font-bold text-white shadow-lg shadow-red-500/25 transition-colors hover:bg-red-400 disabled:opacity-60"
              >
                {isBulkDeleting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
                Delete all
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
