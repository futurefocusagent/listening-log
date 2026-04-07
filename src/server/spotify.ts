// Spotify API client for album metadata

let accessToken: string | null = null
let tokenExpiry = 0

async function getAccessToken(): Promise<string> {
  if (accessToken && Date.now() < tokenExpiry - 60000) {
    return accessToken
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be set')
  }

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
  })

  if (!res.ok) {
    throw new Error(`Spotify token request failed: ${res.status}`)
  }

  const data = await res.json() as { access_token: string; expires_in: number }
  accessToken = data.access_token
  tokenExpiry = Date.now() + data.expires_in * 1000
  return accessToken
}

export interface SpotifyAlbumInfo {
  spotifyId: string
  name: string
  artist: string
  releaseYear: number
  totalTracks: number
  imageUrl: string | null
  tracks: string[]  // lowercase track names for matching
}

interface SpotifyAlbum {
  id: string
  name: string
  artists: Array<{ name: string }>
  release_date: string
  total_tracks: number
  images: Array<{ url: string; height: number }>
}

interface SpotifyTrack {
  name: string
}

interface SpotifyTracksResponse {
  items: SpotifyTrack[]
  next: string | null
}

// Search for album and return full metadata
export async function searchAlbum(artist: string, album: string): Promise<SpotifyAlbumInfo | null> {
  try {
    const token = await getAccessToken()
    
    // Search for the album
    const query = encodeURIComponent(`album:${album} artist:${artist}`)
    const searchRes = await fetch(`https://api.spotify.com/v1/search?q=${query}&type=album&limit=5`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    if (!searchRes.ok) {
      console.error(`Spotify search failed: ${searchRes.status}`)
      return null
    }

    const searchData = await searchRes.json() as { albums?: { items?: SpotifyAlbum[] } }
    const albums = searchData.albums?.items || []
    
    if (albums.length === 0) return null
    
    // Find best match (prefer exact artist match)
    const artistLower = artist.toLowerCase()
    const albumLower = album.toLowerCase()
    let bestMatch = albums[0]
    
    for (const a of albums) {
      const matchesArtist = a.artists.some(ar => ar.name.toLowerCase() === artistLower)
      const matchesAlbum = a.name.toLowerCase() === albumLower
      if (matchesArtist && matchesAlbum) {
        bestMatch = a
        break
      }
      if (matchesArtist && !bestMatch.artists.some(ar => ar.name.toLowerCase() === artistLower)) {
        bestMatch = a
      }
    }
    
    // Get tracks for the album
    const tracks = await getAlbumTracks(bestMatch.id, token)
    
    // Parse release year from date (YYYY-MM-DD or YYYY)
    const releaseYear = parseInt(bestMatch.release_date.slice(0, 4), 10)
    
    // Get largest image
    const imageUrl = bestMatch.images.length > 0 
      ? bestMatch.images.sort((a, b) => b.height - a.height)[0].url
      : null

    return {
      spotifyId: bestMatch.id,
      name: bestMatch.name,
      artist: bestMatch.artists[0]?.name || artist,
      releaseYear,
      totalTracks: bestMatch.total_tracks,
      imageUrl,
      tracks,
    }
  } catch (err) {
    console.error('Spotify search error:', err)
    return null
  }
}

// Get album by Spotify ID (for existing albums)
export async function getAlbumById(spotifyId: string): Promise<SpotifyAlbumInfo | null> {
  try {
    const token = await getAccessToken()
    
    const res = await fetch(`https://api.spotify.com/v1/albums/${spotifyId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    if (!res.ok) {
      console.error(`Spotify get album failed: ${res.status}`)
      return null
    }

    const album = await res.json() as SpotifyAlbum
    const tracks = await getAlbumTracks(album.id, token)
    const releaseYear = parseInt(album.release_date.slice(0, 4), 10)
    const imageUrl = album.images.length > 0 
      ? album.images.sort((a, b) => b.height - a.height)[0].url
      : null

    return {
      spotifyId: album.id,
      name: album.name,
      artist: album.artists[0]?.name || 'Unknown',
      releaseYear,
      totalTracks: album.total_tracks,
      imageUrl,
      tracks,
    }
  } catch (err) {
    console.error('Spotify get album error:', err)
    return null
  }
}

async function getAlbumTracks(albumId: string, token: string): Promise<string[]> {
  const tracks: string[] = []
  let url: string | null = `https://api.spotify.com/v1/albums/${albumId}/tracks?limit=50`
  
  while (url) {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
    
    if (!res.ok) break
    
    const data = await res.json() as SpotifyTracksResponse
    for (const t of data.items) {
      tracks.push(t.name.toLowerCase())
    }
    url = data.next
  }
  
  return tracks
}

// Simple search that returns just the ID (for backwards compat)
export async function searchAlbumId(artist: string, album: string): Promise<string | null> {
  const result = await searchAlbum(artist, album)
  return result?.spotifyId || null
}
