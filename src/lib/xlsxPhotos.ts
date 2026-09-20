/**
 * 从 .xlsx 中提取「单元格内嵌入的图片」（WPS / Excel 均支持），无需额外依赖。
 *
 * xlsx 本质是 zip 包，图片存放在 xl/media/*，图片与单元格的对应关系有两套写法：
 *  1) WPS「嵌入单元格」：单元格值形如 `=DISPIMG("ID_xxx",1)`，图片清单在 xl/cellimages.xml
 *  2) Excel/WPS 浮动图片：xl/drawings/drawingN.xml 的锚点 <xdr:from><xdr:row>N</xdr:row> + r:embed
 *
 * 用浏览器原生 DecompressionStream('deflate-raw') 解压，避免引入 jszip。
 *
 * @returns Map<行号(0 基, 含表头行 0), 图片 dataURL>
 */
type ZipEntry = {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
};

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  // BlobPart 类型在 Node22/TS5.7 下要求 ArrayBuffer-like 子集；显式 slice 拷贝到独立 ArrayBuffer
  const stream = new Blob([data.slice().buffer]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

function readZipIndex(buf: Uint8Array): ZipEntry[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // 从尾部找 EOCD (0x06054b50)
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65535; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return [];
  const count = dv.getUint16(eocd + 10, true);
  let ptr = dv.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(ptr, true) !== 0x02014b50) break;
    const method = dv.getUint16(ptr + 10, true);
    const compressedSize = dv.getUint32(ptr + 20, true);
    const nameLen = dv.getUint16(ptr + 28, true);
    const extraLen = dv.getUint16(ptr + 30, true);
    const commentLen = dv.getUint16(ptr + 32, true);
    const localOffset = dv.getUint32(ptr + 42, true);
    const name = new TextDecoder().decode(buf.subarray(ptr + 46, ptr + 46 + nameLen));
    entries.push({ name, method, compressedSize, localOffset });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function readEntry(buf: Uint8Array, entry: ZipEntry, cache: Map<string, string>): Promise<string | null> {
  if (cache.has(entry.name)) return cache.get(entry.name)!;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const nameLen = dv.getUint16(entry.localOffset + 26, true);
  const extraLen = dv.getUint16(entry.localOffset + 28, true);
  const start = entry.localOffset + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + entry.compressedSize);
  let bytes: Uint8Array;
  try {
    bytes = entry.method === 0 ? raw : await inflateRaw(raw);
  } catch {
    return null;
  }
  let text = '';
  try { text = new TextDecoder().decode(bytes); } catch { /* 二进制 */ }
  cache.set(entry.name, text);
  return text;
}

function base64Of(data: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) {
    s += String.fromCharCode.apply(null, Array.from(data.subarray(i, i + chunk)) as any);
  }
  return btoa(s);
}

async function readBinary(buf: Uint8Array, entry: ZipEntry): Promise<Uint8Array | null> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const nameLen = dv.getUint16(entry.localOffset + 26, true);
  const extraLen = dv.getUint16(entry.localOffset + 28, true);
  const start = entry.localOffset + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + entry.compressedSize);
  try {
    return entry.method === 0 ? raw : await inflateRaw(raw);
  } catch {
    return null;
  }
}

function mimeOf(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || 'png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'bmp') return 'image/bmp';
  return 'image/png';
}

/** 解析 rels：Id → Target（已归一化为包内路径） */
function parseRels(xml: string, baseDir: string): Record<string, string> {
  const map: Record<string, string> = {};
  const re = /<Relationship\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const tag = m[0];
    const id = /Id="([^"]+)"/.exec(tag)?.[1];
    const target = /Target="([^"]+)"/.exec(tag)?.[1];
    if (!id || !target) continue;
    let p = target.replace(/^\/+/, '');
    if (p.startsWith('../')) p = baseDir.replace(/\/[^/]*$/, '') + '/' + p.slice(3);
    else if (!p.startsWith(baseDir)) p = baseDir + '/' + p;
    map[id] = p.replace(/\/+/g, '/');
  }
  return map;
}

export async function extractSheetPhotos(file: File): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    const entries = readZipIndex(buf);
    if (!entries.length) return result;
    const byName = new Map(entries.map(e => [e.name, e]));

    // ---- 1) 收集所有图片文件 → dataURL ----
    const media: Record<string, string> = {};
    for (const e of entries) {
      if (!/^xl\/media\//i.test(e.name)) continue;
      const bytes = await readBinary(buf, e);
      if (!bytes || bytes.length === 0) continue;
      media[e.name] = `data:${mimeOf(e.name)};base64,${base64Of(bytes)}`;
    }
    if (!Object.keys(media).length) return result;

    // ---- 2) WPS 嵌入单元格：DISPIMG ----
    const cellImagesEntry = byName.get('xl/cellimages.xml');
    if (cellImagesEntry) {
      const xml = (await readEntry(buf, cellImagesEntry, new Map())) || '';
      const relsEntry = byName.get('xl/_rels/cellimages.xml.rels');
      const rels = relsEntry ? parseRels((await readEntry(buf, relsEntry, new Map())) || '', 'xl') : {};
      const images: Record<string, string> = {};
      // 按 <xxx:cellImage ...> 分块，逐块取 name 与 r:embed
      const blocks = xml.split(/(?=<[A-Za-z]+:cellImage\b)/).slice(1);
      for (const block of blocks) {
        const imgId = /name="([^"]+)"/.exec(block)?.[1];
        const embed = /r:embed="([^"]+)"/.exec(block)?.[1];
        if (imgId && embed && rels[embed] && media[rels[embed]]) {
          images[imgId] = media[rels[embed]];
        }
      }
      // 工作表里找 DISPIMG：需要定位到单元格引用
      for (const [name, e] of byName) {
        if (!/^xl\/worksheets\/sheet\d+\.xml$/i.test(name)) continue;
        const sheetXml = (await readEntry(buf, e, new Map())) || '';
        const re = /<c\b[^>]*?r="([A-Z]+)(\d+)"[^>]*>(?:[\s\S]*?)<\/c>/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(sheetXml))) {
          // WPS 实际写入的公式引号是 XML 转义的 &quot;（如 _xlfn.DISPIMG(&quot;ID_x&quot;,1)），兼容两种写法
          const imgId = /DISPIMG\(\s*(?:&quot;|")([^"&]+?)(?:&quot;|")/.exec(m[0])?.[1];
          if (!imgId || !images[imgId]) continue;
          const row = Number(m[2]); // 1 基
          result.set(row - 1, images[imgId]); // 归一化为 0 基
        }
      }
      if (result.size) return result;
    }

    // ---- 3) Excel/WPS 浮动图片：drawing 锚点 ----
    for (const [name, e] of byName) {
      if (!/^xl\/drawings\/drawing\d+\.xml$/i.test(name)) continue;
      const xml = (await readEntry(buf, e, new Map())) || '';
      const relName = name.replace('drawings/', 'drawings/_rels/') + '.rels';
      const relsEntry = byName.get(relName);
      const rels = relsEntry ? parseRels((await readEntry(buf, relsEntry, new Map())) || '', 'xl/drawings') : {};
      const anchorRe = /<xdr:(?:two|one)CellAnchor\b[\s\S]*?<\/xdr:(?:two|one)CellAnchor>/g;
      let a: RegExpExecArray | null;
      while ((a = anchorRe.exec(xml))) {
        const block = a[0];
        const row = /<xdr:row>(\d+)<\/xdr:row>/.exec(block)?.[1];
        const embed = /r:embed="([^"]+)"/.exec(block)?.[1];
        if (row === undefined || !embed) continue;
        const mediaPath = rels[embed];
        if (!mediaPath || !media[mediaPath]) continue;
        result.set(Number(row), media[mediaPath]);
      }
    }
  } catch (err) {
    console.warn('extractSheetPhotos failed:', err);
  }
  return result;
}
