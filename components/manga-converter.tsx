"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { toast } from "sonner"
import { uploadFileAndConvert } from "@/lib/uploadFileAndConvert" // make sure you import it
import { ConversionQueue } from "./conversion-queue"
import { Footer } from "./footer"
import { DEVICE_PROFILES } from "@/lib/device-profiles"
import { fetchWithLicense, ensureSessionKey } from "@/lib/utils"
import { log, logError, logWarn } from "@/lib/logger"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { ConvertedFileInfo } from "./converted-files" // Removed ConvertedFiles import since we're not using the separate section anymore
import { LoaderIcon, ChevronsRight } from "lucide-react"
import { AdvancedOptions } from "./advanced-options"
import { FileUploader } from "./file-uploader"
import { ALL_SUPPORTED_EXTENSIONS } from "@/lib/fileValidation"
import { DeviceSelector } from "./device-selector"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useConverterMode } from "@/contexts/converter-mode-context"
import { useQueuePolling, type QueueJob } from "@/hooks/useQueuePolling"
import { MyDownloads } from "./my-downloads"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ChevronDown, ChevronUp, Download } from "lucide-react"
import { useUser } from "@clerk/nextjs"
import { SignUpButton } from "@clerk/nextjs"

export type PendingUpload = {
  name: string
  size: number
  file: File
  error?: string
  jobId?: string
  status?: string
  isMonitoring?: boolean
  isConverted?: boolean // Flag to indicate this is a converted file
  convertedName?: string // Output filename after conversion
  downloadId?: string // ID for downloading the converted file
  convertedTimestamp?: number // When the conversion completed
  outputFileSize?: number // Size of the converted file
  inputFileSize?: number // Original file size
  actualDuration?: number // Time taken for conversion
  queuedAt?: number // Timestamp when job entered QUEUED status (for calculating download progress)
  processing_progress?: {
    elapsed_seconds: number
    remaining_seconds: number
    projected_eta: number
    progress_percent: number
  }
  upload_progress?: {
    completed_parts: number
    total_parts: number
    uploaded_bytes: number
    total_bytes: number
    percentage: number
  }
  worker_download_speed_mbps?: number // Worker download speed for simulating Reading File stage
}

export type AdvancedOptionsType = {
  mangaStyle: boolean
  hq: boolean
  twoPanel: boolean
  webtoon: boolean
  targetSize: number
  noProcessing: boolean
  upscale: boolean
  stretch: boolean
  splitter: number
  gamma: number
  outputFormat: string
  author: string
  noKepub: boolean
  customWidth: number
  customHeight: number
}

// Helper function to convert frontend options to backend format
function convertAdvancedOptionsToBackend(options: AdvancedOptionsType) {
  return {
    manga_style: options.mangaStyle,
    hq: options.hq,
    two_panel: options.twoPanel,
    webtoon: options.webtoon,
    target_size: options.targetSize || undefined,
    no_processing: options.noProcessing,
    upscale: options.upscale,
    stretch: options.stretch,
    splitter: options.splitter,
    gamma: options.gamma || undefined,
    output_format: options.outputFormat !== "Auto" ? options.outputFormat : undefined,
    author: options.author || undefined,
    no_kepub: options.noKepub,
    custom_width: options.customWidth || undefined,
    custom_height: options.customHeight || undefined,
  }
}

export function MangaConverter({ contentType }: { contentType: "comic" | "manga" }) {
  const { mode } = useConverterMode()
  const isManga = mode === "manga"
  const isComic = mode === "comic"
  const { user, isLoaded: isUserLoaded } = useUser()

  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([])
  const [selectedProfile, setSelectedProfile] = useState<string>("Placeholder")
  const [isConverting, setIsConverting] = useState(false)
  const [convertedFiles, setConvertedFiles] = useState<ConvertedFileInfo[]>([])
  const [uploadProgress, setUploadProgress] = useState<number>(0)
  const [uploadProgressConfirmed, setUploadProgressConfirmed] = useState<number>(0)
  const [conversionProgress, setConversionProgress] = useState<number>(0)
  const [isUploaded, setIsUploaded] = useState<boolean>(false)
  const [eta, setEta] = useState<number | undefined>(undefined)
  const [remainingTime, setRemainingTime] = useState<number | undefined>(undefined)
  const [currentStatus, setCurrentStatus] = useState<string | undefined>(undefined)

  // Track last logged progress percent for logging changes
  const lastLoggedProgressRef = useRef<number>(-1)

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [downloadsOpen, setDownloadsOpen] = useState(false)

  const [needsConfiguration, setNeedsConfiguration] = useState(false)
  const [globalConfigPulsate, setGlobalConfigPulsate] = useState(false)

  // Track which jobs are being dismissed (jobId -> true)
  const [dismissingJobs, setDismissingJobs] = useState<Set<string>>(new Set())
  // Keep a short-lived memory of jobs the user dismissed to avoid re-adding
  const recentlyDismissedRef = useRef<Map<string, number>>(new Map())

  // Track which jobs are being cancelled (jobId -> true)
  const [cancellingJobs, setCancellingJobs] = useState<Set<string>>(new Set())

  // Track initialization state to show spinner during page load
  const [isInitializing, setIsInitializing] = useState(true)

  const handleNeedsConfiguration = () => {
    setNeedsConfiguration(true)
    // Auto-reset after animation completes
    setTimeout(() => setNeedsConfiguration(false), 3000)
  }

  const handleGlobalConfigPulsate = () => {
    setGlobalConfigPulsate(true)
    setTimeout(() => setGlobalConfigPulsate(false), 3000)
  }

  const [advancedOptions, setAdvancedOptions] = useState<AdvancedOptionsType>({
    mangaStyle: isManga,
    hq: true,
    twoPanel: false,
    webtoon: false,
    targetSize: 400,
    noProcessing: false,
    upscale: true,
    stretch: false,
    splitter: 0,
    gamma: 0.0,
    outputFormat: "Auto",
    author: "KCC",
    noKepub: false,
    customWidth: 0,
    customHeight: 0,
  })

  const MAX_FILES = Number(process.env.NEXT_PUBLIC_MAX_FILES) || 10

  // Initialize WebSocket for queue status updates
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8060"
  const {
    queueStatus,
    isPolling: isConnecting,
    error: wsError,
  } = useQueuePolling(
    undefined,
    true, // always listen when component is mounted
  )

  const fileInputRef = useRef<HTMLInputElement>(null)
  const completionToastsShown = useRef<Set<string>>(new Set()) // Track which jobs have shown completion toast

  const handleAddMoreFiles = () => {
    fileInputRef.current?.click()
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileUpload(Array.from(e.target.files))
      // Reset input so same file can be selected again
      e.target.value = ""
    }
  }

  useEffect(() => {
    const loadPersistedJobs = async () => {
      try {
        const stored = localStorage.getItem("monitored_jobs")
        if (stored) {
          const jobs = JSON.parse(stored) as Array<{
            jobId: string
            name: string
            size: number
            status: string
            timestamp: number
            createdAt?: number
            inputFilename?: string
            inputFileSize?: number
            outputFilename?: string
            outputFileSize?: number
            downloadId?: string
            actualDuration?: number // Added for actual duration
            // Load per-file settings from storage
            deviceProfile?: string
            advancedOptions?: Partial<AdvancedOptionsType>
            // Add fields for converted files
            isConverted?: boolean
            convertedName?: string
            convertedTimestamp?: number
            outputFileSize?: number
            inputFileSize?: number
            actualDuration?: number
          }>

          // Filter out jobs older than 24 hours
          const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000
          const recentJobs = jobs.filter((job) => (job.createdAt || job.timestamp) > oneDayAgo)

          // Separate completed and active jobs (backend/Redis filters dismissals)
          const completedJobs = recentJobs.filter((job) => job.status === "COMPLETE")
          const activeJobs = recentJobs.filter(
            (job) =>
              job.status !== "COMPLETE" &&
              job.status !== "ERRORED" &&
              job.status !== "CANCELLED" &&
              job.status !== "UPLOADING",
          )

          // Restore completed jobs to converted files
          if (completedJobs.length > 0) {
            const convertedFilesFromStorage = completedJobs.map((job) => ({
              id: job.jobId,
              originalName: job.inputFilename || job.name,
              convertedName: job.outputFilename || job.name,
              downloadId: job.downloadId || job.jobId,
              timestamp: job.createdAt || job.timestamp,
              device: job.deviceProfile || "Unknown device",
              size: job.outputFileSize,
              inputFileSize: job.inputFileSize,
              actualDuration: job.actualDuration,
            }))

            setConvertedFiles(convertedFilesFromStorage)
          }

          // Create placeholder PendingUpload entries for active jobs
          if (activeJobs.length > 0) {
            const monitoringUploads: PendingUpload[] = activeJobs.map((job) => ({
              name: job.name,
              size: job.size,
              file: new File([], job.name), // Placeholder file
              jobId: job.jobId,
              status: job.status,
              isMonitoring: true,
              // Restore per-file settings
              deviceProfile: job.deviceProfile,
              advancedOptions: job.advancedOptions,
              // Restore converted file properties if applicable
              isConverted: job.status === "COMPLETE", // Mark as converted if status is COMPLETE
              convertedName: job.outputFilename,
              downloadId: job.downloadId || job.jobId,
              convertedTimestamp: job.createdAt || job.timestamp,
              outputFileSize: job.outputFileSize,
              inputFileSize: job.inputFileSize,
              actualDuration: job.actualDuration,
            }))

            setPendingUploads(monitoringUploads)

            // Start monitoring active jobs - check status first to see if they completed while offline
            for (const upload of monitoringUploads) {
              if (upload.jobId) {
                try {
                  // Check current status first
                  const statusResponse = await fetchWithLicense(`/api/job-status/${upload.jobId}`)
                  const statusData = await statusResponse.json()

                  if (statusData.status === "COMPLETE") {
                    // Job completed while offline - move to converted files
                    saveJobToStorage(upload.jobId, upload.name, upload.size, statusData.status, {
                      inputFilename: statusData.input_filename,
                      inputFileSize: statusData.input_file_size,
                      outputFilename: statusData.filename,
                      outputFileSize: statusData.output_file_size,
                      downloadId: upload.jobId,
                      actualDuration: statusData.actual_duration,
                      deviceProfile: statusData.device_profile,
                      isConverted: true, // Mark as converted
                      convertedName: statusData.filename,
                      convertedTimestamp: Date.now(),
                      outputFileSize: statusData.output_file_size,
                      inputFileSize: statusData.input_file_size,
                    })

                    setConvertedFiles((prev) => [
                      {
                        id: upload.jobId,
                        originalName: statusData.input_filename || upload.name,
                        convertedName: statusData.filename || upload.name,
                        downloadId: upload.jobId,
                        timestamp: Date.now(),
                        device: statusData.deviceProfile || "Unknown device",
                        size: statusData.output_file_size,
                        inputFileSize: statusData.input_file_size,
                        actualDuration: statusData.actual_duration,
                      },
                      ...prev,
                    ])

                    setPendingUploads((prev) => prev.filter((f) => f.jobId !== upload.jobId))
                  } else if (statusData.status === "CANCELLED") {
                    // Job was cancelled - silently remove without error
                    removeJobFromStorage(upload.jobId)
                    setPendingUploads((prev) => prev.filter((f) => f.jobId !== upload.jobId))
                  } else if (statusData.status === "ERRORED") {
                    // Job failed while offline - update status
                    saveJobToStorage(upload.jobId, upload.name, upload.size, statusData.status)
                    setPendingUploads((prev) =>
                      prev.map((f) =>
                        f.jobId === upload.jobId
                          ? { ...f, status: statusData.status, error: "Try a different file" }
                          : f,
                      ),
                    )
                  } else {
                    // Job still active - start monitoring
                    startJobMonitoring(upload.jobId, upload.name)
                  }
                } catch (error) {
                  logError(`Failed to check status for job ${upload.jobId}:`, error)
                  // If status check fails, still start monitoring
                  startJobMonitoring(upload.jobId, upload.name)
                }
              }
            }
          }

          // Update localStorage with filtered jobs
          if (recentJobs.length !== jobs.length) {
            localStorage.setItem("monitored_jobs", JSON.stringify(recentJobs))
          }
        }
      } catch (error) {
        logError("Failed to load persisted jobs:", error)
      }
    }

    // Session initialization now happens on first user interaction (see page.tsx)
    // This prevents bot sessions from being created
    const initialize = async () => {
      await loadPersistedJobs()
      // Wait a short moment for first session update to arrive
      // The WebSocket hook will connect immediately on mount
      setTimeout(() => {
        setIsInitializing(false)
        log("Initialization complete, showing UI")
      }, 500) // 500ms buffer to let first session update arrive
    }

    initialize()
  }, []) // Run only once on mount

  // Sync WebSocket session updates with pendingUploads
  useEffect(() => {
    if (!queueStatus || !queueStatus.jobs) return

    // Log all job statuses from this WebSocket update
    if (queueStatus.jobs.length > 0) {
      log(`[WEBSOCKET] Received ${queueStatus.jobs.length} job(s):`)
      queueStatus.jobs.forEach((job: QueueJob) => {
        log(`  - Job ${job.job_id}: ${job.status} | ${job.filename}`, {
          dismissed_at: job.dismissed_at || null,
          completed_at: job.completed_at || null,
        })
      })
    } else {
      log(`[WEBSOCKET] Received empty queue - all jobs dismissed or completed`)
    }

    // Process all jobs from WebSocket session update
    queueStatus.jobs.forEach((job: QueueJob) => {
      setPendingUploads((prev) => {
        const existingFile = prev.find((f) => f.jobId === job.job_id)

        if (!existingFile) {
          // Skip jobs recently dismissed by the user (avoid re-adding)
          const ts = recentlyDismissedRef.current.get(job.job_id)
          if (ts && Date.now() - ts < 60_000) {
            return prev
          }
          // If user is dismissing this job, ignore it in incoming updates
          if (dismissingJobs.has(job.job_id)) {
            return prev
          }
          // Skip jobs being cancelled - they're in the process of being removed
          if (cancellingJobs.has(job.job_id)) {
            return prev
          }

          // Skip cancelled jobs - they've been removed by user action
          if (job.status === "CANCELLED") {
            return prev
          }

          // Skip uploading jobs - they're from interrupted uploads in previous sessions
          if (job.status === "UPLOADING") {
            return prev
          }

          // Job from WebSocket not in our list - add it with placeholder File
          // This handles jobs that completed while user was away or on different device
          log(`[STATUS CHANGE] New job discovered: ${job.job_id} (${job.status})`, {
            job_id: job.job_id,
            filename: job.filename,
            status: job.status,
            device_profile: job.device_profile,
            source: "websocket",
            dismissed_at: job.dismissed_at || null,
            completed_at: job.completed_at || null,
          })

          const newUpload: PendingUpload = {
            name: job.filename,
            size: job.file_size,
            file: new File([], job.filename), // Placeholder file for monitoring
            jobId: job.job_id,
            status: job.status,
            isMonitoring: true,
            deviceProfile: job.device_profile,
            processing_progress: job.processing_progress,
            upload_progress: job.upload_progress,
            worker_download_speed_mbps: job.worker_download_speed_mbps,
          }

          // If job is already complete, mark it as converted
          if (job.status === "COMPLETE") {
            newUpload.isConverted = true
            newUpload.convertedName = job.output_filename || job.filename // Use output filename if available
            newUpload.downloadId = job.job_id
            newUpload.convertedTimestamp = job.completed_at ? new Date(job.completed_at).getTime() : Date.now()

            // Move to converted files (only if not dismissed)
            setConvertedFiles((prevConverted) => {
              const alreadyConverted = prevConverted.some((cf) => cf.downloadId === job.job_id)
              if (alreadyConverted) return prevConverted

              return [
                {
                  id: job.job_id,
                  originalName: job.filename,
                  convertedName: job.filename,
                  downloadId: job.job_id,
                  timestamp: Date.now(),
                  device: job.device_profile || "Unknown",
                  size: job.file_size,
                },
                ...prevConverted,
              ]
            })

            // Only show toast if just completed (within last 10s) and not yet shown
            if (!completionToastsShown.current.has(job.job_id)) {
              const completedMs = job.completed_at ? new Date(job.completed_at).getTime() : Date.now()
              if (Date.now() - completedMs <= 10_000) {
                completionToastsShown.current.add(job.job_id)
                toast.success(`Conversion completed for ${job.filename}`)
              }
            }

            // Also show a completed card in the queue UI
            return [...prev, newUpload]
          }

          return [...prev, newUpload]
        }

        // Update file with latest status from WebSocket update
        return prev
          .map((f) => {
            if (f.jobId !== job.job_id) return f

            // If job was cancelled, remove it from pending uploads
            if (job.status === "CANCELLED") {
              log(`[WEBSOCKET] Job ${job.job_id} was cancelled, removing from UI`)
              return null // Will be filtered out below
            }

            // Log status changes
            if (f.status !== job.status) {
              log(`[STATUS CHANGE] Job ${job.job_id}: ${f.status || "NEW"} → ${job.status}`, {
                job_id: job.job_id,
                filename: job.filename,
                old_status: f.status || "NEW",
                new_status: job.status,
                device_profile: job.device_profile,
                dismissed_at: job.dismissed_at || null,
                completed_at: job.completed_at || null,
              })
            }

            const updated = {
              ...f,
              status: job.status,
              processing_progress: job.processing_progress,
              upload_progress: job.upload_progress,
              worker_download_speed_mbps: job.worker_download_speed_mbps,
              // Set queuedAt timestamp when job first enters QUEUED status
              queuedAt: job.status === "QUEUED" && f.status !== "QUEUED" ? Date.now() : f.queuedAt,
            }

            // Handle completion
            if (job.status === "COMPLETE") {
              // Job completed - update with completion data
              updated.isConverted = true
              updated.convertedName = job.output_filename || job.filename // Use output filename if available
              updated.downloadId = job.job_id
              updated.convertedTimestamp = job.completed_at ? new Date(job.completed_at).getTime() : Date.now()

              // Move to converted files if not already there
              setConvertedFiles((prevConverted) => {
                const alreadyConverted = prevConverted.some((cf) => cf.downloadId === job.job_id)
                if (alreadyConverted) return prevConverted

                return [
                  {
                    id: job.job_id,
                    originalName: job.filename,
                    convertedName: job.filename,
                    downloadId: job.job_id,
                    timestamp: Date.now(),
                    device: job.device_profile || "Unknown",
                    size: job.file_size,
                  },
                  ...prevConverted,
                ]
              })

              // Only show toast if just completed (within last 10s) and not yet shown
              if (!completionToastsShown.current.has(job.job_id)) {
                const completedMs = job.completed_at ? new Date(job.completed_at).getTime() : Date.now()
                if (Date.now() - completedMs <= 10_000) {
                  completionToastsShown.current.add(job.job_id)
                  toast.success(`Conversion completed for ${job.filename}`)
                }
              }
            }

            return updated
          })
          .filter((f): f is PendingUpload => f !== null) // Remove cancelled jobs
      })
    })

    // Remove jobs that are no longer present in the WebSocket update
    // This runs ALWAYS (even when queue is empty) to clean up dismissed/cancelled jobs
    setPendingUploads((prev) => {
      const wsJobIds = new Set(queueStatus.jobs.map((job) => job.job_id))

      return prev.filter((file) => {
        // Keep files without jobId (not yet uploaded)
        if (!file.jobId) return true

        // Keep files that are in the latest WebSocket update
        if (wsJobIds.has(file.jobId)) return true

        // Keep files being cancelled (they'll be removed once cancellation completes)
        if (cancellingJobs.has(file.jobId)) return true

        // Keep files being dismissed (they'll be removed once dismissal completes)
        if (dismissingJobs.has(file.jobId)) return true

        // Remove all other jobs that are missing from this WebSocket update
        // This handles dismissed/cancelled jobs filtered out by backend
        // Completed files are already in convertedFiles, so they can be safely removed from pendingUploads
        log(`[WEBSOCKET] Removing job ${file.jobId} (${file.name}) - no longer in session update`)
        return false
      })
    })
  }, [queueStatus, cancellingJobs, dismissingJobs])

  const saveJobToStorage = (jobId: string, name: string, size: number, status: string, additionalData?: any) => {
    try {
      // Don't persist uploading jobs since they're ephemeral and can't be resumed
      if (status === "UPLOADING") {
        return
      }

      const stored = localStorage.getItem("monitored_jobs")
      const jobs = stored ? JSON.parse(stored) : []

      // Check if job already exists
      const existingIndex = jobs.findIndex((j: any) => j.jobId === jobId)
      const jobData = {
        jobId,
        name,
        size,
        status,
        timestamp: Date.now(),
        createdAt: Date.now(), // Keep original creation time
        ...additionalData,
      }

      if (existingIndex >= 0) {
        // Preserve original creation time when updating
        jobData.createdAt = jobs[existingIndex].createdAt || Date.now()
        jobs[existingIndex] = jobData
      } else {
        jobs.push(jobData)
      }

      localStorage.setItem("monitored_jobs", JSON.stringify(jobs))
    } catch (error) {
      logError("Failed to save job to storage:", error)
    }
  }

  const removeJobFromStorage = (jobId: string, force = false) => {
    try {
      const stored = localStorage.getItem("monitored_jobs")
      if (stored) {
        const jobs = JSON.parse(stored)

        if (force) {
          // Force removal (when user dismisses)
          const filtered = jobs.filter((j: any) => j.jobId !== jobId)
          localStorage.setItem("monitored_jobs", JSON.stringify(filtered))
        } else {
          // Don't remove completed jobs automatically - keep them for display
          // Only remove jobs that are truly orphaned or user-dismissed
          // CANCELLED jobs should be removed silently
          const filtered = jobs.filter(
            (j: any) => j.jobId !== jobId || j.status === "COMPLETE" || j.status === "ERRORED",
          )
          localStorage.setItem("monitored_jobs", JSON.stringify(filtered))
        }
      }
    } catch (error) {
      logError("Failed to remove job from storage:", error)
    }
  }

  // Redis/DB handle dismissed filtering; no local cache required

  const handleDismissJob = async (file: PendingUpload) => {
    if (file.jobId) {
      // Immediately remove job from UI (don't wait for backend)
      setPendingUploads((prev) => prev.filter((f) => f.jobId !== file.jobId))

      // Remove from localStorage
      removeJobFromStorage(file.jobId, true)

      // Mark job as being dismissed (show spinner - but job already removed from list)
      setDismissingJobs((prev) => new Set(prev).add(file.jobId!))
      // Remember dismissal to avoid re-adding from WebSocket for a short time
      recentlyDismissedRef.current.set(file.jobId!, Date.now())

      // Call backend to set dismissed_at timestamp (for all job statuses)
      try {
        const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8060"
        const sessionKey = await ensureSessionKey()

        log(`Dismissing job ${file.jobId}`, { filename: file.name, status: file.status })

        const response = await fetch(`${API_BASE_URL}/jobs/${file.jobId}/dismiss`, {
          method: "POST",
          headers: {
            "X-Session-Key": sessionKey,
            "Content-Type": "application/json",
          },
        })

        if (response.ok) {
          log(`Job ${file.jobId} dismissed successfully - session update will reflect dismissal`)
          toast.success(`Dismissed: ${file.name}`)
        } else if (response.status === 401) {
          // Session expired - clear it and reload page
          console.warn("[MangaConverter] 401 on cancel - clearing session")
          localStorage.removeItem("mangaconverter_session_key")
          toast.error("Session expired", {
            description: "Please refresh the page to continue.",
          })
          setTimeout(() => window.location.reload(), 2000)
        } else {
          logError(`Failed to dismiss job ${file.jobId}:`, await response.text())
          toast.error(`Failed to dismiss: ${file.name}`)
        }
      } catch (error) {
        logError(`Error dismissing job ${file.jobId}:`, error)
        toast.error(`Error dismissing: ${file.name}`)
      } finally {
        // Remove from dismissing state
        setDismissingJobs((prev) => {
          const newSet = new Set(prev)
          newSet.delete(file.jobId!)
          return newSet
        })
      }
    }
    // Job already removed from UI immediately (don't wait for backend/session)
  }

  // Periodically clean up recentlyDismissed entries older than 2 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now()
      const map = recentlyDismissedRef.current
      for (const [jobId, ts] of map.entries()) {
        if (now - ts > 120_000) {
          map.delete(jobId)
        }
      }
    }, 30_000)
    return () => clearInterval(interval)
  }, [])

  // WebSocket-based job monitoring
  const startJobMonitoring = (jobId: string, filename: string) => {
    log(`[WEBSOCKET] Monitoring job ${jobId} via session updates`)

    // No-op: Polling handles monitoring automatically via useEffect above
    // Just save to storage so job persists across refreshes
    saveJobToStorage(jobId, filename, 0, "QUEUED")
  }

  // Using WebSocket session updates (legacy polling removed)

  const handleFileUpload = (files: File[]) => {
    if (isConverting) {
      toast("Conversion in progress", {
        description: "Please wait for current files to complete processing.",
      })
      return
    }

    if (files.length > MAX_FILES) {
      toast.warning(`Maximum ${MAX_FILES} files allowed`, {
        description: `Only the first ${MAX_FILES} files will be processed.`,
      })
      files = files.slice(0, MAX_FILES)
    }

    const newUploads = files.map((file) => ({
      name: file.name,
      size: file.size,
      file,
      deviceProfile: selectedProfile !== "Placeholder" ? selectedProfile : undefined,
      advancedOptions: { ...advancedOptions },
    }))

    setPendingUploads((prev) => [...prev, ...newUploads])

    // Auto-open configuration panel only if files are unconfigured (no device selected yet)
    if (selectedProfile === "Placeholder") {
      setSidebarOpen(true)
    }
  }

  const getMinimalOptions = () => {
    if (isManga) {
      return {
        manga_style: advancedOptions.mangaStyle,
      }
    }
    return {}
  }

  const getFileSettings = () => {
    return {
      deviceProfile: selectedProfile,
      advancedOptions: advancedOptions,
    }
  }

  const areSettingsValid = () => {
    // Check if device is selected
    if (selectedProfile === "Placeholder") {
      return false
    }

    // If device is OTHER, validate required fields
    if (selectedProfile === "OTHER") {
      if (
        !advancedOptions.customWidth ||
        !advancedOptions.customHeight ||
        !advancedOptions.outputFormat ||
        advancedOptions.outputFormat === "Auto" ||
        advancedOptions.customWidth <= 0 ||
        advancedOptions.customHeight <= 0
      ) {
        return false
      }
    }

    return true
  }

  const hasActiveJobs = () => {
    // Check if any jobs are currently uploading, queued, or processing
    return pendingUploads.some(
      (file) => file.status === "UPLOADING" || file.status === "QUEUED" || file.status === "PROCESSING",
    )
  }

  const handleApplySettings = () => {
    if (!areSettingsValid()) {
      if (selectedProfile === "Placeholder") {
        toast.warning("No device selected", {
          description: "Please select your E-Reader device.",
        })
      } else if (selectedProfile === "OTHER") {
        toast.warning("Missing required settings", {
          description:
            "Custom width, height, and output format (not 'Auto') are required when using 'Other' device profile.",
        })
      }
      return
    }

    // Settings are automatically applied to all files in queue (global config)
    toast.success("Settings saved")

    // Close sidebar
    setSidebarOpen(false)
  }

  const handleConvert = async () => {
    log(`[${new Date().toISOString()}] Start Conversion button pressed`)
    if (pendingUploads.length === 0) {
      toast.warning("No files to convert", {
        description: "Please upload at least one file to start conversion.",
      })
      return
    }

    const filesToConvert = pendingUploads.filter((file) => !file.isConverted)

    if (filesToConvert.length === 0) {
      toast.info("All files already converted", {
        description: "These files have already been converted. Add new files to convert more.",
      })
      return
    }

    if (selectedProfile === "Placeholder") {
      setNeedsConfiguration(true)
      toast.warning("No device selected", {
        description: "Please select your E-Reader device before starting the conversion.",
      })
      return
    }

    // Validate advanced options for OTHER profile
    if (selectedProfile === "OTHER") {
      if (
        !advancedOptions.customWidth ||
        !advancedOptions.customHeight ||
        !advancedOptions.outputFormat ||
        advancedOptions.outputFormat === "Auto"
      ) {
        toast.warning("Missing required settings", {
          description:
            "Custom width, height, and output format (not 'Auto') are required when using 'Other' device profile. Please configure them in Advanced Options.",
        })
        return
      }

      if (advancedOptions.customWidth <= 0 || advancedOptions.customHeight <= 0) {
        toast.warning("Invalid dimensions", {
          description: "Custom width and height must be greater than 0.",
        })
        return
      }
    }

    // Session key will be created on first user interaction or when ensureSessionKey() is called during upload

    // Prevent duplicate conversion requests
    if (isConverting) {
      logWarn("Conversion already in progress, ignoring duplicate request", {
        action: "duplicate_conversion_prevented",
        pendingFiles: pendingUploads.length,
      })
      return
    }
    setIsConverting(true)

    // Reset all progress states at the start of conversion
    setUploadProgress(0)
    setUploadProgressConfirmed(0)
    setConversionProgress(0)
    setIsUploaded(false)
    setEta(undefined)
    setRemainingTime(undefined)
    setCurrentStatus(undefined)

    const filesToProcess = filesToConvert
    let hasErrors = false

    // Process all files in parallel instead of sequentially
    const uploadPromises = filesToProcess.map(async (currentFile, i) => {
      // Use a local variable for jobId within this loop iteration
      let jobId: string = currentFile.jobId || "" // Initialize jobId for the current file

      // Skip if the file is already being monitored (e.g., reloaded page)
      if (currentFile.isMonitoring && currentFile.jobId) {
        log("Skipping already monitored job", currentFile.jobId, { filename: currentFile.name })
        return // Return early in map, equivalent to continue in for loop
      }

      const toastId = toast.loading(`Converting ${currentFile.name}... (${i + 1}/${filesToProcess.length})`, {
        duration: Number.POSITIVE_INFINITY,
      })

      try {
        const sessionKey = await ensureSessionKey()

        // Reset progress states for this file
        setUploadProgress(0)
        setUploadProgressConfirmed(0)
        setIsUploaded(false)
        setConversionProgress(0)
        setEta(undefined)
        setRemainingTime(undefined)
        setCurrentStatus(undefined) // Will be set by first status poll
        lastLoggedProgressRef.current = -1 // Reset progress logging

        const conversionComplete = false
        const errorMessage = null
        const filename = currentFile.name
        const inputFilename: string | undefined = undefined
        const inputFileSize: number | undefined = undefined
        const outputFileSize: number | undefined = undefined
        const conversionStartTime = null
        const projectedEta = null
        // jobId is now initialized above for the current file
        const isFirstStatusPoll = true
        const localCurrentStatus: string | undefined = undefined // Track status locally in the loop
        const statusData: any = {} // Declare statusData here

        log("=== CONVERSION FLOW START ===", {
          filename: currentFile.name,
          fileSize: currentFile.size,
          device: selectedProfile,
        })

        const fileSettings = getFileSettings()
        const fileDeviceProfile = fileSettings.deviceProfile
        const fileAdvancedOptions = fileSettings.advancedOptions

        // Validate advanced options for OTHER profile
        if (fileDeviceProfile === "OTHER") {
          if (
            !fileAdvancedOptions.customWidth ||
            !fileAdvancedOptions.customHeight ||
            !fileAdvancedOptions.outputFormat ||
            fileAdvancedOptions.outputFormat === "Auto"
          ) {
            toast.warning("Missing required settings", {
              description: `File "${currentFile.name}": Custom width, height, and output format (not 'Auto') are required when using 'Other' device profile.`,
            })
            hasErrors = true
            return // Return early in map, equivalent to continue in for loop
          }

          if (fileAdvancedOptions.customWidth <= 0 || fileAdvancedOptions.customHeight <= 0) {
            toast.warning("Invalid dimensions", {
              description: `File "${currentFile.name}": Custom width and height must be greater than 0.`,
            })
            hasErrors = true
            return // Return early in map, equivalent to continue in for loop
          }
        }

        // Set initial upload state immediately (prevents "ready" flash before upload starts)
        setUploadProgress(1)
        setCurrentStatus("UPLOADING")

        // Start upload and conversion process, WebSocket will stream session updates
        let uploadPromise
        try {
          uploadPromise = uploadFileAndConvert(
            currentFile.file,
            sessionKey,
            fileDeviceProfile, // Use per-file device profile
            convertAdvancedOptionsToBackend(fileAdvancedOptions), // Use per-file advanced options
            // Upload progress callback for real-time UI updates
            (progress, fullProgressData) => {
              setUploadProgress(progress)

              // Calculate confirmed progress (only backend-confirmed parts)
              if (fullProgressData) {
                const confirmedProgress = (fullProgressData.completedParts / fullProgressData.totalParts) * 100
                setUploadProgressConfirmed(confirmedProgress)
              }

              // Log upload progress at 10% intervals (0%, 10%, 20%, ..., 100%)
              const currentPercent = Math.floor(progress)
              const currentTenth = Math.floor(currentPercent / 10) * 10
              if (currentTenth !== lastLoggedProgressRef.current && currentTenth >= 0 && currentTenth <= 100) {
                lastLoggedProgressRef.current = currentTenth
                log(`[UI] Uploading progress: ${currentTenth}%`, {
                  progress_percent: currentTenth,
                  raw_progress: progress.toFixed(2),
                  completed_parts: fullProgressData?.completedParts,
                  total_parts: fullProgressData?.totalParts,
                  uploaded_bytes: fullProgressData?.uploadedBytes,
                  total_bytes: fullProgressData?.totalBytes,
                })
              }

              // Update per-file upload progress for UI display with full data for ETA calculation
              setPendingUploads((prev) =>
                prev.map((f) =>
                  f === currentFile
                    ? {
                        ...f,
                        upload_progress: fullProgressData || {
                          completed_parts: 0,
                          total_parts: 0,
                          uploaded_bytes: 0,
                          total_bytes: currentFile.size,
                          percentage: progress,
                        },
                      }
                    : f,
                ),
              )

              // Mark as uploaded when progress reaches 100%
              if (progress >= 100) {
                setIsUploaded(true)
                log("Upload completed", jobId, { uploadComplete: true })
              }
            },
            // Job ID callback - called immediately when job is created
            (createdJobId) => {
              jobId = createdJobId // Assign to the loop's jobId
              setCurrentStatus("UPLOADING") // Set initial status

              log(`[STATUS CHANGE] Job ${jobId}: → UPLOADING`, {
                job_id: jobId,
                filename: currentFile.name,
                status: "UPLOADING",
                device_profile: fileDeviceProfile,
                file_size: currentFile.size,
                source: "upload_start",
              })

              saveJobToStorage(jobId, currentFile.name, currentFile.size, "UPLOADING")
              setPendingUploads((prev) =>
                prev.map((f) =>
                  f.name === currentFile.name && f.size === currentFile.size && !f.jobId
                    ? {
                        ...f,
                        jobId,
                        status: "UPLOADING",
                        isMonitoring: true,
                        deviceProfile: fileDeviceProfile,
                        advancedOptions: fileAdvancedOptions,
                      }
                    : f,
                ),
              )

              log("Job created - session updates will track progress", jobId, {
                initialStatus: "UPLOADING",
              })
            },
          )
        } catch (uploadInitError) {
          logError("Failed to initialize upload", {
            error: uploadInitError.message,
            filename: currentFile.name,
          })
          throw new Error(`Upload initialization failed: ${uploadInitError.message}`)
        }

        // Wait for job ID to be available
        let waitCount = 0
        log("Waiting for job ID from upload initiation", {
          filename: currentFile.name,
        })

        while (!jobId) {
          // Wait for job ID (no timeout - will wait as long as needed)
          await new Promise((resolve) => setTimeout(resolve, 100))
          waitCount++

          // Log every second while waiting
          if (waitCount % 10 === 0) {
            log(`Still waiting for job ID... (${waitCount / 10}s)`, {
              waitCount,
              filename: currentFile.name,
            })
          }
        }

        log("Job ID received successfully", jobId, {
          waitTime: `${waitCount * 100}ms`,
          filename: currentFile.name,
        })

        log(`[${new Date().toISOString()}] Starting WebSocket monitoring for job ${jobId}`)
        log("Starting WebSocket monitoring", jobId, {
          reason: "Real-time status updates via WebSocket",
        })

        // Start upload process in background
        const uploadCompletePromise = uploadPromise.catch((uploadError) => {
          // Don't log user cancellations as errors
          if (!(uploadError as any).isUserCancellation && !uploadError.message?.includes("cancelled by user")) {
            logError("Upload or start signal failed", jobId, {
              error: uploadError.message,
            })
          }
          throw uploadError
        })

        // WebSocket-based monitoring - hook automatically tracks job status
        // Just wait for upload to complete; session updates handle the rest
        log(`[WEBSOCKET] Job ${jobId} submitted; session updates will track progress`)

        // Wait for upload to complete
        await uploadCompletePromise

        log("Upload complete for job", jobId, { filename: currentFile.name })

        // Polling will automatically update status and handle completion
        // No need to manually update status - WebSocket hook does it all

        // Remove the loading toast without showing an "upload complete" message
        toast.dismiss(toastId)

        log("File uploaded successfully; session updates will track conversion", jobId, {
          filename: currentFile.name,
        })

        // Reset progress states for next file
        setUploadProgress(0)
        setUploadProgressConfirmed(0)
        setConversionProgress(0)
        setIsUploaded(false)
        setEta(undefined)
        setRemainingTime(undefined)
        setCurrentStatus(undefined)
      } catch (error) {
        const actualErrorMessage = error instanceof Error ? error.message : String(error)

        // Check if this was a user cancellation (don't show error toast or log as error)
        if (
          actualErrorMessage.includes("cancelled by user") ||
          actualErrorMessage.includes("Upload cancelled") ||
          actualErrorMessage.includes("Upload aborted") ||
          actualErrorMessage.includes("Job cancelled")
        ) {
          log("[v0] Job cancelled by user, cleaning up...")
          log("Job cancelled by user", jobId, { filename: currentFile.name })

          // Already removed from UI by WebSocket handler, just dismiss toast
          toast.dismiss(toastId)
          return // Exit without setting error state
        }

        // Only log actual errors (not cancellations)
        logError("Conversion error:", error)
        hasErrors = true

        setPendingUploads((prev) =>
          prev.map((f) =>
            f.jobId === jobId // Use the loop's jobId
              ? {
                  ...f,
                  error: "Try a different file",
                }
              : f,
          ),
        )

        toast.error(`Conversion failed: ${currentFile.name}`, {
          id: toastId,
          description: "Try a different file",
          duration: 8000,
        })
      }
    })

    // Wait for all files to complete uploading and converting in parallel
    await Promise.all(uploadPromises)

    log("All files processed", { totalFiles: filesToProcess.length })

    // Reset all progress states when conversion is complete
    setUploadProgress(0)
    setUploadProgressConfirmed(0)
    setConversionProgress(0)
    setIsUploaded(false)
    setEta(undefined)
    setRemainingTime(undefined)
    setCurrentStatus(undefined)
    setIsConverting(false)
  }

  const handleCancelJob = async (file: PendingUpload) => {
    if (!file.jobId) {
      logError("[v0] Cannot cancel: No job ID")
      toast.error("Cannot cancel: No job ID")
      return
    }

    log("[v0] Cancel requested for job:", file.jobId, "file:", file.name)

    // Mark job as being cancelled (show spinner)
    setCancellingJobs((prev) => new Set(prev).add(file.jobId!))

    // Log in background (don't block UI)
    log("Cancel button clicked", file.jobId, {
      filename: file.name,
      file_size: file.file.size,
    })

    // IMMEDIATELY abort active upload if it's in progress
    import("@/lib/uploadFileAndConvert")
      .then(({ abortUpload }) => {
        const uploadAborted = abortUpload(file.jobId)
        if (uploadAborted) {
          log("[v0] Upload XHR aborted immediately for:", file.jobId)
        }
      })
      .catch((error) => {
        // Silently handle expected cancellation errors
        if (error?.message?.includes("Upload cancelled")) {
          log("[v0] Upload cancellation handled gracefully")
        } else {
          logError("[v0] Unexpected error during upload abort:", error)
        }
      })

    // Check if this was the active job BEFORE removing
    const wasActiveJob = pendingUploads.findIndex((f) => f.jobId === file.jobId) === 0 && isConverting

    // Dismiss any active conversion toasts for this job
    toast.dismiss()

    // Reset conversion state if this was the active job
    if (wasActiveJob) {
      setIsConverting(false)
      setUploadProgress(0)
      setUploadProgressConfirmed(0)
      setConversionProgress(0)
      setEta(undefined)
      setRemainingTime(undefined)
      setCurrentStatus(undefined)
    }

    // IMMEDIATELY remove from UI - don't wait for backend
    removeJobFromStorage(file.jobId)

    // Remove from pendingUploads immediately
    setPendingUploads((prev) => prev.filter((f) => f.jobId !== file.jobId))

    // Show immediate feedback
    toast.success(`Cancelled ${file.name}`)

    // Backend cancellation in background (fire and forget)
    // We don't wait for this - user sees immediate cancellation
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 second timeout

      const response = await fetchWithLicense(`/api/jobs/${file.jobId}/cancel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId))

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to cancel job")
      }

      const data = await response.json()

      log("Job cancellation confirmed by backend", file.jobId, {
        filename: file.name,
        new_status: data.status,
      })
    } catch (error) {
      // Log backend errors but don't show to user (job already removed from UI)
      if (error instanceof Error && error.name === "AbortError") {
        logWarn("[v0] Backend cancel timed out (job already removed from UI)", file.jobId)
      } else {
        logError("[v0] Backend cancel failed (job already removed from UI):", error)
      }
    } finally {
      // Remove from cancelling state
      setCancellingJobs((prev) => {
        const newSet = new Set(prev)
        newSet.delete(file.jobId!)
        return newSet
      })
    }
  }

  const handleAdvancedOptionsChange = (newOptions: Partial<AdvancedOptionsType>) => {
    setAdvancedOptions((prev) => ({
      ...prev,
      ...newOptions,
      targetSize: newOptions.webtoon !== undefined ? (newOptions.webtoon ? 100 : 400) : prev.targetSize,
    }))
  }

  const handleReorder = (newOrder: PendingUpload[]) => {
    setPendingUploads(newOrder)
  }

  const clearConvertedFiles = () => {
    // Remove all completed jobs from localStorage
    try {
      const stored = localStorage.getItem("monitored_jobs")
      if (stored) {
        const jobs = JSON.parse(stored)
        const filteredJobs = jobs.filter((job: any) => job.status !== "COMPLETE")
        localStorage.setItem("monitored_jobs", JSON.stringify(filteredJobs))
      }
    } catch (error) {
      logError("Failed to clear completed jobs from localStorage:", error)
    }

    setConvertedFiles([])
  }

  const removeConvertedFile = (file: ConvertedFileInfo) => {
    // Remove specific job from localStorage
    try {
      const stored = localStorage.getItem("monitored_jobs")
      if (stored) {
        const jobs = JSON.parse(stored)
        const filteredJobs = jobs.filter((job: any) => job.jobId !== file.downloadId)
        localStorage.setItem("monitored_jobs", JSON.stringify(filteredJobs))
      }
    } catch (error) {
      logError("Failed to remove job from localStorage:", error)
    }

    // Backend/session updates handle dismissal filtering

    // Remove from React state
    setConvertedFiles((prev) => prev.filter((f) => f.id !== file.id))
  }

  const isReadyToConvert = () => {
    const hasFilesToConvert = pendingUploads.some((file) => !file.isConverted)
    return hasFilesToConvert && selectedProfile !== "Placeholder" && !isConverting
  }

  const getValidFileCount = () => {
    return pendingUploads.filter((file) => !file.error && !file.isConverted).length
  }

  const handleConvertButtonClick = () => {
    // Prevent any action if already converting
    if (isConverting) {
      return
    }

    if (isReadyToConvert()) {
      handleConvert()
    } else {
      if (selectedProfile === "Placeholder") {
        handleGlobalConfigPulsate()
      }

      if (pendingUploads.length === 0) {
        toast.warning("No files to convert", {
          description: "Please upload at least one file to start conversion.",
        })
      } else if (selectedProfile === "Placeholder") {
        toast.warning("No device selected", {
          description: "Please select your E-Reader device before starting the conversion.",
        })
      } else if (getValidFileCount() === 0) {
        toast.info("All files converted", {
          description: "All uploaded files have already been converted.",
        })
      }
    }
  }

  const getProgress = () => {
    const hasFiles = pendingUploads.length > 0
    const hasDevice = selectedProfile !== "Placeholder"
    if (!hasFiles) return 0
    if (hasFiles && !hasDevice) return 33
    if (hasFiles && hasDevice) return 66
    return 100
  }

  const [isButtonSticky, setIsButtonSticky] = useState(false)
  const buttonContainerRef = useRef<HTMLDivElement>(null)

  // Debug function to reset converting state

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        // When the button container is not intersecting (out of view), make it sticky
        setIsButtonSticky(!entry.isIntersecting)
      },
      {
        threshold: 0,
        rootMargin: "0px 0px -80px 0px", // Account for bottom padding
      },
    )

    if (buttonContainerRef.current) {
      observer.observe(buttonContainerRef.current)
    }

    return () => {
      if (buttonContainerRef.current) {
        observer.unobserve(buttonContainerRef.current)
      }
    }
  }, [])

  const queueRef = useRef<PendingUpload[]>([])

  useEffect(() => {
    queueRef.current = [...pendingUploads]
  }, [pendingUploads])

  useEffect(() => {
    if (sidebarOpen || selectedProfile !== "Placeholder") {
      setNeedsConfiguration(false)
      setGlobalConfigPulsate(false)
    }
  }, [sidebarOpen, selectedProfile])

  return (
    <>
      <div className="flex flex-col gap-6 max-w-6xl mx-auto pb-24">
        <section className="text-center space-y-2">
          <h1 className={`text-4xl font-bold tracking-tight ${isComic ? "font-bungee" : "font-kosugi-maru"}`}>
            {isComic ? "COMIC CONVERTER" : "マンガコンバーター"}
          </h1>
          <p className="text-lg text-muted-foreground">
            Convert your {isComic ? "comic" : "manga"} files to e-reader formats
          </p>
        </section>

        {convertedFiles.length > 0 && <div className="space-y-3">{/* Removed TTL availability callout */}</div>}

        {/* Signup CTA for anonymous users */}
        {isUserLoaded && !user && (
          <Alert>
            <Download className="h-4 w-4" />
            <AlertDescription>
              <div className="flex items-center justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <span className="font-medium">Your files will be available for 24 hours</span>
                  <span className="text-sm text-muted-foreground">
                    Sign up to access your converted files across all devices and keep them longer!
                  </span>
                </div>
                {/* REMOVED LOGIN BUTTON */}
                <SignUpButton mode="modal">
                  <Button size="sm">Sign Up</Button>
                </SignUpButton>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* My Downloads - Collapsible for logged-in users */}
        {isUserLoaded && user && (
          <Collapsible open={downloadsOpen} onOpenChange={setDownloadsOpen}>
            <CollapsibleTrigger asChild>
              <Card className="cursor-pointer hover:border-primary/50 transition-colors">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Download className="h-5 w-5" />
                      <div>
                        <CardTitle>My Downloads</CardTitle>
                        <CardDescription className="mt-1">
                          {downloadsOpen
                            ? "Click to collapse"
                            : "All your converted files across devices • Files available for 24 hours"}
                        </CardDescription>
                      </div>
                    </div>
                    {downloadsOpen ? (
                      <ChevronUp className="h-5 w-5 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronDown className="h-5 w-5 text-muted-foreground shrink-0" />
                    )}
                  </div>
                </CardHeader>
              </Card>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3">
              <MyDownloads limit={50} />
            </CollapsibleContent>
          </Collapsible>
        )}

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Files</CardTitle>
                <CardDescription>
                  {pendingUploads.length > 0
                    ? `${pendingUploads.length} file${pendingUploads.length !== 1 ? "s" : ""} ${getValidFileCount() > 0 ? `(${getValidFileCount()} ready to convert)` : "(all converted)"}`
                    : "Upload your comic or manga files to get started"}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {isInitializing ? (
              <div className="flex items-center justify-center py-12">
                <LoaderIcon className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : pendingUploads.length === 0 ? (
              <FileUploader
                onFilesSelected={handleFileUpload}
                disabled={isConverting}
                acceptedTypes={ALL_SUPPORTED_EXTENSIONS}
                maxFiles={MAX_FILES}
                contentType={contentType}
              />
            ) : (
              <>
                <ConversionQueue
                  pendingUploads={pendingUploads}
                  isConverting={isConverting}
                  onConvert={handleConvert}
                  onCancelJob={handleCancelJob}
                  selectedProfile={selectedProfile}
                  globalAdvancedOptions={advancedOptions}
                  onReorder={handleReorder}
                  showAsUploadedFiles={false}
                  onRemoveFile={(file) => setPendingUploads((prev) => prev.filter((f) => f !== file))}
                  onDismissJob={handleDismissJob}
                  dismissingJobs={dismissingJobs}
                  cancellingJobs={cancellingJobs}
                  uploadProgress={uploadProgress}
                  uploadProgressConfirmed={uploadProgressConfirmed}
                  conversionProgress={conversionProgress}
                  isUploaded={isUploaded}
                  eta={eta}
                  remainingTime={remainingTime}
                  currentStatus={currentStatus}
                  deviceProfiles={DEVICE_PROFILES}
                  onAddMoreFiles={handleAddMoreFiles}
                  onNeedsConfiguration={handleNeedsConfiguration}
                  onOpenSidebar={() => setSidebarOpen(true)}
                  onStartConversion={handleConvertButtonClick}
                  isReadyToConvert={isReadyToConvert}
                />
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileInputChange}
                  accept={ALL_SUPPORTED_EXTENSIONS.join(",")}
                  multiple
                  className="hidden"
                  disabled={isConverting}
                />
              </>
            )}
          </CardContent>
        </Card>

        <Footer />
      </div>

      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent className="fixed z-50 gap-4 bg-background p-6 pb-0 shadow-lg transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:duration-500 inset-y-0 right-0 h-full border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right w-full sm:max-w-lg overflow-y-auto [&>button]:hidden">
          <Button
            variant="outline"
            size="icon"
            className="absolute -left-12 top-6 h-12 w-12 rounded-l-md rounded-r-none border-r-0 shadow-lg bg-background hover:bg-accent hover:shadow-xl transition-all duration-200 border-2"
            onClick={() => setSidebarOpen(false)}
            aria-label="Collapse configuration panel"
          >
            <ChevronsRight className="h-6 w-6" />
          </Button>

          <SheetHeader>
            <SheetTitle>Configure Options</SheetTitle>
            <SheetDescription>Set options for all files in queue</SheetDescription>
          </SheetHeader>

          <div className="space-y-6 mt-6 pb-32">
            {/* Device Selector */}
            <div className="space-y-2">
              <Label className="text-base font-semibold">E-Reader Device</Label>
              <DeviceSelector
                selectedProfile={selectedProfile}
                onProfileChange={setSelectedProfile}
                deviceProfiles={DEVICE_PROFILES}
              />
            </div>

            {/* Advanced Options */}
            <div className="space-y-2">
              <Label className="text-base font-semibold">Advanced Options</Label>
              <AdvancedOptions
                options={advancedOptions}
                onChange={handleAdvancedOptionsChange}
                deviceProfile={selectedProfile}
                contentType={contentType}
              />
            </div>
          </div>

          <div className="sticky bottom-0 left-0 right-0 p-6 bg-background/95 backdrop-blur-sm border-t shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
            <Button
              onClick={handleApplySettings}
              disabled={!areSettingsValid()}
              size="lg"
              className={`w-full ${
                isComic ? "bg-yellow-500 hover:bg-yellow-600 text-black" : "bg-red-600 hover:bg-red-700 text-white"
              }`}
            >
              Apply Settings
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
