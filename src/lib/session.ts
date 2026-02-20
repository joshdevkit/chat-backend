import { EncryptJWT, jwtDecrypt } from 'jose'
import { v4 as uuidv4 } from 'uuid'

if (!process.env.SESSION_SECRET || Buffer.byteLength(process.env.SESSION_SECRET) < 32) {
    throw new Error('SESSION_SECRET must be at least 32 bytes')
}

const SECRET = new Uint8Array(
    Buffer.from(process.env.SESSION_SECRET.slice(0, 32))
)

const SESSION_EXPIRES_DAYS = parseInt(process.env.SESSION_EXPIRES_IN_DAYS || '7')

// ─── Revocation blocklist ────────────────────────────────────────────────────
// Swap this out for Redis in production:
// await redis.set(`revoked:${jti}`, '1', 'EX', SESSION_EXPIRES_DAYS * 86400)
// await redis.exists(`revoked:${jti}`)

const revokedJtis = new Set<string>()

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Session {
    userId: string
    jti: string
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function createSession(userId: string): Promise<{ token: string }> {
    const jti = uuidv4() // unique token ID — used for revocation

    const token = await new EncryptJWT({ userId })
        .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
        .setJti(jti)
        .setIssuedAt()
        .setExpirationTime(`${SESSION_EXPIRES_DAYS}d`)
        .encrypt(SECRET)

    return { token }
}

export async function validateSession(token: string): Promise<Session | null> {
    try {
        const { payload } = await jwtDecrypt(token, SECRET, {
            clockTolerance: 15, // seconds of leeway for clock skew
        })

        const userId = payload.userId
        const jti = payload.jti

        if (typeof userId !== 'string' || typeof jti !== 'string') return null

        // Check revocation blocklist
        if (revokedJtis.has(jti)) return null

        return { userId, jti }
    } catch {
        // Expired, tampered, or malformed
        return null
    }
}

export async function deleteSession(token: string): Promise<void> {
    try {
        // Decrypt without full validation so we can still revoke expired tokens
        const { payload } = await jwtDecrypt(token, SECRET, {
            clockTolerance: 15,
        })
        if (typeof payload.jti === 'string') {
            revokedJtis.add(payload.jti)
        }
    } catch {
        // Token already invalid — nothing to revoke
    }
}