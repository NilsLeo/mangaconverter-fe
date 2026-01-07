"use client"

/**
 * React hook for session management
 * Supports both automatic and lazy initialization
 */

import { useCallback, useEffect, useState } from "react"
import { ensureSession, getSessionKey } from "@/lib/session"

const isClerkConfigured = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY

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
  const [sessionKey, setSessionKey] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [hasInitialized, setHasInitialized] = useState(false)

  const [clerkAuth, setClerkAuth] = useState<{
    isSignedIn: boolean
    user: any
    getToken: () => Promise<string | null>
  } | null>(null)

  useEffect(() => {
    if (isClerkConfigured) {
      import("@clerk/nextjs").then((mod) => {
        // We can't use hooks outside of components, so we'll handle this differently
        setClerkAuth({
          isSignedIn: false,
          user: null,
          getToken: async () => null,
        })
      })
    }
  }, [])

  const initializeSession = useCallback(async () => {
    // Don't re-initialize if already done
    if (hasInitialized) {
      console.log("[useSession] Already initialized, skipping")
      return sessionKey
    }

    try {
      setIsLoading(true)
      setError(null)

      let clerkToken: string | undefined

      console.log("[useSession] Initializing session", {
        isClerkConfigured,
      })

      // Ensure session exists (creates or claims as needed)
      const session = await ensureSession(clerkToken, undefined, undefined, undefined)
      console.log("[useSession] Session initialized successfully", { session })
      setSessionKey(session)
      setHasInitialized(true)
      return session
    } catch (err) {
      console.error("[useSession] Failed to initialize session:", err)
      setError(err instanceof Error ? err : new Error("Unknown error"))

      // Fallback: try to use existing session from localStorage
      const existingSession = getSessionKey()
      if (existingSession) {
        console.log("[useSession] Using fallback session from localStorage", { existingSession })
        setSessionKey(existingSession)
        setHasInitialized(true)
        return existingSession
      }
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [hasInitialized, sessionKey])

  // Auto-initialize on mount if enabled
  useEffect(() => {
    if (autoInitialize && !hasInitialized) {
      console.log("[useSession] Auto-initializing session")
      initializeSession()
    }
  }, [autoInitialize, hasInitialized, initializeSession])

  // Check for existing session in localStorage on mount
  useEffect(() => {
    const existingSession = getSessionKey()
    if (existingSession && !sessionKey) {
      console.log("[useSession] Found existing session in localStorage", { existingSession })
      setSessionKey(existingSession)
      setHasInitialized(true)
    }
  }, [sessionKey])

  return {
    sessionKey,
    isLoading,
    error,
    isAnonymous: !clerkAuth?.isSignedIn,
    initializeSession,
  }
}
