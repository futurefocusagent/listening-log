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
  const [refreshing, setRefreshing] = useState(false)
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

  const handleRefresh = async () => {
    setRefreshing(true)
    await fetch('/api/refresh')
    const res = await fetch('/api/stats')
    setData(await res.json())
    setRefreshing(false)
  }

  const searchActive = search.trim().length > 0

  const incompleteCount = data?.stats.filter(a => !a.complete).length ?? 0
  const completeCount = data?.stats.filter(a => a.complete).length ?? 0

  return (
    <div className="max-w-[960px] mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-7 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[26px] font-bold mb-1">🎵 Listening Log</h1>
          <p className="text-[#666] text-[13px]">boytunewonder · album completion tracker</p>
        </div>
        <div className="flex gap-2 items-center">
          <a
            href="/recent"
            className="text-[13px] text-[#666] hover:text-[#e0e0e0] transition-colors px-[10px] py-[6px]"
          >
            Recent
          </a>
          {data && !data.loading && (
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="bg-[#1a1a1a] border border-[#333] text-[#666] px-[10px] py-[6px] rounded-md cursor-pointer text-[13px]"
            >
              {refreshing ? '…' : '↻'}
            </button>
          )}
        </div>
      </div>

      {/* Stats bar */}
      {data && !data.loading && (
        <div className="flex gap-6 mb-6 bg-[#1a1a1a] rounded-[10px] px-[18px] py-3 flex-wrap items-center">
          <Stat label="Total scrobbles" value={data.totalTracks.toLocaleString()} />
          <Stat label="Albums tracked" value={data.stats.length.toString()} />
          <Stat label="Need finishing" value={incompleteCount.toString()} color="#f59e0b" />
          <Stat label="Complete" value={completeCount.toString()} color="#22c55e" />
          {data.fetchedAt && (
            <span className="text-xs text-[#444] ml-auto">
              Updated {new Date(data.fetchedAt).toLocaleTimeString()}
            </span>
          )}
        </div>
      )}

      {/* Error state */}
      {data?.status === 'error' && (
        <div className="bg-[#1a1a1a] border border-[#3a1a1a] rounded-[10px] p-6 text-center mb-6 text-[#f87171]">
          <div className="text-2xl mb-2">⚠️</div>
          <p className="font-semibold">Something went wrong</p>
          <p className="text-[13px] mt-1 text-[#888]">
            {data.progress || 'Database unavailable. Please try again later.'}
          </p>
        </div>
      )}

      {/* Loading state */}
      {data?.loading && (
        <div className="bg-[#1a1a1a] rounded-[10px] p-6 text-center mb-6 text-[#888]">
          <div className="text-2xl mb-2">⏳</div>
          <p>Building your listening history…</p>
          <p className="text-[13px] mt-1 text-[#555]">
            Fetching from Last.fm — this only happens once
          </p>
          {data.stats.length > 0 && (
            <p className="text-[13px] mt-2 text-[#666]">
              {data.stats.length} albums found so far…
            </p>
          )}
        </div>
      )}

      {/* Initial loading */}
      {!data && (
        <div className="text-center text-[#555] p-[60px]">Loading…</div>
      )}

      {/* Now Playing */}
      {data && !data.loading && (
        <NowPlaying albums={data.stats} onAlbumClick={setSelectedAlbum} />
      )}

      {/* Search */}
      {data && !data.loading && (
        <div className="mb-5">
          <input
            type="text"
            placeholder="Search albums or artists…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-[#1a1a1a] border border-[#333] text-[#e0e0e0] rounded-lg px-[14px] py-2 text-sm outline-none"
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
          album={selectedAlbum} 
          onClose={() => setSelectedAlbum(null)}
          onUpdate={(updated) => {
            // Update both the selected album and the data array
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

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-lg font-bold" style={{ color: color || '#e0e0e0' }}>{value}</div>
      <div className="text-xs text-[#555]">{label}</div>
    </div>
  )
}

interface NowPlayingTrack {
  name: string
  artist: string
  album: string
  albumArt: string | null
  progress: number
  duration: number
}

interface NowPlayingProps {
  albums: AlbumStat[]
  onAlbumClick: (album: AlbumStat) => void
}

function NowPlaying({ albums, onAlbumClick }: NowPlayingProps) {
  const [track, setTrack] = useState<NowPlayingTrack | null>(null)

  useEffect(() => {
    const poll = () => {
      fetch('/api/now-playing')
        .then(r => r.json())
        .then((d: { playing: boolean; track?: NowPlayingTrack }) => {
          setTrack(d.playing && d.track ? d.track : null)
        })
        .catch(() => {})
    }
    poll()
    const interval = setInterval(poll, 15000)
    return () => clearInterval(interval)
  }, [])

  if (!track) return null

  const pct = track.duration > 0 ? Math.min(100, (track.progress / track.duration) * 100) : 0

  const matchedAlbum = track
    ? albums.find(a =>
        a.artist.toLowerCase() === track.artist.toLowerCase() &&
        a.album.toLowerCase() === track.album.toLowerCase()
      )
    : null

  return (
    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-3 mb-5 flex flex-row items-center gap-3">
      {track.albumArt && (
        <img
          src={track.albumArt}
          alt=""
          onClick={matchedAlbum ? () => onAlbumClick(matchedAlbum) : undefined}
          className={`w-[110px] h-[110px] rounded-md shrink-0 object-cover block ${matchedAlbum ? 'cursor-pointer' : 'cursor-default'}`}
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-[10px] text-[#1db954] tracking-[0.08em] font-semibold mb-0.5">
          NOW PLAYING
        </div>
        <div className="text-sm font-semibold text-[#e0e0e0] truncate">
          {track.name}
        </div>
        <div className="text-xs text-[#888] truncate">
          {track.artist}{matchedAlbum?.releaseYear ? ` · ${matchedAlbum.releaseYear}` : ''}
        </div>
        {track.duration > 0 && (
          <div className="mt-1.5 h-0.5 bg-[#2a2a2a] rounded-[1px]">
            <div className="h-full bg-[#1db954] rounded-[1px]" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
    </div>
  )
}

