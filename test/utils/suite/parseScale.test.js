const assert = require('assert');
const { parseScale } = require('../../../out/utils/parseScale');

describe('parseScale', function ()
{
  it('parses a plain positive integer', function ()
  {
    assert.strictEqual(parseScale('2'), 2);
  });

  it('parses a positive decimal', function ()
  {
    assert.strictEqual(parseScale('1.5'), 1.5);
  });

  it('returns undefined for zero', function ()
  {
    assert.strictEqual(parseScale('0'), undefined);
  });

  it('returns undefined for negative numbers', function ()
  {
    assert.strictEqual(parseScale('-2'), undefined);
  });

  it('returns undefined for non-numeric input', function ()
  {
    assert.strictEqual(parseScale('abc'), undefined);
  });

  it('returns undefined for empty string', function ()
  {
    assert.strictEqual(parseScale(''), undefined);
  });

  it('returns undefined for whitespace-only input', function ()
  {
    assert.strictEqual(parseScale('   '), undefined);
  });
});
