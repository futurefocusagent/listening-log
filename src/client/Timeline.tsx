import React, { useState } from 'react'

interface AlbumStat {
  album: string
  artist: string
  totalTracks: number
  listenedTracks: string[]
  listenedCount: number
  percentage: number
  complete: boolean
  imageUrl?: string
  releaseYear?: number
}

interface Props {
  stats: AlbumStat[]
  onAlbumClick: (album: AlbumStat) => void
}

export default function Timeline({ stats, onAlbumClick }: Props) {
  // Group by year, most recent first
  const byYear = new Map<number, AlbumStat[]>()
  for (const s of stats) {
    const year = s.releaseYear ?? 0
    if (!byYear.has(year)) byYear.set(year, [])
    byYear.get(year)!.push(s)
  }

  const years = Array.from(byYear.keys()).sort((a, b) => b - a)

  return (
    <div>
      {years.map(year => (
        <YearSection
          key={year}
          year={year}
          albums={byYear.get(year)!}
          onAlbumClick={onAlbumClick}
        />
      ))}
    </div>
  )
}

function YearSection({ year, albums, onAlbumClick }: {
  year: number
  albums: AlbumStat[]
  onAlbumClick: (album: AlbumStat) => void
}) {
  return (
    <div style={{ marginBottom: 48 }}>
      <h2 style={{
        fontSize: 22, fontWeight: 700, color: '#666',
        marginBottom: 16, borderBottom: '1px solid #222', paddingBottom: 8,
      }}>
        {year === 0 ? 'Unknown' : year}
        <span style={{ fontSize: 13, fontWeight: 400, color: '#444', marginLeft: 10 }}>
          {albums.length} album{albums.length !== 1 ? 's' : ''}
        </span>
      </h2>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: 8,
      }}>
        {albums.map(album => (
          <AlbumTile key={`${album.artist}|||${album.album}`} album={album} onClick={() => onAlbumClick(album)} />
        ))}
      </div>
    </div>
  )
}

function AlbumTile({ album, onClick }: { album: AlbumStat; onClick: () => void }) {
  const [imgError, setImgError] = useState(false)

  const barColor = album.complete ? '#22c55e'
    : album.percentage >= 75 ? '#84cc16'
    : album.percentage >= 50 ? '#f59e0b'
    : album.percentage >= 25 ? '#f97316'
    : '#ef4444'

  return (
    <div
      onClick={onClick}
      title={`${album.album} — ${album.artist}`}
      style={{
        position: 'relative',
        aspectRatio: '1',
        borderRadius: 6,
        overflow: 'hidden',
        cursor: 'pointer',
        background: '#1a1a1a',
        border: '1px solid #222',
      }}
    >
      {album.imageUrl && !imgError ? (
        <img
          src={`/api/albumart?artist=${encodeURIComponent(album.artist)}&album=${encodeURIComponent(album.album)}`}
          alt={album.album}
          onError={() => setImgError(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <div style={{
          width: '100%', height: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, color: '#444', textAlign: 'center', padding: 4,
        }}>
          {album.album}
        </div>
      )}

      {/* Completion badge */}
      <div style={{
        position: 'absolute', bottom: 4, right: 4,
        background: 'rgba(0,0,0,0.75)',
        borderRadius: 3, fontSize: 10, fontWeight: 700,
        padding: '2px 4px', color: barColor, lineHeight: 1.3,
      }}>
        {album.totalTracks > 0 ? `${album.percentage}%` : '?'}
      </div>

      {/* Hover overlay */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'rgba(0,0,0,0)',
        transition: 'background 0.15s',
      }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.3)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(0,0,0,0)')}
      />
    </div>
  )
}
