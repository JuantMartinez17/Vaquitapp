import bcrypt from 'bcrypt';

export const BCRYPT_COST = 12;

/**
 * bcrypt only reads the first 72 BYTES of its input and silently ignores the
 * rest. Registration enforces this limit so two different long passwords can
 * never hash to the same value.
 */
export const BCRYPT_MAX_PASSWORD_BYTES = 72;

/**
 * A valid cost-12 hash of a throwaway string. Login compares against it when
 * the email is unknown, so "no such user" costs the same bcrypt work as "wrong
 * password" and response time doesn't reveal which emails are registered.
 * Hardcoded because hashing at module load would add seconds to startup on
 * the 0.1 CPU instance; the unit test guards that it still matches BCRYPT_COST.
 */
export const DUMMY_PASSWORD_HASH = '$2b$12$StcQqUDrzfSnZd5Id5a2NeN3qEhC9gil3/CGSugVd5u4KzQwXRXRa';

export const hashPassword = (password: string): Promise<string> =>
  bcrypt.hash(password, BCRYPT_COST);

/** Compares against the user's hash, or the dummy one when there is no such user. */
export const verifyPassword = async (password: string, hash: string | null): Promise<boolean> => {
  const matches = await bcrypt.compare(password, hash ?? DUMMY_PASSWORD_HASH);
  return matches && hash !== null;
};
