import React, { useEffect, useState, useCallback } from 'react'
import { AlbumStat, Tag } from './App'

interface Props {
  album: AlbumStat
  onClose: () => void
  onUpdate?: (updated: Partial<AlbumStat>) => void
}

export default function AlbumModal({ album, onClose, onUpdate }: Props) {
  const [tier, setTier] = useState<'top' | 'mid' | 'low' | 'hidden' | undefined>(album.tier)
  const [energy, setEnergy] = useState<'ambient' | 'moderate' | 'intense' | undefined>(album.energy)
  const [tags, setTags] = useState<string[]>(album.tags ?? [])
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [newTagInput, setNewTagInput] = useState('')
  const [saving, setSaving] = useState(false)

  const barColor = album.complete ? '#22c55e'
    : album.percentage >= 75 ? '#84cc16'
    : album.percentage >= 50 ? '#f59e0b'
    : album.percentage >= 25 ? '#f97316'
    : '#ef4444'

  // Build tracklist
  const listenedSet = new Set((album.listenedTracks || []).map(t => t.toLowerCase()))
  const allTracks = (album as any).allTracks || []
  const trackList = allTracks.length > 0 ? allTracks : album.listenedTracks || []

  // Fetch all tags for autocomplete
  useEffect(() => {
    fetch('/api/tags')
      .then(r => r.json())
      .then(setAllTags)
      .catch(console.error)
  }, [])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleTierChange = (newTier: 'top' | 'mid' | 'low' | 'hidden' | undefined) => {
    setTier(newTier)
    saveCategorization(newTier, undefined)
  }

  const saveCategorization = useCallback(async (newTier?: typeof tier, newEnergy?: typeof energy) => {
    setSaving(true)
    try {
      await fetch(`/api/albums/${encodeURIComponent(album.artist)}/${encodeURIComponent(album.album)}/categorization`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          tier: newTier !== undefined ? newTier : tier, 
          energy: newEnergy !== undefined ? newEnergy : energy 
        }),
      })
      onUpdate?.({ tier: newTier ?? tier, energy: newEnergy ?? energy })
    } catch (err) {
      console.error('Failed to save categorization:', err)
    } finally {
      setSaving(false)
    }
  }, [album.artist, album.album, tier, energy, onUpdate])

  const handleEnergyChange = (newEnergy: 'ambient' | 'moderate' | 'intense' | undefined) => {
    setEnergy(newEnergy)
    saveCategorization(undefined, newEnergy)
  }

  const addTag = async (tagName: string) => {
    const normalized = tagName.toLowerCase().trim()
    if (!normalized || tags.includes(normalized)) return
    
    try {
      const res = await fetch(`/api/albums/${encodeURIComponent(album.artist)}/${encodeURIComponent(album.album)}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagName: normalized }),
      })
      const data = await res.json()
      if (data.ok) {
        setTags([...tags, normalized])
        setNewTagInput('')
        // Refresh all tags list
        const tagsRes = await fetch('/api/tags')
        setAllTags(await tagsRes.json())
      }
    } catch (err) {
      console.error('Failed to add tag:', err)
    }
  }

  const removeTag = async (tagName: string) => {
    const tag = allTags.find(t => t.name === tagName)
    if (!tag) return
    
    try {
      await fetch(`/api/albums/${encodeURIComponent(album.artist)}/${encodeURIComponent(album.album)}/tags/${tag.id}`, {
        method: 'DELETE',
      })
      setTags(tags.filter(t => t !== tagName))
    } catch (err) {
      console.error('Failed to remove tag:', err)
    }
  }

  // Filter suggestions for autocomplete
  const suggestions = allTags
    .filter(t => !tags.includes(t.name) && t.name.includes(newTagInput.toLowerCase()))
    .slice(0, 5)

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.8)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#111', borderRadius: 12,
          maxWidth: 480, width: '100%', maxHeight: '90vh',
          overflow: 'auto', position: 'relative',
          border: '1px solid #2a2a2a',
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: 12, right: 12, zIndex: 2,
            background: 'rgba(0,0,0,0.6)', border: 'none', color: '#aaa',
            fontSize: 18, cursor: 'pointer', lineHeight: 1,
            width: 28, height: 28, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >✕</button>

        {/* Full-width album cover */}
        {album.imageUrl && (
          <div style={{ width: '100%', aspectRatio: '1', overflow: 'hidden', borderRadius: '12px 12px 0 0' }}>
            <img
              src={`/api/albumart?artist=${encodeURIComponent(album.artist)}&album=${encodeURIComponent(album.album)}`}
              alt={album.album}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          </div>
        )}

        {/* Info + controls */}
        <div style={{ padding: '20px 24px 24px' }}>
          {/* Title + artist */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 20, lineHeight: 1.2, marginBottom: 4 }}>{album.album}</div>
            <div style={{ color: '#888', fontSize: 14 }}>{album.artist}</div>
          </div>

          {/* Stats row */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20 }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
              background: `conic-gradient(${barColor} ${album.percentage}%, #2a2a2a ${album.percentage}%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <div style={{
                width: 30, height: 30, borderRadius: '50%', background: '#111',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, fontWeight: 700, color: barColor,
              }}>
                {album.totalTracks > 0 ? `${album.percentage}%` : '?'}
              </div>
            </div>
            <span style={{ fontSize: 13, color: '#888' }}>
              {album.listenedCount}{album.totalTracks > 0 ? `/${album.totalTracks}` : ''} tracks listened
            </span>
            <a
              href={album.spotifyId
                ? `spotify:album:${album.spotifyId}`
                : `spotify:search:${encodeURIComponent(`${album.artist} ${album.album}`)}`
              }
              title="Open in Spotify"
              style={{ fontSize: 18, textDecoration: 'none', marginLeft: 'auto' }}
            >🎧</a>
          </div>

          {/* Categorization section */}
          <div style={{ marginBottom: 20, padding: 16, background: '#1a1a1a', borderRadius: 8 }}>
            {/* Tier */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                Tier
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['top', 'mid', 'low', 'hidden'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => handleTierChange(tier === t ? undefined : t)}
                    disabled={saving}
                    style={{
                      padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
                      fontSize: 12, fontWeight: 600, textTransform: 'uppercase',
                      background: tier === t ? (t === 'top' ? '#22c55e' : t === 'mid' ? '#f59e0b' : t === 'low' ? '#666' : '#333') : '#2a2a2a',
                      color: tier === t ? (t === 'hidden' ? '#888' : '#000') : '#888',
                      opacity: saving ? 0.5 : 1,
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Energy */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                Energy
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['ambient', 'moderate', 'intense'] as const).map(e => (
                  <button
                    key={e}
                    onClick={() => handleEnergyChange(energy === e ? undefined : e)}
                    disabled={saving}
                    style={{
                      padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
                      fontSize: 12, fontWeight: 600,
                      background: energy === e ? '#3b82f6' : '#2a2a2a',
                      color: energy === e ? '#fff' : '#888',
                      opacity: saving ? 0.5 : 1,
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>

            {/* Tags */}
            <div>
              <div style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                Tags
              </div>
              
              {/* Current tags */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {tags.map(tag => (
                  <span
                    key={tag}
                    style={{
                      padding: '4px 8px', borderRadius: 4, fontSize: 11,
                      background: '#333', color: '#ccc',
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}
                  >
                    {tag}
                    <button
                      onClick={() => removeTag(tag)}
                      style={{
                        background: 'none', border: 'none', color: '#888',
                        cursor: 'pointer', fontSize: 12, padding: 0, lineHeight: 1,
                      }}
                    >×</button>
                  </span>
                ))}
                {tags.length === 0 && (
                  <span style={{ fontSize: 12, color: '#555' }}>No tags yet</span>
                )}
              </div>

              {/* Add tag input */}
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  placeholder="Add tag..."
                  value={newTagInput}
                  onChange={e => setNewTagInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newTagInput.trim()) {
                      addTag(newTagInput)
                    }
                  }}
                  style={{
                    width: '100%', padding: '8px 12px', borderRadius: 6,
                    border: '1px solid #333', background: '#222', color: '#e0e0e0',
                    fontSize: 13, outline: 'none',
                  }}
                />
                {/* Autocomplete suggestions */}
                {newTagInput && suggestions.length > 0 && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0,
                    background: '#222', border: '1px solid #333', borderRadius: 6,
                    marginTop: 4, overflow: 'hidden', zIndex: 10,
                  }}>
                    {suggestions.map(tag => (
                      <div
                        key={tag.id}
                        onClick={() => addTag(tag.name)}
                        style={{
                          padding: '8px 12px', cursor: 'pointer', fontSize: 13,
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#2a2a2a')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <span style={{ color: '#ccc' }}>{tag.name}</span>
                        <span style={{ color: '#555', fontSize: 11 }}>{tag.count} albums</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Tracklist */}
          {trackList.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                Tracklist
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {trackList.map((track: string, i: number) => {
                  const heard = listenedSet.has(track.toLowerCase())
                  return (
                    <div
                      key={track}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '6px 0',
                        opacity: heard ? 1 : 0.35,
                        borderBottom: '1px solid #1a1a1a',
                      }}
                    >
                      <span style={{ fontSize: 11, color: '#555', width: 18, textAlign: 'right', flexShrink: 0 }}>
                        {i + 1}
                      </span>
                      <span style={{ fontSize: 13, color: heard ? '#e0e0e0' : '#888', lineHeight: 1.3 }}>
                        {track}
                      </span>
                      {heard && (
                        <span style={{ marginLeft: 'auto', fontSize: 10, color: barColor, flexShrink: 0 }}>✓</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
