import { Link } from 'react-router-dom'
import { ArrowLeft, Upload, LinkIcon, User, Clock, Shield, Video, Zap } from 'lucide-react'
import MainNav from '../components/MainNav'
import { APP_VERSION } from '../constants/version'

export default function Info({ user, logout }) {
  return (
    <div className="obsidian-ui min-h-screen text-white selection:bg-white/15">
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
            It is designed for videos that need to look clean in Discord without turning your work into a blurry
            repost. Upload a video up to 100MB, wait for processing, then share one short link.
          </p>
        </div>

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
                <p className="text-white/50 text-sm">Drag and drop or click to select. We accept MP4, WebM, MOV, AVI, and MKV files.</p>
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
              <p className="text-white/50 text-sm">Your edits stay crisp. We don't re-encode your video into a blurry mess.</p>
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
              <Upload size={20} className="text-white/40 mb-2" />
              <h3 className="font-medium mb-1">Made for Edits</h3>
              <p className="text-white/50 text-sm">Share anime edits, Call of Duty edits, IRL edits, clips, previews, and quick video links without fighting a generic platform.</p>
            </div>
            <div className="glass rounded-[22px] p-4">
              <Shield size={20} className="text-white/40 mb-2" />
              <h3 className="font-medium mb-1">No Tracking</h3>
              <p className="text-white/50 text-sm">We don't track views, run ads, or sell your data. Just hosting.</p>
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
              <p className="text-white/50 text-sm">14 days for anonymous uploads, 6 months for signed-up users. After that, they're automatically deleted.</p>
            </div>
            <div className="glass rounded-[22px] p-4">
              <h3 className="font-medium mb-1">Is there a file size limit?</h3>
              <p className="text-white/50 text-sm">Yes. Video uploads are capped at 100MB across CUTRR.</p>
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

      {/* Footer */}
      <footer className="border-t border-white/[0.06] mt-8">
        <div className="max-w-3xl mx-auto px-4 py-4 flex flex-wrap justify-center gap-x-4 gap-y-2 text-white/30 text-xs sm:px-6">
          <Link to="/info" className="hover:text-white/60 transition-colors">Info</Link>
          <Link to="/legal" className="hover:text-white/60 transition-colors">Legal</Link>
          <a href="https://discord.gg/JAbzJX4Jce" target="_blank" rel="noopener noreferrer" className="hover:text-white/60 transition-colors">Discord</a>
        </div>
        <div className="text-center text-xs text-white/20 pb-3">v{APP_VERSION}</div>
      </footer>
    </div>
  )
}
