import React, { useEffect, useState } from 'react'
import Timeline from './Timeline'
import AlbumModal from './AlbumModal'

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
  tier?: 'top' | 'mid' | 'low' | 'hidden'
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
  const [selectedAlbum, setSelectedAlbum] = useState<AlbumStat | null>(null)
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
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px' }}>
      {/* Header */}
      <div style={{ marginBottom: 28, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 4 }}>🎵 Listening Log</h1>
          <p style={{ color: '#666', fontSize: 13 }}>boytunewonder · album completion tracker</p>
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {data && !data.loading && (
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              style={{
                background: '#1a1a1a', border: '1px solid #333', color: '#666',
                padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13,
              }}
            >
              {refreshing ? '…' : '↻'}
            </button>
          )}
        </div>
      </div>

      {/* Stats bar */}
      {data && !data.loading && (
        <div style={{
          display: 'flex', gap: 24, marginBottom: 24,
          background: '#1a1a1a', borderRadius: 10, padding: '12px 18px',
          flexWrap: 'wrap', alignItems: 'center',
        }}>
          <Stat label="Total scrobbles" value={data.totalTracks.toLocaleString()} />
          <Stat label="Albums tracked" value={data.stats.length.toString()} />
          <Stat label="Need finishing" value={incompleteCount.toString()} color="#f59e0b" />
          <Stat label="Complete" value={completeCount.toString()} color="#22c55e" />
          {data.fetchedAt && (
            <span style={{ fontSize: 12, color: '#444', marginLeft: 'auto' }}>
              Updated {new Date(data.fetchedAt).toLocaleTimeString()}
            </span>
          )}
        </div>
      )}

      {/* Error state */}
      {data?.status === 'error' && (
        <div style={{
          background: '#1a1a1a', border: '1px solid #3a1a1a', borderRadius: 10,
          padding: 24, textAlign: 'center', marginBottom: 24, color: '#f87171',
        }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>⚠️</div>
          <p style={{ fontWeight: 600 }}>Something went wrong</p>
          <p style={{ fontSize: 13, marginTop: 4, color: '#888' }}>
            {data.progress || 'Database unavailable. Please try again later.'}
          </p>
        </div>
      )}

      {/* Loading state */}
      {data?.loading && (
        <div style={{
          background: '#1a1a1a', borderRadius: 10, padding: 24, textAlign: 'center',
          marginBottom: 24, color: '#888',
        }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>⏳</div>
          <p>Building your listening history…</p>
          <p style={{ fontSize: 13, marginTop: 4, color: '#555' }}>
            Fetching from Last.fm — this only happens once
          </p>
          {data.stats.length > 0 && (
            <p style={{ fontSize: 13, marginTop: 8, color: '#666' }}>
              {data.stats.length} albums found so far…
            </p>
          )}
        </div>
      )}

      {/* Initial loading */}
      {!data && (
        <div style={{ textAlign: 'center', color: '#555', padding: 60 }}>Loading…</div>
      )}

      {/* Search */}
      {data && !data.loading && (
        <div style={{ marginBottom: 20 }}>
          <input
            type="text"
            placeholder="Search albums or artists…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: '#1a1a1a', border: '1px solid #333', color: '#e0e0e0',
              borderRadius: 8, padding: '8px 14px', fontSize: 14,
              outline: 'none',
            }}
          />
        </div>
      )}

      {/* Timeline view */}
      {data && !data.loading && (
        <>
          {/* Visibility toggles */}
          <div style={{
            display: 'flex', gap: 16, marginBottom: 16,
            fontSize: 13, color: '#888',
          }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showUncategorized}
                onChange={e => setShowUncategorized(e.target.checked)}
                style={{ accentColor: '#666' }}
              />
              Show uncategorized
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showHidden}
                onChange={e => setShowHidden(e.target.checked)}
                style={{ accentColor: '#666' }}
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
      <div style={{ fontSize: 18, fontWeight: 700, color: color || '#e0e0e0' }}>{value}</div>
      <div style={{ fontSize: 12, color: '#555' }}>{label}</div>
    </div>
  )
}

