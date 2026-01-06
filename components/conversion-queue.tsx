"use client"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Loader2, FileText, AlertTriangle, X, Download, XCircle, Settings, Upload, Cloud, BookOpen, Cog, Save } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { motion } from "framer-motion"
import { useState, useEffect, useRef } from "react"
import type { PendingUpload, AdvancedOptionsType } from "./manga-converter"
import { fetchWithLicense } from "@/lib/utils"
import { log, logError, logWarn, logDebug } from "@/lib/logger"
import { toast } from "sonner"

const DOWNLOAD_SPEED_MBITS_WORKER = parseFloat(process.env.NEXT_PUBLIC_DOWNLOAD_SPEED_MBITS_WORKER || "250")
const QUEUED_SECONDS = parseInt(process.env.NEXT_PUBLIC_QUEUED_SECONDS || "5", 10)

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
  const uploadJobIdRef = useRef<string>('unknown')
  const lastLoggedUploadRemainingRef = useRef<number | null>(null)

  // Client-side PROCESSING ticker (based on backend-provided ETA at start)
  const [processingStartTime, setProcessingStartTime] = useState<number | null>(null)
  const [processingEtaSec, setProcessingEtaSec] = useState<number | null>(null)
  const [clientProcessingProgress, setClientProcessingProgress] = useState<number>(0)
  const [displayedRemainingSec, setDisplayedRemainingSec] = useState<number | null>(null)
  // Logging refs for 10% progress steps and ETA second decrements
  const lastLoggedProcessingTenthRef = useRef<number | null>(null)
  const lastLoggedRemainingSecRef = useRef<number | null>(null)
  const processingJobIdRef = useRef<string>('unknown')
  // QUEUED progressive ticker state
  const [queuedStartTime, setQueuedStartTime] = useState<number | null>(null)
  const [queuedDurationSec, setQueuedDurationSec] = useState<number>(QUEUED_SECONDS)
  const [clientQueuedProgress, setClientQueuedProgress] = useState<number>(0)
  const [displayedQueuedRemainingSec, setDisplayedQueuedRemainingSec] = useState<number | null>(null)
  const queuedJobIdRef = useRef<string>('unknown')
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
    const processingFile = pendingUploads.find(f => f.status === "PROCESSING" && f.processing_progress)
    const pp = processingFile?.processing_progress
    if (pp?.projected_eta && pp.projected_eta > 0) {
        const baseElapsed = pp.elapsed_seconds ?? 0
        const startMs = Date.now() - baseElapsed * 1000
        setProcessingStartTime(startMs)
        setProcessingEtaSec(pp.projected_eta)
        // Start from backend-progress if provided
        const initialProgress = pp.progress_percent != null
          ? Math.floor(Math.max(0, Math.min(99, pp.progress_percent)))
          : Math.floor(Math.max(0, Math.min(99, (baseElapsed / pp.projected_eta) * 100)))
        setClientProcessingProgress(initialProgress)
        const initialRemaining = pp.remaining_seconds != null
          ? pp.remaining_seconds
          : Math.max(0, Math.ceil(pp.projected_eta - baseElapsed))
        setDisplayedRemainingSec(initialRemaining)
        // Track job id for logging
        const jId = (processingFile as any)?.jobId || (processingFile as any)?.job_id
        if (jId) {
          processingJobIdRef.current = jId
        } else {
          processingJobIdRef.current = 'unknown'
        }
        // Reset logging refs when (re)initializing ticker
        lastLoggedProcessingTenthRef.current = null
        lastLoggedRemainingSecRef.current = null
    } else {
      setProcessingStartTime(null)
      setProcessingEtaSec(null)
      setClientProcessingProgress(0)
      setDisplayedRemainingSec(null)
      processingJobIdRef.current = 'unknown'
      lastLoggedProcessingTenthRef.current = null
      lastLoggedRemainingSecRef.current = null
    }
  }, [pendingUploads])

  // Initialize QUEUED ticker with static duration from env
  useEffect(() => {
    const queuedFile = pendingUploads.find(f => f.status === 'QUEUED')
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
      queuedJobIdRef.current = jId || 'unknown'
      lastLoggedQueuedTenthRef.current = null
      lastLoggedQueuedRemainingRef.current = null
    } else {
      setQueuedStartTime(null)
      setClientQueuedProgress(0)
      setDisplayedQueuedRemainingSec(null)
      queuedJobIdRef.current = 'unknown'
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
        setClientQueuedProgress(prev => {
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
        setDisplayedQueuedRemainingSec(prev => {
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
        setClientProcessingProgress(prev => {
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
        setDisplayedRemainingSec(prev => {
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
    }
  }, [currentStatus])

  // Calculate upload ETA based on real-time upload speed (bytes per second)
  useEffect(() => {
    // Check both global status and per-file status
    const uploadingFile = pendingUploads.find(f => f.status === "UPLOADING")
    const isUploading = currentStatus === "UPLOADING" || uploadingFile !== undefined

    if (isUploading && uploadProgress !== undefined && uploadProgress > 0) {
      const now = Date.now()

      // Initialize upload start time on first progress update
      if (uploadStartTime === 0) {
        setUploadStartTime(now)
        setLastUploadProgress(uploadProgress)
        setLastUploadTime(now)
        setLastEtaUpdateTime(now)

        // Calculate initial ETA
        const currentFile = uploadingFile || pendingUploads.find(f => f.status === "UPLOADING")
        if (currentFile && currentFile.size) {
          const fileSize = currentFile.size
          const uploadedBytes = currentFile.upload_progress?.uploaded_bytes || (uploadProgress / 100) * fileSize
          // Estimate initial speed based on first progress point
          const elapsedSeconds = Math.max(1, (now - (currentFile.upload_progress?.started_at || now)) / 1000)
          const initialSpeed = uploadedBytes / elapsedSeconds
          const remainingBytes = fileSize - uploadedBytes
          const estimatedSeconds = initialSpeed > 0 ? remainingBytes / initialSpeed : 0

          setUploadSpeed(initialSpeed)
          setUploadEta(Math.max(1, Math.round(estimatedSeconds)))
        }
        // Initialize displayed upload ETA from initial estimate
        if (uploadEta && uploadEta > 0) {
          setDisplayedUploadRemainingSec(uploadEta)
        }
        // Capture job id for logging
        const jId = (uploadingFile as any)?.jobId || (uploadingFile as any)?.job_id
        uploadJobIdRef.current = jId || 'unknown'
        return
      }

      // Get current file being uploaded
      const currentFile = uploadingFile || pendingUploads.find(f => f.status === "UPLOADING")
      if (!currentFile || !currentFile.size) {
        return
      }

      const fileSize = currentFile.size
      // Use actual uploaded bytes from progress data if available, otherwise calculate from percentage
      const uploadedBytes = currentFile.upload_progress?.uploaded_bytes
        || (uploadProgress / 100) * fileSize
      const progressDelta = uploadProgress - lastUploadProgress
      const timeDelta = (now - lastUploadTime) / 1000 // Convert to seconds
      const etaTimeDelta = (now - lastEtaUpdateTime) / 1000 // Time since last ETA update

      // Only update if we have meaningful progress (avoid noise from rapid updates)
      if (progressDelta > 0.1 && timeDelta > 0.2) {
        // Calculate instantaneous speed (bytes uploaded in this interval / time elapsed)
        const bytesDelta = currentFile.upload_progress?.uploaded_bytes
          ? (uploadedBytes - (lastUploadProgress / 100) * fileSize)
          : (progressDelta / 100) * fileSize
        const instantSpeed = bytesDelta / timeDelta

        // Use exponential moving average to smooth out speed fluctuations
        // This prevents ETA from jumping around too much
        const smoothingFactor = 0.3 // Lower = more smoothing
        const smoothedSpeed = uploadSpeed === 0
          ? instantSpeed
          : (smoothingFactor * instantSpeed) + ((1 - smoothingFactor) * uploadSpeed)

        setUploadSpeed(smoothedSpeed)
        setLastUploadProgress(uploadProgress)
        setLastUploadTime(now)

        // Only update ETA every 5 seconds
        if (etaTimeDelta >= 5) {
          // Calculate remaining bytes and ETA
          const remainingBytes = fileSize - uploadedBytes
          const estimatedSeconds = smoothedSpeed > 0 ? remainingBytes / smoothedSpeed : 0

          setUploadEta(Math.max(1, Math.round(estimatedSeconds)))
          setLastEtaUpdateTime(now)
          // Also refresh displayed countdown to match latest estimate
          setDisplayedUploadRemainingSec(Math.max(1, Math.round(estimatedSeconds)))
        }
      }
    } else if (!isUploading) {
      // Reset upload tracking when not uploading
      setUploadStartTime(0)
      setUploadSpeed(0)
      setUploadEta(undefined)
      setDisplayedUploadRemainingSec(null)
    }
  }, [uploadProgress, currentStatus, pendingUploads])

  // Keep displayed upload ETA in sync when a fresh estimate arrives
  useEffect(() => {
    if (uploadEta && uploadEta > 0) {
      setDisplayedUploadRemainingSec(uploadEta)
    }
  }, [uploadEta])

  // Progressive upload ETA countdown (decrement by 1s each second)
  useEffect(() => {
    const uploadingFile = pendingUploads.find(f => f.status === "UPLOADING")
    const isUploading = currentStatus === "UPLOADING" || uploadingFile !== undefined
    if (isUploading && displayedUploadRemainingSec != null) {
      const interval = setInterval(() => {
        setDisplayedUploadRemainingSec(prev => {
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

    // Before conversion starts - stage -1 means no active stage yet
    if (!status) return { stage: -1, progress: 0, label: "Ready", eta: null }

    // Stage 0: Uploading (0-100% of upload)
    if (status === "UPLOADING") {
      // Priority: Use global uploadProgress (real-time from frontend) over backend's file.upload_progress
      // The backend's percentage is based on completed parts only, which lags behind actual upload progress
      const uploadPct = uploadProgress || parseFloat(file.upload_progress?.percentage) || 1
      const safeUploadPct = Math.max(1, Math.min(100, uploadPct))
      let label = `Uploading - ${Math.round(safeUploadPct)}%`
      if (uploadSpeed > 0) {
        label += ` (@${formatUploadSpeed(uploadSpeed)})`
      }
      return {
        stage: 0,
        progress: safeUploadPct,
        label,
        eta: displayedUploadRemainingSec ?? uploadEta
      }
    }

    // Stage 1: Reading File (downloading from S3 to worker)
    if (status === "QUEUED") {
      return {
        stage: 1,
        progress: Math.max(0, Math.min(99, clientQueuedProgress)),
        label: "Reading File",
        eta: displayedQueuedRemainingSec ?? null
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
          eta: displayedRemainingSec ?? null
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
          eta: remaining_seconds ?? null
        }
      }
      return { stage: 2, progress: 0, label: "Converting", eta: null }
    }

    // Stage 3: Ready for Download
    if (status === "COMPLETE") {
      return { stage: 3, progress: 100, label: "Ready for Download", eta: null }
    }

    return { stage: -1, progress: 0, label: "Ready", eta: null }
  }

  const renderTimeline = (file: PendingUpload, index: number, actionButtons?: React.ReactNode) => {
    const { stage, progress, label, eta } = getTimelineStage(file, index)

    const stages = [
      { icon: Upload, label: "Uploading", active: stage >= 0 },
      { icon: BookOpen, label: "Reading File", active: stage >= 1 },
      { icon: Cog, label: "Converting", active: stage >= 2 },
      { icon: Save, label: "Ready for Download", active: stage >= 3 },
    ]

    // Calculate cumulative progress (each stage is 25% of total)
    const totalStages = stages.length
    const stageWeight = 100 / totalStages // 25% per stage
    let cumulativeProgress = 0

    if (stage >= 0) {
      // Add completed stages
      cumulativeProgress = stage * stageWeight
      // Add current stage progress
      cumulativeProgress += (progress / 100) * stageWeight
    }

    return (
      <div className="space-y-3">
        {/* Timeline with action buttons */}
        <div className="relative flex items-center justify-between gap-4 px-4">
          {/* Timeline stages */}
          <div className="relative flex items-center justify-between flex-1">
          {stages.map((s, i) => {
            const Icon = s.icon
            const isCurrentStage = i === stage
            const isPastStage = i < stage
            const isFutureStage = i > stage

            // Calculate how much of this segment should be filled
            const segmentStart = i * stageWeight
            const segmentEnd = (i + 1) * stageWeight
            let segmentFillPercent = 0

            if (cumulativeProgress >= segmentEnd) {
              // Fully filled
              segmentFillPercent = 100
            } else if (cumulativeProgress > segmentStart) {
              // Partially filled
              segmentFillPercent = ((cumulativeProgress - segmentStart) / stageWeight) * 100
            }

            return (
              <div key={i} className="flex flex-col items-center relative">
                {/* Icon */}
                <div
                  className={`rounded-full p-2 z-10 transition-all ${
                    isCurrentStage
                      ? "bg-primary text-primary-foreground animate-pulse"
                      : isPastStage
                      ? "bg-primary/70 text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </div>

                {/* Stage label below icon */}
                <div className="mt-2 text-xs text-center min-w-[120px]">
                  <span className={isCurrentStage ? "font-medium text-foreground" : "text-muted-foreground"}>
                    {s.label}
                    {isCurrentStage && (i !== 0 || currentStatus !== "UPLOADING") && (
                      <span className="ml-1 text-[10px] text-muted-foreground">
                        {Math.round(progress)}%
                        {eta != null && eta > 0 && (
                          <> · {formatTime(eta)}</>
                        )}
                      </span>
                    )}
                  </span>
                </div>

                {/* Connecting line from right edge of icon to next icon */}
                {i < stages.length - 1 && (
                  <>
                    {/* Background line (gray) - extends from right of current icon to left of next */}
                    <div className="absolute top-4 left-[calc(50%+20px)] right-[calc(-100%-20px)] h-0.5 -translate-y-1/2 bg-muted" />
                    {/* Progress line - two layers for upload stage */}
                    {segmentFillPercent > 0 && i === 0 && currentStatus === "UPLOADING" && (
                      <>
                        {/* Light red layer: Total uploaded bytes (irrespective of backend confirmation) */}
                        <div
                          className="absolute top-4 left-[calc(50%+20px)] h-0.5 bg-primary/40 -translate-y-1/2 transition-all duration-300"
                          style={{ width: `calc((100% + 40px) * ${segmentFillPercent / 100})` }}
                        />
                        {/* Dark red layer: Backend-confirmed parts only */}
                        {uploadProgressConfirmed > 0 && (
                          <div
                            className="absolute top-4 left-[calc(50%+20px)] h-0.5 bg-primary -translate-y-1/2 transition-all duration-300"
                            style={{ width: `calc((100% + 40px) * ${(uploadProgressConfirmed / 100) * (segmentFillPercent / 100)})` }}
                          />
                        )}
                        {/* Label below progress bar showing received/sent */}
                        <div className="absolute top-6 left-[calc(50%+20px)] text-[10px] text-muted-foreground whitespace-nowrap">
                          <span className="text-primary">received: {Math.round(uploadProgressConfirmed)}%</span>
                          {" / "}
                          <span className="text-primary/40">sent: {Math.round(uploadProgress)}%</span>
                          {eta != null && eta > 0 && (
                            <> · {formatTime(eta)}</>
                          )}
                        </div>
                      </>
                    )}
                    {/* Single progress line for other stages */}
                    {segmentFillPercent > 0 && (i !== 0 || currentStatus !== "UPLOADING") && (
                      <div
                        className="absolute top-4 left-[calc(50%+20px)] h-0.5 bg-primary -translate-y-1/2 transition-all duration-300"
                        style={{ width: `calc((100% + 40px) * ${segmentFillPercent / 100})` }}
                      />
                    )}
                  </>
                )}
              </div>
            )
          })}
          </div>

          {/* Action buttons on the right */}
          {actionButtons && (
            <div className="flex items-center gap-2 flex-shrink-0">
              {actionButtons}
            </div>
          )}
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
      const percentage = uploadProgress || (file.upload_progress ? parseFloat(file.upload_progress.percentage) : 1)
      // Always show at least 1%
      const safePercentage = Math.max(1, Math.min(100, percentage))
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
        label: displayedQueuedRemainingSec != null ? `${formatTime(displayedQueuedRemainingSec)} remaining` : "Reading File",
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
        // Always show at least 1% progress
        const safeUploadProgress = Math.max(1, Math.min(100, uploadProgress || 1))

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
          label: file.processing_progress?.remaining_seconds != null
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
        const { stage, progress, label, eta } = getTimelineStage(file, index)

        return (
          <motion.div
            key={file.name + index}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <Card
              className={`${file.error ? "border-destructive/40 bg-destructive/5" : ""} ${isActive ? "border-primary/40" : ""} ${file.isConverted ? "border-green-500/40 bg-green-500/5" : ""}`}
            >
              <div className="p-4 space-y-4">
                {/* Header: Filename and ETA */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="rounded-md p-2 bg-muted/50 flex-shrink-0">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate text-sm">
                        {file.isConverted && file.convertedName ? file.convertedName : file.name}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {file.isConverted ? (
                          <>
                            {file.inputFileSize && file.outputFileSize && (
                              <>
                                <span>
                                  {formatFileSize(file.inputFileSize)} → {formatFileSize(file.outputFileSize)}
                                </span>
                                <span>•</span>
                              </>
                            )}
                            {file.actualDuration && (
                              <>
                                <span>{formatTime(file.actualDuration)}</span>
                                <span>•</span>
                              </>
                            )}
                            {file.deviceProfile && deviceProfiles[file.deviceProfile] && (
                              <span>{deviceProfiles[file.deviceProfile]}</span>
                            )}
                          </>
                        ) : (
                          <>
                            <span>{formatFileSize(file.size)}</span>
                            {file.deviceProfile && deviceProfiles[file.deviceProfile] && (
                              <>
                                <span>•</span>
                                <span>{deviceProfiles[file.deviceProfile]}</span>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                </div>

                {/* Error message */}
                {file.error && (
                  <div className="flex items-center gap-2 text-sm text-destructive">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                    <span className="truncate">{file.error}</span>
                  </div>
                )}

                {/* Timeline with inline action buttons */}
                {!file.error && !file.isConverted && renderTimeline(file, index, (
                  <>
                    {/* Unified Cancel/Dismiss/Remove button */}
                    {(() => {
                      const isCancelling = file.jobId ? cancellingJobs.has(file.jobId) : false
                      const isDismissing = file.jobId ? dismissingJobs.has(file.jobId) : false
                      const isLoading = isCancelling || isDismissing

                      // Determine action based on job state
                      if (jobRunning && onCancelJob) {
                        // Active job (UPLOADING/QUEUED/PROCESSING) - show Cancel button
                        return (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => {
                              log("[v0] Cancel button clicked for job:", file.jobId)
                              onCancelJob(file)
                            }}
                            disabled={isLoading}
                            className="shadow-sm"
                          >
                            {isLoading ? (
                              <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Cancelling...
                              </>
                            ) : (
                              <>
                                <XCircle className="h-4 w-4 mr-2" />
                                Cancel
                              </>
                            )}
                          </Button>
                        )
                      } else if (!isActive && !jobRunning) {
                        // Not started yet - show X icon button for remove
                        return (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onRemoveFile?.(file)}
                            className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive"
                            title="Remove"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )
                      }
                      return null
                    })()}
                  </>
                ))}

                {/* Download and Dismiss buttons for completed files */}
                {file.isConverted && (
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      onClick={() => downloadFile(file)}
                      disabled={downloadingFiles[file.name]}
                      size="sm"
                      className="shadow-sm"
                    >
                      {downloadingFiles[file.name] ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Download className="h-4 w-4 mr-2" />
                          Download
                        </>
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onDismissJob?.(file)}
                      disabled={file.jobId ? dismissingJobs.has(file.jobId) : false}
                      className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive"
                      title="Dismiss"
                    >
                      {file.jobId && dismissingJobs.has(file.jobId) ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <X className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
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
          className="w-full h-12 border-dashed hover:border-primary hover:bg-primary/5 bg-transparent"
        >
          <FileText className="mr-2 h-4 w-4" />
          Add more files
        </Button>
      )}

      {onOpenSidebar && onStartConversion && (
        <div className="flex flex-col gap-3 mt-4 w-full">
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
            className="w-full"
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
            className="w-full"
          >
            {isConverting ? "Converting..." : "Start Conversion"}
          </Button>
        </div>
      )}
    </div>
  )
}
