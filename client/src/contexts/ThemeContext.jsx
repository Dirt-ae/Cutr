import { createContext, useContext, useState, useEffect } from 'react'

const ThemeContext = createContext()
const THEME_SETTINGS_VERSION = 3
const DEFAULT_BACKGROUND_BLUR_AMOUNT = 14

export const useTheme = () => {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}

export const ThemeProvider = ({ children }) => {
  const [colorMode, setColorMode] = useState('dark')
  const [primaryColor, setPrimaryColor] = useState('#ffffff')
  const [accentColor, setAccentColor] = useState('#ffffff')
  const [backgroundImage, setBackgroundImage] = useState(null)
  const [backgroundBlur, setBackgroundBlur] = useState(true)
  const [backgroundBlurAmount, setBackgroundBlurAmount] = useState(DEFAULT_BACKGROUND_BLUR_AMOUNT)
  const [siteBackgroundEnabled, setSiteBackgroundEnabled] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    // Load theme from localStorage
    const savedTheme = localStorage.getItem('cutr-theme')
    if (savedTheme) {
      const theme = JSON.parse(savedTheme)
      const usesCurrentDefaults = theme.version === THEME_SETTINGS_VERSION
      setColorMode(theme.colorMode === 'light' ? 'light' : 'dark')
      setPrimaryColor(theme.primaryColor || '#ffffff')
      setAccentColor(theme.accentColor || '#ffffff')
      setBackgroundImage(theme.backgroundImage || null)
      setBackgroundBlur(usesCurrentDefaults ? (theme.backgroundBlur ?? true) : true)
      setBackgroundBlurAmount(
        usesCurrentDefaults
          ? (theme.backgroundBlurAmount ?? DEFAULT_BACKGROUND_BLUR_AMOUNT)
          : DEFAULT_BACKGROUND_BLUR_AMOUNT
      )
      setSiteBackgroundEnabled(
        usesCurrentDefaults ? (theme.siteBackgroundEnabled ?? false) : false
      )
    }
    setIsLoaded(true)
  }, [])

  useEffect(() => {
    if (!isLoaded) return
    // Save theme to localStorage
    try {
      localStorage.setItem('cutr-theme', JSON.stringify({
        version: THEME_SETTINGS_VERSION,
        colorMode,
        primaryColor,
        accentColor,
        backgroundImage,
        backgroundBlur,
        backgroundBlurAmount,
        siteBackgroundEnabled
      }))
    } catch {
      setBackgroundImage(null)
    }
  }, [colorMode, primaryColor, accentColor, backgroundImage, backgroundBlur, backgroundBlurAmount, siteBackgroundEnabled, isLoaded])

  const toggleColorMode = () => {
    setColorMode((current) => (current === 'light' ? 'dark' : 'light'))
  }

  const updatePrimaryColor = (color) => {
    setPrimaryColor(color)
  }

  const updateAccentColor = (color) => {
    setAccentColor(color)
  }

  const updateBackgroundImage = (imageData) => {
    setBackgroundImage(imageData)
  }

  const toggleBackgroundBlur = () => {
    setBackgroundBlur(!backgroundBlur)
  }

  const updateBackgroundBlurAmount = (amount) => {
    setBackgroundBlurAmount(Number(amount))
  }

  const toggleSiteBackground = () => {
    setSiteBackgroundEnabled(!siteBackgroundEnabled)
  }

  const resetTheme = () => {
    setColorMode('dark')
    setPrimaryColor('#ffffff')
    setAccentColor('#ffffff')
    setBackgroundImage(null)
    setBackgroundBlur(true)
    setBackgroundBlurAmount(DEFAULT_BACKGROUND_BLUR_AMOUNT)
    setSiteBackgroundEnabled(false)
  }

  return (
    <ThemeContext.Provider
      value={{
        colorMode,
        primaryColor,
        accentColor,
        backgroundImage,
        backgroundBlur,
        backgroundBlurAmount,
        siteBackgroundEnabled,
        isLoaded,
        toggleColorMode,
        updatePrimaryColor,
        updateAccentColor,
        updateBackgroundImage,
        toggleBackgroundBlur,
        updateBackgroundBlurAmount,
        toggleSiteBackground,
        resetTheme
      }}
    >
      {children}
    </ThemeContext.Provider>
  )
}
