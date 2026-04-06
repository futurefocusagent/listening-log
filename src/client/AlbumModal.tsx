import React, { useEffect } from 'react'

interface AlbumStat {
  album: string
  artist: string
  totalTracks: number
  listenedTracks: string[]
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
        background: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#111', borderRadius: 12, padding: 28,
          maxWidth: 520, width: '100%', maxHeight: '85vh',
          overflow: 'auto', position: 'relative',
          border: '1px solid #2a2a2a',
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: 16, right: 16,
            background: 'none', border: 'none', color: '#666',
            fontSize: 20, cursor: 'pointer', lineHeight: 1,
          }}
        >✕</button>

        {/* Header */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
          {album.imageUrl && (
            <img
              src={`/api/albumart?artist=${encodeURIComponent(album.artist)}&album=${encodeURIComponent(album.album)}`}
              alt={album.album}
              style={{ width: 80, height: 80, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
            />
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 4 }}>{album.album}</div>
            <div style={{ color: '#888', fontSize: 14, marginBottom: 8 }}>{album.artist}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {/* Completion ring */}
              <div style={{
                width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                background: `conic-gradient(${barColor} ${album.percentage}%, #2a2a2a ${album.percentage}%)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <div style={{
                  width: 26, height: 26, borderRadius: '50%', background: '#111',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 9, fontWeight: 700, color: barColor,
                }}>
                  {album.totalTracks > 0 ? `${album.percentage}%` : '?'}
                </div>
              </div>
              <span style={{ fontSize: 13, color: '#888' }}>
                {album.listenedCount}{album.totalTracks > 0 ? `/${album.totalTracks}` : ''} tracks
              </span>
              <a
                href={album.spotifyId
                  ? `spotify:album:${album.spotifyId}`
                  : `spotify:search:${encodeURIComponent(`${album.artist} ${album.album}`)}`
                }
                title="Open in Spotify"
                style={{ fontSize: 18, textDecoration: 'none' }}
              >🎧</a>
            </div>
          </div>
        </div>

        {/* Track list */}
        <div style={{ borderTop: '1px solid #2a2a2a', paddingTop: 16 }}>
          <div style={{ fontSize: 12, color: '#555', marginBottom: 10 }}>Tracks listened</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {album.listenedTracks.map(t => (
              <span key={t} style={{
                background: '#1e1e1e', borderRadius: 4,
                padding: '3px 8px', fontSize: 12, color: '#bbb',
                border: '1px solid #2a2a2a',
              }}>
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
