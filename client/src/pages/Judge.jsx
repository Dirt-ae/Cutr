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

const clearDiscordAuth = () => {
  localStorage.removeItem("discordSession");
  localStorage.removeItem("discordUser");
};

const isDiscordAuthError = (message = "") =>
  /connect discord|discord session expired|reconnect discord/i.test(message);

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

  const [discordSession, setDiscordSession] = useState(
    () => localStorage.getItem("discordSession") || "",
  );
  const needsDiscordConnect =
    !discordSession || isJwtExpired(discordSession);

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
    if (!discordSession || isJwtExpired(discordSession)) {
      if (discordSession && isJwtExpired(discordSession)) {
        clearDiscordAuth();
        setDiscordSession("");
      }
      setLoading(false);
      setError("");
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
      if (!res.ok) {
        if (res.status === 401 || isDiscordAuthError(body.error)) {
          clearDiscordAuth();
          setDiscordSession("");
          return;
        }
        throw new Error(body.error || "Failed to load judge panel.");
      }
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
    if (!data?.isJudge || !data?.submission?.id) return;
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
    if (!data?.isJudge || !data?.submission?.id) return;
    const trimmed = commentDraft.trim();
    if (!trimmed) {
      showToast("Write something before posting.", "error");
      return;
    }
    setSavingComment(true);
    try {
      const res = await fetch(
        `${API_URL}/api/judging/${slug}/comment?s=${encodeURIComponent(data.submission.id)}`,
        {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Discord-Session": discordSession,
        },
        body: JSON.stringify({
          submissionId: data.submission.id,
          body: trimmed,
        }),
      },
      );
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
        ) : needsDiscordConnect ? (
          <div className="glass rounded-[22px] border border-white/5 p-6 text-center">
            <h1 className="text-xl font-bold mb-2">Judge panel</h1>
            <p className="text-sm text-white/50 mb-4">
              Connect with Discord to view this submission. Only members with the
              judge role can score or leave feedback.
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
            <p className="text-sm text-white/50 mb-4">{error}</p>
            {isDiscordAuthError(error) ? (
              <button
                onClick={connectDiscord}
                className="h-10 px-5 rounded-full bg-white text-black text-sm font-semibold"
              >
                Connect Discord
              </button>
            ) : null}
          </div>
        ) : (
          <div className="space-y-8">
            <header className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[11px] text-white/35">{data?.form?.name || "Judge panel"}</p>
                  {!data?.isJudge ? (
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/40">
                      View only
                    </span>
                  ) : null}
                </div>
                <h1 className="mt-1 truncate text-lg font-semibold text-white/90">
                  {submission?.originalName || submission?.discordUsername || "Submission"}
                </h1>
                {submission?.discordUsername && submission?.originalName ? (
                  <p className="mt-0.5 text-sm text-white/45">{submission.discordUsername}</p>
                ) : null}
              </div>
              {pendingSubmissions.length > 1 && (
                <div className="w-full sm:w-56">
                  <Select
                    value={String(submission?.id || selectedSubmissionId || "")}
                    onChange={(value) => setSelectedSubmissionId(value)}
                    ariaLabel={
                      data?.isJudge
                        ? "Choose submission to judge"
                        : "Choose submission to view"
                    }
                    searchable={false}
                    options={pendingSubmissions.map((item) => ({
                      value: String(item.id),
                      label: `${item.originalName || "Submission"} · ${item.discordUsername || "Applicant"}`,
                    }))}
                  />
                </div>
              )}
            </header>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_11rem] lg:items-start">
              <div
                className={`overflow-hidden rounded-lg border border-white/[0.06] bg-black/40 ${playerFrame.className}`}
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

              <aside className="space-y-4 text-sm text-white/50 lg:pt-1">
                <div>
                  <p className="text-[11px] text-white/30">Average</p>
                  <p className="mt-1 text-2xl font-medium tabular-nums text-white/85">
                    {results?.finalScore === null || results?.finalScore === undefined
                      ? "—"
                      : results.finalScore}
                    <span className="ml-1 text-sm text-white/35">/ 10</span>
                  </p>
                  <p className="mt-1 text-xs text-white/30">
                    {judgeCount}
                    {requiredJudges > 0 ? ` / ${requiredJudges}` : ""} judges
                    {requiredJudges > judgeCount ? (
                      <span className="text-white/40">
                        {" "}
                        · {requiredJudges - judgeCount} more needed
                      </span>
                    ) : null}
                  </p>
                </div>
                {data?.isJudge ? (
                  <div>
                    <p className="text-[11px] text-white/30">Your score</p>
                    <p className="mt-1 text-xl font-medium tabular-nums text-white/75">
                      {myAverage}
                    </p>
                  </div>
                ) : null}
              </aside>
            </div>

            {submissionAnswers.length > 0 && (
              <details className="group border-t border-white/[0.06] pt-6">
                <summary className="cursor-pointer list-none text-sm text-white/55 marker:content-none [&::-webkit-details-marker]:hidden">
                  <span className="group-open:text-white/70">Application answers</span>
                  <span className="ml-2 text-xs text-white/30">({submissionAnswers.length})</span>
                </summary>
                <div className="mt-4 space-y-4 pl-0.5">
                  {submissionAnswers.map((item) => (
                    <div key={item.id || item.label}>
                      <p className="text-xs text-white/40">{item.label}</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-white/70">
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>
              </details>
            )}

            <details className="group border-t border-white/[0.06] pt-6" open={data?.isJudge && !myComment}>
              <summary className="cursor-pointer list-none text-sm text-white/55 marker:content-none [&::-webkit-details-marker]:hidden">
                <span className="group-open:text-white/70">Judge feedback</span>
                {judgeComments.length > 0 ? (
                  <span className="ml-2 text-xs text-white/30">({judgeComments.length})</span>
                ) : null}
              </summary>

              <div className="mt-4 space-y-3">
                {judgeComments.filter((comment) => !(editingComment && comment.isMine))
                  .length === 0 && !editingComment ? (
                  <p className="text-sm text-white/30">Nothing posted yet.</p>
                ) : (
                  judgeComments
                    .filter((comment) => !(editingComment && comment.isMine))
                    .map((comment) => (
                    <article key={comment.id} className="rounded-lg bg-white/[0.03] px-3 py-3">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="text-sm text-white/65">
                          {comment.judgeUsername || "Judge"}
                          {comment.isMine ? (
                            <span className="ml-1.5 text-xs text-white/30">(you)</span>
                          ) : null}
                        </p>
                        {comment.updatedAt && comment.updatedAt !== comment.createdAt ? (
                          <span className="text-[10px] text-white/25">edited</span>
                        ) : null}
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/60">
                        {comment.body}
                      </p>
                      {data?.isJudge && comment.isMine && !editingComment ? (
                        <button
                          type="button"
                          onClick={() => {
                            setCommentDraft(comment.body);
                            setEditingComment(true);
                          }}
                          className="mt-2 text-xs text-white/35 hover:text-white/55"
                        >
                          Edit
                        </button>
                      ) : null}
                    </article>
                  ))
                )}
              </div>

              {data?.isJudge && (!myComment || editingComment) ? (
                <div className="mt-4 space-y-3">
                  <textarea
                    value={commentDraft}
                    onChange={(e) => setCommentDraft(e.target.value)}
                    rows={3}
                    maxLength={2000}
                    placeholder="Notes on the edit…"
                    className="w-full resize-y rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-sm text-white/80 placeholder-white/20 focus:border-white/10 focus:outline-none"
                  />
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
                    {editingComment ? (
                      <button
                        type="button"
                        onClick={cancelCommentEdit}
                        className="h-9 px-3 text-sm text-white/40 hover:text-white/60"
                      >
                        Cancel
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={saveComment}
                      disabled={savingComment || !commentDraft.trim()}
                      className="h-9 rounded-lg border border-white/10 px-4 text-sm text-white/75 hover:bg-white/[0.04] disabled:opacity-40"
                    >
                      {savingComment ? "Saving…" : myComment ? "Save" : "Post"}
                    </button>
                  </div>
                </div>
              ) : !data?.isJudge ? (
                <p className="mt-4 text-xs text-white/30">
                  View only — judges with the required role can post feedback.
                </p>
              ) : null}
            </details>

            {!data?.isJudge ? (
              <p className="border-t border-white/[0.06] pt-6 text-sm text-white/40">
                You can watch and read feedback here, but scoring requires the judge role.
              </p>
            ) : (
              <div className="border-t border-white/[0.06] pt-6">
                <p className="mb-4 text-sm text-white/45">Score this edit</p>
                <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                  {CRITERIA.map((criterion) => (
                    <div key={criterion.key}>
                      <div className="flex items-baseline justify-between gap-3">
                        <label className="text-sm lowercase text-white/55">
                          {criterion.label}
                        </label>
                        <span className="text-sm tabular-nums text-white/45">
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
                        className="mt-2 w-full accent-white/70"
                      />
                    </div>
                  ))}
                </div>

                <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <button
                    type="button"
                    onClick={() => setShowCriteriaHelp((v) => !v)}
                    className="text-left text-xs text-white/35 hover:text-white/55"
                  >
                    {showCriteriaHelp ? "Hide criteria help" : "What do these mean?"}
                  </button>
                  <button
                    onClick={publish}
                    disabled={submitting}
                    className="h-9 rounded-lg border border-white/10 px-5 text-sm text-white/80 hover:bg-white/[0.04] disabled:opacity-40"
                  >
                    {submitting ? "Publishing…" : "Publish scores"}
                  </button>
                </div>

                {showCriteriaHelp && (
                  <div className="mt-4 space-y-3 rounded-lg bg-white/[0.02] px-3 py-3">
                    {CRITERIA.map((criterion) => (
                      <div key={criterion.key}>
                        <p className="text-xs lowercase text-white/45">{criterion.label}</p>
                        <p className="text-xs leading-relaxed text-white/35">{criterion.help}</p>
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
