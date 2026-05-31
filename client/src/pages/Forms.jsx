import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Check,
  Copy,
  Eye,
  ExternalLink,
  FileText,
  GripVertical,
  Layers3,
  Loader2,
  LogIn,
  Plus,
  Rows3,
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

const createQuestionId = () => {
  const randomPart =
    globalThis.crypto?.randomUUID?.().slice(0, 8) ||
    Math.random().toString(36).slice(2, 10);
  return `q_${randomPart}`;
};

const emptyQuestion = () => ({
  id: createQuestionId(),
  label: "",
  type: "text",
  required: true,
  options: [],
});

const videoLinkQuestion = () => ({
  id: createQuestionId(),
  label: "Backup video link",
  type: "text",
  required: false,
  options: [],
});

const isVideoLinkQuestion = (question) =>
  /\bvideo\b/i.test(question?.label || "") && /\blink|url\b/i.test(question?.label || "");

const defaultForm = {
  name: "",
  slug: "",
  description: "",
  guildId: "",
  channelId: "",
  panelChannelId: "",
  acceptedRoleId: "",
  pingRoleId: "",
  pingRoleIds: [],
  reviewerRoleId: "",
  votingEnabled: true,
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
  reviewPanel: {
    messageText: "New application for **{{formName}}** submitted by {{applicantName}}.",
    embedTitle: "{{videoTitle}}",
    embedDescription: "[Open submitted video]({{videoUrl}})",
    accentColor: "#ffffff",
    imageUrl: "",
    thumbnailUrl: "",
    thumbnailSource: "custom",
    showLargeImage: false,
    showThumbnail: false,
    footerText: "React to vote: accept, deny, or reapply.",
    showApplicant: true,
    showAnswers: true,
    showVideoLink: true,
    applicationPanel: {
      messageText: "",
      embedTitle: "{{formName}}",
      embedDescription: "{{applicationUrl}}\n\n{{formDescription}}",
      accentColor: "#ffffff",
      imageUrl: "",
      thumbnailUrl: "",
      showLargeImage: false,
      showThumbnail: false,
      footerText: "CUTRR applications",
    },
  },
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
  <label className="min-h-9 rounded-xl bg-white/5 border border-white/10 px-3 py-2 flex items-center justify-between gap-3 cursor-pointer">
    <span className="flex min-w-0 flex-1 items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-white/45 leading-snug">
      <span className="min-w-0 flex-1 break-words">{label}</span>
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
  const [isPingRoleMenuOpen, setIsPingRoleMenuOpen] = useState(false);
  const [draggingQuestionId, setDraggingQuestionId] = useState("");
  const [dragOverQuestionId, setDragOverQuestionId] = useState("");
  const guildSetupCooldownRef = useRef({ until: 0, guildId: "" });
  const guildSetupInFlightRef = useRef({ guildId: "", promise: null });
  const discordGuildsInFlightRef = useRef(null);
  const discordAuthFailedRef = useRef(false);
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

  useEffect(() => {
    if (!draggingQuestionId) return undefined;
    const stopDragging = () => {
      setDraggingQuestionId("");
      setDragOverQuestionId("");
      document.body.style.userSelect = "";
    };
    document.body.style.userSelect = "none";
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("dragend", stopDragging);
    return () => {
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("dragend", stopDragging);
      document.body.style.userSelect = "";
    };
  }, [draggingQuestionId]);

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
    setForm((current) => {
      const next = { ...current, ...patch };
      if (Object.prototype.hasOwnProperty.call(patch, "accentColor")) {
        const currentPanel = current.reviewPanel || defaultForm.reviewPanel;
        next.reviewPanel = {
          ...currentPanel,
          accentColor: patch.accentColor || "#ffffff",
        };
      }
      return next;
    });

  const selectForm = (item) => {
    setSelectedId(item.id);
    setForm(item);
    setActiveTab("editor");
  };

  const newForm = () => {
    setSelectedId(null);
    setForm({
      ...defaultForm,
      reviewPanel: { ...defaultForm.reviewPanel },
      questions: defaultForm.questions.map((q) => ({
        ...q,
        id: createQuestionId(),
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
      if (data.roleGrantError) showToast(data.roleGrantError, "error");
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

  const moveQuestion = (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return;
    const questions = [...form.questions];
    const fromIndex = questions.findIndex((question) => question.id === fromId);
    const toIndex = questions.findIndex((question) => question.id === toId);
    if (fromIndex < 0 || toIndex < 0) return;
    const [moved] = questions.splice(fromIndex, 1);
    questions.splice(toIndex, 0, moved);
    updateForm({ questions });
  };

  const addVideoLinkQuestion = () => {
    const existingIndex = (form.questions || []).findIndex(isVideoLinkQuestion);
    if (existingIndex >= 0) {
      updateQuestion(existingIndex, { label: "Backup video link", required: false, type: "text" });
      showToast("Backup video link field is already on this form", "success");
      return;
    }
    updateForm({
      questions: [...form.questions, videoLinkQuestion()],
    });
    showToast("Backup video link field added", "success");
  };

  const saveForm = async () => {
    if (!token) {
      requiresAccount();
      return;
    }
    if (!discordSession || isJwtExpired(discordSession)) {
      showToast("Connect Discord before saving this form.", "error");
      if (discordSession && isJwtExpired(discordSession)) {
        clearDiscordAuth();
      }
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
          "X-Discord-Session": discordSession,
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
            id: createQuestionId(),
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
      const fetchGuilds = () =>
        fetch(`${API_URL}/api/discord/guilds`, {
          headers: {
            Authorization: `Bearer ${token}`,
            "X-Discord-Session": discordSession,
          },
        });
      let res = await fetchGuilds();
      let data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("Retry-After") || 1) || 1;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(2000, retryAfter * 1000)),
        );
        res = await fetchGuilds();
        data = await res.json().catch(() => ({}));
      }
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
          setDiscordError("Your CUTRR login expired. Log in again before connecting Discord.");
        } else {
          clearDiscordAuth();
          setDiscordError("Your Discord connection expired. Connect Discord again.");
        }
        return;
      }
      if (!res.ok)
        throw new Error(data.error || "Failed to load Discord servers");
      const nextGuilds = data.guilds || [];
      setGuilds(nextGuilds);
      setBotInviteUrl(data.botInviteUrl || "");
      if (nextGuilds.length === 0) {
        setDiscordError(
          data.totalGuilds > 0
            ? "No servers found where you have Manage Server permission."
            : "No Discord servers were found for this account.",
        );
      }
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
    <div className="forms-workspace obsidian-ui flex min-h-screen flex-col text-white selection:bg-white/15">
      <MainNav user={user} logout={logout} />

      <main className="flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-6xl">
          <div className="grid w-full min-w-0 grid-cols-1 gap-6 md:grid-cols-[220px_minmax(0,1fr)] lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside id="sidebar-forms" className="forms-rail space-y-4">
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
                          className={`min-w-0 text-sm font-semibold leading-snug break-words ${selectedId === item.id ? "text-white" : "text-white/60 group-hover:text-white/80"}`}
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

          <div className="forms-rail-section space-y-1.5">
            <p className="px-2 text-[9px] font-semibold uppercase tracking-widest text-white/30">
              Workspace
            </p>
            <div className="space-y-1">
              {[
                ["editor", "Editor", FileText],
                ["application-panel", "Application Panel", Send],
                ["review-panel", "Review Panel", Layers3],
                ["preview", "Preview", Eye],
                ["submissions", "Submissions", Rows3],
              ].map(([key, label, Icon]) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`forms-rail-link ${activeTab === key ? "is-active" : ""}`}
                >
                  <Icon size={14} strokeWidth={1.8} className="forms-rail-icon" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="forms-rail-section">
            <button
              onClick={duplicateForm}
              disabled={!selectedId || duplicating}
              className="forms-rail-action"
            >
              {duplicating ? <Loader2 size={12} className="animate-spin" /> : <Copy size={12} />}
              Duplicate form
            </button>
          </div>
          </aside>

          <section className="min-w-0 space-y-5">
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

          {activeTab === "editor" && (
            <>
          <div id="form-settings" className="glass rounded-[22px] p-5 border border-white/5 transition-all">
            <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
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
              <ToggleField
                label="Video required"
                help="Keep this on unless this application should allow submissions without an upload or backup video link."
                checked={form.requiresVideo}
                onChange={(value) => updateForm({ requiresVideo: value })}
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
                help="CUTRR is capped at 100MB site-wide. Lower this if you want this specific form to be stricter."
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
                label="One submission ever"
                help="Separate from spam cooldown. When on, each Discord applicant can only submit this form one time total."
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
                help="Controls the form accents and the Discord preview stripe."
                type="color"
                value={form.accentColor || "#ffffff"}
                onChange={(value) => updateForm({ accentColor: value })}
              />
            </div>

            <p className="mt-2 px-1 text-[10px] text-white/30">
              Blank schedule fields mean always available. Submission limit 0
              means unlimited. Video uploads are capped at 100MB across CUTRR.
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

          <div
            id="discord-integration"
            className={`glass relative rounded-[22px] p-4 border border-white/5 transition-all ${
              isPingRoleMenuOpen ? "z-30" : ""
            }`}
          >
            <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <div className="space-y-0.5">
                <h2 className="text-base font-semibold tracking-tight">
                  Discord Integration
                </h2>
                <p className="text-[11px] text-white/40 font-medium">
                  Select the destination for reviews and roles.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
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
                        pingRoleIds: [],
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
                    {form.votingEnabled !== false && (
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
                    )}
                    <MultiSelectField
                      label="Reminder ping roles"
                      values={form.pingRoleIds?.length ? form.pingRoleIds : form.pingRoleId ? [form.pingRoleId] : []}
                      onOpenChange={setIsPingRoleMenuOpen}
                      onChange={(values) =>
                        updateForm({
                          pingRoleIds: values,
                          pingRoleId: values[0] || "",
                        })
                      }
                      options={guildSetup.roles.map((role) => ({
                        value: role.id,
                        label: role.name,
                      }))}
                      placeholder="No reminder roles selected"
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
              <ToggleField
                label="Reaction voting"
                help="Turn this off to review submissions manually without Discord vote reactions."
                checked={form.votingEnabled !== false}
                onChange={(value) => updateForm({ votingEnabled: value })}
              />
            </div>
            {form.votingEnabled !== false && (
              <div className="mt-3 grid gap-3 md:grid-cols-3">
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
            )}
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

          <div id="questionnaire" className="glass rounded-[22px] border border-white/5 p-4 sm:p-6">
            <div className="mb-6 flex flex-col text-left sm:mb-8 sm:items-center sm:justify-center sm:text-center">
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
              <div className="w-full max-w-3xl space-y-3">
                <div className="rounded-2xl border border-[var(--warning-border)] bg-[var(--warning-bg)] p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1">
                      <p className="text-xs font-bold text-[var(--warning-text)]">
                        Backup video link question
                      </p>
                      <p className="text-[11px] leading-relaxed text-[var(--muted-text)]">
                        Add this as a backup for applicants whose upload fails. CUTRR uploads should work, and the extra link field only shows after a failed upload.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={addVideoLinkQuestion}
                      className="inline-flex h-11 items-center justify-center rounded-xl border border-[var(--warning-border)] bg-white/10 px-4 text-[11px] font-bold text-[var(--warning-text)] transition-all hover:bg-white/15 active:scale-[0.99]"
                    >
                      Add Backup Link Field
                    </button>
                  </div>
                </div>

                {form.questions.map((question, index) => (
                  <div
                    key={question.id}
                    draggable={draggingQuestionId === question.id}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", question.id);
                      setDraggingQuestionId(question.id);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverQuestionId(question.id);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      moveQuestion(e.dataTransfer.getData("text/plain"), question.id);
                      setDraggingQuestionId("");
                      setDragOverQuestionId("");
                    }}
                    onPointerEnter={() => {
                      if (draggingQuestionId && draggingQuestionId !== question.id) {
                        setDragOverQuestionId(question.id);
                        moveQuestion(draggingQuestionId, question.id);
                      }
                    }}
                    className={`space-y-3 rounded-2xl border p-3 transition-all sm:p-4 ${
                      draggingQuestionId === question.id
                        ? "scale-[0.99] opacity-60"
                        : dragOverQuestionId === question.id
                          ? "border-white/25 bg-white/[0.06]"
                          : "hover:bg-white/[0.04]"
                    } ${
                      isVideoLinkQuestion(question)
                        ? "border-yellow-300/15 bg-yellow-300/[0.055]"
                        : "border-white/5 bg-white/[0.02]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onPointerDown={() => setDraggingQuestionId(question.id)}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", question.id);
                          setDraggingQuestionId(question.id);
                        }}
                        draggable
                        className="inline-flex h-11 min-w-0 touch-none items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-[10px] font-bold uppercase tracking-widest text-white/45 transition-all hover:bg-white/10 hover:text-white/70"
                        title="Drag to reorder"
                        aria-label={`Drag field ${index + 1} to reorder`}
                      >
                        <GripVertical size={16} className="shrink-0" />
                        <span className="truncate">Field {index + 1}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateForm({
                            questions: form.questions.filter(
                              (_, qIndex) => qIndex !== index,
                            ),
                          })
                        }
                        className="grid h-11 w-11 place-items-center rounded-xl text-white/35 transition-all hover:bg-red-400/10 hover:text-red-400 lg:hidden"
                        title="Delete question"
                        aria-label="Delete question"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>

                    <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_150px] lg:grid-cols-[minmax(0,1fr)_155px_112px_44px]">
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
                          className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-base text-white transition-all focus:outline-none focus:ring-2 focus:ring-white/10 sm:text-xs"
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
                          className="h-11 w-full rounded-xl border border-white/10 bg-[#1a1a1a] px-3 text-base text-white transition-all focus:outline-none focus:ring-2 focus:ring-white/10 sm:text-xs"
                        >
                          <option value="text">Short</option>
                          <option value="textarea">Long</option>
                          <option value="true_false">True / false</option>
                          <option value="select">Options</option>
                        </select>
                      </div>
                      <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
                        <div className="hidden h-[21px] lg:block" aria-hidden="true" />
                        <label className="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/5 bg-white/[0.025] px-3 text-[11px] leading-none text-white/60 transition-all hover:bg-white/5">
                          <input
                            type="checkbox"
                            checked={question.required}
                            onChange={(e) =>
                              updateQuestion(index, {
                                required: e.target.checked,
                              })
                            }
                            className="m-0 h-4 w-4 shrink-0 rounded border-white/20 bg-black/40 text-white focus:ring-0"
                          />
                          Required
                        </label>
                      </div>
                      <div className="hidden space-y-1.5 lg:block">
                        <div className="h-[21px]" aria-hidden="true" />
                        <button
                          type="button"
                          onClick={() =>
                            updateForm({
                              questions: form.questions.filter(
                                (_, qIndex) => qIndex !== index,
                              ),
                            })
                          }
                          className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-white/20 transition-all hover:bg-red-400/10 hover:text-red-400"
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
                        className="h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-base text-white focus:outline-none focus:border-white/30 sm:text-xs"
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
                  className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-white text-[11px] font-bold text-black shadow-lg shadow-white/5 transition-all hover:opacity-90 active:scale-[0.99]"
                >
                  <Plus size={16} />
                  Add Field
                </button>
              </div>
            </div>
          </div>

          {applyLink && (
            <div className="glass rounded-[22px] p-3.5 border border-white/5 flex flex-col gap-3 bg-white/[0.01] sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-0.5">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-white/30">
                  Share Link
                </p>
                <p className="text-[11px] font-medium text-white/40 break-all italic">
                  {applyLink}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
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

          {activeTab === "application-panel" && (
            <ApplicationPanelEditor
              formName={form.name}
              formDescription={form.description}
              applyLink={applyLink}
              applicationPanel={
                form.reviewPanel?.applicationPanel ||
                defaultForm.reviewPanel.applicationPanel
              }
              onChange={(applicationPanel) =>
                updateForm({
                  reviewPanel: {
                    ...(form.reviewPanel || defaultForm.reviewPanel),
                    applicationPanel,
                  },
                })
              }
              onSave={saveForm}
              saving={saving}
              canSave={Boolean(user)}
            />
          )}

          {activeTab === "review-panel" && (
            <ReviewPanelEditor
              formName={form.name}
              discordUser={discordUser}
              formAccentColor={form.accentColor}
              reviewPanel={form.reviewPanel || defaultForm.reviewPanel}
              onChange={(reviewPanel) => updateForm({ reviewPanel })}
              onAccentChange={(accentColor) => updateForm({ accentColor })}
              onSave={saveForm}
              saving={saving}
              canSave={Boolean(user)}
            />
          )}

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
          </div>
        </div>
      </main>
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

const REVIEW_PANEL_TOKENS = [
  "{{applicantName}}",
  "{{formName}}",
  "{{videoTitle}}",
  "{{videoUrl}}",
];

const APPLICATION_PANEL_TOKENS = [
  "{{formName}}",
  "{{formDescription}}",
  "{{applicationUrl}}",
];

const DEFAULT_APPLICATION_PANEL = defaultForm.reviewPanel.applicationPanel;

const REVIEW_PANEL_SAMPLE = {
  applicantName: "@mika",
  formName: "Sample Form",
  videoTitle: "Velocity edit final.mp4",
  videoUrl: "https://cutrr.xyz/abc123",
};

const APPLICATION_PANEL_SAMPLE = {
  formName: "Sky",
  formDescription: "Submit your best edit for review.",
  applicationUrl: "https://cutrr.xyz/apply/sky",
};

function getDiscordAvatarUrl(discordUser, fallbackIndex = 0, size = 128) {
  const id = discordUser?.id || "";
  if (id && discordUser?.avatar) {
    const ext = String(discordUser.avatar).startsWith("a_") ? "gif" : "webp";
    return `https://cdn.discordapp.com/avatars/${id}/${discordUser.avatar}.${ext}?size=${size}`;
  }
  const index = id
    ? Number(BigInt(id) >> 22n) % 6
    : fallbackIndex;
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

function renderReviewPanelTemplate(value, sampleValues = REVIEW_PANEL_SAMPLE) {
  return String(value || "").replace(
    /\{\{(applicantName|formName|videoTitle|videoUrl|formDescription|applicationUrl)\}\}/g,
    (_, key) => sampleValues[key],
  );
}

function getDefaultApplicationDescription({ formDescription, applicationUrl }) {
  const description = String(formDescription || "").trim();
  const shouldAppendDescription =
    description &&
    description !== applicationUrl &&
    !/^apply\s+to\b/i.test(description);
  return `${applicationUrl}${shouldAppendDescription ? `\n\n${description}` : ""}`;
}

function ApplicationPanelEditor({
  formName,
  formDescription,
  applyLink,
  applicationPanel,
  onChange,
  onSave,
  saving,
  canSave,
}) {
  const panel = { ...DEFAULT_APPLICATION_PANEL, ...(applicationPanel || {}) };
  const previewRef = useRef(null);
  const [liveAccentColor, setLiveAccentColor] = useState(panel.accentColor || "#ffffff");
  const sampleValues = {
    formName: formName || APPLICATION_PANEL_SAMPLE.formName,
    formDescription: formDescription || APPLICATION_PANEL_SAMPLE.formDescription,
    applicationUrl: applyLink || APPLICATION_PANEL_SAMPLE.applicationUrl,
  };
  const update = (patch) => onChange({ ...panel, ...patch });
  const insertToken = (field, token) =>
    update({ [field]: `${panel[field] || ""}${token}` });
  const updateAccentColor = (value) => {
    const nextColor = value || "#ffffff";
    setLiveAccentColor(nextColor);
    if (previewRef.current) {
      previewRef.current
        .querySelector('[data-discord-preview-stripe="true"]')
        ?.style.setProperty("background-color", nextColor);
    }
  };
  const commitAccentColor = (value) => {
    update({ accentColor: value || liveAccentColor || "#ffffff" });
  };

  useEffect(() => {
    setLiveAccentColor(panel.accentColor || "#ffffff");
  }, [panel.accentColor]);

  const renderedContent = renderReviewPanelTemplate(panel.messageText, sampleValues);
  const renderedTitle = renderReviewPanelTemplate(panel.embedTitle, sampleValues);
  const renderedDescription =
    panel.embedDescription === DEFAULT_APPLICATION_PANEL.embedDescription
      ? getDefaultApplicationDescription(sampleValues)
      : renderReviewPanelTemplate(panel.embedDescription, sampleValues);
  const renderedFooter = renderReviewPanelTemplate(panel.footerText, sampleValues);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="glass rounded-[22px] border border-white/5 p-4 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold tracking-tight">
              Application Panel
            </h2>
            <p className="text-xs font-medium text-white/60">
              Customize the Discord message people click to open this application.
            </p>
          </div>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-full bg-white px-4 py-2 text-center text-xs font-semibold leading-snug text-black transition-all hover:bg-white/90 disabled:opacity-40"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {canSave ? "Save panel" : "Sign in to save"}
          </button>
        </div>

        <TextAreaField
          label="Message text"
          value={panel.messageText}
          onChange={(value) => update({ messageText: value })}
          rows={3}
        />
        <TokenRow tokens={APPLICATION_PANEL_TOKENS} onInsert={(token) => insertToken("messageText", token)} />

        <div className="grid gap-3 md:grid-cols-2">
          <ReviewPanelInput
            label="Embed title"
            value={panel.embedTitle}
            onChange={(value) => update({ embedTitle: value })}
          />
          <ReviewPanelInput
            label="Accent color"
            type="color"
            value={liveAccentColor}
            onChange={updateAccentColor}
            onCommit={commitAccentColor}
          />
        </div>
        <TokenRow tokens={APPLICATION_PANEL_TOKENS} onInsert={(token) => insertToken("embedTitle", token)} />

        <TextAreaField
          label="Embed description"
          value={panel.embedDescription}
          onChange={(value) => update({ embedDescription: value })}
          rows={3}
        />
        <TokenRow tokens={APPLICATION_PANEL_TOKENS} onInsert={(token) => insertToken("embedDescription", token)} />

        <div className="rounded-2xl border border-white/15 bg-white/[0.045] p-3 space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-white/80">
            Panel media
          </p>
          <ReviewPanelInput
            label="Large image URL"
            value={panel.imageUrl}
            onChange={(value) => update({ imageUrl: value })}
            emphasized
          />
          <ReviewPanelInput
            label="Thumbnail URL"
            value={panel.thumbnailUrl}
            onChange={(value) => update({ thumbnailUrl: value })}
            emphasized
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <ReviewPanelToggle
              label="Show large image"
              checked={panel.showLargeImage !== false && Boolean(panel.imageUrl)}
              onChange={(value) => update({ showLargeImage: value })}
            />
            <ReviewPanelToggle
              label="Show thumbnail"
              checked={panel.showThumbnail !== false && Boolean(panel.thumbnailUrl)}
              onChange={(value) => update({ showThumbnail: value })}
            />
          </div>
        </div>

        <ReviewPanelInput
          label="Footer text"
          value={panel.footerText}
          onChange={(value) => update({ footerText: value })}
        />
        <TokenRow tokens={APPLICATION_PANEL_TOKENS} onInsert={(token) => insertToken("footerText", token)} />
      </div>

      <div className="glass rounded-[22px] border border-white/5 p-4">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-white/55">
          Live Discord Preview
        </p>
        <div className="rounded-md bg-[#313338] p-3 text-[#dbdee1] shadow-2xl shadow-black/30">
          <div className="mb-2 flex items-center gap-2">
            <img
              src="/cutrr-bot-avatar.png"
              alt=""
              className="h-9 w-9 rounded-full object-cover"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-semibold text-white">
                  Cutrr <span className="rounded bg-[#5865f2] px-1 py-px text-[10px] font-bold text-white">APP</span>
                </p>
                <p className="text-[11px] text-[#949ba4]">12:47 PM</p>
              </div>
            </div>
          </div>
          {renderedContent && (
            <p className="mb-2 whitespace-pre-wrap text-sm leading-5">
              {renderedContent}
            </p>
          )}
          <div
            ref={previewRef}
            data-discord-preview-embed="true"
            className="relative overflow-hidden rounded border border-white/10 bg-[#111214] p-3 pl-4"
          >
            <div
              aria-hidden="true"
              data-discord-preview-stripe="true"
              className="absolute inset-y-0 left-0 w-1"
              style={{ backgroundColor: liveAccentColor }}
            />
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#5f8cff]">
                  {renderedTitle || sampleValues.formName}
                </p>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-5 text-[#dbdee1]">
                  {renderedDescription || sampleValues.applicationUrl}
                </p>
              </div>
              {panel.thumbnailUrl && panel.showThumbnail && (
                <img
                  src={panel.thumbnailUrl}
                  alt=""
                  className="h-12 w-12 rounded object-cover"
                />
              )}
            </div>
            {panel.imageUrl && panel.showLargeImage && (
              <img
                src={panel.imageUrl}
                alt=""
                className="mt-4 max-h-48 w-full rounded object-cover"
              />
            )}
            {renderedFooter && (
              <p className="mt-3 text-[11px] text-[#949ba4]">{renderedFooter}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReviewPanelEditor({
  formName,
  discordUser,
  formAccentColor,
  reviewPanel,
  onChange,
  onAccentChange,
  onSave,
  saving,
  canSave,
}) {
  const previewRef = useRef(null);
  const [liveAccentColor, setLiveAccentColor] = useState(
    formAccentColor || reviewPanel.accentColor || "#ffffff",
  );
  const update = (patch) => onChange({ ...reviewPanel, ...patch });
  const insertToken = (field, token) =>
    update({ [field]: `${reviewPanel[field] || ""}${token}` });
  const updateAccentColor = (value) => {
    const nextColor = value || "#ffffff";
    setLiveAccentColor(nextColor);
    if (previewRef.current) {
      previewRef.current
        .querySelector('[data-discord-preview-stripe="true"]')
        ?.style.setProperty("background-color", nextColor);
    }
  };
  const commitAccentColor = (value) => {
    onAccentChange(value || liveAccentColor || "#ffffff");
  };

  useEffect(() => {
    setLiveAccentColor(formAccentColor || reviewPanel.accentColor || "#ffffff");
  }, [formAccentColor, reviewPanel.accentColor]);

  const sampleValues = {
    ...REVIEW_PANEL_SAMPLE,
    formName: formName || REVIEW_PANEL_SAMPLE.formName,
  };
  const previewThumbnailUrl =
    reviewPanel.thumbnailSource === "applicant_avatar"
      ? getDiscordAvatarUrl(discordUser, 3)
      : reviewPanel.thumbnailUrl;
  const renderedContent = renderReviewPanelTemplate(
    reviewPanel.messageText,
    sampleValues,
  );
  const renderedTitle = renderReviewPanelTemplate(
    reviewPanel.embedTitle,
    sampleValues,
  );
  const renderedDescription = renderReviewPanelTemplate(
    reviewPanel.embedDescription,
    sampleValues,
  );
  const renderedFooter = renderReviewPanelTemplate(
    reviewPanel.footerText,
    sampleValues,
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="glass rounded-[22px] border border-white/5 p-4 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold tracking-tight">
              Review Panel
            </h2>
            <p className="text-xs font-medium text-white/60">
              Customize the Discord message reviewers see after a submission.
            </p>
          </div>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-full bg-white px-4 py-2 text-center text-xs font-semibold leading-snug text-black transition-all hover:bg-white/90 disabled:opacity-40"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {canSave ? "Save panel" : "Sign in to save"}
          </button>
        </div>

        <TextAreaField
          label="Message text"
          value={reviewPanel.messageText}
          onChange={(value) => update({ messageText: value })}
          rows={3}
        />
        <TokenRow onInsert={(token) => insertToken("messageText", token)} />

        <div className="grid gap-3 md:grid-cols-2">
          <ReviewPanelInput
            label="Embed title"
            value={reviewPanel.embedTitle}
            onChange={(value) => update({ embedTitle: value })}
          />
          <ReviewPanelInput
            label="Accent color"
            type="color"
            value={liveAccentColor}
            onChange={updateAccentColor}
            onCommit={commitAccentColor}
          />
        </div>
        <TokenRow onInsert={(token) => insertToken("embedTitle", token)} />

        <TextAreaField
          label="Embed description"
          value={reviewPanel.embedDescription}
          onChange={(value) => update({ embedDescription: value })}
          rows={3}
        />
        <TokenRow onInsert={(token) => insertToken("embedDescription", token)} />

        <div className="rounded-2xl border border-white/15 bg-white/[0.045] p-3 space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-white/80">
            Panel media
          </p>
          <ReviewPanelInput
            label="Large image URL"
            value={reviewPanel.imageUrl}
            onChange={(value) => update({ imageUrl: value })}
            emphasized
          />
          <div className="grid gap-3">
            <ReviewPanelInput
              label="Thumbnail URL"
              value={reviewPanel.thumbnailUrl}
              onChange={(value) => update({ thumbnailUrl: value })}
              emphasized
              disabled={reviewPanel.thumbnailSource === "applicant_avatar"}
            />
            <ReviewPanelThumbnailSource
              value={reviewPanel.thumbnailSource || "custom"}
              onChange={(value) => update({ thumbnailSource: value })}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <ReviewPanelToggle
                label="Show large image"
                checked={reviewPanel.showLargeImage !== false && Boolean(reviewPanel.imageUrl)}
                onChange={(value) => update({ showLargeImage: value })}
              />
              <ReviewPanelToggle
                label="Show thumbnail"
                checked={
                  reviewPanel.showThumbnail !== false &&
                  (reviewPanel.thumbnailSource === "applicant_avatar" ||
                    Boolean(reviewPanel.thumbnailUrl))
                }
                onChange={(value) => update({ showThumbnail: value })}
              />
            </div>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <ReviewPanelInput
            label="Footer text"
            value={reviewPanel.footerText}
            onChange={(value) => update({ footerText: value })}
          />
        </div>
        <TokenRow onInsert={(token) => insertToken("footerText", token)} />

        <div className="grid gap-3">
          <ReviewPanelToggle
            label="Show applicant"
            checked={reviewPanel.showApplicant !== false}
            onChange={(value) => update({ showApplicant: value })}
          />
          <ReviewPanelToggle
            label="Show answers"
            checked={reviewPanel.showAnswers !== false}
            onChange={(value) => update({ showAnswers: value })}
          />
          <ReviewPanelToggle
            label="Show video link"
            checked={reviewPanel.showVideoLink !== false}
            onChange={(value) => update({ showVideoLink: value })}
          />
        </div>
      </div>

      <div className="glass rounded-[22px] border border-white/5 p-4">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-white/55">
          Live Discord Preview
        </p>
        <div className="rounded-md bg-[#313338] p-3 text-[#dbdee1] shadow-2xl shadow-black/30">
          <div className="mb-2 flex items-center gap-2">
            <img
              src="/cutrr-bot-avatar.png"
              alt=""
              className="h-9 w-9 rounded-full object-cover"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-semibold text-white">
                  Cutrr <span className="rounded bg-[#5865f2] px-1 py-px text-[10px] font-bold text-white">APP</span>
                </p>
                <p className="text-[11px] text-[#949ba4]">12:47 PM</p>
              </div>
            </div>
          </div>
          <p className="mb-2 whitespace-pre-wrap text-sm leading-5">
            {renderedContent || "Message text preview"}
          </p>
          <div
            ref={previewRef}
            data-discord-preview-embed="true"
            className="relative overflow-hidden rounded border border-white/10 bg-[#111214] p-3 pl-4"
          >
            <div
              aria-hidden="true"
              data-discord-preview-stripe="true"
              className="absolute inset-y-0 left-0 w-1"
              style={{ backgroundColor: liveAccentColor }}
            />
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#5f8cff]">
                  {renderedTitle || "Application"}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-5 text-[#dbdee1]">
                  {reviewPanel.showVideoLink === false
                    ? renderedDescription || "Video link hidden"
                    : renderedDescription || "Description preview"}
                </p>
              </div>
              {previewThumbnailUrl && reviewPanel.showThumbnail && (
                <img
                  src={previewThumbnailUrl}
                  alt=""
                  className="h-12 w-12 rounded object-cover"
                />
              )}
            </div>
            <div className="mt-3 space-y-3">
              {reviewPanel.showApplicant !== false && (
                <PreviewField label="Submitted by" value="@mika" />
              )}
              {reviewPanel.showAnswers !== false && (
                <>
                  <PreviewField label="Answers" value={"What type of edit is this?\nAnime"} />
                  <PreviewField label="Anything reviewers should know?" value="No answer" />
                </>
              )}
            </div>
            {reviewPanel.imageUrl && reviewPanel.showLargeImage && (
              <img
                src={reviewPanel.imageUrl}
                alt=""
                className="mt-4 max-h-48 w-full rounded object-cover"
              />
            )}
            {renderedFooter && (
              <p className="mt-3 text-[11px] text-[#949ba4]">{renderedFooter}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TokenRow({ onInsert, tokens = REVIEW_PANEL_TOKENS }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tokens.map((token) => (
        <button
          key={token}
          type="button"
          onClick={() => onInsert(token)}
          className="min-h-8 rounded-full border border-white/15 bg-white/[0.08] px-3 py-1.5 text-[11px] font-semibold leading-snug text-white/80 hover:border-white/25 hover:bg-white/15 hover:text-white"
        >
          {token}
        </button>
      ))}
    </div>
  );
}

function TextAreaField({ label, value, onChange, rows = 3 }) {
  return (
    <div className="space-y-1.5">
      <label className="block px-1 text-[11px] font-semibold uppercase tracking-widest text-white/60">
        {label}
      </label>
      <textarea
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="w-full resize-none rounded-xl border border-white/15 bg-white/[0.07] px-3 py-2.5 text-sm text-white placeholder-white/30 focus:border-white/30 focus:outline-none"
      />
    </div>
  );
}

function ReviewPanelInput({
  label,
  value,
  onChange,
  onCommit,
  type = "text",
  emphasized = false,
  disabled = false,
}) {
  const handleInput = (event) => {
    onChange(event.target.value);
  };
  const handleCommit = (event) => {
    (onCommit || onChange)(event.target.value);
  };

  return (
    <div className="space-y-1.5">
      <label className={`block px-1 text-[11px] font-semibold uppercase tracking-widest ${
        emphasized ? "text-white/85" : "text-white/70"
      }`}>
        {label}
      </label>
      <input
        type={type}
        value={value || ""}
        onChange={type === "color" ? handleCommit : handleInput}
        onInput={type === "color" ? handleInput : undefined}
        disabled={disabled}
        className={`w-full rounded-xl border px-3 text-sm text-white placeholder-white/45 focus:outline-none disabled:cursor-not-allowed disabled:opacity-55 ${
          emphasized
            ? "border-white/25 bg-white/[0.1] focus:border-white/45"
            : "border-white/15 bg-white/[0.07] focus:border-white/30"
        } ${
          type === "color" ? "h-10 p-1.5" : "h-10"
        }`}
        placeholder={type === "text" ? `Enter ${label.toLowerCase()}...` : undefined}
      />
    </div>
  );
}

function ReviewPanelThumbnailSource({ value, onChange }) {
  return (
    <div className="space-y-1.5">
      <label className="block px-1 text-[11px] font-semibold uppercase tracking-widest text-white/85">
        Thumbnail source
      </label>
      <div className="grid min-h-10 grid-cols-2 rounded-xl border border-white/25 bg-white/[0.1] p-1">
        {[
          ["custom", "Custom URL"],
          ["applicant_avatar", "Applicant avatar"],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={`rounded-lg px-2 py-1 text-[11px] font-semibold leading-snug transition-all ${
              value === key
                ? "bg-white text-black"
                : "text-white/75 hover:bg-white/10 hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ReviewPanelToggle({ label, checked, onChange }) {
  return (
    <label className="grid min-h-12 grid-cols-[minmax(0,1fr)_18px] items-center gap-2 rounded-xl border border-white/15 bg-white/[0.07] px-3 cursor-pointer">
      <span className="min-w-0 pr-1 text-[11px] font-semibold uppercase tracking-widest leading-snug text-white/75">
        {label}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 justify-self-end rounded border-white/20 bg-black/40 text-white focus:ring-0"
      />
    </label>
  );
}

function PreviewField({ label, value }) {
  return (
    <div>
      <p className="text-xs font-semibold text-white">{label}</p>
      <p className="whitespace-pre-wrap text-sm text-[#dbdee1]">{value}</p>
    </div>
  );
}

function FormPreview({ form }) {
  return (
    <div className="glass overflow-hidden rounded-[22px] border border-white/5">
      {form.bannerUrl && (
        <img
          src={form.bannerUrl}
          alt=""
          className="w-full h-44 object-cover"
        />
      )}
      <div className="space-y-5 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3 sm:gap-4">
          <div className="min-w-0">
            <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
              {form.name || "Untitled application"}
            </h2>
            <p className="text-sm text-white/45 mt-1">
              {form.description || "Your form description will appear here."}
            </p>
            <div className="mt-3 inline-flex">
              <PreviewPill label={form.submissionLimit > 0 ? `${form.submissionLimit} max` : "Unlimited"} />
            </div>
          </div>
          <div
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/10"
            style={{ backgroundColor: `${form.accentColor || "#ffffff"}22` }}
          >
            <Eye size={17} />
          </div>
        </div>

        <div className="space-y-3">
          {form.requiresVideo && (
            <div className="rounded-xl border-2 border-dashed border-white/10 p-5 text-center text-sm text-white/35 sm:p-6">
              Upload area preview
            </div>
          )}
          {(form.questions || []).map((question) => (
            <div key={question.id} className="space-y-1.5">
              <label className="text-xs font-bold text-white/60">
                {question.label || "Untitled question"}
              </label>
              <div className="h-11 rounded-xl border border-white/10 bg-white/5" />
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">
            Submissions
          </h2>
          <p className="text-[11px] text-white/40">
            Review answers, add notes, and set decisions manually.
          </p>
        </div>
        <button
          onClick={onRefresh}
          className="touch-button flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 text-[10px] font-semibold text-white/60 hover:text-white"
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
                  className="touch-link inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 text-[10px] font-semibold text-white/60 hover:text-white"
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
                    className={`touch-button rounded-xl border px-3 text-[10px] font-semibold transition-all ${submission.status === status ? "bg-white text-black border-white" : "bg-white/5 text-white/55 border-white/10 hover:text-white"}`}
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
  const handleInput = (event) => {
    onChange(event.target.value);
  };

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
        onChange={handleInput}
        onInput={type === "color" ? handleInput : undefined}
        className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-base text-white placeholder-white/10 transition-all focus:outline-none sm:text-xs"
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
        className="h-11 w-full appearance-none rounded-xl border border-white/10 bg-[#1a1a1a] px-3 text-base text-white transition-all focus:outline-none sm:text-xs"
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

function MultiSelectField({
  label,
  values = [],
  onChange,
  onOpenChange,
  options,
  placeholder,
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const selectedOptions = values
    .map((value) => options.find((option) => option.value === value))
    .filter(Boolean);
  const availableOptions = options.filter(
    (option) => !values.includes(option.value),
  );

  useEffect(() => {
    onOpenChange?.(open);
  }, [onOpenChange, open]);

  useEffect(() => {
    const closeOnOutsideClick = (event) => {
      if (!wrapperRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  const addValue = (value) => {
    if (!value || values.includes(value)) return;
    onChange([...values, value]);
    setOpen(false);
  };

  const removeValue = (value) => {
    onChange(values.filter((item) => item !== value));
  };

  return (
    <div ref={wrapperRef} className={`relative space-y-1.5 ${open ? "z-30" : ""}`}>
      <label className="block text-[9px] font-semibold uppercase tracking-widest text-white/30 px-1">
        {label}
      </label>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-base text-white transition-all hover:bg-white/10 sm:text-xs"
      >
        <span className="min-w-0 break-words leading-snug text-white/70">
          {selectedOptions.length
            ? `${selectedOptions.length} role${selectedOptions.length === 1 ? "" : "s"} selected`
            : placeholder}
        </span>
        <span className={`text-white/35 transition-transform ${open ? "rotate-180" : ""}`}>
          v
        </span>
      </button>

      {selectedOptions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedOptions.map((option) => (
            <span
              key={option.value}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-white/10 bg-white/5 pl-2.5 pr-1 py-1 text-[11px] text-white/70"
            >
              <span className="min-w-0 break-words leading-snug">{option.label}</span>
              <button
                type="button"
                onClick={() => removeValue(option.value)}
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-white/35 hover:bg-white/10 hover:text-white"
                title={`Remove ${option.label}`}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-2 rounded-xl border border-white/10 bg-[#111] p-1 shadow-2xl shadow-black/50">
          {availableOptions.length === 0 ? (
            <p className="px-2 py-2 text-xs text-white/35">
              {options.length === 0 ? placeholder : "All roles selected"}
            </p>
          ) : (
            <div className="max-h-52 overflow-y-auto">
              {availableOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => addValue(option.value)}
                  className="block min-h-11 w-full rounded-lg px-2 py-2 text-left text-xs text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
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
            className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-2 text-center text-base text-white transition-all focus:outline-none sm:text-xs"
          />
        </div>
        <div className="space-y-1">
          <input
            type="number"
            min="1"
            max="25"
            value={threshold}
            onChange={(e) => onThreshold(e.target.value)}
            className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-base font-semibold tabular-nums text-white transition-all focus:outline-none sm:text-xs"
          />
        </div>
      </div>
    </div>
  );
}
