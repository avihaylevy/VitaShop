import { Router } from 'express'
import type { PrismaClient } from '@prisma/client'
import {
  createAdminDashboardRateLimiters,
  type AdminDashboardRateLimiters,
} from '../lib/rateLimit.js'
import { buildDashboard, parseDashboardRange } from '../lib/adminDashboard.js'
import { requireShopper } from './requireShopper.js'
import { createRequireAdmin } from './requireAdmin.js'

/**
 * DEC-101 — GET /api/admin/dashboard?days=7|30|90 (§4.7.4 / §1.6).
 *
 * 🔴 THE MIDDLEWARE ORDER IS THE CONTRACT (the adminOrders precedent,
 * verbatim): limiter → requireShopper (401) → requireAdmin (403, role read
 * PER REQUEST — DEC-065).
 *
 * 🔴 READ-ONLY. The route computes nothing itself and writes nothing —
 * every figure is `buildDashboard`'s, server-side per §3.4.
 */

export type AdminDashboardRouterDeps = {
  prisma: PrismaClient
  /** Injectable so tests can identify the limiter rather than count it. */
  rateLimiters?: AdminDashboardRateLimiters
}

export function createAdminDashboardRouter(deps: AdminDashboardRouterDeps): ReturnType<typeof Router> {
  const { prisma } = deps
  const limiters = deps.rateLimiters ?? createAdminDashboardRateLimiters()
  const requireAdmin = createRequireAdmin(prisma)
  const router = Router()

  router.get('/', limiters.read, requireShopper, requireAdmin, async (req, res) => {
    const rangeDays = parseDashboardRange(req.query.days)
    if (rangeDays === null) {
      res.status(400).json({
        error: { code: 'RANGE_INVALID', message: 'days must be 7, 30 or 90.' },
      })
      return
    }

    try {
      res.json(await buildDashboard(prisma, rangeDays))
    } catch (error) {
      console.error('[admin] building the dashboard failed', error)
      res.status(503).json({
        error: { code: 'DASHBOARD_UNAVAILABLE', message: 'Try again shortly.' },
      })
    }
  })

  return router
}
