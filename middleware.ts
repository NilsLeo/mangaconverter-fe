import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

const isClerkConfigured = !!process.env.CLERK_SECRET_KEY

export default async function middleware(request: NextRequest) {
  // If Clerk is configured, use clerkMiddleware
  if (isClerkConfigured) {
    const { clerkMiddleware } = await import("@clerk/nextjs/server")
    return clerkMiddleware((auth, req: NextRequest) => {
      const response = NextResponse.next()

      // Increase the timeout for large file uploads and downloads
      if (req.nextUrl.pathname.startsWith("/download/") || req.nextUrl.pathname.startsWith("/api/download/")) {
        response.headers.set("Connection", "keep-alive")
        response.headers.set("Keep-Alive", "timeout=3600, max=1000")
      }

      return response
    })(request, {} as any)
  }

  // Without Clerk, just handle the request normally
  const response = NextResponse.next()

  if (request.nextUrl.pathname.startsWith("/download/") || request.nextUrl.pathname.startsWith("/api/download/")) {
    response.headers.set("Connection", "keep-alive")
    response.headers.set("Keep-Alive", "timeout=3600, max=1000")
  }

  return response
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
}
