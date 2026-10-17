import axios from 'axios'

// Relative '/api' works with the Vite dev proxy and when the Express server
// serves the built app. Point VITE_API_URL at your backend (e.g.
// https://your-api.example.com/api) when the frontend is hosted separately (Vercel).
const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '')

const client = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
})

client.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = error.config?.url || ''
    if (error.response?.status === 401 && !url.includes('/auth/login') && !url.includes('/auth/me')) {
      window.dispatchEvent(new Event('bpin:unauthorized'))
    }
    return Promise.reject(error)
  },
)

export default client
