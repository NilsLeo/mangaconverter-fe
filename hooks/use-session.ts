/**
 * React hook for session management
 * Automatically handles session creation and claiming
 */

import { useAuth, useUser } from "@clerk/nextjs"
import { useEffect, useState } from "react"
import { ensureSession, getSessionKey } from "@/lib/session"

export function useSession() {
  const { isSignedIn, user } = useUser()
  const { getToken } = useAuth()
  const [sessionKey, setSessionKey] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    async function initializeSession() {
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
      } catch (err) {
        console.error("[useSession] Failed to initialize session:", err)
        setError(err instanceof Error ? err : new Error("Unknown error"))

        // Fallback: try to use existing session from localStorage
        const existingSession = getSessionKey()
        if (existingSession) {
          console.log('[useSession] Using fallback session from localStorage', { existingSession })
          setSessionKey(existingSession)
        }
      } finally {
        setIsLoading(false)
      }
    }

    console.log('[useSession] Effect triggered', { isSignedIn, userId: user?.id })
    initializeSession()
  }, [isSignedIn, user, getToken])

  return {
    sessionKey,
    isLoading,
    error,
    isAnonymous: !isSignedIn,
  }
}
