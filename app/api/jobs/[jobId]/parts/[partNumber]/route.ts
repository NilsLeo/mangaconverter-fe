import { type NextRequest, NextResponse } from "next/server"

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ jobId: string; partNumber: string }> }
) {
  const { jobId, partNumber } = await context.params

  // Use API_BASE_URL for server-side requests
  const apiBaseUrl = process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_URL

  if (!apiBaseUrl) {
    return NextResponse.json({ error: "Backend API URL not configured" }, { status: 500 })
  }

  const licenseKey = request.headers.get("X-License-Key")
  if (!licenseKey) {
    return NextResponse.json({ success: false, error: "No license key provided" }, { status: 401 })
  }

  try {
    // Get presigned URL from backend (no chunk data needed)
    const response = await fetch(`${apiBaseUrl}/jobs/${jobId}/parts/${partNumber}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-License-Key": licenseKey,
      },
    })

    const responseData = await response.json()
    return NextResponse.json(responseData, { status: response.status })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    )
  }
}
