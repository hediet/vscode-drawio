const assert = require('assert');
const {
  findDiagramBlocks,
  buildDiagramBlock,
  replaceDiagramBlock,
  createEmptyDiagram,
} = require('../../../out/inline-editor/diagramParser');

describe('DiagramParser', function ()
{
  describe('findDiagramBlocks', function ()
  {
    it('should find fenced code blocks', function ()
    {
      const md = 'Some text\n\n```drawio\n<mxfile>test</mxfile>\n```\n\nMore text';
      const blocks = findDiagramBlocks(md);
      assert.strictEqual(blocks.length, 1);
      assert.strictEqual(blocks[0].xml, '<mxfile>test</mxfile>');
      assert.strictEqual(blocks[0].format, 'fenced');
      assert.strictEqual(blocks[0].locked, false);
    });

    it('should find locked fenced code blocks', function ()
    {
      const md = '```drawio locked\n<mxfile>data</mxfile>\n```';
      const blocks = findDiagramBlocks(md);
      assert.strictEqual(blocks.length, 1);
      assert.strictEqual(blocks[0].locked, true);
      assert.strictEqual(blocks[0].xml, '<mxfile>data</mxfile>');
    });

    it('should find HTML comment blocks', function ()
    {
      const md = '<!-- drawio:start -->\n<mxfile>xml</mxfile>\n<!-- drawio:end -->';
      const blocks = findDiagramBlocks(md);
      assert.strictEqual(blocks.length, 1);
      assert.strictEqual(blocks[0].xml, '<mxfile>xml</mxfile>');
      assert.strictEqual(blocks[0].format, 'comment');
      assert.strictEqual(blocks[0].locked, false);
    });

    it('should find locked HTML comment blocks', function ()
    {
      const md = '<!-- drawio:start locked -->\n<mxfile>xml</mxfile>\n<!-- drawio:end -->';
      const blocks = findDiagramBlocks(md);
      assert.strictEqual(blocks.length, 1);
      assert.strictEqual(blocks[0].locked, true);
    });

    it('should find multiple blocks in order', function ()
    {
      const md = [
        '# Title',
        '',
        '```drawio',
        '<mxfile>first</mxfile>',
        '```',
        '',
        'Some text',
        '',
        '<!-- drawio:start -->',
        '<mxfile>second</mxfile>',
        '<!-- drawio:end -->',
      ].join('\n');

      const blocks = findDiagramBlocks(md);
      assert.strictEqual(blocks.length, 2);
      assert.strictEqual(blocks[0].xml, '<mxfile>first</mxfile>');
      assert.strictEqual(blocks[1].xml, '<mxfile>second</mxfile>');
      assert.ok(blocks[0].index < blocks[1].index);
    });

    it('should return empty array for no diagrams', function ()
    {
      const md = '# Just a heading\n\nSome text\n\n```javascript\nconsole.log("hi");\n```';
      const blocks = findDiagramBlocks(md);
      assert.strictEqual(blocks.length, 0);
    });

    it('should compute correct line numbers', function ()
    {
      const md = 'line 0\nline 1\n```drawio\n<mxfile/>\n```\nline 5';
      const blocks = findDiagramBlocks(md);
      assert.strictEqual(blocks.length, 1);
      assert.strictEqual(blocks[0].startLine, 2);
      assert.strictEqual(blocks[0].endLine, 4);
    });

    it('should handle multi-line XML content', function ()
    {
      const xml = '<mxfile>\n  <diagram>\n    <root/>\n  </diagram>\n</mxfile>';
      const md = '```drawio\n' + xml + '\n```';
      const blocks = findDiagramBlocks(md);
      assert.strictEqual(blocks.length, 1);
      assert.strictEqual(blocks[0].xml, xml);
    });

    it('should handle blocks with extra backticks', function ()
    {
      const md = '````drawio\n<mxfile/>\n````';
      const blocks = findDiagramBlocks(md);
      assert.strictEqual(blocks.length, 1);
    });

    it('should parse height=NNN attribute', function ()
    {
      const md = '```drawio height=500\n<mxfile/>\n```';
      const blocks = findDiagramBlocks(md);
      assert.strictEqual(blocks.length, 1);
      assert.strictEqual(blocks[0].height, 500);
      assert.strictEqual(blocks[0].locked, false);
    });

    it('should parse locked height=NNN (both attrs)', function ()
    {
      const md = '```drawio locked height=300\n<mxfile/>\n```';
      const blocks = findDiagramBlocks(md);
      assert.strictEqual(blocks.length, 1);
      assert.strictEqual(blocks[0].locked, true);
      assert.strictEqual(blocks[0].height, 300);
    });

    it('should parse height=NNN locked (reversed order)', function ()
    {
      const md = '```drawio height=300 locked\n<mxfile/>\n```';
      const blocks = findDiagramBlocks(md);
      assert.strictEqual(blocks.length, 1);
      assert.strictEqual(blocks[0].locked, true);
      assert.strictEqual(blocks[0].height, 300);
    });

    it('should clamp height below 20 to 20', function ()
    {
      const md = '```drawio height=5\n<mxfile/>\n```';
      const blocks = findDiagramBlocks(md);
      assert.strictEqual(blocks.length, 1);
      assert.strictEqual(blocks[0].height, 20);
    });

    it('should return null height when not specified', function ()
    {
      const md = '```drawio\n<mxfile/>\n```';
      const blocks = findDiagramBlocks(md);
      assert.strictEqual(blocks[0].height, null);
    });

    it('should return null height for comment blocks', function ()
    {
      const md = '<!-- drawio:start -->\n<mxfile/>\n<!-- drawio:end -->';
      const blocks = findDiagramBlocks(md);
      assert.strictEqual(blocks[0].height, null);
    });

    it('should parse width=NNN attribute', function ()
    {
      const md = '```drawio width=600\n<mxfile/>\n```';
      const blocks = findDiagramBlocks(md);
      assert.strictEqual(blocks.length, 1);
      assert.strictEqual(blocks[0].width, 600);
      assert.strictEqual(blocks[0].height, null);
    });

    it('should parse height and width together', function ()
    {
      const md = '```drawio height=400 width=600\n<mxfile/>\n```';
      const blocks = findDiagramBlocks(md);
      assert.strictEqual(blocks[0].height, 400);
      assert.strictEqual(blocks[0].width, 600);
    });

    it('should parse locked height width (all attrs)', function ()
    {
      const md = '```drawio locked height=300 width=500\n<mxfile/>\n```';
      const blocks = findDiagramBlocks(md);
      assert.strictEqual(blocks[0].locked, true);
      assert.strictEqual(blocks[0].height, 300);
      assert.strictEqual(blocks[0].width, 500);
    });

    it('should clamp width below 20 to 20', function ()
    {
      const md = '```drawio width=5\n<mxfile/>\n```';
      const blocks = findDiagramBlocks(md);
      assert.strictEqual(blocks[0].width, 20);
    });

    it('should return null width for comment blocks without attrs', function ()
    {
      const md = '<!-- drawio:start -->\n<mxfile/>\n<!-- drawio:end -->';
      const blocks = findDiagramBlocks(md);
      assert.strictEqual(blocks[0].width, null);
    });

    it('should parse width in comment blocks', function ()
    {
      const md = '<!-- drawio:start width=600 -->\n<mxfile/>\n<!-- drawio:end -->';
      const blocks = findDiagramBlocks(md);
      assert.strictEqual(blocks[0].width, 600);
    });

    it('should parse height in comment blocks', function ()
    {
      const md = '<!-- drawio:start height=400 -->\n<mxfile/>\n<!-- drawio:end -->';
      const blocks = findDiagramBlocks(md);
      assert.strictEqual(blocks[0].height, 400);
    });

    it('should parse locked height width in comment blocks', function ()
    {
      const md = '<!-- drawio:start locked height=300 width=500 -->\n<mxfile/>\n<!-- drawio:end -->';
      const blocks = findDiagramBlocks(md);
      assert.strictEqual(blocks[0].locked, true);
      assert.strictEqual(blocks[0].height, 300);
      assert.strictEqual(blocks[0].width, 500);
    });

    it('should return null width when not specified', function ()
    {
      const md = '```drawio\n<mxfile/>\n```';
      const blocks = findDiagramBlocks(md);
      assert.strictEqual(blocks[0].width, null);
    });

    it('should ignore drawio blocks nested inside tilde fences', function ()
    {
      const md = '~~~\n```drawio\n<mxfile>nested</mxfile>\n```\n~~~';
      const blocks = findDiagramBlocks(md);
      assert.strictEqual(blocks.length, 0);
    });

    it('should ignore drawio blocks nested inside longer backtick fences', function ()
    {
      const md = '````\n```drawio\n<mxfile>nested</mxfile>\n```\n````';
      const blocks = findDiagramBlocks(md);
      assert.strictEqual(blocks.length, 0);
    });

    it('should find drawio blocks that are not nested', function ()
    {
      const md = '~~~\nsome code\n~~~\n\n```drawio\n<mxfile>real</mxfile>\n```';
      const blocks = findDiagramBlocks(md);
      assert.strictEqual(blocks.length, 1);
      assert.strictEqual(blocks[0].xml, '<mxfile>real</mxfile>');
    });

    it('should ignore drawio inside tilde fence but find standalone ones', function ()
    {
      const md = [
        '~~~',
        '```drawio',
        '<mxfile>nested</mxfile>',
        '```',
        '~~~',
        '',
        '```drawio',
        '<mxfile>standalone</mxfile>',
        '```',
      ].join('\n');
      const blocks = findDiagramBlocks(md);
      assert.strictEqual(blocks.length, 1);
      assert.strictEqual(blocks[0].xml, '<mxfile>standalone</mxfile>');
    });

    it('should ignore comment blocks nested inside 3-backtick code fences', function ()
    {
      const md = [
        '```',
        '<!-- drawio:start locked -->',
        '<mxfile>nested</mxfile>',
        '<!-- drawio:end -->',
        '```',
      ].join('\n');
      const blocks = findDiagramBlocks(md);
      assert.strictEqual(blocks.length, 0);
    });

    it('should ignore comment blocks inside language-tagged code fences', function ()
    {
      const md = [
        '```markdown',
        '<!-- drawio:start -->',
        '<mxfile>nested</mxfile>',
        '<!-- drawio:end -->',
        '```',
      ].join('\n');
      const blocks = findDiagramBlocks(md);
      assert.strictEqual(blocks.length, 0);
    });

    it('should find comment blocks outside code fences', function ()
    {
      const md = [
        '```',
        'some code',
        '```',
        '',
        '<!-- drawio:start -->',
        '<mxfile>real</mxfile>',
        '<!-- drawio:end -->',
      ].join('\n');
      const blocks = findDiagramBlocks(md);
      assert.strictEqual(blocks.length, 1);
      assert.strictEqual(blocks[0].xml, '<mxfile>real</mxfile>');
    });
  });

  describe('buildDiagramBlock', function ()
  {
    it('should build fenced block', function ()
    {
      const result = buildDiagramBlock('<mxfile/>', 'fenced', false);
      assert.strictEqual(result, '```drawio\n<mxfile/>\n```');
    });

    it('should build locked fenced block', function ()
    {
      const result = buildDiagramBlock('<mxfile/>', 'fenced', true);
      assert.strictEqual(result, '```drawio locked\n<mxfile/>\n```');
    });

    it('should build comment block', function ()
    {
      const result = buildDiagramBlock('<mxfile/>', 'comment', false);
      assert.strictEqual(result, '<!-- drawio:start -->\n<mxfile/>\n<!-- drawio:end -->');
    });

    it('should build locked comment block', function ()
    {
      const result = buildDiagramBlock('<mxfile/>', 'comment', true);
      assert.strictEqual(result, '<!-- drawio:start locked -->\n<mxfile/>\n<!-- drawio:end -->');
    });

    it('should build fenced block with height', function ()
    {
      const result = buildDiagramBlock('<mxfile/>', 'fenced', false, 500);
      assert.strictEqual(result, '```drawio height=500\n<mxfile/>\n```');
    });

    it('should build fenced block with locked and height', function ()
    {
      const result = buildDiagramBlock('<mxfile/>', 'fenced', true, 400);
      assert.strictEqual(result, '```drawio locked height=400\n<mxfile/>\n```');
    });

    it('should build fenced block with null height (no attr)', function ()
    {
      const result = buildDiagramBlock('<mxfile/>', 'fenced', false, null);
      assert.strictEqual(result, '```drawio\n<mxfile/>\n```');
    });

    it('should ignore height below 20', function ()
    {
      const result = buildDiagramBlock('<mxfile/>', 'fenced', false, 10);
      assert.strictEqual(result, '```drawio\n<mxfile/>\n```');
    });

    it('should build comment block with height', function ()
    {
      const result = buildDiagramBlock('<mxfile/>', 'comment', false, 500);
      assert.strictEqual(result, '<!-- drawio:start height=500 -->\n<mxfile/>\n<!-- drawio:end -->');
    });

    it('should build fenced block with width', function ()
    {
      const result = buildDiagramBlock('<mxfile/>', 'fenced', false, null, 600);
      assert.strictEqual(result, '```drawio width=600\n<mxfile/>\n```');
    });

    it('should build fenced block with height and width', function ()
    {
      const result = buildDiagramBlock('<mxfile/>', 'fenced', false, 400, 600);
      assert.strictEqual(result, '```drawio height=400 width=600\n<mxfile/>\n```');
    });

    it('should build fenced block with locked, height and width', function ()
    {
      const result = buildDiagramBlock('<mxfile/>', 'fenced', true, 300, 500);
      assert.strictEqual(result, '```drawio locked height=300 width=500\n<mxfile/>\n```');
    });

    it('should ignore width below 20', function ()
    {
      const result = buildDiagramBlock('<mxfile/>', 'fenced', false, null, 10);
      assert.strictEqual(result, '```drawio\n<mxfile/>\n```');
    });

    it('should build comment block with width', function ()
    {
      const result = buildDiagramBlock('<mxfile/>', 'comment', false, null, 600);
      assert.strictEqual(result, '<!-- drawio:start width=600 -->\n<mxfile/>\n<!-- drawio:end -->');
    });

    it('should build comment block with locked, height and width', function ()
    {
      const result = buildDiagramBlock('<mxfile/>', 'comment', true, 300, 500);
      assert.strictEqual(result, '<!-- drawio:start locked height=300 width=500 -->\n<mxfile/>\n<!-- drawio:end -->');
    });
  });

  describe('replaceDiagramBlock', function ()
  {
    it('should replace XML in fenced block', function ()
    {
      const md = 'before\n\n```drawio\n<mxfile>old</mxfile>\n```\n\nafter';
      const blocks = findDiagramBlocks(md);
      const result = replaceDiagramBlock(md, blocks[0], '<mxfile>new</mxfile>');
      assert.ok(result.includes('<mxfile>new</mxfile>'));
      assert.ok(!result.includes('<mxfile>old</mxfile>'));
      assert.ok(result.includes('before'));
      assert.ok(result.includes('after'));
    });

    it('should replace XML in comment block', function ()
    {
      const md = 'before\n<!-- drawio:start -->\n<mxfile>old</mxfile>\n<!-- drawio:end -->\nafter';
      const blocks = findDiagramBlocks(md);
      const result = replaceDiagramBlock(md, blocks[0], '<mxfile>new</mxfile>');
      assert.ok(result.includes('<mxfile>new</mxfile>'));
      assert.ok(result.includes('before'));
      assert.ok(result.includes('after'));
    });

    it('should change lock state when specified', function ()
    {
      const md = '```drawio\n<mxfile/>\n```';
      const blocks = findDiagramBlocks(md);
      const result = replaceDiagramBlock(md, blocks[0], '<mxfile/>', true);
      assert.ok(result.includes('```drawio locked'));
    });

    it('should preserve lock state by default', function ()
    {
      const md = '```drawio locked\n<mxfile/>\n```';
      const blocks = findDiagramBlocks(md);
      const result = replaceDiagramBlock(md, blocks[0], '<mxfile>updated</mxfile>');
      assert.ok(result.includes('locked'));
    });

    it('should preserve height by default', function ()
    {
      const md = '```drawio height=500\n<mxfile/>\n```';
      const blocks = findDiagramBlocks(md);
      const result = replaceDiagramBlock(md, blocks[0], '<mxfile>new</mxfile>');
      assert.ok(result.includes('height=500'));
    });

    it('should update height when specified', function ()
    {
      const md = '```drawio height=500\n<mxfile/>\n```';
      const blocks = findDiagramBlocks(md);
      const result = replaceDiagramBlock(md, blocks[0], '<mxfile/>', undefined, 700);
      assert.ok(result.includes('height=700'));
    });

    it('should preserve both locked and height', function ()
    {
      const md = '```drawio locked height=400\n<mxfile/>\n```';
      const blocks = findDiagramBlocks(md);
      const result = replaceDiagramBlock(md, blocks[0], '<mxfile>new</mxfile>');
      assert.ok(result.includes('locked'));
      assert.ok(result.includes('height=400'));
    });

    it('should preserve width by default', function ()
    {
      const md = '```drawio width=600\n<mxfile/>\n```';
      const blocks = findDiagramBlocks(md);
      const result = replaceDiagramBlock(md, blocks[0], '<mxfile>new</mxfile>');
      assert.ok(result.includes('width=600'));
    });

    it('should update width when specified', function ()
    {
      const md = '```drawio width=600\n<mxfile/>\n```';
      const blocks = findDiagramBlocks(md);
      const result = replaceDiagramBlock(md, blocks[0], '<mxfile>new</mxfile>', undefined, undefined, 800);
      assert.ok(result.includes('width=800'));
      assert.ok(!result.includes('width=600'));
    });

    it('should preserve all attrs (locked, height, width)', function ()
    {
      const md = '```drawio locked height=400 width=600\n<mxfile/>\n```';
      const blocks = findDiagramBlocks(md);
      const result = replaceDiagramBlock(md, blocks[0], '<mxfile>new</mxfile>');
      assert.ok(result.includes('locked'));
      assert.ok(result.includes('height=400'));
      assert.ok(result.includes('width=600'));
    });
  });

  describe('createEmptyDiagram', function ()
  {
    it('should return valid mxfile XML', function ()
    {
      const xml = createEmptyDiagram();
      assert.ok(xml.includes('<mxfile>'));
      assert.ok(xml.includes('</mxfile>'));
      assert.ok(xml.includes('<diagram'));
      assert.ok(xml.includes('<mxGraphModel>'));
    });
  });
});
