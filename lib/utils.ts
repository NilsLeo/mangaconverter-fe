import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { log } from "./logger"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Function to generate a readable file size from bytes
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes"
  const k = 1024
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
}

// Session key management
export const LICENSE_KEY_STORAGE_KEY = "mangaconverter_session_key";

export function getSessionKey(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(LICENSE_KEY_STORAGE_KEY);
}

export function setSessionKey(sessionKey: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LICENSE_KEY_STORAGE_KEY, sessionKey);
}

export async function fetchWithLicense(
  url: string,
  options: RequestInit = {},
  clerkUserId?: string
): Promise<Response> {
  // Helper to perform fetch with given session key and optional Clerk user ID
  const makeRequest = async (key: string | null) => {
    const headers = new Headers(options.headers || {});
    if (key) {
      headers.set('X-Session-Key', key);
    }
    // Add Clerk user ID if authenticated
    if (clerkUserId) {
      headers.set('X-Clerk-User-Id', clerkUserId);
    }
    const updatedOptions = { ...options, headers };
    return fetch(url, updatedOptions);
  };

  // First attempt with existing key
  let sessionKey = getSessionKey();
  let response = await makeRequest(sessionKey);
  // If unauthorized, refresh the session and retry once
  if (response.status === 401) {
    try {
      const newKey = await ensureSessionKey(true);
      setSessionKey(newKey);
      sessionKey = newKey;
      response = await makeRequest(sessionKey);
    } catch {
      // If refresh fails, return original 401 response
      return response;
    }
  }
  return response;
}

/**
 * Get an existing session key from localStorage or request a new one from /register
 * Only requests a new key if localStorage is empty
 */
/**
 * Ensure a session key is available.
 * @param force If true, always request a new session key from the server.
 * @param retries Number of retry attempts for server errors (default: 3)
 */
export async function ensureSessionKey(force = false, retries = 3): Promise<string> {
  // This function should only be used in the browser
  if (typeof window === 'undefined') {
    throw new Error('ensureSessionKey should only be called in browser context');
  }

  // Check localStorage first (unless forced)
  const existingKey = getSessionKey();
  if (existingKey && !force) {
    // Only log on first use or debug mode - reduce log noise
    return existingKey;
  }
  log(force ? 'Forcing session key refresh' : 'No session key, requesting new one', { force });

  // Request a new session key with retry logic
  const registerUrl = new URL('/api/register', window.location.origin).toString();

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const url = `${registerUrl}?t=${Date.now()}`;
      log(`Registering session at URL (attempt ${attempt + 1}/${retries + 1})`, { url });

      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
          Expires: '0',
        },
      });

      if (!response.ok) {
        // If it's a 500 error and we have retries left, retry
        if (response.status >= 500 && attempt < retries) {
          const waitTime = Math.pow(2, attempt) * 1000; // Exponential backoff: 1s, 2s, 4s
          log(`Server error (${response.status}), retrying in ${waitTime}ms...`, { attempt, retries });
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
        throw new Error(`Failed to register for a session key: ${response.status}`);
      }

      const data = await response.json();
      if (!data.session_key) {
        throw new Error('No session key received from server');
      }

      setSessionKey(data.session_key);
      log(`Session key stored in localStorage`, { session_key: data.session_key });
      return data.session_key;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // If it's a network error and we have retries left, retry
      if (attempt < retries && (error instanceof TypeError || lastError.message.includes('500'))) {
        const waitTime = Math.pow(2, attempt) * 1000; // Exponential backoff
        log(`Session registration error, retrying in ${waitTime}ms...`, {
          error: lastError.message,
          attempt: attempt + 1,
          maxRetries: retries + 1
        });
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }

      // No more retries, throw the error
      throw lastError;
    }
  }

  // If we get here, all retries failed
  throw lastError || new Error('Failed to register for a session key after multiple attempts');
}