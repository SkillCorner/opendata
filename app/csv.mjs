// RFC-style CSV fields, including quoted commas, newlines and escaped quotes.
export function parseCsv(text){
 const rows=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
 else if(c===','&&!quoted){row.push(field);field='';}
 else if(c==='\n'&&!quoted){row.push(field.replace(/\r$/,''));if(row.some(Boolean))rows.push(row);row=[];field='';}
 else field+=c;}
 if(field||row.length){row.push(field.replace(/\r$/,''));rows.push(row);}
 const keys=rows.shift()??[];if(keys[0])keys[0]=keys[0].replace(/^\uFEFF/,'');
 return rows.map(values=>Object.fromEntries(keys.map((key,i)=>[key,values[i]??''])));
}
