import { BadRequestException } from '@nestjs/common';
import {  decodeCursor, encodeCursor } from './cursor.ts';

const t = (iso: string) => new Date(iso);
const ID_A = '00000000-0000-4000-8000-00000000000a';



describe('cursor encoding', () => {
  it('round-trips a position', () => {
    const position = { createdAt: t('2026-11-08T10:00:00.000Z'), id: ID_A };
    expect(decodeCursor(encodeCursor(position))).toEqual({
      createdAt: '2026-11-08T10:00:00.000Z',
      id: ID_A,
    });
  });

  it('keeps only createdAt and id, even when given a whole task', () => {
    const task = { createdAt: t('2026-11-08T10:00:00.000Z'), id: ID_A, title: 'Secret plan' };
    const json = Buffer.from(encodeCursor(task), 'base64url').toString('utf8');
    expect(json).not.toContain('Secret plan');
  });

  it('rejects garbage with a 400', () => {
    expect(() => decodeCursor('garbage!!')).toThrow(BadRequestException);
  });
});
