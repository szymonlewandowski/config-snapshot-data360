import test from 'node:test';
import assert from 'node:assert/strict';
import { link } from '../src/core/link.js';

const model = { dmos: [{ name: 'A__dlm', fields: [{ name: 'Id__c' }] }] };

test('reports broken references only for modules present', () => {
  const activations = { activations: [{ name: 'act', subject: 'A__dlm', segment: 'S', fieldRefs: [{ object: 'A__dlm', field: 'Nope__c' }] }] };
  assert.deepEqual(link({ activations }), []); // no model, no segments: nothing to check against
  const codes = link({ model, activations, segments: { segments: [] } }).map((w) => w.code).sort();
  assert.deepEqual(codes, ['MISSING_FIELD', 'MISSING_SEGMENT']);
});

test('objects outside the snapshot are not reported', () => {
  const segments = { segments: [{ name: 's', fieldRefs: [{ object: 'Excluded__dlm', field: 'X__c' }] }] };
  assert.deepEqual(link({ model, segments }), []);
});

test('__cio references are checked against calculated insights', () => {
  const calculatedInsights = { calculatedInsights: [{ name: 'LTV__cio', dimensions: [{ name: 'id__c' }], measures: [{ name: 'ltv__c' }], fieldRefs: [] }] };
  const segments = { segments: [{ name: 's', fieldRefs: [{ object: 'LTV__cio', field: 'ltv__c' }, { object: 'LTV__cio', field: 'bad__c' }, { object: 'Gone__cio', field: 'x' }] }] };
  const codes = link({ calculatedInsights, segments }).map((w) => w.code).sort();
  assert.deepEqual(codes, ['MISSING_CI', 'MISSING_FIELD']);
});
