import { Route, Routes } from 'react-router'
import { AppShell } from './components/layout/AppShell'
import { OverlayShowcase } from './components/dev/OverlayShowcase'
import { CatalogShowcase } from './components/dev/CatalogShowcase'
import { HomePage } from './pages/HomePage'
import { CatalogPage } from './pages/CatalogPage'
import { ProductDetailsPage } from './pages/ProductDetailsPage'
import { CartPage } from './components/cart'

function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/catalog" element={<CatalogPage />} />
        {/*
          MILESTONE-005 Checkpoint J (§7) — the route `ProductCard` has been
          linking to since Slice 6 while nothing declared it (C8 /
          ISSUE-033). Slug-keyed, per DEC-033: `Product.id` is never a route
          identifier (§7b). This is the ONE documented exception to the
          milestone's standing forbidden set for `App.tsx`.
        */}
        <Route path="/product/:slug" element={<ProductDetailsPage />} />
        <Route path="/cart" element={<CartPage />} />
        {/*
          Dev-only. Vite substitutes `false` for import.meta.env.DEV in a
          production build, so this branch and the OverlayShowcase import
          above become dead code and are tree-shaken out — the route is not
          merely unreachable in production, the component is not shipped.
          Verified by grepping dist/.
        */}
        {import.meta.env.DEV && <Route path="/ui-showcase" element={<OverlayShowcase />} />}
        {import.meta.env.DEV && <Route path="/catalog-showcase" element={<CatalogShowcase />} />}
      </Routes>
    </AppShell>
  )
}

export default App
