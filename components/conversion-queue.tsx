"use client"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Loader2, FileText, AlertTriangle, X, Download, XCircle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { motion } from "framer-motion"
import { useState, useEffect } from "react"
import type { PendingUpload, AdvancedOptionsType } from "./manga-converter"
import { fetchWithLicense } from "@/lib/utils"
import { log, logError, logWarn, logDebug } from "@/lib/logger"
import { toast } from "sonner"

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
  conversionProgress?: number
  isUploaded?: boolean
  eta?: number
  remainingTime?: number
  currentStatus?: string
  deviceProfiles?: Record<string, string>
  onAddMoreFiles?: () => void
  onNeedsConfiguration?: () => void
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
  conversionProgress = 0,
  isUploaded = false,
  eta,
  remainingTime,
  currentStatus,
  deviceProfiles = {},
  onAddMoreFiles,
  onNeedsConfiguration,
}: ConversionQueueProps) {
  const [items, setItems] = useState(pendingUploads)
  const [downloadingFiles, setDownloadingFiles] = useState<Record<string, boolean>>({})
  const [dynamicEta, setDynamicEta] = useState<number | undefined>(eta)
  const [dynamicRemainingTime, setDynamicRemainingTime] = useState<number | undefined>(remainingTime)
  const [initialRemainingTime, setInitialRemainingTime] = useState<number | undefined>(undefined)
  const [uploadEta, setUploadEta] = useState<number | undefined>(undefined)
  const [lastUploadProgress, setLastUploadProgress] = useState<number>(0)
  const [lastUploadTime, setLastUploadTime] = useState<number>(Date.now())

  useEffect(() => {
    if (JSON.stringify(items) !== JSON.stringify(pendingUploads)) {
      setItems(pendingUploads)
    }
  }, [pendingUploads])

  // Update dynamic ETA when prop changes
  useEffect(() => {
    if (eta !== undefined && currentStatus === "QUEUED") {
      // Only capture the INITIAL value when first entering QUEUED
      // After that, ignore all backend updates and let frontend countdown handle it
      if (!dynamicEta) {
        setDynamicEta(eta)
      }
      // Backend sends the same initial value repeatedly, so we ignore all subsequent updates
    }
  }, [eta, currentStatus, dynamicEta])

  // Update dynamic remaining time when prop changes
  useEffect(() => {
    if (remainingTime !== undefined && currentStatus === "PROCESSING") {
      // Only capture the INITIAL value when first entering PROCESSING
      // After that, ignore all backend updates and let frontend countdown handle it
      if (!initialRemainingTime) {
        setInitialRemainingTime(remainingTime)
        setDynamicRemainingTime(remainingTime)
      }
      // Backend sends the same initial value repeatedly, so we ignore all subsequent updates
    }
  }, [remainingTime, currentStatus, initialRemainingTime])

  // Countdown timer for ETA (QUEUED status)
  useEffect(() => {
    if (currentStatus === "QUEUED") {
      const interval = setInterval(() => {
        setDynamicEta((prev) => {
          if (prev === undefined || prev <= 1) return 1
          return prev - 1
        })
      }, 1000)

      return () => clearInterval(interval)
    }
  }, [currentStatus])

  // Countdown timer for remaining time (PROCESSING status)
  useEffect(() => {
    if (currentStatus === "PROCESSING") {
      const interval = setInterval(() => {
        setDynamicRemainingTime((prev) => {
          if (prev === undefined || prev <= 1) return 1
          return prev - 1
        })
      }, 1000)

      return () => clearInterval(interval)
    }
  }, [currentStatus])

  // Reset when status changes
  useEffect(() => {
    if (currentStatus === "COMPLETE") {
      setDynamicEta(undefined)
      setDynamicRemainingTime(undefined)
      setInitialRemainingTime(undefined)
      setUploadEta(undefined)
      setLastUploadProgress(0)
    }

    // Reset PROCESSING-specific state when leaving PROCESSING
    if (currentStatus !== "PROCESSING") {
      setInitialRemainingTime(undefined)
      setDynamicRemainingTime(undefined)
    }

    // Reset QUEUED-specific state when leaving QUEUED
    if (currentStatus !== "QUEUED") {
      setDynamicEta(undefined)
    }

    // Reset UPLOADING-specific state when leaving UPLOADING
    if (currentStatus !== "UPLOADING") {
      setUploadEta(undefined)
      setLastUploadProgress(0)
      setLastUploadTime(Date.now())
    }
  }, [currentStatus])

  // Calculate upload ETA based on upload speed
  useEffect(() => {
    if (currentStatus === "UPLOADING" && uploadProgress !== undefined && uploadProgress > 0) {
      const now = Date.now()
      const progressDelta = uploadProgress - lastUploadProgress
      const timeDelta = (now - lastUploadTime) / 1000 // Convert to seconds

      if (progressDelta > 0 && timeDelta > 0) {
        // Calculate speed in percentage per second
        const speedPerSecond = progressDelta / timeDelta
        // Calculate remaining time
        const remainingProgress = 100 - uploadProgress
        const estimatedSeconds = remainingProgress / speedPerSecond

        setUploadEta(Math.max(1, Math.round(estimatedSeconds)))
        setLastUploadProgress(uploadProgress)
        setLastUploadTime(now)
      }
    }
  }, [uploadProgress, currentStatus])

  const isJobRunning = (file: PendingUpload) => {
    return file.status === "UPLOADING" || file.status === "QUEUED" || file.status === "PROCESSING"
  }


  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes"
    const k = 1024
    const sizes = ["Bytes", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
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

    // Check file's own status property first (from polling)
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
              className="uppercase text-xs font-medium bg-white/10 text-white dark:text-white border-white/20"
            >
              READING FILE
            </Badge>
          )
        case "PROCESSING":
          return (
            <Badge
              variant="secondary"
              className="uppercase text-xs font-medium bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20"
            >
              Processing
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
              className="uppercase text-xs font-medium bg-white/10 text-white dark:text-white border-white/20"
            >
              READING FILE
            </Badge>
          )
        case "PROCESSING":
          return (
            <Badge
              variant="secondary"
              className="uppercase text-xs font-medium bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20"
            >
              Processing
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

    return (
      <Badge variant="secondary" className="uppercase text-xs font-medium bg-muted">
        Ready
      </Badge>
    )
  }

  const getProgressInfo = (file: PendingUpload, index: number) => {
    // Check file's own status first (from polling)
    if (file.status === "PROCESSING" && file.processing_progress) {
      const { progress_percent, remaining_seconds } = file.processing_progress
      return {
        progress: Math.max(0, Math.min(100, progress_percent)),
        label: remaining_seconds > 0 ? `${formatTime(remaining_seconds)} remaining` : "Processing",
        showProgress: true,
      }
    }

    if (file.status === "UPLOADING" && file.upload_progress) {
      const { percentage } = file.upload_progress
      return {
        progress: Math.max(0, Math.min(100, percentage)),
        label: `Uploading - ${Math.round(percentage)}%`,
        showProgress: true,
      }
    }

    if (file.status === "QUEUED") {
      return {
        progress: 0,
        label: "Reading File",
        showProgress: false,
      }
    }

    // Fallback to global status for first item when converting (backward compatibility)
    if (!isConverting || index !== 0 || currentStatus === "COMPLETE") {
      return null
    }

    switch (currentStatus) {
      case "UPLOADING":
        const safeUploadProgress = Math.max(0, Math.min(100, uploadProgress || 0))
        return {
          progress: safeUploadProgress,
          label: `Uploading - ${Math.round(safeUploadProgress)}%`,
          showProgress: true,
        }

      case "QUEUED":
        return {
          progress: 0,
          label: "Reading File",
          showProgress: false,
        }

      case "PROCESSING":
        // Fallback to old logic for backward compatibility
        const safeConversionProgress = Math.max(0, Math.min(100, conversionProgress || 0))
        const processingProgress = initialRemainingTime && dynamicRemainingTime
          ? Math.max(0, Math.min(100, ((initialRemainingTime - dynamicRemainingTime) / initialRemainingTime) * 100))
          : safeConversionProgress
        return {
          progress: processingProgress,
          label: dynamicRemainingTime ? `${formatTime(dynamicRemainingTime)} remaining` : "Processing",
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
              <div className="p-4">
                <div className="flex flex-col md:flex-row gap-4 items-start md:items-center">

                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="rounded-md p-2 bg-muted/50 flex-shrink-0">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium truncate text-sm">
                          {file.isConverted && file.convertedName ? file.convertedName : file.name}
                        </p>
                      </div>
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

                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {file.error ? (
                      <div className="flex items-center gap-2 text-sm text-destructive">
                        <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                        <span className="truncate">{file.error}</span>
                      </div>
                    ) : progressInfo ? (
                      <div className="flex items-center gap-3 flex-1">
                        {getStatusBadge(file, index)}
                        <span className="text-sm text-muted-foreground">{progressInfo.label}</span>
                      </div>
                    ) : (
                      getStatusBadge(file, index)
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {file.isConverted && file.downloadId && (
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
                    )}


                    {isActive && currentStatus === "PROCESSING" && (
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    )}

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
                      } else if (file.error || file.isConverted) {
                        // Terminal state (COMPLETE/ERRORED) - show X icon button for dismiss
                        return (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onDismissJob?.(file)}
                            disabled={isLoading}
                            className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive"
                            title="Dismiss"
                          >
                            {isLoading ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <X className="h-4 w-4" />
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
                  </div>
                </div>

                {progressInfo?.showProgress && (
                  <div className="mt-3 w-full">
                    <Progress value={progressInfo.progress} className="h-1.5" />
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
          onClick={onAddMoreFiles}
          disabled={isConverting}
          className="w-full h-12 border-dashed hover:border-primary hover:bg-primary/5 bg-transparent"
        >
          <FileText className="mr-2 h-4 w-4" />
          Add more files
        </Button>
      )}
    </div>
  )
}
