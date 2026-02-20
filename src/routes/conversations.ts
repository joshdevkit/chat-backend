import { Router, Response } from 'express'
import { requireAuth, AuthRequest } from '../middleware/auth'
import prisma from '../db'

const router = Router()


// GET /api/conversations
router.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const hides = await prisma.conversationHide.findMany({
            where: { userId: req.userId! },
            select: { conversationId: true, hiddenAt: true, visibleFrom: true }, // ← add visibleFrom
        })

        // only truly hidden = no visibleFrom set
        const trulyHidden = hides
            .filter((h) => !h.visibleFrom)
            .map((h) => h.conversationId)

        // restarted = has visibleFrom (user came back after deleting)
        const restarted = hides.filter((h) => !!h.visibleFrom)
        const restartedIds = restarted.map((h) => h.conversationId)

        const lastMessageInclude = {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' as const },
            take: 1,
            include: { sender: { select: { id: true, fullName: true } } },
        }

        // normal + restarted conversations (exclude only truly hidden)
        const conversations = await prisma.conversation.findMany({
            where: {
                participants: { some: { userId: req.userId! } },
                id: { notIn: trulyHidden }, // ← only exclude truly hidden
            },
            include: {
                participants: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                fullName: true,
                                lastSeenAt: true,
                                profile: { select: { username: true, avatarUrl: true } },
                            },
                        },
                    },
                },
                messages: lastMessageInclude,
            },
            orderBy: { createdAt: 'desc' },
        })

        // for restarted conversations, only show messages after visibleFrom in preview
        const visibleFromMap = new Map(restarted.map((h) => [h.conversationId, h.visibleFrom!]))

        const all = await Promise.all(
            conversations.map(async (conv) => {
                const visibleFrom = visibleFromMap.get(conv.id)

                // filter last message preview for restarted conversations
                let messages = conv.messages
                if (visibleFrom && conv.messages[0]) {
                    if (new Date(conv.messages[0].createdAt) < visibleFrom) {
                        messages = []
                    }
                }

                // count unread messages for current user
                const unreadCount = await prisma.message.count({
                    where: {
                        conversationId: conv.id,
                        senderId: { not: req.userId! },
                        deletedAt: null,
                        reads: { none: { userId: req.userId! } },
                        // respect visibleFrom for restarted conversations
                        ...(visibleFrom && { createdAt: { gte: visibleFrom } }),
                    },
                })

                return { ...conv, messages, unreadCount }
            })
        ).then((results) =>
            results.sort((a, b) => {
                const aTime = a.messages[0]?.createdAt ?? a.createdAt
                const bTime = b.messages[0]?.createdAt ?? b.createdAt
                return new Date(bTime).getTime() - new Date(aTime).getTime()
            })
        )

        res.json({ conversations: all })
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'Internal server error' })
    }
})


// POST /api/conversations/dm — create or get existing DM
router.post('/dm', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const { targetUserId } = req.body

        if (!targetUserId) {
            res.status(400).json({ error: 'targetUserId is required' })
            return
        }

        // check if DM already exists between these two users
        const existing = await prisma.conversation.findFirst({
            where: {
                isGroup: false,
                participants: { every: { userId: { in: [req.userId!, targetUserId] } } },
                AND: [
                    { participants: { some: { userId: req.userId } } },
                    { participants: { some: { userId: targetUserId } } },
                ],
            },
            include: {
                participants: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                fullName: true,
                                lastSeenAt: true,
                                profile: { select: { username: true, avatarUrl: true } },
                            },
                        },
                    },
                },
                messages: { take: 0 },
            },
        })

        if (existing) {
            const hideRecord = await prisma.conversationHide.findUnique({
                where: {
                    conversationId_userId: {
                        conversationId: existing.id,
                        userId: req.userId!,
                    },
                },
            })

            if (hideRecord) {
                // set visibleFrom = now so old messages stay hidden
                // but conversation reappears in list
                await prisma.conversationHide.update({
                    where: {
                        conversationId_userId: {
                            conversationId: existing.id,
                            userId: req.userId!,
                        },
                    },
                    data: {
                        visibleFrom: new Date(),
                    },
                })
            }
            // no hide record = normal conversation, do nothing

            res.json({ conversation: existing })
            return
        }
        // create new DM
        const conversation = await prisma.conversation.create({
            data: {
                isGroup: false,
                createdById: req.userId!,
                participants: {
                    create: [
                        { userId: req.userId! },
                        { userId: targetUserId },
                    ],
                },
            },
            include: {
                participants: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                fullName: true,
                                lastSeenAt: true,
                                profile: { select: { username: true, avatarUrl: true } },
                            },
                        },
                    },
                },
                messages: { take: 0 },
            },
        })

        res.status(201).json({ conversation })
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'Internal server error' })
    }
})


// PATCH /api/conversations/:conversationId/theme
router.patch('/:conversationId/theme', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const conversationId = req.params.conversationId as string
        const { bgColor, textColor } = req.body

        const theme = await prisma.conversationTheme.upsert({
            where: { conversationId },
            update: {
                ...(bgColor !== undefined && { bgColor }),
                ...(textColor !== undefined && { textColor }),
            },
            create: { conversationId, bgColor, textColor },
        })

        res.json({ theme })
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' })
    }
})

// GET /api/conversations/:conversationId/theme
router.get('/:conversationId/theme', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const conversationId = req.params.conversationId as string

        const theme = await prisma.conversationTheme.findUnique({
            where: { conversationId },
        })

        res.json({ theme })
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' })
    }
})

// POST /api/conversations/group — create group chat
router.post('/group', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const { name, memberIds } = req.body

        if (!name || !memberIds?.length) {
            res.status(400).json({ error: 'name and memberIds are required' })
            return
        }

        const allMembers = [...new Set([req.userId!, ...memberIds])]

        const conversation = await prisma.conversation.create({
            data: {
                name,
                isGroup: true,
                createdById: req.userId!,
                participants: {
                    create: allMembers.map((userId) => ({ userId })),
                },
            },
            include: {
                participants: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                fullName: true,
                                lastSeenAt: true,
                                profile: { select: { username: true, avatarUrl: true } },
                            },
                        },
                    },
                },
                messages: { take: 0 },
            },
        })

        res.status(201).json({ conversation })
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'Internal server error' })
    }
})

// GET /api/conversations/:conversationId
router.get('/:conversationId', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const conversationId = req.params.conversationId as string

        const participant = await prisma.participant.findUnique({
            where: { conversationId_userId: { conversationId, userId: req.userId! } },
        })
        if (!participant) {
            res.status(403).json({ error: 'Not a participant' })
            return
        }

        const conversation = await prisma.conversation.findUnique({
            where: { id: conversationId },
            include: {
                participants: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                fullName: true,
                                lastSeenAt: true,
                                profile: { select: { username: true, avatarUrl: true } },
                            },
                        },
                    },
                },
                messages: {
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                    include: { sender: { select: { id: true, fullName: true } } },
                },
            },
        })

        if (!conversation) {
            res.status(404).json({ error: 'Conversation not found' })
            return
        }

        res.json({ conversation })
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'Internal server error' })
    }
})


// DELETE /api/conversations/:conversationId
router.delete('/:conversationId', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const conversationId = req.params.conversationId as string

        const participant = await prisma.participant.findUnique({
            where: {
                conversationId_userId: {
                    conversationId,
                    userId: req.userId!,
                },
            },
        })

        if (!participant) {
            res.status(403).json({ error: 'Not a participant' })
            return
        }

        // upsert hide record — reset visibleFrom to null so it's truly hidden again
        await prisma.conversationHide.upsert({
            where: {
                conversationId_userId: {
                    conversationId,
                    userId: req.userId!,
                },
            },
            update: {
                hiddenAt: new Date(),
                visibleFrom: null,  // ← reset so it's truly hidden
            },
            create: {
                conversationId,
                userId: req.userId!,
                visibleFrom: null,
            },
        })

        res.json({ success: true })
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'Internal server error' })
    }
})


export default router