import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  SOURCE_DEFINITIONS, FILTER_OPTIONS, DEFAULT_FILTERS, UnsupportedSearchError,
  validateFilters, buildNivodaQuery, buildLgdPayload, normalizeNivodaItem,
  normalizeLgdItem, buildSourceLinks, searchDiamonds,
} from '../docs/search-core.mjs';

const fixtures = await Promise.all(['carbonsparkle','aurelinne','altura'].map(async id =>
  [id, JSON.parse(await readFile(new URL(`./fixtures/nivoda-${id}.json`, import.meta.url), 'utf8'))]));
const nivodaFixtures = Object.fromEntries(fixtures);
const lgdFixture = JSON.parse(await readFile(new URL('./fixtures/lgd-search.json', import.meta.url), 'utf8'));
const sourceById = id => SOURCE_DEFINITIONS.find(source => source.id === id);
const carbon = sourceById('carbonsparkle');
const lgd = sourceById('loosegrown');
const endpoint = 'https://test.example/api/search';
const filters = changes => ({...structuredClone(DEFAULT_FILTERS), ...changes});
const oneColor = changes => filters({colors:['Pink'], ...changes});
const response = (body, status=200) => new Response(JSON.stringify(body), {
  status, headers:{'Content-Type':'application/json'},
});

function itemFor(source, index, changes={}) {
  return {
    id:`${source.id}-${index}`, siteId:source.id, siteName:source.name,
    price:1000+Number(String(index).match(/\d+$/)?.[0] || 0), currency:'USD',
    carat:5.12, shape:'HEART', color:'Fancy Vivid Pink', clarity:'VVS2', cut:'', lab:'IGI',
    url:source.origin+'/diamond/'+encodeURIComponent(String(index))+'/', ...changes,
  };
}

function pageFor(source, items, total, offset, changes={}) {
  const nextOffset = offset+items.length;
  return {
    siteId:source.id, name:source.name, items, currency:'USD',
    total:offset===0?total:null, nextOffset, hasMore:nextOffset<total,
    observedAt:'2026-10-16T00:00:00.000Z', ...changes,
  };
}

function inventoryMock(counts, {pageSize, transform}={}) {
  const calls=[];
  const fetchImpl=async (url, options) => {
    assert.equal(url, endpoint);
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['Content-Type'], 'application/json');
    const body=JSON.parse(options.body), source=sourceById(body.siteId);
    assert.ok(source, 'Only configured source IDs may be requested');
    calls.push(body);
    const count=typeof counts==='function'?counts(body):counts[source.id]??0;
    const size=pageSize??(source.kind==='loosegrown'?50:20);
    const color=source.kind==='loosegrown'&&body.filters.fancy?body.filters.colors[0]:'single';
    const items=Array.from({length:Math.min(size,Math.max(0,count-body.offset))}, (_,index) =>
      itemFor(source, `${color}-${body.offset+index}`));
    const page=pageFor(source,items,count,body.offset);
    return transform?await transform({body,source,page,calls}):response(page);
  };
  return {fetchImpl,calls};
}

test('filter defaults are independent clones and numeric form strings normalize', () => {
  const first=validateFilters({caratMin:'5.25',caratMax:'8',priceMin:'100',priceMax:'2000'});
  assert.deepEqual(first.errors, []);
  assert.equal(first.filters.caratMin,5.25);
  assert.equal(first.filters.priceMax,2000);
  first.filters.shapes.push('ROUND');
  assert.deepEqual(validateFilters().filters.shapes,['HEART']);
  const deduped=validateFilters({colors:['Pink','Pink'],polish:['EX','EX']});
  assert.deepEqual(deduped.errors,[]);
  assert.deepEqual(deduped.filters.colors,['Pink']);
  assert.deepEqual(deduped.filters.polish,['EX']);
});

test('invalid model structures, unknown fields, enums and ranges are rejected', () => {
  const invalid=[null,[],17,'filters',
    {origin:'https://evil.example'}, {siteId:'https://evil.example'},
    {fancy:'true'}, {shapes:'HEART'}, {shapes:['heart']}, {colors:['<script>']},
    {intensities:['Unknown']}, {labs:['UNKNOWN']}, {growthTypes:['HPHT;fetch()']},
    {polish:['X']}, {symmetry:[null]}, {fluorescence:['NONE']},
    {caratMin:0}, {caratMax:51}, {caratMin:20,caratMax:5},
    {priceMin:0}, {priceMax:5000001}, {priceMin:true}, {priceMax:Infinity},
    {tableMin:-1}, {tableMax:101}, {ratioMin:0}, {ratioMax:11},
    {caratMin:''}, {priceMin:'USD 100'}, {tableMin:'NaN'}, {ratioMax:[]},
    {clarityMin:'FL',clarityMax:'VVS2'}, {cutMin:'ID',cutMax:'GD'},
    {whiteColorMin:'Z',whiteColorMax:'D'}, {whiteColorMin:'A'},
  ];
  for(const raw of invalid) assert.ok(validateFilters(raw).errors.length,JSON.stringify(raw));
});

test('Nivoda query preserves all selected fancy and advanced fields', () => {
  const model=filters({
    shapes:['CUSHION','SQUARE EMERALD'], colors:['Blue','Pink'], intensities:['Fancy_Light','Fancy_Vivid'],
    caratMin:1.25,caratMax:8.4,clarityMin:'SI1',clarityMax:'VVS1',cutMin:'VG',cutMax:'ID',
    priceMin:500,priceMax:17000,tableMin:55,tableMax:72,ratioMin:1.1,ratioMax:1.8,
    polish:['GD','VG','EX'],symmetry:['VG','EX'],fluorescence:['FNT','MED'],
    labs:['GIA','IGI','GCAL'],growthTypes:['CVD'],
  });
  assert.deepEqual(buildNivodaQuery(model,carbon),{
    labgrown:true,shapes:['CUSHION BRILLIANT','CUSHION MODIFIED','CUSHION','SQUARE EMERALD'],
    sizes:{from:1.25,to:8.4},clarity:['SI1','VS2','VS1','VVS2','VVS1'],cut:['VG','EX','ID'],
    color:['FANCY'],dollar_value:{from:'500',to:'17000'},table_percentage:{from:55,to:72},
    ratio:{from:1.1,to:1.8},polish:['GD','VG','EX'],symmetry:['VG','EX'],
    flouresence:['FNT','MED'],certificate_lab:['GIA','IGI','GCAL'],labgrown_type:['CVD'],
    fancyColor:['Blue','Pink'],fancyIntensity:['Fancy_Light','Fancy_Vivid'],
  });
});

test('Nivoda white D-Z uses color grades and omits inactive fancy filters', () => {
  const model=filters({fancy:false,shapes:[],colors:['Red'],intensities:['Fancy_Deep']});
  const query=buildNivodaQuery(model,carbon);
  assert.deepEqual(query.color,[...'DEFGHIJKLMNOPQRSTUVWXYZ']);
  assert.deepEqual(query.shapes,[]);
  assert.equal(Object.hasOwn(query,'fancyColor'),false);
  assert.equal(Object.hasOwn(query,'fancyIntensity'),false);
  assert.deepEqual(buildNivodaQuery(filters({fancy:false,whiteColorMin:'E',whiteColorMax:'G'}),carbon).color,['E','F','G']);
});

test('Nivoda defaults correspond to independently captured query contracts with user overrides', () => {
  for(const source of SOURCE_DEFINITIONS.filter(source=>source.kind==='nivoda')) {
    const captured=structuredClone(nivodaFixtures[source.id].request.query);
    Object.assign(captured,{
      sizes:{from:5,to:20},fancyColor:['Pink','Red'],polish:['EX'],symmetry:['EX'],
      certificate_lab:['GIA','IGI'],dollar_value:{from:'1',to:'5000000'},table_percentage:{from:0,to:100},
    });
    assert.deepEqual(buildNivodaQuery(filters(),source),captured);
  }
});

test('LGD single-color default numeric boundaries match live research', () => {
  assert.deepEqual(buildLgdPayload(oneColor(),3),{
    ls_start:3,ls_per_page:50,shape:['heart'],carat_range:'5,20',price_range:'1,5000000',
    clarity_range:'7,11',cut_range:'3,4',table_range:'0,100',lwratio_range:'0.8,3',
    polish_range:'2,3',symmetry_range:'2,3',fluorescence_range:'0,5',
    certificate_type:['2','1'],dtype:[],colored:'2',intensity:[5,4],
  });
  const exact=buildLgdPayload(oneColor({clarityMin:'VVS2',clarityMax:'VVS2',polish:['VG'],symmetry:['GD'],fluorescence:['FNT'],growthTypes:['HPHT','CVD']}));
  assert.equal(exact.clarity_range,'7,8');
  assert.equal(exact.polish_range,'1,2');
  assert.equal(exact.symmetry_range,'0,1');
  assert.equal(exact.fluorescence_range,'1,2');
  assert.deepEqual(exact.dtype,['hpht','cvd']);
});

test('LGD distinguishes Fancy Light from unsupported Light and supports only exact mappings', () => {
  assert.deepEqual(buildLgdPayload(oneColor({intensities:['Fancy_Light']})).intensity,[1]);
  for(const changes of [
    {intensities:['Light']},{intensities:['Very_Light']},{intensities:['Faint']},
    {colors:['Pink','Red']},{colors:[]},{colors:['Violet']},{growthTypes:['IIA']},
    {labs:['HRD']},{shapes:['KITE']},{clarityMin:'I3',clarityMax:'I3'},
    {polish:['GD','EX']},{symmetry:['GD','EX']},{fluorescence:['NON','MED']},
  ]) assert.throws(()=>buildLgdPayload(oneColor(changes)),UnsupportedSearchError,JSON.stringify(changes));
});

test('LGD white numeric colors, shape aliases and advanced bounds are exact', () => {
  const payload=buildLgdPayload(oneColor({
    fancy:false,whiteColorMin:'D',whiteColorMax:'F',shapes:['ROSE','CALF','EUROPEAN CUT','HEXAGONAL'],
    caratMin:2.5,caratMax:9,priceMin:600,priceMax:4500,tableMin:52,tableMax:67,ratioMin:0.9,ratioMax:1.2,
  }));
  assert.equal(payload.color,'7,10');
  assert.deepEqual(payload.shape,['rose_cut','calf_head','old_european','hexagon']);
  assert.equal(payload.carat_range,'2.5,9');
  assert.equal(payload.price_range,'600,4500');
  assert.equal(payload.table_range,'52,67');
  assert.equal(payload.lwratio_range,'0.9,1.2');
  assert.equal(Object.hasOwn(payload,'colored'),false);
  assert.equal(Object.hasOwn(payload,'intensity'),false);
  assert.throws(()=>buildLgdPayload(oneColor({fancy:false,whiteColorMin:'N',whiteColorMax:'Z'})),UnsupportedSearchError);
});

test('all 206 actual Nivoda items normalize without rejecting mixed colors or null cut', () => {
  let count=0,mixed=0;
  for(const [id,fixture] of fixtures) {
    const source=sourceById(id),results=fixture.items.map(item=>normalizeNivodaItem(item,source));
    assert.equal(results.length,fixture.expected_count);
    assert.equal(Math.min(...results.map(item=>item.price)),fixture.expected_minimum);
    results.forEach((item,index)=>{
      assert.equal(item.price,fixture.items[index].price);
      assert.equal(item.cut,'');
      assert.equal(new URL(item.url).origin,source.origin);
      assert.equal(new URL(item.url).searchParams.get('id'),item.id);
      mixed+=item.color==='Fancy Vivid Orange Pink';
    });
    count+=results.length;
  }
  assert.equal(count,206);
  assert.equal(mixed,3);
});

test('Nivoda per-item discount is used exactly once and falsy fields preserve price', () => {
  const original=nivodaFixtures.carbonsparkle.items[0];
  assert.equal(normalizeNivodaItem({...original,price:1000,discountedPrice:800},carbon).price,800);
  for(const discountedPrice of [undefined,null,0,false,'']) {
    assert.equal(normalizeNivodaItem({...original,price:1000,discountedPrice},carbon).price,1000);
  }
  for(const discountedPrice of [-1,'invalid','0',{},[]]) {
    assert.throws(()=>normalizeNivodaItem({...original,discountedPrice},carbon));
  }
});

test('normalizers reject malformed prices, carats, currencies and missing identity', () => {
  const original=nivodaFixtures.carbonsparkle.items[0];
  for(const price of [0,-1,null,true,'','invalid',Infinity]) {
    assert.throws(()=>normalizeNivodaItem({...original,price},carbon));
    assert.throws(()=>normalizeLgdItem({...lgdFixture.fancy,price},lgd));
  }
  for(const currency of ['EUR','KRW',null,false,0]) {
    assert.throws(()=>normalizeNivodaItem({...original,currency},carbon));
    assert.throws(()=>normalizeLgdItem({...lgdFixture.fancy,currency},lgd));
  }
  assert.throws(()=>normalizeNivodaItem({...original,id:''},carbon));
  assert.throws(()=>normalizeNivodaItem({...original,certificate:null},carbon));
  assert.throws(()=>normalizeNivodaItem({...original,certificate:{...original.certificate,labgrown:false}},carbon));
  assert.throws(()=>normalizeNivodaItem({...original,certificate:{...original.certificate,carats:0}},carbon));
  assert.throws(()=>normalizeLgdItem({...lgdFixture.fancy,id:'',sku:''},lgd));
  assert.throws(()=>normalizeLgdItem({...lgdFixture.fancy,carat:0},lgd));
});

test('LGD actual white/fancy numeric fields decode and sale_price is never substituted', () => {
  const white=normalizeLgdItem(lgdFixture.white,lgd);
  assert.equal(white.color,'E');
  assert.equal(white.clarity,'VVS2');
  assert.equal(white.cut,'ID');
  assert.equal(white.lab,'IGI');
  const fancy=normalizeLgdItem(lgdFixture.fancy,lgd);
  assert.equal(fancy.color,'Fancy Vivid Yellow');
  assert.equal(fancy.clarity,'VS2');
  assert.equal(fancy.url,lgd.origin+'/diamond/'+lgdFixture.fancy.sku+'/');
  for(const sale of [0,1,'1']) {
    const item=normalizeLgdItem({...lgdFixture.fancy,price:'2575',sale_price:'875',org_price:'3000',sale},lgd);
    assert.equal(item.price,2575);
  }
});

test('item identifiers cannot inject external source URLs or extra query parameters', () => {
  const id='item&redirect=https://evil.example/#<script>',original=nivodaFixtures.carbonsparkle.items[0];
  const nivoda=normalizeNivodaItem({...original,id},carbon),url=new URL(nivoda.url);
  assert.equal(url.origin,carbon.origin);
  assert.equal(url.searchParams.get('id'),id);
  assert.equal(url.searchParams.has('redirect'),false);
  const sku='../?redirect=https://evil.example/#fragment';
  const loose=normalizeLgdItem({...lgdFixture.fancy,sku},lgd),looseUrl=new URL(loose.url);
  assert.equal(looseUrl.origin,lgd.origin);
  assert.equal(looseUrl.search,'');
  assert.equal(looseUrl.hash,'');
  assert.ok(looseUrl.pathname.includes(encodeURIComponent(sku)));
});

test('source links use the actual Nivoda parameter names and LGD white route/method', () => {
  const model=oneColor({fancy:false,whiteColorMin:'D',whiteColorMax:'F',growthTypes:['CVD'],tableMin:55,tableMax:70,fluorescence:['FNT'],labs:['IGI']});
  for(const link of buildSourceLinks(model)) {
    const url=new URL(link.url);
    assert.equal(url.origin,sourceById(link.id).origin);
    if(link.id==='loosegrown') {
      assert.equal(url.pathname,'/lab-diamonds/');
      assert.equal(url.searchParams.get('method'),'cvd');
      assert.equal(url.searchParams.has('dtype'),false);
    } else {
      assert.equal(url.searchParams.get('table_percentage_min'),'55');
      assert.equal(url.searchParams.get('table_percentage_max'),'70');
      assert.equal(url.searchParams.get('flouresence'),'FNT');
      assert.equal(url.searchParams.get('certificate_lab'),'IGI');
      assert.equal(url.searchParams.get('color_min'),'F');
      assert.equal(url.searchParams.get('color_max'),'D');
    }
  }
});

test('Nivoda source links canonicalize intensity order and flag noncontiguous selections', () => {
  for(const link of buildSourceLinks(oneColor({intensities:['Fancy_Vivid','Fancy_Deep']})).filter(link=>link.id!=='loosegrown')) {
    const url=new URL(link.url);
    assert.equal(url.searchParams.get('intensity_min'),'Fancy_Deep');
    assert.equal(url.searchParams.get('intensity_max'),'Fancy_Vivid');
  }
  for(const link of buildSourceLinks(oneColor({intensities:['Fancy_Deep','Fancy_Light']})).filter(link=>link.id!=='loosegrown')) {
    assert.ok(link.unsupported.length,'An interval URL must not silently add unselected intensity grades');
  }
});

test('all pages are loaded, globally price sorted and reported complete only at advertised counts', async () => {
  const mock=inventoryMock({loosegrown:55,carbonsparkle:45,aurelinne:45,altura:45}),updates=[];
  const result=await searchDiamonds(oneColor(),{endpoint,fetchImpl:mock.fetchImpl,onProgress:state=>updates.push(state)});
  assert.equal(result.results.length,190);
  assert.equal(result.complete,true);
  assert.deepEqual(result.results.map(item=>item.price),result.results.map(item=>item.price).toSorted((a,b)=>a-b));
  for(const source of result.sources) {
    assert.equal(source.complete,true);
    assert.equal(source.status,'ok');
    assert.equal(source.loaded,source.id==='loosegrown'?55:45);
    assert.equal(source.count,source.loaded);
    const states=updates.filter(state=>state.id===source.id);
    assert.equal(states[0].status,'loading');
    assert.equal(states.at(-1).status,'ok');
    assert.equal(states.at(-1).complete,true);
    assert.ok(states.some(state=>state.loaded>0&&state.status==='loading'));
    assert.deepEqual(states.map(state=>state.loaded),states.map(state=>state.loaded).toSorted((a,b)=>a-b));
  }
  assert.deepEqual(mock.calls.filter(call=>call.siteId==='loosegrown').map(call=>call.offset),[0,50]);
  assert.deepEqual(mock.calls.filter(call=>call.siteId==='carbonsparkle').map(call=>call.offset),[0,20,40]);
});

test('matching product IDs across sites keep only the cheapest offer and its source link', async () => {
  const prices={loosegrown:1400,carbonsparkle:1200,aurelinne:1000,altura:1100};
  const mock=inventoryMock(Object.fromEntries(SOURCE_DEFINITIONS.map(source=>[source.id,2])),{
    transform:({source,page})=>{
      Object.assign(page.items[0],{id:'shared-product',price:prices[source.id]});
      return response(page);
    },
  });
  const result=await searchDiamonds(oneColor(),{endpoint,fetchImpl:mock.fetchImpl});
  const offers=result.results.filter(item=>item.id==='shared-product');
  assert.equal(offers.length,1);
  assert.deepEqual(offers[0],itemFor(sourceById('aurelinne'),'single-0',{id:'shared-product',price:1000}));
  assert.equal(result.results.length,5,'Distinct IDs remain even when their prices and diamond attributes match');
  assert.equal(new Set(result.results.map(item=>item.id)).size,5);
  assert.deepEqual(result.results.map(item=>item.price),[1000,1001,1001,1001,1001]);
  assert.equal(result.complete,true);
  assert.ok(result.sources.every(source=>source.loaded===2&&source.count===2&&source.complete),
    'Source counts still describe the inventory that was checked');
});

test('equal-price matching IDs keep the first configured site regardless of response order', async () => {
  let releaseFirst;
  const firstReady=new Promise(resolve=>{releaseFirst=resolve;});
  const completed=[];
  const mock=inventoryMock(Object.fromEntries(SOURCE_DEFINITIONS.map(source=>[source.id,1])),{
    transform:async({source,page})=>{
      Object.assign(page.items[0],{id:'shared-product',price:1000});
      if(source.id==='loosegrown') await firstReady;
      completed.push(source.id);
      if(source.id==='altura') releaseFirst();
      return response(page);
    },
  });
  const result=await searchDiamonds(oneColor(),{endpoint,fetchImpl:mock.fetchImpl});
  assert.equal(completed.at(-1),'loosegrown');
  assert.equal(result.results.length,1);
  assert.equal(result.results[0].siteId,'loosegrown');
  assert.equal(result.results[0].url,itemFor(lgd,'Pink-0').url);
  assert.equal(result.complete,true);
});

test('cheapest matching ID from a partial source is retained without hiding incomplete coverage', async () => {
  const mock=inventoryMock({carbonsparkle:2,aurelinne:1},{pageSize:1,transform:({source,body,page})=>{
    if(source.id==='carbonsparkle'&&body.offset>0) return response({error:'Page unavailable'},502);
    if(page.items.length) Object.assign(page.items[0],{id:'shared-product',price:source.id==='carbonsparkle'?900:1000});
    return response(page);
  }});
  const result=await searchDiamonds(oneColor(),{endpoint,fetchImpl:mock.fetchImpl});
  assert.equal(result.results.length,1);
  assert.equal(result.results[0].siteId,'carbonsparkle');
  assert.equal(result.results[0].price,900);
  assert.equal(result.complete,false);
  assert.equal(result.sources.find(source=>source.id==='carbonsparkle').status,'partial');
});

test('LGD multi-color requests are split, paginated independently and merged under one source', async () => {
  const mock=inventoryMock(body=>body.siteId!=='loosegrown'?0:body.filters.colors[0]==='Pink'?53:2);
  const result=await searchDiamonds(filters(),{endpoint,fetchImpl:mock.fetchImpl});
  const state=result.sources.find(source=>source.id==='loosegrown');
  assert.equal(state.count,55);
  assert.equal(state.loaded,55);
  assert.equal(state.complete,true);
  assert.equal(result.results.length,55);
  assert.deepEqual(mock.calls.filter(call=>call.siteId==='loosegrown').map(call=>[call.filters.colors,call.offset]),[
    [['Pink'],0],[['Pink'],50],[['Red'],0],
  ]);
});

test('LGD all fancy colors produces ten exact single-color variants', async () => {
  const mock=inventoryMock({});
  const result=await searchDiamonds(filters({colors:[]}),{endpoint,fetchImpl:mock.fetchImpl});
  const colors=mock.calls.filter(call=>call.siteId==='loosegrown').map(call=>call.filters.colors);
  assert.equal(colors.length,10);
  assert.ok(colors.every(value=>value.length===1));
  assert.deepEqual(colors.flat().toSorted(),['Yellow','Pink','Purple','Red','Blue','Green','Orange','Brown','Black','Gray'].toSorted());
  assert.ok(result.sources.every(state=>state.status==='no_matches'&&state.complete));
});

test('a source failure does not discard other successful sources', async () => {
  const mock=inventoryMock({loosegrown:1,carbonsparkle:1,aurelinne:1,altura:1},{
    transform:({source,page})=>source.id==='carbonsparkle'?response({error:'Carbon temporarily unavailable'},502):response(page),
  });
  const result=await searchDiamonds(oneColor(),{endpoint,fetchImpl:mock.fetchImpl});
  assert.equal(result.results.length,3);
  assert.equal(result.complete,false);
  assert.equal(result.sources.find(state=>state.id==='carbonsparkle').status,'error');
  assert.ok(result.sources.filter(state=>state.id!=='carbonsparkle').every(state=>state.status==='ok'&&state.complete));
});

test('a later page failure preserves verified earlier results as partial', async () => {
  const mock=inventoryMock({carbonsparkle:40},{
    transform:({body,page})=>body.siteId==='carbonsparkle'&&body.offset>0?response({error:'Page unavailable'},502):response(page),
  });
  const result=await searchDiamonds(oneColor(),{endpoint,fetchImpl:mock.fetchImpl});
  const state=result.sources.find(source=>source.id==='carbonsparkle');
  assert.equal(state.status,'partial');
  assert.equal(state.complete,false);
  assert.equal(result.results.length,20);
});

test('unsupported LGD filters are explicit while Nivoda sources continue', async () => {
  const mock=inventoryMock({carbonsparkle:1});
  const result=await searchDiamonds(filters({colors:['Violet']}),{endpoint,fetchImpl:mock.fetchImpl});
  assert.equal(result.sources.find(source=>source.id==='loosegrown').status,'unsupported');
  assert.equal(mock.calls.some(call=>call.siteId==='loosegrown'),false);
  assert.equal(result.results.length,1);
  assert.equal(result.complete,false);
});

test('per-source cap is strict even when the final fetched page exceeds the remaining space', async () => {
  const mock=inventoryMock({carbonsparkle:80});
  const result=await searchDiamonds(oneColor(),{endpoint,fetchImpl:mock.fetchImpl,maxPerSource:51});
  const state=result.sources.find(source=>source.id==='carbonsparkle');
  assert.equal(state.loaded,51);
  assert.equal(state.count,80);
  assert.equal(state.complete,false);
  assert.equal(state.status,'partial');
  assert.equal(result.results.length,51);
  assert.deepEqual(mock.calls.filter(call=>call.siteId==='carbonsparkle').map(call=>call.offset),[0,20,40]);
});

test('production 400 cap also covers merged LGD color variants', async () => {
  const mock=inventoryMock(body=>body.siteId!=='loosegrown'?0:body.filters.colors[0]==='Pink'?73:400);
  const result=await searchDiamonds(filters(),{endpoint,fetchImpl:mock.fetchImpl});
  const state=result.sources.find(source=>source.id==='loosegrown');
  assert.equal(state.loaded,400);
  assert.equal(state.count,473);
  assert.equal(state.status,'partial');
  assert.equal(state.complete,false);
  assert.equal(result.results.length,400);
});

test('exact count at cap remains complete and displayed-price/carat bounds are rechecked', async () => {
  const mock=inventoryMock({carbonsparkle:3},{transform:({source,page})=>{
    if(source.id==='carbonsparkle') page.items=[
      itemFor(source,0,{price:900}),itemFor(source,1,{price:1200}),itemFor(source,2,{price:1200,carat:4.99}),
    ];
    return response(page);
  }});
  const result=await searchDiamonds(oneColor({priceMin:1000,priceMax:1500}),{endpoint,fetchImpl:mock.fetchImpl,maxPerSource:3});
  const state=result.sources.find(source=>source.id==='carbonsparkle');
  assert.equal(state.loaded,3);
  assert.equal(state.complete,true);
  assert.equal(result.results.length,1);
  assert.equal(result.results[0].price,1200);
});

test('duplicate inventory cannot be reported complete', async () => {
  const mock=inventoryMock({carbonsparkle:2},{transform:({source,page})=>{
    if(source.id==='carbonsparkle') page.items[1].id=page.items[0].id;
    return response(page);
  }});
  const result=await searchDiamonds(oneColor(),{endpoint,fetchImpl:mock.fetchImpl});
  const state=result.sources.find(source=>source.id==='carbonsparkle');
  assert.equal(state.complete,false);
  assert.equal(state.status,'partial');
  assert.match(state.message,/중복/);
});

test('changed inventory counts on later pages become an explicit partial result', async () => {
  const mock=inventoryMock({carbonsparkle:40},{transform:({body,page})=>{
    if(body.siteId==='carbonsparkle'&&body.offset>0) page.total=41;
    return response(page);
  }});
  const result=await searchDiamonds(oneColor(),{endpoint,fetchImpl:mock.fetchImpl});
  const state=result.sources.find(source=>source.id==='carbonsparkle');
  assert.equal(state.complete,false);
  assert.equal(state.loaded,20);
  assert.equal(state.status,'partial');
});

test('invalid response currency, counts, offsets, source URLs and incomplete pages fail explicitly', async t => {
  const mutations={
    'missing total':page=>{delete page.total;},
    'null initial total':page=>{page.total=null;},
    'negative total':page=>{page.total=-1;},
    'wrong offset':page=>{page.nextOffset=2;page.total=2;},
    'premature final page':page=>{page.total=2;page.hasMore=false;},
    'empty advertised inventory':page=>{page.items=[];page.nextOffset=0;page.total=1;page.hasMore=false;},
    'page currency':page=>{page.currency='EUR';},
    'item currency':page=>{page.items[0].currency='EUR';},
    'wrong site':page=>{page.items[0].siteId='altura';},
    'zero price':page=>{page.items[0].price=0;},
    'numeric string price':page=>{page.items[0].price='1000';},
    'foreign source URL':page=>{page.items[0].url='https://evil.example/diamond/1/';},
    'deceptive source URL':page=>{page.items[0].url='https://www.carbonsparkle.com.evil.example/';},
    'URL userinfo injection':page=>{page.items[0].url='https://www.carbonsparkle.com@evil.example/';},
    'javascript URL':page=>{page.items[0].url='javascript:alert(1)';},
  };
  for(const [label,mutate] of Object.entries(mutations)) await t.test(label,async()=>{
    const mock=inventoryMock({carbonsparkle:1},{transform:({source,page})=>{
      if(source.id==='carbonsparkle') mutate(page);
      return response(page);
    }});
    const result=await searchDiamonds(oneColor(),{endpoint,fetchImpl:mock.fetchImpl});
    const state=result.sources.find(source=>source.id==='carbonsparkle');
    assert.equal(state.complete,false);
    assert.ok(['error','partial'].includes(state.status));
    assert.ok(state.message);
  });
});

test('invalid input and invalid limits never trigger network access', async () => {
  let calls=0;
  const fetchImpl=()=>{calls++;throw new Error('Unexpected network access');};
  await assert.rejects(searchDiamonds({shapes:['https://evil.example']},{endpoint,fetchImpl}));
  for(const maxPerSource of [0,-1,401,1.5,'20']) {
    await assert.rejects(searchDiamonds(oneColor(),{endpoint,fetchImpl,maxPerSource}));
  }
  assert.equal(calls,0);
});

test('a signal aborted before search prevents all network access', async () => {
  const controller=new AbortController();controller.abort();
  let calls=0;
  await assert.rejects(searchDiamonds(oneColor(),{
    endpoint,signal:controller.signal,fetchImpl:()=>{calls++;throw new Error('Unexpected fetch');},
  }),{name:'AbortError'});
  assert.equal(calls,0);
});

test('an active abort rejects the whole search instead of becoming a successful partial result', async () => {
  const controller=new AbortController();
  let calls=0;
  const fetchImpl=(_url,{signal})=>new Promise((_resolve,reject)=>{
    calls++;
    signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
    if(calls===4) queueMicrotask(()=>controller.abort());
  });
  await assert.rejects(searchDiamonds(oneColor(),{endpoint,fetchImpl,signal:controller.signal}),{name:'AbortError'});
  assert.equal(calls,4);
});
