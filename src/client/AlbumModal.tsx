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
  const [playing, setPlaying] = useState(false)
  const [playMsg, setPlayMsg] = useState<{ text: string; ok: boolean } | null>(null)

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

  const handlePlay = async () => {
    if (!album.spotifyId || playing) return
    setPlaying(true)
    setPlayMsg(null)
    try {
      const res = await fetch('/api/spotify/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spotifyId: album.spotifyId }),
      })
      const data = await res.json()
      if (data.ok) {
        setPlayMsg({ text: 'Playing!', ok: true })
      } else {
        setPlayMsg({ text: data.error || 'Playback failed', ok: false })
      }
    } catch {
      setPlayMsg({ text: 'Network error', ok: false })
    } finally {
      setPlaying(false)
      setTimeout(() => setPlayMsg(null), 3000)
    }
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-6"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-[#111] rounded-xl max-w-[480px] w-full max-h-[90vh] overflow-auto relative border border-[#2a2a2a]"
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-[2] bg-black/60 border-none text-[#aaa] text-lg cursor-pointer leading-none w-7 h-7 rounded-full flex items-center justify-center"
        >✕</button>

        {/* Full-width album cover */}
        {album.imageUrl && (
          <div className="w-full aspect-square overflow-hidden rounded-t-xl">
            <img
              src={`/api/albumart?artist=${encodeURIComponent(album.artist)}&album=${encodeURIComponent(album.album)}`}
              alt={album.album}
              className="w-full h-full object-cover block"
            />
          </div>
        )}

        {/* Info + controls */}
        <div className="px-6 pt-5 pb-6">
          {/* Title + artist */}
          <div className="mb-3">
            <div className="font-bold text-xl leading-tight mb-1">{album.album}</div>
            <div className="text-[#888] text-sm">{album.artist}</div>
          </div>

          {/* Stats row */}
          <div className="flex gap-3 items-center mb-5">
            <div
              className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center"
              style={{ background: `conic-gradient(${barColor} ${album.percentage}%, #2a2a2a ${album.percentage}%)` }}
            >
              <div
                className="w-[30px] h-[30px] rounded-full bg-[#111] flex items-center justify-center text-[9px] font-bold"
                style={{ color: barColor }}
              >
                {album.totalTracks > 0 ? `${album.percentage}%` : '?'}
              </div>
            </div>
            <span className="text-[13px] text-[#888]">
              {album.listenedCount}{album.totalTracks > 0 ? `/${album.totalTracks}` : ''} tracks listened
            </span>
            <div className="ml-auto flex items-center gap-2">
              {album.spotifyId && (
                <button
                  onClick={handlePlay}
                  disabled={playing}
                  title="Play album in Spotify"
                  className="text-lg bg-transparent border-none cursor-pointer p-0 leading-none disabled:opacity-50"
                >
                  {playing ? '⏳' : '▶️'}
                </button>
              )}
              <a
                href={album.spotifyId
                  ? `spotify:album:${album.spotifyId}`
                  : `spotify:search:${encodeURIComponent(`${album.artist} ${album.album}`)}`
                }
                title="Open in Spotify"
                className="text-lg no-underline"
              >🎧</a>
            </div>
          </div>
          {playMsg && (
            <div className={`text-xs mb-3 px-3 py-1.5 rounded-md ${playMsg.ok ? 'bg-[#14532d] text-[#86efac]' : 'bg-[#450a0a] text-[#fca5a5]'}`}>
              {playMsg.text}
            </div>
          )}

          {/* Categorization section */}
          <div className="mb-5 p-4 bg-[#1a1a1a] rounded-lg">
            {/* Tier */}
            <div className="mb-4">
              <div className="text-[11px] text-[#555] uppercase tracking-[0.08em] mb-2">
                Tier
              </div>
              <div className="flex gap-1.5">
                {(['top', 'mid', 'low', 'hidden'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => handleTierChange(tier === t ? undefined : t)}
                    disabled={saving}
                    className={`px-3.5 py-1.5 rounded-md border-none cursor-pointer text-xs font-bold uppercase ${saving ? 'opacity-50' : ''} ${
                      tier === t
                        ? t === 'top' ? 'bg-[#22c55e] text-black'
                          : t === 'mid' ? 'bg-[#f59e0b] text-black'
                          : t === 'low' ? 'bg-[#666] text-black'
                          : 'bg-[#333] text-[#888]'
                        : 'bg-[#2a2a2a] text-[#888]'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Energy */}
            <div className="mb-4">
              <div className="text-[11px] text-[#555] uppercase tracking-[0.08em] mb-2">
                Energy
              </div>
              <div className="flex gap-1.5">
                {(['ambient', 'moderate', 'intense'] as const).map(e => (
                  <button
                    key={e}
                    onClick={() => handleEnergyChange(energy === e ? undefined : e)}
                    disabled={saving}
                    className={`px-3.5 py-1.5 rounded-md border-none cursor-pointer text-xs font-bold ${saving ? 'opacity-50' : ''} ${energy === e ? 'bg-[#3b82f6] text-white' : 'bg-[#2a2a2a] text-[#888]'}`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>

            {/* Tags */}
            <div>
              <div className="text-[11px] text-[#555] uppercase tracking-[0.08em] mb-2">
                Tags
              </div>

              {/* Current tags */}
              <div className="flex flex-wrap gap-1.5 mb-2.5">
                {tags.map(tag => (
                  <span
                    key={tag}
                    className="px-2 py-1 rounded text-[11px] bg-[#333] text-[#ccc] flex items-center gap-1.5"
                  >
                    {tag}
                    <button
                      onClick={() => removeTag(tag)}
                      className="bg-transparent border-none text-[#888] cursor-pointer text-xs p-0 leading-none"
                    >×</button>
                  </span>
                ))}
                {tags.length === 0 && (
                  <span className="text-xs text-[#555]">No tags yet</span>
                )}
              </div>

              {/* Add tag input */}
              <div className="relative">
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
                  className="w-full px-3 py-2 rounded-md border border-[#333] bg-[#222] text-[#e0e0e0] text-[13px] outline-none"
                />
                {/* Autocomplete suggestions */}
                {newTagInput && suggestions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 bg-[#222] border border-[#333] rounded-md mt-1 overflow-hidden z-10">
                    {suggestions.map(tag => (
                      <div
                        key={tag.id}
                        onClick={() => addTag(tag.name)}
                        className="px-3 py-2 cursor-pointer text-[13px] flex justify-between items-center hover:bg-[#2a2a2a]"
                      >
                        <span className="text-[#ccc]">{tag.name}</span>
                        <span className="text-[#555] text-[11px]">{tag.count} albums</span>
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
              <div className="text-[11px] text-[#555] uppercase tracking-[0.08em] mb-2.5">
                Tracklist
              </div>
              <div className="flex flex-col gap-0.5">
                {trackList.map((track: string, i: number) => {
                  const heard = listenedSet.has(track.toLowerCase())
                  return (
                    <div
                      key={track}
                      className={`flex items-center gap-3 py-1.5 border-b border-[#1a1a1a] ${heard ? 'opacity-100' : 'opacity-[0.35]'}`}
                    >
                      <span className="text-[11px] text-[#555] w-[18px] text-right shrink-0">
                        {i + 1}
                      </span>
                      <span className={`text-[13px] leading-[1.3] ${heard ? 'text-[#e0e0e0]' : 'text-[#888]'}`}>
                        {track}
                      </span>
                      {heard && (
                        <span className="ml-auto text-[10px] shrink-0" style={{ color: barColor }}>✓</span>
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
