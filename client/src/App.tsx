import { Route, Routes } from 'react-router'
import { AppShell } from './components/layout/AppShell'
import { OverlayShowcase } from './components/dev/OverlayShowcase'
import { CatalogShowcase } from './components/dev/CatalogShowcase'
import { HomePage } from './pages/HomePage'
import { CatalogPage } from './pages/CatalogPage'
import { ProductDetailsPage } from './pages/ProductDetailsPage'
import { CartPage } from './components/cart'
import { CheckoutPage } from './pages/CheckoutPage'
import { AdminOrdersPage } from './pages/AdminOrdersPage'
import { RequireAuth } from './components/auth/RequireAuth'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { VerifyEmailPage } from './pages/VerifyEmailPage'
import { NotFoundPage } from './pages/NotFoundPage'

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
          MILESTONE-008 Checkpoint F2a — 🔴 THE FIRST ROUTE EVER WRAPPED IN
          `RequireAuth`. §8.2: checkout is authenticated-only, traceable to
          REQ-F-034, and the gate has shipped since MILESTONE-006 with nothing
          attached to it.

          ⚠️ The cart above stays OPEN, deliberately. The wall belongs on
          completing an order, never on browsing or filling a basket — the
          regression clause A10 names is the wall appearing where it should
          not.
        */}
        <Route
          path="/checkout"
          element={
            <RequireAuth>
              <CheckoutPage />
            </RequireAuth>
          }
        />
        {/*
          MILESTONE-008 Checkpoint F3 — ISSUE-083's remaining half.
          🔴 `RequireAuth` HERE IS UX, NOT SECURITY. It keeps a signed-out
          visitor from a page that could only 401, and nothing more: the role
          is read from the database on every request by `requireAdmin`
          (DEC-065), so a signed-in non-admin reaching this route is answered
          403 by the server and the screen says so honestly rather than
          pretending the page does not exist.
        */}
        <Route
          path="/admin/orders"
          element={
            <RequireAuth>
              <AdminOrdersPage />
            </RequireAuth>
          }
        />
        {/*
          MILESTONE-006 Checkpoint H — the auth forms.

          🔴 REQ-F-034 / clause A10: NONE of these gate anything above.
          Browsing, searching, filtering, product details and the cart are
          open to guests, and nothing in this milestone may put a login wall
          in front of them. `RequireAuth` exists for favourites and checkout,
          which are MILESTONE-007 and MILESTONE-008 — no route uses it yet,
          and a test asserts the guest routes stay reachable.

          🔴 /verify-email and /reset-password receive a plaintext token as a
          query parameter. Clause H1: both strip it from the address bar on
          mount — see lib/useUrlToken.ts.
        */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        {/*
          Dev-only. Vite substitutes `false` for import.meta.env.DEV in a
          production build, so this branch and the OverlayShowcase import
          above become dead code and are tree-shaken out — the route is not
          merely unreachable in production, the component is not shipped.
          Verified by grepping dist/.
        */}
        {import.meta.env.DEV && <Route path="/ui-showcase" element={<OverlayShowcase />} />}
        {import.meta.env.DEV && <Route path="/catalog-showcase" element={<CatalogShowcase />} />}
        {/*
          🔴 ISSUE-066 — the catch-all, and it must stay LAST: react-router
          ranks `*` below every literal path, but keeping it here means the
          file reads in match order too.

          Without it an unknown URL matched nothing and AppShell rendered its
          chrome around an empty page, which is indistinguishable from a store
          that failed to load. The three dead nav tabs that exposed this are
          gone; the gap was never about them.
        */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AppShell>
  )
}

export default App
