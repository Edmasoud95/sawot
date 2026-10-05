import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { thumbnailUrl, registerLinkThumbnailRoute } from '../src/linkThumbnail.js';

test('extracts OG and Twitter images and resolves relative URLs', () => {
  assert.equal(thumbnailUrl('<meta content="/cover.jpg?a=1&amp;b=2" property="og:image">', 'https://example.com/post'), 'https://example.com/cover.jpg?a=1&b=2');
  assert.equal(thumbnailUrl("<meta name='twitter:image' content='https://cdn.example.com/a.png'>", 'https://example.com'), 'https://cdn.example.com/a.png');
  assert.equal(thumbnailUrl('<meta property="og:image" content="javascript:alert(1)">', 'https://example.com'), null);
  assert.equal(thumbnailUrl('<title>No image</title>', 'https://example.com'), null);
});

test('serves raster images and reuses cached results', async () => {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    const page = url.endsWith('/page');
    return { finalUrl: url, mediaType: page ? 'text/html' : 'image/png', close() {},
      body: (async function* () { yield Buffer.from(page ? '<meta property="og:image" content="/cover.png">' : 'image fixture'); })() };
  };
  const app = Fastify();
  registerLinkThumbnailRoute(app, fetcher as any);
  const url = '/api/chat/link-thumbnail?url=' + encodeURIComponent('https://example.com/page');
  assert.equal((await app.inject(url)).headers['content-type'], 'image/png');
  assert.equal((await app.inject(url)).statusCode, 200);
  assert.equal(calls.length, 2);
  await app.close();
});

test('fails closed when public fetching rejects a destination', async () => {
  const app = Fastify();
  registerLinkThumbnailRoute(app, async () => { throw Error('private destination'); });
  assert.equal((await app.inject('/api/chat/link-thumbnail?url=http://127.0.0.1')).statusCode, 404);
  assert.equal((await app.inject('/api/chat/link-thumbnail')).statusCode, 400);
  await app.close();
});

test('Amazon uses its displayed product image only when social metadata is absent', () => {
  const product = '<img data-old-hires="https://m.media-amazon.com/images/I/large.jpg" src="https://m.media-amazon.com/images/I/small.jpg?a=1&amp;b=2" id="landingImage">';
  assert.equal(thumbnailUrl(product, 'https://www.amazon.pl/dp/B0DBHK4XT5'), 'https://m.media-amazon.com/images/I/small.jpg?a=1&b=2');
  assert.equal(thumbnailUrl('<meta property="og:image" content="/social.jpg">' + product, 'https://www.amazon.pl/dp/test'), 'https://www.amazon.pl/social.jpg');
  assert.equal(thumbnailUrl(product, 'https://amazon.pl.example.com/'), null);
  assert.equal(thumbnailUrl('<img id="landingImage" src="javascript:alert(1)">', 'https://www.amazon.pl/'), null);
  assert.equal(thumbnailUrl('<img id="landingImage" src="data:image/gif;base64,AA">', 'https://www.amazon.pl/'), null);
});
