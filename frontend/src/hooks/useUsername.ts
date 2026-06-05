/**
 * useUsername — manages the simulator username stored in localStorage.
 * Returns { username, setUsername, isReady }.
 * isReady is false until localStorage has been checked (avoids SSR flicker).
 */
import { useState, useEffect } from 'react'
import { upsertMe } from '../lib/simApi'

export const MS_USERNAME_KEY = 'ms_username'

export function useUsername() {
  const [username, setUsernameState] = useState<string>('')
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(MS_USERNAME_KEY) || ''
    setUsernameState(stored)
    setIsReady(true)
  }, [])

  function setUsername(name: string) {
    const trimmed = name.trim()
    localStorage.setItem(MS_USERNAME_KEY, trimmed)
    setUsernameState(trimmed)
    if (trimmed) {
      upsertMe(trimmed).catch(() => {/* backend registers the user; ignore network error */})
    }
  }

  return { username, setUsername, isReady }
}
