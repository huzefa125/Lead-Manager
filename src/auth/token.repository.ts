import type { RefreshToken } from '@prisma/client';
import { prisma } from '../config/prisma';

/**
 * All refresh-token persistence. A row existing and not being expired IS the
 * token's validity — logout deletes the row, so there is no separate revoked
 * flag to forget to check.
 */

export interface CreateRefreshTokenInput {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string | undefined;
  ipAddress?: string | undefined;
}

export async function createRefreshToken(input: CreateRefreshTokenInput): Promise<RefreshToken> {
  return prisma.refreshToken.create({
    data: {
      id: input.id,
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      userAgent: input.userAgent ?? null,
      ipAddress: input.ipAddress ?? null,
    },
  });
}

export async function findRefreshTokenById(id: string): Promise<RefreshToken | null> {
  return prisma.refreshToken.findUnique({ where: { id } });
}

/**
 * Deletes one session. `deleteMany` rather than `delete` so a token that is
 * already gone is a no-op instead of a P2025 — logout must be idempotent.
 */
export async function deleteRefreshToken(id: string): Promise<boolean> {
  const result = await prisma.refreshToken.deleteMany({ where: { id } });
  return result.count > 0;
}

/**
 * Rotation, atomically: the presented token is deleted and its replacement
 * inserted in one transaction. A crash mid-way cannot leave the user holding
 * two live tokens or none at all.
 */
export async function rotateRefreshToken(
  oldTokenId: string,
  next: CreateRefreshTokenInput,
): Promise<RefreshToken> {
  const [, created] = await prisma.$transaction([
    prisma.refreshToken.deleteMany({ where: { id: oldTokenId } }),
    prisma.refreshToken.create({
      data: {
        id: next.id,
        userId: next.userId,
        tokenHash: next.tokenHash,
        expiresAt: next.expiresAt,
        userAgent: next.userAgent ?? null,
        ipAddress: next.ipAddress ?? null,
      },
    }),
  ]);
  return created;
}

/** Deletes every session for a user — "sign out everywhere". */
export async function deleteAllUserRefreshTokens(userId: string): Promise<number> {
  const result = await prisma.refreshToken.deleteMany({ where: { userId } });
  return result.count;
}

export async function countUserRefreshTokens(userId: string): Promise<number> {
  return prisma.refreshToken.count({ where: { userId } });
}

/**
 * Housekeeping for expired rows. Expired tokens are already rejected at
 * verification time; this just stops the table growing without bound.
 * Wire it to a cron / scheduled job.
 */
export async function deleteExpiredRefreshTokens(now: Date = new Date()): Promise<number> {
  const result = await prisma.refreshToken.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  return result.count;
}
