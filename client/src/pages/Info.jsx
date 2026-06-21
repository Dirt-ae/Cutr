import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  LinkIcon,
  Shield,
  Video,
  Zap,
  MousePointerClick,
  ArrowUpDown,
  Check,
  X,
} from 'lucide-react'
import MainNav from '../components/MainNav'

const COMPARISON_ROWS = [
  {
    label: 'Discord embeds',
    cutrr: 'Clean inline playback',
    googleDrive: 'No native embed',
    streamable: 'Yes',
    medal: 'Limited',
    youtube: 'Link preview only',
    discord: 'Heavy compression',
  },
  {
    label: 'Video quality',
    cutrr: 'No re-encoding',
    googleDrive: 'Original file',
    streamable: 'Often re-encoded',
    medal: 'Varies',
    youtube: 'Heavy compression',
    discord: '8 MB / 50 MB cap',
  },
  {
    label: 'Made for edits',
    cutrr: 'Built for editors',
    googleDrive: 'Generic storage',
    streamable: 'General hosting',
    medal: 'Clips & gaming',
    youtube: 'Long-form platform',
    discord: 'Not a host',
  },
  {
    label: 'Frame linking',
    cutrr: 'Share + timestamp',
    googleDrive: 'No',
    streamable: 'No',
    medal: 'No',
    youtube: 'Timestamp URLs',
    discord: 'No',
  },
  {
    label: 'Anonymous upload',
    cutrr: 'Yes',
    googleDrive: 'Account required',
    streamable: 'Yes',
    medal: 'Yes',
    youtube: 'Account required',
    discord: 'N/A',
  },
  {
    label: 'Max upload',
    cutrr: '100 MB',
    googleDrive: '15 GB (no embed)',
    streamable: '10 GB (paid)',
    medal: '500 MB',
    youtube: '256 GB (not for edits)',
    discord: '25–500 MB',
  },
]

const COMPETITOR_COLUMNS = [
  { key: 'googleDrive', label: 'Google Drive' },
  { key: 'streamable', label: 'Streamable' },
  { key: 'medal', label: 'Medal' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'discord', label: 'Discord' },
]

function ComparisonCell({ value, highlight = false }) {
  const isYes = /^(yes|clean|built|original|click)/i.test(String(value))
  const isNo = /^(no|not|limited|heavy|generic|link preview)/i.test(String(value))

  return (
    <td className={`p-2.5 text-center text-xs ${highlight ? 'text-white font-medium' : 'text-white/55'}`}>
      {isYes && highlight ? (
        <span className="inline-flex items-center gap-1 text-emerald-400">
          <Check size={12} className="shrink-0" />
          {value}
        </span>
      ) : isNo && !highlight ? (
        <span className="inline-flex items-center gap-1 text-white/35">
          <X size={12} className="shrink-0 opacity-60" />
          {value}
        </span>
      ) : (
        value
      )}
    </td>
  )
}

export default function Info({ user, logout }) {
  return (
    <div className="obsidian-ui flex flex-1 flex-col text-white selection:bg-white/15">
      <MainNav user={user} logout={logout} />

      <main className="max-w-3xl mx-auto px-4 py-8 sm:px-6 sm:py-10">
        {/* Hero */}
        <div className="mb-10">
          <Link to="/" className="touch-link mb-5 inline-flex items-center gap-2 text-sm text-white/50 hover:text-white">
            <ArrowLeft size={16} />
            Back
          </Link>
          <h1 className="mb-3 text-3xl font-bold tracking-tight sm:text-4xl">Discord video hosting and embed links</h1>
          <p className="text-base leading-relaxed text-white/60 sm:text-lg">
            CUTRR is a fast, no-nonsense video host for Discord embeds, anime editors, Call of Duty editors,
            IRL edit creators, and anyone who needs to share a clean video link.
          </p>
          <p className="text-white/50 text-sm leading-relaxed mt-4">
            Upload a video up to 100MB, wait for processing, then share one short link. No blurry reposts, no fighting
            generic platforms built for something else.
          </p>
        </div>

        {/* Why CUTRR? */}
        <section className="mb-10">
          <h2 className="text-xl font-bold mb-2">Why CUTRR?</h2>
          <p className="text-white/50 text-sm mb-4 leading-relaxed">
            Other platforms weren&apos;t built for editors sharing clips in Discord. Here&apos;s how CUTRR compares.
          </p>
          <div className="space-y-3 md:hidden">
            {COMPARISON_ROWS.map((row) => (
              <article key={row.label} className="glass rounded-[22px] p-4">
                <h3 className="mb-3 text-sm font-semibold">{row.label}</h3>
                <div className="mb-3 flex items-start justify-between gap-3 rounded-xl bg-white/5 px-3 py-2.5">
                  <span className="text-xs font-semibold text-white">CUTRR</span>
                  <span className="text-right text-xs font-medium text-emerald-400">{row.cutrr}</span>
                </div>
                <dl className="space-y-2">
                  {COMPETITOR_COLUMNS.map((column) => (
                    <div key={column.key} className="flex items-start justify-between gap-3 text-[11px]">
                      <dt className="shrink-0 text-white/40">{column.label}</dt>
                      <dd className="text-right text-white/55">{row[column.key]}</dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
          </div>
          <div className="responsive-table glass hidden rounded-[22px] overflow-x-auto md:block">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left p-2.5 text-white/40 font-medium text-xs">Feature</th>
                  <th className="p-2.5 text-center text-white font-semibold text-xs">CUTRR</th>
                  <th className="p-2.5 text-center text-white/40 font-medium text-xs">Google Drive</th>
                  <th className="p-2.5 text-center text-white/40 font-medium text-xs">Streamable</th>
                  <th className="p-2.5 text-center text-white/40 font-medium text-xs">Medal</th>
                  <th className="p-2.5 text-center text-white/40 font-medium text-xs">YouTube</th>
                  <th className="p-2.5 text-center text-white/40 font-medium text-xs">Discord</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row) => (
                  <tr key={row.label} className="border-b border-white/10 last:border-b-0">
                    <td className="p-2.5 text-white/70 text-xs font-medium">{row.label}</td>
                    <ComparisonCell value={row.cutrr} highlight />
                    <ComparisonCell value={row.googleDrive} />
                    <ComparisonCell value={row.streamable} />
                    <ComparisonCell value={row.medal} />
                    <ComparisonCell value={row.youtube} />
                    <ComparisonCell value={row.discord} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* How It Works */}
        <section className="mb-10">
          <h2 className="text-xl font-bold mb-4">How It Works</h2>
          <div className="space-y-3">
            <div className="glass rounded-[22px] p-4 flex items-start gap-4">
              <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{background: 'rgba(255,255,255,0.1)'}}>
                <span className="text-sm font-bold">1</span>
              </div>
              <div>
                <h3 className="font-medium mb-1">Upload your video</h3>
                <p className="text-white/50 text-sm">Drag and drop or click to select. We accept MP4, WebM, MOV, AVI, and MKV files up to 100MB.</p>
              </div>
            </div>
            <div className="glass rounded-[22px] p-4 flex items-start gap-4">
              <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{background: 'rgba(255,255,255,0.1)'}}>
                <span className="text-sm font-bold">2</span>
              </div>
              <div>
                <h3 className="font-medium mb-1">Wait for processing</h3>
                <p className="text-white/50 text-sm">Your video is uploaded to our CDN and processed for streaming. This usually takes a minute or two depending on the file size.</p>
              </div>
            </div>
            <div className="glass rounded-[22px] p-4 flex items-start gap-4">
              <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{background: 'rgba(255,255,255,0.1)'}}>
                <span className="text-sm font-bold">3</span>
              </div>
              <div>
                <h3 className="font-medium mb-1">Share the link</h3>
                <p className="text-white/50 text-sm">Get a short video link you can paste into Discord. CUTRR adds the embed metadata so your video can preview cleanly.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="mb-10">
          <h2 className="text-xl font-bold mb-4">Features</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="glass rounded-[22px] p-4">
              <Zap size={20} className="text-white/40 mb-2" />
              <h3 className="font-medium mb-1">No Compression</h3>
              <p className="text-white/50 text-sm">Your edits stay crisp. We don&apos;t re-encode your video into a blurry mess.</p>
            </div>
            <div className="glass rounded-[22px] p-4">
              <LinkIcon size={20} className="text-white/40 mb-2" />
              <h3 className="font-medium mb-1">Instant Links</h3>
              <p className="text-white/50 text-sm">Get a shareable link the moment processing is done. No accounts required.</p>
            </div>
            <div className="glass rounded-[22px] p-4">
              <Video size={20} className="text-white/40 mb-2" />
              <h3 className="font-medium mb-1">Discord Embeds</h3>
              <p className="text-white/50 text-sm">Paste your CUTRR link in Discord and the video shows up inline. No need to download.</p>
            </div>
            <div className="glass rounded-[22px] p-4">
              <MousePointerClick size={20} className="text-white/40 mb-2" />
              <h3 className="font-medium mb-1">Frame Linking</h3>
              <p className="text-white/50 text-sm">Use Share and turn on &ldquo;Jump to this moment&rdquo; to link to an exact timestamp.</p>
            </div>
            <div className="glass rounded-[22px] p-4">
              <ArrowUpDown size={20} className="text-white/40 mb-2" />
              <h3 className="font-medium mb-1">Smart Sorting</h3>
              <p className="text-white/50 text-sm">Sort your dashboard by newest, oldest, size, duration, or expiration date in one click.</p>
            </div>
            <div className="glass rounded-[22px] p-4">
              <Shield size={20} className="text-white/40 mb-2" />
              <h3 className="font-medium mb-1">No Tracking</h3>
              <p className="text-white/50 text-sm">We don&apos;t track views or sell your data. Just hosting.</p>
            </div>
          </div>
        </section>

        {/* Frame Linking */}
        <section className="mb-10">
          <h2 className="text-xl font-bold mb-4">Frame Linking</h2>
          <div className="glass rounded-[22px] p-5 space-y-4">
            <p className="text-white/60 text-sm leading-relaxed">
              Need to point someone to an exact moment? Pause the video, open Share, and enable &ldquo;Jump to this moment&rdquo; before copying the link.
            </p>
            <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-sm text-emerald-400/90 break-all">
              cutrr.xyz/a1b2c3d4?t=12.483
            </div>
            <ul className="space-y-2 text-sm text-white/50">
              <li className="flex gap-2">
                <span className="text-white/30 shrink-0">→</span>
                Discord opens the link and jumps straight to that timestamp.
              </li>
              <li className="flex gap-2">
                <span className="text-white/30 shrink-0">→</span>
                Editors can say &ldquo;Look at 0:12&rdquo; and drop one link — no scrubbing required.
              </li>
              <li className="flex gap-2">
                <span className="text-white/30 shrink-0">→</span>
                Works on any public video page. Private videos include your access token in the link.
              </li>
            </ul>
          </div>
        </section>

        {/* Sorting */}
        <section className="mb-10">
          <h2 className="text-xl font-bold mb-4">Dashboard Sorting</h2>
          <div className="glass rounded-[22px] p-5">
            <p className="text-white/50 text-sm mb-4">
              Your dashboard includes one-click sorting so you can find the right video fast:
            </p>
            <div className="flex flex-wrap gap-2">
              {['Newest', 'Oldest', 'Biggest', 'Smallest', 'Longest', 'Shortest', 'Expiring Soon'].map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/70"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* Anonymous vs Signed Up */}
        <section className="mb-10">
          <h2 className="text-xl font-bold mb-4">Anonymous vs Signed Up</h2>
          <div className="responsive-table glass rounded-[22px]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left p-3 text-white/40 font-medium">Feature</th>
                  <th className="text-center p-3 text-white/40 font-medium">Anonymous</th>
                  <th className="text-center p-3 text-white/40 font-medium">Signed Up</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-white/10">
                  <td className="p-3">Retention Period</td>
                  <td className="p-3 text-center text-white/60">14 days</td>
                  <td className="p-3 text-center text-white/60">6 months</td>
                </tr>
                <tr className="border-b border-white/10">
                  <td className="p-3">Upload Videos</td>
                  <td className="p-3 text-center text-green-400">Unlimited</td>
                  <td className="p-3 text-center text-green-400">5 active videos</td>
                </tr>
                <tr className="border-b border-white/10">
                  <td className="p-3">Shareable Links</td>
                  <td className="p-3 text-center text-green-400">Yes</td>
                  <td className="p-3 text-center text-green-400">Yes</td>
                </tr>
                <tr className="border-b border-white/10">
                  <td className="p-3">Dashboard</td>
                  <td className="p-3 text-center text-green-400">Yes</td>
                  <td className="p-3 text-center text-green-400">Yes</td>
                </tr>
                <tr className="border-b border-white/10">
                  <td className="p-3">Volume Control</td>
                  <td className="p-3 text-center text-white/30">No</td>
                  <td className="p-3 text-center text-green-400">Yes</td>
                </tr>
                <tr className="border-b border-white/10">
                  <td className="p-3">Descriptions</td>
                  <td className="p-3 text-center text-white/30">No</td>
                  <td className="p-3 text-center text-green-400">Yes</td>
                </tr>
                <tr className="border-b border-white/10">
                  <td className="p-3">Autoplay Settings</td>
                  <td className="p-3 text-center text-white/30">No</td>
                  <td className="p-3 text-center text-green-400">Yes</td>
                </tr>
                <tr className="border-b border-white/10">
                  <td className="p-3">Video Management</td>
                  <td className="p-3 text-center text-white/30">No</td>
                  <td className="p-3 text-center text-green-400">Delete, edit, manage</td>
                </tr>
                <tr>
                  <td className="p-3">Custom Thumbnails</td>
                  <td className="p-3 text-center text-white/30">No</td>
                  <td className="p-3 text-center text-green-400">Pick from generated options</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* FAQ */}
        <section className="mb-10">
          <h2 className="text-xl font-bold mb-4">FAQ</h2>
          <div className="space-y-3">
            <div className="glass rounded-[22px] p-4">
              <h3 className="font-medium mb-1">What file types are supported?</h3>
              <p className="text-white/50 text-sm">MP4, WebM, MOV, AVI, and MKV. Any standard video format.</p>
            </div>
            <div className="glass rounded-[22px] p-4">
              <h3 className="font-medium mb-1">How long are videos retained?</h3>
              <p className="text-white/50 text-sm">14 days for anonymous uploads, 6 months for signed-up users. After that, they&apos;re automatically deleted.</p>
            </div>
            <div className="glass rounded-[22px] p-4">
              <h3 className="font-medium mb-1">Is there a file size limit?</h3>
              <p className="text-white/50 text-sm">Yes. Video uploads are capped at 100MB across CUTRR.</p>
            </div>
            <div className="glass rounded-[22px] p-4">
              <h3 className="font-medium mb-1">How does frame linking work?</h3>
              <p className="text-white/50 text-sm">Open Share on any video, toggle &ldquo;Jump to this moment,&rdquo; and copy the link. It opens directly at that timestamp in Discord.</p>
            </div>
            <div className="glass rounded-[22px] p-4">
              <h3 className="font-medium mb-1">Can I delete my videos?</h3>
              <p className="text-white/50 text-sm">Signed-up users can delete videos from the dashboard. Anonymous uploads expire automatically.</p>
            </div>
            <div className="glass rounded-[22px] p-4">
              <h3 className="font-medium mb-1">Do videos work in Discord?</h3>
              <p className="text-white/50 text-sm">Yes. Paste a CUTRR video link in Discord and it will show a video preview with playback.</p>
            </div>
          </div>
        </section>

        {/* CTA */}
        <div className="text-center glass rounded-[22px] p-6">
          <h2 className="text-lg font-bold mb-2">Ready to share?</h2>
          <p className="text-white/50 text-sm mb-4">Upload your first video in seconds.</p>
          <Link to="/" className="touch-link rounded-full bg-white px-6 py-2 text-sm font-medium text-black transition-colors hover:bg-white/90">
            Upload a Video
          </Link>
        </div>
      </main>
    </div>
  )
}
