"use client"

import { BookOpenText } from "lucide-react"
import { cn } from "@/lib/utils"
import { useConverterMode } from "@/contexts/converter-mode-context"
import { useState, useEffect } from "react"
import { usePathname } from "next/navigation"

interface LogoProps {
  className?: string
  size?: "sm" | "md" | "lg"
}

export function Logo({ className, size = "md" }: LogoProps) {
  const { isComic } = useConverterMode()
  const [mounted, setMounted] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    setMounted(true)
  }, [])

  const sizes = {
    sm: "h-6 w-6",
    md: "h-8 w-8",
    lg: "h-10 w-10",
  }

  const IconComponent = BookOpenText

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="relative">
        <IconComponent className={cn("text-foreground", sizes[size])} />
        <div className="absolute inset-0 bg-foreground/20 blur-xl rounded-full -z-10" />
      </div>
      <span
        className={cn(
          "font-bold tracking-tight text-foreground",
          size === "sm" && "text-lg",
          size === "md" && "text-xl",
          size === "lg" && "text-2xl",
        )}
      >
        <span className="font-bungee">Comic</span>
        <span className="font-normal"> & </span>
        <span className="font-kosugi-maru">Manga本</span>
        <span className="font-normal"> Converter</span>
      </span>
    </div>
  )
}
