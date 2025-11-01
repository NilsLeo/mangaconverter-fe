"use client"

import type React from "react"

import { useState, useRef } from "react"
import { Upload, FileUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

interface FileUploaderProps {
  onFilesSelected: (files: File[]) => void
  disabled?: boolean
  acceptedTypes: string[]
  maxFiles: number
  maxFileSize?: number
  compact?: boolean
  contentType?: "comic" | "manga"
}

export function FileUploader({
  onFilesSelected,
  disabled = false,
  acceptedTypes,
  maxFiles,
  maxFileSize = 1024 * 1024 * 1024,
  compact = false,
  contentType = "comic",
}: FileUploaderProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [isHoveringIcon, setIsHoveringIcon] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => {
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    if (disabled) return

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files)

      const validExtensionFiles = files.filter((file) => {
        const extension = "." + file.name.split(".").pop()?.toLowerCase()
        return acceptedTypes.includes(extension)
      })

      if (validExtensionFiles.length === 0) {
        toast.error("No valid files found", {
          description: `Please upload files with these extensions: ${acceptedTypes.join(", ")}`,
        })
        return
      }

      const validSizeFiles = validExtensionFiles.filter((file) => {
        if (file.size > maxFileSize) {
          toast.error(`File too large: ${file.name}`, {
            description: `Maximum file size is ${formatFileSize(maxFileSize)}`,
          })
          return false
        }
        return true
      })

      if (validSizeFiles.length > 0) {
        onFilesSelected(validSizeFiles)
        toast.success(`${validSizeFiles.length} file${validSizeFiles.length !== 1 ? "s" : ""} added`)
      }
    }
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files)

      const validSizeFiles = files.filter((file) => {
        if (file.size > maxFileSize) {
          toast.error(`File too large: ${file.name}`, {
            description: `Maximum file size is ${formatFileSize(maxFileSize)}`,
          })
          return false
        }
        return true
      })

      if (validSizeFiles.length > 0) {
        onFilesSelected(validSizeFiles)
        toast.success(`${validSizeFiles.length} file${validSizeFiles.length !== 1 ? "s" : ""} added`)
      }
    }
  }

  const handleButtonClick = () => {
    if (disabled) {
      return
    }
    fileInputRef.current?.click()
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes"
    const k = 1024
    const sizes = ["Bytes", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
  }

  // New Batman icon for Comic Converter (yellow)
  const BatmanIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="1.95 2 230.12 256" className="h-12 w-12" fill="#FDB813">
      <path d="M232.043,157.557L216.22,2l-32.915,51.122c0,0-28.733-21.024-66.301-21.024c-37.577,0-60.744,17.332-60.744,17.332L9.57,2  L1.957,157.557h4.675C11.901,213.818,59.385,258,117,258s105.099-44.182,110.368-100.443H232.043z M47.147,109.233  c2.105-7.719,11.19-11.065,17.794-6.556l35.635,24.35H42.293L47.147,109.233z M169.194,102.677  c6.604-4.508,15.698-1.163,17.803,6.556l4.845,17.794h-58.283L169.194,102.677z M117,238.185c-46.68,0-85.26-35.314-90.447-80.628  h180.893C202.26,202.871,163.68,238.185,117,238.185z M146.646,200.214H90.891v-16.932h55.755V200.214z" />
    </svg>
  )

  // New Pirate Hat icon for Manga Converter (red)
  const PirateHatIcon = () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      version="1.1"
      x="0px"
      y="0px"
      enableBackground="new 0 0 100 100"
      xmlSpace="preserve"
      viewBox="6.43 12.78 87.13 75.53"
      className="h-12 w-12"
      fill="#dc2626"
    >
<g><g><path fill="none" d="M81.22,79.22c-0.93,0.93-2.25,1.36-3.55,1.15l-1.37-0.22l0.22,1.37c0.21,1.3-0.22,2.63-1.16,3.56    c-0.78,0.78-1.83,1.22-2.93,1.22c-0.01,0-0.01,0-0.01,0c-1.11-0.01-2.15-0.44-2.93-1.23c-0.79-0.78-1.23-1.83-1.23-2.94    c0-1.1,0.43-2.15,1.22-2.93l0.91-0.7l-4.58-4.58c0.41-3.13,0.07-6.49-1-9.9l9.91,9.9l0.71-0.66c1.65-1.56,4.19-1.53,5.79,0.08    C82.84,74.96,82.84,77.59,81.22,79.22z"/><path fill="none" d="M62.83,64.34c-1.5,1.34-3.17,2.42-4.96,3.22l-0.74-4.32c0.21-0.07,0.43-0.13,0.64-0.21    c0.6-0.2,1.18-0.45,1.76-0.7c0.12-0.06,0.25-0.12,0.38-0.18c0.56-0.26,1.11-0.54,1.64-0.84c0.03-0.02,0.05-0.03,0.08-0.04    C62.1,62.3,62.49,63.32,62.83,64.34z"/><path fill="none" d="M56.87,73.57c-1.9,0.55-3.86,0.87-5.87,0.95v-3.31c1.82-0.08,3.6-0.38,5.31-0.91L56.87,73.57z"/><path fill="none" d="M55.97,68.3c-1.6,0.52-3.26,0.82-4.97,0.91v-4.87h0.01c0.24-0.01,0.47-0.03,0.68-0.05    c0.27-0.02,0.54-0.04,0.8-0.06c0.24-0.02,0.48-0.05,0.69-0.09c0.01,0,0.02,0,0.02,0c0.49-0.07,0.98-0.15,1.46-0.25    c0.04-0.01,0.07-0.01,0.11-0.02l0.06-0.01c0.12-0.03,0.24-0.05,0.36-0.08L55.97,68.3z"/><path fill="none" d="M91.56,24.81c0,1.11-0.44,2.15-1.23,2.93c-0.78,0.79-1.83,1.23-2.94,1.23s-2.15-0.43-2.93-1.22l-0.69-0.92    L73.12,37.48c-0.01-0.05-0.02-0.09-0.03-0.13c-0.08-0.53-0.18-1.06-0.29-1.58c-0.02-0.07-0.04-0.14-0.06-0.21    c-0.1-0.45-0.23-0.91-0.36-1.35c-0.04-0.13-0.08-0.26-0.12-0.39c-0.16-0.5-0.33-0.99-0.53-1.48c0-0.01-0.01-0.02-0.01-0.02    c-0.2-0.5-0.42-0.98-0.65-1.46c-0.03-0.06-0.05-0.11-0.08-0.17l8.2-8.18l-0.67-0.71c-1.56-1.64-1.53-4.19,0.08-5.79    c1.62-1.62,4.25-1.62,5.88,0c0.93,0.92,1.36,2.25,1.15,3.55l-0.22,1.37l1.37-0.22c1.3-0.21,2.63,0.22,3.56,1.16    C91.13,22.65,91.56,23.7,91.56,24.81z"/><path fill="none" d="M63.95,70.19c-1.62,1.13-3.35,2.04-5.16,2.73l-0.57-3.32c1.86-0.78,3.61-1.83,5.2-3.13    C63.71,67.73,63.88,68.97,63.95,70.19z"/><ellipse transform="matrix(0.1602 -0.9871 0.9871 0.1602 -1.1081 101.3376)" cx="59" cy="51.32" rx="5.9" ry="5.9"/><path d="M61.09,30.3c0.06,0.55-0.34,1.04-0.89,1.1h-0.1c-0.51,0-0.94-0.38-1-0.89c-0.09-0.94-0.37-1.66-0.81-2.13    c-0.38-0.41-0.35-1.04,0.05-1.42c0.41-0.37,1.04-0.35,1.41,0.05C60.5,27.82,60.95,28.92,61.09,30.3z"/><path d="M65.37,31.53c-0.09,0.03-0.18,0.04-0.27,0.04c-0.44,0-0.84-0.29-0.96-0.74c-0.48-1.74-1.2-3.02-2.15-3.8    c-0.43-0.35-0.5-0.98-0.15-1.4c0.35-0.43,0.98-0.5,1.41-0.15c1.3,1.06,2.22,2.64,2.82,4.83C66.21,30.84,65.9,31.39,65.37,31.53z"/></g><path fill="none" d="M34.19,73.92l-4.58,4.58l0.91,0.7c0.79,0.78,1.22,1.83,1.22,2.93c0,1.11-0.44,2.16-1.23,2.94   c-0.78,0.79-1.82,1.22-2.93,1.23h-0.01c-1.1,0-2.15-0.44-2.94-1.22c-0.93-0.93-1.36-2.26-1.15-3.56l0.22-1.37l-1.37,0.22   c-1.3,0.21-2.63-0.22-3.55-1.15c-1.62-1.63-1.62-4.26,0-5.88c1.6-1.61,4.14-1.64,5.79-0.08l0.71,0.66l9.9-9.9   C34.11,67.43,33.77,70.79,34.19,73.92z"/><path fill="none" d="M42.87,63.24l-0.74,4.32c-1.79-0.8-3.46-1.88-4.96-3.22c0.34-1.02,0.73-2.04,1.2-3.07   c0.03,0.01,0.05,0.02,0.08,0.04c0.53,0.3,1.08,0.58,1.64,0.84c0.13,0.06,0.25,0.12,0.38,0.18c0.58,0.25,1.16,0.5,1.76,0.7   C42.44,63.11,42.66,63.17,42.87,63.24z"/><path fill="none" d="M49,71.21v3.31c-2.01-0.08-3.98-0.4-5.87-0.95l0.56-3.27C45.4,70.83,47.18,71.13,49,71.21z"/><path fill="none" d="M49,64.34v4.87c-1.71-0.09-3.37-0.39-4.97-0.91l0.78-4.52c0.12,0.03,0.24,0.05,0.36,0.08l0.06,0.01   c0.03,0.01,0.07,0.01,0.11,0.02c0.48,0.1,0.97,0.18,1.46,0.25c0,0,0.01,0,0.02,0c0.21,0.04,0.45,0.07,0.69,0.09   c0.26,0.02,0.53,0.04,0.8,0.06c0.21,0.02,0.44,0.04,0.68,0.05H49z"/><path fill="none" d="M29.01,30.69c-0.03,0.06-0.05,0.11-0.08,0.17c-0.23,0.48-0.45,0.96-0.65,1.46c-0.01,0-0.01,0.01-0.01,0.02   c-0.2,0.49-0.37,0.98-0.53,1.48c-0.04,0.13-0.08,0.26-0.12,0.39c-0.13,0.44-0.26,0.9-0.37,1.35c-0.01,0.07-0.03,0.14-0.05,0.21   c-0.12,0.52-0.21,1.05-0.29,1.58c-0.01,0.04-0.02,0.08-0.03,0.13L16.23,26.83l-0.69,0.92c-0.78,0.79-1.82,1.22-2.93,1.22   c0,0,0,0-0.01,0c-1.1,0-2.15-0.44-2.93-1.23H9.66c-0.78-0.78-1.22-1.82-1.22-2.93s0.43-2.16,1.22-2.94   c0.93-0.94,2.26-1.37,3.56-1.16l1.36,0.22l-0.21-1.37c-0.21-1.3,0.22-2.63,1.15-3.55c1.63-1.62,4.26-1.62,5.88,0   c1.6,1.6,1.64,4.15,0.08,5.79l-0.67,0.71L29.01,30.69z"/><path fill="none" d="M41.78,69.6l-0.57,3.32c-1.81-0.69-3.54-1.6-5.16-2.73c0.07-1.22,0.24-2.46,0.53-3.72   C38.17,67.77,39.92,68.82,41.78,69.6z"/><path d="M87.39,30.97c0,0,0,0,0.01,0c1.64,0,3.19-0.65,4.35-1.81c1.16-1.16,1.8-2.71,1.81-4.35c0-1.64-0.64-3.19-1.8-4.36   c-1.1-1.09-2.56-1.72-4.08-1.79c-0.07-1.52-0.7-2.98-1.79-4.07c-2.4-2.4-6.31-2.4-8.71,0c-2.14,2.14-2.39,5.42-0.73,7.83   l-6.46,6.45C65.76,21.9,58.23,17.61,50,17.61S34.24,21.9,30.01,28.87l-6.46-6.45c1.66-2.41,1.41-5.69-0.73-7.83   c-2.4-2.4-6.31-2.4-8.71,0c-1.09,1.09-1.73,2.55-1.79,4.07c-1.52,0.07-2.98,0.7-4.08,1.79c-1.16,1.17-1.8,2.72-1.8,4.36   S7.09,28,8.25,29.16c1.16,1.16,2.71,1.81,4.35,1.81h0.01c1.35,0,2.63-0.43,3.69-1.23l8.94,8.93H14.37c-1.66,0-3,1.35-3,3   c0,0.79,0.32,1.57,0.88,2.13c0.55,0.56,1.31,0.88,2.12,0.88h12.56c0.97,6.17,4.36,11.65,9.46,15.31l-11.2,11.2   c-2.41-1.66-5.69-1.41-7.83,0.73c-2.4,2.4-2.4,6.31,0,8.71c1.09,1.09,2.55,1.72,4.07,1.79c0.07,1.52,0.7,2.98,1.79,4.08   c1.17,1.16,2.71,1.8,4.35,1.8h0.01c1.64-0.01,3.19-0.65,4.35-1.82c1.16-1.15,1.81-2.7,1.81-4.34c0-1.35-0.43-2.64-1.23-3.7   l2.14-2.15c1.86,6.95,7.58,11.19,15.35,11.19s13.49-4.24,15.35-11.19l2.14,2.15c-0.8,1.06-1.23,2.35-1.23,3.7   c0,1.64,0.65,3.19,1.81,4.34c1.16,1.17,2.71,1.81,4.35,1.82c0,0,0,0,0.01,0c1.64,0,3.18-0.64,4.35-1.8   c1.09-1.1,1.72-2.56,1.79-4.08c1.52-0.07,2.98-0.7,4.07-1.79c2.4-2.4,2.4-6.31,0-8.71c-2.14-2.14-5.42-2.39-7.83-0.73l-11.2-11.2   c5.1-3.66,8.49-9.14,9.46-15.31h12.56c0.81,0,1.57-0.32,2.12-0.88c0.56-0.56,0.88-1.34,0.88-2.13c0-1.65-1.35-3-3-3H74.76   l8.94-8.93C84.76,30.54,86.04,30.97,87.39,30.97z M31.11,30.97C34.83,23.96,42.07,19.61,50,19.61s15.17,4.35,18.89,11.36   c0.15,0.29,0.28,0.6,0.42,0.89H30.69C30.83,31.57,30.95,31.26,31.11,30.97z M29.51,34.87c0.1-0.34,0.23-0.67,0.35-1.01h40.28   c0.12,0.34,0.25,0.67,0.35,1.01c0.07,0.25,0.13,0.51,0.2,0.77c0.1,0.43,0.21,0.85,0.29,1.28c0.06,0.28,0.09,0.57,0.14,0.86   c0.04,0.3,0.08,0.59,0.11,0.89H28.77c0.03-0.3,0.07-0.59,0.11-0.89c0.04-0.29,0.08-0.58,0.13-0.86c0.09-0.43,0.2-0.85,0.3-1.28   C29.38,35.38,29.44,35.12,29.51,34.87z M16.23,26.83l-0.69,0.92c-0.78,0.79-1.82,1.22-2.93,1.22c0,0,0,0-0.01,0   c-1.1,0-2.15-0.44-2.93-1.23H9.66c-0.78-0.78-1.22-1.82-1.22-2.93s0.43-2.16,1.22-2.94c0.93-0.94,2.26-1.37,3.56-1.16l1.36,0.22   l-0.21-1.37c-0.21-1.3,0.22-2.63,1.15-3.55c1.63-1.62,4.26-1.62,5.88,0c1.6,1.6,1.64,4.15,0.08,5.79l-0.67,0.71l8.2,8.18   c-0.03,0.06-0.05,0.11-0.08,0.17c-0.23,0.48-0.45,0.96-0.65,1.46c-0.01,0-0.01,0.01-0.01,0.02c-0.2,0.49-0.37,0.98-0.53,1.48   c-0.04,0.13-0.08,0.26-0.12,0.39c-0.13,0.44-0.26,0.9-0.37,1.35c-0.01,0.07-0.03,0.14-0.05,0.21c-0.12,0.52-0.21,1.05-0.29,1.58   c-0.01,0.04-0.02,0.08-0.03,0.13L16.23,26.83z M36.58,66.47c1.59,1.3,3.34,2.35,5.2,3.13l-0.57,3.32c-1.81-0.69-3.54-1.6-5.16-2.73   C36.12,68.97,36.29,67.73,36.58,66.47z M37.17,64.34c0.34-1.02,0.73-2.04,1.2-3.07c0.03,0.01,0.05,0.02,0.08,0.04   c0.53,0.3,1.08,0.58,1.64,0.84c0.13,0.06,0.25,0.12,0.38,0.18c0.58,0.25,1.16,0.5,1.76,0.7c0.21,0.08,0.43,0.14,0.64,0.21   l-0.74,4.32C40.34,66.76,38.67,65.68,37.17,64.34z M34.19,73.92l-4.58,4.58l0.91,0.7c0.79,0.78,1.22,1.83,1.22,2.93   c0,1.11-0.44,2.16-1.23,2.94c-0.78,0.79-1.82,1.22-2.93,1.23h-0.01c-1.1,0-2.15-0.44-2.94-1.22c-0.93-0.93-1.36-2.26-1.15-3.56   l0.22-1.37l-1.37,0.22c-1.3,0.21-2.63-0.22-3.55-1.15c-1.62-1.63-1.62-4.26,0-5.88c1.6-1.61,4.14-1.64,5.79-0.08l0.71,0.66l9.9-9.9   C34.11,67.43,33.77,70.79,34.19,73.92z M63.77,74.13c-0.55,3.5-2.15,6.34-4.53,8.3S53.7,85.48,50,85.48   c-7.39,0-12.66-4.35-13.77-11.35c-0.08-0.5-0.14-1.02-0.18-1.53c4.19,2.59,8.97,3.96,13.95,3.96s9.76-1.37,13.95-3.96   C63.91,73.11,63.85,73.63,63.77,74.13z M49,71.21v3.31c-2.01-0.08-3.98-0.4-5.87-0.95l0.56-3.27C45.4,70.83,47.18,71.13,49,71.21z    M44.03,68.3l0.78-4.52c0.12,0.03,0.24,0.05,0.36,0.08l0.06,0.01c0.03,0.01,0.07,0.01,0.11,0.02c0.48,0.1,0.97,0.18,1.46,0.25   c0,0,0.01,0,0.02,0c0.21,0.04,0.45,0.07,0.69,0.09c0.26,0.02,0.53,0.04,0.8,0.06c0.21,0.02,0.44,0.04,0.68,0.05H49v4.87   C47.29,69.12,45.63,68.82,44.03,68.3z M56.31,70.3l0.56,3.27c-1.9,0.55-3.86,0.87-5.87,0.95v-3.31   C52.82,71.13,54.6,70.83,56.31,70.3z M51,69.21v-4.87h0.01c0.24-0.01,0.47-0.03,0.68-0.05c0.27-0.02,0.54-0.04,0.8-0.06   c0.24-0.02,0.48-0.05,0.69-0.09c0.01,0,0.02,0,0.02,0c0.49-0.07,0.98-0.15,1.46-0.25c0.04-0.01,0.07-0.01,0.11-0.02l0.06-0.01   c0.12-0.03,0.24-0.05,0.36-0.08l0.78,4.52C54.37,68.82,52.71,69.12,51,69.21z M57.13,63.24c0.21-0.07,0.43-0.13,0.64-0.21   c0.6-0.2,1.18-0.45,1.76-0.7c0.12-0.06,0.25-0.12,0.38-0.18c0.56-0.26,1.11-0.54,1.64-0.84c0.03-0.02,0.05-0.03,0.08-0.04   c0.47,1.03,0.86,2.05,1.2,3.07c-1.5,1.34-3.17,2.42-4.96,3.22L57.13,63.24z M74.72,73.92l0.71-0.66c1.65-1.56,4.19-1.53,5.79,0.08   c1.62,1.62,1.62,4.25,0,5.88c-0.93,0.93-2.25,1.36-3.55,1.15l-1.37-0.22l0.22,1.37c0.21,1.3-0.22,2.63-1.16,3.56   c-0.78,0.78-1.83,1.22-2.93,1.22c-0.01,0-0.01,0-0.01,0c-1.11-0.01-2.15-0.44-2.93-1.23c-0.79-0.78-1.23-1.83-1.23-2.94   c0-1.1,0.43-2.15,1.22-2.93l0.91-0.7l-4.58-4.58c0.41-3.13,0.07-6.49-1-9.9L74.72,73.92z M63.95,70.19   c-1.62,1.13-3.35,2.04-5.16,2.73l-0.57-3.32c1.86-0.78,3.61-1.83,5.2-3.13C63.71,67.73,63.88,68.97,63.95,70.19z M61.51,59   c-3.45,2.21-7.48,3.31-11.51,3.31s-8.06-1.1-11.51-3.31c-5.09-3.27-8.53-8.44-9.54-14.32c0,0,10.52,0,21.05,0s21.05,0,21.05,0   C70.04,50.56,66.6,55.73,61.51,59z M85.63,40.67c0.55,0,1,0.45,1,1c0,0.26-0.11,0.52-0.31,0.72c-0.18,0.19-0.42,0.29-0.69,0.29   H14.37c-0.27,0-0.51-0.1-0.69-0.29c-0.2-0.2-0.31-0.46-0.31-0.72c0-0.55,0.45-1,1-1L50,40.68L85.63,40.67z M73.12,37.48   c-0.01-0.05-0.02-0.09-0.03-0.13c-0.08-0.53-0.18-1.06-0.29-1.58c-0.02-0.07-0.04-0.14-0.06-0.21c-0.1-0.45-0.23-0.91-0.36-1.35   c-0.04-0.13-0.08-0.26-0.12-0.39c-0.16-0.5-0.33-0.99-0.53-1.48c0-0.01-0.01-0.02-0.01-0.02c-0.2-0.5-0.42-0.98-0.65-1.46   c-0.03-0.06-0.05-0.11-0.08-0.17l8.2-8.18l-0.67-0.71c-1.56-1.64-1.53-4.19,0.08-5.79c1.62-1.62,4.25-1.62,5.88,0   c0.93,0.92,1.36,2.25,1.15,3.55l-0.22,1.37l1.37-0.22c1.3-0.21,2.63,0.22,3.56,1.16c0.79,0.78,1.22,1.83,1.22,2.94   s-0.44,2.15-1.23,2.93c-0.78,0.79-1.83,1.23-2.94,1.23s-2.15-0.43-2.93-1.22l-0.69-0.92L73.12,37.48z"/><ellipse transform="matrix(0.1602 -0.9871 0.9871 0.1602 -16.2248 83.57)" cx="41" cy="51.32" rx="5.9" ry="5.9"/><path d="M52.55,58.55c0,0.97-1.14,1.76-2.55,1.76s-2.55-0.79-2.55-1.76c0-0.98,1.14-1.77,2.55-1.77S52.55,57.57,52.55,58.55z"/><path d="M35.692,30.417c-0.151,0-0.306-0.035-0.45-0.107c-0.493-0.25-0.69-0.851-0.441-1.344c0.931-1.841,2.198-3.388,3.766-4.598   c0.436-0.337,1.064-0.256,1.402,0.181c0.337,0.437,0.257,1.065-0.181,1.402c-1.33,1.027-2.407,2.345-3.202,3.917   C36.41,30.216,36.058,30.417,35.692,30.417z"/><path d="M39.648,31.191c-0.087,0-0.175-0.012-0.264-0.036c-0.533-0.145-0.847-0.695-0.702-1.228   c0.425-1.558,1.182-2.933,2.25-4.086c0.375-0.405,1.008-0.43,1.414-0.054c0.405,0.375,0.429,1.008,0.054,1.414   c-0.859,0.927-1.444,1.991-1.788,3.253C40.491,30.898,40.088,31.191,39.648,31.191z"/><path d="M43.519,30.528c-0.117,0-0.235-0.021-0.351-0.064c-0.517-0.194-0.779-0.771-0.585-1.288c0.263-0.7,0.696-1.398,1.29-2.077   c0.364-0.416,0.997-0.457,1.411-0.095c0.416,0.364,0.458,0.995,0.095,1.411c-0.435,0.497-0.745,0.989-0.922,1.463   C44.304,30.28,43.923,30.528,43.519,30.528z"/></g>
    </svg>
  )

  if (compact) {
    return (
      <div
        className={cn(
          "border-2 border-dashed rounded-lg p-4 transition-all duration-200 relative overflow-hidden",
          isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50",
          disabled && "opacity-50 cursor-not-allowed",
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onMouseEnter={() => setIsHoveringIcon(true)}
        onMouseLeave={() => setIsHoveringIcon(false)}
      >
        <div className="absolute inset-0 bg-background/95 -z-10" />
        <div className="flex items-center justify-between gap-4 relative z-10">
          <div className="flex items-center gap-3">
            <div
              className="rounded-full bg-muted p-2 transition-all duration-300 cursor-pointer"
              onClick={handleButtonClick}
            >
              {isHoveringIcon || isDragging ? (
                contentType === "comic" ? (
                  <div className="h-4 w-4">
                    <BatmanIcon />
                  </div>
                ) : (
                  <div className="h-4 w-4">
                    <PirateHatIcon />
                  </div>
                )
              ) : (
                <Upload className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium">Add more files</p>
              <p className="text-xs text-muted-foreground">Drag & drop or click to browse</p>
            </div>
          </div>
          <Button onClick={handleButtonClick} disabled={disabled} size="sm" variant="outline">
            <FileUp className="mr-2 h-3 w-3" />
            Browse
          </Button>
        </div>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileInputChange}
          accept={acceptedTypes.join(",")}
          multiple
          className="hidden"
          disabled={disabled}
        />
      </div>
    )
  }

  return (
    <Card
      className={cn(
        "border-2 transition-all duration-200 relative overflow-hidden",
        isDragging ? "border-primary border-dashed scale-[1.01] shadow-md" : "border-input dark:border-input",
      )}
    >
      <CardContent className="p-6 relative z-10">
        <div
          className="flex flex-col items-center justify-center gap-4 py-8"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onMouseEnter={() => setIsHoveringIcon(true)}
          onMouseLeave={() => setIsHoveringIcon(false)}
        >
          <motion.div
            className="rounded-full bg-muted p-6 cursor-pointer"
            animate={{
              scale: isDragging ? 1.1 : 1,
            }}
            transition={{ type: "spring", stiffness: 300, damping: 15 }}
            onClick={handleButtonClick}
          >
            {isHoveringIcon || isDragging ? (
              contentType === "comic" ? (
                <BatmanIcon />
              ) : (
                <PirateHatIcon />
              )
            ) : (
              <Upload className="h-12 w-12 text-muted-foreground" />
            )}
          </motion.div>
          <div className="text-center">
            <p className="text-lg font-medium">{isDragging ? "Drop files here" : "Drag and drop your files here"}</p>
            <p className="text-sm text-muted-foreground mt-1">Supported formats: {acceptedTypes.join(", ")}</p>
            <p className="text-sm text-muted-foreground mt-1">Maximum {maxFiles} files at once</p>
            <p className="text-sm text-muted-foreground mt-1">
              Maximum file size: <span className="font-medium text-primary">{formatFileSize(maxFileSize)}</span>
            </p>
          </div>
          <Button onClick={handleButtonClick} disabled={disabled} className="mt-2" size="lg">
            <FileUp className="mr-2 h-4 w-4" />
            Choose files
          </Button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileInputChange}
            accept={acceptedTypes.join(",")}
            multiple
            className="hidden"
            disabled={disabled}
          />
        </div>
      </CardContent>
    </Card>
  )
}
