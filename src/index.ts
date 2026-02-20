import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import 'dotenv/config'
import authRouter from './routes/auth'
import usersRouter from './routes/users'
import conversationsRouter from './routes/conversations'
import messagesRouter from './routes/messages'
import multer from 'multer'

const app = express()
const PORT = process.env.PORT
const allowedOrigins = [
    process.env.CLIENT_URL,
];


// Middleware
app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error("Not allowed by CORS"));
        }
    },
    credentials: true,
}));

app.use(express.json())
app.use(cookieParser())


app.use('/api/auth', authRouter)
app.use('/api/users', usersRouter)
app.use('/api/conversations', conversationsRouter)
app.use('/api/messages', messagesRouter)

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok' })
})

app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            res.status(400).json({ error: 'File too large. Maximum size is 10MB.' })
            return
        }
        res.status(400).json({ error: err.message })
        return
    }
    next(err)
})

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`)
})

export default app