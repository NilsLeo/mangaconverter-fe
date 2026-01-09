"use client"

import { cn } from "@/lib/utils"
import { useConverterMode } from "@/contexts/converter-mode-context"
import { useState, useEffect } from "react"

interface LogoProps {
  className?: string
  size?: "sm" | "md" | "lg"
}

export function Logo({ className, size = "md" }: LogoProps) {
  const { isComic } = useConverterMode()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const sizes = {
    sm: "h-5 w-5",
    md: "h-7 w-7",
    lg: "h-9 w-9",
  }

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="relative flex-shrink-0">
        <svg className={cn(sizes[size])} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="32" height="32" rx="6" className="fill-theme-medium" />
          <path
            d="M16 9.5v13M21.5 16h2.5M21.5 12h2.5M6 24a1.5 1.5 0 0 1-1.5-1.5V9.5A1.5 1.5 0 0 1 6 8h6.5a4 4 0 0 1 4 4 4 4 0 0 1 4-4H27a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 27 24h-7.5a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M10 16h2.5M10 12h2.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="absolute inset-0 bg-theme-medium/30 blur-lg rounded-lg -z-10" />
      </div>
      <span
        className={cn(
          "font-bold tracking-tight bg-gradient-to-r from-theme-medium via-theme-light to-theme-medium bg-clip-text text-transparent",
          size === "sm" && "text-base",
          size === "md" && "text-lg",
          size === "lg" && "text-xl",
        )}
      >
        Converter
      </span>
    </div>
  )
}
