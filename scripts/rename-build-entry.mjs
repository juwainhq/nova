import { rename } from 'node:fs/promises';
import { resolve } from 'node:path';

await rename(resolve(process.cwd(), 'dist/index.dev.html'), resolve(process.cwd(), 'dist/index.html'));
