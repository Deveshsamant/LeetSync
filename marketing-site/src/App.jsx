import React from 'react'
import Hero from './components/Hero'
import Features from './components/Features'
import CTA from './components/CTA'

function App() {
  return (
    <div className="app-container">
      <Hero />
      <Features />
      <CTA />
      
      <footer style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
        <p>© 2026 LeetSync. Built for developers.</p>
      </footer>
    </div>
  )
}

export default App
