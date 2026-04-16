import { useEffect, useState } from 'react'
import { AlbumStat } from './App'

/**
 * Manages selectedAlbum state with URL sync.
 * - On mount (once albums are available), reads ?artist=...&album=... and opens the modal.
 * - When the modal opens/closes, updates the URL via replaceState (no history entry).
 */
export function useAlbumModal(albums: AlbumStat[]) {
  const [selectedAlbum, setSelectedAlbum] = useState<AlbumStat | null>(null)
  const [initialized, setInitialized] = useState(false)

  // Once albums are loaded, check URL params once and open the modal if matched.
  useEffect(() => {
    if (initialized || albums.length === 0) return

    const params = new URLSearchParams(window.location.search)
    const artist = params.get('artist')
    const album = params.get('album')

    if (artist && album) {
      const match = albums.find(
        a =>
          a.artist.toLowerCase() === artist.toLowerCase() &&
          a.album.toLowerCase() === album.toLowerCase()
      )
      if (match) setSelectedAlbum(match)
    }

    setInitialized(true)
  }, [albums, initialized])

  // After initialization, keep the URL in sync with modal state.
  useEffect(() => {
    if (!initialized) return

    const params = new URLSearchParams(window.location.search)
    if (selectedAlbum) {
      params.set('artist', selectedAlbum.artist)
      params.set('album', selectedAlbum.album)
      window.history.replaceState(null, '', `?${params.toString()}`)
    } else {
      params.delete('artist')
      params.delete('album')
      const qs = params.toString()
      window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
    }
  }, [selectedAlbum, initialized])

  return [selectedAlbum, setSelectedAlbum] as const
}
