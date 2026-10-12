import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { mkdtemp, readdir, rm, utimes, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { thumbnailUrl, registerLinkThumbnailRoute } from '../src/linkThumbnail.js';

test('search thumbnails bypass blocked pages and persist across backend restarts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sawot-thumbnails-'));
  const image = 'https://imgs.search.brave.com/offer-thumbnail';
  const url = '/api/chat/link-thumbnail?' + new URLSearchParams({url: 'https://allegro.pl/oferta/console-123', image});
  let requests = 0;
  const fetcher = async (destination: string) => {
    requests++;
    assert.equal(destination, image, 'must not fetch the blocked offer page');
    return {finalUrl: image, mediaType: 'image/jpeg', close() {}, body: (async function* () { yield Buffer.from('thumbnail bytes'); })()};
  };
  try {
    for (let restart = 0; restart < 2; restart++) {
      const app = Fastify();
      registerLinkThumbnailRoute(app, fetcher as any, {cacheDir: dir});
      try {
        const response = await app.inject(url);
        assert.equal(response.statusCode, 200);
        assert.equal(response.body, 'thumbnail bytes');
      } finally { await app.close(); }
    }
    assert.equal(requests, 1);
    const files = await readdir(dir);
    assert.equal(files.length, 1);
    await utimes(join(dir, files[0]), new Date(), new Date(Date.now() - 8 * 86400_000));
    const app = Fastify();
    registerLinkThumbnailRoute(app, fetcher as any, {cacheDir: dir});
    try { assert.equal((await app.inject(url)).statusCode, 200); } finally { await app.close(); }
    assert.equal(requests, 2, 'expired images are downloaded again');
  } finally { await rm(dir, {recursive: true, force: true}); }
});

test('disk cache evicts least recently used images within its byte limit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sawot-thumbnail-lru-'));
  const app = Fastify();
  const requests: string[] = [];
  const fetcher = async (url: string) => {
    requests.push(url);
    return {finalUrl: url, mediaType: 'image/png', close() {}, body: (async function* () { yield Buffer.alloc(100); })()};
  };
  registerLinkThumbnailRoute(app, fetcher as any, {cacheDir: dir, maxBytes: 220});
  const get = (id: string) => app.inject('/api/chat/link-thumbnail?' + new URLSearchParams({url:'https://shop.example/products/'+id, image:'https://imgs.search.brave.com/'+id}));
  try {
    await get('a'); await get('b'); await get('a'); await get('c');
    assert.ok((await Promise.all((await readdir(dir)).map(name => stat(join(dir,name))))).reduce((n,s)=>n+s.size,0) <= 220);
    await get('a');
    assert.equal(requests.filter(url=>url.endsWith('/a')).length, 1);
    await get('b');
    assert.equal(requests.filter(url=>url.endsWith('/b')).length, 2);
  } finally { await app.close(); await rm(dir, {recursive:true,force:true}); }
});

test('direct thumbnail hints reject untrusted hosts and credentials', async () => {
  const app = Fastify();
  let requests = 0;
  registerLinkThumbnailRoute(app, async () => { requests++; throw Error('unexpected download'); });
  try {
    for (const image of ['http://127.0.0.1/a', 'https://imgs.search.brave.com.evil.test/a', 'https://user:secret@imgs.search.brave.com/a']) {
      assert.equal((await app.inject('/api/chat/link-thumbnail?' + new URLSearchParams({url:'https://allegro.pl/oferta/test-1', image}))).statusCode,400);
    }
    assert.equal(requests,0);
  } finally { await app.close(); }
});

test('an expired search image does not trigger another fetch of a known blocked page', async () => {
  const app=Fastify();
  const requests:string[]=[];
  registerLinkThumbnailRoute(app, async url => {requests.push(url); throw Error('HTTP 404');});
  try {
    const image='https://imgs.search.brave.com/expired';
    const url='/api/chat/link-thumbnail?'+new URLSearchParams({url:'https://allegro.pl/oferta/blocked-123',image,pageBlocked:'true'});
    assert.equal((await app.inject(url)).statusCode,404);
    assert.deepEqual(requests,[image]);
  } finally {await app.close();}
});

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
