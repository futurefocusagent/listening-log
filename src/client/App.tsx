import React, { useEffect, useState } from 'react'
import Timeline from './Timeline'
import AlbumModal from './AlbumModal'
import { useAlbumModal } from './useAlbumModal'

export interface AlbumStat {
  album: string
  artist: string
  totalTracks: number
  listenedTracks: string[]
  listenedCount: number
  percentage: number
  complete: boolean
  imageUrl?: string
  spotifyId?: string
  releaseYear?: number
  tier?: 'top' | 'mid' | 'low' | 'hidden' | 'bookmarked'
  energy?: 'ambient' | 'moderate' | 'intense'
  tags?: string[]
  tierChangedAt?: string
}

export interface Tag {
  id: number
  name: string
  count: number
}

interface ApiResponse {
  loading: boolean
  status: string
  progress: string
  stats: AlbumStat[]
  totalTracks: number
  fetchedAt: string | null
}

export default function App() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [search, setSearch] = useState('')
  const [selectedAlbum, setSelectedAlbum] = useAlbumModal(data?.stats ?? [])
  const [showHidden, setShowHidden] = useState(false)
  const [showUncategorized, setShowUncategorized] = useState(false)

  useEffect(() => {
    fetch('/api/stats')
      .then(r => r.json())
      .then(setData)
      .catch(console.error)
  }, [])

  // Poll while loading
  useEffect(() => {
    if (!data?.loading) return
    const interval = setInterval(() => {
      fetch('/api/stats')
        .then(r => r.json())
        .then(setData)
        .catch(console.error)
    }, 5000)
    return () => clearInterval(interval)
  }, [data?.loading])

  const searchActive = search.trim().length > 0

  return (
    <div className="max-w-[960px] mx-auto px-4 py-5">
      {/* Initial loading - only show when no data at all */}
      {!data && (
        <div className="text-center text-[#555] p-[60px]">Loading…</div>
      )}

      {/* Loading state - only during initial fetch when no albums yet */}
      {data?.loading && data.stats.length === 0 && (
        <div className="bg-[#1a1a1a] p-6 text-center mb-6 text-[#888]">
          <div className="text-2xl mb-2">⏳</div>
          <p>Building your listening history…</p>
          <p className="text-[13px] mt-1 text-[#555]">
            Fetching from Last.fm — this only happens once
          </p>
        </div>
      )}

      {/* Search */}
      {data && !data.loading && (
        <div className="mb-5">
          <input
            type="text"
            placeholder="Search albums or artists…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-[#1a1a1a] border border-[#333] text-[#e0e0e0] px-[14px] py-2 text-sm outline-none"
          />
        </div>
      )}

      {/* Timeline view */}
      {data && !data.loading && (
        <>
          {/* Visibility toggles */}
          <div className="flex gap-4 mb-4 text-[13px] text-[#888]">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={showUncategorized}
                onChange={e => setShowUncategorized(e.target.checked)}
                className="accent-[#666]"
              />
              Show uncategorized
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={showHidden}
                onChange={e => setShowHidden(e.target.checked)}
                className="accent-[#666]"
              />
              Show hidden
            </label>
          </div>
          <Timeline
            stats={data.stats.filter(a => {
              if (searchActive) {
                const q = search.toLowerCase()
                return a.album.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q)
              }
              if (a.tier === 'hidden' && !showHidden) return false
              if (!a.tier && !showUncategorized) return false
              return true
            })}
            allStats={data.stats}
            onAlbumClick={setSelectedAlbum}
          />
        </>
      )}

      {/* Album detail modal */}
      {selectedAlbum && (
        <AlbumModal
          key={`${selectedAlbum.artist}|||${selectedAlbum.album}`}
          album={selectedAlbum}
          allStats={data?.stats}
          onNavigate={setSelectedAlbum}
          onClose={() => setSelectedAlbum(null)}
          onUpdate={(updated) => {
            setSelectedAlbum(prev => prev ? { ...prev, ...updated } : null)
            setData(prev => {
              if (!prev) return prev
              return {
                ...prev,
                stats: prev.stats.map(s =>
                  s.artist === selectedAlbum.artist && s.album === selectedAlbum.album
                    ? { ...s, ...updated }
                    : s
                )
              }
            })
          }}
        />
      )}
    </div>
  )
}

