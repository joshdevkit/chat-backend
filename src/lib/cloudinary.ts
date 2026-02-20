import { v2 as cloudinary } from 'cloudinary'
import multer from 'multer'

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
})

// store files in memory so we can stream to cloudinary
export const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
})

export async function uploadToCloudinary(
    buffer: Buffer,
    folder: string
): Promise<string> {
    return new Promise((resolve, reject) => {
        cloudinary.uploader
            .upload_stream(
                {
                    folder,
                    chunk_size: 6 * 1024 * 1024, // 6MB chunks
                    resource_type: 'auto',        // auto-detect image/video/raw
                },
                (error, result) => {
                    if (error || !result) return reject(error)
                    resolve(result.secure_url)
                }
            )
            .end(buffer)
    })
}
export default cloudinary