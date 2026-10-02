const assert = require('assert');
const { DrawioClient } = require('../../../out/DrawioClient/DrawioClient');

class FakeMessageStream
{
  constructor()
  {
    this.sentMessages = [];
    this.handler = null;
  }

  registerMessageHandler(handler)
  {
    this.handler = handler;
    return { dispose() {} };
  }

  sendMessage(message)
  {
    this.sentMessages.push(JSON.parse(message));
  }

  respondToLastAction(event)
  {
    this.handler(JSON.stringify(event));
  }
}

function createClient()
{
  const stream = new FakeMessageStream();
  const client = new DrawioClient(stream, async () => ({}), () => {});
  return { stream, client };
}

describe('DrawioClient', function ()
{
  describe('exportAsPngWithEmbeddedXml', function ()
  {
    it('sends the requested scale in the export action', async function ()
    {
      const { stream, client } = createClient();

      const resultPromise = client.exportAsPngWithEmbeddedXml(3);

      const sent = stream.sentMessages[stream.sentMessages.length - 1];
      assert.strictEqual(sent.action, 'export');
      assert.strictEqual(sent.format, 'xmlpng');
      assert.strictEqual(sent.scale, 3);

      stream.respondToLastAction({
        event: 'export',
        format: 'xmlpng',
        data: 'data:image/png;base64,AAAA',
        xml: '<mxfile/>',
      });
      await resultPromise;
    });

    it('omits scale when not specified', async function ()
    {
      const { stream, client } = createClient();

      const resultPromise = client.exportAsPngWithEmbeddedXml();

      const sent = stream.sentMessages[stream.sentMessages.length - 1];
      assert.strictEqual('scale' in sent, false);

      stream.respondToLastAction({
        event: 'export',
        format: 'xmlpng',
        data: 'data:image/png;base64,AAAA',
        xml: '<mxfile/>',
      });
      await resultPromise;
    });
  });

  describe('export', function ()
  {
    it('forwards scale through to the png export', async function ()
    {
      const { stream, client } = createClient();

      const resultPromise = client.export('diagram.png', 2);

      const sent = stream.sentMessages[stream.sentMessages.length - 1];
      assert.strictEqual(sent.scale, 2);

      stream.respondToLastAction({
        event: 'export',
        format: 'xmlpng',
        data: 'data:image/png;base64,AAAA',
        xml: '<mxfile/>',
      });
      await resultPromise;
    });
  });
});
