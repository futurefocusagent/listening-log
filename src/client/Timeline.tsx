import React, { useState, useRef, useMemo } from 'react'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { AlbumStat } from './App'

interface Props {
  stats: AlbumStat[]
  allStats: AlbumStat[] // unfiltered stats for year nav
  onAlbumClick: (album: AlbumStat) => void
}

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
    default: return 1  // uncategorized = small (same as low)
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

export default function Timeline({ stats, allStats, onAlbumClick }: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  const yearRefs = useRef<Map<number, number>>(new Map()) // year -> row index
  const [yearSearch, setYearSearch] = useState('')

  // Compute year stats for nav bar from ALL albums (unfiltered)
  const yearStats = useMemo(() => {
    const data = new Map<number, { total: number; categorized: number }>()
    for (const s of allStats) {
      const year = s.releaseYear ?? 0
      if (!data.has(year)) data.set(year, { total: 0, categorized: 0 })
      const entry = data.get(year)!
      entry.total++
      if (s.tier) entry.categorized++
    }
    return Array.from(data.entries())
      .filter(([_, d]) => d.total > 0) // only years with albums
      .sort((a, b) => b[0] - a[0]) // descending by year
  }, [allStats])

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
      
      // Track row index for this year header
      yearRefs.current.set(year, result.length)
      
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
        // Height based on largest item in row + space for labels
        const maxCols = Math.max(...row.albums.map(a => a.cols))
        const hasLabels = row.albums.some(a => a.energy || (a.tags && a.tags.length > 0))
        const labelSpace = hasLabels ? 24 : 0
        // Approximate: 3-col = ~180px, 2-col = ~120px, 1-col = ~60px
        return (maxCols === 3 ? 180 : maxCols === 2 ? 120 : 80) + labelSpace
      }
      if (row.kind === 'singles-header') return 40
      if (row.kind === 'singles-row') return 70
      return 50
    },
    overscan: 5,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  })

  const scrollToYear = (year: number) => {
    const rowIndex = yearRefs.current.get(year)
    if (rowIndex !== undefined) {
      // Calculate approximate scroll position
      let scrollPos = 0
      for (let i = 0; i < rowIndex; i++) {
        const row = rows[i]
        if (row.kind === 'header') scrollPos += 52
        else if (row.kind === 'album-row') {
          const maxCols = Math.max(...row.albums.map(a => a.cols))
          scrollPos += (maxCols === 3 ? 180 : maxCols === 2 ? 120 : 80) + 24
        }
        else if (row.kind === 'singles-header') scrollPos += 40
        else if (row.kind === 'singles-row') scrollPos += 70
      }
      window.scrollTo({ top: scrollPos, behavior: 'smooth' })
    }
  }

  // Filter years based on search input
  const filteredYears = useMemo(() => {
    if (!yearSearch.trim()) return yearStats
    const search = yearSearch.trim()
    return yearStats.filter(([year]) => 
      year.toString().includes(search)
    )
  }, [yearStats, yearSearch])

  return (
    <div ref={listRef}>
      {/* Year navigation bar */}
      {yearStats.length > 0 && (
        <div className="sticky top-0 z-10 bg-[#0f0f0f]/95 backdrop-blur-sm border-b border-[#1e1e1e] py-2 mb-4 -mx-4 px-4">
          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Jump to year..."
              value={yearSearch}
              onChange={e => setYearSearch(e.target.value)}
              className="bg-[#1a1a1a] border border-[#333] rounded px-2 py-1 text-sm text-[#ccc] w-32 outline-none focus:border-[#555]"
            />
            <div className="flex flex-wrap gap-1.5 flex-1">
              {filteredYears.map(([year, { total, categorized }]) => (
                <button
                  key={year}
                  onClick={() => {
                    scrollToYear(year)
                    setYearSearch('')
                  }}
                  className="bg-[#1a1a1a] hover:bg-[#252525] border border-[#333] rounded px-2 py-1 text-xs text-[#888] hover:text-[#ccc] transition-colors"
                >
                  <span className="text-[#aaa]">{year === 0 ? '?' : year}</span>
                  <span className="text-[#555] ml-1">({categorized}/{total})</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      <div
        className="relative"
        style={{ height: virtualiser.getTotalSize() }}
      >
        {virtualiser.getVirtualItems().map(vItem => {
          const row = rows[vItem.index]
          return (
            <div
              key={vItem.key}
              data-index={vItem.index}
              ref={virtualiser.measureElement}
              className="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${vItem.start - virtualiser.options.scrollMargin}px)` }}
            >
              {row.kind === 'header' ? (
                <div className="text-xl font-bold text-[#555] pt-5 pb-2 border-b border-[#1e1e1e] mb-2 flex items-baseline gap-2.5">
                  {row.year === 0 ? 'Unknown' : row.year}
                  <span className="text-xs font-normal text-[#333]">
                    {row.albumCount} album{row.albumCount !== 1 ? 's' : ''}
                    {row.singleCount > 0 && `, ${row.singleCount} single${row.singleCount !== 1 ? 's' : ''}`}
                  </span>
                </div>
              ) : row.kind === 'album-row' ? (
                <div className="grid grid-cols-6 gap-2 mb-2">
                  {row.albums.map(album => (
                    <AlbumTile
                      key={`${album.artist}|||${album.album}`}
                      album={album}
                      onClick={() => onAlbumClick(album)}
                    />
                  ))}
                </div>
              ) : row.kind === 'singles-header' ? (
                <div className="text-[13px] font-semibold text-[#444] pt-4 pb-2 uppercase tracking-[0.5px]">
                  Singles
                </div>
              ) : row.kind === 'singles-row' ? (
                <div className="grid grid-cols-6 gap-2 mb-2">
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

  const hasLabels = album.energy || (album.tags && album.tags.length > 0)

  const spanClass = ({ 1: 'col-span-1', 2: 'col-span-2', 3: 'col-span-3' } as Record<number, string>)[album.cols] ?? 'col-span-1'

  return (
    <div
      onClick={onClick}
      title={`${album.album} — ${album.artist}`}
      className={`${spanClass} cursor-pointer transition-opacity duration-200 ${album.tier ? 'opacity-100' : 'opacity-50'}`}
    >
      {/* Thumbnail */}
      <div className="relative aspect-square rounded-md overflow-hidden bg-[#1a1a1a] border border-[#1e1e1e]">
        {album.imageUrl && !imgError ? (
          <img
            src={`/api/albumart?artist=${encodeURIComponent(album.artist)}&album=${encodeURIComponent(album.album)}`}
            alt={album.album}
            loading="lazy"
            onError={() => setImgError(true)}
            className="w-full h-full object-cover block"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[10px] text-[#333] text-center p-1.5 leading-[1.3]">
            {album.album}
          </div>
        )}

        {/* Completion badge */}
        <div
          className="absolute bottom-[3px] right-[3px] bg-black/80 rounded-[3px] text-[9px] font-bold px-[3px] py-px leading-[1.4] pointer-events-none"
          style={{ color: barColor }}
        >
          {album.totalTracks > 0 ? `${album.percentage}%` : '?'}
        </div>

        {/* Tier badge (top left) */}
        {album.tier && (
          <div className={`absolute top-[3px] left-[3px] rounded-[3px] text-[8px] font-bold px-1 py-px text-black leading-[1.4] pointer-events-none uppercase ${
            album.tier === 'top' ? 'bg-[#22c55e]' : album.tier === 'mid' ? 'bg-[#f59e0b]' : 'bg-[#666]'
          }`}>
            {album.tier}
          </div>
        )}
      </div>

      {/* Labels below thumbnail */}
      {hasLabels && (
        <div className="mt-1 flex flex-wrap gap-[3px] text-[9px]">
          {album.energy && (
            <span className="bg-[#3b82f6] text-white px-1 py-px rounded-[3px] font-semibold">
              {album.energy}
            </span>
          )}
          {album.tags?.map(tag => (
            <span
              key={tag}
              className="bg-[#333] text-[#aaa] px-1 py-px rounded-[3px]"
            >
              {tag}
            </span>
          ))}
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

  const spanClass = ({ 1: 'col-span-1', 2: 'col-span-2', 3: 'col-span-3' } as Record<number, string>)[album.cols] ?? 'col-span-1'

  return (
    <div
      onClick={onClick}
      title={`${album.album} — ${album.artist}`}
      className={`${spanClass} relative aspect-square rounded-[4px] overflow-hidden cursor-pointer bg-[#1a1a1a] border border-[#1e1e1e] transition-opacity duration-200 ${album.tier ? 'opacity-100' : 'opacity-50'}`}
    >
      {album.imageUrl && !imgError ? (
        <img
          src={`/api/albumart?artist=${encodeURIComponent(album.artist)}&album=${encodeURIComponent(album.album)}`}
          alt={album.album}
          loading="lazy"
          onError={() => setImgError(true)}
          className="w-full h-full object-cover block"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-[9px] text-[#333] text-center p-1 leading-[1.2]">
          {album.album}
        </div>
      )}

      {/* Completion badge */}
      <div
        className="absolute bottom-0.5 right-0.5 bg-black/80 rounded-[2px] text-[8px] font-bold px-[2px] py-px leading-[1.3] pointer-events-none"
        style={{ color: barColor }}
      >
        {album.totalTracks > 0 ? `${album.percentage}%` : '?'}
      </div>
    </div>
  )
}
