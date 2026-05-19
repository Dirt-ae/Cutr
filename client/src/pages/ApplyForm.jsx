import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Check, Loader2, LogIn, Upload, X } from "lucide-react";
import { API_URL } from "../utils/api";
import { useToast } from "../contexts/ToastContext";
import MainNav from "../components/MainNav";

const SITE_MAX_FILE_SIZE_MB = 100;

export default function ApplyForm({ user, logout }) {
  const { slug } = useParams();
  const { showToast } = useToast();
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState(null);
  const [videoId, setVideoId] = useState("");
  const [answers, setAnswers] = useState({});
  const [discordUser, setDiscordUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("discordUser") || "null");
    } catch {
      return null;
    }
  });
  const [manualDiscordId, setManualDiscordId] = useState("");
  const [manualDiscordName, setManualDiscordName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [transcoding, setTranscoding] = useState(false);
  const [processingLabel, setProcessingLabel] = useState("");
  const [processingProgress, setProcessingProgress] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const fileRef = useRef(null);
  const pollIntervalRef = useRef(null);

  const discordSession = useMemo(
    () => localStorage.getItem("discordSession") || "",
    [discordUser],
  );

  useEffect(() => {
    loadForm();
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [slug]);

  const loadForm = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/forms/${slug}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Form not found");
      setForm(data);
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const connectDiscord = async () => {
    try {
      const res = await fetch(
        `${API_URL}/api/discord/login-url?returnTo=${encodeURIComponent(`/apply/${slug}`)}&frontendOrigin=${encodeURIComponent(window.location.origin)}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Discord login is not ready");
      window.location.href = data.url;
    } catch (e) {
      showToast(e.message, "error");
    }
  };

  const setAnswer = (id, value) =>
    setAnswers((current) => ({ ...current, [id]: value }));

  const pollTranscodingStatus = (id) => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setTranscoding(true);
    setProcessingLabel("Checking video status...");
    setProcessingProgress(92);

    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/api/video/${id}`);
        const data = await res.json();
        const status = Number(data.transcodingStatus);

        if (status === 0) {
          setProcessingLabel("Queued for processing...");
          setProcessingProgress(94);
        } else if (status === 1 || status === 2) {
          setProcessingLabel("Processing video...");
          setProcessingProgress(96);
        } else if (status === 3) {
          setProcessingLabel("Transcoding video...");
          setProcessingProgress(98);
        } else if (status === 4) {
          setProcessingLabel("Ready!");
          setProcessingProgress(100);
        } else if (status === 5) {
          setProcessingLabel("Processing failed");
          setProcessingProgress(0);
        }

        if (
          data.transcodingStatus === 4 ||
          data.transcodingStatus === "ready" ||
          data.transcodingStatus === "completed"
        ) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
          setTranscoding(false);
          setProcessingLabel("");
          setProcessingProgress(0);
          setUploadProgress(0);
          setVideoId(id);
          showToast(
            "Video ready! You can now submit your application.",
            "success",
          );
        } else if (
          data.transcodingStatus === 5 ||
          data.transcodingStatus === "error"
        ) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
          setTranscoding(false);
          setProcessingLabel("");
          setProcessingProgress(0);
          setUploadProgress(0);
          showToast("Video processing failed. Please try again.", "error");
        }
      } catch (e) {
        console.error("Polling error:", e);
      }
    }, 3000);
  };

  const handleUpload = () => {
    if (!file) return;
    const maxMb = Math.min(Number(form.maxFileSizeMb) || SITE_MAX_FILE_SIZE_MB, SITE_MAX_FILE_SIZE_MB);
    const maxBytes = maxMb * 1024 * 1024;
    if (file.size > maxBytes) {
      showToast(`File must be ${maxMb}MB or smaller.`, "error");
      return;
    }
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setUploading(true);
    setUploadProgress(0);
    setProcessingLabel("Uploading to CUTR...");
    setProcessingProgress(0);
    setVideoId("");
    setFile(null);

    const formData = new FormData();
    formData.append("video", file);

    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        const progress = Math.round((e.loaded / e.total) * 90);
        setUploadProgress(progress);
        setProcessingProgress(progress);
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status === 200) {
        const data = JSON.parse(xhr.responseText);
        setUploadProgress(100);
        setProcessingLabel("Upload complete. Processing video...");
        setProcessingProgress(92);
        setUploading(false);

        pollTranscodingStatus(data.id);
      } else {
        let errorMsg = "Upload failed";
        try {
          const error = JSON.parse(xhr.responseText);
          errorMsg = error.error || errorMsg;
        } catch {}
        showToast(errorMsg, "error");
        setUploading(false);
        setProcessingLabel("");
        setProcessingProgress(0);
      }
    });

    xhr.addEventListener("error", () => {
      showToast("Network error during upload", "error");
      setUploading(false);
      setProcessingLabel("");
      setProcessingProgress(0);
    });

    xhr.addEventListener("timeout", () => {
      showToast("Upload timed out", "error");
      setUploading(false);
      setProcessingLabel("");
      setProcessingProgress(0);
    });

    xhr.open("POST", `${API_URL}/api/upload-anonymous`);
    xhr.timeout = 30 * 60 * 1000;
    xhr.send(formData);
  };

  const submit = async () => {
    if (form.requiresVideo && !videoId) {
      showToast("Upload and process your video first", "error");
      return;
    }
    const payloadAnswers = (form.questions || []).map((question) => ({
      id: question.id,
      value: answers[question.id] || "",
    }));
    const missing = (form.questions || []).find(
      (question) =>
        question.required && !String(answers[question.id] || "").trim(),
    );
    if (missing) {
      showToast(`Answer required: ${missing.label}`, "error");
      return;
    }

    if (form.requireDiscord && !discordSession && !manualDiscordId) {
      showToast("Connect Discord before submitting.", "error");
      return;
    }

    const body = {
      videoId: videoId || "",
      answers: JSON.stringify(payloadAnswers),
    };
    if (discordSession) {
      body.discordSession = discordSession;
      body.discordAvatar = discordUser?.avatar || "";
    } else {
      body.discordUserId = manualDiscordId;
      body.discordUsername = manualDiscordName;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/forms/${slug}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) {
        if (result.cooldownUntil) {
          throw new Error(
            `You can apply again ${new Date(result.cooldownUntil).toLocaleDateString()}.`,
          );
        }
        throw new Error(result.error || "Failed to submit");
      }
      setSubmitted(true);
      showToast(result.successMessage || "Application sent to Discord", "success");
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const requiresDiscordConnection = Boolean(form?.requireDiscord && form?.discordOAuthReady);
  const hasDiscordIdentity = requiresDiscordConnection
    ? Boolean(discordSession)
    : form?.requireDiscord
      ? Boolean(discordSession || manualDiscordId)
      : true;
  const hasRequiredVideo = form?.requiresVideo ? Boolean(videoId) : true;
  const canSubmit =
    hasRequiredVideo &&
    !uploading &&
    !transcoding &&
    hasDiscordIdentity &&
    form?.isAcceptingSubmissions !== false;

  if (loading) {
    return (
      <div className="obsidian-ui min-h-screen text-white grid place-items-center">
        <Loader2 size={24} className="animate-spin text-white/20" />
      </div>
    );
  }

  if (!form) {
    return (
      <div className="obsidian-ui min-h-screen text-white grid place-items-center px-6 text-center">
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight">
            Form not found
          </h1>
          <Link
            to="/"
            className="inline-flex h-10 items-center px-6 rounded-full bg-white/10 text-sm font-medium hover:bg-white/20 transition-all"
          >
            Return Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="obsidian-ui min-h-screen text-white selection:bg-white/15">
      <MainNav user={user} logout={logout} />

      <main
        className="max-w-xl mx-auto px-4 py-6 sm:px-6 sm:py-8"
        style={{ "--form-accent": form.accentColor || "#ffffff" }}
      >
        <div className="mb-5 flex justify-center">
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/5">
            <div
              className={`w-1.5 h-1.5 rounded-full ${form.botReady ? "bg-green-400" : "bg-yellow-400"} animate-pulse`}
            />
            <span className="text-[10px] font-medium tracking-wide uppercase opacity-60">
              {form.botReady ? "Systems Live" : "Systems Offline"}
            </span>
          </div>
        </div>
        {submitted ? (
          <div className="glass rounded-2xl p-6 text-center border border-white/10 animate-in fade-in zoom-in duration-500 sm:p-10">
            <div className="w-12 h-12 rounded-full bg-green-400/10 flex items-center justify-center mx-auto mb-4">
              <Check size={24} className="text-green-400" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight mb-2">
              Submitted
            </h1>
            <p className="text-sm text-white/50 text-balance">
              {form.successMessage || "Your application has been sent for review."}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {form.bannerUrl && (
              <img
                src={form.bannerUrl}
                alt=""
                className="w-full h-48 rounded-2xl border border-white/10 object-cover shadow-2xl transition-all duration-500 hover:scale-[1.01]"
              />
            )}
            {form.isAcceptingSubmissions !== false && (
              <div className="space-y-1 text-center">
                <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{form.name}</h1>
                {form.description && (
                  <p className="text-base text-white/40 font-medium">
                    {form.description}
                  </p>
                )}
              </div>
            )}

            {form.isAcceptingSubmissions === false && (
              <div className="glass rounded-2xl p-6 text-center border border-yellow-400/10 animate-in fade-in zoom-in duration-500 my-8 sm:p-10">
                <div className="w-12 h-12 rounded-full bg-yellow-400/10 flex items-center justify-center mx-auto mb-4">
                  <X size={24} className="text-yellow-400" />
                </div>
                <h1 className="text-2xl font-bold tracking-tight mb-2">Form Closed</h1>
                <p className="text-sm text-white/50 text-balance leading-relaxed">
                  {form.closedReason || "This form is not currently accepting submissions."}
                </p>
              </div>
            )}

            {form.isAcceptingSubmissions !== false && (
              <>
                {(form.requireDiscord || form.discordOAuthReady) && (
                <div className="glass rounded-2xl p-5 border border-white/5 transition-all">
                  <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                    <div className="space-y-0.5">
                      <p className="text-sm font-semibold">Discord Account</p>
                      <p className="text-xs text-white/40">
                        ID used for status and cooldowns.
                      </p>
                    </div>
                    {discordUser ? (
                      <div className="flex items-center gap-2 px-2 py-1.5 rounded-full bg-white/5 border border-white/10 group">
                        <img
                          src={
                            discordUser.avatar
                              ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.webp?size=128`
                              : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(discordUser.id || "0") >> 22n) % 6}.png`
                          }
                          alt={discordUser.global_name || discordUser.username || ""}
                          className="w-7 h-7 rounded-full shadow-lg border border-white/10"
                        />
                        <button
                          onClick={() => {
                            localStorage.removeItem("discordSession");
                            localStorage.removeItem("discordUser");
                            setDiscordUser(null);
                          }}
                          className="text-white/20 hover:text-white transition-colors"
                          title="Disconnect"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : form.discordOAuthReady ? (
                      <button
                        onClick={connectDiscord}
                        className="h-9 px-5 rounded-full bg-slate-100 text-slate-950 text-xs font-bold hover:bg-white active:scale-[0.98] transition-all inline-flex items-center gap-2 shadow-lg shadow-black/30"
                      >
                        <LogIn size={16} />
                        Connect
                      </button>
                    ) : form.requireDiscord ? (
                      <div className="grid gap-2 sm:grid-cols-2 w-full">
                        <input
                          value={manualDiscordId}
                          onChange={(e) => setManualDiscordId(e.target.value)}
                          placeholder="Discord user ID"
                          className="bg-white/5 border border-white/10 rounded-lg px-3 h-9 text-xs text-white focus:outline-none transition-all"
                        />
                        <input
                          value={manualDiscordName}
                          onChange={(e) => setManualDiscordName(e.target.value)}
                          placeholder="Discord name"
                          className="bg-white/5 border border-white/10 rounded-lg px-3 h-9 text-xs text-white focus:outline-none transition-all"
                        />
                      </div>
                    ) : (
                      <div className="text-xs text-white/35">
                        Connect Discord to submit.
                      </div>
                    )}
                  </div>
                </div>
                )}


            {form.requiresVideo && (
            <div className="glass rounded-2xl p-5 border border-white/5">
              {videoId ? (
                <div className="rounded-xl border border-green-400/20 bg-green-400/10 p-4 text-center">
                  <Check size={18} className="text-green-300 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-green-100">
                    Video ready.
                  </p>
                  <p className="text-xs text-green-100/60 mt-1">
                    Finish the questions and submit your application.
                  </p>
                </div>
              ) : !uploading && !transcoding ? (
                <div className="space-y-3">
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="group w-full rounded-xl border-2 border-dashed border-white/5 p-6 text-center hover:border-white/20 hover:bg-white/5 transition-all duration-300"
                  >
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".mp4,.webm,.mov,.avi,.mkv"
                      onChange={(e) => setFile(e.target.files?.[0] || null)}
                      className="hidden"
                    />
                    <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-3 group-hover:scale-105 transition-transform duration-300">
                      <Upload
                        size={18}
                        className="text-white/30 group-hover:text-white transition-colors"
                      />
                    </div>
                    <p className="text-sm font-semibold mb-0.5">
                      {file ? file.name : "Upload Edit"}
                    </p>
                    <p className="text-[11px] text-white/20">
                      MP4, WebM or MOV - max{" "}
                      {Math.min(
                        Number(form.maxFileSizeMb) || SITE_MAX_FILE_SIZE_MB,
                        SITE_MAX_FILE_SIZE_MB,
                      )}
                      MB
                    </p>
                  </button>
                  {file && (
                    <button
                      onClick={handleUpload}
                      disabled={uploading}
                      className="w-full h-10 rounded-xl bg-slate-100 text-slate-950 text-xs font-bold hover:bg-white active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-black/30"
                    >
                      {uploading && (
                        <Loader2 size={16} className="animate-spin" />
                      )}
                      Start Upload
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Loader2
                          size={14}
                          className="animate-spin text-white/30"
                        />
                        <p className="text-sm font-semibold">
                          {processingLabel || "Processing..."}
                        </p>
                      </div>
                    </div>
                    <p className="text-lg font-bold tracking-tight tabular-nums">
                      {processingProgress}%
                    </p>
                  </div>
                  <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-white rounded-full h-full transition-all duration-700"
                      style={{ width: `${processingProgress}%` }}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {["Upload", "Transcode", "Ready"].map((step, idx) => (
                      <div
                        key={step}
                        className={`rounded-lg px-3 py-2 border transition-all duration-500 ${processingProgress >= (idx === 0 ? 1 : idx === 1 ? 92 : 99) ? "bg-white/5 border-white/10" : "bg-transparent border-white/5 opacity-20"}`}
                      >
                        <p className="text-[9px] font-semibold">{step}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            )}

            <div className="space-y-4">
              {(form.questions || []).map((question) => (
                <div key={question.id} className="space-y-1.5">
                  <label className="block text-xs font-bold text-white/60 px-0.5">
                    {question.label}
                    {question.required && (
                      <span className="text-white/25 ml-1 font-normal">
                        Required
                      </span>
                    )}
                  </label>
                  {question.type === "textarea" ? (
                    <textarea
                      value={answers[question.id] || ""}
                      onChange={(e) => setAnswer(question.id, e.target.value)}
                      rows={3}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-white/10 resize-none focus:outline-none transition-all"
                      placeholder={question.required ? "Your response..." : "Optional"}
                    />
                  ) : question.type === "true_false" ? (
                    <div className="grid grid-cols-2 gap-2">
                      {["True", "False"].map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setAnswer(question.id, value)}
                          className={`h-9 rounded-lg text-xs font-bold transition-all border ${answers[question.id] === value ? "bg-white text-black border-white" : "bg-white/5 text-white border-white/5 hover:bg-white/10"}`}
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                  ) : question.type === "select" ? (
                    <div className="relative">
                      <select
                        value={answers[question.id] || ""}
                        onChange={(e) => setAnswer(question.id, e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-3 h-10 text-sm text-white appearance-none focus:outline-none transition-all"
                      >
                        <option value="" className="bg-[#0a0a0a]">
                          {question.required ? "Choose an option" : "Optional"}
                        </option>
                        {(Array.isArray(question.options)
                          ? question.options
                          : []
                        ).map((option) => (
                          <option
                            key={option}
                            value={option}
                            className="bg-[#0a0a0a]"
                          >
                            {option}
                          </option>
                        ))}
                      </select>
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-30">
                        <ArrowLeft size={12} className="-rotate-90" />
                      </div>
                    </div>
                  ) : (
                    <input
                      value={answers[question.id] || ""}
                      onChange={(e) => setAnswer(question.id, e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 h-10 text-sm text-white placeholder-white/10 focus:outline-none transition-all"
                      placeholder={question.required ? "..." : "Optional"}
                    />
                  )}
                </div>
              ))}
            </div>

            <div className="pt-4">
              <button
                onClick={submit}
                disabled={
                  submitting ||
                  !canSubmit
                }
                className="w-full h-12 rounded-xl bg-white text-black text-sm font-bold shadow-lg active:scale-[0.99] transition-all flex items-center justify-center gap-2 disabled:opacity-40"
              >
                {submitting && <Loader2 size={16} className="animate-spin" />}
                {submitting
                  ? "Sending..."
                  : requiresDiscordConnection && !discordSession
                    ? "Connect Discord First"
                  : form.isAcceptingSubmissions === false
                    ? "Form Closed"
                  : form.requiresVideo && !videoId
                    ? "Upload Video"
                    : "Submit Application"}
              </button>
              <p className="text-[9px] text-center text-white/10 mt-3 font-bold uppercase tracking-widest">
                CUTR Secure
              </p>
            </div>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
