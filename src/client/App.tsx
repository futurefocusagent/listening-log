import React, { useEffect, useState, useMemo } from 'react'

interface AlbumStat {
  album: string
  artist: string
  totalTracks: number
  listenedTracks: string[]
  listenedCount: number
  percentage: number
  complete: boolean
  imageUrl?: string
}

interface ApiResponse {
  loading: boolean
  stats: AlbumStat[]
  totalTracks: number
  fetchedAt: string | null
}

type FilterMode = 'all' | 'incomplete' | 'complete'

export default function App() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [filter, setFilter] = useState<FilterMode>('incomplete')
  const [search, setSearch] = useState('')
  const [refreshing, setRefreshing] = useState(false)

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

  const filtered = useMemo(() => {
    if (!data?.stats) return []
    let list = data.stats
    if (filter === 'incomplete') list = list.filter(a => !a.complete)
    if (filter === 'complete') list = list.filter(a => a.complete)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(a =>
        a.album.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q)
      )
    }
    return list
  }, [data, filter, search])

  const incompleteCount = data?.stats.filter(a => !a.complete).length ?? 0
  const completeCount = data?.stats.filter(a => a.complete).length ?? 0

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px' }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>
          🎵 Listening Log
        </h1>
        <p style={{ color: '#888', fontSize: 14 }}>
          boytunewonder · album completion tracker
        </p>
      </div>

      {/* Stats bar */}
      {data && !data.loading && (
        <div style={{
          display: 'flex', gap: 24, marginBottom: 24,
          background: '#1a1a1a', borderRadius: 10, padding: '14px 20px',
          flexWrap: 'wrap', alignItems: 'center'
        }}>
          <Stat label="Total scrobbles" value={data.totalTracks.toLocaleString()} />
          <Stat label="Albums tracked" value={data.stats.length.toString()} />
          <Stat label="Need finishing" value={incompleteCount.toString()} color="#f59e0b" />
          <Stat label="Complete" value={completeCount.toString()} color="#22c55e" />
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            {data.fetchedAt && (
              <span style={{ fontSize: 12, color: '#555' }}>
                Updated {new Date(data.fetchedAt).toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={handleRefresh}
              disabled={refreshing || data.loading}
              style={{
                background: '#2a2a2a', border: '1px solid #333', color: '#ccc',
                padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13
              }}
            >
              {refreshing ? 'Refreshing…' : '↻ Refresh'}
            </button>
          </div>
        </div>
      )}

      {/* Loading state */}
      {data?.loading && (
        <div style={{
          background: '#1a1a1a', borderRadius: 10, padding: 24, textAlign: 'center',
          marginBottom: 24, color: '#888'
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

      {/* Controls */}
      {data && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['incomplete', 'all', 'complete'] as FilterMode[]).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  background: filter === f ? '#fff' : '#1a1a1a',
                  color: filter === f ? '#000' : '#aaa',
                  border: '1px solid #333', borderRadius: 6,
                  padding: '6px 14px', cursor: 'pointer', fontSize: 13,
                  fontWeight: filter === f ? 600 : 400,
                }}
              >
                {f === 'incomplete' ? `Unfinished (${incompleteCount})`
                  : f === 'complete' ? `Complete (${completeCount})`
                  : `All (${data.stats.length})`}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Search albums or artists…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              background: '#1a1a1a', border: '1px solid #333', color: '#e0e0e0',
              borderRadius: 6, padding: '6px 12px', fontSize: 13, flex: 1, minWidth: 200,
              outline: 'none',
            }}
          />
        </div>
      )}

      {/* Album list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map(album => (
          <AlbumCard key={`${album.artist}|||${album.album}`} album={album} />
        ))}
        {filtered.length === 0 && data && !data.loading && (
          <div style={{ textAlign: 'center', color: '#555', padding: 40 }}>
            No albums found
          </div>
        )}
        {!data && (
          <div style={{ textAlign: 'center', color: '#555', padding: 40 }}>
            Loading…
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || '#e0e0e0' }}>{value}</div>
      <div style={{ fontSize: 12, color: '#666' }}>{label}</div>
    </div>
  )
}

function AlbumCard({ album }: { album: AlbumStat }) {
  const [expanded, setExpanded] = useState(false)

  const barColor = album.complete ? '#22c55e'
    : album.percentage >= 75 ? '#84cc16'
    : album.percentage >= 50 ? '#f59e0b'
    : album.percentage >= 25 ? '#f97316'
    : '#ef4444'

  return (
    <div
      style={{
        background: '#1a1a1a',
        border: `1px solid ${album.complete ? '#1a3a1a' : '#222'}`,
        borderRadius: 10,
        padding: '14px 16px',
        cursor: 'pointer',
      }}
      onClick={() => setExpanded(e => !e)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Album art or completion ring */}
        <div style={{ position: 'relative', width: 48, height: 48, flexShrink: 0 }}>
          {album.imageUrl ? (
            <img
              src={`/api/albumart?artist=${encodeURIComponent(album.artist)}&album=${encodeURIComponent(album.album)}`}
              alt={album.album}
              style={{ width: 48, height: 48, borderRadius: 6, objectFit: 'cover', display: 'block' }}
              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          ) : (
            <div style={{
              width: 48, height: 48, borderRadius: '50%',
              background: `conic-gradient(${barColor} ${album.percentage}%, #2a2a2a ${album.percentage}%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: '#1a1a1a',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, color: barColor,
              }}>
                {album.totalTracks > 0 ? `${album.percentage}%` : '?'}
              </div>
            </div>
          )}
          {/* Percentage badge over image */}
          {album.imageUrl && (
            <div style={{
              position: 'absolute', bottom: -4, right: -4,
              background: barColor, color: '#000',
              borderRadius: 4, fontSize: 10, fontWeight: 700,
              padding: '1px 4px', lineHeight: 1.4,
            }}>
              {album.totalTracks > 0 ? `${album.percentage}%` : '?'}
            </div>
          )}
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontWeight: 600, fontSize: 15,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
          }}>
            {album.album}
          </div>
          <div style={{ color: '#888', fontSize: 13, marginTop: 2 }}>
            {album.artist}
          </div>
        </div>

        {/* Track count */}
        <div style={{ textAlign: 'right', flexShrink: 0, fontSize: 13 }}>
          <span style={{ color: barColor, fontWeight: 600 }}>
            {album.listenedCount}
          </span>
          {album.totalTracks > 0 && (
            <span style={{ color: '#555' }}>/{album.totalTracks}</span>
          )}
          <div style={{ color: '#555', fontSize: 12 }}>tracks</div>
        </div>

        <span style={{ color: '#444', fontSize: 12 }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {/* Expanded track list */}
      {expanded && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #2a2a2a' }}>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
            Tracks listened:
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {album.listenedTracks.map(t => (
              <span key={t} style={{
                background: '#2a2a2a', borderRadius: 4,
                padding: '3px 8px', fontSize: 12, color: '#ccc'
              }}>
                {t}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
