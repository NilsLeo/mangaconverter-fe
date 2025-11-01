import { ensureLicenseKey } from "@/lib/utils" // you already have this
import { log, logError, logWarn, logDebug } from "./logger"

// Track active jobs to prevent duplicates
const activeJobs = new Set<string>()

// Track active uploads for cancellation (jobId -> {xhr, fileKey, abortController})
const activeUploads = new Map<string, { xhr?: XMLHttpRequest; fileKey: string; abortController?: AbortController }>()

// Export function to abort an active upload
export function abortUpload(jobId: string): boolean {
  const uploadInfo = activeUploads.get(jobId)
  if (uploadInfo) {
    log(`[UPLOAD] Aborting upload for job: ${jobId}`)

    // Abort XHR if present (old S3 upload method)
    if (uploadInfo.xhr) {
      uploadInfo.xhr.abort()
    }

    // Abort fetch requests if present (new chunked upload method)
    if (uploadInfo.abortController) {
      uploadInfo.abortController.abort()
    }

    activeUploads.delete(jobId)
    // Also remove from activeJobs to allow re-upload
    activeJobs.delete(uploadInfo.fileKey)
    log(`[UPLOAD] Removed ${uploadInfo.fileKey} from activeJobs, can now be re-uploaded`)
    return true
  }
  return false
}

// New chunked upload function
async function uploadFileInChunks(
  file: File,
  jobId: string,
  licenseKey: string,
  fileKey: string,
  onProgress: (progress: number) => void,
  sendUploadProgress?: (jobId: string, bytesUploaded: number) => void
): Promise<void> {
  const CHUNK_SIZE = 20 * 1024 * 1024 // 20MB chunks
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
  let uploadedBytes = 0

  log(`[CHUNKED UPLOAD] Starting chunked upload`, {
    job_id: jobId,
    file_name: file.name,
    file_size: file.size,
    chunk_size: CHUNK_SIZE,
    total_chunks: totalChunks
  })

  // Create abort controller for cancellation
  const abortController = new AbortController()

  // Register for cancellation
  activeUploads.set(jobId, { fileKey, abortController })

  try {
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      // Check if upload was cancelled
      if (abortController.signal.aborted) {
        log(`[CHUNKED UPLOAD] Upload cancelled by user at chunk ${chunkIndex}`, { job_id: jobId })
        throw new Error("Upload cancelled by user")
      }

      const start = chunkIndex * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, file.size)
      const chunk = file.slice(start, end)

      log(`[CHUNKED UPLOAD] Uploading chunk ${chunkIndex + 1}/${totalChunks}`, {
        job_id: jobId,
        chunk_index: chunkIndex,
        chunk_size: chunk.size,
        start_byte: start,
        end_byte: end
      })

      // Create FormData with chunk
      const formData = new FormData()
      formData.append('chunk', chunk)
      formData.append('chunkIndex', chunkIndex.toString())
      formData.append('totalChunks', totalChunks.toString())
      formData.append('fileName', file.name)

      // Upload chunk directly to backend (bypass Next.js proxy to avoid buffering)
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8060"
      const response = await fetch(`${apiUrl}/jobs/${jobId}/upload-chunk`, {
        method: 'POST',
        headers: {
          'X-License-Key': licenseKey
        },
        body: formData,
        signal: abortController.signal
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Upload failed' }))
        throw new Error(errorData.error || `Chunk ${chunkIndex} upload failed`)
      }

      // Update progress
      uploadedBytes += chunk.size
      const progress = Math.min(100, Math.round((uploadedBytes / file.size) * 100))
      onProgress(progress)

      // Send progress via WebSocket
      if (sendUploadProgress) {
        sendUploadProgress(jobId, uploadedBytes)
      }

      log(`[CHUNKED UPLOAD] Chunk ${chunkIndex + 1}/${totalChunks} uploaded successfully`, {
        job_id: jobId,
        uploaded_bytes: uploadedBytes,
        total_bytes: file.size,
        progress_percent: progress
      })

      // Optional: Small delay between chunks to avoid overwhelming the server
      // await new Promise(resolve => setTimeout(resolve, 10))
    }

    // All chunks uploaded successfully
    log(`[CHUNKED UPLOAD] All chunks uploaded successfully`, {
      job_id: jobId,
      total_chunks: totalChunks,
      total_bytes: uploadedBytes
    })

    // Ensure progress shows 100%
    onProgress(100)
    if (sendUploadProgress) {
      sendUploadProgress(jobId, file.size)
    }

  } catch (error) {
    // Check if it was a user cancellation
    if (error instanceof Error && (error.message.includes("cancelled") || error.name === "AbortError")) {
      log(`[CHUNKED UPLOAD] Upload cancelled`, { job_id: jobId })
      throw new Error("Upload cancelled by user")
    }

    logError(`[CHUNKED UPLOAD] Upload failed`, {
      job_id: jobId,
      error: error instanceof Error ? error.message : String(error)
    })
    throw error
  } finally {
    // Cleanup
    activeUploads.delete(jobId)
  }
}

export async function uploadFileAndConvert(
  file: File,
  licenseKey: string,
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
          "X-License-Key": currentLicenseKey,
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

            // Handle 401 - Invalid license key
            if (jobRes.status === 401 && errorData.error.includes("Invalid license key")) {
              logWarn("Invalid license key (401), removing from localStorage and obtaining new license", {
                error: errorData.error
              })
              localStorage.removeItem("mangaconverter_license_key")

              // Obtain new license and retry
              const newLicenseKey = await ensureLicenseKey(true)
              log("New license obtained, retrying job creation", {
                hasNewLicense: !!newLicenseKey
              })

              // Retry the request with new license
              const retryRes = await fetch("/api/jobs", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-License-Key": newLicenseKey,
                },
                body: JSON.stringify({
                  filename: file.name,
                  file_size: file.size,
                  device_profile: deviceProfile,
                  advanced_options: advancedOptions,
                }),
              })

              if (!retryRes.ok) {
                const retryError = await retryRes.json().catch(() => ({ error: "Failed to create job after license refresh" }))
                throw new Error(retryError.error || `Failed to create job after license refresh (HTTP ${retryRes.status})`)
              }

              const retryData = await retryRes.json()
              log(`[${new Date().toISOString()}] POST /jobs response received after license refresh for job: ${retryData.job_id}`)
              log(`[TIMING] Job creation with retry took ${(performance.now() - jobCreateStart).toFixed(2)}ms`)

              // Update the outer licenseKey variable
              licenseKey = newLicenseKey

              return retryData
            }
          }
        } catch (error) {
          // If this is our retry error, throw it
          if (error instanceof Error && error.message.includes("license refresh")) {
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

    let jobData = await createJob(licenseKey)

    // Handle invalid license key
    if (jobData.error === "Invalid license key. Please register first.") {
      logWarn("Invalid license key, refreshing", jobData.job_id)
      const newLicenseKey = await ensureLicenseKey(true)
      licenseKey = newLicenseKey

      jobData = await createJob(licenseKey)

      if (jobData.error) {
        throw new Error("Failed to create job after refreshing license")
      }
      log(`[${new Date().toISOString()}] POST /jobs response received after license refresh for job: ${jobData.job_id}`)
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
      headers: { "X-License-Key": licenseKey },
    })
    if (statusCheckRes.ok) {
      const statusData = await statusCheckRes.json()
      if (statusData.status === "CANCELLED") {
        log("Job was cancelled before upload could start, exiting early", jobData.job_id)
        throw new Error("Upload cancelled by user")
      }
    }

    // Step 2: Upload file in chunks to backend
    log("Starting chunked upload", jobData.job_id, {
      file_size: file.size,
      filename: file.name,
      flow_step: "chunked_upload_start",
    })

    // Immediately show 1% to indicate upload has started
    if (onUploadProgress) {
      onUploadProgress(1)
    }

    try {
      // Use chunked upload - this will automatically trigger processing when complete
      await uploadFileInChunks(
        file,
        jobData.job_id,
        licenseKey,
        fileKey,
        (progress) => {
          if (onUploadProgress) {
            onUploadProgress(progress)
          }
        },
        sendUploadProgress
      )

      const totalTime = performance.now() - startTime
      log("Chunked upload completed successfully", jobData.job_id, {
        filename: file.name,
        total_duration: totalTime,
        file_key: fileKey,
        flow_step: "upload_complete",
      })

      // Return immediately - backend will automatically start processing
      // No need to call /start endpoint - chunked upload triggers it automatically
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

      logError("Chunked upload failed", jobData.job_id, {
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
