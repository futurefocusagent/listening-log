import React, { useState, useRef, useMemo } from 'react'
import { useWindowVirtualizer } from '@tanstack/react-virtual'

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

const COLS = 5
const TILE_GAP = 8

// Row types for the virtualised list
type Row =
  | { kind: 'header'; year: number; albumCount: number; singleCount: number }
  | { kind: 'tiles'; albums: AlbumStat[] }
  | { kind: 'singles-header'; count: number }
  | { kind: 'single'; album: AlbumStat }

// Is this a single? (3 or fewer tracks)
function isSingle(album: AlbumStat): boolean {
  return album.totalTracks > 0 && album.totalTracks <= 3
}

export default function Timeline({ stats, onAlbumClick }: Props) {
  const listRef = useRef<HTMLDivElement>(null)

  // Build flat row list: header + tile-rows for albums, then singles list per year
  const rows = useMemo<Row[]>(() => {
    const byYear = new Map<number, { albums: AlbumStat[]; singles: AlbumStat[] }>()
    
    for (const s of stats) {
      const year = s.releaseYear ?? 0
      if (!byYear.has(year)) byYear.set(year, { albums: [], singles: [] })
      const bucket = byYear.get(year)!
      if (isSingle(s)) {
        bucket.singles.push(s)
      } else {
        bucket.albums.push(s)
      }
    }
    
    const years = Array.from(byYear.keys()).sort((a, b) => b - a)
    const result: Row[] = []
    
    for (const year of years) {
      const { albums, singles } = byYear.get(year)!
      
      // Year header
      result.push({ kind: 'header', year, albumCount: albums.length, singleCount: singles.length })
      
      // Album grid (5-column tiles)
      for (let i = 0; i < albums.length; i += COLS) {
        result.push({ kind: 'tiles', albums: albums.slice(i, i + COLS) })
      }
      
      // Singles section (compact list)
      if (singles.length > 0) {
        result.push({ kind: 'singles-header', count: singles.length })
        for (const single of singles) {
          result.push({ kind: 'single', album: single })
        }
      }
    }
    
    return result
  }, [stats])

  const virtualiser = useWindowVirtualizer({
    count: rows.length,
    estimateSize: (i) => {
      const row = rows[i]
      if (row.kind === 'header') return 52
      if (row.kind === 'tiles') return 120
      if (row.kind === 'singles-header') return 40
      if (row.kind === 'single') return 44
      return 50
    },
    overscan: 5,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  })

  return (
    <div ref={listRef}>
      <div
        style={{
          height: virtualiser.getTotalSize(),
          position: 'relative',
        }}
      >
        {virtualiser.getVirtualItems().map(vItem => {
          const row = rows[vItem.index]
          return (
            <div
              key={vItem.key}
              data-index={vItem.index}
              ref={virtualiser.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vItem.start - virtualiser.options.scrollMargin}px)`,
              }}
            >
              {row.kind === 'header' ? (
                <div style={{
                  fontSize: 20, fontWeight: 700, color: '#555',
                  padding: '20px 0 8px',
                  borderBottom: '1px solid #1e1e1e',
                  marginBottom: 8,
                  display: 'flex', alignItems: 'baseline', gap: 10,
                }}>
                  {row.year === 0 ? 'Unknown' : row.year}
                  <span style={{ fontSize: 12, fontWeight: 400, color: '#333' }}>
                    {row.albumCount} album{row.albumCount !== 1 ? 's' : ''}
                    {row.singleCount > 0 && `, ${row.singleCount} single${row.singleCount !== 1 ? 's' : ''}`}
                  </span>
                </div>
              ) : row.kind === 'tiles' ? (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${COLS}, 1fr)`,
                  gap: TILE_GAP,
                  marginBottom: TILE_GAP,
                }}>
                  {row.albums.map(album => (
                    <AlbumTile
                      key={`${album.artist}|||${album.album}`}
                      album={album}
                      onClick={() => onAlbumClick(album)}
                    />
                  ))}
                </div>
              ) : row.kind === 'singles-header' ? (
                <div style={{
                  fontSize: 13, fontWeight: 600, color: '#444',
                  padding: '16px 0 8px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}>
                  Singles & EPs
                </div>
              ) : row.kind === 'single' ? (
                <SingleRow album={row.album} onClick={() => onAlbumClick(row.album)} />
              ) : null}
            </div>
          )
        })}
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
        border: '1px solid #1e1e1e',
      }}
    >
      {album.imageUrl && !imgError ? (
        <img
          src={`/api/albumart?artist=${encodeURIComponent(album.artist)}&album=${encodeURIComponent(album.album)}`}
          alt={album.album}
          loading="lazy"
          onError={() => setImgError(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <div style={{
          width: '100%', height: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, color: '#333', textAlign: 'center', padding: 6,
          lineHeight: 1.3,
        }}>
          {album.album}
        </div>
      )}

      {/* Completion badge */}
      <div style={{
        position: 'absolute', bottom: 3, right: 3,
        background: 'rgba(0,0,0,0.8)',
        borderRadius: 3, fontSize: 9, fontWeight: 700,
        padding: '1px 3px', color: barColor, lineHeight: 1.4,
        pointerEvents: 'none',
      }}>
        {album.totalTracks > 0 ? `${album.percentage}%` : '?'}
      </div>
    </div>
  )
}

function SingleRow({ album, onClick }: { album: AlbumStat; onClick: () => void }) {
  const [imgError, setImgError] = useState(false)

  const barColor = album.complete ? '#22c55e'
    : album.percentage >= 75 ? '#84cc16'
    : album.percentage >= 50 ? '#f59e0b'
    : album.percentage >= 25 ? '#f97316'
    : '#ef4444'

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '6px 0',
        cursor: 'pointer',
        borderBottom: '1px solid #1a1a1a',
      }}
    >
      {/* Square album cover as bullet */}
      <div style={{
        width: 32,
        height: 32,
        borderRadius: 4,
        overflow: 'hidden',
        flexShrink: 0,
        background: '#1a1a1a',
        border: '1px solid #1e1e1e',
      }}>
        {album.imageUrl && !imgError ? (
          <img
            src={`/api/albumart?artist=${encodeURIComponent(album.artist)}&album=${encodeURIComponent(album.album)}`}
            alt={album.album}
            loading="lazy"
            onError={() => setImgError(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            background: '#222',
          }} />
        )}
      </div>

      {/* Artist - Title */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ color: '#888', fontSize: 13 }}>{album.artist}</span>
        <span style={{ color: '#444', fontSize: 13 }}> — </span>
        <span style={{ color: '#ccc', fontSize: 13 }}>{album.album}</span>
      </div>

      {/* Percentage justified right */}
      <div style={{
        fontSize: 12,
        fontWeight: 600,
        color: barColor,
        flexShrink: 0,
      }}>
        {album.totalTracks > 0 ? `${album.percentage}%` : '?'}
      </div>
    </div>
  )
}
