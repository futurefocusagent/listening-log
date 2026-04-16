import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import RecentPage from './RecentPage'
import './index.css'

const path = window.location.pathname

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {path === '/recent' ? <RecentPage /> : <App />}
  </React.StrictMode>
)
