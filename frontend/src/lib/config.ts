/**
 * Central API configuration.
 *
 * BACKEND_URL is empty in development — the Vite dev server proxies
 * every /api/* and /health request to http://localhost:8000 automatically.
 *
 * In production (GitHub Pages build), set the VITE_API_URL environment
 * variable to your deployed backend, e.g.:
 *   VITE_API_URL=https://edgecheck.onrender.com
 *
 * If VITE_API_URL is not set, the app still loads on GitHub Pages but all
 * backend-dependent features show an "offline" state.
 */
export const BACKEND_URL: string = (import.meta.env.VITE_API_URL as string) ?? ''
