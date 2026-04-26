
import 'dotenv/config';
import { describe, it, expect, vi } from 'vitest';

const runTests = process.env.runPrismaTests === 'true';

describe.skipIf(!runTests)('Prisma ORM Connection Test', () => {
    it('should successfully connect to the database and query the NewsletterBatch table', async () => {
        // Bypassing any global mocks if they exist
        vi.unmock('@/lib/database');
        const { prisma } = await import('@/lib/database');

        try {
            // This will throw if the connection fails or if the schema is out of sync
            const count = await prisma.newsletterBatch.count();
            
            console.log(`Prisma successfully connected! Found ${count} NewsletterBatch records.`);
            
            // We just expect it NOT to throw an error
            expect(typeof count).toBe('number');
            expect(count).toBeGreaterThanOrEqual(0);
        } catch (error) {
            console.error('Prisma connection failed in test:', error);
            throw error;
        }
    });

    it('should be able to perform a basic transaction (optional, just read for health check)', async () => {
        vi.unmock('@/lib/database');
        const { prisma } = await import('@/lib/database');

        const result = await prisma.$transaction(async (tx) => {
            return await tx.newsletterBatch.count();
        });
        
        expect(typeof result).toBe('number');
    });
});
