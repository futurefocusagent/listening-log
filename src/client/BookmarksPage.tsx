import React, { useEffect, useState } from 'react'
import AlbumModal from './AlbumModal'
import { AlbumStat } from './App'
import { useAlbumModal } from './useAlbumModal'

function formatBookmarkedDate(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function BookmarksPage() {
  const [albums, setAlbums] = useState<AlbumStat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedAlbum, setSelectedAlbum] = useAlbumModal(albums)

  useEffect(() => {
    fetch('/api/bookmarks')
      .then(r => {
        if (!r.ok) throw new Error('Failed to load bookmarks')
        return r.json()
      })
      .then((data: AlbumStat[]) => {
        setAlbums(data)
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  return (
    <div className="max-w-[720px] mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-7 flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-bold mb-1">Bookmarks</h1>
          <p className="text-[#666] text-[13px]">Albums saved for later, newest first</p>
        </div>
        <a
          href="/"
          className="text-[13px] text-[#666] hover:text-[#e0e0e0] transition-colors"
        >
          ← All albums
        </a>
      </div>

      {loading && (
        <div className="text-center text-[#555] py-16">Loading…</div>
      )}

      {error && (
        <div className="bg-[#1a1a1a] border border-[#3a1a1a] p-6 text-center text-[#f87171]">
          <p className="font-semibold">Something went wrong</p>
          <p className="text-[13px] mt-1 text-[#888]">{error}</p>
        </div>
      )}

      {!loading && !error && albums.length === 0 && (
        <div className="text-center text-[#555] py-16">No bookmarked albums yet.</div>
      )}

      {!loading && !error && albums.length > 0 && (
        <div className="flex flex-col gap-px">
          {albums.map((album, i) => (
            <AlbumRow
              key={`${album.artist}|||${album.album}`}
              album={album}
              isFirst={i === 0}
              isLast={i === albums.length - 1}
              onClick={() => setSelectedAlbum(album)}
            />
          ))}
        </div>
      )}

      {selectedAlbum && (
        <AlbumModal
          album={selectedAlbum}
          onClose={() => setSelectedAlbum(null)}
          onUpdate={(updated) => {
            setSelectedAlbum(prev => prev ? { ...prev, ...updated } : null)
            setAlbums(prev =>
              prev.map(a =>
                a.artist === selectedAlbum.artist && a.album === selectedAlbum.album
                  ? { ...a, ...updated }
                  : a
              )
            )
          }}
        />
      )}
    </div>
  )
}

interface AlbumRowProps {
  album: AlbumStat
  isFirst: boolean
  isLast: boolean
  onClick: () => void
}

function AlbumRow({ album, isFirst, isLast, onClick }: AlbumRowProps) {
  const artUrl = album.imageUrl
    ? `/api/albumart?artist=${encodeURIComponent(album.artist)}&album=${encodeURIComponent(album.album)}`
    : null

  const roundedClass = ''

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-4 bg-[#1a1a1a] hover:bg-[#222] transition-colors px-4 py-[10px] text-left ${roundedClass}`}
    >
      {/* Album art */}
      <div className="w-[84px] h-[84px] shrink-0 overflow-hidden bg-[#2a2a2a]">
        {artUrl ? (
          <img src={artUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[#444] text-xl">♪</div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-semibold text-[#e0e0e0] truncate">{album.album}</div>
        <div className="text-[13px] text-[#888] truncate">
          {album.artist}{album.releaseYear ? ` · ${album.releaseYear}` : ''}
        </div>
      </div>

      {/* Bookmarked date */}
      <div className="shrink-0 text-right">
        <div className="text-[12px] text-[#666]">{formatBookmarkedDate(album.tierChangedAt)}</div>
        {album.totalTracks > 0 && (
          <div
            className="text-[11px] mt-0.5"
            style={{ color: album.complete ? '#22c55e' : '#f59e0b' }}
          >
            {album.percentage}%
          </div>
        )}
      </div>
    </button>
  )
}
