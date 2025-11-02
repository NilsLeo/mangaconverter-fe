import { clerkMiddleware } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export default clerkMiddleware((auth, request: NextRequest) => {
  // Get response object
  const response = NextResponse.next()

  // Increase the timeout for large file uploads and downloads
  if (request.nextUrl.pathname.startsWith("/download/") || request.nextUrl.pathname.startsWith("/api/download/")) {
    // Set a longer timeout for the request
    response.headers.set("Connection", "keep-alive")
    response.headers.set("Keep-Alive", "timeout=3600, max=1000") // 1 hour timeout, 1000 max requests
  }

  return response
})

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
}
