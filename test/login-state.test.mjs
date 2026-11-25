import test from 'node:test';
import assert from 'node:assert/strict';
import { hasLoggedInLocalStorage } from '../src/core.mjs';
const cms = 'https://magentacanvas.qa.oa.yo-digital.com';
test('accepts true on correct origin', () => {
  assert.equal(hasLoggedInLocalStorage({ origins: [{ origin: cms, localStorage: [{ name: 'isUserLoggedIn', value: 'true' }] }] }, cms), true);
});
test('rejects false, absent, and wrong-origin flags', () => {
  for (const origins of [[], [{ origin: cms, localStorage: [{ name: 'isUserLoggedIn', value: 'false' }] }], [{ origin: 'https://other.example', localStorage: [{ name: 'isUserLoggedIn', value: 'true' }] }]]) {
    assert.equal(hasLoggedInLocalStorage({ origins }, cms), false);
  }
});
