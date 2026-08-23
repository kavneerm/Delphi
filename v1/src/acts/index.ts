/**
 * The four acts, in scroll order. Each is a parameterisation of the same eight permanent
 * depth slots — never a separate scene (brief §3).
 */

import type { ActDefinition } from './types.ts';
import { ACT_I } from './i.ts';
import { ACT_II } from './ii.ts';
import { ACT_III } from './iii.ts';
import { ACT_IV } from './iv.ts';

export const ACTS: readonly ActDefinition[] = [ACT_I, ACT_II, ACT_III, ACT_IV];
