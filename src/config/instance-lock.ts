import fs from 'fs';
import path from 'path';

const LOCK_PATH = path.resolve('data/voidlark.lock');

const isPidAlive = (pid: number) => {
    if (!pid || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
};

export const acquireInstanceLock = () => {
    fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true });

    if (fs.existsSync(LOCK_PATH)) {
        const raw = fs.readFileSync(LOCK_PATH, 'utf-8').trim();
        const existingPid = Number(raw);
        if (isPidAlive(existingPid) && existingPid !== process.pid) {
            console.error(`⛔ Instance lain sudah jalan (PID ${existingPid}). Hentikan dulu, atau hapus ${LOCK_PATH} jika stale.`);
            process.exit(1);
        }
        try {
            fs.unlinkSync(LOCK_PATH);
        } catch {}
    }

    fs.writeFileSync(LOCK_PATH, `${process.pid}\n`, 'utf-8');

    const release = () => {
        try {
            if (fs.existsSync(LOCK_PATH) && Number(fs.readFileSync(LOCK_PATH, 'utf-8').trim()) === process.pid) {
                fs.unlinkSync(LOCK_PATH);
            }
        } catch {}
    };

    process.on('exit', release);
    return release;
};
