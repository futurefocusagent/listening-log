import React, { useState, useRef, useMemo } from 'react'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { AlbumStat } from './App'

interface Props {
  stats: AlbumStat[]
  onAlbumClick: (album: AlbumStat) => void
}

const TILE_GAP = 8

// Row types for the virtualised list
type Row =
  | { kind: 'header'; year: number; albumCount: number; singleCount: number }
  | { kind: 'album-row'; albums: AlbumWithLayout[] }
  | { kind: 'singles-header'; count: number }
  | { kind: 'singles-row'; singles: AlbumWithLayout[] }

interface AlbumWithLayout extends AlbumStat {
  cols: number  // 1, 2, or 3 out of 6
}

// Is this a single? (3 or fewer tracks)
function isSingle(album: AlbumStat): boolean {
  return album.totalTracks > 0 && album.totalTracks <= 3
}

// Get column span based on tier
function getTierCols(tier?: 'top' | 'mid' | 'low'): number {
  switch (tier) {
    case 'top': return 3
    case 'mid': return 2
    case 'low': return 1
    default: return 2  // uncategorized defaults to mid
  }
}

// Sort albums by tier: top first, then mid, then low, then uncategorized
function sortByTier(albums: AlbumStat[]): AlbumStat[] {
  const tierOrder = { top: 0, mid: 1, low: 2 }
  return [...albums].sort((a, b) => {
    const aOrder = a.tier ? tierOrder[a.tier] : 3
    const bOrder = b.tier ? tierOrder[b.tier] : 3
    return aOrder - bOrder
  })
}

// Pack albums into rows respecting variable column widths
function packIntoRows(albums: AlbumStat[], totalCols: number = 6): AlbumWithLayout[][] {
  const sorted = sortByTier(albums)
  const rows: AlbumWithLayout[][] = []
  let currentRow: AlbumWithLayout[] = []
  let currentCols = 0

  for (const album of sorted) {
    const cols = getTierCols(album.tier)
    
    if (currentCols + cols > totalCols) {
      if (currentRow.length > 0) rows.push(currentRow)
      currentRow = []
      currentCols = 0
    }
    
    currentRow.push({ ...album, cols })
    currentCols += cols
  }
  
  if (currentRow.length > 0) rows.push(currentRow)
  return rows
}

// Pack singles into rows (smaller sizes)
function packSinglesIntoRows(singles: AlbumStat[], totalCols: number = 6): AlbumWithLayout[][] {
  const sorted = sortByTier(singles)
  const rows: AlbumWithLayout[][] = []
  let currentRow: AlbumWithLayout[] = []
  let currentCols = 0

  for (const album of sorted) {
    // Singles use smaller sizes: top=2, mid=1.5 (round to 2), low=1
    let cols: number
    switch (album.tier) {
      case 'top': cols = 2; break
      case 'mid': cols = 1; break
      case 'low': cols = 1; break
      default: cols = 1
    }
    
    if (currentCols + cols > totalCols) {
      if (currentRow.length > 0) rows.push(currentRow)
      currentRow = []
      currentCols = 0
    }
    
    currentRow.push({ ...album, cols })
    currentCols += cols
  }
  
  if (currentRow.length > 0) rows.push(currentRow)
  return rows
}

export default function Timeline({ stats, onAlbumClick }: Props) {
  const listRef = useRef<HTMLDivElement>(null)

  // Build flat row list: header + packed album rows, then singles
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
      
      // Album grid (variable column widths based on tier)
      const albumRows = packIntoRows(albums)
      for (const row of albumRows) {
        result.push({ kind: 'album-row', albums: row })
      }
      
      // Singles section
      if (singles.length > 0) {
        result.push({ kind: 'singles-header', count: singles.length })
        const singleRows = packSinglesIntoRows(singles)
        for (const row of singleRows) {
          result.push({ kind: 'singles-row', singles: row })
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
      if (row.kind === 'album-row') {
        // Height based on largest item in row
        const maxCols = Math.max(...row.albums.map(a => a.cols))
        // Approximate: 3-col = ~180px, 2-col = ~120px, 1-col = ~60px
        return maxCols === 3 ? 180 : maxCols === 2 ? 120 : 80
      }
      if (row.kind === 'singles-header') return 40
      if (row.kind === 'singles-row') return 70
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
              ) : row.kind === 'album-row' ? (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(6, 1fr)',
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
              ) : row.kind === 'singles-row' ? (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(6, 1fr)',
                  gap: TILE_GAP,
                  marginBottom: TILE_GAP,
                }}>
                  {row.singles.map(album => (
                    <SingleTile
                      key={`${album.artist}|||${album.album}`}
                      album={album}
                      onClick={() => onAlbumClick(album)}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function AlbumTile({ album, onClick }: { album: AlbumWithLayout; onClick: () => void }) {
  const [imgError, setImgError] = useState(false)

  const barColor = album.complete ? '#22c55e'
    : album.percentage >= 75 ? '#84cc16'
    : album.percentage >= 50 ? '#f59e0b'
    : album.percentage >= 25 ? '#f97316'
    : '#ef4444'

  // Opacity based on tier (no tier = 50%)
  const opacity = album.tier ? 1 : 0.5

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
        gridColumn: `span ${album.cols}`,
        opacity,
        transition: 'opacity 0.2s',
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

      {/* Tier badge (top left) */}
      {album.tier && (
        <div style={{
          position: 'absolute', top: 3, left: 3,
          background: album.tier === 'top' ? '#22c55e' : album.tier === 'mid' ? '#f59e0b' : '#666',
          borderRadius: 3, fontSize: 8, fontWeight: 700,
          padding: '1px 4px', color: '#000', lineHeight: 1.4,
          pointerEvents: 'none',
          textTransform: 'uppercase',
        }}>
          {album.tier}
        </div>
      )}
    </div>
  )
}

function SingleTile({ album, onClick }: { album: AlbumWithLayout; onClick: () => void }) {
  const [imgError, setImgError] = useState(false)

  const barColor = album.complete ? '#22c55e'
    : album.percentage >= 75 ? '#84cc16'
    : album.percentage >= 50 ? '#f59e0b'
    : album.percentage >= 25 ? '#f97316'
    : '#ef4444'

  // Opacity based on tier (no tier = 50%)
  const opacity = album.tier ? 1 : 0.5

  return (
    <div
      onClick={onClick}
      title={`${album.album} — ${album.artist}`}
      style={{
        position: 'relative',
        aspectRatio: '1',
        borderRadius: 4,
        overflow: 'hidden',
        cursor: 'pointer',
        background: '#1a1a1a',
        border: '1px solid #1e1e1e',
        gridColumn: `span ${album.cols}`,
        opacity,
        transition: 'opacity 0.2s',
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
          fontSize: 9, color: '#333', textAlign: 'center', padding: 4,
          lineHeight: 1.2,
        }}>
          {album.album}
        </div>
      )}

      {/* Completion badge */}
      <div style={{
        position: 'absolute', bottom: 2, right: 2,
        background: 'rgba(0,0,0,0.8)',
        borderRadius: 2, fontSize: 8, fontWeight: 700,
        padding: '1px 2px', color: barColor, lineHeight: 1.3,
        pointerEvents: 'none',
      }}>
        {album.totalTracks > 0 ? `${album.percentage}%` : '?'}
      </div>
    </div>
  )
}
