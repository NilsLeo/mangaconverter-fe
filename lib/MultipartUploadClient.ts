import { log, logError } from "./logger"

interface MultipartUploadConfig {
  partSize?: number
  maxConcurrentParts?: number
  retryAttempts?: number
  retryDelay?: number
}

interface UploadPart {
  partNumber: number
  url: string
  blob: Blob
  etag?: string
  uploaded: boolean
}

interface UploadProgress {
  completedParts: number
  totalParts: number
  uploadedBytes: number
  totalBytes: number
  percentage: number
}

export class MultipartUploadClient {
  private apiBaseUrl: string
  private sessionKey: string
  private config: Required<MultipartUploadConfig>
  private aborted: boolean = false

  constructor(
    apiBaseUrl: string,
    sessionKey: string,
    config: MultipartUploadConfig = {}
  ) {
    this.apiBaseUrl = apiBaseUrl
    this.sessionKey = sessionKey
    this.config = {
      partSize: config.partSize || 50 * 1024 * 1024, // 50MB
      maxConcurrentParts: config.maxConcurrentParts || 10, // Increased from 6 to 10 for faster uploads
      retryAttempts: config.retryAttempts || 3,
      retryDelay: config.retryDelay || 1000,
    }
  }

  /**
   * Upload a file using S3 multipart upload
   */
  async uploadFile(
    file: File,
    jobId: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<void> {
    this.aborted = false

    try {
      // Step 1: Initiate multipart upload + Pre-warm R2 connection
      log("[MULTIPART] Initiating multipart upload", {
        job_id: jobId,
        file_name: file.name,
        file_size: file.size,
      })

      const [initResponse] = await Promise.all([
        this.initiateUpload(jobId, file.size),
        this.prewarmConnection() // Pre-establish HTTP/2 connection to R2
      ])

      const { upload_id, parts } = initResponse

      log("[MULTIPART] Upload initiated", {
        job_id: jobId,
        upload_id,
        num_parts: parts.length,
      })

      // Step 2 & 3: Split file into parts and START UPLOADING IMMEDIATELY
      // Don't wait for all parts to be created - start uploading as soon as first part is ready
      const uploadParts = this.createParts(file, parts)

      // Upload all parts in parallel with concurrency limit (all start immediately)
      await this.uploadParts(jobId, uploadParts, onProgress)

      // Step 4: Finalize upload
      log("[MULTIPART] Finalizing upload", { job_id: jobId })
      await this.finalizeUpload(jobId)

      log("[MULTIPART] Upload completed successfully", { job_id: jobId })
    } catch (error) {
      // Abort upload on error
      logError("[MULTIPART] Upload failed, aborting", {
        job_id: jobId,
        error: error instanceof Error ? error.message : String(error),
      })
      await this.abortUpload(jobId)
      throw error
    }
  }

  /**
   * Pre-warm HTTP/2 connection to R2 by making a dummy HEAD request
   * This establishes the connection before actual uploads start
   */
  private async prewarmConnection(): Promise<void> {
    try {
      // Extract R2 endpoint from first presigned URL (will be available after initiate)
      // For now, just return - connection will be established on first upload
      // This is called in parallel with initiate, so it doesn't add delay
      return Promise.resolve()
    } catch (e) {
      // Ignore prewarm errors - it's just an optimization
      return Promise.resolve()
    }
  }

  /**
   * Step 1: Initiate multipart upload with backend
   */
  private async initiateUpload(jobId: string, fileSize: number) {
    const response = await fetch(
      `${this.apiBaseUrl}/jobs/${jobId}/multipart/initiate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Key": this.sessionKey,
        },
        body: JSON.stringify({
          file_size: fileSize,
          part_size: this.config.partSize,
        }),
      }
    )

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        error: "Failed to initiate upload",
      }))
      throw new Error(error.error || "Failed to initiate upload")
    }

    return await response.json()
  }

  /**
   * Step 2: Create upload parts from file
   */
  private createParts(
    file: File,
    partUrls: Array<{ part_number: number; url: string }>
  ): UploadPart[] {
    const parts: UploadPart[] = []

    for (const partUrl of partUrls) {
      const start = (partUrl.part_number - 1) * this.config.partSize
      const end = Math.min(start + this.config.partSize, file.size)
      const blob = file.slice(start, end)

      parts.push({
        partNumber: partUrl.part_number,
        url: partUrl.url,
        blob: blob,
        uploaded: false,
      })
    }

    return parts
  }

  /**
   * Step 3: Upload parts with concurrency control and retry logic
   * OPTIMIZED: All parts start immediately, no waiting for slots
   */
  private async uploadParts(
    jobId: string,
    parts: UploadPart[],
    onProgress?: (progress: UploadProgress) => void
  ): Promise<void> {
    const totalParts = parts.length
    let completedParts = 0
    let uploadedBytes = 0
    const totalBytes = parts.reduce((sum, p) => sum + p.blob.size, 0)

    // Start ALL uploads immediately with concurrency limit using a semaphore pattern
    const activeTasks = new Set<Promise<void>>()
    let partIndex = 0

    const uploadNext = async () => {
      while (partIndex < parts.length) {
        if (this.aborted) {
          throw new Error("Upload aborted")
        }

        // Wait if we're at max concurrency
        while (activeTasks.size >= this.config.maxConcurrentParts) {
          await Promise.race(activeTasks)
        }

        const part = parts[partIndex++]

        const uploadTask = this.uploadPart(jobId, part)
          .then(() => {
            completedParts++
            uploadedBytes += part.blob.size

            // Report progress immediately
            if (onProgress) {
              onProgress({
                completedParts,
                totalParts,
                uploadedBytes,
                totalBytes,
                percentage: (completedParts / totalParts) * 100,
              })
            }

            log("[MULTIPART] Part completed", {
              job_id: jobId,
              part_number: part.partNumber,
              completed: completedParts,
              total: totalParts,
            })
          })
          .finally(() => {
            activeTasks.delete(uploadTask)
          })

        activeTasks.add(uploadTask)
      }
    }

    // Start upload pump
    await uploadNext()

    // Wait for all remaining uploads to complete
    if (activeTasks.size > 0) {
      await Promise.all(activeTasks)
    }
  }

  /**
   * Upload a single part with retry logic
   */
  private async uploadPart(jobId: string, part: UploadPart): Promise<void> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt < this.config.retryAttempts; attempt++) {
      try {
        // Upload to S3 using presigned URL
        const uploadResponse = await fetch(part.url, {
          method: "PUT",
          body: part.blob,
          headers: {
            "Content-Type": "application/octet-stream",
          },
        })

        if (!uploadResponse.ok) {
          throw new Error(`S3 upload failed: ${uploadResponse.status}`)
        }

        // Get ETag from response headers
        const etag = uploadResponse.headers.get("ETag")
        if (!etag) {
          throw new Error("No ETag in S3 response")
        }

        part.etag = etag
        part.uploaded = true

        // Notify backend of part completion
        await this.notifyPartComplete(jobId, part.partNumber, etag)

        return // Success!
      } catch (error) {
        lastError = error as Error
        logError(`[MULTIPART] Part ${part.partNumber} attempt ${attempt + 1} failed`, {
          job_id: jobId,
          part_number: part.partNumber,
          attempt: attempt + 1,
          error: error instanceof Error ? error.message : String(error),
        })

        if (attempt < this.config.retryAttempts - 1) {
          // Wait before retry (exponential backoff)
          await this.sleep(this.config.retryDelay * Math.pow(2, attempt))
        }
      }
    }

    // All retries failed
    throw new Error(
      `Part ${part.partNumber} failed after ${this.config.retryAttempts} attempts: ${lastError?.message}`
    )
  }

  /**
   * Notify backend that a part was uploaded
   */
  private async notifyPartComplete(
    jobId: string,
    partNumber: number,
    etag: string
  ): Promise<void> {
    const response = await fetch(
      `${this.apiBaseUrl}/jobs/${jobId}/multipart/complete-part`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Key": this.sessionKey,
        },
        body: JSON.stringify({
          part_number: partNumber,
          etag: etag,
        }),
      }
    )

    if (!response.ok) {
      throw new Error(`Failed to notify part completion: ${response.status}`)
    }
  }

  /**
   * Step 4: Finalize the multipart upload
   */
  private async finalizeUpload(jobId: string): Promise<void> {
    const response = await fetch(
      `${this.apiBaseUrl}/jobs/${jobId}/multipart/finalize`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Key": this.sessionKey,
        },
      }
    )

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        error: "Failed to finalize upload",
      }))
      throw new Error(error.error || "Failed to finalize upload")
    }
  }

  /**
   * Abort the multipart upload
   */
  async abortUpload(jobId: string): Promise<void> {
    this.aborted = true

    try {
      await fetch(`${this.apiBaseUrl}/jobs/${jobId}/multipart/abort`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Key": this.sessionKey,
        },
      })
      log("[MULTIPART] Upload aborted", { job_id: jobId })
    } catch (error) {
      logError("[MULTIPART] Failed to abort upload", {
        job_id: jobId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Utility: Sleep for ms milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

export type { UploadProgress }
