(() => {
  const codeWrapper = '.md-code-block, .ds-code-block';
  const controls = 'button, [role="button"], [aria-hidden="true"], [hidden], script, style, svg';
  const blockTags = /^(DIV|P|SECTION|ARTICLE|H[1-6]|UL|OL|BLOCKQUOTE|PRE|HR|TABLE)$/;
  const escapeMarkdown = value => value.replace(/[\\\x60*_[\]~#>|+\-]/g, '\\$&');

  function codeText(node, depth = 0) {
    if (depth > 40) return '';
    if (node.nodeType === 3) return node.nodeValue;
    if (node.nodeType !== 1 || node.matches(controls)) return '';
    if (node.nodeName === 'BR') return '\n';
    return [...node.childNodes].map(child => codeText(child, depth + 1)).join('');
  }

  function delimiterLength(source, runs, minimum) {
    let length = minimum;
    for (const match of source.matchAll(runs)) length = Math.max(length, match[0].length + 1);
    return length;
  }

  function extract(element) {
    const body = element.querySelector?.('.ds-markdown') || element;
    function visit(node, depth = 0) {
      if (depth > 40) return '';
      if (node.nodeType === 3) {
        // Ignore indentation between block elements, but keep spaces between inline nodes.
        if (!node.nodeValue.trim() && [node.previousSibling, node.nextSibling].some(sibling => blockTags.test(sibling?.nodeName))) return '';
        return escapeMarkdown(node.nodeValue.replace(/\s+/g, ' '));
      }
      if (node.nodeType !== 1 || node.matches(controls)) return '';
      const tag = node.nodeName;
      const pre = tag === 'PRE' ? node : node.matches(codeWrapper) ? node.querySelector('pre') : null;
      if (pre) {
        const code = pre.querySelector('code') || pre;
        const source = codeText(code);
        const bannerLanguage = node.querySelector('.md-code-block-banner')?.firstElementChild?.textContent.trim();
        const language = (code.getAttribute('class') || '').match(/(?:^|\s)language-([\w+#.-]+)/)?.[1]
          || [code, pre, node].map(el => el.getAttribute('data-language')).concat(bannerLanguage)
            .find(value => /^[\w+#.-]{1,40}$/.test(value || '')) || '';
        const fence = '~'.repeat(delimiterLength(source, /~{3,}/g, 3));
        return '\n\n' + fence + language + '\n' + source + '\n' + fence + '\n\n';
      }
      if (tag === 'BR') return '\n';
      if (tag === 'HR') return '\n\n---\n\n';
      if (tag === 'CODE') {
        const source = node.textContent;
        const tick = String.fromCharCode(96);
        const delimiter = tick.repeat(delimiterLength(source, /\x60+/g, 1));
        return delimiter + ' ' + source + ' ' + delimiter;
      }
      if (tag === 'OL' || tag === 'UL') {
        const start = Number(node.getAttribute('start')) || 1;
        const items = [...node.children].filter(child => child.nodeName === 'LI').map((li, index) => {
          const prefix = tag === 'OL' ? (start + index) + '. ' : '- ';
          const lines = visit(li, depth + 1).trim().split('\n');
          return prefix + lines.join('\n' + ' '.repeat(prefix.length));
        });
        return '\n\n' + items.join('\n') + '\n\n';
      }
      const text = [...node.childNodes].map(child => visit(child, depth + 1)).join('');
      if (!text.trim()) return text;
      if (/^H[1-6]$/.test(tag)) return '\n\n' + '#'.repeat(Number(tag[1])) + ' ' + text.trim() + '\n\n';
      if (tag === 'STRONG' || tag === 'B') return '**' + text + '**';
      if (tag === 'EM' || tag === 'I') return '*' + text + '*';
      if (tag === 'BLOCKQUOTE') return '\n\n' + text.trim().split('\n').map(line => '> ' + line).join('\n') + '\n\n';
      return blockTags.test(tag) ? '\n\n' + text.trim() + '\n\n' : text;
    }
    return visit(body).trim();
  }

  function render(target, markdown, streaming) {
    const doc = target.ownerDocument;
    const fragment = doc.createDocumentFragment();
    const node = (tag, text, className) => {
      const element = doc.createElement(tag);
      if (text !== undefined) element.textContent = text;
      if (className) element.className = className;
      return element;
    };
    function inline(parent, text, depth = 0) {
      if (depth >= 8) {
        parent.append(doc.createTextNode(text));
        return;
      }
      const tokens = /\\([\\\x60*_[\]~#>|+\-])|(\x60+)([^\n]*?)\2(?!\x60)|(\*\*|~~|\*|(?<![\p{L}\p{N}])__?)(?=\S)(.+?)(?<=\S)\4/gu;
      let offset = 0;
      for (const match of text.matchAll(tokens)) {
        if (match.index > offset) parent.append(doc.createTextNode(text.slice(offset, match.index)));
        if (match[1]) parent.append(doc.createTextNode(match[1]));
        else if (match[2]) parent.append(node('code', /^ .* $/.test(match[3]) && /\S/.test(match[3]) ? match[3].slice(1, -1) : match[3]));
        else {
          const emphasis = node(match[4] === '~~' ? 's' : match[4].length === 2 ? 'strong' : 'em');
          inline(emphasis, match[5], depth + 1);
          parent.append(emphasis);
        }
        offset = match.index + match[0].length;
      }
      if (offset < text.length) parent.append(doc.createTextNode(text.slice(offset)));
    }

    function codeBlock(source, language, complete) {
      const block = node('div', undefined, 'code-block');
      const toolbar = node('div', undefined, 'code-toolbar');
      toolbar.append(node('span', language, 'code-language'));
      const copy = node('button', '复制');
      const download = node('button', '下载');
      copy.type = download.type = 'button';
      copy.disabled = download.disabled = !complete;
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(source);
          copy.textContent = '已复制';
        } catch {
          copy.textContent = '复制失败';
        }
      });
      download.addEventListener('click', () => {
        const extensions = {python:'py', javascript:'js', typescript:'ts', bash:'sh', shell:'sh', markdown:'md', ruby:'rb', rust:'rs', 'c++':'cpp', 'c#':'cs'};
        const key = language.toLowerCase();
        const extension = Object.hasOwn(extensions, key) ? extensions[key] : /^[a-z0-9]{1,12}$/.test(key) ? key : 'txt';
        const url = URL.createObjectURL(new Blob([source], {type:'text/plain;charset=utf-8'}));
        const link = node('a');
        link.href = url;
        link.download = 'code.' + extension;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
      toolbar.append(copy, download);
      const pre = node('pre');
      pre.tabIndex = 0;
      pre.append(node('code', source));
      block.append(toolbar, pre);
      return block;
    }

    const fenceStart = /^ {0,3}(\x60{3,}|~{3,})\s*([\w+#.-]*)[^\n]*$/;
    const heading = /^ {0,3}(#{1,6})\s+(.+)$/;
    const listItem = /^ {0,3}([-+*]|\d{1,9}[.)])([ \t]+)(.*)$/;
    const rule = /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
    const quote = /^ {0,3}> ?/;
    const startsBlock = line => !line.trim() || fenceStart.test(line) || heading.test(line) || listItem.test(line) || rule.test(line) || quote.test(line);

    function blocks(parent, lines, depth = 0) {
      if (depth >= 12) {
        parent.append(node('p', lines.join('\n')));
        return;
      }
      for (let i = 0; i < lines.length;) {
        const line = lines[i++];
        if (!line.trim()) continue;
        const fence = line.match(fenceStart);
        const title = line.match(heading);
        const item = line.match(listItem);
        if (fence) {
          const end = new RegExp('^ {0,3}' + fence[1][0] + '{' + fence[1].length + ',}[ \\t]*$');
          const code = [];
          while (i < lines.length && !end.test(lines[i])) code.push(lines[i++]);
          const closed = i < lines.length;
          if (closed) i++;
          parent.append(codeBlock(code.join('\n'), fence[2], closed || !streaming));
        } else if (title) {
          const h = node('h' + title[1].length);
          inline(h, title[2].replace(/ +#+\s*$/, ''));
          parent.append(h);
        } else if (rule.test(line)) {
          parent.append(node('hr'));
        } else if (quote.test(line)) {
          const quoted = [line.replace(quote, '')];
          while (i < lines.length && quote.test(lines[i])) quoted.push(lines[i++].replace(quote, ''));
          const blockquote = node('blockquote');
          blocks(blockquote, quoted, depth + 1);
          parent.append(blockquote);
        } else if (item) {
          const ordered = /^\d/.test(item[1]);
          const list = node(ordered ? 'ol' : 'ul');
          if (ordered) list.start = parseInt(item[1], 10);
          for (let part = item; part;) {
            const content = [part[3]];
            const indent = part[0].length - part[3].length;
            while (i < lines.length && (!lines[i].trim() || lines[i].startsWith(' '.repeat(indent)))) {
              content.push(lines[i++].slice(indent));
            }
            const li = node('li');
            blocks(li, content, depth + 1);
            list.append(li);
            part = lines[i]?.match(listItem);
            if (!part || /^\d/.test(part[1]) !== ordered || rule.test(lines[i])) break;
            i++;
          }
          parent.append(list);
        } else {
          const paragraph = [line];
          while (i < lines.length && !startsBlock(lines[i])) paragraph.push(lines[i++]);
          const p = node('p');
          inline(p, paragraph.join('\n'));
          parent.append(p);
        }
      }
    }
    blocks(fragment, markdown.split(/\r\n?|\n/));

    // Keep the unchanged prefix mounted while streaming so selections and
    // focused code controls in completed blocks survive later chunks.
    let existing = target.firstChild;
    while (existing && fragment.firstChild && existing.isEqualNode(fragment.firstChild)) {
      existing = existing.nextSibling;
      fragment.firstChild.remove();
    }
    while (existing) {
      const next = existing.nextSibling;
      existing.remove();
      existing = next;
    }
    target.append(fragment);
  }

  globalThis.MarginAnswer = {extract, render};
})();
