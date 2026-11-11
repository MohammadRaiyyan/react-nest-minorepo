import type { Prisma } from '@teamboard/db';

// What the users table needs to create a row. Only Auth builds this, after
// hashing. It stays inside the API: it is not a contract, it never goes on the wire.
export type NewUser = {
  email: string;
  name: string;
  passwordHash: string;
};

// The columns a client may see. An allow-list: a column added to the table
// later stays hidden until someone adds it here on purpose.
export const publicUserSelect = {
  id: true,
  email: true,
  name: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

// The type follows the select above, so the two can never disagree.
export type PublicUser = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;
