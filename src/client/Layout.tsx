import React, { useEffect, useState } from 'react'
import AlbumModal from './AlbumModal'
import { AlbumStat } from './App'
import { useAlbumModal } from './useAlbumModal'

interface NowPlayingTrack {
  name: string
  artist: string
  album: string
  albumArt: string | null
  progress: number
  duration: number
}

interface LayoutProps {
  children: React.ReactNode
}

const NAV_LINKS = [
  { label: 'TopList', href: '/' },
  { label: 'Recent', href: '/recent' },
  { label: 'Bookmarks', href: '/bookmarks' },
]

export default function Layout({ children }: LayoutProps) {
  const currentPath = window.location.pathname
  const [albums, setAlbums] = useState<AlbumStat[]>([])
  const [track, setTrack] = useState<NowPlayingTrack | null>(null)
  const [selectedAlbum, setSelectedAlbum] = useAlbumModal(albums)

  useEffect(() => {
    fetch('/api/stats')
      .then(r => r.json())
      .then(data => setAlbums(data.stats ?? []))
      .catch(console.error)
  }, [])

  useEffect(() => {
    const poll = () => {
      fetch('/api/now-playing')
        .then(r => r.json())
        .then((d: { playing: boolean; track?: NowPlayingTrack }) => {
          setTrack(d.playing && d.track ? d.track : null)
        })
        .catch(() => {})
    }
    poll()
    const interval = setInterval(poll, 15000)
    return () => clearInterval(interval)
  }, [])

  const matchedAlbum = track
    ? albums.find(
        a =>
          a.artist.toLowerCase() === track.artist.toLowerCase() &&
          a.album.toLowerCase() === track.album.toLowerCase()
      )
    : null

  const pct =
    track && track.duration > 0
      ? Math.min(100, (track.progress / track.duration) * 100)
      : 0

  return (
    <div className="min-h-screen">
      {/* Persistent header */}
      <header className="border-b border-[#2a2a2a] bg-[#111] sticky top-0 z-40">
        <div className="max-w-[960px] mx-auto px-4 py-3 flex items-center justify-between gap-4">
          {/* Brand */}
          <div className="flex items-center shrink-0">
            <img src="/favicon.svg" alt="Listening Log" className="w-8 h-8" />
          </div>

          {/* Now Playing — compact inline */}
          {track && (
            <div
              className={`flex items-center gap-2 flex-1 min-w-0 overflow-hidden ${matchedAlbum ? 'cursor-pointer' : 'cursor-default'}`}
              onClick={matchedAlbum ? () => setSelectedAlbum(matchedAlbum) : undefined}
            >
              {track.albumArt && (
                <img
                  src={track.albumArt}
                  alt=""
                  className="w-9 h-9 shrink-0 object-cover block"
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[9px] text-[#1db954] tracking-[0.1em] font-semibold">NOW PLAYING</div>
                <div className="text-[12px] font-semibold text-[#e0e0e0] truncate leading-tight">
                  {track.name}
                </div>
                <div className="text-[11px] text-[#666] truncate leading-tight">{track.artist}</div>
              </div>
              {track.duration > 0 && (
                <div className="flex-1 h-1 bg-[#2a2a2a] min-w-[100px]">
                  <div className="h-full bg-[#1db954]" style={{ width: `${pct}%` }} />
                </div>
              )}
            </div>
          )}

          {/* Nav */}
          <nav className="flex gap-0.5 shrink-0">
            {NAV_LINKS.map(({ label, href }) => {
              const isActive =
                href === '/' ? currentPath === '/' : currentPath.startsWith(href)
              return (
                <a
                  key={href}
                  href={href}
                  className={`px-3 py-1.5 text-[13px] transition-colors ${
                    isActive
                      ? 'text-[#e0e0e0] bg-[#222]'
                      : 'text-[#666] hover:text-[#e0e0e0]'
                  }`}
                >
                  {label}
                </a>
              )
            })}
          </nav>
        </div>
      </header>

      {/* Page content */}
      <main>{children}</main>

      {/* Modal for Now Playing album click */}
      {selectedAlbum && (
        <AlbumModal
          key={`${selectedAlbum.artist}|||${selectedAlbum.album}`}
          album={selectedAlbum}
          allStats={albums}
          onNavigate={setSelectedAlbum}
          onClose={() => setSelectedAlbum(null)}
          onUpdate={updated => {
            setSelectedAlbum(prev => (prev ? { ...prev, ...updated } : null))
            setAlbums(prev =>
              prev.map(s =>
                s.artist === selectedAlbum.artist && s.album === selectedAlbum.album
                  ? { ...s, ...updated }
                  : s
              )
            )
          }}
        />
      )}
    </div>
  )
}
