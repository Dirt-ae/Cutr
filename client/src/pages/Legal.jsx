import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import MainNav from '../components/MainNav'

const tabs = [
  { id: 'tos', label: 'Terms of Service' },
  { id: 'privacy', label: 'Privacy Policy' },
  { id: 'aup', label: 'Acceptable Use' },
  { id: 'dmca', label: 'DMCA Policy' },
]

export default function Legal({ user, logout }) {
  const [activeTab, setActiveTab] = useState('tos')

  return (
    <div className="obsidian-ui flex min-w-0 w-full max-w-full flex-1 flex-col text-white selection:bg-white/15">
      <MainNav user={user} logout={logout} />

      <main className="mx-auto w-full min-w-0 max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <Link to="/" className="inline-flex items-center gap-2 text-white/50 hover:text-white text-sm mb-6">
          <ArrowLeft size={16} />
          Back
        </Link>
        <h1 className="mb-6 break-words text-2xl font-bold sm:text-3xl">Legal</h1>

        {/* Tabs */}
        <div className="mb-8 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-11 px-3 py-2 rounded-full text-xs font-medium transition-colors border sm:shrink-0 sm:py-1.5 ${
                activeTab === tab.id
                  ? 'bg-white text-black border-white'
                  : 'bg-white/[0.045] text-white/60 border-white/[0.07] hover:bg-white/10 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="glass min-w-0 rounded-[22px] p-4 prose-container sm:p-5">
          {activeTab === 'tos' && <TermsOfService />}
          {activeTab === 'privacy' && <PrivacyPolicy />}
          {activeTab === 'aup' && <AcceptableUse />}
          {activeTab === 'dmca' && <DMCAPolicy />}
        </div>
      </main>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="mb-6 min-w-0">
      <h3 className="mb-2 break-words text-sm font-bold text-white/80">{title}</h3>
      <div className="space-y-2 break-words text-sm leading-relaxed text-white/50">{children}</div>
    </div>
  )
}

function LastUpdated() {
  return <p className="text-xs text-white/30 mb-6">Last updated: April 27, 2026</p>
}

function TermsOfService() {
  return (
    <div>
      <h2 className="text-xl font-bold mb-2">Terms of Service</h2>
      <LastUpdated />

      <Section title="1. Acceptance of Terms">
        <p>By accessing or using CUTRR ("the Service"), you agree to be bound by these Terms of Service. If you do not agree to these terms, do not use the Service.</p>
      </Section>

      <Section title="2. Description of Service">
        <p>CUTRR is a video hosting platform that allows users to upload, store, and share video files. The Service provides temporary video hosting with shareable links.</p>
      </Section>

      <Section title="3. User Accounts">
        <p>You may use the Service without an account (anonymous uploads) or create an account for extended features. You are responsible for maintaining the security of your account credentials.</p>
        <p>Anonymous uploads are retained for 14 days. Registered user uploads are retained for 6 months. After the retention period, videos are permanently deleted.</p>
      </Section>

      <Section title="4. User Content">
        <p>You retain ownership of any content you upload to the Service. By uploading content, you grant CUTRR a limited, non-exclusive license to store, process, and serve your content for the purpose of providing the Service.</p>
        <p>You are solely responsible for the content you upload and must ensure you have the right to share it.</p>
      </Section>

      <Section title="5. Prohibited Content">
        <p>You may not upload content that is illegal, infringes on intellectual property rights, contains malware, or violates our Acceptable Use Policy. We reserve the right to remove any content at our sole discretion.</p>
      </Section>

      <Section title="6. Service Availability">
        <p>CUTRR is provided "as is" without warranties of any kind. We do not guarantee uninterrupted availability or that your content will be preserved beyond the stated retention periods. We may modify or discontinue the Service at any time.</p>
      </Section>

      <Section title="7. Limitation of Liability">
        <p>CUTRR and its operators shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the Service. Our total liability shall not exceed the amount you paid for the Service (if any).</p>
      </Section>

      <Section title="8. Termination">
        <p>We may terminate or suspend your access to the Service at any time, with or without cause, with or without notice. Upon termination, your right to use the Service ceases immediately.</p>
      </Section>

      <Section title="9. Changes to Terms">
        <p>We reserve the right to modify these terms at any time. Continued use of the Service after changes constitutes acceptance of the new terms.</p>
      </Section>

      <Section title="10. Governing Law">
        <p>These terms are governed by the laws of the United States. Any disputes shall be resolved in the applicable courts.</p>
      </Section>
    </div>
  )
}

function PrivacyPolicy() {
  return (
    <div>
      <h2 className="text-xl font-bold mb-2">Privacy Policy</h2>
      <LastUpdated />

      <Section title="1. Information We Collect">
        <p><strong className="text-white/70">Account Users:</strong> Email address and hashed password when you create an account. We do not store plaintext passwords.</p>
        <p><strong className="text-white/70">Anonymous Users:</strong> We store video IDs in your browser's local storage to enable dashboard functionality. No personal information is collected.</p>
        <p><strong className="text-white/70">Uploaded Content:</strong> Video files you upload, along with metadata such as file name, file size, and upload date.</p>
      </Section>

      <Section title="2. Information We Do Not Collect">
        <p>We do not collect IP addresses for tracking purposes, use analytics or tracking cookies, sell or share your personal data with third parties, or monitor video view counts or viewer information.</p>
      </Section>

      <Section title="3. How We Use Your Information">
        <p>Your information is used solely to provide the Service: storing and serving your videos, authenticating your account, and displaying your uploaded videos in the dashboard.</p>
      </Section>

      <Section title="4. Data Storage">
        <p>Videos are stored on Bunny.net's CDN infrastructure. Account data is stored in a PostgreSQL database. All data is transmitted over HTTPS.</p>
      </Section>

      <Section title="5. Data Retention">
        <p>Anonymous uploads are automatically deleted after 14 days. Registered user uploads are automatically deleted after 6 months. Account data is retained until you request deletion.</p>
      </Section>

      <Section title="6. Data Deletion">
        <p>Registered users can delete individual videos from the dashboard at any time. To request full account deletion, contact us. Anonymous uploads are deleted automatically upon expiration.</p>
      </Section>

      <Section title="7. Third-Party Services">
        <p>We use the following third-party services to operate:</p>
        <p><strong className="text-white/70">Bunny.net</strong> — Video storage and CDN delivery.<br />
        <strong className="text-white/70">Neon</strong> — PostgreSQL database hosting.<br />
        <strong className="text-white/70">Render</strong> — Server hosting.<br />
        <strong className="text-white/70">ByetHost</strong> — Frontend hosting.</p>
        <p>Each of these services has their own privacy policies governing their handling of data.</p>
      </Section>

      <Section title="8. Children's Privacy">
        <p>The Service is not intended for children under 13. We do not knowingly collect information from children under 13.</p>
      </Section>

      <Section title="9. Changes to This Policy">
        <p>We may update this Privacy Policy from time to time. Changes will be reflected on this page with an updated date.</p>
      </Section>
    </div>
  )
}

function AcceptableUse() {
  return (
    <div>
      <h2 className="text-xl font-bold mb-2">Acceptable Use Policy</h2>
      <LastUpdated />

      <Section title="1. Purpose">
        <p>This Acceptable Use Policy (AUP) outlines what is and is not allowed when using CUTRR. By using the Service, you agree to comply with this policy.</p>
      </Section>

      <Section title="2. Permitted Use">
        <p>CUTRR is intended for sharing video content such as video edits (anime, gaming, IRL, etc.), creative projects and portfolios, personal videos you have the right to share, and any other lawful video content.</p>
      </Section>

      <Section title="3. Prohibited Content">
        <p>You may not upload, share, or distribute:</p>
        <p>
          - Content that infringes on copyright, trademark, or other intellectual property rights<br />
          - Child sexual abuse material (CSAM) or any content sexualizing minors<br />
          - Non-consensual intimate imagery<br />
          - Content that promotes terrorism or violent extremism<br />
          - Malware, viruses, or other harmful software disguised as video files<br />
          - Content that is illegal under United States federal or state law<br />
          - Spam or content uploaded solely for the purpose of abuse or harassment
        </p>
      </Section>

      <Section title="4. Prohibited Activities">
        <p>You may not:</p>
        <p>
          - Use the Service to distribute pirated films, TV shows, or other copyrighted media you do not own<br />
          - Attempt to circumvent storage limits or retention periods<br />
          - Use automated tools to mass-upload content<br />
          - Attempt to access other users' accounts or data<br />
          - Use the Service to host content for commercial purposes without permission<br />
          - Interfere with the Service's infrastructure or availability
        </p>
      </Section>

      <Section title="5. Enforcement">
        <p>We reserve the right to remove any content and terminate any account that violates this policy, without prior notice. Severe violations (such as CSAM) will be reported to the appropriate authorities.</p>
      </Section>

      <Section title="6. Reporting Violations">
        <p>If you encounter content on CUTRR that violates this policy, please report it so we can take appropriate action.</p>
      </Section>
    </div>
  )
}

function DMCAPolicy() {
  return (
    <div>
      <h2 className="text-xl font-bold mb-2">DMCA Policy</h2>
      <LastUpdated />

      <Section title="1. Overview">
        <p>CUTRR respects the intellectual property rights of others and complies with the Digital Millennium Copyright Act (DMCA). We will respond to valid notices of alleged copyright infringement.</p>
      </Section>

      <Section title="2. Filing a DMCA Takedown Notice">
        <p>If you believe content hosted on CUTRR infringes your copyright, you may submit a DMCA takedown notice containing:</p>
        <p>
          - Your physical or electronic signature<br />
          - Identification of the copyrighted work you claim is being infringed<br />
          - Identification of the material on CUTRR that you claim is infringing, including the URL<br />
          - Your contact information (name, address, phone number, email)<br />
          - A statement that you have a good faith belief the use is not authorized by the copyright owner<br />
          - A statement, under penalty of perjury, that the information in your notice is accurate and that you are the copyright owner or authorized to act on their behalf
        </p>
      </Section>

      <Section title="3. Counter-Notification">
        <p>If you believe your content was removed by mistake or misidentification, you may submit a counter-notification containing:</p>
        <p>
          - Your physical or electronic signature<br />
          - Identification of the material that was removed and where it appeared<br />
          - A statement under penalty of perjury that you have a good faith belief the material was removed by mistake<br />
          - Your name, address, and phone number<br />
          - A statement that you consent to the jurisdiction of your local federal court
        </p>
      </Section>

      <Section title="4. Repeat Infringers">
        <p>CUTRR will terminate the accounts of users who are determined to be repeat copyright infringers. We maintain a policy of addressing repeat infringement in accordance with the DMCA.</p>
      </Section>

      <Section title="5. Good Faith">
        <p>Please note that filing a false DMCA takedown notice may result in legal liability. Ensure your claim is legitimate before submitting a notice.</p>
      </Section>

      <Section title="6. Content Removal">
        <p>Upon receiving a valid DMCA takedown notice, we will promptly remove or disable access to the allegedly infringing content and notify the uploader (if applicable).</p>
      </Section>
    </div>
  )
}
