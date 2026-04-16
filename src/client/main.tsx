import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import RecentPage from './RecentPage'
import BookmarksPage from './BookmarksPage'
import './index.css'

const path = window.location.pathname

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {path === '/recent' ? <RecentPage /> : path === '/bookmarks' ? <BookmarksPage /> : <App />}
  </React.StrictMode>
)
