const assert = require('assert');
const { toggleLockAtLine, isLineLocked, setLockState } = require('../../../out/inline-editor/diagramLock');

describe('DiagramLock', function ()
{
  const unlocked = '# Doc\n\n```drawio\n<mxfile>data</mxfile>\n```\n\nEnd';
  const locked = '# Doc\n\n```drawio locked\n<mxfile>data</mxfile>\n```\n\nEnd';

  describe('toggleLockAtLine', function ()
  {
    it('should lock an unlocked block', function ()
    {
      const result = toggleLockAtLine(unlocked, 2);
      assert.ok(result);
      assert.strictEqual(result.locked, true);
      assert.ok(result.text.includes('```drawio locked'));
    });

    it('should unlock a locked block', function ()
    {
      const result = toggleLockAtLine(locked, 2);
      assert.ok(result);
      assert.strictEqual(result.locked, false);
      assert.ok(!result.text.includes('locked'));
    });

    it('should return null for lines outside a block', function ()
    {
      const result = toggleLockAtLine(unlocked, 0);
      assert.strictEqual(result, null);
    });

    it('should work on any line within the block', function ()
    {
      // line 3 is the XML content line
      const result = toggleLockAtLine(unlocked, 3);
      assert.ok(result);
      assert.strictEqual(result.locked, true);
    });

    it('should work on the closing line', function ()
    {
      const result = toggleLockAtLine(unlocked, 4);
      assert.ok(result);
      assert.strictEqual(result.locked, true);
    });
  });

  describe('isLineLocked', function ()
  {
    it('should return false for unlocked block', function ()
    {
      assert.strictEqual(isLineLocked(unlocked, 3), false);
    });

    it('should return true for locked block', function ()
    {
      assert.strictEqual(isLineLocked(locked, 3), true);
    });

    it('should return false for lines outside blocks', function ()
    {
      assert.strictEqual(isLineLocked(locked, 0), false);
      assert.strictEqual(isLineLocked(locked, 6), false);
    });
  });

  describe('setLockState', function ()
  {
    it('should lock a block by index', function ()
    {
      const result = setLockState(unlocked, 0, true);
      assert.ok(result.includes('```drawio locked'));
    });

    it('should unlock a block by index', function ()
    {
      const result = setLockState(locked, 0, false);
      assert.ok(!result.includes('locked'));
      assert.ok(result.includes('```drawio\n'));
    });

    it('should handle invalid index gracefully', function ()
    {
      const result = setLockState(unlocked, 5, true);
      assert.strictEqual(result, unlocked);
    });

    it('should work with HTML comment format', function ()
    {
      const commentMd = '<!-- drawio:start -->\n<mxfile/>\n<!-- drawio:end -->';
      const result = setLockState(commentMd, 0, true);
      assert.ok(result.includes('<!-- drawio:start locked -->'));
    });
  });

  describe('height preservation', function ()
  {
    it('should preserve height through lock toggle', function ()
    {
      const md = '# Doc\n\n```drawio height=500\n<mxfile>data</mxfile>\n```\n\nEnd';
      const result = toggleLockAtLine(md, 3);
      assert.ok(result);
      assert.strictEqual(result.locked, true);
      assert.ok(result.text.includes('locked'));
      assert.ok(result.text.includes('height=500'));
    });

    it('should preserve height through unlock toggle', function ()
    {
      const md = '# Doc\n\n```drawio locked height=400\n<mxfile>data</mxfile>\n```\n\nEnd';
      const result = toggleLockAtLine(md, 3);
      assert.ok(result);
      assert.strictEqual(result.locked, false);
      assert.ok(!result.text.includes('locked'));
      assert.ok(result.text.includes('height=400'));
    });

    it('should preserve height in setLockState', function ()
    {
      const md = '```drawio height=600\n<mxfile/>\n```';
      const result = setLockState(md, 0, true);
      assert.ok(result.includes('locked'));
      assert.ok(result.includes('height=600'));
    });

    it('should preserve width through lock toggle', function ()
    {
      const md = '```drawio width=600\n<mxfile/>\n```';
      const result = toggleLockAtLine(md, 0);
      assert.ok(result.text.includes('locked'));
      assert.ok(result.text.includes('width=600'));
    });

    it('should preserve height and width through lock toggle', function ()
    {
      const md = '```drawio height=400 width=600\n<mxfile/>\n```';
      const result = toggleLockAtLine(md, 0);
      assert.ok(result.text.includes('locked'));
      assert.ok(result.text.includes('height=400'));
      assert.ok(result.text.includes('width=600'));
    });
  });
});
