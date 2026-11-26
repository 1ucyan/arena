"use strict";
const ArenaImport = (() => {
  function decode(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes[0] === 255 && bytes[1] === 254) return new TextDecoder("utf-16le").decode(bytes);
    if (bytes[0] === 254 && bytes[1] === 255) return new TextDecoder("utf-16be").decode(bytes);
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { return new TextDecoder("windows-1251").decode(bytes); }
  }
  function csvRows(text, separator) {
    const rows = [];
    let row = [], value = "", quoted = false;
    function endRow() {
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; value = "";
    }
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        if (quoted && text[i + 1] === '"') { value += '"'; i++; }
        else quoted = !quoted;
      } else if (!quoted && c === separator) {
        row.push(value.trim()); value = "";
      } else if (!quoted && (c === "\n" || c === "\r")) {
        endRow(); if (c === "\r" && text[i+1] === "\n") i++;
      } else value += c;
    }
    if (quoted) throw Error("Проверьте парные кавычки в CSV.");
    endRow(); return rows;
  }
  const nameHeader = /^(фио|ф\.и\.о\.?|фамилия имя отчество|участники?|имя участника|спортсмен|команды?|название команды|name|participant|team)$/i;
  function parse(source, isCsv) {
    let text = source.replace(/^\uFEFF/, "").trim();
    if (!text) throw Error("Файл пуст. Добавьте имена участников.");
    if (!isCsv) return text.split(/\r\n|\r|\n/).map(s=>s.trim()).filter(Boolean);
    const directive = /^sep=(.)\r?\n/i.exec(text);
    if (directive) text = text.slice(directive[0].length);
    const line = (text.split(/[\r\n]/)[0] || "").replace(/"(?:[^"]|"")*"/g, "");
    const sep = directive?.[1] || (line.includes(";") ? ";" : line.includes("\t") ? "\t" : line.includes(",") ? "," : ";");
    const rows = csvRows(text, sep);
    if (!rows.length) throw Error("В CSV нет имён участников.");
    const header = rows[0], index = header.findIndex(v=>nameHeader.test(v));
    if (index >= 0 && rows.length > 1) return rows.slice(1).map(r=>r[index] || "").filter(Boolean);
    if (/^(№|номер|no\.?|id|#)$/i.test(header[0])) rows.shift();
    if (rows.length && rows.every(r=>r.length === 2 && /^\d+[.)]?$/.test(r[0]))) return rows.map(r=>r[1]).filter(Boolean);
    return rows.flat().filter(Boolean);
  }
  return {decode, parse};
})();
