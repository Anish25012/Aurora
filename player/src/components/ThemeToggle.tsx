import { Moon, Sun } from 'lucide-react'
import type { CSSProperties, MouseEvent } from 'react'
import type { Theme } from '../theme/theme'

const OPTIONS: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
]

interface Props {
  theme: Theme
  onChange: (theme: Theme, origin: { x: number; y: number }) => void
}

/** An Apple-style segmented control (Light | Dark) with a sliding highlight. */
export function ThemeToggle({ theme, onChange }: Props) {
  const index = OPTIONS.findIndex((o) => o.value === theme)

  const choose = (value: Theme) => (event: MouseEvent<HTMLButtonElement>) => {
    // The new theme spreads out from the middle of the button that was clicked.
    const rect = event.currentTarget.getBoundingClientRect()
    onChange(value, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
  }

  return (
    <div className="segmented" role="radiogroup" aria-label="Appearance" style={{ '--index': index } as CSSProperties}>
      <span className="segmented-thumb" aria-hidden />
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          className="segmented-option"
          onClick={choose(value)}
        >
          <Icon size={13} aria-hidden />
          {label}
        </button>
      ))}
    </div>
  )
}
