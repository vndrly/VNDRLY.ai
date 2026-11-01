import React from "react";

function Inline({ text }: { text: string }) {
  return <>{text.split(/(https?:\/\/[^\s]+|\*\*[^*]+\*\*)/g).map((part,index) =>
    /^https?:\/\//.test(part) ? <a key={index} href={part} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">{part}</a>
      : part.startsWith("**") && part.endsWith("**") ? <strong key={index}>{part.slice(2,-2)}</strong> : <React.Fragment key={index}>{part}</React.Fragment>)}</>;
}

/** Render authored text as readable sections/tables without accepting raw HTML. */
export function LibraryBody({ text, color }: { text: string; color: string }) {
  const lines=text.replace(/\r\n/g,"\n").split("\n");
  const blocks:React.ReactNode[]=[];
  for(let i=0;i<lines.length;){
    const line=lines[i];
    if(!line.trim()){i++;continue;}
    if(line.startsWith("|")){
      const rows:string[][]=[];
      while(i<lines.length&&lines[i].startsWith("|")){
        if(!/^[\s|:\-]+$/.test(lines[i]))rows.push(lines[i].trim().replace(/^\||\|$/g,"").split("|").map(c=>c.trim()));
        i++;
      }
      blocks.push(<div key={i} className="overflow-x-auto"><table className="w-full border-collapse text-sm"><thead><tr>{rows[0]?.map((cell,n)=><th key={n} className="border p-2 text-left"><Inline text={cell}/></th>)}</tr></thead><tbody>{rows.slice(1).map((row,n)=><tr key={n}>{row.map((cell,k)=><td key={k} className="border p-2 align-top"><Inline text={cell}/></td>)}</tr>)}</tbody></table></div>);continue;
    }
    const heading=line.match(/^#{1,6}\s+(.+)$/);
    if(heading){blocks.push(<h3 key={i} className="text-base font-semibold"><Inline text={heading[1]}/></h3>);i++;continue;}
    if(line.startsWith("> ")){blocks.push(<blockquote key={i} className="border-l-4 pl-3"><Inline text={line.slice(2)}/></blockquote>);i++;continue;}
    if(line.startsWith("- ")){
      const list:string[]=[];while(i<lines.length&&lines[i].startsWith("- "))list.push(lines[i++].slice(2));
      blocks.push(<ul key={i} className="list-disc space-y-1 pl-5">{list.map((item,n)=><li key={n}><Inline text={item}/></li>)}</ul>);continue;
    }
    const paragraph:string[]=[];
    while(i<lines.length&&lines[i].trim()&&!/^(?:\||#{1,6}\s|> |- )/.test(lines[i]))paragraph.push(lines[i++]);
    blocks.push(<p key={i} className="whitespace-pre-wrap"><Inline text={paragraph.join("\n")}/></p>);
  }
  return <div style={{color,overflowWrap:"anywhere"}} className="space-y-4">{blocks}</div>;
}
