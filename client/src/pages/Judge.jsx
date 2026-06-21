import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { API_URL } from "../utils/api";
import { useToast } from "../contexts/ToastContext";
import MainNav from "../components/MainNav";
import VideoPlayer from "../components/VideoPlayer";
import Select from "../components/Select";
import { getAdaptiveVideoFrameStyle } from "../utils/videoFrame";
import { isPlaybackReady } from "../utils/videoReadiness";
import { getOriginalPlaybackUrl, getSafePlaybackUrl } from "../utils/videoUrls";

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

const getStoredSubmissionId = (slug) =>
  sessionStorage.getItem(`cutr-judge:${slug}`) || "";

const setStoredSubmissionId = (slug, submissionId) => {
  if (!submissionId) {
    sessionStorage.removeItem(`cutr-judge:${slug}`);
    return;
  }
  sessionStorage.setItem(`cutr-judge:${slug}`, String(submissionId));
};

export default function Judge({ user, logout }) {
  const { slug, submissionId: legacySubmissionId } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [scores, setScores] = useState(emptyScores());
  const [submitting, setSubmitting] = useState(false);
  const [showCriteriaHelp, setShowCriteriaHelp] = useState(false);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState("");
  const [playerDimensions, setPlayerDimensions] = useState(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [editingComment, setEditingComment] = useState(false);
  const [savingComment, setSavingComment] = useState(false);

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

  useEffect(() => {
    if (!legacySubmissionId) return;
    setStoredSubmissionId(slug, legacySubmissionId);
    setSelectedSubmissionId(String(legacySubmissionId));
    navigate(`/judge/${slug}`, { replace: true });
  }, [legacySubmissionId, navigate, slug]);

  useEffect(() => {
    if (legacySubmissionId) return;
    const stored = getStoredSubmissionId(slug);
    if (stored) setSelectedSubmissionId(stored);
  }, [legacySubmissionId, slug]);

  const loadPanel = async (submissionId = selectedSubmissionId) => {
    if (!discordSession) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const query = submissionId ? `?s=${encodeURIComponent(submissionId)}` : "";
      const res = await fetch(`${API_URL}/api/judging/${slug}${query}`, {
        headers: { "X-Discord-Session": discordSession },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to load judge panel.");
      setData(body);
      setSelectedSubmissionId(String(body.submission?.id || submissionId || ""));
      setStoredSubmissionId(slug, body.submission?.id || submissionId || "");
      setPlayerDimensions(null);
      if (body.myScore) {
        setScores({
          concept: body.myScore.concept,
          individuality: body.myScore.individuality,
          execution: body.myScore.execution,
          styleImplementation: body.myScore.styleImplementation,
          overall: body.myScore.overall,
        });
      } else {
        setScores(emptyScores());
      }
      setCommentDraft(body.myComment?.body || "");
      setEditingComment(false);
    } catch (e) {
      setError(e.message || "Failed to load judge panel.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPanel(selectedSubmissionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, selectedSubmissionId, discordSession]);

  const connectDiscord = async () => {
    try {
      const res = await fetch(
        `${API_URL}/api/discord/login-url?returnTo=${encodeURIComponent(
          `/judge/${slug}`,
        )}&frontendOrigin=${encodeURIComponent(window.location.origin)}`,
      );
      const body = await res.json();
      if (body.url) window.location.href = body.url;
    } catch {
      showToast("Could not start Discord login.", "error");
    }
  };

  const publish = async () => {
    if (!data?.submission?.id) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/judging/${slug}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Discord-Session": discordSession,
        },
        body: JSON.stringify({
          submissionId: data.submission.id,
          ...scores,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to publish scores.");
      showToast("Your scores were published.", "success");
      await loadPanel(String(data.submission.id));
    } catch (e) {
      showToast(e.message || "Failed to publish scores.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const saveComment = async () => {
    if (!data?.submission?.id) return;
    const trimmed = commentDraft.trim();
    if (!trimmed) {
      showToast("Write something before posting.", "error");
      return;
    }
    setSavingComment(true);
    try {
      const res = await fetch(`${API_URL}/api/judging/${slug}/comment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Discord-Session": discordSession,
        },
        body: JSON.stringify({
          submissionId: data.submission.id,
          body: trimmed,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to save comment.");
      showToast(data.myComment ? "Comment updated." : "Comment posted.", "success");
      setEditingComment(false);
      await loadPanel(String(data.submission.id));
    } catch (e) {
      showToast(e.message || "Failed to save comment.", "error");
    } finally {
      setSavingComment(false);
    }
  };

  const cancelCommentEdit = () => {
    setCommentDraft(data?.myComment?.body || "");
    setEditingComment(false);
  };

  const myAverage = useMemo(() => {
    const total = CRITERIA.reduce((sum, c) => sum + (Number(scores[c.key]) || 0), 0);
    return Math.round((total / CRITERIA.length) * 100) / 100;
  }, [scores]);

  const submission = data?.submission;
  const submissionVideo = submission?.video;
  const submissionAnswers = (submission?.answers || []).filter(
    (item) => item?.label && String(item.value || "").trim(),
  );
  const judgeComments = data?.comments || [];
  const myComment = data?.myComment;
  const results = data?.results;
  const judgeCount = results?.judgeCount || 0;
  const requiredJudges = Math.max(0, Number(data?.form?.judgeCountThreshold) || 0);
  const pendingSubmissions = data?.pendingSubmissions || [];
  const playerFrame = useMemo(
    () =>
      getAdaptiveVideoFrameStyle(
        playerDimensions?.width || submissionVideo?.width,
        playerDimensions?.height || submissionVideo?.height,
      ),
    [
      playerDimensions?.width,
      playerDimensions?.height,
      submissionVideo?.width,
      submissionVideo?.height,
    ],
  );

  return (
    <div className="obsidian-ui flex flex-1 flex-col text-white selection:bg-white/15">
      <MainNav user={user} logout={logout} />
      <main className="mx-auto w-full min-w-0 max-w-4xl px-4 py-8 pb-12">
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
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
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
                    {submission?.originalName || data?.form?.name || "Edit submission"}
                  </p>
                </div>
              </div>
              {pendingSubmissions.length > 1 && (
                <div className="w-full sm:w-64">
                  <Select
                    value={String(submission?.id || selectedSubmissionId || "")}
                    onChange={(value) => setSelectedSubmissionId(value)}
                    ariaLabel="Choose submission to judge"
                    searchable={false}
                    options={pendingSubmissions.map((item) => ({
                      value: String(item.id),
                      label: `${item.originalName || "Submission"} · ${item.discordUsername || "Applicant"}`,
                    }))}
                  />
                </div>
              )}
            </div>

            <div className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-start">
              <div
                className={`overflow-hidden rounded-xl border border-white/10 bg-black ${playerFrame.className}`}
                style={playerFrame.style}
              >
                {submissionVideo && isPlaybackReady(submissionVideo) ? (
                  <VideoPlayer
                    key={submissionVideo.id}
                    src={getOriginalPlaybackUrl(submissionVideo)}
                    fallbackSrc={getSafePlaybackUrl(submissionVideo)}
                    poster={submissionVideo.thumbnailUrl}
                    autoPlay={false}
                    volume={(submissionVideo.volume ?? 100) / 100}
                    onLoadedMetadata={(_currentTime, _duration, dimensions) => {
                      if (dimensions?.width && dimensions?.height) {
                        setPlayerDimensions(dimensions);
                      }
                    }}
                    className="h-full w-full object-contain"
                  />
                ) : submissionVideo ? (
                  <div className="grid min-h-48 place-items-center px-4 text-center text-sm text-white/60">
                    {submissionVideo.processingMessage || "Video is still processing."}
                  </div>
                ) : (
                  <div className="grid min-h-48 place-items-center text-xs uppercase tracking-widest text-white/30">
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

            {submissionAnswers.length > 0 && (
              <section className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-white/45">
                  Application answers
                </h2>
                <div className="mt-4 space-y-4">
                  {submissionAnswers.map((item) => (
                    <div key={item.id || item.label}>
                      <p className="text-xs font-semibold text-white/55">{item.label}</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-white/85">
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-white/45">
                    Judge feedback
                  </h2>
                  <p className="mt-1 text-xs text-white/35">
                    {data?.isJudge
                      ? "Share your take on the edit. Everyone with panel access can read it."
                      : "Read-only — only judges with the required roles can post feedback."}
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {judgeComments.filter((comment) => !(editingComment && comment.isMine))
                  .length === 0 && !editingComment ? (
                  <p className="text-sm text-white/35">No judge feedback yet.</p>
                ) : (
                  judgeComments
                    .filter((comment) => !(editingComment && comment.isMine))
                    .map((comment) => (
                    <article
                      key={comment.id}
                      className="rounded-xl border border-white/10 bg-black/20 p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-white/85">
                          {comment.judgeUsername || "Judge"}
                          {comment.isMine ? (
                            <span className="ml-2 text-[10px] font-medium uppercase tracking-widest text-white/35">
                              You
                            </span>
                          ) : null}
                        </p>
                        {comment.updatedAt && comment.updatedAt !== comment.createdAt ? (
                          <p className="text-[10px] text-white/30">edited</p>
                        ) : null}
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/75">
                        {comment.body}
                      </p>
                      {data?.isJudge && comment.isMine && !editingComment ? (
                        <button
                          type="button"
                          onClick={() => {
                            setCommentDraft(comment.body);
                            setEditingComment(true);
                          }}
                          className="mt-3 text-xs text-white/45 underline underline-offset-2 hover:text-white/75"
                        >
                          Edit your feedback
                        </button>
                      ) : null}
                    </article>
                  ))
                )}
              </div>

              {data?.isJudge && (!myComment || editingComment) ? (
                <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
                  <label className="block text-xs font-semibold text-white/55">
                    {myComment ? "Edit your feedback" : "Your feedback"}
                  </label>
                  <textarea
                    value={commentDraft}
                    onChange={(e) => setCommentDraft(e.target.value)}
                    rows={4}
                    maxLength={2000}
                    placeholder="Your thoughts on the edit — pacing, ideas, strengths, what could improve..."
                    className="w-full resize-y rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-white/25 focus:outline-none focus:ring-2 focus:ring-white/10"
                  />
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-[11px] text-white/30">
                      {commentDraft.length}/2000
                    </p>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      {editingComment ? (
                        <button
                          type="button"
                          onClick={cancelCommentEdit}
                          className="h-10 rounded-xl border border-white/10 px-4 text-sm text-white/60 hover:bg-white/5"
                        >
                          Cancel
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={saveComment}
                        disabled={savingComment || !commentDraft.trim()}
                        className="h-10 rounded-xl bg-white px-5 text-sm font-semibold text-black disabled:opacity-40"
                      >
                        {savingComment
                          ? "Saving..."
                          : myComment
                            ? "Update feedback"
                            : "Post feedback"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </section>

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

                <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <button
                    type="button"
                    onClick={() => setShowCriteriaHelp((v) => !v)}
                    className="text-left text-xs text-white/50 underline underline-offset-2 hover:text-white/80"
                  >
                    What does each criterion mean?
                  </button>
                  <button
                    onClick={publish}
                    disabled={submitting}
                    className="h-11 w-full rounded-xl border border-white/15 bg-white/5 text-sm font-semibold hover:bg-white/10 disabled:opacity-40 sm:h-10 sm:w-auto sm:px-6"
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
