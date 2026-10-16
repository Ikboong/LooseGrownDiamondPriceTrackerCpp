// Shared by the static search page and its allowlisted read-only Worker.
export const SOURCE_DEFINITIONS = [
  {id:'loosegrown',name:'Loose Grown Diamond',kind:'loosegrown',origin:'https://www.loosegrowndiamond.com',pageUrl:'https://www.loosegrowndiamond.com/lab-created-colored-diamonds/',inventoryPathFancy:'/wp-json/ls/v1/inventory-colored',inventoryPathWhite:'/wp-json/ls/v1/inventory-filter'},
  {id:'carbonsparkle',name:'Carbon Sparkle',kind:'nivoda',origin:'https://www.carbonsparkle.com',pageUrl:'https://www.carbonsparkle.com/pages/diamonds'},
  {id:'aurelinne',name:'Aurelinne',kind:'nivoda',origin:'https://aurelinne.com',pageUrl:'https://aurelinne.com/pages/lab-grown'},
  {id:'altura',name:'Altura Diamonds',kind:'nivoda',origin:'https://alturadiamonds.com',pageUrl:'https://alturadiamonds.com/collections/lab-diamonds'},
];
const shapeNames = ["ROUND", "PRINCESS", "CUSHION", "OVAL", "PEAR", "EMERALD", "HEART", "RADIANT", "ASSCHER", "MARQUISE", "SQUARE RADIANT", "SQUARE EMERALD", "OLD MINER", "STAR", "ROSE", "SQUARE", "HALF MOON", "TRAPEZOID", "FLANDERS", "BRIOLETTE", "PENTAGONAL", "HEXAGONAL", "OCTAGONAL", "TRIANGULAR", "TRILLIANT", "CALF", "TAPERED BAGUETTE", "SHIELD", "LOZENGE", "KITE", "EUROPEAN CUT", "BAGUETTE", "BULLET", "TAPERED BULLET", "OTHER"];
const titleCase = value => value.toLowerCase().replace(/(^|[ _])([a-z])/g,(_,space,letter) => (space ? ' ' : '') + letter.toUpperCase());
export const FILTER_OPTIONS = Object.freeze({
  shapes:shapeNames.map(value => ({value,label:titleCase(value)})),
  colors:["Yellow", "Pink", "Blue", "Red", "Green", "Purple", "Orange", "Violet", "Gray", "Black", "Brown", "Champagne", "Cognac", "Chameleon", "White", "Salt and Pepper", "Other"],
  whiteColors:["D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"],
  intensities:["Fancy_Deep", "Fancy_Vivid", "Fancy_Intense", "Fancy_Dark", "Fancy", "Fancy_Light", "Light", "Very_Light", "Faint"].map(value => ({value,label:value.replaceAll('_',' ')})),
  clarity:["I3", "I2", "I1", "SI2", "SI1", "VS2", "VS1", "VVS2", "VVS1", "IF", "FL"],
  cuts:[{value:'GD',label:'Good'},{value:'VG',label:'Very Good'},{value:'EX',label:'Excellent'},{value:'ID',label:'Ideal'}],
  grades:[{value:'GD',label:'Good'},{value:'VG',label:'Very Good'},{value:'EX',label:'Excellent'}],
  fluorescence:[{value:'NON',label:'None'},{value:'FNT',label:'Faint'},{value:'MED',label:'Medium'},{value:'STG',label:'Strong'},{value:'VST',label:'Very Strong'}],
  labs:["GIA", "IGI", "HRD", "GCAL", "DBIOD", "SGL", "EGL", "AGS", "EGLISR", "NONE", "OTHER", "GGL", "DSEF", "CDC", "FGL", "GRS", "AGL", "ICL", "AGTL", "EMTEEM", "GTL", "GUBELIN", "RGL", "TGL", "AIGS", "LOTUS", "SSEF", "ZG", "GSI", "ALGT", "WISE"],
  growthTypes:["HPHT", "CVD", "IIA"],
});
export const DEFAULT_FILTERS = Object.freeze({
  shapes:['HEART'],fancy:true,colors:['Pink','Red'],whiteColorMin:'D',whiteColorMax:'Z',
  intensities:['Fancy_Deep','Fancy_Vivid'],caratMin:5,caratMax:20,clarityMin:'VVS2',clarityMax:'FL',
  cutMin:'ID',cutMax:'ID',priceMin:1,priceMax:5000000,tableMin:0,tableMax:100,
  ratioMin:0.8,ratioMax:3,polish:['EX'],symmetry:['EX'],fluorescence:['NON','FNT','MED','STG','VST'],
  labs:['GIA','IGI'],growthTypes:[],
});
const cloneDefaults = () => JSON.parse(JSON.stringify(DEFAULT_FILTERS));
function rangeValues(values,min,max) { return values.slice(values.indexOf(min),values.indexOf(max)+1); }
export function validateFilters(raw = {}) {
  const filters = cloneDefaults(), errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {filters,errors:['검색 조건 형식이 올바르지 않습니다.']};
  for (const key of Object.keys(raw)) if (!Object.hasOwn(filters,key)) errors.push('알 수 없는 검색 조건: ' + key);
  Object.assign(filters,raw);
  const ranges = [
    ['caratMin','caratMax',0.01,50,'캐럿'],['priceMin','priceMax',1,5000000,'가격'],
    ['tableMin','tableMax',0,100,'테이블'],['ratioMin','ratioMax',0.01,10,'비율'],
  ];
  for (const [minKey,maxKey,min,max,label] of ranges) {
    for (const key of [minKey,maxKey]) {
      const value = filters[key];
      if ((typeof value !== 'number' && typeof value !== 'string') || value === '' || !Number.isFinite(Number(value)) || Number(value)<min || Number(value)>max) errors.push(label + ' 범위는 ' + min + '–' + max + '입니다.');
      else filters[key] = Number(value);
    }
    if (Number(filters[minKey])>Number(filters[maxKey])) errors.push(label + ' 최솟값은 최댓값보다 클 수 없습니다.');
  }
  if (typeof filters.fancy !== 'boolean') errors.push('White/Fancy 선택을 확인해 주세요.');
  const lists = {shapes:shapeNames,colors:FILTER_OPTIONS.colors,intensities:FILTER_OPTIONS.intensities.map(x=>x.value),
    polish:FILTER_OPTIONS.grades.map(x=>x.value),symmetry:FILTER_OPTIONS.grades.map(x=>x.value),
    fluorescence:FILTER_OPTIONS.fluorescence.map(x=>x.value),labs:FILTER_OPTIONS.labs,growthTypes:FILTER_OPTIONS.growthTypes};
  for (const [key,options] of Object.entries(lists)) {
    if (!Array.isArray(filters[key]) || filters[key].length>options.length || filters[key].some(value=>!options.includes(value))) errors.push('지원하지 않는 선택값: ' + key);
    else filters[key] = [...new Set(filters[key])];
  }
  for (const [minKey,maxKey,options,label] of [
    ['clarityMin','clarityMax',FILTER_OPTIONS.clarity,'투명도'],
    ['cutMin','cutMax',FILTER_OPTIONS.cuts.map(x=>x.value),'컷'],
    ['whiteColorMin','whiteColorMax',FILTER_OPTIONS.whiteColors,'화이트 색상'],
  ]) {
    if (!options.includes(filters[minKey]) || !options.includes(filters[maxKey]) || options.indexOf(filters[minKey])>options.indexOf(filters[maxKey])) errors.push(label+' 범위 선택을 확인해 주세요.');
  }
  return {filters,errors:[...new Set(errors)]};
}
export function buildNivodaQuery(filters, source) {
  const shapes = filters.shapes.flatMap(value=>value==='CUSHION' ? ['CUSHION BRILLIANT','CUSHION MODIFIED','CUSHION'] : [value]);
  const query = {
    labgrown:true,shapes,sizes:{from:filters.caratMin,to:filters.caratMax},
    clarity:rangeValues(FILTER_OPTIONS.clarity,filters.clarityMin,filters.clarityMax),
    cut:rangeValues(FILTER_OPTIONS.cuts.map(x=>x.value),filters.cutMin,filters.cutMax),
    color:filters.fancy?['FANCY']:rangeValues(FILTER_OPTIONS.whiteColors,filters.whiteColorMin,filters.whiteColorMax),
    dollar_value:{from:String(filters.priceMin),to:String(filters.priceMax)},
    table_percentage:{from:filters.tableMin,to:filters.tableMax},ratio:{from:filters.ratioMin,to:filters.ratioMax},
    polish:filters.polish,symmetry:filters.symmetry,flouresence:filters.fluorescence,
    certificate_lab:filters.labs,labgrown_type:filters.growthTypes,
  };
  if (filters.fancy) { query.fancyColor=filters.colors;query.fancyIntensity=filters.intensities; }
  return query;
}
function positivePrice(raw) {
  if ((typeof raw!=='number' && typeof raw!=='string') || raw==='' || !Number.isFinite(Number(raw)) || Number(raw)<=0) throw new Error('상품의 가격 형식을 확인할 수 없습니다.');
  return Number(raw);
}
export function normalizeNivodaItem(item, source) {
  if (!item || typeof item.id!=='string' || !item.id || !item.certificate) throw new Error('상품 정보가 불완전합니다.');
  if (Object.hasOwn(item,'currency') && item.currency!=='USD') throw new Error('USD 이외의 가격은 비교할 수 없습니다.');
  const certificate=item.certificate;
  if (certificate.labgrown!==true) throw new Error('랩그로운 이외의 상품이 반환되었습니다.');
  const price=positivePrice(item.discountedPrice || item.price);
  const url=new URL(source.pageUrl);url.searchParams.set('activeTab','Lab Grown');url.searchParams.set('queryLabGrown','true');url.searchParams.set('id',item.id);
  return {id:item.id,siteId:source.id,siteName:source.name,price,currency:'USD',
    carat:positivePrice(certificate.carats),shape:String(certificate.shape||''),color:String(certificate.color||''),
    clarity:String(certificate.clarity||''),cut:String(certificate.cut||''),lab:String(certificate.lab||''),url:url.href};
}

// Loose Grown Diamond's numeric filter mappings are defined below, separately
// from the independent Nivoda storefront query contract.

const LGD_COLORS = {Yellow:1,Pink:2,Purple:3,Red:4,Blue:5,Green:6,Orange:7,Brown:8,Black:9,Gray:10};
const LGD_INTENSITIES = {Fancy_Light:1,Fancy:2,Fancy_Intense:3,Fancy_Vivid:4,Fancy_Deep:5,Fancy_Dark:6};
const LGD_CLARITY = {I2:1,I1:2,SI3:3,SI2:4,SI1:5,VS2:6,VS1:7,VVS2:8,VVS1:9,IF:10,FL:11};
const LGD_CUTS = {GD:1,VG:2,EX:3,ID:4};
const LGD_LABS = {IGI:'1',GIA:'2',GCAL:'3',NONE:'0'};
const LGD_WHITE = {M:1,L:2,K:3,J:4,I:5,H:6,G:7,F:8,E:9,D:10};
const LGD_SHAPES = {ROUND:'round',PRINCESS:'princess',CUSHION:'cushion',OVAL:'oval',PEAR:'pear',EMERALD:'emerald',HEART:'heart',RADIANT:'radiant',ASSCHER:'asscher',MARQUISE:'marquise'};
const LGD_WHITE_SHAPES = {"ROUND": "round", "PRINCESS": "princess", "CUSHION": "cushion", "OVAL": "oval", "PEAR": "pear", "EMERALD": "emerald", "HEART": "heart", "RADIANT": "radiant", "ASSCHER": "asscher", "MARQUISE": "marquise", "OLD MINER": "old_mine", "STAR": "star", "ROSE": "rose_cut", "SQUARE": "square", "HALF MOON": "half_moon", "TRAPEZOID": "trapezoid", "FLANDERS": "flanders", "BRIOLETTE": "briolette", "PENTAGONAL": "pentagonal", "HEXAGONAL": "hexagon", "OCTAGONAL": "octagonal", "TRIANGULAR": "triangular", "TRILLIANT": "trilliant", "CALF": "calf_head", "SHIELD": "shield", "LOZENGE": "lozenge", "KITE": "kite", "EUROPEAN CUT": "old_european", "BAGUETTE": "baguette", "BULLET": "bullet", "TAPERED BULLET": "tapered_bullet"};
export class UnsupportedSearchError extends Error {
  constructor(unsupported) { super('이 판매처에서 지원하지 않는 조건: '+unsupported.join(', '));this.name='UnsupportedSearchError';this.unsupported=unsupported; }
}
function lgdUnsupported(filters,{singleColor=false}={}) {
  const unsupported=[];
  if(filters.shapes.some(shape=>!Object.hasOwn(filters.fancy?LGD_SHAPES:LGD_WHITE_SHAPES,shape))) unsupported.push('선택한 모양');
  if(filters.fancy && filters.colors.some(color=>!Object.hasOwn(LGD_COLORS,color))) unsupported.push('선택한 컬러');
  if(singleColor && filters.fancy && filters.colors.length!==1) unsupported.push('색상별 개별 조회');
  if(filters.fancy && filters.intensities.some(value=>!Object.hasOwn(LGD_INTENSITIES,value))) unsupported.push('선택한 컬러 강도');
  if(filters.labs.some(value=>!Object.hasOwn(LGD_LABS,value))) unsupported.push('선택한 감정서');
  if(filters.growthTypes.includes('IIA')) unsupported.push('IIA');
  const contiguous = (values,options) => values.length<2 || Math.max(...values.map(x=>options.indexOf(x)))-Math.min(...values.map(x=>options.indexOf(x)))+1===values.length;
  for(const [key,label,options] of [
    ['polish','연마 등급',FILTER_OPTIONS.grades.map(x=>x.value)],
    ['symmetry','대칭 등급',FILTER_OPTIONS.grades.map(x=>x.value)],
    ['fluorescence','형광 등급',FILTER_OPTIONS.fluorescence.map(x=>x.value)],
  ]) if(!contiguous(filters[key],options)) unsupported.push(label+'의 연속 범위');
  if(!rangeValues(FILTER_OPTIONS.clarity,filters.clarityMin,filters.clarityMax).some(grade=>Object.hasOwn(LGD_CLARITY,grade))) unsupported.push('선택한 투명도');
  const whites=rangeValues(FILTER_OPTIONS.whiteColors,filters.whiteColorMin,filters.whiteColorMax);
  if(!filters.fancy && !whites.some(color=>Object.hasOwn(LGD_WHITE,color))) unsupported.push('선택한 화이트 색상');
  return unsupported;
}
function lgdRange(ids,max) {
  const selected=ids.length?ids:Array.from({length:max},(_,i)=>i+1);
  return (Math.min(...selected)-1)+','+Math.max(...selected);
}
export function buildLgdPayload(filters,page=1) {
  const unsupported=lgdUnsupported(filters,{singleColor:true});
  if(unsupported.length) throw new UnsupportedSearchError(unsupported);
  const clarities=rangeValues(FILTER_OPTIONS.clarity,filters.clarityMin,filters.clarityMax).map(x=>LGD_CLARITY[x]).filter(Boolean);
  const payload={ls_start:page,ls_per_page:50,
    shape:filters.shapes.map(shape=>(filters.fancy?LGD_SHAPES:LGD_WHITE_SHAPES)[shape]),
    carat_range:filters.caratMin+','+filters.caratMax,price_range:filters.priceMin+','+filters.priceMax,
    clarity_range:lgdRange(clarities,11),cut_range:lgdRange(rangeValues(FILTER_OPTIONS.cuts.map(x=>x.value),filters.cutMin,filters.cutMax).map(x=>LGD_CUTS[x]),4),
    table_range:filters.tableMin+','+filters.tableMax,lwratio_range:filters.ratioMin+','+filters.ratioMax,
    polish_range:lgdRange(filters.polish.map(x=>FILTER_OPTIONS.grades.findIndex(y=>y.value===x)+1),3),
    symmetry_range:lgdRange(filters.symmetry.map(x=>FILTER_OPTIONS.grades.findIndex(y=>y.value===x)+1),3),
    fluorescence_range:lgdRange(filters.fluorescence.map(x=>FILTER_OPTIONS.fluorescence.findIndex(y=>y.value===x)+1),5),
    certificate_type:filters.labs.map(lab=>LGD_LABS[lab]),dtype:filters.growthTypes.map(x=>x.toLowerCase()),
  };
  if(filters.fancy) {payload.colored=String(LGD_COLORS[filters.colors[0]]);payload.intensity=filters.intensities.map(x=>LGD_INTENSITIES[x]);}
  else {const colors=rangeValues(FILTER_OPTIONS.whiteColors,filters.whiteColorMin,filters.whiteColorMax).map(x=>LGD_WHITE[x]).filter(Boolean);payload.color=lgdRange(colors,10);}
  return payload;
}
export function normalizeLgdItem(item,source) {
  if(!item || (!item.id&&!item.sku)) throw new Error('상품 정보가 불완전합니다.');
  if(Object.hasOwn(item,'currency')&&item.currency!=='USD') throw new Error('USD 이외의 가격은 비교할 수 없습니다.');
  const price=positivePrice(item.price);
  const lookup=(map,value) => Object.entries(map).find(([,id])=>String(id)===String(value))?.[0] || String(value||'');
  const color=Number(item.intensity)>0 ? lookup(LGD_INTENSITIES,item.intensity).replaceAll('_',' ')+' '+lookup(LGD_COLORS,item.color) : lookup(LGD_WHITE,item.color);
  const sku=String(item.sku||item.id);
  return {id:String(item.id||item.sku),siteId:source.id,siteName:source.name,price,currency:'USD',carat:positivePrice(item.carat),
    shape:String(item.shape_title||item.shape||''),color,clarity:lookup(LGD_CLARITY,item.clarity),cut:lookup(LGD_CUTS,item.cut),lab:lookup(LGD_LABS,item.certificate_type),
    url:source.origin+'/diamond/'+encodeURIComponent(sku)+'/'};
}
function literalConcat(expression) {
  const pattern=/'([^']*)'|"([^"]*)"|String\.fromCharCode\(([0-9]+)\)/g;
  let result='',last=0;
  for(const token of expression.matchAll(pattern)) {
    if(!/^[\s+]*$/.test(expression.slice(last,token.index))) throw new Error('Unsupported challenge expression');
    result+=token[1]??token[2]??String.fromCharCode(Number(token[3]));last=token.index+token[0].length;
  }
  if(!/^[\s+]*$/.test(expression.slice(last))) throw new Error('Unsupported challenge expression');
  return result;
}
export function parseLgdCookie(html) {
  const encoded=String(html).match(/\bS\s*=\s*'([^']+)'/);
  if(!encoded) return '';
  const script=atob(encoded[1]),valueEq=script.indexOf('='),valueEnd=script.indexOf(';document.cookie'),cookieStart=script.indexOf('document.cookie='),eqPos=script.indexOf('"="',cookieStart);
  if([valueEq,valueEnd,cookieStart,eqPos].some(x=>x<0)||valueEq>=valueEnd) throw new Error('Unrecognized inventory challenge');
  const value=literalConcat(script.slice(valueEq+1,valueEnd));
  const name=literalConcat(script.slice(cookieStart+16,eqPos));
  const cookie=name+'='+value;
  if(!/^[a-zA-Z0-9_]+=[a-zA-Z0-9._-]+$/.test(cookie)) throw new Error('Invalid inventory cookie');
  return cookie;
}
export function buildSourceLinks(filters) {
  return SOURCE_DEFINITIONS.map(source=>{
    const url=new URL(source.kind==='loosegrown'&&!filters.fancy?source.origin+'/lab-diamonds/':source.pageUrl);
    const unsupported=source.kind==='loosegrown'?lgdUnsupported(filters):[];
    if(source.kind==='nivoda') {
      const params={activeTab:'Lab Grown',queryLabGrown:'true',isFancy:String(filters.fancy),shapes:filters.shapes.map(x=>x.toLowerCase().replaceAll(' ','_')).join(','),
        carats_min:filters.caratMin,carats_max:filters.caratMax,clarity_min:filters.clarityMin,clarity_max:filters.clarityMax,cut_min:filters.cutMin,cut_max:filters.cutMax,
        price_min:filters.priceMin,price_max:filters.priceMax,table_percentage_min:filters.tableMin,table_percentage_max:filters.tableMax,ratio_min:filters.ratioMin,ratio_max:filters.ratioMax,
        polish:filters.polish.join(','),symmetry:filters.symmetry.join(','),flouresence:filters.fluorescence.join(','),certificate_lab:filters.labs.join(','),labgrown_type:filters.growthTypes.join(',')};
      if(filters.fancy) {const order=FILTER_OPTIONS.intensities.map(x=>x.value);const selected=order.filter(value=>filters.intensities.includes(value));params.fancy_color=filters.colors.join(',');params.intensity_min=selected[0]||'';params.intensity_max=selected.at(-1)||'';if(selected.length && order.indexOf(selected.at(-1))-order.indexOf(selected[0])+1!==selected.length)unsupported.push('원사이트 링크의 컬러 강도는 연속 범위입니다');}
      else {const supported=rangeValues(FILTER_OPTIONS.whiteColors,filters.whiteColorMin,filters.whiteColorMax).filter(color=>Object.hasOwn(LGD_WHITE,color));params.color_min=supported.at(-1)||'M';params.color_max=supported[0]||'M';if(rangeValues(FILTER_OPTIONS.whiteColors,filters.whiteColorMin,filters.whiteColorMax).some(color=>!Object.hasOwn(LGD_WHITE,color)))unsupported.push('원사이트 링크의 화이트 색상 범위는 D–M입니다');}
      if(!filters.labs.length) unsupported.push('원사이트 링크는 해당 사이트의 기본 감정기관을 사용합니다');
      for(const [key,value] of Object.entries(params)) if(value!=='') url.searchParams.set(key,String(value));
    } else {
      const single={...filters,colors:[filters.colors[0]||'Pink']};
      if(!unsupported.length) {
        const payload=buildLgdPayload(single);
        const params={shape:payload.shape.join(','),carat:payload.carat_range,clarity:payload.clarity_range,cut:payload.cut_range,price:payload.price_range,
          table:payload.table_range,lwratio:payload.lwratio_range,polish:payload.polish_range,symmetry:payload.symmetry_range,fluorescence:payload.fluorescence_range,certificate:payload.certificate_type.join(','),method:payload.dtype.join(',')};
        if(filters.fancy) {params.color=(filters.colors[0]||'Pink').toLowerCase();params.intensity=payload.intensity.join(',');}else params.color=payload.color;
        for(const [key,value] of Object.entries(params)) if(value!=='')url.searchParams.set(key,value);
        if(filters.fancy && filters.colors.length!==1) unsupported.push('원사이트 링크는 첫 색상만 표시');
      }
    }
    return {id:source.id,name:source.name,url:url.href,unsupported};
  });
}

const MAX_PER_SOURCE=400;
let configPromise;
async function configuredEndpoint(fetchImpl) {
  if(!configPromise) configPromise=(async()=>{
    const response=await fetchImpl(new URL('./search-config.json',import.meta.url),{cache:'no-store'});
    if(!response.ok) throw new Error('검색 서버 설정을 불러올 수 없습니다.');
    const config=await response.json(),url=new URL(config.apiBase);
    if(url.protocol!=='https:' || url.username || url.password) throw new Error('검색 서버 설정이 올바르지 않습니다.');
    url.pathname='/api/search';url.search='';url.hash='';return url.href;
  })().catch(error=>{configPromise=undefined;throw error;});
  return configPromise;
}
function abortIfRequested(signal) {
  if(signal?.aborted) throw new DOMException('검색을 취소했습니다.','AbortError');
}
function searchVariants(source,filters) {
  if(source.kind!=='loosegrown'||!filters.fancy) return [filters];
  const colors=filters.colors.length?filters.colors:Object.keys(LGD_COLORS);
  return colors.map(color=>({...filters,colors:[color]}));
}
function parseSearchPage(body,source,offset) {
  if(!body || body.siteId!==source.id || body.currency!=='USD' || !Array.isArray(body.items) || typeof body.hasMore!=='boolean'
      || !Number.isSafeInteger(body.nextOffset) || body.nextOffset-offset!==body.items.length || body.nextOffset<offset || (body.hasMore && body.nextOffset===offset)
      || (body.total!==null && (!Number.isSafeInteger(body.total)||body.total<0))) throw new Error('검색 응답의 형식이 올바르지 않습니다.');
  for(const item of body.items) {
    if(!item || item.siteId!==source.id || item.currency!=='USD' || typeof item.id!=='string' || !item.id || !Number.isFinite(item.price)||item.price<=0
       || !Number.isFinite(item.carat)||item.carat<=0 || typeof item.url!=='string') throw new Error('상품 응답의 형식이 올바르지 않습니다.');
    const url=new URL(item.url);
    if(url.origin!==source.origin||url.protocol!=='https:') throw new Error('상품 링크의 출처가 올바르지 않습니다.');
  }
  return body;
}
export async function searchDiamonds(rawFilters,{signal,onProgress,endpoint,fetchImpl=globalThis.fetch,maxPerSource=MAX_PER_SOURCE}={}) {
  const {filters,errors}=validateFilters(rawFilters);
  if(errors.length) throw new Error(errors.join(' '));
  if(!Number.isSafeInteger(maxPerSource)||maxPerSource<1||maxPerSource>MAX_PER_SOURCE) throw new Error('잘못된 조회 한도입니다.');
  abortIfRequested(signal);
  const api=endpoint||await configuredEndpoint(fetchImpl);
  const runSource=async source=>{
    const state={id:source.id,siteId:source.id,name:source.name,status:'loading',count:null,loaded:0,complete:false,message:'',observedAt:''};
    onProgress?.({...state});
    const unsupported=source.kind==='loosegrown'?lgdUnsupported(filters):[];
    if(unsupported.length) {
      Object.assign(state,{status:'unsupported',message:'지원하지 않는 조건: '+unsupported.join(', ')});
      onProgress?.({...state});return {state,items:[]};
    }
    const variants=searchVariants(source,filters),items=[],seen=new Set();
    let total=0,variantsCounted=0,complete=true;
    try {
      for(const variant of variants) {
        let offset=0,variantTotal=null,hasMore=true;
        while(hasMore) {
          abortIfRequested(signal);
          if(state.loaded>=maxPerSource) {complete=false;break;}
          const response=await fetchImpl(api,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({siteId:source.id,filters:variant,offset}),signal,cache:'no-store'});
          const payload=await response.json();
          if(!response.ok) {
            const error=new Error(payload.error||'판매처 검색에 실패했습니다.');error.unsupported=response.status===422;throw error;
          }
          const page=parseSearchPage(payload,source,offset);
          if(offset===0) {
            if(page.total===null) throw new Error('검색 건수를 확인할 수 없습니다.');
            variantTotal=page.total;total+=page.total;variantsCounted++;
          } else if(page.total!==null && page.total!==variantTotal) throw new Error('검색 중 재고가 변경되었습니다. 다시 검색해 주세요.');
          if(page.items.length===0 && offset<variantTotal) throw new Error('일부 상품을 불러오지 못했습니다.');
          for(const item of page.items) {
            if(state.loaded>=maxPerSource) {complete=false;break;}
            if(seen.has(item.id)) throw new Error('검색 중 중복 상품이 반환되었습니다. 다시 검색해 주세요.');
            seen.add(item.id);state.loaded++;
            // Apply displayed-price bounds after storefront markup, too.
            if(item.price>=filters.priceMin&&item.price<=filters.priceMax&&item.carat>=filters.caratMin&&item.carat<=filters.caratMax) items.push(item);
          }
          state.observedAt=page.observedAt;
          if(page.nextOffset>variantTotal) throw new Error('검색 건수와 상품 목록이 일치하지 않습니다.');
          offset=page.nextOffset;
          hasMore=page.hasMore && offset<variantTotal;
          if(!hasMore && offset<variantTotal) throw new Error('일부 상품 페이지를 불러오지 못했습니다.');
          state.count=variantsCounted===variants.length?total:null;
          onProgress?.({...state,message:state.loaded+'개 상품 확인 중'});
        }
        if(!complete) break;
      }
      if(variantsCounted!==variants.length) complete=false;
      Object.assign(state,{count:variantsCounted===variants.length?total:null,complete,
        status:complete?(items.length?'ok':'no_matches'):'partial',
        message:complete?'':'사이트당 '+maxPerSource+'개까지 조회했습니다. 조건을 좁혀 다시 검색해 주세요.'});
    } catch(error) {
      if(signal?.aborted || error.name==='AbortError') throw new DOMException('검색을 취소했습니다.','AbortError');
      Object.assign(state,{complete:false,status:items.length?'partial':error.unsupported?'unsupported':'error',message:error.message});
    }
    onProgress?.({...state});
    return {state,items};
  };
  const searched=await Promise.all(SOURCE_DEFINITIONS.map(runSource));
  abortIfRequested(signal);
  return {results:searched.flatMap(x=>x.items).sort((a,b)=>a.price-b.price),sources:searched.map(x=>x.state),
    complete:searched.every(x=>x.state.complete),observedAt:searched.map(x=>x.state.observedAt).filter(Boolean).sort().at(-1)||new Date().toISOString()};
}
