import { z } from 'zod';
import { MAX_PASSWORD_BYTES, passwordByteLength } from '../utils/password';

/**
 * Passwords are length-checked in bytes, not characters: bcrypt truncates at 72
 * bytes, and a password of emoji hits that limit at 18 characters.
 */
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .refine(
    (value) => passwordByteLength(value) <= MAX_PASSWORD_BYTES,
    `Password must not exceed ${MAX_PASSWORD_BYTES} bytes`,
  )
  .refine((value) => /[a-z]/.test(value), 'Password must contain a lowercase letter')
  .refine((value) => /[A-Z]/.test(value), 'Password must contain an uppercase letter')
  .refine((value) => /\d/.test(value), 'Password must contain a number');

const emailSchema = z
  .string()
  .trim()
  .min(1, 'Email is required')
  .max(254, 'Email is too long')
  .email('Must be a valid email address')
  .transform((value) => value.toLowerCase());

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(100).optional(),
  /**
   * Names the organization created for this account. Omitted, a personal one is
   * derived from the name or email.
   *
   * There is deliberately no way to join an existing organization here: an
   * unauthenticated request must not be able to insert itself into another
   * company's tenant. That is an authenticated, permission-gated operation.
   */
  organizationName: z.string().trim().min(2).max(100).optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  // Deliberately not `passwordSchema`: an existing password predating a policy
  // change must still be able to log in, and echoing policy rules on a failed
  // login leaks nothing useful.
  password: z.string().min(1, 'Password is required'),
});

/**
 * The refresh token normally arrives in an httpOnly cookie; the body field is
 * the fallback for non-browser clients.
 */
export const refreshSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

export const logoutSchema = refreshSchema;

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type LogoutInput = z.infer<typeof logoutSchema>;
