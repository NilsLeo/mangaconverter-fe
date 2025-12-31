import { useState, useEffect, useCallback, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import { getSessionKey, removeSessionKey, ensureSession } from '@/lib/session'
import { useSession as useSessionManager } from './use-session'

export interface QueueJob {
  job_id: string
  filename: string // input filename
  output_filename?: string // output filename (only present for COMPLETE jobs)
  status: 'UPLOADING' | 'QUEUED' | 'PROCESSING' | 'COMPLETE' | 'ERRORED' | 'CANCELLED'
  device_profile: string
  file_size: number
  output_file_size?: number // output file size (only present for COMPLETE jobs)
  worker_download_speed_mbps?: number // Worker download speed in Mbps (only present for QUEUED jobs)
  upload_progress?: {
    completed_parts: number
    total_parts: number
    uploaded_bytes: number
    total_bytes: number
    percentage: number
  }
  processing_progress?: {
    elapsed_seconds: number
    remaining_seconds: number
    projected_eta: number
    progress_percent: number
  }
  queue_position?: number
}

export interface QueueStatus {
  jobs: QueueJob[]
  total: number
  timestamp: string
}

/**
 * Hook to receive queue status updates via WebSocket
 *
 * Replaces HTTP polling with WebSocket push notifications
 * Backend broadcasts complete job state for session whenever any job updates
 * Falls back to polling if WebSocket connection fails
 *
 * @param interval - Fallback polling interval in milliseconds (default: 30000ms)
 * @param enabled - Whether updates are enabled (default: true)
 */
export function useQueuePolling(
  interval = 30000, // Fallback polling interval (30s, was 7.5s)
  enabled = true
) {
  const { isLoading: sessionLoading } = useSessionManager()
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null)
  const [isPolling, setIsPolling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transportMode, setTransportMode] = useState<'websocket' | 'polling' | 'connecting'>('connecting')

  const socketRef = useRef<Socket | null>(null)
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const lastFetchRef = useRef<number>(0)
  const reconnectAttemptsRef = useRef<number>(0)

  const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8060'

  // Fallback polling function (only used if WebSocket fails)
  const fetchQueueStatus = useCallback(async () => {
    if (!enabled || transportMode === 'websocket') return

    const now = Date.now()
    if (now - lastFetchRef.current < 500) return
    lastFetchRef.current = now

    try {
      setIsPolling(true)
      setError(null)

      const sessionKey = getSessionKey()
      if (!sessionKey) return

      console.log('[POLLING FALLBACK] Fetching with session key:', sessionKey?.substring(0, 8) + '...')

      const response = await fetch(`${API_BASE_URL}/api/queue/status`, {
        method: 'GET',
        headers: {
          'X-Session-Key': sessionKey,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        if (response.status === 401) {
          console.warn('[POLLING FALLBACK] 401 Unauthorized - session expired')
          removeSessionKey()
          await ensureSession()
          return
        }
        throw new Error(`Failed to fetch queue status: ${response.statusText}`)
      }

      const data: QueueStatus = await response.json()
      console.log(`[POLLING FALLBACK] Fetched status: ${data.jobs.length} jobs`)
      setQueueStatus(data)
    } catch (err) {
      if (err instanceof TypeError && err.message.includes('Failed to fetch')) {
        // Silently ignore network errors
        return
      }
      console.error('[POLLING FALLBACK] Error:', err)
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsPolling(false)
    }
  }, [enabled, transportMode, API_BASE_URL])

  // WebSocket connection management
  useEffect(() => {
    if (!enabled || sessionLoading) {
      return
    }

    const sessionKey = getSessionKey()
    if (!sessionKey) {
      console.log('[WEBSOCKET] No session key, skipping connection')
      return
    }

    console.log('[WEBSOCKET] Connecting to', API_BASE_URL)
    setTransportMode('connecting')

    // Create Socket.IO connection
    const socket = io(API_BASE_URL, {
      transports: ['websocket'], // WebSocket only (no long-polling fallback)
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
      timeout: 10000,
      auth: {
        session_key: sessionKey
      }
    })

    socketRef.current = socket

    // Connection established
    socket.on('connect', () => {
      console.log('[WEBSOCKET] Connected with socket ID:', socket.id)
      setTransportMode('websocket')
      setError(null)
      reconnectAttemptsRef.current = 0

      // Subscribe to session updates
      console.log('[WEBSOCKET] Subscribing to session:', sessionKey.substring(0, 8) + '...')
      socket.emit('subscribe_session', { session_key: sessionKey })
    })

    // Receive session updates
    socket.on('session_update', (data: QueueStatus) => {
      console.log(`[WEBSOCKET] Received session update: ${data.jobs?.length || 0} jobs`)
      setQueueStatus(data)
      setIsPolling(false) // Update received, not polling anymore
    })

    // Connection errors
    socket.on('connect_error', (err) => {
      reconnectAttemptsRef.current++
      console.error('[WEBSOCKET] Connection error:', err.message, `(attempt ${reconnectAttemptsRef.current})`)

      // After 3 failed attempts, fall back to polling
      if (reconnectAttemptsRef.current >= 3) {
        console.warn('[WEBSOCKET] Too many failed attempts, falling back to polling')
        setTransportMode('polling')
        setError('WebSocket connection failed, using polling fallback')
      }
    })

    // Disconnected
    socket.on('disconnect', (reason) => {
      console.warn('[WEBSOCKET] Disconnected:', reason)

      // If server disconnected us, fall back to polling
      if (reason === 'io server disconnect' || reason === 'transport close') {
        setTransportMode('polling')
      }
    })

    // Error from server
    socket.on('error', (errorData: any) => {
      console.error('[WEBSOCKET] Server error:', errorData)
      setError(errorData.message || 'WebSocket error')
    })

    // Cleanup
    return () => {
      console.log('[WEBSOCKET] Disconnecting')
      socket.disconnect()
      socketRef.current = null
    }
  }, [enabled, sessionLoading, API_BASE_URL])

  // Fallback polling (only active if WebSocket fails)
  useEffect(() => {
    if (!enabled || sessionLoading || transportMode !== 'polling') {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
        pollingIntervalRef.current = null
      }
      return
    }

    console.log('[POLLING FALLBACK] Starting polling interval:', interval, 'ms')

    // Initial fetch
    fetchQueueStatus()

    // Set up interval
    pollingIntervalRef.current = setInterval(fetchQueueStatus, interval)

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
        pollingIntervalRef.current = null
      }
    }
  }, [fetchQueueStatus, interval, enabled, sessionLoading, transportMode])

  // Manual refresh function
  const refresh = useCallback(() => {
    if (transportMode === 'websocket' && socketRef.current?.connected) {
      // Request immediate update via WebSocket
      const sessionKey = getSessionKey()
      if (sessionKey) {
        console.log('[WEBSOCKET] Requesting manual refresh')
        socketRef.current.emit('request_session_status', { session_key: sessionKey })
      }
    } else {
      // Fall back to polling
      fetchQueueStatus()
    }
  }, [transportMode, fetchQueueStatus])

  return {
    queueStatus,
    isPolling: isPolling || transportMode === 'connecting',
    error,
    refresh,
    transportMode, // Expose transport mode for debugging
  }
}
