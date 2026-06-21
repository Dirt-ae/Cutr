import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { API_URL } from "../utils/api";
import { useToast } from "../contexts/ToastContext";
import MainNav from "../components/MainNav";

const CRITERIA = [
  {
    key: "concept",
    label: "concept",
    help: "How well the author conveys a specific idea, concept, story, or emotion.",
  },
  {
    key: "individuality",
    label: "individuality",
    help: "How unique the work is and how much it stands out from the majority.",
  },
  {
    key: "execution",
    label: "execution",
    help: "The technical execution of the work (movement, VFX, SFX, etc.).",
  },
  {
    key: "styleImplementation",
    label: "style implementation",
    help: "How well the edit fits and represents the chosen style, rather than how good it looks in general.",
  },
  {
    key: "overall",
    label: "overall",
    help: "The most important criterion. The viewer's overall impression of the work.",
  },
];

const emptyScores = () => ({
  concept: 0,
  individuality: 0,
  execution: 0,
  styleImplementation: 0,
  overall: 0,
});

export default function Judge({ user, logout }) {
  const { slug, submissionId } = useParams();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [scores, setScores] = useState(emptyScores());
  const [submitting, setSubmitting] = useState(false);
  const [showCriteriaHelp, setShowCriteriaHelp] = useState(false);

  const discordSession = useMemo(
    () => localStorage.getItem("discordSession") || "",
    [],
  );
  const discordUser = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("discordUser") || "null");
    } catch {
      return null;
    }
  }, []);

  const loadPanel = async () => {
    if (!discordSession) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/judging/${slug}/${submissionId}`, {
        headers: { "X-Discord-Session": discordSession },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to load judge panel.");
      setData(body);
      if (body.myScore) {
        setScores({
          concept: body.myScore.concept,
          individuality: body.myScore.individuality,
          execution: body.myScore.execution,
          styleImplementation: body.myScore.styleImplementation,
          overall: body.myScore.overall,
        });
      }
    } catch (e) {
      setError(e.message || "Failed to load judge panel.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPanel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, submissionId, discordSession]);

  const connectDiscord = async () => {
    try {
      const res = await fetch(
        `${API_URL}/api/discord/login-url?returnTo=${encodeURIComponent(
          `/judge/${slug}/${submissionId}`,
        )}&frontendOrigin=${encodeURIComponent(window.location.origin)}`,
      );
      const body = await res.json();
      if (body.url) window.location.href = body.url;
    } catch {
      showToast("Could not start Discord login.", "error");
    }
  };

  const publish = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/judging/${slug}/${submissionId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Discord-Session": discordSession,
        },
        body: JSON.stringify(scores),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to publish scores.");
      showToast("Your scores were published.", "success");
      await loadPanel();
    } catch (e) {
      showToast(e.message || "Failed to publish scores.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const myAverage = useMemo(() => {
    const total = CRITERIA.reduce((sum, c) => sum + (Number(scores[c.key]) || 0), 0);
    return Math.round((total / CRITERIA.length) * 100) / 100;
  }, [scores]);

  const submission = data?.submission;
  const results = data?.results;
  const judgeCount = results?.judgeCount || 0;
  const requiredJudges = Math.max(0, Number(data?.form?.judgeCountThreshold) || 0);

  return (
    <div className="obsidian-ui min-h-screen text-white selection:bg-white/15">
      <MainNav user={user} logout={logout} />
      <main className="mx-auto max-w-3xl px-4 py-8">
        {loading ? (
          <div className="grid min-h-[40vh] place-items-center">
            <Loader2 size={24} className="animate-spin text-white/50" />
          </div>
        ) : !discordSession ? (
          <div className="glass rounded-[22px] border border-white/5 p-6 text-center">
            <h1 className="text-xl font-bold mb-2">Judge panel</h1>
            <p className="text-sm text-white/50 mb-4">
              Connect with Discord to see if you have access to judge this
              submission.
            </p>
            <button
              onClick={connectDiscord}
              className="h-10 px-5 rounded-full bg-white text-black text-sm font-semibold"
            >
              Connect Discord
            </button>
          </div>
        ) : error ? (
          <div className="glass rounded-[22px] border border-white/5 p-6 text-center">
            <h1 className="text-xl font-bold mb-2">Unable to load</h1>
            <p className="text-sm text-white/50">{error}</p>
          </div>
        ) : (
          <div className="glass rounded-[22px] border border-white/5 p-5 sm:p-6">
            <div className="flex items-center gap-3 mb-5">
              {discordUser?.avatar && discordUser?.id ? (
                <img
                  src={`https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.webp?size=128`}
                  alt=""
                  className="w-12 h-12 rounded-full border border-white/10"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-white/10" />
              )}
              <div>
                <p className="text-lg font-bold leading-tight">
                  {submission?.discordUsername || "Submission"}
                </p>
                <p className="text-xs text-white/40">
                  {submission?.originalName || "Edit submission"}
                </p>
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-start">
              <div className="aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-black">
                {submission?.embedUrl ? (
                  <iframe
                    title="Submission"
                    src={`${submission.embedUrl}?autoplay=false`}
                    className="h-full w-full"
                    allow="autoplay; fullscreen"
                    allowFullScreen
                  />
                ) : (
                  <div className="grid h-full place-items-center text-xs uppercase tracking-widest text-white/30">
                    No video
                  </div>
                )}
              </div>

              <div className="sm:w-44 sm:pl-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-white/45">
                  {requiredJudges > 0 && judgeCount < requiredJudges
                    ? "provisional rating"
                    : "average rating"}
                </p>
                <p className="mt-2 text-sm text-white/70">
                  jury:{" "}
                  <span className="font-bold text-white">
                    {results?.finalScore === null || results?.finalScore === undefined
                      ? "—"
                      : `${results.finalScore}/10`}
                  </span>
                </p>
                <p className="mt-1 text-xs text-white/35">
                  {judgeCount}
                  {requiredJudges > 0 ? `/${requiredJudges}` : ""} judge
                  {judgeCount === 1 && requiredJudges <= 1 ? "" : "s"}
                </p>
                {requiredJudges > judgeCount && (
                  <p className="mt-1 text-[11px] text-amber-300/80">
                    Waiting for {requiredJudges - judgeCount} more before the
                    result is finalized.
                  </p>
                )}
                {data?.isJudge && (
                  <div className="mt-5">
                    <p className="text-4xl font-bold leading-none">{myAverage}</p>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-white/45">
                      your rating
                    </p>
                  </div>
                )}
              </div>
            </div>

            {!data?.isJudge ? (
              <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
                You can view this submission, but you do not have the judge role
                required to score it.
              </div>
            ) : (
              <div className="mt-6">
                <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
                  {CRITERIA.map((criterion) => (
                    <div key={criterion.key}>
                      <div className="flex items-baseline justify-between">
                        <label className="text-sm font-semibold lowercase">
                          {criterion.label}
                        </label>
                        <span className="text-sm font-bold text-white/70">
                          {scores[criterion.key]}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={10}
                        step={1}
                        value={scores[criterion.key]}
                        onChange={(e) =>
                          setScores((prev) => ({
                            ...prev,
                            [criterion.key]: Number(e.target.value),
                          }))
                        }
                        className="mt-2 w-full accent-white"
                      />
                    </div>
                  ))}
                </div>

                <div className="mt-6 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setShowCriteriaHelp((v) => !v)}
                    className="text-xs text-white/50 underline underline-offset-2 hover:text-white/80"
                  >
                    What does each criterion mean?
                  </button>
                  <button
                    onClick={publish}
                    disabled={submitting}
                    className="h-10 px-6 rounded-xl border border-white/15 bg-white/5 text-sm font-semibold hover:bg-white/10 disabled:opacity-40"
                  >
                    {submitting ? "Publishing..." : "PUBLISH"}
                  </button>
                </div>

                {showCriteriaHelp && (
                  <div className="mt-4 space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
                    {CRITERIA.map((criterion) => (
                      <div key={criterion.key}>
                        <p className="text-xs font-bold uppercase tracking-wide">
                          {criterion.label}
                        </p>
                        <p className="text-xs text-white/50">{criterion.help}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
