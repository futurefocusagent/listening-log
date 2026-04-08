// Logging and alerting for listening-log

import pg from 'pg'
const { Pool } = pg

const isInternal = process.env.DATABASE_URL?.match(/@dpg-[^.]+\//) !== null
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isInternal ? false : { rejectUnauthorized: false },
})

const SCHEMA = 'listening_log'

export async function initLoggerDb() {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.sync_logs (
      id SERIAL PRIMARY KEY,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'running',
      phase TEXT,
      total_albums INT,
      albums_processed INT,
      spotify_hits INT,
      spotify_misses INT,
      errors JSONB DEFAULT '[]',
      duration_ms INT,
      error_message TEXT
    )
  `)
  console.log('listening_log.sync_logs table initialized')
}

export interface SyncLog {
  id: number
  phase: string
  totalAlbums: number
  albumsProcessed: number
  spotifyHits: number
  spotifyMisses: number
  errors: Array<{ album: string; artist: string; error: string }>
}

let currentLogId: number | null = null
let currentLog: SyncLog | null = null

export async function startSyncLog(): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO ${SCHEMA}.sync_logs (status, phase) VALUES ('running', 'starting') RETURNING id`
  )
  currentLogId = result.rows[0].id
  currentLog = {
    id: currentLogId,
    phase: 'starting',
    totalAlbums: 0,
    albumsProcessed: 0,
    spotifyHits: 0,
    spotifyMisses: 0,
    errors: [],
  }
  return currentLogId
}

export async function updateSyncLog(updates: Partial<SyncLog>) {
  if (!currentLogId || !currentLog) return
  
  Object.assign(currentLog, updates)
  
  await pool.query(
    `UPDATE ${SCHEMA}.sync_logs SET
      phase = $1, total_albums = $2, albums_processed = $3,
      spotify_hits = $4, spotify_misses = $5, errors = $6
     WHERE id = $7`,
    [
      currentLog.phase,
      currentLog.totalAlbums,
      currentLog.albumsProcessed,
      currentLog.spotifyHits,
      currentLog.spotifyMisses,
      JSON.stringify(currentLog.errors.slice(-100)), // Keep last 100 errors
      currentLogId,
    ]
  )
}

export function logError(artist: string, album: string, error: string) {
  if (!currentLog) return
  currentLog.errors.push({ artist, album, error })
  console.error(`[SYNC ERROR] ${artist} - ${album}: ${error}`)
}

export async function finishSyncLog(status: 'success' | 'error', errorMessage?: string) {
  if (!currentLogId || !currentLog) return
  
  const startedAt = await pool.query<{ started_at: Date }>(
    `SELECT started_at FROM ${SCHEMA}.sync_logs WHERE id = $1`,
    [currentLogId]
  )
  const durationMs = startedAt.rows[0] 
    ? Date.now() - startedAt.rows[0].started_at.getTime()
    : 0
  
  await pool.query(
    `UPDATE ${SCHEMA}.sync_logs SET
      finished_at = NOW(), status = $1, duration_ms = $2, error_message = $3,
      phase = $4, total_albums = $5, albums_processed = $6,
      spotify_hits = $7, spotify_misses = $8, errors = $9
     WHERE id = $10`,
    [
      status,
      durationMs,
      errorMessage ?? null,
      currentLog.phase,
      currentLog.totalAlbums,
      currentLog.albumsProcessed,
      currentLog.spotifyHits,
      currentLog.spotifyMisses,
      JSON.stringify(currentLog.errors.slice(-100)),
      currentLogId,
    ]
  )
  
  // Send alert only on actual failures, not "not found" cases
  // "not found on Spotify" is expected for obscure releases
  const realErrors = currentLog.errors.filter(e => !e.error.includes('Not found on Spotify'))
  if (status === 'error' || realErrors.length > 20) {
    await sendAlert(status, errorMessage, realErrors)
  }
  
  console.log(`Sync ${status}: ${currentLog.albumsProcessed}/${currentLog.totalAlbums} albums, ${currentLog.spotifyHits} Spotify hits, ${currentLog.spotifyMisses} misses, ${currentLog.errors.length} errors`)
  
  currentLogId = null
  currentLog = null
}

async function sendAlert(status: string, errorMessage?: string, realErrors?: Array<{ album: string; artist: string; error: string }>) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_ALERT_CHAT_ID
  
  if (!botToken || !chatId || !currentLog) {
    console.log('Telegram alerting not configured')
    return
  }

  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const message = [
    `🚨 <b>Listening Log Alert for FFAgent</b>`,
    ``,
    `A sync operation ${status === 'error' ? 'failed' : 'completed with issues'}.`,
    ``,
    `<b>Phase:</b> ${currentLog.phase}`,
    `<b>Progress:</b> ${currentLog.albumsProcessed}/${currentLog.totalAlbums} albums`,
    `<b>Spotify Hits:</b> ${currentLog.spotifyHits}`,
    `<b>Spotify Misses:</b> ${currentLog.spotifyMisses}`,
    `<b>Errors:</b> ${currentLog.errors.length}`,
    errorMessage ? `<b>Error:</b> <code>${escapeHtml(errorMessage.slice(0, 300))}</code>` : '',
    ``,
    (realErrors && realErrors.length > 0)
      ? `<b>Recent errors:</b>\n${realErrors.slice(-5).map(e => `• ${escapeHtml(e.artist)} - ${escapeHtml(e.album)}: ${escapeHtml(e.error)}`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n')

  try {
    const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      }),
    })
    const result = await resp.json() as { ok: boolean; description?: string }
    if (!result.ok) {
      console.error('Telegram API error:', result.description)
    } else {
      console.log('Alert sent to Telegram')
    }
  } catch (err) {
    console.error('Failed to send Telegram alert:', err)
  }
}

// Get recent sync logs
export async function getRecentSyncLogs(limit = 20) {
  const result = await pool.query(
    `SELECT * FROM ${SCHEMA}.sync_logs ORDER BY started_at DESC LIMIT $1`,
    [limit]
  )
  return result.rows
}
