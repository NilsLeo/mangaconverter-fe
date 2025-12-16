import { useState, useEffect, useCallback, useRef } from 'react'
import { ensureSessionKey } from '@/lib/utils'

export interface QueueJob {
  job_id: string
  filename: string
  status: 'UPLOADING' | 'QUEUED' | 'PROCESSING' | 'COMPLETE' | 'ERRORED' | 'CANCELLED'
  device_profile: string
  file_size: number
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
 * Hook to poll backend for queue status
 *
 * Replaces WebSocket with simple HTTP polling every 1-2 seconds
 * Backend returns complete job state for all active jobs
 *
 * @param interval - Polling interval in milliseconds (default: from env or 1500ms)
 * @param enabled - Whether polling is enabled (default: true)
 */
export function useQueuePolling(
  interval = Number(process.env.NEXT_PUBLIC_POLL_INTERVAL) || 1500,
  enabled = true
) {
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null)
  const [isPolling, setIsPolling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const lastFetchRef = useRef<number>(0)
  const abortControllerRef = useRef<AbortController | null>(null)
  const inFlightRef = useRef<boolean>(false)

  const fetchQueueStatus = useCallback(async () => {
    if (!enabled) return

    // Skip if a request is already in flight
    if (inFlightRef.current) {
      return
    }

    // Debounce: don't fetch if we just fetched less than 500ms ago
    const now = Date.now()
    if (now - lastFetchRef.current < 500) {
      return
    }
    lastFetchRef.current = now

    // Abort any previous in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    // Create new abort controller for this request
    abortControllerRef.current = new AbortController()
    inFlightRef.current = true

    try {
      setIsPolling(true)
      setError(null)

      // Get session key
      const sessionKey = await ensureSessionKey()

      const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8060'
      const response = await fetch(`${API_BASE_URL}/api/queue/status`, {
        method: 'GET',
        headers: {
          'X-Session-Key': sessionKey,
          'Content-Type': 'application/json',
        },
        signal: abortControllerRef.current.signal,
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch queue status: ${response.statusText}`)
      }

      const data: QueueStatus = await response.json()
      console.log(`[QUEUE POLLING] Fetched status: ${data.jobs.length} jobs`)
      setQueueStatus(data)
    } catch (err) {
      // Ignore abort errors (these are intentional)
      if (err instanceof Error && err.name === 'AbortError') {
        return
      }

      // Ignore network errors caused by page navigation/unload (e.g., during downloads)
      // These are expected when user clicks download and browser navigates to the file URL
      const isNavigationError =
        err instanceof TypeError &&
        (err.message.includes('NetworkError') ||
         err.message.includes('Failed to fetch') ||
         err.message.includes('The user aborted a request'))

      if (!isNavigationError) {
        console.error('[QUEUE POLLING] Error fetching queue status:', err)
        setError(err instanceof Error ? err.message : 'Unknown error')
      }
      // Silently ignore navigation-related errors
    } finally {
      setIsPolling(false)
      inFlightRef.current = false
    }
  }, [enabled])

  // Set up polling interval
  useEffect(() => {
    if (!enabled) {
      // Clear interval if disabled
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    // Initial fetch
    fetchQueueStatus()

    // Set up interval
    intervalRef.current = setInterval(fetchQueueStatus, interval)

    // Stop polling when page is being unloaded (e.g., during downloads)
    const handleBeforeUnload = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [fetchQueueStatus, interval, enabled])

  // Manual refresh function
  const refresh = useCallback(() => {
    fetchQueueStatus()
  }, [fetchQueueStatus])

  return {
    queueStatus,
    isPolling,
    error,
    refresh,
  }
}
