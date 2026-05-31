import { useEffect } from 'react'
import { useTheme } from '../contexts/ThemeContext'

// Helper to convert hex to RGB
const hexToRgb = (hex) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : '255, 255, 255'
}

export default function ThemeEffect() {
  const {
    colorMode,
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
    document.body.classList.toggle('mode-dark', colorMode !== 'light')
    document.body.classList.toggle('mode-light', colorMode === 'light')

    const activeBackgroundImage = backgroundImage

    // Apply background
    if (activeBackgroundImage) {
      const overlay =
        colorMode === 'light'
          ? 'linear-gradient(180deg, rgba(255, 255, 255, 0.58), rgba(238, 241, 244, 0.82))'
          : 'linear-gradient(180deg, rgba(2, 3, 8, 0.12), rgba(2, 3, 8, 0.52))'
      document.documentElement.style.setProperty('--custom-background-image', `url(${activeBackgroundImage})`)
      document.body.style.backgroundImage = `${overlay}, url(${activeBackgroundImage})`
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
      document.body.style.background = 'var(--page-bg)'
      document.body.style.backgroundAttachment = 'fixed'
      document.body.classList.remove('has-custom-background', 'background-blurred')
    }
  }, [colorMode, primaryColor, accentColor, backgroundImage, backgroundBlur, backgroundBlurAmount, siteBackgroundEnabled, isLoaded])

  return null
}
