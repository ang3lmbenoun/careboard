import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist/index.css'
import '@fontsource-variable/inter/index.css'
import '@fontsource-variable/manrope/index.css'
import '@fontsource-variable/dm-sans/index.css'
import '@fontsource-variable/plus-jakarta-sans/index.css'
import '@fontsource-variable/outfit/index.css'
import { applyAppearance } from './appearance'
import './index.css'
import App from './App.tsx'

applyAppearance()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
