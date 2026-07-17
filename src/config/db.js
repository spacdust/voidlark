import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();
export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});
export const connectDB = async () => {
    try {
        const client = await pool.connect();
        console.log('✅ Berhasil terhubung ke PostgreSQL');
        client.release();
    }
    catch (error) {
        console.error('❌ Gagal terhubung ke PostgreSQL:', error);
        process.exit(1);
    }
};
