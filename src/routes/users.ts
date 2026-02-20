import { Router, Response } from 'express'
import { requireAuth, AuthRequest } from '../middleware/auth'
import prisma from '../db'
import { upload, uploadToCloudinary } from '../lib/cloudinary'

const router = Router()

router.get('/search', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const q = req.query.q as string
        if (!q) {
            res.status(400).json({ error: 'Query is required' })
            return
        }

        const users = await prisma.user.findMany({
            where: {
                id: { not: req.userId },
                OR: [
                    { fullName: { contains: q, mode: 'insensitive' } },
                    { profile: { username: { contains: q, mode: 'insensitive' } } },
                ],
            },
            select: {
                id: true,
                fullName: true,
                lastSeenAt: true,
                profile: { select: { username: true, avatarUrl: true } },
            },
            take: 10,
        })

        res.json({ users })
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'Internal server error' })
    }
})

// POST /api/users/onboarding  ← must be BEFORE /:userId
router.post('/onboarding', requireAuth, upload.single('avatar'), async (req: AuthRequest, res: Response) => {
    try {
        const { username, bio, dateOfBirth } = req.body

        if (!username) {
            res.status(400).json({ error: 'Username is required' })
            return
        }

        const existing = await prisma.userProfile.findUnique({ where: { username } })
        if (existing) {
            res.status(409).json({ error: 'Username already taken' })
            return
        }

        let avatarUrl: string | undefined
        if (req.file) {
            avatarUrl = await uploadToCloudinary(req.file.buffer, 'avatars')
        }

        const profile = await prisma.userProfile.create({
            data: {
                userId: req.userId!,
                username,
                bio: bio || null,
                dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
                avatarUrl: avatarUrl || null,
            },
        })

        res.status(201).json({ profile })
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'Internal server error' })
    }
})

router.get('/:userId', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.params.userId as string

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                fullName: true,
                lastSeenAt: true,
                profile: {
                    select: {
                        username: true,
                        bio: true,
                        avatarUrl: true,
                        dateOfBirth: true,
                    },
                },
            },
        })

        if (!user) {
            res.status(404).json({ error: 'User not found' })
            return
        }

        res.json({ user })
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'Internal server error' })
    }
})


// PATCH /api/users/profile
router.patch('/profile', requireAuth, upload.single('avatar'), async (req: AuthRequest, res: Response) => {
    try {
        const { fullName, bio, dateOfBirth } = req.body

        // update fullName on User
        if (fullName) {
            await prisma.user.update({
                where: { id: req.userId! },
                data: { fullName },
            })
        }

        let avatarUrl: string | undefined
        if (req.file) {
            avatarUrl = await uploadToCloudinary(req.file.buffer, 'avatars')
        }

        const profile = await prisma.userProfile.upsert({
            where: { userId: req.userId! },
            update: {
                bio: bio ?? undefined,
                dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
                ...(avatarUrl && { avatarUrl }),
            },
            create: {
                userId: req.userId!,
                username: `user_${req.userId!.slice(0, 8)}`,
                bio: bio || null,
                dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
                avatarUrl: avatarUrl || null,
            },
        })

        res.json({ profile })
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'Internal server error' })
    }
})

export default router