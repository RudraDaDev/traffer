/**
 * AUTO-GENERATED balance data — do not edit by hand.
 * Regenerate with: npm run sim -- --calibrate
 *
 * budget   starting funds (about 62% of the cheapest full connection, so the
 *          rest has to be earned from fares)
 * deliver  goal: ~92% of what the reference bot delivers in 240 s
 * parCost  2-star spend, parCommute 3-star average commute (seconds)
 */
import type { BalanceRow } from './balance-types';

export const BALANCE: Record<string, BalanceRow> = {
  'g1': { budget: 1700, deliver: 65, parCost: 1913, parCommute: 16 },
  'g2': { budget: 4600, deliver: 80, parCost: 5205, parCommute: 22 },
  'g3': { budget: 5350, deliver: 140, parCost: 7306, parCommute: 28 },
  'g4': { budget: 6300, deliver: 110, parCost: 8638, parCommute: 30 },
  'g5': { budget: 6025, deliver: 165, parCost: 9544, parCommute: 16 },
  'g6': { budget: 6850, deliver: 145, parCost: 9376, parCommute: 44 },
  'g7': { budget: 6875, deliver: 96, parCost: 10907, parCommute: 26 },
  'g8': { budget: 10325, deliver: 435, parCost: 16379, parCommute: 31 },
  'g9': { budget: 8375, deliver: 205, parCost: 15111, parCommute: 14 },
  'r1': { budget: 5675, deliver: 145, parCost: 7763, parCommute: 24 },
  'r2': { budget: 8575, deliver: 175, parCost: 11744, parCommute: 27 },
  'r3': { budget: 10025, deliver: 115, parCost: 15898, parCommute: 14 },
  'r4': { budget: 9900, deliver: 155, parCost: 15686, parCommute: 28 },
  'r5': { budget: 12850, deliver: 280, parCost: 17567, parCommute: 39 },
  'r6': { budget: 9250, deliver: 300, parCost: 14678, parCommute: 21 },
  'r7': { budget: 9200, deliver: 185, parCost: 16619, parCommute: 17 },
  'r8': { budget: 12525, deliver: 220, parCost: 22624, parCommute: 18 },
  'r9': { budget: 12425, deliver: 250, parCost: 22415, parCommute: 16 },
  'd1': { budget: 8150, deliver: 170, parCost: 12915, parCommute: 34 },
  'd2': { budget: 7100, deliver: 190, parCost: 12803, parCommute: 16 },
  'd3': { budget: 8400, deliver: 128, parCost: 15156, parCommute: 16 },
  'd4': { budget: 13800, deliver: 112, parCost: 21898, parCommute: 41 },
  'd5': { budget: 9850, deliver: 215, parCost: 17771, parCommute: 20 },
  'd6': { budget: 10625, deliver: 250, parCost: 19170, parCommute: 28 },
  'd7': { budget: 9750, deliver: 295, parCost: 17615, parCommute: 23 },
  'd8': { budget: 8800, deliver: 440, parCost: 17863, parCommute: 15 },
  'd9': { budget: 13425, deliver: 305, parCost: 27251, parCommute: 13 },
  'm1': { budget: 10650, deliver: 110, parCost: 16866, parCommute: 49 },
  'm2': { budget: 11275, deliver: 275, parCost: 20338, parCommute: 22 },
  'm3': { budget: 8500, deliver: 275, parCost: 15340, parCommute: 16 },
  'm4': { budget: 11075, deliver: 340, parCost: 19976, parCommute: 27 },
  'm5': { budget: 12725, deliver: 485, parCost: 25838, parCommute: 21 },
  'm6': { budget: 12300, deliver: 375, parCost: 24996, parCommute: 17 },
  'm7': { budget: 11775, deliver: 550, parCost: 23906, parCommute: 19 },
  'm8': { budget: 16875, deliver: 460, parCost: 34281, parCommute: 19 },
  'm9': { budget: 19300, deliver: 590, parCost: 39184, parCommute: 18 },
};
