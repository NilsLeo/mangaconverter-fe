"use client"

import { cn } from "@/lib/utils"
import { BookOpenText, BookText, User } from "lucide-react"
import { useConverterMode } from "@/contexts/converter-mode-context"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import Link from "next/link"
import { useState, useEffect } from "react"
import { removeSessionKey } from "@/lib/session"

const isClerkConfigured = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY

function ClerkAuthSection() {
  // Dynamically import Clerk components only when configured
  const [ClerkComponents, setClerkComponents] = useState<{
    SignInButton: any
    SignOutButton: any
    useUser: () => { isSignedIn: boolean; user: any }
  } | null>(null)

  useEffect(() => {
    if (isClerkConfigured) {
      import("@clerk/nextjs").then((mod) => {
        setClerkComponents({
          SignInButton: mod.SignInButton,
          SignOutButton: mod.SignOutButton,
          useUser: mod.useUser,
        })
      })
    }
  }, [])

  if (!isClerkConfigured || !ClerkComponents) {
    // Render placeholder when Clerk is not configured
    return (
      <Button variant="ghost" size="sm" disabled>
        Auth Disabled
      </Button>
    )
  }

  return <ClerkAuthContent ClerkComponents={ClerkComponents} />
}

function ClerkAuthContent({ ClerkComponents }: { ClerkComponents: any }) {
  const { SignInButton, SignOutButton, useUser } = ClerkComponents
  const { isSignedIn, user } = useUser()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const handleLogout = () => {
    removeSessionKey()
    console.log("Session key cleared from localStorage on logout")
  }

  if (!mounted) {
    return <div className="w-24 h-9" />
  }

  if (isSignedIn) {
    return (
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
              <button className="w-full text-left" onClick={handleLogout}>
                Logout
              </button>
            </SignOutButton>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <SignInButton mode="modal">
      <Button variant="ghost" size="sm">
        Login
      </Button>
    </SignInButton>
  )
}

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
        <ClerkAuthSection />
      </div>
    </nav>
  )
}
