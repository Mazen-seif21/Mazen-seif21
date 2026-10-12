#!/usr/bin/env node
/* Recomputes language percentages across the owner's repositories
   (public + private, forks excluded) and rewrites the block between
   LANGS:START / LANGS:END markers in README.md. */

const fs = require("fs");
const path = require("path");

const USER = "Mazen-seif21";
const ORG = "Tabibi-Gaza";
const SKIP = new Set([".github", "Mazen-seif21", "gaza-professionals"]);
const README = path.join(__dirname, "..", "..", "README.md");

const STYLES = {
  javascript: { bg: "%23323330", logo: "javascript", fg: "%23F7DF1E" },
  dart: { bg: "%230175C2", logo: "dart", fg: "white" },
  "c#": { bg: "%23239120", logo: "csharp", fg: "white" },
  html: { bg: "%23E34F26", logo: "html5", fg: "white" },
  css: { bg: "%231572B6", logo: "css3", fg: "white" },
  "c++": { bg: "%2300599C", logo: "c%2B%2B", fg: "white" },
  c: { bg: "%23A8B9CC", logo: "c", fg: "white" },
  cmake: { bg: "0660A4", logo: "cmake", fg: "white" },
  swift: { bg: "%23F05138", logo: "swift", fg: "white" },
  kotlin: { bg: "%237F52FF", logo: "kotlin", fg: "white" },
  java: { bg: "%23ED8B00", logo: "openjdk", fg: "white" },
  typescript: { bg: "%23007ACC", logo: "typescript", fg: "white" },
  php: { bg: "%23777BB4", logo: "php", fg: "white" },
  python: { bg: "3670A0", logo: "python", fg: "ffdd54" },
  dockerfile: { bg: "%232496ED", logo: "docker", fg: "white" },
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
  console.log(`Scanning ${repos.length} repositories (${mode} mode)`);

  const totals = {};
  for (const r of repos) {
    const langs = await api(`https://api.github.com/repos/${r.full_name}/languages`, token);
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
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
