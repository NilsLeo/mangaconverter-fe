"use client"

import { cn } from "@/lib/utils"
import { BookOpenText, BookText } from "lucide-react"
import { useConverterMode } from "@/contexts/converter-mode-context"

export function Navbar() {
  const { mode, setMode } = useConverterMode()

  const navItems = [
    {
      mode: "comic" as const,
      label: "Comic Converter",
      icon: BookOpenText,
      fontClass: "font-bungee tracking-wide",
      activeClass: "bg-yellow-500 text-black dark:bg-yellow-500 dark:text-black",
      inactiveClass: "text-foreground/70 hover:bg-muted hover:text-foreground",
    },
    {
      mode: "manga" as const,
      label: "Manga Converter",
      icon: BookText,
      fontClass: "font-kosugi-maru",
      activeClass: "bg-red-600 text-white dark:bg-red-600 dark:text-white",
      inactiveClass: "text-foreground/70 hover:bg-muted hover:text-foreground",
    },
  ]

  return (
    <nav className="flex items-center gap-1">
      {navItems.map((item) => {
        const Icon = item.icon
        const isActive = mode === item.mode
        return (
          <button
            key={item.mode}
            onClick={() => setMode(item.mode)}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors",
              item.fontClass,
              isActive ? item.activeClass : item.inactiveClass,
            )}
          >
            <Icon className="h-4 w-4" />
            <span className="hidden sm:inline">{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
