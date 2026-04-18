import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import RecentPage from './RecentPage'
import BookmarksPage from './BookmarksPage'
import Layout from './Layout'
import './index.css'

const path = window.location.pathname

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Layout>
      {path === '/recent' ? (
        <RecentPage />
      ) : path === '/bookmarks' ? (
        <BookmarksPage />
      ) : (
        <App />
      )}
    </Layout>
  </React.StrictMode>
)
