/** Keep existing additive migrations intact, but avoid no-op DDL table locks. */
export function guardAdditiveReplay(source) {
  const statements = [];
  let start = 0;
  // Quoted values, identifiers, comments, and dollar-quoted bodies are opaque.
  const tokens = /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|\$(?:[A-Za-z_]\w*)?\$|;/g;
  let token;
  while ((token = tokens.exec(source))) {
    if (token[0].startsWith('$')) {
      const end = source.indexOf(token[0], tokens.lastIndex);
      if (end < 0) throw new Error('Unterminated migration dollar quote');
      tokens.lastIndex = end + token[0].length;
    } else if (token[0] === ';') {
      statements.push(source.slice(start, token.index));
      start = tokens.lastIndex;
    }
  }
  statements.push(source.slice(start));
  return statements.map(statement => {
    const ddl = statement.replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/, '').trim();
    const column = ddl.match(/^ALTER\s+TABLE\s+(?:"?public"?\.)?"?(\w+)"?\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+"?(\w+)"?\s/i);
    const index = ddl.match(/^CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+"?(\w+)"?\s/i);
    const condition = column
      ? `NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.${column[1]}'::regclass AND attname='${column[2]}' AND NOT attisdropped)`
      : index ? `to_regclass('public.${index[1]}') IS NULL` : null;
    if (!condition) return statement;
    // Keep the original statement, including its types, defaults and references.
    // DO bodies are deliberately not rewritten, including existing guards.
    let tag = '$additive_replay$';
    while (statement.includes(tag)) tag = tag.replace(/\$$/, '_$');
    return `DO ${tag} BEGIN IF ${condition} THEN ${statement}; END IF; END ${tag}`;
  }).join(';');
}
