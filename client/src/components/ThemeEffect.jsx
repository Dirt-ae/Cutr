import { useEffect } from 'react'
import { useTheme } from '../contexts/ThemeContext'

// Helper to convert hex to RGB
const hexToRgb = (hex) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : '255, 255, 255'
}

const SITE_BACKGROUND_IMAGE = '/sitebackground.png'

export default function ThemeEffect() {
  const {
    primaryColor,
    accentColor,
    backgroundImage,
    backgroundBlur,
    backgroundBlurAmount,
    siteBackgroundEnabled,
    isLoaded,
  } = useTheme()

  useEffect(() => {
    // Don't apply styles until theme is loaded from localStorage
    if (!isLoaded) return

    // Convert hex to RGB for opacity variants
    const primaryRgb = hexToRgb(primaryColor)
    const accentRgb = hexToRgb(accentColor)

    // Set CSS variables
    document.documentElement.style.setProperty('--primary-color', primaryColor)
    document.documentElement.style.setProperty('--primary-rgb', primaryRgb)
    document.documentElement.style.setProperty('--accent-color', accentColor)
    document.documentElement.style.setProperty('--accent-rgb', accentRgb)
    document.documentElement.style.setProperty('--background-blur-amount', `${backgroundBlurAmount}px`)
    document.body.classList.toggle('site-background-off', !siteBackgroundEnabled)

    const activeBackgroundImage = backgroundImage || (siteBackgroundEnabled ? SITE_BACKGROUND_IMAGE : null)

    // Apply background
    if (activeBackgroundImage) {
      document.documentElement.style.setProperty('--custom-background-image', `url(${activeBackgroundImage})`)
      document.body.style.backgroundImage = `linear-gradient(180deg, rgba(2, 3, 8, 0.12), rgba(2, 3, 8, 0.52)), url(${activeBackgroundImage})`
      document.body.style.backgroundSize = 'cover'
      document.body.style.backgroundPosition = 'center'
      document.body.style.backgroundAttachment = 'fixed'
      document.body.classList.add('has-custom-background')
      if (backgroundBlur) {
        document.body.classList.add('background-blurred')
      } else {
        document.body.classList.remove('background-blurred')
      }
    } else {
      document.documentElement.style.removeProperty('--custom-background-image')
      document.body.style.backgroundImage = ''
      document.body.style.background = 'linear-gradient(135deg, #0a0a0a 0%, #111 50%, #0a0a0a 100%)'
      document.body.style.backgroundAttachment = 'fixed'
      document.body.classList.remove('has-custom-background', 'background-blurred')
    }
  }, [primaryColor, accentColor, backgroundImage, backgroundBlur, backgroundBlurAmount, siteBackgroundEnabled, isLoaded])

  return null
}
