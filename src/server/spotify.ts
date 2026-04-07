// Spotify API client for album ID lookup

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

export async function searchAlbum(artist: string, album: string): Promise<string | null> {
  try {
    const token = await getAccessToken()
    const query = encodeURIComponent(`album:${album} artist:${artist}`)
    const res = await fetch(`https://api.spotify.com/v1/search?q=${query}&type=album&limit=1`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    if (!res.ok) {
      console.error(`Spotify search failed: ${res.status}`)
      return null
    }

    const data = await res.json() as { albums?: { items?: Array<{ id: string }> } }
    return data.albums?.items?.[0]?.id || null
  } catch (err) {
    console.error('Spotify search error:', err)
    return null
  }
}
