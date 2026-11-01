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
    const identifier = '(?:"(?:""|[^"])+"|[A-Za-z_][A-Za-z_0-9$]*)';
    const relation = `${identifier}(?:\\s*\\.\\s*${identifier})?`;
    const column = ddl.match(new RegExp(`^ALTER\\s+TABLE\\s+(${relation})\\s+ADD\\s+COLUMN\\s+IF\\s+NOT\\s+EXISTS\\s+(${identifier})\\s`, 'i'));
    const index = ddl.match(new RegExp(`^CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+IF\\s+NOT\\s+EXISTS\\s+(${identifier})\\s+ON\\s+(?:ONLY\\s+)?(${relation})\\s*(?:\\(|USING\\s)`, 'i'));
    const literal = value => `'${value.replaceAll("'", "''")}'`;
    const name = value => value.startsWith('"') ? value.slice(1, -1).replaceAll('""', '"') : value.toLowerCase();
    const condition = column
      ? `NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=${literal(column[1])}::regclass AND attname=${literal(name(column[2]))} AND NOT attisdropped)`
      : index ? `NOT EXISTS (SELECT 1 FROM pg_class existing_index WHERE existing_index.relnamespace=(SELECT relnamespace FROM pg_class WHERE oid=${literal(index[2])}::regclass) AND existing_index.relname=${literal(name(index[1]))})` : null;
    if (!condition) return statement;
    // Keep the original statement, including its types, defaults and references.
    // DO bodies are deliberately not rewritten, including existing guards.
    let tag = '$additive_replay$';
    while (statement.includes(tag)) tag = tag.replace(/\$$/, '_$');
    return `DO ${tag} BEGIN IF ${condition} THEN ${statement}; END IF; END ${tag}`;
  }).join(';');
}
