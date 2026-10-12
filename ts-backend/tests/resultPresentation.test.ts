import assert from 'node:assert/strict';
import test from 'node:test';
import { searchPageKind } from '../src/resultPresentation.js';

test('URL classification distinguishes listings from individual products without using snippets', () => {
  const cases = {
    'https://allegro.pl/listing?string=adapter': 'listing',
    'https://www.allegro.pl/kategoria/electronics': 'listing',
    'https://allegro.pl/oferta/adapter-123?search=tracking': 'product',
    'https://allegro.pl/produkt/adapter-123': 'product',
    'https://store.example/search?q=adapter': 'listing',
    'https://store.example/category/adapters': 'listing',
    'https://store.example/collections/adapters': 'listing',
    'https://store.example/collections/adapters/products/dp-hdmi': 'product',
    'https://store.example/products/dp-hdmi?q=tracking': 'product',
    'https://store.example/adapter-123': 'unknown',
    'https://allegro.pl.other.example/oferta/adapter-123': 'unknown',
    'https://www.amazon.pl/dp/B0DBHK4XT5': 'product',
    'https://www.ebay.com/itm/123456789012': 'product',
    'https://amazon.evil.example/dp/B0DBHK4XT5': 'unknown',
    'https://ebay.evil.example/itm/123456789012': 'unknown',
    'not a URL': 'unknown',
  };
  for (const [url,kind] of Object.entries(cases)) assert.equal(searchPageKind(url),kind,url);
});

test('citation fallback ignores code, images, unknown URLs and unselected products', async () => {
  const {citedProductIds}=await import('../src/resultPresentation.js');
  const url='https://allegro.pl/produkt/adapter-123';
  const sources=[{id:'r1',url},{id:'r2',url:'https://allegro.pl/produkt/other-123'}];
  for(const text of ['`[example]('+url+')`','```md\n[example]('+url+')\n```','~~~md\n[example]('+url+')\n~~~','![image]('+url+')','[unretrieved](https://allegro.pl/produkt/invented-123)'])assert.deepEqual(citedProductIds(text,sources),[]);
  assert.deepEqual(citedProductIds('[adapter]('+url+') and [again](<'+url+'#details>)',sources),['r1']);
  assert.deepEqual(citedProductIds('[adapter]('+url+')',[{id:'r1',url,blocked:true}]),[]);
});
