#!/usr/bin/env node
/* Recomputes language percentages from the LATEST commit tree (instant,
   no GitHub language-cache delay) and rewrites the block between
   LANGS:START / LANGS:END markers in README.md. */

const fs = require("fs");
const path = require("path");

const USER = "Mazen-seif21";
const ORG = "Tabibi-Gaza";
const SKIP = new Set([".github", "Mazen-seif21", "gaza-professionals"]);
const README = path.join(__dirname, "..", "..", "README.md");

// extension -> language (mirrors GitHub Linguist for common languages)
const EXT = {
  js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript", cjs: "JavaScript",
  ts: "TypeScript", tsx: "TypeScript", mts: "TypeScript", cts: "TypeScript",
  cs: "C#", vb: "Visual Basic", fs: "F#",
  dart: "Dart",
  py: "Python", pyw: "Python", pyi: "Python",
  html: "HTML", htm: "HTML", xhtml: "HTML",
  css: "CSS", scss: "SCSS", sass: "Sass", less: "Less",
  cpp: "C++", cc: "C++", cxx: "C++", c: "C", h: "C", hpp: "C++", hh: "C++",
  hxx: "C++", ino: "C++",
  java: "Java", kt: "Kotlin", kts: "Kotlin",
  swift: "Swift",
  php: "PHP",
  go: "Go",
  rb: "Ruby",
  rs: "Rust",
  vue: "Vue", svelte: "Svelte",
  sh: "Shell", bash: "Shell", zsh: "Shell",
  sql: "SQL",
  r: "R",
  lua: "Lua",
  pl: "Perl", pm: "Perl",
  scala: "Scala",
  clj: "Clojure", cljs: "Clojure",
  ex: "Elixir", exs: "Elixir",
  erl: "Erlang",
  hs: "Haskell",
  ml: "OCaml",
  nim: "Nim",
  zig: "Zig",
  v: "V",
  groovy: "Groovy",
  gradle: "Groovy",
  tf: "HCL",
  proto: "Protocol Buffers",
};

const SPECIAL = {
  dockerfile: "Dockerfile",
  "cmakelists.txt": "CMake",
  makefile: "Makefile",
};

const STYLES = {
  javascript: { bg: "%23323330", logo: "javascript", fg: "%23F7DF1E" },
  typescript: { bg: "%23007ACC", logo: "typescript", fg: "white" },
  "c#": { bg: "%23239120", logo: "csharp", fg: "white" },
  dart: { bg: "%230175C2", logo: "dart", fg: "white" },
  python: { bg: "3670A0", logo: "python", fg: "ffdd54" },
  html: { bg: "%23E34F26", logo: "html5", fg: "white" },
  css: { bg: "%231572B6", logo: "css3", fg: "white" },
  scss: { bg: "%23CC6699", logo: "sass", fg: "white" },
  sass: { bg: "%23CC6699", logo: "sass", fg: "white" },
  less: { bg: "%231D365D", logo: "less", fg: "white" },
  "c++": { bg: "%2300599C", logo: "c%2B%2B", fg: "white" },
  c: { bg: "%23A8B9CC", logo: "c", fg: "white" },
  java: { bg: "%23ED8B00", logo: "openjdk", fg: "white" },
  kotlin: { bg: "%237F52FF", logo: "kotlin", fg: "white" },
  swift: { bg: "%23F05138", logo: "swift", fg: "white" },
  php: { bg: "%23777BB4", logo: "php", fg: "white" },
  go: { bg: "%2300ADD8", logo: "go", fg: "white" },
  ruby: { bg: "%23CC342D", logo: "ruby", fg: "white" },
  rust: { bg: "%23000000", logo: "rust", fg: "white" },
  vue: { bg: "%234FC08D", logo: "vuedotjs", fg: "white" },
  svelte: { bg: "%23FF3E00", logo: "svelte", fg: "white" },
  shell: { bg: "%234EAA25", logo: "gnubash", fg: "white" },
  sql: { bg: "%234479A1", logo: "mysql", fg: "white" },
  dockerfile: { bg: "%232496ED", logo: "docker", fg: "white" },
  cmake: { bg: "0660A4", logo: "cmake", fg: "white" },
  makefile: { bg: "%23427819", logo: "gnu", fg: "white" },
  markdown: { bg: "%23000000", logo: "markdown", fg: "white" },
};

async function api(url, token) {
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "update-langs",
    },
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function listRepos(token, mode) {
  const repos = [];
  const pages = async (url) => {
    for (let page = 1; page <= 5; page++) {
      const batch = await api(`${url}${url.includes("?") ? "&" : "?"}per_page=100&page=${page}`, token);
      repos.push(...batch);
      if (batch.length < 100) break;
    }
  };
  if (mode === "user") {
    await pages(`https://api.github.com/user/repos?visibility=all`);
  } else {
    await pages(`https://api.github.com/users/${USER}/repos`);
    await pages(`https://api.github.com/orgs/${ORG}/repos`);
  }
  const seen = new Map();
  for (const r of repos) seen.set(r.full_name, r);
  return [...seen.values()];
}

function langForFile(pathStr) {
  const base = pathStr.split("/").pop().toLowerCase();
  if (SPECIAL[base]) return SPECIAL[base];
  const dot = base.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = base.slice(dot + 1);
  return EXT[ext] || null;
}

async function repoLanguages(repo, token) {
  // Try instant tree-based counting first
  try {
    const branch = repo.default_branch;
    if (!branch) return null;
    const tree = await api(`https://api.github.com/repos/${repo.full_name}/git/trees/${branch}?recursive=1`, token);
    if (tree.truncated) return null; // too big -> fallback
    const totals = {};
    for (const entry of tree.tree || []) {
      if (entry.type !== "blob") continue;
      const lang = langForFile(entry.path);
      if (!lang) continue;
      totals[lang] = (totals[lang] || 0) + (entry.size || 0);
    }
    return totals;
  } catch (e) {
    return null;
  }
}

async function fallbackLanguages(repo, token) {
  try {
    const langs = await api(`https://api.github.com/repos/${repo.full_name}/languages`, token);
    const out = {};
    for (const [k, v] of Object.entries(langs)) out[k] = v;
    return out;
  } catch (e) {
    return {};
  }
}

function badge(name, pct) {
  const s = STYLES[name.toLowerCase()] || { bg: "%23555555", fg: "white" };
  const label = encodeURIComponent(name);
  let url = `https://img.shields.io/badge/${label}-${pct}%25-${s.bg}.svg?style=for-the-badge`;
  if (s.logo) url += `&logo=${s.logo}`;
  url += `&logoColor=${s.fg}`;
  return `![${name}](${url})`;
}

(async () => {
  const token = process.env.LANG_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) throw new Error("No token available (LANG_TOKEN / GITHUB_TOKEN)");
  const mode = process.env.LANG_TOKEN ? "user" : "public";

  const repos = (await listRepos(token, mode)).filter((r) => !r.fork && !SKIP.has(r.name));
  console.log(`Scanning ${repos.length} repositories (${mode} mode, instant tree-based)`);

  const totals = {};
  let fallbackUsed = 0;
  for (const r of repos) {
    let langs = await repoLanguages(r, token);
    if (!langs) { langs = await fallbackLanguages(r, token); fallbackUsed++; }
    for (const [name, bytes] of Object.entries(langs)) totals[name] = (totals[name] || 0) + bytes;
  }

  const grand = Object.values(totals).reduce((a, b) => a + b, 0);
  if (!grand) throw new Error("No language data found");

  const rows = Object.entries(totals)
    .map(([name, bytes]) => ({ name, pct: (bytes / grand) * 100 }))
    .filter((r) => r.pct >= 1)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 8)
    .map((r) => ({ name: r.name, pct: r.pct.toFixed(1) }));

  const block = [
    "<!-- LANGS:START -->",
    "**💻 Languages (all my repos, incl. private):**",
    "",
    ...rows.map((r) => badge(r.name, r.pct)),
    "<!-- LANGS:END -->",
  ].join("\n");

  const md = fs.readFileSync(README, "utf8");
  const re = /<!-- LANGS:START -->[\s\S]*?<!-- LANGS:END -->/;
  if (!re.test(md)) throw new Error("LANGS markers not found in README.md");
  fs.writeFileSync(README, md.replace(re, block));
  console.log(`Updated: ${rows.map((r) => `${r.name} ${r.pct}%`).join(", ")}`);
  if (fallbackUsed) console.log(`Fallback to /languages used for ${fallbackUsed} repo(s)`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
