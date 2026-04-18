import React, { useEffect, useRef, useState } from 'react'
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

const AUTO_PLAY_KEY = 'autoPlayBookmarks'
// Trigger auto-play when within this many ms of the end
const NEAR_END_MS = 10000
// Minimum ms between auto-play triggers
const AUTO_PLAY_COOLDOWN_MS = 30000

export default function Layout({ children }: LayoutProps) {
  const currentPath = window.location.pathname
  const [albums, setAlbums] = useState<AlbumStat[]>([])
  const [track, setTrack] = useState<NowPlayingTrack | null>(null)
  const [selectedAlbum, setSelectedAlbum] = useAlbumModal(albums)
  const [autoPlay, setAutoPlay] = useState(() => {
    try { return localStorage.getItem(AUTO_PLAY_KEY) === 'true' } catch { return false }
  })

  // Refs for auto-play logic — avoids stale closure issues inside interval
  const wasPlayingRef = useRef(false)
  const lastAutoPlayRef = useRef(0)
  const autoPlayRef = useRef(autoPlay)
  const trackRef = useRef(track)

  useEffect(() => { autoPlayRef.current = autoPlay }, [autoPlay])
  useEffect(() => { trackRef.current = track }, [track])

  const toggleAutoPlay = () => {
    setAutoPlay(prev => {
      const next = !prev
      try { localStorage.setItem(AUTO_PLAY_KEY, String(next)) } catch {}
      return next
    })
  }

  const triggerAutoPlay = async (currentSpotifyId?: string) => {
    const now = Date.now()
    if (now - lastAutoPlayRef.current < AUTO_PLAY_COOLDOWN_MS) return
    lastAutoPlayRef.current = now
    try {
      await fetch('/api/auto-play/next', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentAlbumId: currentSpotifyId }),
      })
    } catch {
      // silent — now playing will update naturally
    }
  }

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
          const newTrack = d.playing && d.track ? d.track : null
          setTrack(newTrack)

          if (!autoPlayRef.current) {
            wasPlayingRef.current = !!newTrack
            return
          }

          const prev = trackRef.current
          const wasPlaying = wasPlayingRef.current

          // Detect natural end: was playing, now stopped
          if (wasPlaying && !newTrack) {
            const matchedAlbum = albums.find(
              a => prev && a.artist.toLowerCase() === prev.artist.toLowerCase() &&
                   a.album.toLowerCase() === prev.album.toLowerCase()
            )
            triggerAutoPlay(matchedAlbum?.spotifyId)
          }

          // Detect near end of track (within NEAR_END_MS of duration)
          if (newTrack && newTrack.duration > 0) {
            const remaining = newTrack.duration - newTrack.progress
            if (remaining <= NEAR_END_MS && remaining > 0) {
              const matchedAlbum = albums.find(
                a => a.artist.toLowerCase() === newTrack.artist.toLowerCase() &&
                     a.album.toLowerCase() === newTrack.album.toLowerCase()
              )
              triggerAutoPlay(matchedAlbum?.spotifyId)
            }
          }

          wasPlayingRef.current = !!newTrack
        })
        .catch(() => {})
    }
    poll()
    const interval = setInterval(poll, 15000)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albums])

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

          {/* Auto-play toggle */}
          <button
            onClick={toggleAutoPlay}
            title={autoPlay ? 'Auto-play bookmarks: ON' : 'Auto-play bookmarks: OFF'}
            className={`shrink-0 flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium tracking-wide border transition-colors ${
              autoPlay
                ? 'border-[#1db954] text-[#1db954] bg-[#1db95415]'
                : 'border-[#333] text-[#555] hover:border-[#555] hover:text-[#888]'
            }`}
          >
            {autoPlay && (
              <span className="w-1.5 h-1.5 rounded-full bg-[#1db954] animate-pulse shrink-0" />
            )}
            Auto
          </button>

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
