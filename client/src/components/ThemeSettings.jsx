import { useState } from 'react'
import { X, Palette, Image, RotateCcw } from 'lucide-react'
import Modal from './Modal'
import { useTheme } from '../contexts/ThemeContext'

const PRESETS = [
  { name: 'Default', primary: '#ffffff', accent: '#ffffff' },
  { name: 'Ocean', primary: '#38bdf8', accent: '#7dd3fc' },
  { name: 'Purple', primary: '#a78bfa', accent: '#c4b5fd' },
  { name: 'Forest', primary: '#4ade80', accent: '#86efac' },
  { name: 'Rose', primary: '#fb7185', accent: '#fda4af' },
  { name: 'Amber', primary: '#fbbf24', accent: '#fcd34d' },
]

export default function ThemeSettings({ isOpen, onClose, user }) {
  const {
    primaryColor,
    accentColor,
    backgroundImage,
    backgroundBlur,
    updatePrimaryColor,
    updateAccentColor,
    updateBackgroundImage,
    toggleBackgroundBlur,
    resetTheme
  } = useTheme()

  const [tempPrimary, setTempPrimary] = useState(primaryColor)
  const [tempAccent, setTempAccent] = useState(accentColor)
  const [imageError, setImageError] = useState('')

  const handleSave = () => {
    updatePrimaryColor(tempPrimary)
    updateAccentColor(tempAccent)
    onClose()
  }

  const handlePresetClick = (preset) => {
    setTempPrimary(preset.primary)
    setTempAccent(preset.accent)
    updatePrimaryColor(preset.primary)
    updateAccentColor(preset.accent)
  }

  const handlePrimaryChange = (val) => {
    setTempPrimary(val)
    updatePrimaryColor(val)
  }

  const handleAccentChange = (val) => {
    setTempAccent(val)
    updateAccentColor(val)
  }

  const resizeBackgroundImage = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read that image.'))
    reader.onload = () => {
      const img = new window.Image()
      img.onerror = () => reject(new Error('Could not load that image.'))
      img.onload = () => {
        const maxSize = 1920
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
        const width = Math.max(1, Math.round(img.width * scale))
        const height = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })

  const handleImageUpload = async (e) => {
    const file = e.target.files[0]
    if (file) {
      setImageError('')
      try {
        const imageData = await resizeBackgroundImage(file)
        updateBackgroundImage(imageData)
      } catch (error) {
        setImageError(error.message || 'Background image failed to upload.')
        e.target.value = ''
      }
    }
  }

  const handleReset = () => {
    resetTheme()
    setTempPrimary('#ffffff')
    setTempAccent('#ffffff')
  }

  const removeBackground = () => {
    updateBackgroundImage(null)
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Theme Settings" size="md">
      <div className="space-y-4">
        {/* Presets */}
        <div>
          <label className="flex items-center gap-2 text-sm text-white/70 mb-2">
            <Palette size={16} />
            Presets
          </label>
          <div className="grid grid-cols-3 gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.name}
                onClick={() => handlePresetClick(preset)}
                className="flex flex-col items-center gap-1 p-2 rounded glass hover:bg-white/10 transition-colors"
              >
                <div className="flex gap-1">
                  <div
                    className="w-4 h-4 rounded-full"
                    style={{ backgroundColor: preset.primary }}
                  />
                  <div
                    className="w-4 h-4 rounded-full"
                    style={{ backgroundColor: preset.accent }}
                  />
                </div>
                <span className="text-xs text-white/60">{preset.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Primary Color */}
        <div>
          <label className="flex items-center gap-2 text-sm text-white/70 mb-2">
            <Palette size={16} />
            Primary Color
          </label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={tempPrimary}
              onChange={(e) => handlePrimaryChange(e.target.value)}
              className="w-12 h-12 rounded cursor-pointer border-0"
            />
            <input
              type="text"
              value={tempPrimary}
              onChange={(e) => handlePrimaryChange(e.target.value)}
              className="flex-1 bg-black/30 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30"
              placeholder="#ffffff"
            />
          </div>
        </div>

        {/* Accent Color */}
        <div>
          <label className="flex items-center gap-2 text-sm text-white/70 mb-2">
            <Palette size={16} />
            Accent Color
          </label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={tempAccent}
              onChange={(e) => handleAccentChange(e.target.value)}
              className="w-12 h-12 rounded cursor-pointer border-0"
            />
            <input
              type="text"
              value={tempAccent}
              onChange={(e) => handleAccentChange(e.target.value)}
              className="flex-1 bg-black/30 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30"
              placeholder="#ffffff"
            />
          </div>
        </div>

        {/* Background Image - accounts only */}
        {user ? (
          <>
            <div>
              <label className="flex items-center gap-2 text-sm text-white/70 mb-2">
                <Image size={16} />
                Background Image
              </label>
              <div className="space-y-2">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  style={{background: 'transparent'}}
                  className="w-full text-xs text-white/60"
                />
                {imageError && <p className="text-xs text-red-400">{imageError}</p>}
                {backgroundImage && (
                  <div className="flex items-center gap-2">
                    <img
                      src={backgroundImage}
                      alt="Background preview"
                      className="w-20 h-12 object-cover rounded"
                    />
                    <button
                      onClick={removeBackground}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Background Blur */}
            {backgroundImage && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-white/70">Blur Background</span>
                <button
                  onClick={toggleBackgroundBlur}
                  style={{background: backgroundBlur ? 'var(--primary-color)' : 'rgba(255,255,255,0.2)'}}
                  className="w-12 h-6 rounded-full transition-colors"
                >
                  <div className={`w-5 h-5 rounded-full bg-black transition-transform ${backgroundBlur ? 'translate-x-6' : 'translate-x-0.5'}`} />
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="glass rounded-lg p-3 text-center">
            <p className="text-xs text-white/40">Custom background is available for account holders.</p>
            <a href="/register" className="text-xs text-accent mt-1 inline-block">Create a free account →</a>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-4 border-t border-white/10">
          <button
            onClick={handleReset}
            className="flex items-center gap-1 px-3 py-2 text-sm text-white/60 hover:text-white transition-colors"
          >
            <RotateCcw size={14} />
            Reset
          </button>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-white/60 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm bg-white text-black rounded-lg hover:bg-white/90 transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </Modal>
  )
}
