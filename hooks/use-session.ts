/**
 * React hook for session management
 * Supports both automatic and lazy initialization
 */

import { useAuth, useUser } from "@clerk/nextjs"
import { useCallback, useEffect, useState } from "react"
import { ensureSession, getSessionKey } from "@/lib/session"

interface UseSessionOptions {
  /**
   * If true, initializes session immediately on mount
   * If false, session is only initialized when initializeSession() is called
   * Default: false (lazy initialization)
   */
  autoInitialize?: boolean
}

export function useSession(options: UseSessionOptions = {}) {
  const { autoInitialize = false } = options
  const { isSignedIn, user } = useUser()
  const { getToken } = useAuth()
  const [sessionKey, setSessionKey] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [hasInitialized, setHasInitialized] = useState(false)

  const initializeSession = useCallback(async () => {
    // Don't re-initialize if already done
    if (hasInitialized) {
      console.log('[useSession] Already initialized, skipping')
      return sessionKey
    }

    try {
      setIsLoading(true)
      setError(null)

      // Get Clerk JWT token if signed in
      let clerkToken: string | undefined
      if (isSignedIn && user) {
        try {
          clerkToken = await getToken()
          console.log('[useSession] Got Clerk JWT token', { hasToken: !!clerkToken })
        } catch (error) {
          console.error('[useSession] Failed to get Clerk token:', error)
        }
      }

      const email = user?.primaryEmailAddress?.emailAddress
      const firstName = user?.firstName || undefined
      const lastName = user?.lastName || undefined

      console.log('[useSession] Initializing session', {
        isSignedIn,
        hasUser: !!user,
        hasToken: !!clerkToken,
        userEmail: email,
        firstName,
        lastName
      })

      // Ensure session exists (creates or claims as needed)
      const session = await ensureSession(clerkToken, email, firstName, lastName)
      console.log('[useSession] Session initialized successfully', { session })
      setSessionKey(session)
      setHasInitialized(true)
      return session
    } catch (err) {
      console.error("[useSession] Failed to initialize session:", err)
      setError(err instanceof Error ? err : new Error("Unknown error"))

      // Fallback: try to use existing session from localStorage
      const existingSession = getSessionKey()
      if (existingSession) {
        console.log('[useSession] Using fallback session from localStorage', { existingSession })
        setSessionKey(existingSession)
        setHasInitialized(true)
        return existingSession
      }
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [isSignedIn, user, getToken, hasInitialized, sessionKey])

  // Auto-initialize on mount if enabled
  useEffect(() => {
    if (autoInitialize && !hasInitialized) {
      console.log('[useSession] Auto-initializing session')
      initializeSession()
    }
  }, [autoInitialize, hasInitialized, initializeSession])

  // Check for existing session in localStorage on mount
  useEffect(() => {
    const existingSession = getSessionKey()
    if (existingSession && !sessionKey) {
      console.log('[useSession] Found existing session in localStorage', { existingSession })
      setSessionKey(existingSession)
      setHasInitialized(true)
    }
  }, [sessionKey])

  return {
    sessionKey,
    isLoading,
    error,
    isAnonymous: !isSignedIn,
    initializeSession, // Expose manual initialization function
  }
}
