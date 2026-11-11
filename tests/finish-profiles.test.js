import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lookupCommand } from '../src/core/command.js';
import { parseLine } from '../src/asset/grammar.js';
import { readGlb } from '../src/asset/finish/glb.js';
import {
  GAME_TINT,
  PENDING_RULES,
  budgetCheck,
  carSourceCheck,
  drawCallCheck,
  guessType,
  profileSummary,
  resolveProfile
} from '../src/asset/finish/profiles.js';

describe('finish profiles', () => {
  it('opens FINISH without taking VEHICLE or surface finish', () => {
    expect(lookupCommand('FINISH').action).toBe('assetfinish');
    expect(lookupCommand('VEHICLE').action).toBe('assetvehicle');
    expect(lookupCommand('SF').tool).toBe('finish');
    expect(lookupCommand('SURF').tool).toBe('finish');
    expect(parseLine('FINISH').meta).toBe('finish');
    expect(parseLine('VEHICLE').meta).toBe('vehicle');
  });

  it('separates the car target from the ceiling', () => {
    const car = resolveProfile('CAR');
    const building = resolveProfile('BUILDING');
    const character = resolveProfile('CHARACTER');
    const prop = resolveProfile('PROP');
    expect(car.triangleTarget).toBe(30000);
    expect(car.triangleCeiling).toBe(40000);
    expect(car.lengthZ).toBe(4.5);
    expect(car.maxTexture).toBe(1024);
    expect(car.outputNodes).toEqual(['body', 'wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']);
    expect(car.drawCallTargetMin).toBe(5);
    expect(car.drawCallTargetMax).toBe(7);
    expect(car.drawCallCeiling).toBe(8);
    expect(building.triangleCeiling).toBe(8000);
    expect(character.triangleCeiling).toBe(15000);
    expect(character.pose).toBe('T');
    expect(prop.triangleCeiling).toBe(4000);
    expect(prop.maxTexture).toBe(512);
    expect(profileSummary(car)).toContain('30000');
    expect(profileSummary(car)).toContain('40000');
    expect(profileSummary(car)).not.toMatch(/rare/i);
    expect(profileSummary(car)).toMatch(/no material named paint or body/);
  });

  it('fails the budget only above the ceiling', () => {
    const car = resolveProfile('CAR');
    expect(budgetCheck(30000, car).pass).toBe(true);
    expect(budgetCheck(30000, car).overTarget).toBe(false);
    expect(budgetCheck(30001, car).pass).toBe(true);
    expect(budgetCheck(30001, car).overTarget).toBe(true);
    expect(budgetCheck(40000, car).pass).toBe(true);
    expect(budgetCheck(40001, car).pass).toBe(false);
    expect(budgetCheck(40001, car).action).toMatch(/Do not unlock a border/);
    expect(budgetCheck(8001, resolveProfile('BUILDING')).pass).toBe(false);
    expect(drawCallCheck(6, car).onTarget).toBe(true);
    expect(drawCallCheck(8, car).pass).toBe(true);
    expect(drawCallCheck(8, car).onTarget).toBe(false);
    expect(drawCallCheck(9, car).pass).toBe(false);
  });

  it('rejects a multi-material car source and does not call it READY', () => {
    const bytes = readFileSync('fixtures/vehicle/sedan-review.glb');
    const { json } = readGlb(bytes);
    const names = json.materials.map((material) => material.name || '');
    const check = carSourceCheck({
      materialNames: names,
      materialCount: names.length,
      imageCount: (json.images || []).length
    });
    expect(names).toContain('body_paint');
    expect(GAME_TINT.test('body_paint')).toBe(true);
    expect(GAME_TINT.test('atlas')).toBe(false);
    expect(check.ready).toBe(false);
    expect(check.unsupported).toBe(true);
    expect(check.detail.startsWith('NOT READY')).toBe(true);
    const single = carSourceCheck({ materialNames: ['atlas'], materialCount: 1, imageCount: 3 });
    expect(single.unsupported).toBe(false);
    expect(single.ready).toBe(false);
    expect(single.detail).toMatch(/not READY/);
    const tint = carSourceCheck({ materialNames: ['body'], materialCount: 1, imageCount: 1 });
    expect(tint.unsupported).toBe(true);
  });

  it('keeps wheel bleed and replaces open window fill with a mask', () => {
    expect(PENDING_RULES.implemented).toBe(false);
    expect(PENDING_RULES.bleed).toMatch(/does not cut triangles for glass/);
    expect(PENDING_RULES.bleed).toMatch(/after simplify/);
    expect(PENDING_RULES.windows).toMatch(/kitMask/);
    expect(PENDING_RULES.windows).toMatch(/emissiveFactor/);
    expect(PENDING_RULES.windows).toMatch(/8 px/);
    expect(PENDING_RULES.windows).not.toMatch(/open window fill/i);
    expect(PENDING_RULES.budgetFail).toMatch(/30000/);
    expect(PENDING_RULES.budgetFail).toMatch(/40000/);
    expect(PENDING_RULES.borderLock).toMatch(/along the loop/);
    expect(guessType([1.8, 1.4, 4.6]).id).toBe('CAR');
    expect(resolveProfile('CAR', { lengthZ: 4.9 }).lengthZ).toBe(4.9);
    expect(resolveProfile('BUILDING', { storeys: 3 }).heightY).toBe(12);
  });
});
