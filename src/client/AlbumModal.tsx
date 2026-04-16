import React, { useEffect, useState, useCallback } from 'react'
import { AlbumStat, Tag } from './App'

interface ArtistInfo {
  name: string
  imageUrl: string | null
  area?: string
  formedYear?: number
  tags: string[]
  disambiguation?: string
}

interface Props {
  album: AlbumStat
  onClose: () => void
  onUpdate?: (updated: Partial<AlbumStat>) => void
}

export default function AlbumModal({ album, onClose, onUpdate }: Props) {
  const [tier, setTier] = useState<'top' | 'mid' | 'low' | 'hidden' | 'bookmarked' | undefined>(album.tier)
  const [energy, setEnergy] = useState<'ambient' | 'moderate' | 'intense' | undefined>(album.energy)
  const [tags, setTags] = useState<string[]>(album.tags ?? [])
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [newTagInput, setNewTagInput] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [suggestedTags, setSuggestedTags] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [playMsg, setPlayMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [artistInfo, setArtistInfo] = useState<ArtistInfo | null>(null)
  const [artistLoading, setArtistLoading] = useState(true)

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

  // Fetch suggested tags from MusicBrainz + Last.fm when modal opens
  useEffect(() => {
    fetch(`/api/albums/${encodeURIComponent(album.artist)}/${encodeURIComponent(album.album)}/suggested-tags`)
      .then(r => r.json())
      .then(data => setSuggestedTags(data.tags ?? []))
      .catch(console.error)
  }, [album.artist, album.album])

  // Fetch artist info
  useEffect(() => {
    setArtistLoading(true)
    fetch(`/api/artists/${encodeURIComponent(album.artist)}/info`)
      .then(r => r.json())
      .then(data => setArtistInfo(data))
      .catch(console.error)
      .finally(() => setArtistLoading(false))
  }, [album.artist])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleTierChange = (newTier: 'top' | 'mid' | 'low' | 'hidden' | 'bookmarked' | undefined) => {
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
        const newTags = [...tags, normalized]
        setTags(newTags)
        setNewTagInput('')
        setHighlightedIndex(-1)
        onUpdate?.({ tags: newTags })
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
      const newTags = tags.filter(t => t !== tagName)
      setTags(newTags)
      onUpdate?.({ tags: newTags })
    } catch (err) {
      console.error('Failed to remove tag:', err)
    }
  }

  // Filter suggestions for autocomplete
  const suggestions = allTags
    .filter(t => !tags.includes(t.name) && t.name.includes(newTagInput.toLowerCase()))
    .slice(0, 5)

  const spotifyHref = album.spotifyId
    ? `spotify:album:${album.spotifyId}`
    : `spotify:search:${encodeURIComponent(`${album.artist} ${album.album}`)}`

  const handlePlay = async () => {
    if (playing) return
    setPlaying(true)
    setPlayMsg(null)
    let playSucceeded = false
    if (album.spotifyId) {
      try {
        const res = await fetch('/api/spotify/play', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ spotifyId: album.spotifyId }),
        })
        const data = await res.json()
        if (data.ok) {
          playSucceeded = true
          setPlayMsg({ text: 'Playing!', ok: true })
          setTimeout(() => setPlayMsg(null), 3000)
        }
      } catch {
        // fall through to open in Spotify
      }
    }
    if (!playSucceeded) {
      window.location.href = spotifyHref
    }
    setPlaying(false)
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4 sm:p-6"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-[#111] w-full max-w-3xl max-h-[90vh] flex border border-[#2a2a2a] relative overflow-hidden"
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-[10] bg-black/60 border-none text-[#aaa] text-lg cursor-pointer leading-none w-7 h-7 flex items-center justify-center"
        >✕</button>

        {/* Left column: album content */}
        <div className="w-1/2 overflow-y-auto border-r border-[#2a2a2a]">
          {/* Album cover */}
          {album.imageUrl && (
            <div className="w-full aspect-square overflow-hidden">
              <img
                src={`/api/albumart?artist=${encodeURIComponent(album.artist)}&album=${encodeURIComponent(album.album)}`}
                alt={album.album}
                className="w-full h-full object-cover block"
              />
            </div>
          )}

          {/* Album info + controls */}
          <div className="px-5 pt-4 pb-6">
            {/* Title + artist */}
            <div className="mb-3">
              <div className="font-bold text-[17px] leading-tight mb-1">{album.album}</div>
              <div className="text-[#888] text-sm">{album.artist}</div>
              {album.releaseYear && (
                <div className="text-[#555] text-xs mt-0.5">{album.releaseYear}</div>
              )}
            </div>

            {/* Stats row */}
            <div className="flex gap-3 items-center mb-4">
              <div
                className="w-9 h-9 shrink-0 flex items-center justify-center"
                style={{ background: `conic-gradient(${barColor} ${album.percentage}%, #2a2a2a ${album.percentage}%)` }}
              >
                <div
                  className="w-[26px] h-[26px] bg-[#111] flex items-center justify-center text-[8px] font-bold"
                  style={{ color: barColor }}
                >
                  {album.totalTracks > 0 ? `${album.percentage}%` : '?'}
                </div>
              </div>
              <span className="text-[12px] text-[#888]">
                {album.listenedCount}{album.totalTracks > 0 ? `/${album.totalTracks}` : ''} tracks
              </span>
              <div className="ml-auto">
                <button
                  onClick={handlePlay}
                  disabled={playing}
                  title="Play in Spotify"
                  className="w-7 h-7 flex items-center justify-center border border-[#1db954]/50 bg-[#1db954]/10 cursor-pointer disabled:opacity-50"
                >
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="#1db954">
                    <polygon points="2,1 13,7 2,13" />
                  </svg>
                </button>
              </div>
            </div>
            {playMsg && (
              <div className={`text-xs mb-3 px-3 py-1.5 ${playMsg.ok ? 'bg-[#14532d] text-[#86efac]' : 'bg-[#450a0a] text-[#fca5a5]'}`}>
                {playMsg.text}
              </div>
            )}

            {/* Categorization section */}
            <div className="mb-4 p-3 bg-[#1a1a1a]">
              {/* Tier */}
              <div className="mb-3">
                <div className="text-[10px] text-[#555] uppercase tracking-[0.08em] mb-2">Tier</div>
                <div className="flex gap-1 flex-wrap">
                  {(['top', 'mid', 'low', 'hidden', 'bookmarked'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => handleTierChange(tier === t ? undefined : t)}
                      disabled={saving}
                      className={`px-2.5 py-1 border-none cursor-pointer text-[10px] font-bold uppercase ${saving ? 'opacity-50' : ''} ${
                        tier === t
                          ? t === 'top' ? 'bg-[#22c55e] text-black'
                            : t === 'mid' ? 'bg-[#f59e0b] text-black'
                            : t === 'low' ? 'bg-[#666] text-black'
                            : t === 'bookmarked' ? 'bg-[#d4a574] text-black'
                            : 'bg-[#333] text-[#888]'
                          : 'bg-[#2a2a2a] text-[#888]'
                      }`}
                    >
                      {t === 'bookmarked' ? '🔖' : t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Energy */}
              <div className="mb-3">
                <div className="text-[10px] text-[#555] uppercase tracking-[0.08em] mb-2">Energy</div>
                <div className="flex gap-1">
                  {(['ambient', 'moderate', 'intense'] as const).map(e => (
                    <button
                      key={e}
                      onClick={() => handleEnergyChange(energy === e ? undefined : e)}
                      disabled={saving}
                      className={`px-2.5 py-1 border-none cursor-pointer text-[10px] font-bold ${saving ? 'opacity-50' : ''} ${energy === e ? 'bg-[#3b82f6] text-white' : 'bg-[#2a2a2a] text-[#888]'}`}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tags */}
              <div>
                <div className="text-[10px] text-[#555] uppercase tracking-[0.08em] mb-2">Tags</div>
                <div className="flex flex-wrap gap-1 mb-2">
                  {tags.map(tag => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 text-[11px] bg-[#333] text-[#ccc] flex items-center gap-1"
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
                    onChange={e => {
                      setNewTagInput(e.target.value)
                      setHighlightedIndex(-1)
                    }}
                    onKeyDown={e => {
                      const open = newTagInput.length > 0 && suggestions.length > 0
                      if (e.key === 'ArrowDown') {
                        e.preventDefault()
                        if (open) setHighlightedIndex(i => Math.min(i + 1, suggestions.length - 1))
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault()
                        if (open) setHighlightedIndex(i => Math.max(i - 1, -1))
                      } else if (e.key === 'Enter') {
                        e.preventDefault()
                        if (open && highlightedIndex >= 0) {
                          addTag(suggestions[highlightedIndex].name)
                        } else if (newTagInput.trim()) {
                          addTag(newTagInput)
                        }
                      } else if (e.key === 'Escape') {
                        if (open) {
                          e.stopPropagation()
                          setNewTagInput('')
                          setHighlightedIndex(-1)
                        }
                      }
                    }}
                    className="w-full px-3 py-1.5 border border-[#333] bg-[#222] text-[#e0e0e0] text-[12px] outline-none"
                  />
                  {newTagInput && suggestions.length > 0 && (
                    <div className="absolute top-full left-0 right-0 bg-[#222] border border-[#333] mt-1 overflow-hidden z-10">
                      {suggestions.map((tag, i) => (
                        <div
                          key={tag.id}
                          onClick={() => addTag(tag.name)}
                          onMouseEnter={() => setHighlightedIndex(i)}
                          onMouseLeave={() => setHighlightedIndex(-1)}
                          className={`px-3 py-1.5 cursor-pointer text-[12px] flex justify-between items-center ${i === highlightedIndex ? 'bg-[#2a2a2a]' : 'hover:bg-[#2a2a2a]'}`}
                        >
                          <span className={i === highlightedIndex ? 'text-white' : 'text-[#ccc]'}>{tag.name}</span>
                          <span className="text-[#555] text-[10px]">{tag.count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Suggested tags */}
                {suggestedTags.filter(t => !tags.includes(t)).length > 0 && (
                  <div className="mt-2">
                    <div className="text-[9px] text-[#444] uppercase tracking-[0.08em] mb-1">Suggested</div>
                    <div className="flex flex-wrap gap-1">
                      {suggestedTags.filter(t => !tags.includes(t)).map(tag => (
                        <button
                          key={tag}
                          onClick={() => addTag(tag)}
                          className="px-1.5 py-0.5 text-[10px] bg-[#1a1a1a] border border-[#2a2a2a] text-[#555] hover:text-[#aaa] hover:border-[#444] cursor-pointer transition-colors flex items-center gap-0.5"
                        >
                          <span className="text-[#3a3a3a]">+</span>
                          <span>{tag}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Tracklist */}
            {trackList.length > 0 && (
              <div>
                <div className="text-[10px] text-[#555] uppercase tracking-[0.08em] mb-2">
                  Tracklist
                </div>
                <div className="flex flex-col gap-0">
                  {trackList.map((track: string, i: number) => {
                    const heard = listenedSet.has(track.toLowerCase())
                    return (
                      <div
                        key={track}
                        className={`flex items-center gap-2.5 py-1 border-b border-[#1a1a1a] ${heard ? 'opacity-100' : 'opacity-[0.35]'}`}
                      >
                        <span className="text-[10px] text-[#555] w-[16px] text-right shrink-0">
                          {i + 1}
                        </span>
                        <span className={`text-[12px] leading-[1.3] ${heard ? 'text-[#e0e0e0]' : 'text-[#888]'}`}>
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

        {/* Right column: artist info */}
        <div className="w-1/2 overflow-y-auto flex flex-col">
          {artistLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-[#444] text-xs">Loading artist info...</div>
            </div>
          ) : artistInfo ? (
            <>
              {/* Artist image */}
              {artistInfo.imageUrl ? (
                <div className="w-full aspect-square overflow-hidden shrink-0">
                  <img
                    src={artistInfo.imageUrl}
                    alt={artistInfo.name}
                    className="w-full h-full object-cover block"
                  />
                </div>
              ) : (
                <div className="w-full aspect-square shrink-0 bg-[#1a1a1a] flex items-center justify-center">
                  <svg width="72" height="72" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="12" cy="8" r="4" fill="#333" />
                    <path d="M4 20c0-4 3.582-7 8-7s8 3 8 7" stroke="#333" strokeWidth="2" strokeLinecap="square" fill="none" />
                  </svg>
                </div>
              )}

              {/* Artist details */}
              <div className="px-5 pt-5 pb-6 flex-1">
                <div className="mb-4">
                  <div className="text-[10px] text-[#444] uppercase tracking-[0.08em] mb-2">Artist</div>
                  <div className="font-bold text-[18px] leading-tight mb-0.5">{artistInfo.name}</div>
                  {artistInfo.disambiguation && (
                    <div className="text-[#555] text-xs italic">{artistInfo.disambiguation}</div>
                  )}
                </div>

                {/* Location / Formed */}
                {(artistInfo.area || artistInfo.formedYear) && (
                  <div className="mb-4 flex flex-col gap-1.5">
                    {artistInfo.area && (
                      <div className="flex items-center gap-2">
                        <span className="text-[#444] text-[10px] w-[52px] shrink-0">Origin</span>
                        <span className="text-[#aaa] text-[13px]">{artistInfo.area}</span>
                      </div>
                    )}
                    {artistInfo.formedYear && (
                      <div className="flex items-center gap-2">
                        <span className="text-[#444] text-[10px] w-[52px] shrink-0">Formed</span>
                        <span className="text-[#aaa] text-[13px]">{artistInfo.formedYear}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Genre tags */}
                {artistInfo.tags.length > 0 && (
                  <div>
                    <div className="text-[10px] text-[#444] uppercase tracking-[0.08em] mb-2">Genres</div>
                    <div className="flex flex-wrap gap-1">
                      {artistInfo.tags.map(tag => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 text-[11px] border border-[#2a2a2a] text-[#666]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Empty state within artist panel */}
                {!artistInfo.area && !artistInfo.formedYear && artistInfo.tags.length === 0 && !artistInfo.disambiguation && (
                  <div className="text-[#444] text-xs mt-2">No additional info available.</div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-[#444] text-xs">No artist info found.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
