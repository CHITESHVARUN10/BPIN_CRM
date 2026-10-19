import axios from 'axios'

// The API is always reached same-origin: locally through the Vite dev proxy,
// in production through the Vercel rewrite that proxies /api to the company
// backend. Same-origin keeps the session cookie first-party (required for
// Safari/iOS, which block all third-party cookies).
const API_BASE = '/api'

const client = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
})

client.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = error.config?.url || ''
    const skipAuthRedirect = error.config?.skipAuthRedirect === true
    if (error.response?.status === 401 && !skipAuthRedirect && !url.includes('/auth/login') && !url.includes('/auth/me')) {
      window.dispatchEvent(new Event('bpin:unauthorized'))
    }
    return Promise.reject(error)
  },
)

export default client
