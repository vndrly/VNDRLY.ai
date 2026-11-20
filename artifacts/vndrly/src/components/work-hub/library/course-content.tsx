import React from 'react';
import {catalogTitle} from '@/lib/catalog-title';

export function cleanCourseContent(body:string,title:string) {
  const lines=body.replace(/\r\n?/g,'\n').split('\n');
  const first=lines.findIndex(line=>line.trim());
  if(first>=0&&catalogTitle(lines[first].replace(/^\s*#{1,6}\s+/, '').replace(/\s+#+\s*$/, '').trim())===catalogTitle(title).trim())lines[first]='';
  return lines.map(line=>{
    if(/^\s*(?:Complete\s+)?learner(?: and tester)? coursebook\s*(?:[·|]|$)/i.test(line))return '';
    if(/^\s*Revision:\s*\d{4}-\d{2}-\d{2}\./i.test(line))return line.replace(/^\s*Revision:\s*\d{4}-\d{2}-\d{2}\.\s*(?:Program:\s*[\w-]+\.\s*)?/i,'');
    return line.replace(/\s+[—–-]\s+(?:learner and delivery guide|program and instructor guide|(?:complete\s+)?learner(?: and tester)? coursebook)(?=\s*$|[.,;])/gi,'')
      .replace(/Integrated learner exercise:/gi,'Practical exercise:').replace(/\s*[—–]\s*/g, ': ');
  }).join('\n').trim();
}

function inline(text:string):React.ReactNode[] {
  const pattern=/\[([^\]]+)\]\(([^\s)]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\*([^*\n]+)\*|_([^_\n]+)_|~~([^~]+)~~/g;
  const nodes:React.ReactNode[]=[];let end=0;
  for(const match of text.matchAll(pattern)) {
    nodes.push(text.slice(end,match.index));const key=match.index;
    if(match[1])nodes.push(/^(https?:\/\/|mailto:|\/(?!\/))/.test(match[2])?<a key={key} href={match[2]} className="text-[var(--brand-primary)] underline">{match[1]}</a>:<span key={key}>{match[1]}</span>);
    else if(match[3]||match[4])nodes.push(<strong key={key}>{match[3]||match[4]}</strong>);
    else if(match[5])nodes.push(<code key={key}>{match[5]}</code>);
    else if(match[8])nodes.push(<del key={key}>{match[8]}</del>);
    else nodes.push(<em key={key}>{match[6]||match[7]}</em>);
    end=match.index!+match[0].length;
  }
  nodes.push(text.slice(end));return nodes;
}

export default function CourseContent({body,title}:{body:string;title:string}) {
  const lines=cleanCourseContent(body,title).split('\n');const blocks:React.ReactNode[]=[];
  const cells=(line:string)=>line.trim().replace(/^\||\|$/g,'').split('|').map(cell=>cell.trim());
  for(let i=0;i<lines.length;) {
    const line=lines[i].trim();if(!line){i++;continue;}
    const key=i;
    if(/^```|^~~~/.test(line)) {
      const fence=line.slice(0,3),code:string[]=[];i++;
      while(i<lines.length&&!lines[i].trim().startsWith(fence))code.push(lines[i++]);i++;
      blocks.push(<pre key={key} className="overflow-x-auto whitespace-pre-wrap"><code>{code.join('\n')}</code></pre>);continue;
    }
    if(/^#{1,6}\s/.test(line)) {blocks.push(<h3 key={key} className="font-semibold">{inline(line.replace(/^#{1,6}\s+/,'').replace(/\s+#+$/,''))}</h3>);i++;continue;}
    if(/^([-*_])(?:\s*\1){2,}$/.test(line)){blocks.push(<hr key={key} className="border-white/20"/>);i++;continue;}
    if(line.includes('|')&&i+1<lines.length&&/^\|?\s*:?-{3,}/.test(lines[i+1].trim())) {
      const headers=cells(line);i+=2;const rows:string[][]=[];
      while(i<lines.length&&lines[i].includes('|'))rows.push(cells(lines[i++]));
      blocks.push(<div key={key} className="overflow-x-auto"><table className="w-full text-left"><thead><tr>{headers.map((cell,j)=><th key={j} className="border-b border-white/20 p-2">{inline(cell)}</th>)}</tr></thead><tbody>{rows.map((row,j)=><tr key={j}>{row.map((cell,k)=><td key={k} className="border-b border-white/20 p-2">{inline(cell)}</td>)}</tr>)}</tbody></table></div>);continue;
    }
    if(/^(?:[-*+]\s|\d+[.)]\s)/.test(line)) {
      const ordered=/^\d/.test(line),items:React.ReactNode[]=[];
      const re=ordered?/^\s*\d+[.)]\s+/:/^\s*[-*+]\s+/;
      while(i<lines.length&&re.test(lines[i])){items.push(<li key={i}>{inline(lines[i++].replace(re,'').replace(/^\[[ xX]\]\s*/,''))}</li>);}
      blocks.push(ordered?<ol key={key} start={parseInt(line,10)} className="list-decimal pl-6 space-y-1">{items}</ol>:<ul key={key} className="list-disc pl-6 space-y-1">{items}</ul>);continue;
    }
    if(/^>\s?/.test(line)){blocks.push(<blockquote key={key} className="border-l-2 border-white/30 pl-3">{inline(line.replace(/^>\s?/,''))}</blockquote>);i++;continue;}
    const paragraph=[lines[i++]];
    while(i<lines.length&&lines[i].trim()&&!/^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|~~~)/.test(lines[i].trim())&&!lines[i].includes('|'))paragraph.push(lines[i++]);
    blocks.push(<p key={key}>{inline(paragraph.join(' '))}</p>);
  }
  return <div className="space-y-3">{blocks}</div>;
}
