import { Router, Response } from 'express'
import { requireAuth, AuthRequest } from '../middleware/auth'
import prisma from '../db'
import { upload, uploadToCloudinary } from '../lib/cloudinary'

const router = Router()

// PATCH /api/messages/presence
router.patch('/presence', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        await prisma.user.update({
            where: { id: req.userId },
            data: { lastSeenAt: new Date() },
        })
        res.json({ ok: true })
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' })
    }
})
// POST /api/messages/:conversationId/typing
router.post('/:conversationId/typing', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const conversationId = req.params.conversationId as string
        const expiresAt = new Date(Date.now() + 5000) // bump to 5s

        await prisma.typingStatus.upsert({
            where: { conversationId_userId: { conversationId, userId: req.userId! } },
            update: { expiresAt },
            create: { conversationId, userId: req.userId!, expiresAt },
        })

        res.json({ ok: true })
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' })
    }
})

// GET /api/messages/:conversationId/typing
router.get('/:conversationId/typing', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const conversationId = req.params.conversationId as string

        const typingUsers = await prisma.typingStatus.findMany({
            where: {
                conversationId,
                userId: { not: req.userId },   // exclude self
                expiresAt: { gt: new Date() },  // only active
            },
            include: {
                // include user info so the client doesn't need to look them up
            }
        })
        res.json({ typingUsers: typingUsers.map((t) => t.userId) })
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' })
    }
})


// POST /api/messages/:messageId/react
router.post('/:messageId/react', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const messageId = req.params.messageId as string
        const { emoji } = req.body

        if (!emoji) {
            res.status(400).json({ error: 'emoji is required' })
            return
        }

        const existing = await prisma.messageReaction.findUnique({
            where: { messageId_userId_emoji: { messageId, userId: req.userId!, emoji } },
        })

        if (existing) {
            await prisma.messageReaction.delete({
                where: { messageId_userId_emoji: { messageId, userId: req.userId!, emoji } },
            })
            res.json({ removed: true })
        } else {
            await prisma.messageReaction.create({
                data: { messageId, userId: req.userId!, emoji },
            })
            res.json({ added: true })
        }
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' })
    }
})


// POST /api/messages/:messageId/hide
router.post('/:messageId/hide', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const messageId = req.params.messageId as string

        const message = await prisma.message.findUnique({
            where: { id: messageId },
        })

        if (!message) {
            res.status(404).json({ error: 'Message not found' })
            return
        }

        // prevent hiding your own message this way
        if (message.senderId === req.userId) {
            res.status(400).json({ error: 'Use delete for your own messages' })
            return
        }

        await prisma.messageHide.upsert({
            where: {
                messageId_userId: {
                    messageId,
                    userId: req.userId!,
                },
            },
            update: {},
            create: {
                messageId,
                userId: req.userId!,
            },
        })

        res.json({ success: true })
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'Internal server error' })
    }
})

router.delete('/:messageId', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const messageId = req.params.messageId as string

        const message = await prisma.message.findUnique({
            where: { id: messageId },
        })

        if (!message) {
            res.status(404).json({ error: 'Message not found' })
            return
        }

        // only sender can delete
        if (message.senderId !== req.userId) {
            res.status(403).json({ error: 'Not authorized' })
            return
        }

        await prisma.message.update({
            where: { id: messageId },
            data: { deletedAt: new Date() },
        })

        res.json({ success: true })
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'Internal server error' })
    }
})


// GET /api/messages/:conversationId
router.get('/:conversationId', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const conversationId = req.params.conversationId as string
        const cursor = req.query.cursor as string | undefined
        const limit = 30

        const participant = await prisma.participant.findUnique({
            where: { conversationId_userId: { conversationId, userId: req.userId! } },
        })
        if (!participant) {
            res.status(403).json({ error: 'Not a participant' })
            return
        }

        // check if this user has a hide record with visibleFrom
        const hideRecord = await prisma.conversationHide.findUnique({
            where: {
                conversationId_userId: {
                    conversationId,
                    userId: req.userId!,
                },
            },
        })

        const messages = await prisma.message.findMany({
            where: {
                conversationId,
                hides: {
                    none: { userId: req.userId! },
                },
                // only show messages after visibleFrom if set
                ...(hideRecord?.visibleFrom && {
                    createdAt: { gte: hideRecord.visibleFrom },
                }),
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
            ...(cursor && { cursor: { id: cursor }, skip: 1 }),
            include: {
                sender: {
                    select: {
                        id: true,
                        fullName: true,
                        profile: { select: { username: true, avatarUrl: true } },
                    },
                },
                reads: {
                    select: {
                        userId: true,
                        readAt: true,
                        user: {
                            select: {
                                fullName: true,
                                profile: { select: { avatarUrl: true } }
                            }
                        }
                    }
                },
                reactions: { select: { userId: true, emoji: true } },
            },
        })

        const unreadMessages = messages.filter(
            (m) => m.senderId !== req.userId && !m.reads.some((r: { userId: string }) => r.userId === req.userId)
        )

        if (unreadMessages.length > 0) {
            await prisma.messageRead.createMany({
                data: unreadMessages.map((m) => ({ messageId: m.id, userId: req.userId! })),
                skipDuplicates: true,
            })
        }
        res.json({
            messages: messages.reverse(),
            nextCursor: messages.length === limit ? messages[0].id : null,
        })
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'Internal server error' })
    }
})


// POST /api/messages/:conversationId
router.post('/:conversationId', requireAuth, upload.array('files', 10), async (req: AuthRequest, res: Response) => {
    try {
        const conversationId = req.params.conversationId as string
        const { content } = req.body
        const files = req.files as Express.Multer.File[]

        const participant = await prisma.participant.findUnique({
            where: { conversationId_userId: { conversationId, userId: req.userId! } },
        })
        if (!participant) {
            res.status(403).json({ error: 'Not a participant' })
            return
        }

        if (!content && (!files || files.length === 0)) {
            res.status(400).json({ error: 'Message content or file is required' })
            return
        }

        const messages = []
        const groupId = files?.length > 0 ? crypto.randomUUID() : undefined

        if (files && files.length > 0) {
            for (const file of files) {
                const fileUrl = await uploadToCloudinary(file.buffer, 'messages')
                const type = file.mimetype.startsWith('image/') ? 'IMAGE' : 'FILE'
                const message = await prisma.message.create({
                    data: {
                        conversationId,
                        senderId: req.userId!,
                        content: null,
                        type,
                        fileUrl,
                        fileName: file.originalname,
                        fileSize: file.size,
                        groupId,
                    },
                    include: {
                        sender: {
                            select: {
                                id: true,
                                fullName: true,
                                profile: { select: { username: true, avatarUrl: true } },
                            },
                        },
                        reads: { select: { userId: true, readAt: true } },
                        reactions: { select: { userId: true, emoji: true } },
                    },
                })
                messages.push(message)
            }
        }

        if (content?.trim()) {
            const message = await prisma.message.create({
                data: {
                    conversationId,
                    senderId: req.userId!,
                    content: content.trim(),
                    type: 'TEXT',
                    groupId,
                },
                include: {
                    sender: {
                        select: {
                            id: true,
                            fullName: true,
                            profile: { select: { username: true, avatarUrl: true } },
                        },
                    },
                    reads: { select: { userId: true, readAt: true } },
                    reactions: { select: { userId: true, emoji: true } },
                },
            })
            messages.push(message)
        }

        // if sender had hidden this conversation, set visibleFrom so old messages stay hidden
        await prisma.conversationHide.updateMany({
            where: {
                conversationId,
                userId: req.userId!,
                visibleFrom: null,
            },
            data: {
                visibleFrom: messages[0].createdAt,
            },
        })

        // for other participants who hid this conversation, set visibleFrom
        // so the conversation reappears for them but only shows new messages
        await prisma.conversationHide.updateMany({
            where: {
                conversationId,
                userId: { not: req.userId! },
                visibleFrom: null,
            },
            data: {
                visibleFrom: messages[0].createdAt,
            },
        })

        res.status(201).json({ messages })
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'Internal server error' })
    }
})


router.get('/:conversationId/attachments', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const { conversationId } = req.params as { conversationId: string }

        const participant = await prisma.participant.findUnique({
            where: { conversationId_userId: { conversationId, userId: req.userId! } },
        })
        if (!participant) { res.status(403).json({ error: 'Not a participant' }); return }

        const attachments = await prisma.message.findMany({
            where: {
                conversationId,
                type: { in: ['IMAGE', 'FILE'] },
                deletedAt: null,
                fileUrl: { not: null },
            },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                fileUrl: true,
                fileName: true,
                type: true,
                createdAt: true,
                sender: { select: { id: true, fullName: true } },
            },
        })

        res.json({ attachments })
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'Internal server error' })
    }
})



export default router