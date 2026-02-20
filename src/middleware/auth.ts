import { Request, Response, NextFunction } from 'express'
import { validateSession } from '../lib/session'

export interface AuthRequest extends Request {
    userId?: string
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
    const token = req.cookies?.SERVER_COOKIE  // was session_token — bug fixed

    if (!token) {
        res.status(401).json({ error: 'Unauthorized' })
        return
    }

    const session = await validateSession(token)

    if (!session) {
        res.clearCookie('SERVER_COOKIE')
        res.status(401).json({ error: 'Session expired' })
        return
    }

    req.userId = session.userId
    next()
}