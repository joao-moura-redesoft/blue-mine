import { describe, it, expect } from 'vitest';
import { looksDeadRoom } from './ncAccount.js';

const UUID = 'DC80B7E9-1F7F-4064-B1A5-33A4B00BFBF7';

describe('looksDeadRoom', () => {
  it('sala 1:1 com nome de gente = conta viva', () => {
    expect(looksDeadRoom(UUID, 'Nohan Silva')).toBe(false);
  });

  it('nome igual ao próprio id = conta que não existe mais', () => {
    expect(looksDeadRoom(UUID, UUID)).toBe(true);
    expect(looksDeadRoom(UUID, UUID.toLowerCase())).toBe(true);
    expect(looksDeadRoom(UUID, ` ${UUID} `)).toBe(true);
  });

  it('sem nome nenhum também conta como morta', () => {
    expect(looksDeadRoom(UUID, '')).toBe(true);
    expect(looksDeadRoom(UUID, '   ')).toBe(true);
    expect(looksDeadRoom(UUID, null)).toBe(true);
    expect(looksDeadRoom(UUID, undefined)).toBe(true);
  });

  it('não confunde nome que apenas contém o id', () => {
    expect(looksDeadRoom(UUID, `Conta ${UUID}`)).toBe(false);
  });
});
