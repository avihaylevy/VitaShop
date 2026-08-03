import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './i18n'
import './index.css'
import App from './App.tsx'
import { SessionProvider } from './state/SessionContext'
import { CartProvider } from './state/CartContext'
import { FavouritesProvider } from './state/FavouritesContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <CartProvider>
          <FavouritesProvider>
            <App />
          </FavouritesProvider>
        </CartProvider>
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
)
