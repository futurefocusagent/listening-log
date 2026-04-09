import React, { useEffect } from 'react'

interface AlbumStat {
  album: string
  artist: string
  totalTracks: number
  listenedTracks: string[]
  allTracks: string[]
  listenedCount: number
  percentage: number
  complete: boolean
  imageUrl?: string
  spotifyId?: string
}

interface Props {
  album: AlbumStat
  onClose: () => void
}

export default function AlbumModal({ album, onClose }: Props) {
  const barColor = album.complete ? '#22c55e'
    : album.percentage >= 75 ? '#84cc16'
    : album.percentage >= 50 ? '#f59e0b'
    : album.percentage >= 25 ? '#f97316'
    : '#ef4444'

  // Build tracklist: use allTracks if available, else fall back to listenedTracks only
  const listenedSet = new Set(album.listenedTracks.map(t => t.toLowerCase()))
  const trackList = album.allTracks.length > 0
    ? album.allTracks
    : album.listenedTracks

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

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

        {/* Info + tracklist */}
        <div style={{ padding: '20px 24px 24px' }}>
          {/* Title + artist */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 20, lineHeight: 1.2, marginBottom: 4 }}>{album.album}</div>
            <div style={{ color: '#888', fontSize: 14 }}>{album.artist}</div>
          </div>

          {/* Stats row */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20 }}>
            {/* Completion ring */}
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

          {/* Tracklist */}
          {trackList.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                Tracklist
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {trackList.map((track, i) => {
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
