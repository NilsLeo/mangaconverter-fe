import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

// This function can be marked `async` if using `await` inside
export function middleware(request: NextRequest) {
  // Get response object
  const response = NextResponse.next();
  
  // Increase the timeout for large file uploads and downloads
  if (
    request.nextUrl.pathname.startsWith("/download/") ||
    request.nextUrl.pathname.startsWith("/api/download/")
  ) {
    // Set a longer timeout for the request
    response.headers.set("Connection", "keep-alive")
    response.headers.set("Keep-Alive", "timeout=3600, max=1000") // 1 hour timeout, 1000 max requests
  }

  return response
}

// See "Matching Paths" below to learn more
export const config = {
  matcher: [
    "/download/:path*",
    "/api/download/:path*",
    "/api/:path*",
  ],
}