"use client"

import type React from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Loader2,
  FileText,
  AlertTriangle,
  X,
  Download,
  XCircle,
  Settings,
  Upload,
  BookOpen,
  Cog,
  CheckCircle2,
  AlertCircle,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { motion } from "framer-motion"
import { useState, useEffect, useRef } from "react"
import type { PendingUpload, AdvancedOptionsType } from "./manga-converter"
import { fetchWithLicense } from "@/lib/utils"
import { log, logError } from "@/lib/logger"
import { toast } from "sonner"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

const QUEUED_SECONDS = Number.parseInt(process.env.NEXT_PUBLIC_QUEUED_SECONDS || "5", 10)

interface ConversionQueueProps {
  pendingUploads: PendingUpload[]
  isConverting: boolean
  onConvert: () => void
  onCancelJob?: (file: PendingUpload) => void
  selectedProfile: string
  globalAdvancedOptions?: AdvancedOptionsType
  onReorder?: (newOrder: PendingUpload[]) => void
  showAsUploadedFiles?: boolean
  onRemoveFile?: (file: PendingUpload) => void
  onDismissJob?: (file: PendingUpload) => void
  dismissingJobs?: Set<string>
  cancellingJobs?: Set<string>
  uploadProgress?: number
  uploadProgressConfirmed?: number
  conversionProgress?: number
  isUploaded?: boolean
  eta?: number
  remainingTime?: number
  currentStatus?: string
  deviceProfiles?: Record<string, string>
  onAddMoreFiles?: () => void
  onNeedsConfiguration?: () => void
  onOpenSidebar?: () => void
  onStartConversion?: () => void
  isReadyToConvert?: () => boolean
}

export function ConversionQueue({
  pendingUploads,
  isConverting,
  onConvert,
  onCancelJob,
  dismissingJobs = new Set(),
  cancellingJobs = new Set(),
  selectedProfile,
  globalAdvancedOptions,
  onReorder,
  showAsUploadedFiles = false,
  onRemoveFile,
  onDismissJob,
  uploadProgress = 0,
  uploadProgressConfirmed = 0,
  conversionProgress = 0,
  isUploaded = false,
  eta,
  remainingTime,
  currentStatus,
  deviceProfiles = {},
  onAddMoreFiles,
  onNeedsConfiguration,
  onOpenSidebar,
  onStartConversion,
  isReadyToConvert,
}: ConversionQueueProps) {
  const [items, setItems] = useState(pendingUploads)
  const [downloadingFiles, setDownloadingFiles] = useState<Record<string, boolean>>({})
  // PROCESSING ETA comes from backend; no local countdown
  const [uploadEta, setUploadEta] = useState<number | undefined>(undefined)
  const [displayedUploadRemainingSec, setDisplayedUploadRemainingSec] = useState<number | null>(null)
  const [lastUploadProgress, setLastUploadProgress] = useState<number>(0)
  const [lastUploadTime, setLastUploadTime] = useState<number>(Date.now())
  const [uploadSpeed, setUploadSpeed] = useState<number>(0) // bytes per second
  const [uploadStartTime, setUploadStartTime] = useState<number>(0)
  const [lastEtaUpdateTime, setLastEtaUpdateTime] = useState<number>(0)
  const [speedSampleCount, setSpeedSampleCount] = useState<number>(0)
  const uploadJobIdRef = useRef<string>("unknown")
  const lastLoggedUploadRemainingRef = useRef<number | null>(null)

  // Client-side PROCESSING ticker (based on backend-provided ETA at start)
  const [processingStartTime, setProcessingStartTime] = useState<number | null>(null)
  const [processingEtaSec, setProcessingEtaSec] = useState<number | null>(null)
  const [clientProcessingProgress, setClientProcessingProgress] = useState<number>(0)
  const [displayedRemainingSec, setDisplayedRemainingSec] = useState<number | null>(null)
  // Logging refs for 10% progress steps and ETA second decrements
  const lastLoggedProcessingTenthRef = useRef<number | null>(null)
  const lastLoggedRemainingSecRef = useRef<number | null>(null)
  const processingJobIdRef = useRef<string>("unknown")
  // QUEUED progressive ticker state
  const [queuedStartTime, setQueuedStartTime] = useState<number | null>(null)
  const [queuedDurationSec, setQueuedDurationSec] = useState<number>(QUEUED_SECONDS)
  const [clientQueuedProgress, setClientQueuedProgress] = useState<number>(0)
  const [displayedQueuedRemainingSec, setDisplayedQueuedRemainingSec] = useState<number | null>(null)
  const queuedJobIdRef = useRef<string>("unknown")
  const lastLoggedQueuedTenthRef = useRef<number | null>(null)
  const lastLoggedQueuedRemainingRef = useRef<number | null>(null)

  // Refs to track last logged progress percentage for each job stage (to log only at 10% intervals)
  // No queued/progress logs: handled by backend

  useEffect(() => {
    if (JSON.stringify(items) !== JSON.stringify(pendingUploads)) {
      setItems(pendingUploads)
    }
  }, [pendingUploads])

  // No QUEUED ETA: we intentionally do not compute or display ETA while QUEUED

  // No local remaining time state; rely on backend

  // No QUEUED countdown: progress remains at 0% until PROCESSING

  // No PROCESSING countdown; backend provides remaining_seconds

  // Initialize client-side PROCESSING tickers when backend ETA is available
  useEffect(() => {
    const processingFile = pendingUploads.find((f) => f.status === "PROCESSING" && f.processing_progress)
    const pp = processingFile?.processing_progress
    if (pp?.projected_eta && pp.projected_eta > 0) {
      const baseElapsed = pp.elapsed_seconds ?? 0
      const startMs = Date.now() - baseElapsed * 1000
      setProcessingStartTime(startMs)
      setProcessingEtaSec(pp.projected_eta)
      // Start from backend-progress if provided
      const initialProgress =
        pp.progress_percent != null
          ? Math.floor(Math.max(0, Math.min(99, pp.progress_percent)))
          : Math.floor(Math.max(0, Math.min(99, (baseElapsed / pp.projected_eta) * 100)))
      setClientProcessingProgress(initialProgress)
      const initialRemaining =
        pp.remaining_seconds != null ? pp.remaining_seconds : Math.max(0, Math.ceil(pp.projected_eta - baseElapsed))
      setDisplayedRemainingSec(initialRemaining)
      // Track job id for logging
      const jId = (processingFile as any)?.jobId || (processingFile as any)?.job_id
      if (jId) {
        processingJobIdRef.current = jId
      } else {
        processingJobIdRef.current = "unknown"
      }
      // Reset logging refs when (re)initializing ticker
      lastLoggedProcessingTenthRef.current = null
      lastLoggedRemainingSecRef.current = null
    } else {
      setProcessingStartTime(null)
      setProcessingEtaSec(null)
      setClientProcessingProgress(0)
      setDisplayedRemainingSec(null)
      processingJobIdRef.current = "unknown"
      lastLoggedProcessingTenthRef.current = null
      lastLoggedRemainingSecRef.current = null
    }
  }, [pendingUploads])

  // Initialize QUEUED ticker with static duration from env
  useEffect(() => {
    const queuedFile = pendingUploads.find((f) => f.status === "QUEUED")
    if (queuedFile) {
      const start = queuedFile.queuedAt || Date.now()
      setQueuedStartTime(start)
      setQueuedDurationSec(QUEUED_SECONDS)
      const elapsed = Math.max(0, (Date.now() - start) / 1000)
      const initialProgress = Math.floor(Math.max(0, Math.min(99, (elapsed / QUEUED_SECONDS) * 100)))
      setClientQueuedProgress(initialProgress)
      const initialRemaining = Math.max(0, Math.ceil(QUEUED_SECONDS - elapsed))
      setDisplayedQueuedRemainingSec(initialRemaining)
      const jId = (queuedFile as any)?.jobId || (queuedFile as any)?.job_id
      queuedJobIdRef.current = jId || "unknown"
      lastLoggedQueuedTenthRef.current = null
      lastLoggedQueuedRemainingRef.current = null
    } else {
      setQueuedStartTime(null)
      setClientQueuedProgress(0)
      setDisplayedQueuedRemainingSec(null)
      queuedJobIdRef.current = "unknown"
      lastLoggedQueuedTenthRef.current = null
      lastLoggedQueuedRemainingRef.current = null
    }
  }, [pendingUploads])

  // QUEUED progress ticker: 1% every (duration/100) seconds
  useEffect(() => {
    if (queuedStartTime && queuedDurationSec > 0) {
      const tickMs = (queuedDurationSec / 100) * 1000
      const interval = setInterval(() => {
        const elapsed = (Date.now() - queuedStartTime) / 1000
        const progress = Math.floor((elapsed / queuedDurationSec) * 100)
        setClientQueuedProgress((prev) => {
          const value = Math.max(prev, Math.min(99, progress))
          const currentTenth = Math.floor(value / 10) * 10
          const lastTenth = lastLoggedQueuedTenthRef.current ?? -1
          if (value > 0 && currentTenth !== lastTenth && currentTenth >= 10 && currentTenth <= 90) {
            lastLoggedQueuedTenthRef.current = currentTenth
            const jobId = queuedJobIdRef.current
            const remaining = displayedQueuedRemainingSec ?? Math.max(0, Math.ceil(queuedDurationSec - elapsed))
            log(`[UI] Reading File progress (ticker): ${currentTenth}%`, {
              progress_percent: currentTenth,
              elapsed_seconds: Math.floor(elapsed),
              remaining_seconds: Math.floor(remaining),
              total_seconds: queuedDurationSec,
              job_id: jobId,
            })
          }
          return value
        })
      }, tickMs)
      return () => clearInterval(interval)
    }
  }, [queuedStartTime, queuedDurationSec, displayedQueuedRemainingSec])

  // QUEUED ETA ticker: decrement 1s every second
  useEffect(() => {
    if (queuedStartTime) {
      const interval = setInterval(() => {
        setDisplayedQueuedRemainingSec((prev) => {
          if (prev == null) return prev
          const next = Math.max(0, prev - 1)
          if (lastLoggedQueuedRemainingRef.current == null || next !== lastLoggedQueuedRemainingRef.current) {
            lastLoggedQueuedRemainingRef.current = next
            const jobId = queuedJobIdRef.current
            log(`[UI] Reading File ETA tick: ${next}s remaining`, {
              remaining_seconds: next,
              total_seconds: queuedDurationSec,
              job_id: jobId,
            })
          }
          return next
        })
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [queuedStartTime, queuedDurationSec])

  // Progress ticker: increment 1% every (ETA/100) seconds
  useEffect(() => {
    if (processingStartTime && processingEtaSec && processingEtaSec > 0) {
      const tickIntervalMs = (processingEtaSec / 100) * 1000
      const interval = setInterval(() => {
        const elapsed = (Date.now() - processingStartTime) / 1000
        const progress = Math.floor((elapsed / processingEtaSec) * 100)
        const next = Math.max(0, Math.min(99, progress))
        setClientProcessingProgress((prev) => {
          const value = Math.max(prev, next)
          // Log on every 10% boundary crossed (10,20,...,90)
          const currentTenth = Math.floor(value / 10) * 10
          const lastTenth = lastLoggedProcessingTenthRef.current ?? -1
          if (value > 0 && currentTenth !== lastTenth && currentTenth >= 10 && currentTenth <= 90) {
            lastLoggedProcessingTenthRef.current = currentTenth
            const jobId = processingJobIdRef.current
            const remaining = displayedRemainingSec ?? Math.max(0, Math.ceil(processingEtaSec - elapsed))
            log(`[UI] Converting progress (ticker): ${currentTenth}%`, {
              progress_percent: currentTenth,
              elapsed_seconds: Math.floor(elapsed),
              remaining_seconds: Math.floor(remaining),
              projected_eta: processingEtaSec,
              job_id: jobId,
            })
          }
          return value
        })
      }, tickIntervalMs)
      return () => clearInterval(interval)
    }
  }, [processingStartTime, processingEtaSec])

  // Remaining time ticker: decrement 1s each second
  useEffect(() => {
    if (processingStartTime) {
      const interval = setInterval(() => {
        setDisplayedRemainingSec((prev) => {
          if (prev == null) return prev
          const next = Math.max(0, prev - 1)
          // Log each second decremented
          const last = lastLoggedRemainingSecRef.current
          if (last == null || next !== last) {
            lastLoggedRemainingSecRef.current = next
            const jobId = processingJobIdRef.current
            log(`[UI] ETA tick: ${next}s remaining`, {
              remaining_seconds: next,
              job_id: jobId,
            })
          }
          return next
        })
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [processingStartTime])

  // Reset when status changes
  useEffect(() => {
    if (currentStatus === "COMPLETE") {
      setUploadEta(undefined)
      setLastUploadProgress(0)
    }

    // Reset PROCESSING-specific state when leaving PROCESSING
    // No PROCESSING-specific local state to reset

    // No QUEUED-specific state to reset

    // Reset UPLOADING-specific state when leaving UPLOADING
    if (currentStatus !== "UPLOADING") {
      setUploadEta(undefined)
      setLastUploadProgress(0)
      setLastUploadTime(Date.now())
      setSpeedSampleCount(0)
    }
  }, [currentStatus])

  // Calculate upload ETA based on real-time upload speed (bytes per second)
  useEffect(() => {
    // Check both global status and per-file status
    const uploadingFile = pendingUploads.find((f) => f.status === "UPLOADING")
    const isUploading = currentStatus === "UPLOADING" || uploadingFile !== undefined

    if (isUploading && uploadProgress !== undefined && uploadProgress >= 0) {
      const now = Date.now()

      // Initialize upload start time on first progress update
      if (uploadStartTime === 0) {
        setUploadStartTime(now)
        setLastUploadProgress(uploadProgress)
        setLastUploadTime(now)
        setLastEtaUpdateTime(now)
        setSpeedSampleCount(0)

        // Capture job id for logging
        const jId = (uploadingFile as any)?.jobId || (uploadingFile as any)?.job_id
        uploadJobIdRef.current = jId || "unknown"
        return
      }

      // Get current file being uploaded
      const currentFile = uploadingFile || pendingUploads.find((f) => f.status === "UPLOADING")
      if (!currentFile || !currentFile.size) {
        return
      }

      const fileSize = currentFile.size
      // Use actual uploaded bytes from progress data if available, otherwise calculate from percentage
      const uploadedBytes = currentFile.upload_progress?.uploaded_bytes || (uploadProgress / 100) * fileSize
      const progressDelta = uploadProgress - lastUploadProgress
      const timeDelta = (now - lastUploadTime) / 1000 // Convert to seconds
      const etaTimeDelta = (now - lastEtaUpdateTime) / 1000 // Time since last ETA update

      // Only update if we have meaningful progress (avoid noise from rapid updates)
      if (progressDelta > 0.1 && timeDelta > 0.2) {
        // Calculate instantaneous speed (bytes uploaded in this interval / time elapsed)
        const bytesDelta = currentFile.upload_progress?.uploaded_bytes
          ? uploadedBytes - (lastUploadProgress / 100) * fileSize
          : (progressDelta / 100) * fileSize
        const instantSpeed = bytesDelta / timeDelta

        const smoothingFactor = speedSampleCount < 5 ? 0.15 : 0.25 // More smoothing initially
        const smoothedSpeed =
          uploadSpeed === 0 ? instantSpeed : smoothingFactor * instantSpeed + (1 - smoothingFactor) * uploadSpeed

        setUploadSpeed(smoothedSpeed)
        setLastUploadProgress(uploadProgress)
        setLastUploadTime(now)
        setSpeedSampleCount((prev) => prev + 1)

        // Require at least 3 samples before showing ETA to users
        if (speedSampleCount >= 3 && etaTimeDelta >= 10) {
          // Calculate remaining bytes and ETA
          const remainingBytes = fileSize - uploadedBytes
          const estimatedSeconds = smoothedSpeed > 0 ? remainingBytes / smoothedSpeed : 0

          // Ignore estimates over 1 hour as they're likely inaccurate
          if (estimatedSeconds > 0 && estimatedSeconds < 3600) {
            setUploadEta(Math.max(1, Math.round(estimatedSeconds)))
            setLastEtaUpdateTime(now)
            // Also refresh displayed countdown to match latest estimate
            setDisplayedUploadRemainingSec(Math.max(1, Math.round(estimatedSeconds)))
          }
        }
      }
    } else if (!isUploading) {
      // Reset upload tracking when not uploading
      setUploadStartTime(0)
      setUploadSpeed(0)
      setUploadEta(undefined)
      setDisplayedUploadRemainingSec(null)
      setSpeedSampleCount(0)
    }
  }, [
    uploadProgress,
    currentStatus,
    pendingUploads,
    speedSampleCount,
    uploadEta,
    uploadSpeed,
    uploadStartTime,
    lastUploadProgress,
    lastUploadTime,
    lastEtaUpdateTime,
  ])

  // Keep displayed upload ETA in sync when a fresh estimate arrives
  useEffect(() => {
    if (uploadEta && uploadEta > 0) {
      setDisplayedUploadRemainingSec(uploadEta)
    }
  }, [uploadEta])

  // Progressive upload ETA countdown (decrement by 1s each second)
  useEffect(() => {
    const uploadingFile = pendingUploads.find((f) => f.status === "UPLOADING")
    const isUploading = currentStatus === "UPLOADING" || uploadingFile !== undefined
    if (isUploading && displayedUploadRemainingSec != null) {
      const interval = setInterval(() => {
        setDisplayedUploadRemainingSec((prev) => {
          if (prev == null) return prev
          const next = Math.max(0, prev - 1)
          // Log each decrement
          if (lastLoggedUploadRemainingRef.current == null || next !== lastLoggedUploadRemainingRef.current) {
            lastLoggedUploadRemainingRef.current = next
            const jobId = uploadJobIdRef.current
            log(`[UI] Upload ETA tick: ${next}s remaining`, {
              remaining_seconds: next,
              job_id: jobId,
            })
          }
          return next
        })
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [currentStatus, pendingUploads, displayedUploadRemainingSec])

  const isJobRunning = (file: PendingUpload) => {
    return file.status === "UPLOADING" || file.status === "QUEUED" || file.status === "PROCESSING"
  }

  const hasActiveJobs = () => {
    return pendingUploads.some((file) => isJobRunning(file))
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes"
    const k = 1024
    const sizes = ["Bytes", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
  }

  const formatUploadSpeed = (bytesPerSecond: number) => {
    if (bytesPerSecond === 0) return "0 B/s"
    const k = 1024
    const sizes = ["B/s", "KB/s", "MB/s", "GB/s"]
    const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k))
    return Number.parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
  }

  const formatTime = (seconds: number) => {
    if (seconds < 60) {
      // Ensure we never show less than 1s
      const displaySeconds = Math.max(1, Math.round(seconds))
      return `${displaySeconds}s`
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60)
      const remainingSeconds = Math.round(seconds % 60)
      // If we have remaining seconds, ensure they're at least 1
      if (remainingSeconds > 0) {
        const displaySeconds = Math.max(1, remainingSeconds)
        return `${minutes}m ${displaySeconds}s`
      }
      return `${minutes}m`
    } else {
      const hours = Math.floor(seconds / 3600)
      const minutes = Math.floor((seconds % 3600) / 60)
      return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
    }
  }

  const getStatusBadge = (file: PendingUpload, index: number) => {
    if (file.isConverted) {
      return (
        <Badge
          variant="secondary"
          className="uppercase text-xs font-medium bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20"
        >
          Complete
        </Badge>
      )
    }

    if (file.error) {
      return (
        <Badge variant="destructive" className="uppercase text-xs font-medium">
          Error
        </Badge>
      )
    }

    if (selectedProfile === "Placeholder" && !isConverting && !file.status) {
      return (
        <Badge
          variant="secondary"
          className="uppercase text-xs font-medium bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20"
        >
          Needs Configuring
        </Badge>
      )
    }

    // Check file's own status property first (from session update)
    if (file.status) {
      switch (file.status) {
        case "UPLOADING":
          return (
            <Badge
              variant="secondary"
              className="uppercase text-xs font-medium bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20"
            >
              Uploading
            </Badge>
          )
        case "QUEUED":
          return (
            <Badge
              variant="secondary"
              className="uppercase text-xs font-medium bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20"
            >
              Converting
            </Badge>
          )
        case "PROCESSING":
          return (
            <Badge
              variant="secondary"
              className="uppercase text-xs font-medium bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20"
            >
              Converting
            </Badge>
          )
        case "COMPLETE":
          return (
            <Badge
              variant="secondary"
              className="uppercase text-xs font-medium bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20"
            >
              Finished
            </Badge>
          )
        default:
          break
      }
    }

    // Fallback to global status for first item when converting
    if (isConverting && index === 0 && currentStatus) {
      switch (currentStatus) {
        case "UPLOADING":
          return (
            <Badge
              variant="secondary"
              className="uppercase text-xs font-medium bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20"
            >
              Uploading
            </Badge>
          )
        case "QUEUED":
          return (
            <Badge
              variant="secondary"
              className="uppercase text-xs font-medium bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20"
            >
              Converting
            </Badge>
          )
        case "PROCESSING":
          return (
            <Badge
              variant="secondary"
              className="uppercase text-xs font-medium bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20"
            >
              Converting
            </Badge>
          )
        case "COMPLETE":
          return (
            <Badge
              variant="secondary"
              className="uppercase text-xs font-medium bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20"
            >
              Finished
            </Badge>
          )
        default:
          return (
            <Badge variant="secondary" className="uppercase text-xs font-medium">
              Waiting
            </Badge>
          )
      }
    }

    // Default: show "Ready" for files waiting to start
    return (
      <Badge variant="secondary" className="uppercase text-xs font-medium bg-muted">
        Ready
      </Badge>
    )
  }

  // Timeline stage calculation
  const getTimelineStage = (file: PendingUpload, index: number) => {
    const status = file.status || (isConverting && index === 0 ? currentStatus : null)

    // Handle error state - show as stage 3 but mark as errored
    if (file.error) {
      return { stage: 3, progress: 100, label: "Error", eta: null, isError: true }
    }

    // Before conversion starts - stage -1 means no active stage yet
    if (!status) return { stage: -1, progress: 0, label: "Ready", eta: null, isError: false }

    // Stage 0: Uploading (0-100% of upload)
    if (status === "UPLOADING") {
      // Priority: Use global uploadProgress (real-time from frontend) over backend's file.upload_progress
      // The backend's percentage is based on completed parts only, which lags behind actual upload progress
      const uploadPct = uploadProgress || Number.parseFloat(file.upload_progress?.percentage) || 0
      const safeUploadPct = Math.max(0, Math.min(100, uploadPct))
      let label = `Uploading - ${Math.round(safeUploadPct)}%`
      if (uploadSpeed > 0) {
        label += ` (@${formatUploadSpeed(uploadSpeed)})`
      }
      return {
        stage: 0,
        progress: safeUploadPct,
        label,
        eta: displayedUploadRemainingSec ?? uploadEta,
        isError: false,
      }
    }

    // Stage 1: Reading File (downloading from S3 to worker)
    if (status === "QUEUED") {
      return {
        stage: 1,
        progress: Math.max(0, Math.min(99, clientQueuedProgress)),
        label: "Reading File",
        eta: displayedQueuedRemainingSec ?? null,
        isError: false,
      }
    }

    // Stage 2: Converting
    if (status === "PROCESSING") {
      // Prefer client-side ticker based on backend ETA
      if (processingStartTime && processingEtaSec) {
        return {
          stage: 2,
          progress: Math.max(0, Math.min(99, clientProcessingProgress)),
          label: "Converting",
          eta: displayedRemainingSec ?? null,
          isError: false,
        }
      }
      // Fallback to backend-provided processing_progress if ticker not initialized
      if (file.processing_progress) {
        const { progress_percent, remaining_seconds } = file.processing_progress
        const safeProgress = Math.max(0, Math.min(99, progress_percent || 0))
        return {
          stage: 2,
          progress: safeProgress,
          label: "Converting",
          eta: remaining_seconds ?? null,
          isError: false,
        }
      }
      return { stage: 2, progress: 0, label: "Converting", eta: null, isError: false }
    }

    // Stage 3: Ready for Download
    if (status === "COMPLETE") {
      return { stage: 3, progress: 100, label: "Ready for Download", eta: null, isError: false }
    }

    return { stage: -1, progress: 0, label: "Ready", eta: null, isError: false }
  }

  const renderTimeline = (file: PendingUpload, index: number, actionButtons?: React.ReactNode) => {
    const { stage, progress, label, eta, isError } = getTimelineStage(file, index)

    const stages = [
      { icon: Upload, label: "Upload", shortLabel: "Upload", active: stage >= 0 },
      { icon: BookOpen, label: "Reading", shortLabel: "Read", active: stage >= 1 },
      { icon: Cog, label: "Converting", shortLabel: "Convert", active: stage >= 2 },
      {
        icon: isError ? AlertCircle : CheckCircle2,
        label: isError ? "Error" : "Complete",
        shortLabel: isError ? "Error" : "Done",
        active: stage >= 3,
      },
    ]

    // Each stage shows its own 100% progress bar when active
    const currentStageProgress = stage >= 0 && stage < stages.length ? progress : 0
    const isCompleted = stage >= 3 && !isError
    const isErrored = stage >= 3 && isError

    return (
      <div className="w-full">
        <div className="block sm:hidden space-y-3">
          {/* Stage nodes with connector line */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <div className="relative flex items-start justify-between">
                {/* Background connector line */}
                <div
                  className="absolute h-0.5 bg-muted top-4"
                  style={{
                    left: "16px" /* half of node width (32px / 2) */,
                    right: "16px",
                  }}
                />

                {/* Stage nodes */}
                {stages.map((s, i) => {
                  const Icon = s.icon
                  const isCurrentStage = i === stage && stage < 3
                  const isPastStage = stage >= 3 ? true : i < stage
                  const isFutureStage = i > stage && stage < 3

                  return (
                    <div key={i} className="flex flex-col items-center">
                      {/* Icon container */}
                      <div
                        className={`
                          relative z-10 flex items-center justify-center
                          w-8 h-8 rounded-full border-2 transition-all duration-300
                          ${
                            isCurrentStage
                              ? "border-primary bg-primary text-primary-foreground shadow-md shadow-primary/25"
                              : isPastStage && isError && i === 3
                                ? "border-destructive bg-destructive text-destructive-foreground"
                                : isPastStage
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-muted bg-background text-muted-foreground"
                          }
                        `}
                      >
                        {isPastStage && i < 3 ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : (
                          <Icon className={`h-4 w-4 ${isCurrentStage ? "animate-pulse" : ""}`} />
                        )}
                      </div>

                      {/* Label */}
                      <div className="mt-1.5 text-center">
                        <span
                          className={`
                            text-[10px] font-medium transition-colors block
                            ${isCurrentStage ? "text-foreground" : "text-muted-foreground"}
                            ${stage >= 3 ? "line-through opacity-60" : isPastStage && i < stage ? "line-through opacity-60" : ""}
                          `}
                        >
                          {s.shortLabel}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Action button on right */}
            {actionButtons && <div className="flex-shrink-0 ml-2">{actionButtons}</div>}
          </div>

          {/* Progress bar for active stages */}
          {stage >= 0 && stage < 3 && (
            <div className="space-y-2">
              <div className="relative h-2 bg-muted rounded-full overflow-hidden">
                {/* Upload stage: show dual layers for sent/received */}
                {stage === 0 && currentStatus === "UPLOADING" ? (
                  <>
                    {/* Light layer: total sent */}
                    <div
                      className="absolute inset-y-0 left-0 bg-primary/40 rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(100, currentStageProgress)}%` }}
                    />
                    {/* Dark layer: confirmed received */}
                    {uploadProgressConfirmed > 0 && (
                      <div
                        className="absolute inset-y-0 left-0 bg-primary rounded-full transition-all duration-300"
                        style={{ width: `${Math.min(100, uploadProgressConfirmed)}%` }}
                      />
                    )}
                  </>
                ) : (
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${Math.min(100, currentStageProgress)}%` }}
                  />
                )}
              </div>

              {/* Progress text */}
              <div className="flex items-center justify-between text-[11px] text-muted-foreground px-1">
                {stage === 0 && currentStatus === "UPLOADING" ? (
                  <>
                    <span>
                      Sent: {Math.round(currentStageProgress)}%
                      {uploadProgressConfirmed > 0 && (
                        <span className="ml-1.5 text-primary hidden xs:inline">
                          · Confirmed: {Math.round(uploadProgressConfirmed)}%
                        </span>
                      )}
                    </span>
                    {uploadSpeed > 0 && <span className="hidden xs:inline">{formatUploadSpeed(uploadSpeed)}</span>}
                  </>
                ) : (
                  <>
                    <span>
                      {Math.round(currentStageProgress)}% {stages[stage]?.label || ""}
                    </span>
                    {eta != null && eta > 0 && <span>{formatTime(eta)}</span>}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Desktop timeline */}
        <div className="hidden sm:block">
          <div className="flex items-start gap-4">
            {/* Timeline stages */}
            <div className="flex-1">
              {/* Stage nodes container with relative positioning for connector */}
              <div className="relative flex items-start justify-between">
                {/* Background connector line - spans between first and last node centers */}
                <div
                  className="absolute h-0.5 bg-muted top-5"
                  style={{
                    left: "20px" /* half of node width (40px / 2) */,
                    right: "20px" /* half of node width */,
                  }}
                />

                {/* Stage nodes */}
                {stages.map((s, i) => {
                  const Icon = s.icon
                  const isCurrentStage = i === stage && stage < 3
                  const isPastStage = stage >= 3 ? true : i < stage
                  const isFutureStage = i > stage && stage < 3

                  return (
                    <div key={i} className="flex flex-col items-center">
                      {/* Icon container */}
                      <div
                        className={`
                          relative z-10 flex items-center justify-center
                          w-10 h-10 rounded-full border-2 transition-all duration-300
                          ${
                            isCurrentStage
                              ? "border-primary bg-primary text-primary-foreground shadow-md shadow-primary/25"
                              : isPastStage && isError && i === 3
                                ? "border-destructive bg-destructive text-destructive-foreground"
                                : isPastStage
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-muted bg-background text-muted-foreground"
                          }
                        `}
                      >
                        {isPastStage && i < 3 ? (
                          <CheckCircle2 className="h-5 w-5" />
                        ) : (
                          <Icon className={`h-5 w-5 ${isCurrentStage ? "animate-pulse" : ""}`} />
                        )}
                      </div>

                      {/* Label */}
                      <div className="mt-2 text-center">
                        <span
                          className={`
                            text-xs font-medium transition-colors block
                            ${isCurrentStage ? "text-foreground" : "text-muted-foreground"}
                            ${stage >= 3 ? "line-through opacity-60" : isPastStage && i < stage ? "line-through opacity-60" : ""}
                          `}
                        >
                          <span className="hidden lg:inline">{s.label}</span>
                          <span className="lg:hidden">{s.shortLabel}</span>
                        </span>

                        {/* Progress info for current stage */}
                        {isCurrentStage && (
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            {Math.round(currentStageProgress)}%
                            {eta != null && eta > 0 && <span className="hidden md:inline"> · {formatTime(eta)}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {stage >= 0 && stage < 3 && (
                <div className="mt-4 mx-5">
                  <div className="relative h-2 md:h-1.5 bg-muted rounded-full overflow-hidden">
                    {/* Upload stage: show dual layers for sent/received */}
                    {stage === 0 && currentStatus === "UPLOADING" ? (
                      <>
                        {/* Light layer: sent bytes */}
                        <div
                          className="absolute inset-y-0 left-0 bg-primary/40 rounded-full transition-all duration-300"
                          style={{ width: `${Math.min(100, currentStageProgress)}%` }}
                        />
                        {/* Dark layer: confirmed received */}
                        {uploadProgressConfirmed > 0 && (
                          <div
                            className="absolute inset-y-0 left-0 bg-primary rounded-full transition-all duration-300"
                            style={{ width: `${Math.min(100, uploadProgressConfirmed)}%` }}
                          />
                        )}
                      </>
                    ) : (
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-300"
                        style={{ width: `${Math.min(100, currentStageProgress)}%` }}
                      />
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-1.5 text-[11px] md:text-[10px] text-muted-foreground">
                    {stage === 0 && currentStatus === "UPLOADING" ? (
                      <>
                        <span>
                          Sent: {Math.round(currentStageProgress)}%
                          {uploadProgressConfirmed > 0 && (
                            <span className="ml-2 text-primary">
                              · Confirmed: {Math.round(uploadProgressConfirmed)}%
                            </span>
                          )}
                        </span>
                        {uploadSpeed > 0 && <span className="hidden sm:inline">{formatUploadSpeed(uploadSpeed)}</span>}
                      </>
                    ) : (
                      <>
                        <span>
                          {stages[stage]?.label}: {Math.round(currentStageProgress)}%
                        </span>
                        {eta != null && eta > 0 && <span>{formatTime(eta)} remaining</span>}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Action buttons on desktop - better aligned */}
            {actionButtons && <div className="flex items-center flex-shrink-0 pt-0.5">{actionButtons}</div>}
          </div>
        </div>
      </div>
    )
  }

  const getProgressInfo = (file: PendingUpload, index: number) => {
    // Check file's own status first (from session update)
    if (file.status === "PROCESSING") {
      if (processingStartTime && processingEtaSec) {
        return {
          progress: Math.max(0, Math.min(100, clientProcessingProgress)),
          label: displayedRemainingSec != null ? `${formatTime(displayedRemainingSec)} remaining` : "Converting",
          showProgress: true,
        }
      }
      if (file.processing_progress) {
        const { progress_percent, remaining_seconds } = file.processing_progress
        return {
          progress: Math.max(0, Math.min(100, progress_percent || 0)),
          label: remaining_seconds != null ? `${formatTime(remaining_seconds)} remaining` : "Converting",
          showProgress: true,
        }
      }
    }

    if (file.status === "UPLOADING") {
      // Priority: Use global uploadProgress (real-time from frontend) over backend's file.upload_progress
      // The backend's percentage is based on completed parts only, which lags behind actual upload progress
      const percentage =
        uploadProgress || (file.upload_progress ? Number.parseFloat(file.upload_progress.percentage) : 0)
      const safePercentage = Math.max(0, Math.min(100, percentage))
      let uploadLabel = `Uploading - ${Math.round(safePercentage)}%`

      // Add ETA with speed in parentheses (same as global upload progress)
      if (uploadSpeed > 0 && uploadEta) {
        uploadLabel += ` • ${formatTime(uploadEta)} remaining (@${formatUploadSpeed(uploadSpeed)})`
      } else if (uploadSpeed > 0) {
        uploadLabel += ` (@${formatUploadSpeed(uploadSpeed)})`
      }

      return {
        progress: safePercentage,
        label: uploadLabel,
        showProgress: true,
      }
    }

    if (file.status === "QUEUED") {
      return {
        progress: Math.max(0, Math.min(100, clientQueuedProgress)),
        label:
          displayedQueuedRemainingSec != null ? `${formatTime(displayedQueuedRemainingSec)} remaining` : "Reading File",
        showProgress: true,
      }
    }

    // Fallback to global status for first item when converting (backward compatibility)
    if (!isConverting || index !== 0 || currentStatus === "COMPLETE") {
      // No progress for files that haven't started
      return null
    }

    switch (currentStatus) {
      case "UPLOADING":
        const safeUploadProgress = Math.max(0, Math.min(100, uploadProgress || 0))

        let uploadLabel = `Uploading - ${Math.round(safeUploadProgress)}%`

        // Add ETA with speed in parentheses
        if (uploadSpeed > 0 && uploadEta) {
          uploadLabel += ` • ${formatTime(uploadEta)} remaining (@${formatUploadSpeed(uploadSpeed)})`
        } else if (uploadSpeed > 0) {
          uploadLabel += ` (@${formatUploadSpeed(uploadSpeed)})`
        }

        return {
          progress: safeUploadProgress,
          label: uploadLabel,
          showProgress: true,
        }

      case "QUEUED":
        return {
          progress: 0,
          label: "Converting - 0%",
          showProgress: true,
        }

      case "PROCESSING":
        // Use only backend data; if missing, show 0%
        return {
          progress: file.processing_progress?.progress_percent ?? 0,
          label:
            file.processing_progress?.remaining_seconds != null
              ? `${formatTime(file.processing_progress.remaining_seconds)} remaining`
              : "Converting",
          showProgress: true,
        }

      default:
        return null
    }
  }

  const downloadFile = async (file: PendingUpload) => {
    if (!file.downloadId) return

    try {
      setDownloadingFiles((prev) => ({ ...prev, [file.name]: true }))

      const response = await fetchWithLicense(`/api/download/${file.downloadId}`)
      if (!response.ok) {
        const errText = await response.text()
        throw new Error(errText || "Failed to get download URL")
      }
      const data = await response.json()
      if (!data.signedUrl) {
        throw new Error(data.error || "No download URL returned")
      }
      window.location.href = data.signedUrl
      toast.success(`Downloading ${file.convertedName || file.name}`)
    } catch (error) {
      logError("Download error", file.downloadId, { error: error.message, fileName: file.name })
      toast.error("Download failed", {
        description: error instanceof Error ? error.message : "Failed to download file",
      })
    } finally {
      setTimeout(() => {
        setDownloadingFiles((prev) => ({ ...prev, [file.name]: false }))
      }, 1000)
    }
  }

  return (
    <div className="space-y-3">
      {items.map((file, index) => {
        const progressInfo = getProgressInfo(file, index)
        const isActive = isConverting && index === 0
        const jobRunning = isJobRunning(file)
        const { stage, progress, label, eta, isError } = getTimelineStage(file, index)

        return (
          <motion.div
            key={file.name + index}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <Card
              className={`
                transition-all duration-200
                ${
                  file.error
                    ? "border-destructive/50 bg-destructive/5"
                    : file.isConverted
                      ? "border-green-500/50 bg-green-500/5"
                      : "hover:border-muted-foreground/30"
                }
              `}
            >
              <div className="p-4 space-y-4">
                {/* Header: Filename and metadata */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div
                      className={`
                      rounded-lg p-2.5 flex-shrink-0 transition-colors
                      ${
                        file.isConverted
                          ? "bg-green-500/10 text-green-600 dark:text-green-400"
                          : file.error
                            ? "bg-destructive/10 text-destructive"
                            : "bg-muted text-muted-foreground"
                      }
                    `}
                    >
                      <FileText className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate text-sm leading-tight">
                        {file.isConverted && file.convertedName ? file.convertedName : file.name}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground mt-0.5">
                        {file.isConverted ? (
                          <>
                            {file.inputFileSize && file.outputFileSize && (
                              <span className="whitespace-nowrap">
                                {formatFileSize(file.inputFileSize)} → {formatFileSize(file.outputFileSize)}
                              </span>
                            )}
                            {file.actualDuration && (
                              <>
                                <span className="hidden xs:inline">•</span>
                                <span className="whitespace-nowrap">{formatTime(file.actualDuration)}</span>
                              </>
                            )}
                            {file.deviceProfile && deviceProfiles[file.deviceProfile] && (
                              <>
                                <span className="hidden xs:inline">•</span>
                                <span className="whitespace-nowrap hidden sm:inline">
                                  {deviceProfiles[file.deviceProfile]}
                                </span>
                              </>
                            )}
                          </>
                        ) : (
                          <>
                            <span className="whitespace-nowrap">{formatFileSize(file.size)}</span>
                            {file.deviceProfile && deviceProfiles[file.deviceProfile] && (
                              <>
                                <span>•</span>
                                <span className="whitespace-nowrap hidden sm:inline">
                                  {deviceProfiles[file.deviceProfile]}
                                </span>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Status badge - shown on header for completed/error states */}
                  {(file.isConverted || file.error) && (
                    <div className="flex-shrink-0">{getStatusBadge(file, index)}</div>
                  )}
                </div>

                {/* Error message */}
                {file.error && (
                  <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/5 rounded-lg p-3">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>{file.error}</span>
                  </div>
                )}

                {/* Timeline with inline action buttons */}
                {!file.isConverted &&
                  renderTimeline(
                    file,
                    index,
                    <>
                      {(() => {
                        const isCancelling = file.jobId ? cancellingJobs.has(file.jobId) : false
                        const isDismissing = file.jobId ? dismissingJobs.has(file.jobId) : false
                        const isLoading = isCancelling || isDismissing

                        if (file.error) {
                          return (
                            <TooltipProvider delayDuration={0}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => onDismissJob?.(file)}
                                    disabled={file.jobId ? dismissingJobs.has(file.jobId) : false}
                                    className="h-9 w-9 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                  >
                                    {file.jobId && dismissingJobs.has(file.jobId) ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <X className="h-4 w-4" />
                                    )}
                                    <span className="sr-only">Dismiss</span>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="left">
                                  <p>Dismiss from list</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )
                        }

                        if (jobRunning && onCancelJob) {
                          return (
                            <TooltipProvider delayDuration={0}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      log("[v0] Cancel button clicked for job:", file.jobId)
                                      onCancelJob(file)
                                    }}
                                    disabled={isLoading}
                                    className={`
                                      h-9 px-3
                                      text-muted-foreground
                                      hover:text-destructive hover:bg-destructive/10
                                      active:bg-destructive/20
                                      transition-colors duration-150
                                      ${isLoading ? "opacity-60 pointer-events-none" : ""}
                                    `}
                                  >
                                    {isLoading ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <XCircle className="h-4 w-4" />
                                    )}
                                    <span className="hidden sm:inline ml-1.5 text-sm font-medium">
                                      {isLoading ? "Cancelling" : "Cancel"}
                                    </span>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="left" className="sm:hidden">
                                  <p>{isLoading ? "Cancelling..." : "Cancel conversion"}</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )
                        } else if (!isActive && !jobRunning) {
                          // Not started - Remove button
                          return (
                            <TooltipProvider delayDuration={0}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => onRemoveFile?.(file)}
                                    className="h-9 w-9 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                  >
                                    <X className="h-4 w-4" />
                                    <span className="sr-only">Remove file</span>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="left">
                                  <p>Remove file</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )
                        }
                        return null
                      })()}
                    </>,
                  )}

                {file.isConverted &&
                  renderTimeline(
                    file,
                    index,
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={() => downloadFile(file)}
                        disabled={downloadingFiles[file.name]}
                        size="sm"
                        className="shadow-sm"
                      >
                        {downloadingFiles[file.name] ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin sm:mr-2" />
                            <span className="hidden sm:inline">Downloading</span>
                          </>
                        ) : (
                          <>
                            <Download className="h-4 w-4 sm:mr-2" />
                            <span className="hidden sm:inline">Download</span>
                          </>
                        )}
                      </Button>
                      <TooltipProvider delayDuration={0}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => onDismissJob?.(file)}
                              disabled={file.jobId ? dismissingJobs.has(file.jobId) : false}
                              className="h-9 w-9 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                            >
                              {file.jobId && dismissingJobs.has(file.jobId) ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <X className="h-4 w-4" />
                              )}
                              <span className="sr-only">Dismiss</span>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="left">
                            <p>Dismiss from list</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>,
                  )}
              </div>
            </Card>
          </motion.div>
        )
      })}

      {onAddMoreFiles && (
        <Button
          variant="outline"
          onClick={() => {
            if (hasActiveJobs()) {
              toast.info("Please wait", {
                description: "Wait for current files to finish converting before adding more files.",
              })
              return
            }
            onAddMoreFiles()
          }}
          disabled={isConverting || hasActiveJobs()}
          className="w-full h-12 border-dashed border-2 hover:border-primary hover:bg-primary/5 bg-transparent transition-colors"
        >
          <FileText className="mr-2 h-4 w-4" />
          Add more files
        </Button>
      )}

      {onOpenSidebar && onStartConversion && (
        <div className="flex flex-col sm:flex-row gap-3 mt-4 w-full">
          <Button
            variant="outline"
            size="lg"
            onClick={() => {
              if (hasActiveJobs()) {
                toast.info("Please wait", {
                  description: "Wait for current files to finish converting before changing settings.",
                })
                return
              }
              onOpenSidebar()
            }}
            disabled={hasActiveJobs()}
            className="w-full sm:w-auto sm:flex-1"
          >
            <Settings className="h-5 w-5 mr-2" />
            Configure Options
          </Button>
          <Button
            size="lg"
            onClick={() => {
              if (hasActiveJobs()) {
                toast.info("Please wait", {
                  description: "Wait for current files to finish converting before starting a new batch.",
                })
                return
              }
              onStartConversion()
            }}
            disabled={isConverting || hasActiveJobs() || (isReadyToConvert && !isReadyToConvert())}
            className="w-full sm:w-auto sm:flex-1"
          >
            {isConverting ? (
              <>
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                Converting...
              </>
            ) : (
              "Start Conversion"
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
