const fs = require("fs/promises");

const API_BASE = "https://api.bgm.tv";
const OUTPUT_FILE = "anime-db.json";

// 先抓排名前 5000 条。
// 想更大，可以改成 8000、10000，但别太激进。
const MAX_ITEMS = 10000;
const LIMIT = 50;
const SLEEP_MS = 900;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeSubject(item) {
  const id = String(item.id);

  const cnName = item.name_cn && item.name_cn.trim();
  const jpName = item.name && item.name.trim();

  const title = cnName || jpName || "未命名条目";
  const subTitle = cnName && jpName && cnName !== jpName ? jpName : "";

  const image =
    item.images?.large ||
    item.images?.common ||
    item.images?.medium ||
    item.images?.small ||
    "";

  const summary = cleanText(item.summary || "暂无简介");

  const score = item.rating?.score ? Number(item.rating.score).toFixed(1) : "暂无评分";
  const rank = item.rank ? `Rank ${item.rank}` : "暂无排名";
  const date = item.date || "日期未知";

  return {
    id,
    title,
    subTitle,
    image,
    summary,
    score,
    rank,
    date,
    url: `https://bgm.tv/subject/${id}`,
    source: "bangumi"
  };
}

async function fetchJson(url, options = {}, retry = 3) {
  for (let i = 0; i < retry; i++) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          "Accept": "application/json",
          "User-Agent": "anime-home-db-generator/1.0 (https://github.com/xwhy1120/anime-home)",
          ...(options.headers || {})
        }
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      return await res.json();
    } catch (err) {
      console.warn(`请求失败，第 ${i + 1} 次：${url}`);
      console.warn(err.message);

      if (i === retry - 1) {
        throw err;
      }

      await sleep(2000 + i * 2000);
    }
  }
}

async function fetchByRank() {
  const all = [];
  const seen = new Set();

  for (let offset = 0; offset < MAX_ITEMS; offset += LIMIT) {
    const url = `${API_BASE}/v0/subjects?type=2&sort=rank&limit=${LIMIT}&offset=${offset}`;
    console.log(`抓取排名数据 offset=${offset}`);

    const json = await fetchJson(url);
    const data = json.data || [];

    if (!data.length) {
      console.log("没有更多数据，停止。");
      break;
    }

    for (const item of data) {
      const normalized = normalizeSubject(item);

      if (!normalized.id || seen.has(normalized.id)) {
        continue;
      }

      // 没封面的条目随机体验很差，先过滤掉。
      if (!normalized.image) {
        continue;
      }

      seen.add(normalized.id);
      all.push(normalized);
    }

    await sleep(SLEEP_MS);
  }

  return all;
}

async function main() {
  console.log("开始生成 anime-db.json");

  const list = await fetchByRank();

  list.sort((a, b) => {
    const ra = Number(String(a.rank).replace("Rank ", "")) || 999999;
    const rb = Number(String(b.rank).replace("Rank ", "")) || 999999;
    return ra - rb;
  });

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(list, null, 2), "utf-8");

  console.log(`生成完成：${OUTPUT_FILE}`);
  console.log(`总条目数：${list.length}`);
}

main().catch(err => {
  console.error("生成失败：", err);
  process.exit(1);
});
