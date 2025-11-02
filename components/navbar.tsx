"use client"

import { cn } from "@/lib/utils"
import { BookOpenText, BookText, User } from "lucide-react"
import { useConverterMode } from "@/contexts/converter-mode-context"
import { SignInButton, SignUpButton, SignOutButton, useUser } from "@clerk/nextjs"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import Link from "next/link"
import { useState, useEffect } from "react"
import { removeSessionKey } from "@/lib/session"

export function Navbar() {
  const { mode, setMode } = useConverterMode()
  const { isSignedIn, user } = useUser()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const handleLogout = () => {
    // Clear session key from localStorage when logging out
    removeSessionKey()
    console.log("Session key cleared from localStorage on logout")
  }

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
    <nav className="flex items-center gap-4">
      <div className="flex items-center gap-2">
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
      </div>

      <div className="h-8 w-px bg-border" />

      <div className="flex items-center gap-2">
        {!mounted ? (
          // Show placeholder during SSR/hydration
          <div className="w-24 h-9" />
        ) : isSignedIn ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full">
                <User className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem asChild>
                <Link href="/account" className="cursor-pointer">
                  My Account
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <SignOutButton>
                  <button className="w-full text-left" onClick={handleLogout}>Logout</button>
                </SignOutButton>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <>
            <SignInButton mode="modal">
              <Button variant="ghost" size="sm">
                Login
              </Button>
            </SignInButton>
            <SignUpButton mode="modal">
              <Button size="sm">Sign Up</Button>
            </SignUpButton>
          </>
        )}
      </div>
    </nav>
  )
}
