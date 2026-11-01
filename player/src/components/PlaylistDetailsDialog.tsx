import { useEffect, useRef, useState } from 'react'

interface Props {
  name: string
  description: string
  onSave: (details: { name: string; description: string }) => void
  onClose: () => void
}

/**
 * "Edit details" for a playlist you own. A real modal (dimmed background):
 * renaming is a focused task, unlike the queue, which you browse alongside.
 */
export function PlaylistDetailsDialog({ name, description, onSave, onClose }: Props) {
  const [draft, setDraft] = useState({ name, description })
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.select() // ready to type a new name straight away
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const trimmed = draft.name.trim()
  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Edit playlist details"
        onSubmit={(e) => {
          e.preventDefault()
          if (trimmed) onSave({ name: trimmed, description: draft.description.trim() })
        }}
      >
        <h2>Edit details</h2>
        <label className="field">
          <span>Name</span>
          <input
            ref={nameRef}
            value={draft.name}
            maxLength={100}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea
            rows={3}
            value={draft.description}
            maxLength={300}
            placeholder="Add an optional description"
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
          />
        </label>
        <div className="dialog-actions">
          <button type="button" className="pill-button outline" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="pill-button accent" disabled={!trimmed}>
            Save
          </button>
        </div>
      </form>
    </div>
  )
}
