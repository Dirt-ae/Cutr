import { useEffect, useState, useCallback } from 'react'

export default function AdBlockNotice() {
  const [isBlocked, setIsBlocked] = useState(false)

  // 5. Multi-Layer Detection (Recommended)
  // Use several checks together. Only show the popup if 2 out of 3 checks fail.
  const runChecks = useCallback(async () => {
    let failedChecks = 0

    // Check 1: Hidden Bait Element
    // Create hidden elements with common ad-related names.
    const checkBait = await new Promise(resolve => {
      const bait = document.createElement('div')
      bait.className = 'ad ads advertisement banner-ad sponsor'
      bait.innerHTML = '&nbsp;'
      Object.assign(bait.style, { position: 'absolute', left: '-9999px', width: '10px', height: '10px' })
      document.body.appendChild(bait)
      
      setTimeout(() => {
        let blocked = false
        if (document.body.contains(bait)) {
          const cs = window.getComputedStyle(bait)
          // Blockers will inject display:none or visibility:hidden
          blocked = cs.display === 'none' || cs.visibility === 'hidden' || bait.offsetHeight === 0
        } else {
          blocked = true // Completely removed from DOM
        }
        try { bait.remove() } catch {}
        resolve(blocked)
      }, 100)
    })
    if (checkBait) failedChecks++

    // Check 2: Ad Script Loading Detection
    // Attempt to load files that look like ad scripts.
    const checkScript = await new Promise(resolve => {
      const adScripts = [
        'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
        'https://securepubads.g.doubleclick.net/tag/js/gpt.js',
        'https://s.amazon-adsystem.com/aax2/apstag.js',
        'https://cdn.adotmob.com/adotmob.js'
      ]

      let blockedCount = 0
      let completed = 0

      // If any script is hard-blocked (network error), we count it as a blocker active.
      adScripts.forEach(src => {
        const script = document.createElement('script')
        script.src = src
        script.async = true
        
        script.onload = () => {
          completed++
          // Check for uBlock Origin's specific surrogate fingerprint on adsbygoogle
          if (src.includes('adsbygoogle') && window.adsbygoogle) {
            // uBlock's surrogate often sets pauseAdRequests to 1
            if (window.adsbygoogle.pauseAdRequests === 1) {
              blockedCount++
            }
          }
          try { script.remove() } catch {}
          if (completed === adScripts.length) resolve(blockedCount > 0)
        }
        
        script.onerror = () => {
          completed++
          blockedCount++
          try { script.remove() } catch {}
          if (completed === adScripts.length) resolve(blockedCount > 0)
        }
        
        document.head.appendChild(script)
      })

      // Fallback timeout just in case
      setTimeout(() => resolve(blockedCount > 0), 2000)
    })
    if (checkScript) failedChecks++

    // Check 3: Ad Container Render Check (Revenue Verification)
    // Check if the ad iframe actually appeared and received dimensions.
    const checkContainer = await new Promise(resolve => {
      const iframe = document.createElement('iframe')
      iframe.id = 'google_ads_iframe_1'
      Object.assign(iframe.style, { position: 'absolute', left: '-9999px', width: '300px', height: '250px', border: 'none' })
      iframe.src = 'https://googleads.g.doubleclick.net/pagead/ads' // Known ad network endpoint
      document.body.appendChild(iframe)
      
      setTimeout(() => {
        let blocked = false
        if (document.body.contains(iframe)) {
          const cs = window.getComputedStyle(iframe)
          // Blockers often collapse empty/blocked iframes
          blocked = cs.display === 'none' || iframe.clientHeight === 0 || iframe.clientWidth === 0
        } else {
          blocked = true
        }
        try { iframe.remove() } catch {}
        resolve(blocked)
      }, 100)
    })
    if (checkContainer) failedChecks++

    console.log(`[AdBlock Diagnostics] Bait: ${checkBait} | Script: ${checkScript} | Container: ${checkContainer} => Total Failed: ${failedChecks}/3`)

    // Only show the popup if 2 out of 3 checks fail.
    return failedChecks >= 2
  }, [])

  useEffect(() => {
    let intervalId

    const performCheck = async () => {
      const detected = await runChecks()
      setIsBlocked(detected)
      
      if (detected) {
        // Disable scrolling when modal is active
        document.body.style.overflow = 'hidden'
      } else {
        document.body.style.overflow = ''
      }
    }

    // Initial check on mount
    performCheck()

    // Re-check every few seconds.
    // Automatically remove modal once ads become available.
    intervalId = setInterval(performCheck, 3500)

    return () => {
      clearInterval(intervalId)
      document.body.style.overflow = ''
    }
  }, [runChecks])

  if (!isBlocked) return null

  // Show centered modal with premium glassmorphism and animations
  return (
    <>
      <style>{`
        @keyframes pulseGlow {
          0% { filter: drop-shadow(0 0 8px rgba(255, 71, 87, 0.4)); transform: scale(1); }
          50% { filter: drop-shadow(0 0 20px rgba(255, 71, 87, 0.8)); transform: scale(1.05); }
          100% { filter: drop-shadow(0 0 8px rgba(255, 71, 87, 0.4)); transform: scale(1); }
        }
        @keyframes slideUpFade {
          0% { opacity: 0; transform: translateY(20px) scale(0.96); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes fadeInOverlay {
          from { opacity: 0; backdrop-filter: blur(0px); }
          to { opacity: 1; backdrop-filter: blur(16px); }
        }
        .adblock-modal-overlay {
          position: fixed; inset: 0; z-index: 999999;
          display: flex; align-items: center; justify-content: center;
          background-color: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          padding: 20px;
          animation: fadeInOverlay 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .adblock-modal-card {
          background: linear-gradient(145deg, rgba(28, 28, 30, 0.95), rgba(18, 18, 20, 0.98));
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 28px;
          padding: 48px 40px;
          max-width: 440px;
          width: 100%;
          text-align: center;
          color: white;
          box-shadow: 0 40px 80px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.06);
          animation: slideUpFade 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .adblock-icon-wrapper {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 88px;
          height: 88px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(255,71,87,0.15) 0%, rgba(255,71,87,0.05) 100%);
          margin-bottom: 28px;
          border: 1px solid rgba(255, 71, 87, 0.2);
          box-shadow: inset 0 0 20px rgba(255,71,87,0.1);
        }
        .adblock-icon {
          animation: pulseGlow 3s infinite cubic-bezier(0.4, 0, 0.2, 1);
        }
        .adblock-title {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: 28px;
          font-weight: 800;
          margin: 0 0 16px 0;
          letter-spacing: -0.5px;
          background: linear-gradient(180deg, #ffffff 0%, #a0a0a0 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .adblock-text {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: 15px;
          line-height: 1.6;
          color: #909090;
          margin: 0 0 40px 0;
        }
        .adblock-btn {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          background: #ffffff;
          color: #000000;
          border: none;
          border-radius: 14px;
          padding: 16px 24px;
          font-size: 16px;
          font-weight: 700;
          cursor: pointer;
          width: 100%;
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
          box-shadow: 0 4px 14px rgba(255,255,255,0.15);
        }
        .adblock-btn:hover {
          transform: translateY(-2px) scale(1.02);
          box-shadow: 0 8px 24px rgba(255,255,255,0.25);
          background: #f8f8f8;
        }
        .adblock-btn:active {
          transform: translateY(0) scale(0.98);
          box-shadow: 0 2px 8px rgba(255,255,255,0.1);
        }
      `}</style>

      <div role="dialog" aria-modal="true" className="adblock-modal-overlay">
        <div className="adblock-modal-card">
          <div className="adblock-icon-wrapper">
            <svg className="adblock-icon" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#ff4757" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
          </div>
          
          <h2 className="adblock-title">
            Ad Blocker Detected
          </h2>
          
          <p className="adblock-text">
            Please disable your ad blocker. We make money from ads to keep this site running.
          </p>

          <button 
            className="adblock-btn"
            onClick={() => window.location.reload()}
          >
            I've disabled my ad blocker
          </button>
        </div>
      </div>
    </>
  )
}
