import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSegment, toNode } from '../src/core/criteria.js';

test('unknown node types are kept as raw, not dropped', () => {
  const n = toNode({ type: 'SomethingNew', foo: 1 });
  assert.equal(n.kind, 'raw');
  assert.equal(n.raw.foo, 1);
});

test('empty includeCriteria -> criteriaAvailable false', () => {
  const s = normalizeSegment({ apiName: 'X', includeCriteria: '' });
  assert.equal(s.criteriaAvailable, false);
  assert.equal(s.criteria, null);
});

test('HTML-entity encoded criteria are decoded', () => {
  const enc = JSON.stringify({ type: 'TextComparison', subject: { objectApiName: 'A__dlm', fieldApiName: 'B__c' }, operator: 'equal', values: ['x & y'] })
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const s = normalizeSegment({ apiName: 'X', includeCriteria: enc });
  assert.deepEqual(s.criteria.values, ['x & y']);
  assert.deepEqual(s.fieldRefs, [{ object: 'A__dlm', field: 'B__c' }]);
});
