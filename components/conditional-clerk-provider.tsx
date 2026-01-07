"use client"

import type React from "react"
import { ClerkProvider } from "@clerk/nextjs"

// Check if Clerk is configured by looking for the publishable key
const isClerkConfigured =
  typeof window !== "undefined"
    ? !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    : !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY

export function ConditionalClerkProvider({ children }: { children: React.ReactNode }) {
  // If Clerk is not configured, render children without the provider
  if (!isClerkConfigured) {
    return <>{children}</>
  }

  return <ClerkProvider dynamic>{children}</ClerkProvider>
}
