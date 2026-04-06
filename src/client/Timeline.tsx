import React, { useState, useRef, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

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
  | { kind: 'header'; year: number; count: number }
  | { kind: 'tiles'; albums: AlbumStat[] }

export default function Timeline({ stats, onAlbumClick }: Props) {
  const parentRef = useRef<HTMLDivElement>(null)

  // Build flat row list: header + tile-rows per year
  const rows = useMemo<Row[]>(() => {
    const byYear = new Map<number, AlbumStat[]>()
    for (const s of stats) {
      const year = s.releaseYear ?? 0
      if (!byYear.has(year)) byYear.set(year, [])
      byYear.get(year)!.push(s)
    }
    const years = Array.from(byYear.keys()).sort((a, b) => b - a)
    const result: Row[] = []
    for (const year of years) {
      const albums = byYear.get(year)!
      result.push({ kind: 'header', year, count: albums.length })
      for (let i = 0; i < albums.length; i += COLS) {
        result.push({ kind: 'tiles', albums: albums.slice(i, i + COLS) })
      }
    }
    return result
  }, [stats])

  const virtualiser = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => rows[i].kind === 'header' ? 52 : 0, // tiles are square, sized via CSS
    overscan: 5,
  })

  return (
    <div
      ref={parentRef}
      style={{ height: '80vh', overflowY: 'auto', overflowX: 'hidden' }}
    >
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
                transform: `translateY(${vItem.start}px)`,
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
                    {row.count} album{row.count !== 1 ? 's' : ''}
                  </span>
                </div>
              ) : (
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
              )}
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
