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

// License key management
export const LICENSE_KEY_STORAGE_KEY = "mangaconverter_license_key";

export function getLicenseKey(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(LICENSE_KEY_STORAGE_KEY);
}

export function setLicenseKey(licenseKey: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LICENSE_KEY_STORAGE_KEY, licenseKey);
}

export async function fetchWithLicense(url: string, options: RequestInit = {}): Promise<Response> {
  // Helper to perform fetch with given license key
  const makeRequest = async (key: string | null) => {
    const headers = new Headers(options.headers || {});
    if (key) {
      headers.set('X-License-Key', key);
    }
    const updatedOptions = { ...options, headers };
    return fetch(url, updatedOptions);
  };

  // First attempt with existing key
  let licenseKey = getLicenseKey();
  let response = await makeRequest(licenseKey);
  // If unauthorized, refresh the license and retry once
  if (response.status === 401) {
    try {
      const newKey = await ensureLicenseKey(true);
      setLicenseKey(newKey);
      licenseKey = newKey;
      response = await makeRequest(licenseKey);
    } catch {
      // If refresh fails, return original 401 response
      return response;
    }
  }
  return response;
}

/**
 * Get an existing license key from localStorage or request a new one from /register
 * Only requests a new key if localStorage is empty
 */
/**
 * Ensure a license key is available.
 * @param force If true, always request a new license key from the server.
 * @param retries Number of retry attempts for server errors (default: 3)
 */
export async function ensureLicenseKey(force = false, retries = 3): Promise<string> {
  // This function should only be used in the browser
  if (typeof window === 'undefined') {
    throw new Error('ensureLicenseKey should only be called in browser context');
  }

  // Check localStorage first (unless forced)
  const existingKey = getLicenseKey();
  if (existingKey && !force) {
    // Only log on first use or debug mode - reduce log noise
    return existingKey;
  }
  log(force ? 'Forcing license key refresh' : 'No license key, requesting new one', { force });

  // Request a new license key with retry logic
  const registerUrl = new URL('/api/register', window.location.origin).toString();

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const url = `${registerUrl}?t=${Date.now()}`;
      log(`Registering license at URL (attempt ${attempt + 1}/${retries + 1})`, { url });

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
        throw new Error(`Failed to register for a license key: ${response.status}`);
      }

      const data = await response.json();
      if (!data.license_key) {
        throw new Error('No license key received from server');
      }

      setLicenseKey(data.license_key);
      log(`License key stored in localStorage`, { license_key: data.license_key });
      return data.license_key;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // If it's a network error and we have retries left, retry
      if (attempt < retries && (error instanceof TypeError || lastError.message.includes('500'))) {
        const waitTime = Math.pow(2, attempt) * 1000; // Exponential backoff
        log(`License registration error, retrying in ${waitTime}ms...`, {
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
  throw lastError || new Error('Failed to register for a license key after multiple attempts');
}