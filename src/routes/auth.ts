import { Router, Request, Response, CookieOptions } from 'express'
import bcrypt from 'bcryptjs'
import prisma from '../db'
import { createSession, deleteSession } from '../lib/session'
import { requireAuth, AuthRequest } from '../middleware/auth'

const router = Router()

const isProd = process.env.NODE_ENV === 'production'

const COOKIE_OPTIONS: CookieOptions = {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7,
}

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response) => {
    try {
        const { fullName, email, password } = req.body

        if (!fullName || !email || !password) {
            res.status(400).json({ error: 'All fields are required' })
            return
        }

        const existing = await prisma.user.findUnique({ where: { email } })
        if (existing) {
            res.status(409).json({ error: 'Email already in use' })
            return
        }

        const passwordHash = await bcrypt.hash(password, 12)

        const user = await prisma.user.create({
            data: { fullName, email, passwordHash },
        })

        const session = await createSession(user.id)
        res.cookie('SERVER_COOKIE', session.token, COOKIE_OPTIONS)

        res.status(201).json({
            user: { id: user.id, fullName: user.fullName, email: user.email },
        })
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'Internal server error' })
    }
})

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
    try {
        const { email, password } = req.body

        if (!email || !password) {
            res.status(400).json({ error: 'All fields are required' })
            return
        }

        const user = await prisma.user.findUnique({ where: { email }, include: { profile: true } })
        if (!user) {
            res.status(401).json({ error: 'Invalid credentials' })
            return
        }

        const valid = await bcrypt.compare(password, user.passwordHash)
        if (!valid) {
            res.status(401).json({ error: 'Invalid credentials' })
            return
        }

        const session = await createSession(user.id)
        res.cookie('SERVER_COOKIE', session.token, COOKIE_OPTIONS)

        res.json({
            user: {
                id: user.id,
                fullName: user.fullName,
                email: user.email,
                profile: user.profile,
            },
        })
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'Internal server error' })
    }
})

// POST /api/auth/logout
router.post('/logout', requireAuth, async (req: AuthRequest, res: Response) => {
    const token = req.cookies?.SERVER_COOKIE
    await deleteSession(token)
    res.clearCookie('SERVER_COOKIE')
    res.json({ message: 'Logged out' })
})

// GET /api/auth/me
router.get('/me', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.userId },
            include: { profile: true },
        })
        res.json({ user })
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' })
    }
})

export default router