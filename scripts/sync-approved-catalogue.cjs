#!/usr/bin/env node
// Export only explicitly approved products. Never publish the master spreadsheet.
const crypto = require('node:crypto');
const fs = require('node:fs');
const spreadsheetId = process.env.GMS_SPREADSHEET_ID || '1Qh2EbTlK5ULRyCR5UokWtk-CISdVov6hv6yrLFPRYhU';
const credentials = process.env.GMS_GOOGLE_SERVICE_ACCOUNT_JSON;
if (!credentials) throw Error('Missing GMS_GOOGLE_SERVICE_ACCOUNT_JSON GitHub Actions secret');
const key = JSON.parse(credentials);
if (!key.client_email || !key.private_key) throw Error('Invalid service account JSON');
const base64url = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
const now = Math.floor(Date.now()/1000);
const header = base64url({alg:'RS256',typ:'JWT'});
const claim = base64url({iss:key.client_email,scope:'https://www.googleapis.com/auth/spreadsheets.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3500});
const input = header+'.'+claim;
const signature = crypto.sign('RSA-SHA256',Buffer.from(input),key.private_key).toString('base64url');
async function run(){
 const tokenResponse = await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:input+'.'+signature})});
 if(!tokenResponse.ok) throw Error('Google authentication failed: HTTP '+tokenResponse.status);
 const {access_token} = await tokenResponse.json();
 const url='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(spreadsheetId)+'/values/'+encodeURIComponent('Products!A1:AH1000');
 const response=await fetch(url,{headers:{Authorization:'Bearer '+access_token}});
 if(!response.ok) throw Error('Private spreadsheet read failed: HTTP '+response.status);
 const {values=[]}=await response.json();
 const headerRow=values.shift()||[];
 const required=['Product ID','SKU','Brand','Model','Technology','Variant / remarks','Image URL','Website status','Category ID','Product Display Name','Publish: Website','Website Filter Readiness','Product Type'];
 const index=Object.fromEntries(headerRow.map((h,i)=>[h,i]));
 for(const field of required) if(index[field]===undefined) throw Error('Missing expected column: '+field);
 const categoryNames={'CAT-DSP':'LCD & OLED Display Assemblies','CAT-BAT':'Replacement Batteries','CAT-CHG':'Charging Ports & Sub-Boards','CAT-CAM':'Camera Modules','CAT-FLX':'Flex Cables & Connectors','CAT-AUD':'Speakers & Microphones','CAT-HSG':'Housings & Frames','CAT-IC':'Motherboard Components & ICs'};
 const seen=new Set();
 const products=[];
 for(const row of values){
  const get=name=>String(row[index[name]]||'').trim();
  if(get('Website status')!=='Published'||get('Publish: Website')!=='Yes'||get('Website Filter Readiness')!=='Ready')continue;
  const id=get('Product ID'),name=get('Product Display Name'),brand=get('Brand'),model=get('Model'),category=categoryNames[get('Category ID')];
  if(!id||!name||!brand||!model||!category) throw Error('Approved product missing required public fields: '+(id||'unknown'));
  if(seen.has(id))throw Error('Duplicate approved product ID: '+id);
  seen.add(id);
  const rawImage=get('Image URL');
  // Only Google Drive image links from the expected trusted host are allowed.
  let image='';
  if(rawImage){
   const parsed=new URL(rawImage);
   if(parsed.hostname!=='drive.google.com'||parsed.protocol!=='https:')throw Error('Unexpected image host for '+id);
   const driveId=parsed.searchParams.get('id')||parsed.pathname.match(/\\/d\\/([a-zA-Z0-9_-]+)/)?.[1];
   if(!driveId||!/^[a-zA-Z0-9_-]{15,}$/.test(driveId))throw Error('Invalid image reference for '+id);
   image='https://drive.google.com/uc?export=view&id='+encodeURIComponent(driveId);
  }
  products.push({id,sku:get('SKU'),name,description:[get('Product Type'),get('Technology'),get('Variant / remarks')].filter(Boolean).join(' · '),category,brand,model,image});
 }
 products.sort((a,b)=>a.id.localeCompare(b.id));
 fs.mkdirSync('data',{recursive:true});
 fs.writeFileSync('data/approved-products.json',JSON.stringify({schemaVersion:1,source:'GMS Store approved-only catalogue export',products},null,2)+'\n');
 console.log('Exported '+products.length+' approved products; no private price, stock, supplier or compatibility fields.');
}
run().catch(e=>{console.error(e.message);process.exitCode=1});
