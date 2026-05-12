import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  LogIn,
  Plus,
  RefreshCw,
  Save,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { API_URL } from "../utils/api";
import { useToast } from "../contexts/ToastContext";

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

export default function Forms({ user }) {
  const { showToast } = useToast();
  const [forms, setForms] = useState([]);
  const [form, setForm] = useState(defaultForm);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingLink, setSendingLink] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState(false);
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

  useEffect(() => {
    if (!user || !token) {
      setLoading(false);
      return;
    }
    loadForms();
  }, [user]);

  useEffect(() => {
    if (user && token && discordSession) loadDiscordGuilds();
  }, [user, discordSession]);

  useEffect(() => {
    if (user && token && discordSession && form.guildId && botReadyForServer) {
      loadGuildSetup(form.guildId);
    } else {
      setGuildSetup({ channels: [], roles: [] });
    }
  }, [form.guildId, discordSession, botReadyForServer]);

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
  };

  const updateQuestion = (index, patch) => {
    const questions = [...form.questions];
    questions[index] = { ...questions[index], ...patch };
    updateForm({ questions });
  };

  const saveForm = async () => {
    if (!token) return;
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
    if (!token) return;
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
      showToast("Save the form before sending it", "error");
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

  const loadDiscordGuilds = async () => {
    setDiscordLoading(true);
    setDiscordError("");
    try {
      const res = await fetch(`${API_URL}/api/discord/guilds`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Discord-Session": discordSession,
        },
      });
      const data = await res.json();
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
    }
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
        setDiscordError(e.message);
        setGuildSetup({ channels: [], roles: [] });
      } finally {
        setDiscordLoading(false);
        guildSetupInFlightRef.current = { guildId: "", promise: null };
      }
    })();

    guildSetupInFlightRef.current = { guildId, promise: runner };
    return await runner;
  };

  if (!user) {
    return (
      <div className="obsidian-ui min-h-screen text-white">
        <main className="max-w-xl mx-auto px-6 py-12 text-center">
          <h1 className="text-xl font-bold mb-2">Application forms</h1>
          <p className="text-sm text-white/50 mb-4">
            Log in to create Discord review forms for your edits.
          </p>
          <Link
            to="/login"
            className="inline-flex items-center justify-center h-9 px-4 rounded bg-white text-black text-sm font-medium"
          >
            Login
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="obsidian-ui min-h-screen text-white selection:bg-white/15">
      <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-black/70 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto px-4 py-2.5 flex items-center justify-between">
          <Link
            to="/"
            className="text-xl font-bold tracking-tight hover:opacity-70 transition-opacity"
          >
            CUTR
          </Link>
          <Link
            to="/dashboard"
            className="inline-flex h-7 items-center gap-1.5 px-3 rounded-full bg-white/[0.045] border border-white/[0.07] text-[10px] font-semibold text-white/60 hover:text-white hover:bg-white/10 transition-all"
          >
            <ArrowLeft size={12} />
            Dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-4 grid gap-4 lg:grid-cols-[220px_1fr]">
        <aside className="space-y-3">
          <button
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
            {loading ? (
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
                      <p
                        className={`text-sm font-semibold truncate ${selectedId === item.id ? "text-white" : "text-white/60 group-hover:text-white/80"}`}
                      >
                        {item.name}
                      </p>
                      <p className="text-[10px] font-medium text-white/30 group-hover:text-white/40">
                        {item.pendingCount || 0} pending •{" "}
                        {item.submissionCount || 0} total
                      </p>
                    </button>
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
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        <section className="space-y-3.5">
          <div className="glass rounded-[22px] p-4 border border-white/5 transition-all">
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
                Save
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Field
                label="Display Name"
                value={form.name}
                onChange={(value) =>
                  updateForm({
                    name: value,
                    slug:
                      form.slug ||
                      value
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, "-")
                        .replace(/^-+|-+$/g, ""),
                  })
                }
              />
              <Field
                label="Form link slug"
                value={form.slug}
                onChange={(value) => updateForm({ slug: value })}
              />
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
          </div>

          <div className="glass rounded-[22px] p-4 border border-white/5 transition-all">
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
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
                    <span className="text-[11px] font-bold text-white/70">
                      @{discordUser.username}
                    </span>
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
              <div className="rounded border border-white/10 p-3 text-sm text-white/50">
                {discordLoading
                  ? "Loading Discord servers..."
                  : "No manageable servers found. You need Manage Server permission."}
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
                emoji={form.acceptEmoji}
                threshold={form.acceptThreshold}
                onEmoji={(value) => updateForm({ acceptEmoji: value })}
                onThreshold={(value) => updateForm({ acceptThreshold: value })}
              />
              <VoteField
                label="Deny"
                emoji={form.denyEmoji}
                threshold={form.denyThreshold}
                onEmoji={(value) => updateForm({ denyEmoji: value })}
                onThreshold={(value) => updateForm({ denyThreshold: value })}
              />
              <VoteField
                label="Reapply"
                emoji={form.reapplyEmoji}
                threshold={form.reapplyThreshold}
                onEmoji={(value) => updateForm({ reapplyEmoji: value })}
                onThreshold={(value) => updateForm({ reapplyThreshold: value })}
              />
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <Field
                label="Deny cooldown days"
                type="number"
                value={form.denyCooldownDays}
                onChange={(value) => updateForm({ denyCooldownDays: value })}
              />
              <Field
                label="Reapply cooldown days"
                type="number"
                value={form.reapplyCooldownDays}
                onChange={(value) =>
                  updateForm({
                    reapplyCooldownDays: Math.max(14, Number(value) || 14),
                  })
                }
              />
            </div>
          </div>

          <div className="glass rounded-[22px] p-4 border border-white/5">
            <div className="flex items-center justify-between mb-4">
              <div className="space-y-0.5">
                <h2 className="text-base font-semibold tracking-tight">
                  Questionnaire
                </h2>
                <p className="text-[11px] text-white/40 font-medium">
                  Design the fields applicants fill out.
                </p>
              </div>
              <button
                onClick={() =>
                  updateForm({
                    questions: [...form.questions, emptyQuestion()],
                  })
                }
                className="h-7 px-3 rounded-full bg-white/5 border border-white/10 text-[10px] font-semibold hover:bg-white/10 transition-all flex items-center gap-1.5"
              >
                <Plus size={12} />
                Add Field
              </button>
            </div>
            <div className="space-y-2.5">
              {form.questions.map((question, index) => (
                <div
                  key={question.id}
                  className="rounded-2xl border border-white/5 bg-white/[0.02] p-3 space-y-2.5 transition-all hover:bg-white/[0.04]"
                >
                  <div className="grid gap-2.5 md:grid-cols-[1fr_145px_92px_30px] items-start">
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-semibold uppercase tracking-widest text-white/30 px-1">
                        Label
                      </label>
                      <input
                        value={question.label}
                        onChange={(e) =>
                          updateQuestion(index, { label: e.target.value })
                        }
                        placeholder="e.g., What is your Instagram?"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-3 h-9 text-xs text-white focus:outline-none focus:ring-2 focus:ring-white/10 transition-all"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-semibold uppercase tracking-widest text-white/30 px-1">
                        Type
                      </label>
                      <select
                        value={question.type}
                        onChange={(e) =>
                          updateQuestion(index, { type: e.target.value })
                        }
                        className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-3 h-9 text-xs text-white focus:outline-none focus:ring-2 focus:ring-white/10 transition-all"
                      >
                        <option value="text">Short</option>
                        <option value="textarea">Long</option>
                        <option value="true_false">True / false</option>
                        <option value="select">Options</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <div className="h-[19px]" aria-hidden="true" />
                      <label className="flex w-full h-9 translate-y-[3px] items-center justify-start gap-2 rounded-xl bg-white/[0.025] border border-white/5 px-3 text-[11px] leading-none text-white/60">
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
                      <div className="h-[19px]" aria-hidden="true" />
                      <button
                        onClick={() =>
                          updateForm({
                            questions: form.questions.filter(
                              (_, qIndex) => qIndex !== index,
                            ),
                          })
                        }
                        className="h-9 w-8 inline-flex items-center justify-center rounded-xl text-white/40 hover:text-red-400 hover:bg-red-400/10 transition-all"
                        title="Delete question"
                      >
                        <Trash2 size={14} />
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
                      className="mt-1 w-full bg-black/30 border border-white/10 rounded-xl px-3 h-8 text-xs text-white focus:outline-none focus:border-white/30"
                    />
                  )}
                </div>
              ))}
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
        </section>
      </main>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[9px] font-semibold uppercase tracking-widest text-white/30 px-1">
        {label}
      </label>
      <input
        type={type}
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

function VoteField({ label, emoji, threshold, onEmoji, onThreshold }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-3 space-y-2.5">
      <p className="text-[9px] font-semibold uppercase tracking-widest text-white/30 px-1">
        {label}
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
