import test from 'node:test';
import assert from 'node:assert/strict';
import { isDataGraphDmo, isExcludedDmo } from '../src/core/util.js';

test('data graph system DMOs are recognized by name (names from the dev org)', () => {
  for (const n of [
    'Dg_1JsM_9pFNS0000001Dpm_FRAGMENT__dlm',
    'Dg_8eNn_9pFNS0000001Dpg_STATE__dlm',
    'Main_1790891771919_ID__dlm',
    'Main_1790891773012_VALUE__dlm',
    'DataGraphStateTable__dlm',
  ]) assert.ok(isDataGraphDmo(n), n);
});

test('regular, IR and segment membership DMOs are not mistaken for data graph DMOs', () => {
  for (const n of [
    'ssot__Individual__dlm', 'UnifiedIndividual__dlm', 'IndividualIdentityLink__dlm',
    'Order__dlm', 'Order_chunk__dlm', 'Individual_SM_1782474852049__dlm', 'Order_SMH_1777644621465__dlm',
    'My_Custom_ID__dlm', 'Dg_Custom__dlm',
  ]) assert.ok(!isDataGraphDmo(n), n);
});

test('exclusion combines category and data graph name rules', () => {
  assert.ok(isExcludedDmo({ name: 'Individual_SM_1782474852049__dlm', category: 'Segment_Membership' }));
  assert.ok(isExcludedDmo({ name: 'Main_1790891773012_VALUE__dlm', category: 'Profile' }));
  assert.ok(!isExcludedDmo({ name: 'ssot__Individual__dlm', category: 'Profile' }));
});
