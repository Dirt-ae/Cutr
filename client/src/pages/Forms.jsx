import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Check,
  Copy,
  Eye,
  ExternalLink,
  Loader2,
  LogIn,
  Plus,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { API_URL } from "../utils/api";
import { useToast } from "../contexts/ToastContext";
import MainNav from "../components/MainNav";

const emptyQuestion = () => ({
  id: `q_${crypto.randomUUID().slice(0, 8)}`,
  label: "",
  type: "text",
  required: true,
  options: [],
});

const defaultForm = {
  name: "",
  slug: "",
  description: "",
  guildId: "",
  channelId: "",
  panelChannelId: "",
  acceptedRoleId: "",
  pingRoleId: "",
  reviewerRoleId: "",
  acceptEmoji: "✅",
  denyEmoji: "❌",
  reapplyEmoji: "🔁",
  acceptThreshold: 3,
  denyThreshold: 3,
  reapplyThreshold: 3,
  denyCooldownDays: 30,
  reapplyCooldownDays: 14,
  isOpen: true,
  requiresVideo: true,
  requireDiscord: true,
  successMessage: "",
  openAt: "",
  closeAt: "",
  submissionLimit: 0,
  oneSubmissionPerUser: true,
  maxFileSizeMb: 100,
  bannerUrl: "",
  accentColor: "#ffffff",
  antiSpamCooldownHours: 0,
  questions: [
    {
      ...emptyQuestion(),
      label: "What type of edit is this?",
      type: "select",
      options: ["Anime", "IRL", "COD"],
    },
    {
      ...emptyQuestion(),
      label: "Anything reviewers should know?",
      type: "textarea",
      required: false,
    },
  ],
};

defaultForm.acceptEmoji = "\u2705";
defaultForm.denyEmoji = "\u274c";
defaultForm.reapplyEmoji = "\ud83d\udd01";

const isJwtExpired = (token) => {
  if (!token) return true;
  try {
    const base64 = (token.split(".")[1] || "")
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const payload = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
    if (!payload?.exp) return false;
    return payload.exp * 1000 <= Date.now() + 30_000;
  } catch {
    return true;
  }
};

const ToggleField = ({ label, checked, onChange, help }) => (
  <label className="h-9 rounded-xl bg-white/5 border border-white/10 px-3 flex items-center justify-between gap-3 cursor-pointer">
    <span className="text-[10px] font-semibold uppercase tracking-widest text-white/45 inline-flex items-center gap-1 min-w-0 leading-none">
      <span className="truncate">{label}</span>
      {help && <InfoHint text={help} />}
    </span>
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="h-4 w-4 rounded border-white/20 bg-black/40 text-white focus:ring-0"
    />
  </label>
);

export default function Forms({ user, logout }) {
  const { showToast } = useToast();
  const [forms, setForms] = useState([]);
  const [form, setForm] = useState(defaultForm);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingLink, setSendingLink] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState("editor");
  const [submissions, setSubmissions] = useState([]);
  const [submissionsLoading, setSubmissionsLoading] = useState(false);
  const [discordUser, setDiscordUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("discordUser") || "null");
    } catch {
      return null;
    }
  });
  const [discordSession, setDiscordSession] = useState(
    () => localStorage.getItem("discordSession") || "",
  );
  const [guilds, setGuilds] = useState([]);
  const [guildSetup, setGuildSetup] = useState({ channels: [], roles: [] });
  const [discordLoading, setDiscordLoading] = useState(false);
  const [discordError, setDiscordError] = useState("");
  const [botInviteUrl, setBotInviteUrl] = useState("");
  const guildSetupCooldownRef = useRef({ until: 0, guildId: "" });
  const guildSetupInFlightRef = useRef({ guildId: "", promise: null });
  const discordGuildsInFlightRef = useRef(null);
  const discordAuthFailedRef = useRef(false);
  const [showTutorial, setShowTutorial] = useState(false);

  useEffect(() => {
    const hasSeen = localStorage.getItem("hasSeenFormsTutorial");
    if (!hasSeen) {
      setShowTutorial(true);
    }
  }, []);

  const closeTutorial = () => {
    localStorage.setItem("hasSeenFormsTutorial", "true");
    setShowTutorial(false);
  };

  const token = localStorage.getItem("token");
  const applyLink = useMemo(
    () => (form.slug ? `${window.location.origin}/apply/${form.slug}` : ""),
    [form.slug],
  );
  const selectedGuild = useMemo(
    () => guilds.find((guild) => guild.id === form.guildId) || null,
    [guilds, form.guildId],
  );
  const botReadyForServer = Boolean(selectedGuild?.botPresent);
  const requiresAccount = () => {
    showToast("Create an account or log in to save and manage forms.", "error");
  };

  useEffect(() => {
    if (!user || !token) {
      setLoading(false);
      return;
    }
    loadForms();
  }, [user]);

  useEffect(() => {
    if (user?.id && token && discordSession && form.guildId && botReadyForServer) {
      loadGuildSetup(form.guildId);
    } else {
      setGuildSetup({ channels: [], roles: [] });
    }
  }, [form.guildId, discordSession, botReadyForServer]);

  useEffect(() => {
    if (activeTab === "submissions" && selectedId && token) {
      loadSubmissions(selectedId);
    }
  }, [activeTab, selectedId, token]);

  const loadForms = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/forms/mine`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load forms");
      setForms(data);
      if (data[0]) {
        setSelectedId(data[0].id);
        setForm(data[0]);
      }
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const updateForm = (patch) =>
    setForm((current) => ({ ...current, ...patch }));

  const selectForm = (item) => {
    setSelectedId(item.id);
    setForm(item);
    setActiveTab("editor");
  };

  const newForm = () => {
    setSelectedId(null);
    setForm({
      ...defaultForm,
      questions: defaultForm.questions.map((q) => ({
        ...q,
        id: `q_${crypto.randomUUID().slice(0, 8)}`,
      })),
    });
    setActiveTab("editor");
  };

  const duplicateForm = async () => {
    if (!selectedId || !token) {
      showToast("Save the form before duplicating it.", "error");
      return;
    }
    setDuplicating(true);
    try {
      const res = await fetch(`${API_URL}/api/forms/${selectedId}/duplicate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to duplicate form");
      setForms((current) => [data, ...current]);
      setSelectedId(data.id);
      setForm(data);
      setActiveTab("editor");
      showToast("Form duplicated", "success");
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setDuplicating(false);
    }
  };

  const loadSubmissions = async (id = selectedId) => {
    if (!id || !token) return;
    setSubmissionsLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/forms/${id}/submissions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load submissions");
      setSubmissions(data);
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setSubmissionsLoading(false);
    }
  };

  const updateSubmission = async (submissionId, patch) => {
    const item = submissions.find((submission) => submission.id === submissionId);
    if (!item || !selectedId || !token) return;
    const next = { ...item, ...patch };
    setSubmissions((current) =>
      current.map((submission) =>
        submission.id === submissionId ? next : submission,
      ),
    );
    try {
      const res = await fetch(
        `${API_URL}/api/forms/${selectedId}/submissions/${submissionId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            status: next.status,
            reviewerNote: next.reviewerNote,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update submission");
      setSubmissions((current) =>
        current.map((submission) =>
          submission.id === submissionId ? { ...submission, ...data } : submission,
        ),
      );
    } catch (e) {
      showToast(e.message, "error");
      loadSubmissions();
    }
  };

  const updateQuestion = (index, patch) => {
    const questions = [...form.questions];
    questions[index] = { ...questions[index], ...patch };
    updateForm({ questions });
  };

  const saveForm = async () => {
    if (!token) {
      requiresAccount();
      return;
    }
    setSaving(true);
    try {
      const endpoint = selectedId
        ? `${API_URL}/api/forms/${selectedId}`
        : `${API_URL}/api/forms`;
      const res = await fetch(endpoint, {
        method: selectedId ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save form");
      setSelectedId(data.id);
      setForm(data);
      setForms((current) => {
        const exists = current.some((item) => item.id === data.id);
        return exists
          ? current.map((item) => (item.id === data.id ? data : item))
          : [data, ...current];
      });
      showToast("Form saved", "success");
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const deleteForm = async (id) => {
    if (!token) {
      requiresAccount();
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`${API_URL}/api/forms/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete form");
      setForms((current) => current.filter((item) => item.id !== id));
      if (selectedId === id) {
        setSelectedId(null);
        setForm({
          ...defaultForm,
          questions: defaultForm.questions.map((q) => ({
            ...q,
            id: `q_${crypto.randomUUID().slice(0, 8)}`,
          })),
        });
      }
      showToast("Form deleted", "success");
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setDeleting(false);
    }
  };

  const copyApplyLink = () => {
    if (!applyLink) return;
    navigator.clipboard.writeText(applyLink);
    setCopied(true);
    showToast("Application link copied", "success");
    setTimeout(() => setCopied(false), 1800);
  };

  const sendApplyLink = async () => {
    if (!selectedId || !token) {
      showToast(
        token
          ? "Save the form before sending it"
          : "Log in to save and send application links.",
        "error",
      );
      return;
    }
    setSendingLink(true);
    try {
      const res = await fetch(`${API_URL}/api/forms/${selectedId}/send-link`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error || "Failed to send application link");
      showToast("Application link sent by the bot", "success");
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setSendingLink(false);
    }
  };

  const connectDiscord = async () => {
    if (!token) {
      showToast("Log in before connecting Discord for form setup.", "error");
      return;
    }
    discordAuthFailedRef.current = false;
    try {
      const res = await fetch(
        `${API_URL}/api/discord/login-url?returnTo=${encodeURIComponent("/forms")}&frontendOrigin=${encodeURIComponent(window.location.origin)}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Discord login is not ready");
      window.location.href = data.url;
    } catch (e) {
      setDiscordError(e.message);
      showToast(e.message, "error");
    }
  };

  const disconnectDiscord = () => {
    localStorage.removeItem("discordSession");
    localStorage.removeItem("discordUser");
    setDiscordSession("");
    setDiscordUser(null);
    setGuilds([]);
    setGuildSetup({ channels: [], roles: [] });
  };

  const clearDiscordAuth = () => {
    discordAuthFailedRef.current = true;
    localStorage.removeItem("discordSession");
    localStorage.removeItem("discordUser");
    setDiscordSession("");
    setDiscordUser(null);
    setGuilds([]);
    setGuildSetup({ channels: [], roles: [] });
  };

  const loadDiscordGuilds = async () => {
    if (discordAuthFailedRef.current) return;
    if (!user?.id || !token) {
      setDiscordError("Log in before loading Discord servers.");
      return;
    }
    if (!discordSession) {
      setDiscordError("Connect Discord before loading servers.");
      return;
    }
    if (isJwtExpired(discordSession)) {
      clearDiscordAuth();
      setDiscordError("Your Discord connection expired. Connect Discord again.");
      return;
    }
    if (discordGuildsInFlightRef.current) {
      return await discordGuildsInFlightRef.current;
    }
    setDiscordLoading(true);
    setDiscordError("");
    const request = (async () => {
    try {
      const res = await fetch(`${API_URL}/api/discord/guilds`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Discord-Session": discordSession,
        },
      });
      const data = await res.json();
      if (data.discordExpired) {
        clearDiscordAuth();
        setDiscordError("Your Discord connection expired. Connect Discord again.");
        setGuilds([]);
        setBotInviteUrl(data.botInviteUrl || "");
        return;
      }
      if (res.status === 401) {
        const isAppAuthError = ["No token", "Invalid token"].includes(data.error);
        if (isAppAuthError) {
          setDiscordError("Your CUTR login expired. Log in again before connecting Discord.");
        } else {
          clearDiscordAuth();
          setDiscordError("Your Discord connection expired. Connect Discord again.");
        }
        return;
      }
      if (!res.ok)
        throw new Error(data.error || "Failed to load Discord servers");
      setGuilds(data.guilds || []);
      setBotInviteUrl(data.botInviteUrl || "");
    } catch (e) {
      setDiscordError(e.message);
      setGuilds([]);
      setBotInviteUrl("");
    } finally {
      setDiscordLoading(false);
      discordGuildsInFlightRef.current = null;
    }
    })();
    discordGuildsInFlightRef.current = request;
    return await request;
  };

  const loadGuildSetup = async (guildId) => {
    if (!guildId || !discordSession) return;

    const now = Date.now();
    if (
      guildSetupCooldownRef.current.guildId === guildId &&
      guildSetupCooldownRef.current.until > now
    ) {
      return;
    }
    if (
      guildSetupInFlightRef.current.guildId === guildId &&
      guildSetupInFlightRef.current.promise
    ) {
      return await guildSetupInFlightRef.current.promise;
    }

    setDiscordLoading(true);
    setDiscordError("");
    const request = async () => {
      return await fetch(`${API_URL}/api/discord/guilds/${guildId}/setup`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Discord-Session": discordSession,
        },
      });
    };

    const runner = (async () => {
      try {
        let res = await request();
        let data = await res.json().catch(() => ({}));

        if (res.status === 429) {
          const retryAfter = Number(res.headers.get("Retry-After") || 1) || 1;
          guildSetupCooldownRef.current = {
            until: Date.now() + retryAfter * 1000,
            guildId,
          };
          await new Promise((r) =>
            setTimeout(r, Math.min(1500, retryAfter * 1000)),
          );
          res = await request();
          data = await res.json().catch(() => ({}));
        }

        if (!res.ok)
          throw new Error(data.error || "Failed to load Discord server setup");
        setGuildSetup({
          channels: data.channels || [],
          roles: data.roles || [],
        });
      } catch (e) {
        if (e.message === "Connect Discord first.") {
          clearDiscordAuth();
          setDiscordError("Your Discord connection expired. Connect Discord again.");
        } else {
          setDiscordError(e.message);
        }
        setGuildSetup({ channels: [], roles: [] });
      } finally {
        setDiscordLoading(false);
        guildSetupInFlightRef.current = { guildId: "", promise: null };
      }
    })();

    guildSetupInFlightRef.current = { guildId, promise: runner };
    return await runner;
  };

  return (
    <div className="obsidian-ui min-h-screen text-white selection:bg-white/15">
      <MainNav user={user} logout={logout} />

      <main className="max-w-5xl mx-auto px-4 py-4 grid gap-4 lg:grid-cols-[220px_1fr]">
        <aside id="sidebar-forms" className="space-y-3">
          <button
            id="new-form-btn"
            onClick={newForm}
            className="w-full h-9 rounded-full bg-slate-100 text-slate-950 text-xs font-semibold flex items-center justify-center gap-2 shadow-lg shadow-black/30 active:scale-[0.98] transition-all hover:bg-white"
          >
            <Plus size={16} />
            New Form
          </button>

          <div className="space-y-1.5">
            <p className="px-2 text-[9px] font-semibold uppercase tracking-widest text-white/30">
              Your Forms
            </p>
            {!user ? (
              <div className="px-2 py-4 text-sm text-white/20 italic">
                Saved forms appear here after login.
              </div>
            ) : loading ? (
              <div className="px-2 py-4 text-sm text-white/20 animate-pulse">
                Loading forms...
              </div>
            ) : forms.length === 0 ? (
              <div className="px-2 py-4 text-sm text-white/20 italic">
                No forms yet.
              </div>
            ) : (
              <div className="space-y-1">
                {forms.map((item) => (
                  <div
                    key={item.id}
                    className={`group flex items-center gap-2 rounded-xl px-3 py-2.5 transition-all duration-200 ${selectedId === item.id ? "bg-white/[0.06] border border-white/10 shadow-[0_18px_40px_rgba(0,0,0,0.35)]" : "bg-transparent border border-transparent hover:bg-white/[0.035]"}`}
                  >
                    <button
                      onClick={() => selectForm(item)}
                      className="flex-1 text-left min-w-0"
                    >
                      <div className="flex items-center gap-2">
                        <div 
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            item.isOpen ? "bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.5)]" : "bg-red-400/50"
                          }`}
                        />
                        <p
                          className={`text-sm font-semibold truncate ${selectedId === item.id ? "text-white" : "text-white/60 group-hover:text-white/80"}`}
                        >
                          {item.name}
                        </p>
                      </div>
                      <p className="text-[10px] font-medium text-white/30 group-hover:text-white/40 ml-3.5">
                        {item.pendingCount || 0} pending •{" "}
                        {item.submissionCount || 0} total
                      </p>
                    </button>
                    {user && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteForm(item.id);
                        }}
                        disabled={deleting}
                        className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-white/10 hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                        title="Delete form"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        <section className="space-y-3.5">
          {!user && (
            <div className="glass rounded-[22px] p-3.5 border border-white/5 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-white/50">
                You can view and draft a form without an account. Log in to save
                it, connect Discord, and publish application links.
              </p>
              <Link
                to="/register"
                className="h-8 px-3 rounded-xl bg-white text-black text-[10px] font-semibold inline-flex items-center justify-center hover:opacity-90 transition-all"
              >
                Create Account
              </Link>
            </div>
          )}

          <div className="glass rounded-[22px] p-2 border border-white/5 flex flex-wrap items-center justify-between gap-2">
            <div id="tabs-nav" className="flex rounded-full bg-black/25 p-1 border border-white/5">
              {[
                ["editor", "Editor"],
                ["preview", "Preview"],
                ["submissions", "Submissions"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`h-8 px-4 rounded-full text-[11px] font-semibold transition-all ${activeTab === key ? "bg-white text-black" : "text-white/45 hover:text-white"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={duplicateForm}
              disabled={!selectedId || duplicating}
              className="h-8 px-3 rounded-full bg-white/5 border border-white/10 text-[10px] font-semibold text-white/60 hover:text-white hover:bg-white/10 transition-all disabled:opacity-30 flex items-center gap-1.5"
            >
              {duplicating ? <Loader2 size={12} className="animate-spin" /> : <Copy size={12} />}
              Duplicate
            </button>
          </div>

          {activeTab === "editor" && (
            <>
          <div id="form-settings" className="glass rounded-[22px] p-4 border border-white/5 transition-all">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="space-y-0.5">
                <h1 className="text-lg font-semibold tracking-tight">
                  Form Settings
                </h1>
                <p className="text-[11px] text-white/40 font-medium italic">
                  Manage submission workflow and Discord settings.
                </p>
              </div>
              <button
                onClick={saveForm}
                disabled={saving}
                className="h-8 px-4 rounded-full bg-white text-black text-[11px] font-semibold shadow-md active:scale-[0.98] transition-all flex items-center gap-1.5 disabled:opacity-40"
              >
                {saving ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Save size={14} />
                )}
                {user ? "Save" : "Sign in to save"}
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Field
                label="Display Name"
                value={form.name}
                onChange={(value) => {
                  const generated = value
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-+|-+$/g, "");
                  updateForm({
                    name: value,
                    slug: generated,
                  });
                }}
              />
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Field
                    label="Form link slug"
                    help="Your form will be available at cutrr.xyz/apply/your-slug"
                    value={form.slug}
                    onChange={(value) =>
                      updateForm({
                        slug: value
                          .toLowerCase()
                          .replace(/[^a-z0-9-]/g, "-")
                          .replace(/-+/g, "-"),
                      })
                    }
                    placeholder="e.g., vfx-application"
                  />
                </div>
                <button
                  onClick={copyApplyLink}
                  className="h-10 w-10 flex items-center justify-center rounded-xl bg-white/5 border border-white/10 text-white/40 hover:text-white hover:bg-white/10 transition-all mb-[1px]"
                  title="Copy application link"
                >
                  <Copy size={16} />
                </button>
              </div>
            </div>

            <div className="mt-4">
              <label className="block text-[9px] font-semibold uppercase tracking-widest text-white/30 mb-1.5 px-1">
                Description
              </label>
              <textarea
                value={form.description}
                onChange={(e) => updateForm({ description: e.target.value })}
                placeholder="Briefly describe what this application is for..."
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-3 py-2.5 text-xs text-white placeholder-white/20 resize-none focus:outline-none focus:ring-2 focus:ring-white/10 transition-all"
                rows={2}
              />
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <ToggleField
                label="Accepting"
                help="Turn this off to close the form immediately without deleting it."
                checked={form.isOpen}
                onChange={(value) => updateForm({ isOpen: value })}
              />
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Field
                label="Open at"
                help="Leave blank if the form should open right away."
                type="datetime-local"
                value={toInputDateTime(form.openAt)}
                onChange={(value) => updateForm({ openAt: value })}
              />
              <Field
                label="Close at"
                help="Leave blank if the form should stay open until you close it manually."
                type="datetime-local"
                value={toInputDateTime(form.closeAt)}
                onChange={(value) => updateForm({ closeAt: value })}
              />
              <Field
                label="Submission limit"
                help="Use 0 for unlimited submissions. Any other number closes the form after that many submissions."
                type="number"
                value={form.submissionLimit}
                onChange={(value) => updateForm({ submissionLimit: value })}
              />
              <Field
                label="Max file size MB"
                help="CUTR is capped at 100MB site-wide. Lower this if you want this specific form to be stricter."
                type="number"
                value={form.maxFileSizeMb}
                min="1"
                max="100"
                onChange={(value) =>
                  updateForm({
                    maxFileSizeMb: Math.max(
                      1,
                      Math.min(100, Number(value) || 100),
                    ),
                  })
                }
              />
              <Field
                label="Spam cooldown hours"
                help="Blocks the same applicant from submitting again for this many hours. Use 0 to disable."
                type="number"
                value={form.antiSpamCooldownHours}
                onChange={(value) =>
                  updateForm({ antiSpamCooldownHours: value })
                }
              />
              <ToggleField
                label="One submission"
                help="When on, each Discord applicant can submit this form once."
                checked={form.oneSubmissionPerUser}
                onChange={(value) => updateForm({ oneSubmissionPerUser: value })}
              />
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-[1fr_120px]">
              <Field
                label="Banner URL"
                help="Optional image shown at the top. Recommended: 1200x400 (3:1 ratio). Tip: You can use direct links from Imgur to host your images!"
                value={form.bannerUrl}
                onChange={(value) => updateForm({ bannerUrl: value })}
              />
              <Field
                label="Accent color"
                help="Optional color used for small visual accents on the application form."
                type="color"
                value={form.accentColor || "#ffffff"}
                onChange={(value) => updateForm({ accentColor: value })}
              />
            </div>

            <p className="mt-2 px-1 text-[10px] text-white/30">
              Blank schedule fields mean always available. Submission limit 0
              means unlimited. Video uploads are capped at 100MB across CUTR.
            </p>

            <div className="mt-4">
              <label className="block text-[9px] font-semibold uppercase tracking-widest text-white/30 mb-1.5 px-1">
                Success message
              </label>
              <textarea
                value={form.successMessage || ""}
                onChange={(e) => updateForm({ successMessage: e.target.value })}
                placeholder="Thanks, your application is in review."
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-3 py-2.5 text-xs text-white placeholder-white/20 resize-none focus:outline-none focus:ring-2 focus:ring-white/10 transition-all"
                rows={2}
              />
            </div>
          </div>

          <div id="discord-integration" className="glass rounded-[22px] p-4 border border-white/5 transition-all">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="space-y-0.5">
                <h2 className="text-base font-semibold tracking-tight">
                  Discord Integration
                </h2>
                <p className="text-[11px] text-white/40 font-medium">
                  Select the destination for reviews and roles.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {discordUser ? (
                  <div className="flex items-center gap-2 px-2 py-1.5 rounded-full bg-white/5 border border-white/10">
                    <img
                      src={
                        discordUser.avatar
                          ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png?size=64`
                          : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(discordUser.id || 0) >> 22n) % 6}.png`
                      }
                      alt={discordUser.username}
                      className="w-6 h-6 rounded-full ring-1 ring-white/10 shadow-lg"
                    />
                    <div className="w-[1px] h-3 bg-white/10" />
                    <button
                      onClick={loadDiscordGuilds}
                      className="text-white/40 hover:text-white transition-colors"
                      title="Refresh"
                    >
                      <RefreshCw
                        size={14}
                        className={discordLoading ? "animate-spin" : ""}
                      />
                    </button>
                    <button
                      onClick={disconnectDiscord}
                      className="text-[10px] font-bold uppercase tracking-widest text-red-400/60 hover:text-red-400 transition-colors"
                    >
                      Sign Out
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={connectDiscord}
                    className="h-8 px-4 rounded-full bg-[#5865F2] text-white text-[11px] font-semibold shadow-[0_10px_20px_rgba(88,101,242,0.2)] hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center gap-1.5"
                  >
                    <LogIn size={16} />
                    Connect Discord
                  </button>
                )}
                <a
                  href="https://discord.com/oauth2/authorize?client_id=1503322828643242076&permissions=8&integration_type=0&scope=bot+applications.commands"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-8 px-4 rounded-full bg-white/5 border border-white/10 text-white text-[11px] font-semibold hover:bg-white/10 active:scale-[0.98] transition-all inline-flex items-center gap-1.5"
                >
                  <ExternalLink size={14} />
                  Invite Bot
                </a>
              </div>
            </div>

            {discordError && (
              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs font-medium text-red-300 mb-6">
                {discordError}
              </div>
            )}

            {discordUser && guilds.length > 0 ? (
              <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <SelectField
                    label="Server"
                    value={form.guildId}
                    onChange={(value) =>
                      updateForm({
                        guildId: value,
                        channelId: "",
                        panelChannelId: "",
                        acceptedRoleId: "",
                        pingRoleId: "",
                        reviewerRoleId: "",
                      })
                    }
                    options={guilds.map((guild) => ({
                      value: guild.id,
                      label: guild.botPresent
                        ? guild.name
                        : `${guild.name} - invite bot`,
                    }))}
                    placeholder="Choose server"
                  />
                  {selectedGuild && !selectedGuild.botPresent && (
                    <div className="rounded border border-yellow-400/20 bg-yellow-400/10 px-3 py-2">
                      <p className="text-xs text-yellow-100 mb-2">
                        The bot is not in this server yet.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <a
                          href={selectedGuild.inviteUrl || botInviteUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="h-8 px-3 rounded bg-white text-black text-xs font-medium inline-flex items-center gap-1"
                        >
                          <ExternalLink size={13} />
                          Invite bot
                        </a>
                        <button
                          onClick={loadDiscordGuilds}
                          className="h-8 px-3 rounded bg-white/10 text-xs text-white/70 hover:text-white inline-flex items-center gap-1"
                        >
                          <RefreshCw
                            size={13}
                            className={discordLoading ? "animate-spin" : ""}
                          />
                          Refresh
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {botReadyForServer && (
                  <div className="grid gap-3 md:grid-cols-2">
                    <SelectField
                      label="Panel channel"
                      value={form.panelChannelId}
                      onChange={(value) =>
                        updateForm({ panelChannelId: value })
                      }
                      options={guildSetup.channels.map((channel) => ({
                        value: channel.id,
                        label: `#${channel.name}`,
                      }))}
                      placeholder="Choose where the panel sends"
                    />
                    <SelectField
                      label="Review channel"
                      value={form.channelId}
                      onChange={(value) => updateForm({ channelId: value })}
                      options={guildSetup.channels.map((channel) => ({
                        value: channel.id,
                        label: `#${channel.name}`,
                      }))}
                      placeholder="Choose channel"
                    />
                    <SelectField
                      label="Accepted role"
                      value={form.acceptedRoleId}
                      onChange={(value) =>
                        updateForm({ acceptedRoleId: value })
                      }
                      options={guildSetup.roles.map((role) => ({
                        value: role.id,
                        label: role.name,
                      }))}
                      placeholder="Choose role"
                    />
                    <SelectField
                      label="Reviewer role (can vote)"
                      value={form.reviewerRoleId}
                      onChange={(value) =>
                        updateForm({ reviewerRoleId: value })
                      }
                      options={guildSetup.roles.map((role) => ({
                        value: role.id,
                        label: role.name,
                      }))}
                      placeholder="Anyone can vote"
                      allowEmpty
                    />
                    <SelectField
                      label="Reminder ping role"
                      value={form.pingRoleId}
                      onChange={(value) => updateForm({ pingRoleId: value })}
                      options={guildSetup.roles.map((role) => ({
                        value: role.id,
                        label: role.name,
                      }))}
                      placeholder="No ping role"
                      allowEmpty
                    />
                  </div>
                )}
              </div>
            ) : discordUser ? (
              <div className="rounded border border-white/10 p-3 text-sm text-white/50 flex flex-wrap items-center justify-between gap-3">
                <span>
                  {discordLoading
                    ? "Loading Discord servers..."
                    : "Discord is connected. Load your servers when you are ready."}
                </span>
                <button
                  onClick={loadDiscordGuilds}
                  disabled={discordLoading}
                  className="h-8 px-3 rounded-full bg-white/10 text-xs font-semibold text-white/70 hover:bg-white/15 hover:text-white disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  <RefreshCw
                    size={13}
                    className={discordLoading ? "animate-spin" : ""}
                  />
                  Load Servers
                </button>
              </div>
            ) : (
              <div className="rounded border border-white/10 p-3 text-sm text-white/50">
                Connect Discord to choose a server and invite the bot.
              </div>
            )}
          </div>

          <div className="glass rounded-[22px] p-4 border border-white/5">
            <div className="space-y-0.5 mb-4">
              <h2 className="text-base font-semibold tracking-tight">
                Voting Protocol
              </h2>
              <p className="text-[11px] text-white/40 font-medium">
                Set thresholds and automated cooldowns.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <VoteField
                label="Accept"
                help="Reviewers react with this emoji. Once it reaches the threshold, the applicant is accepted."
                emoji={form.acceptEmoji}
                threshold={form.acceptThreshold}
                onEmoji={(value) => updateForm({ acceptEmoji: value })}
                onThreshold={(value) => updateForm({ acceptThreshold: value })}
              />
              <VoteField
                label="Deny"
                help="Reviewers react with this emoji. Once it reaches the threshold, the applicant is denied and gets the deny cooldown."
                emoji={form.denyEmoji}
                threshold={form.denyThreshold}
                onEmoji={(value) => updateForm({ denyEmoji: value })}
                onThreshold={(value) => updateForm({ denyThreshold: value })}
              />
              <VoteField
                label="Reapply"
                help="Reviewers react with this emoji when the applicant should try again after the reapply cooldown."
                emoji={form.reapplyEmoji}
                threshold={form.reapplyThreshold}
                onEmoji={(value) => updateForm({ reapplyEmoji: value })}
                onThreshold={(value) => updateForm({ reapplyThreshold: value })}
              />
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <Field
                label="Deny cooldown days"
                help="How long denied applicants must wait before applying again."
                type="number"
                value={form.denyCooldownDays}
                onChange={(value) => updateForm({ denyCooldownDays: value })}
              />
              <Field
                label="Reapply cooldown days"
                help="How long reapply decisions make applicants wait. This can be lower than 14 days now."
                type="number"
                value={form.reapplyCooldownDays}
                onChange={(value) =>
                  updateForm({
                    reapplyCooldownDays: value,
                  })
                }
              />
            </div>
          </div>

          <div id="questionnaire" className="glass rounded-[22px] p-6 border border-white/5">
            <div className="flex flex-col items-center justify-center text-center mb-8">
              <div className="space-y-1">
                <h2 className="text-lg font-bold tracking-tight">
                  Questionnaire
                </h2>
                <p className="text-[11px] text-white/30 font-medium">
                  Design the fields applicants fill out.
                </p>
              </div>
            </div>
            
            <div className="flex flex-col items-center">
              <div className="w-full max-w-2xl space-y-3">
                {form.questions.map((question, index) => (
                  <div
                    key={question.id}
                    className="rounded-2xl border border-white/5 bg-white/[0.02] p-4 space-y-3 transition-all hover:bg-white/[0.04]"
                  >
                    <div className="grid gap-3 md:grid-cols-[1fr_145px_100px_40px] items-start">
                      <div className="space-y-1.5">
                        <label className="text-[9px] font-semibold uppercase tracking-widest text-white/20 px-1">
                          Label
                        </label>
                        <input
                          value={question.label}
                          onChange={(e) =>
                            updateQuestion(index, { label: e.target.value })
                          }
                          placeholder="e.g., What is your Instagram?"
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-3 h-10 text-xs text-white focus:outline-none focus:ring-2 focus:ring-white/10 transition-all"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[9px] font-semibold uppercase tracking-widest text-white/20 px-1">
                          Type
                        </label>
                        <select
                          value={question.type}
                          onChange={(e) =>
                            updateQuestion(index, { type: e.target.value })
                          }
                          className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-3 h-10 text-xs text-white focus:outline-none focus:ring-2 focus:ring-white/10 transition-all"
                        >
                          <option value="text">Short</option>
                          <option value="textarea">Long</option>
                          <option value="true_false">True / false</option>
                          <option value="select">Options</option>
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <div className="h-[21px]" aria-hidden="true" />
                        <label className="flex w-full h-10 items-center justify-center gap-2 rounded-xl bg-white/[0.025] border border-white/5 px-2 text-[11px] leading-none text-white/50 cursor-pointer hover:bg-white/5 transition-all">
                          <input
                            type="checkbox"
                            checked={question.required}
                            onChange={(e) =>
                              updateQuestion(index, {
                                required: e.target.checked,
                              })
                            }
                            className="m-0 h-3.5 w-3.5 shrink-0 rounded border-white/20 bg-black/40 text-white focus:ring-0"
                          />
                          Required
                        </label>
                      </div>
                      <div className="space-y-1.5">
                        <div className="h-[21px]" aria-hidden="true" />
                        <button
                          onClick={() =>
                            updateForm({
                              questions: form.questions.filter(
                                (_, qIndex) => qIndex !== index,
                              ),
                            })
                          }
                          className="h-10 w-10 inline-flex items-center justify-center rounded-xl text-white/20 hover:text-red-400 hover:bg-red-400/10 transition-all"
                          title="Delete question"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                    {question.type === "select" && (
                      <input
                        value={(Array.isArray(question.options)
                          ? question.options
                          : []
                        ).join(", ")}
                        onChange={(e) =>
                          updateQuestion(index, {
                            options: e.target.value
                              .split(",")
                              .map((item) => item.trim())
                              .filter(Boolean),
                          })
                        }
                        placeholder="Options separated by commas"
                        className="w-full bg-black/20 border border-white/10 rounded-xl px-3 h-9 text-xs text-white focus:outline-none focus:border-white/30"
                      />
                    )}
                  </div>
                ))}
                
                <button
                  onClick={() =>
                    updateForm({
                      questions: [...form.questions, emptyQuestion()],
                    })
                  }
                  className="w-full h-10 rounded-xl bg-white text-black text-[11px] font-bold hover:opacity-90 active:scale-[0.99] transition-all flex items-center justify-center gap-2 shadow-lg shadow-white/5 mt-2"
                >
                  <Plus size={16} />
                  Add Field
                </button>
              </div>
            </div>
          </div>

          {applyLink && (
            <div className="glass rounded-[22px] p-3.5 border border-white/5 flex flex-wrap items-center justify-between gap-3 bg-white/[0.01]">
              <div className="min-w-0 space-y-0.5">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-white/30">
                  Share Link
                </p>
                <p className="text-[11px] font-medium text-white/40 truncate italic">
                  {applyLink}
                </p>
              </div>
              <div className="flex gap-2">
                <a
                  href={applyLink}
                  target="_blank"
                  rel="noreferrer"
                  className="h-8 w-8 rounded-xl bg-white/5 border border-white/10 inline-flex items-center justify-center hover:bg-white/10 transition-all"
                  title="Open"
                >
                  <ExternalLink size={14} className="text-white/60" />
                </a>
                <button
                  onClick={copyApplyLink}
                  className="h-8 px-3 rounded-xl bg-white/5 border border-white/10 text-[10px] font-semibold flex items-center gap-1.5 hover:bg-white/10 transition-all"
                >
                  {copied ? (
                    <Check size={12} className="text-green-400" />
                  ) : (
                    <Copy size={12} className="text-white/60" />
                  )}
                  {copied ? "Copied" : "Copy"}
                </button>
                <button
                  onClick={sendApplyLink}
                  disabled={sendingLink || !selectedId}
                  className="h-8 px-3 rounded-xl bg-white text-black text-[10px] font-semibold flex items-center gap-1.5 hover:opacity-90 transition-all disabled:opacity-40"
                >
                  {sendingLink ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Send size={12} />
                  )}
                  Discord
                </button>
              </div>
            </div>
          )}
            </>
          )}

          {activeTab === "preview" && <FormPreview form={form} />}

          {activeTab === "submissions" && (
            <SubmissionsPanel
              submissions={submissions}
              loading={submissionsLoading}
              onRefresh={() => loadSubmissions()}
              onUpdate={updateSubmission}
              selectedId={selectedId}
            />
          )}
        </section>
      </main>
      {showTutorial && (
        <GuidedTour 
          onComplete={closeTutorial} 
        />
      )}
    </div>
  );
}

function toInputDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 16);
}

function FormPreview({ form }) {
  return (
    <div className="glass rounded-[22px] border border-white/5 overflow-hidden">
      {form.bannerUrl && (
        <img
          src={form.bannerUrl}
          alt=""
          className="w-full h-44 object-cover"
        />
      )}
      <div className="p-5 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">
              {form.name || "Untitled application"}
            </h2>
            <p className="text-sm text-white/45 mt-1">
              {form.description || "Your form description will appear here."}
            </p>
          </div>
          <div
            className="h-10 w-10 rounded-full border border-white/10 grid place-items-center"
            style={{ backgroundColor: `${form.accentColor || "#ffffff"}22` }}
          >
            <Eye size={17} />
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <PreviewPill label={form.submissionLimit > 0 ? `${form.submissionLimit} max` : "Unlimited"} />
        </div>

        <div className="space-y-3">
          {form.requiresVideo && (
            <div className="rounded-xl border-2 border-dashed border-white/10 p-6 text-center text-sm text-white/35">
              Upload area preview
            </div>
          )}
          {(form.questions || []).map((question) => (
            <div key={question.id} className="space-y-1.5">
              <label className="text-xs font-bold text-white/60">
                {question.label || "Untitled question"}
              </label>
              <div className="h-10 rounded-xl bg-white/5 border border-white/10" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PreviewPill({ label }) {
  return (
    <div className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-semibold text-white/55 text-center">
      {label}
    </div>
  );
}

function SubmissionsPanel({ submissions, loading, onRefresh, onUpdate, selectedId }) {
  if (!selectedId) {
    return (
      <div className="glass rounded-[22px] p-8 border border-white/5 text-center text-sm text-white/35">
        Save or select a form to view submissions.
      </div>
    );
  }

  return (
    <div className="glass rounded-[22px] p-4 border border-white/5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">
            Submissions
          </h2>
          <p className="text-[11px] text-white/40">
            Review answers, add notes, and set decisions manually.
          </p>
        </div>
        <button
          onClick={onRefresh}
          className="h-8 px-3 rounded-full bg-white/5 border border-white/10 text-[10px] font-semibold text-white/60 hover:text-white flex items-center gap-1.5"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-white/25">
          Loading submissions...
        </div>
      ) : submissions.length === 0 ? (
        <div className="py-10 text-center text-sm text-white/25">
          No submissions yet.
        </div>
      ) : (
        <div className="space-y-3">
          {submissions.map((submission) => (
            <div
              key={submission.id}
              className="rounded-2xl border border-white/5 bg-white/[0.02] p-3 space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">
                    {submission.discordUsername || submission.discordUserId}
                  </p>
                  <p className="text-[10px] text-white/35">
                    {new Date(submission.submittedAt).toLocaleString()}
                  </p>
                </div>
                <span className="rounded-full bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white/60">
                  {submission.status}
                </span>
              </div>

              {submission.videoUrl && (
                <a
                  href={submission.videoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 px-3 rounded-xl bg-white/5 border border-white/10 text-[10px] font-semibold text-white/60 hover:text-white items-center gap-1.5"
                >
                  <ExternalLink size={12} />
                  Open video
                </a>
              )}

              <div className="grid gap-2">
                {(submission.answers || []).map((answer) => (
                  <div key={answer.id} className="rounded-xl bg-black/20 border border-white/5 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-white/30">
                      {answer.label}
                    </p>
                    <p className="text-xs text-white/70 mt-1 whitespace-pre-wrap">
                      {answer.value || "No answer"}
                    </p>
                  </div>
                ))}
              </div>

              <textarea
                value={submission.reviewerNote || ""}
                onChange={(e) =>
                  onUpdate(submission.id, { reviewerNote: e.target.value })
                }
                placeholder="Reviewer notes..."
                rows={2}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-white/20 resize-none focus:outline-none"
              />

              <div className="flex flex-wrap gap-2">
                {[
                  ["pending", "Pending"],
                  ["accept", "Accept"],
                  ["deny", "Deny"],
                  ["reapply", "Reapply"],
                ].map(([status, label]) => (
                  <button
                    key={status}
                    onClick={() => onUpdate(submission.id, { status })}
                    className={`h-8 px-3 rounded-xl text-[10px] font-semibold border transition-all ${submission.status === status ? "bg-white text-black border-white" : "bg-white/5 text-white/55 border-white/10 hover:text-white"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InfoHint({ text }) {
  return (
    <span className="group relative inline-flex h-[11px] w-[11px] shrink-0 items-center justify-center rounded-full border border-current text-white/35 transition-colors hover:text-white/70">
      <span className="absolute top-[2px] h-[1.5px] w-[1.5px] rounded-full bg-current" />
      <span className="absolute bottom-[2px] h-[4.5px] w-px rounded-full bg-current" />
      <span className="pointer-events-none absolute left-1/2 top-4 z-30 w-52 -translate-x-1/2 rounded-xl border border-white/10 bg-[#111] px-3 py-2 text-left text-[11px] font-medium leading-snug text-white/80 opacity-0 shadow-2xl shadow-black/50 transition-opacity group-hover:opacity-100">
        {text}
      </span>
    </span>
  );
}

function Field({ label, value, onChange, type = "text", min, max, help }) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-widest text-white/30 px-1 leading-none">
        <span>{label}</span>
        {help && <InfoHint text={help} />}
      </label>
      <input
        type={type}
        min={min}
        max={max}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white/5 border border-white/10 rounded-xl px-3 h-9 text-xs text-white placeholder-white/10 focus:outline-none transition-all"
        placeholder={`Enter ${label.toLowerCase()}...`}
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
  allowEmpty = false,
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[9px] font-semibold uppercase tracking-widest text-white/30 px-1">
        {label}
      </label>
      <select
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-3 h-9 text-xs text-white appearance-none focus:outline-none transition-all"
      >
        {(allowEmpty || !value) && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function VoteField({ label, emoji, threshold, onEmoji, onThreshold, help }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-3 space-y-2.5">
      <p className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-widest text-white/30 px-1 leading-none">
        <span>{label}</span>
        {help && <InfoHint text={help} />}
      </p>
      <div className="grid grid-cols-[60px_1fr] gap-2">
        <div className="space-y-1">
          <input
            value={emoji}
            onChange={(e) => onEmoji(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-2 h-8 text-xs text-white text-center focus:outline-none transition-all"
          />
        </div>
        <div className="space-y-1">
          <input
            type="number"
            min="1"
            max="25"
            value={threshold}
            onChange={(e) => onThreshold(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-3 h-8 text-xs text-white font-semibold tabular-nums focus:outline-none transition-all"
          />
        </div>
      </div>
    </div>
  );
}

const GuidedTour = ({ onComplete }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, height: 0 });
  
  const steps = [
    {
      target: "#new-form-btn",
      title: "Start Fresh",
      desc: "Click here to create a new application form. You can manage multiple forms for different roles or events.",
      placement: "right"
    },
    {
      target: "#form-settings",
      title: "Core Settings",
      desc: "This is where you define your form's identity. Set a clean display name and a unique URL slug.",
      placement: "bottom"
    },
    {
      target: "#discord-integration",
      title: "Discord Sync",
      desc: "Automate your workflow by connecting your server. Hook up channels to get instant pings when people apply.",
      placement: "top"
    },
    {
      target: "#questionnaire",
      title: "Build the Form",
      desc: "Add your custom questions here. Use our presets to instantly drop in standard editor-focused fields.",
      placement: "top"
    },
    {
      target: "#tabs-nav",
      title: "Preview & Review",
      desc: "Once you're done, use the tabs to preview your work or manage incoming submissions.",
      placement: "bottom"
    }
  ];

  const step = steps[currentStep];

  useEffect(() => {
    const update = () => {
      const el = document.querySelector(step.target);
      if (el) {
        const rect = el.getBoundingClientRect();
        setPos({
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height
        });
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update);
    };
  }, [currentStep, step.target]);

  return (
    <div className="fixed inset-0 z-[100] pointer-events-none overflow-hidden">
      {/* Overlay Mask (4-way to keep center clear of blur) */}
      <div className="absolute inset-0 bg-black/20">
        <div 
          className="absolute bg-black/40 backdrop-blur-[4px] transition-all duration-500" 
          style={{ top: 0, left: 0, right: 0, height: pos.top - 12 }} 
        />
        <div 
          className="absolute bg-black/40 backdrop-blur-[4px] transition-all duration-500" 
          style={{ top: pos.top + pos.height + 12, left: 0, right: 0, bottom: 0 }} 
        />
        <div 
          className="absolute bg-black/40 backdrop-blur-[4px] transition-all duration-500" 
          style={{ top: pos.top - 12, left: 0, width: pos.left - 12, height: pos.height + 24 }} 
        />
        <div 
          className="absolute bg-black/40 backdrop-blur-[4px] transition-all duration-500" 
          style={{ top: pos.top - 12, right: 0, left: pos.left + pos.width + 12, height: pos.height + 24 }} 
        />
      </div>

      {/* Focus Border */}
      <div 
        className="absolute border-2 border-white/30 rounded-[32px] transition-all duration-500 ease-in-out z-[101]"
        style={{
          top: pos.top - 12,
          left: pos.left - 12,
          width: pos.width + 24,
          height: pos.height + 24,
          boxShadow: '0 0 0 1000px rgba(0,0,0,0.1), 0 0 40px rgba(255,255,255,0.1)'
        }}
      >
        <div className="absolute inset-0 animate-pulse rounded-[30px] border border-white/20" />
      </div>

      {/* Floating Tooltip */}
      <div 
        className="absolute pointer-events-auto transition-all duration-500 ease-out flex flex-col gap-4 p-6 glass rounded-[28px] border border-white/20 shadow-[0_32px_64px_rgba(0,0,0,0.5)] max-w-xs animate-in fade-in zoom-in-95 slide-in-from-top-4"
        style={{
          top: step.placement === 'bottom' ? pos.top + pos.height + 32 : step.placement === 'top' ? pos.top - 32 : pos.top + 20,
          left: step.placement === 'right' ? pos.left + pos.width + 32 : pos.left + (pos.width / 2) - 160,
          transform: step.placement === 'top' ? 'translateY(-100%)' : 'none',
        }}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex gap-1">
            {steps.map((_, i) => (
              <div key={i} className={`h-1 rounded-full transition-all duration-500 ${currentStep === i ? 'w-4 bg-white' : 'w-1 bg-white/10'}`} />
            ))}
          </div>
          <button onClick={onComplete} className="h-6 w-6 rounded-full bg-white/5 flex items-center justify-center text-white/20 hover:text-white hover:bg-white/10 transition-all">
            <X size={12}/>
          </button>
        </div>
        
        <div>
          <h3 className="text-lg font-bold tracking-tight mb-1 text-white">{step.title}</h3>
          <p className="text-[13px] text-white/50 leading-relaxed font-medium">{step.desc}</p>
        </div>

        <div className="flex gap-2 pt-2">
          {currentStep > 0 && (
            <button 
              onClick={() => setCurrentStep(s => s - 1)}
              className="flex-1 h-10 rounded-2xl bg-white/5 border border-white/10 text-[11px] font-bold text-white hover:bg-white/10 transition-all active:scale-[0.98]"
            >
              Back
            </button>
          )}
          <button 
            onClick={() => {
              if (currentStep < steps.length - 1) setCurrentStep(s => s + 1);
              else onComplete();
            }}
            className="flex-[2] h-10 rounded-2xl bg-white text-black text-[11px] font-bold hover:scale-[1.02] active:scale-[0.98] transition-all shadow-[0_10px_25px_rgba(255,255,255,0.2)]"
          >
            {currentStep === steps.length - 1 ? "Finish Tour" : "Next Step"}
          </button>
        </div>
      </div>
    </div>
  );
}
