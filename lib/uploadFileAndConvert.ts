import { ensureSessionKey } from "@/lib/utils" // you already have this
import { log, logError, logWarn, logDebug } from "./logger"
import { MultipartUploadClient } from "./MultipartUploadClient"

// Track active jobs to prevent duplicates
const activeJobs = new Set<string>()

// Track active uploads for cancellation (jobId -> {fileKey, client})
const activeUploads = new Map<string, { fileKey: string; client: MultipartUploadClient }>()

// Export function to abort an active upload
export function abortUpload(jobId: string): boolean {
  const uploadInfo = activeUploads.get(jobId)
  if (uploadInfo) {
    log(`[UPLOAD] Aborting multipart upload for job: ${jobId}`)

    // Abort multipart upload
    uploadInfo.client.abortUpload(jobId)

    activeUploads.delete(jobId)
    // Also remove from activeJobs to allow re-upload
    activeJobs.delete(uploadInfo.fileKey)
    log(`[UPLOAD] Removed ${uploadInfo.fileKey} from activeJobs, can now be re-uploaded`)
    return true
  }
  return false
}

// Multipart upload function (now used for ALL files)
async function uploadFileViaMultipart(
  file: File,
  jobId: string,
  sessionKey: string,
  fileKey: string,
  onProgress: (progress: number) => void,
  sendUploadProgress?: (jobId: string, bytesUploaded: number) => void
): Promise<void> {
  // Calculate dynamic part size: fileSize/100 for smooth progress bar
  // But enforce S3 limits: min 5MB (except last part), max to keep parts between 1-10,000
  const MIN_PART_SIZE = 5 * 1024 * 1024 // 5MB (S3 minimum for all but last part)
  const MAX_PART_SIZE = 100 * 1024 * 1024 // 100MB (reasonable maximum)
  const TARGET_PARTS = 100 // Target 100 parts for 1% granularity

  let partSize = Math.floor(file.size / TARGET_PARTS)

  // Enforce minimum part size (S3 requirement)
  if (partSize < MIN_PART_SIZE && file.size > MIN_PART_SIZE) {
    partSize = MIN_PART_SIZE
  }

  // Enforce maximum part size (prevent too large parts)
  if (partSize > MAX_PART_SIZE) {
    partSize = MAX_PART_SIZE
  }

  // For very small files (< 5MB), use single part
  if (file.size < MIN_PART_SIZE) {
    partSize = file.size
  }

  const numParts = Math.ceil(file.size / partSize)

  log(`[MULTIPART UPLOAD] Starting multipart upload`, {
    job_id: jobId,
    file_name: file.name,
    file_size: file.size,
    part_size: partSize,
    num_parts: numParts,
    progress_granularity: `${(100 / numParts).toFixed(1)}%`,
  })

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8060"
  const client = new MultipartUploadClient(apiUrl, sessionKey, {
    partSize: partSize
  })

  // Register for cancellation
  activeUploads.set(jobId, { fileKey, client })

  try {
    await client.uploadFile(file, jobId, (progress) => {
      // Update local progress
      onProgress(Math.round(progress.percentage))

      // Send progress via WebSocket
      if (sendUploadProgress) {
        sendUploadProgress(jobId, progress.uploadedBytes)
      }

      log(`[MULTIPART UPLOAD] Progress update`, {
        job_id: jobId,
        completed_parts: progress.completedParts,
        total_parts: progress.totalParts,
        percentage: progress.percentage.toFixed(1),
      })
    })

    log(`[MULTIPART UPLOAD] Upload completed successfully`, {
      job_id: jobId,
      file_name: file.name,
    })
  } catch (error) {
    logError(`[MULTIPART UPLOAD] Upload failed`, {
      job_id: jobId,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  } finally {
    // Cleanup
    activeUploads.delete(jobId)
  }
}

export async function uploadFileAndConvert(
  file: File,
  sessionKey: string,
  deviceProfile?: string,
  advancedOptions?: Record<string, any>,
  onUploadProgress?: (progress: number) => void,
  onJobCreated?: (jobId: string) => void,
  sendUploadProgress?: (jobId: string, bytesUploaded: number) => void,
) {
  const startTime = performance.now()
  log(`[TIMING] uploadFileAndConvert started for file: ${file.name} (${file.size} bytes)`)

  // Create a unique identifier for this file to prevent duplicate processing
  const fileKey = `${file.name}-${file.size}-${file.lastModified}`

  // Track if upload was cancelled
  let uploadCancelled = false

  // Check if this file is already being processed
  if (activeJobs.has(fileKey)) {
    logWarn("Duplicate job request detected and blocked", {
      filename: file.name,
      file_size: file.size,
      file_key: fileKey,
      action: "duplicate_job_prevented",
    })
    throw new Error(
      `File "${file.name}" is already being processed. Please wait for the current conversion to complete.`,
    )
  }

  // Mark this file as being processed
  activeJobs.add(fileKey)

  try {
    log("=== UPLOAD FLOW START ===", {
      filename: file.name,
      file_size: file.size,
      device_profile: deviceProfile,
      advanced_options: advancedOptions,
      file_key: fileKey,
      flow_step: "upload_start",
    })

    async function createJob(currentLicenseKey: string) {
      const jobCreateStart = performance.now()
      log(`[${new Date().toISOString()}] Sending POST request to /api/jobs`)
      const jobRes = await fetch("/api/jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Key": currentLicenseKey,
        },
        body: JSON.stringify({
          filename: file.name,
          file_size: file.size,
          device_profile: deviceProfile,
          advanced_options: advancedOptions,
        }),
      })

      if (!jobRes.ok) {
        let errorMessage = `Failed to create job (HTTP ${jobRes.status})`
        try {
          const errorData = await jobRes.json()
          if (errorData.error) {
            errorMessage = errorData.error

            // Handle 401 - Invalid session key
            if (jobRes.status === 401 && errorData.error.includes("Invalid session key")) {
              logWarn("Invalid session key (401), removing from localStorage and obtaining new session", {
                error: errorData.error
              })
              localStorage.removeItem("mangaconverter_session_key")

              // Obtain new session and retry
              const newLicenseKey = await ensureSessionKey(true)
              log("New session obtained, retrying job creation", {
                hasNewLicense: !!newLicenseKey
              })

              // Retry the request with new session
              const retryRes = await fetch("/api/jobs", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Session-Key": newLicenseKey,
                },
                body: JSON.stringify({
                  filename: file.name,
                  file_size: file.size,
                  device_profile: deviceProfile,
                  advanced_options: advancedOptions,
                }),
              })

              if (!retryRes.ok) {
                const retryError = await retryRes.json().catch(() => ({ error: "Failed to create job after session refresh" }))
                throw new Error(retryError.error || `Failed to create job after session refresh (HTTP ${retryRes.status})`)
              }

              const retryData = await retryRes.json()
              log(`[${new Date().toISOString()}] POST /jobs response received after session refresh for job: ${retryData.job_id}`)
              log(`[TIMING] Job creation with retry took ${(performance.now() - jobCreateStart).toFixed(2)}ms`)

              // Update the outer sessionKey variable
              sessionKey = newLicenseKey

              return retryData
            }
          }
        } catch (error) {
          // If this is our retry error, throw it
          if (error instanceof Error && error.message.includes("session refresh")) {
            throw error
          }
          // Otherwise, use the default message
        }
        throw new Error(errorMessage)
      }

      const jobData = await jobRes.json()
      log(`[${new Date().toISOString()}] POST /jobs response received for job: ${jobData.job_id}`)
      log(`[TIMING] Job creation took ${(performance.now() - jobCreateStart).toFixed(2)}ms`)
      return jobData
    }

    let jobData = await createJob(sessionKey)

    // Handle invalid session key
    if (jobData.error === "Invalid session key. Please register first.") {
      logWarn("Invalid session key, refreshing", jobData.job_id)
      const newLicenseKey = await ensureSessionKey(true)
      sessionKey = newLicenseKey

      jobData = await createJob(sessionKey)

      if (jobData.error) {
        throw new Error("Failed to create job after refreshing session")
      }
      log(`[${new Date().toISOString()}] POST /jobs response received after session refresh for job: ${jobData.job_id}`)
    }

    // Validate jobData
    if (!jobData.job_id) {
      throw new Error("Invalid job creation response - missing job_id")
    }

    // Notify that job was created - this enables immediate status polling
    log("Job creation successful, notifying callback", jobData.job_id, {
      hasCallback: !!onJobCreated,
      jobId: jobData.job_id,
    })

    if (onJobCreated) {
      onJobCreated(jobData.job_id)
      log("Job ID callback executed", jobData.job_id)
    } else {
      logWarn("No job creation callback provided", jobData.job_id)
    }

    // Check if job was cancelled immediately after creation (race condition)
    // This handles the case where user clicks cancel between job creation and upload start
    const statusCheckRes = await fetch(`/api/job-status/${jobData.job_id}`, {
      headers: { "X-Session-Key": sessionKey },
    })
    if (statusCheckRes.ok) {
      const statusData = await statusCheckRes.json()
      if (statusData.status === "CANCELLED") {
        log("Job was cancelled before upload could start, exiting early", jobData.job_id)
        throw new Error("Upload cancelled by user")
      }
    }

    // Step 2: Upload file using multipart upload (for all files)
    log(`Starting multipart upload`, jobData.job_id, {
      file_size: file.size,
      filename: file.name,
      flow_step: "upload_start",
    })

    // Immediately show 1% to indicate upload has started
    if (onUploadProgress) {
      onUploadProgress(1)
    }

    try {
      // Use multipart upload for all files
      await uploadFileViaMultipart(
        file,
        jobData.job_id,
        sessionKey,
        fileKey,
        (progress) => {
          if (onUploadProgress) {
            onUploadProgress(progress)
          }
        },
        sendUploadProgress
      )

      const totalTime = performance.now() - startTime
      log(`Multipart upload completed successfully`, jobData.job_id, {
        filename: file.name,
        total_duration: totalTime,
        file_key: fileKey,
        upload_method: "multipart",
        flow_step: "upload_complete",
      })

      // Return immediately - backend will automatically start processing
      return {
        job_id: jobData.job_id,
        status: "QUEUED", // Backend will transition to PROCESSING
      }

    } catch (error) {
      // Check if it was a user cancellation
      if (error instanceof Error && error.message.includes("cancelled by user")) {
        log("Upload cancelled by user", jobData.job_id)
        throw new Error("Upload cancelled by user")
      }

      logError("Multipart upload failed", jobData.job_id, {
        error: error instanceof Error ? error.message : String(error),
      })
      throw new Error(`Upload failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  } finally {
    // Always remove the file from active jobs tracking when done
    activeJobs.delete(fileKey)
    log("File removed from active jobs tracking", {
      filename: file.name,
      file_key: fileKey,
      remaining_active_jobs: activeJobs.size,
    })
  }
}
