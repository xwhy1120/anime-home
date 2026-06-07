const API_BASE = "https://api.bgm.tv";

const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("searchInput");
const randomBtn = document.getElementById("randomBtn");
const skipWatched = document.getElementById("skipWatched");
const clearViewBtn = document.getElementById("clearViewBtn");
const resultList = document.getElementById("resultList");
const resultTitle = document.getElementById("resultTitle");
const resultTip = document.getElementById("resultTip");
const filterBtns = document.querySelectorAll(".filter-btn");
const sourceBtns = document.querySelectorAll(".source-btn");

let currentItems = [];
let currentMode = "home";
let dataSource = localStorage.getItem("anime_source_v21") || "online";
let localAnimeDB = [];
let localLoaded = false;

const STATUS_LIST = ["想看", "在看", "看过", "弃了"];

function fetchWithTimeout(url, options = {}, timeout = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

function getRecords() {
  return JSON.parse(localStorage.getItem("anime_records_v2") || "{}");
}

function saveRecords(records) {
  localStorage.setItem("anime_records_v2", JSON.stringify(records));
}

function getStatus(id) {
  const records = getRecords();
  return records[String(id)]?.status || "未标记";
}

function setStatus(id, status) {
  id = String(id);
  const records = getRecords();
  const item = currentItems.find(anime => String(anime.id) === id) || records[id];
  if (!item) return;

  if (getStatus(id) === status) {
    delete records[id];
  } else {
    records[id] = { ...item, id, status, updatedAt: Date.now() };
  }

  saveRecords(records);

  if (currentMode === "records") {
    showRecords(document.querySelector(".filter-btn.active")?.dataset.filter || "全部");
  } else {
    renderCards(currentItems);
  }
}

function cleanText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeSubject(item) {
  const id = String(item.id);
  const cnName = item.name_cn && item.name_cn.trim();
  const jpName = item.name && item.name.trim();
  const title = cnName || jpName || "未命名条目";
  const subTitle = cnName && jpName && cnName !== jpName ? jpName : "";
  const image = item.images?.large || item.images?.common || item.images?.medium || item.images?.small || "";
  const score = item.rating?.score ? Number(item.rating.score).toFixed(1) : "暂无评分";
  const rank = item.rank ? `Rank ${item.rank}` : "暂无排名";

  return {
    id,
    title,
    subTitle,
    image,
    summary: cleanText(item.summary || "暂无简介"),
    score,
    rank,
    date: item.date || "日期未知",
    url: `https://bgm.tv/subject/${id}`,
    source: "bangumi"
  };
}

function normalizeLocalItem(item) {
  const id = String(item.id);
  return {
    id,
    title: item.title || "未命名条目",
    subTitle: item.subTitle || "",
    image: item.image || "",
    summary: item.summary || "暂无简介",
    score: item.score || "暂无评分",
    rank: item.rank || "暂无排名",
    date: item.date || "日期未知",
    url: item.url || `https://bgm.tv/subject/${id}`,
    source: item.source || "local"
  };
}

function isSkippedByRecord(item) {
  if (!skipWatched.checked) return false;
  const status = getStatus(item.id);
  return status === "看过" || status === "弃了";
}

async function loadLocalAnimeDB() {
  if (localLoaded) return;

  const res = await fetch(`./anime-db.json?v=${Date.now()}`);
  if (!res.ok) throw new Error("本地库加载失败");

  const json = await res.json();
  localAnimeDB = Array.isArray(json) ? json.map(normalizeLocalItem) : [];
  localLoaded = true;
}

function searchLocalAnime(keyword) {
  const key = keyword.trim().toLowerCase();
  if (!key) return [];

  return localAnimeDB
    .filter(item => [item.title, item.subTitle, item.summary, item.date, item.score, item.rank].join(" ").toLowerCase().includes(key))
    .slice(0, 48);
}

function randomLocalAnime() {
  const usable = localAnimeDB.filter(item => item.title && item.image && !isSkippedByRecord(item));
  if (!usable.length) return [];
  return [usable[Math.floor(Math.random() * usable.length)]];
}

async function searchOnline(keyword) {
  const res = await fetchWithTimeout(`${API_BASE}/v0/search/subjects?limit=36&offset=0`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ keyword, sort: "match", filter: { type: [2] } })
  });

  if (!res.ok) throw new Error(`搜索失败：${res.status}`);
  const json = await res.json();
  return (json.data || []).map(normalizeSubject);
}

async function randomOnline() {
  const maxOffset = 9000;

  for (let attempt = 0; attempt < 8; attempt++) {
    const offset = Math.floor(Math.random() * maxOffset);
    const res = await fetchWithTimeout(`${API_BASE}/v0/subjects?type=2&sort=rank&limit=24&offset=${offset}`, {
      method: "GET",
      headers: { "Accept": "application/json" }
    });

    if (!res.ok) continue;

    const json = await res.json();
    const list = (json.data || [])
      .map(normalizeSubject)
      .filter(item => item.title && item.image && !isSkippedByRecord(item));

    if (list.length) return [list[Math.floor(Math.random() * list.length)]];
  }

  throw new Error("随机结果为空");
}

function renderCards(items) {
  currentItems = items;

  if (!items.length) {
    resultList.innerHTML = `<div class="empty">这里还没有内容。可以搜索番剧，或者随机一部。</div>`;
    return;
  }

  resultList.innerHTML = items.map(item => {
    const status = getStatus(item.id);
    const imageHtml = item.image
      ? `<img class="cover" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}">`
      : `<div class="cover"></div>`;

    return `
      <article class="card">
        <div class="cover-wrap">
          ${imageHtml}
          <div class="status-badge">${status}</div>
        </div>
        <div class="body">
          <h3 class="title">${escapeHtml(item.title)}</h3>
          <div class="jp-title">${escapeHtml(item.subTitle)}</div>
          <div class="meta">
            <span>${escapeHtml(item.date)}</span>
            <span>${escapeHtml(item.score)}</span>
            <span>${escapeHtml(item.rank)}</span>
          </div>
          <p class="summary">${escapeHtml(item.summary)}</p>
          <div class="status-row">
            ${STATUS_LIST.map(s => `
              <button class="status-btn ${status === s ? "active" : ""}" data-id="${escapeHtml(item.id)}" data-status="${s}">
                ${s}
              </button>
            `).join("")}
          </div>
          <a class="open-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">打开条目页面</a>
        </div>
      </article>
    `;
  }).join("");
}

function setLoading(text) {
  resultList.innerHTML = `
    <div class="loading">${text}</div>
    <div class="skeleton-card"></div>
  `;
}

function setError(text) {
  resultList.innerHTML = `<div class="error">${text}</div>`;
}

function updateSourceUI() {
  sourceBtns.forEach(btn => btn.classList.toggle("active", btn.dataset.source === dataSource));
  resultTip.textContent = `当前数据源：${dataSource === "online" ? "在线" : "本地库"}`;
}

async function handleSearch() {
  const keyword = searchInput.value.trim();
  if (!keyword) {
    setError("先输入番名，例如：孤独摇滚、药屋少女、芙莉莲。");
    return;
  }

  currentMode = "search";
  resultTitle.textContent = `搜索：${keyword}`;
  setLoading("正在搜索……");

  try {
    let list = [];
    if (dataSource === "online") {
      list = await searchOnline(keyword);
    } else {
      await loadLocalAnimeDB();
      list = searchLocalAnime(keyword);
    }

    if (!list.length) {
      setError("没有找到结果，换个关键词试试。");
      return;
    }

    updateSourceUI();
    renderCards(list);
  } catch (err) {
    console.error(err);
    setError("搜索失败，可以切换数据源后再试。");
  }
}

async function handleRandom() {
  currentMode = "random";
  resultTitle.textContent = "随机推荐";
  setLoading("正在随机抽取……");

  try {
    let list = [];
    if (dataSource === "online") {
      list = await randomOnline();
    } else {
      await loadLocalAnimeDB();
      list = randomLocalAnime();
    }

    if (!list.length) {
      setError("没有可随机的条目，换个数据源试试。");
      return;
    }

    updateSourceUI();
    renderCards(list);
  } catch (err) {
    console.error(err);
    setError("随机失败，可以切换数据源后再试。");
  }
}

function showRecords(filter) {
  currentMode = "records";
  const records = getRecords();
  let list = Object.values(records).sort((a, b) => b.updatedAt - a.updatedAt);

  if (filter !== "全部") list = list.filter(item => item.status === filter);

  resultTitle.textContent = filter === "全部" ? "我的全部记录" : `我的${filter}`;
  resultTip.textContent = "记录保存在当前浏览器。";
  renderCards(list);

  if (!list.length) setError(filter === "全部" ? "你还没有标记任何番剧。" : `你还没有标记“${filter}”的番剧。`);
}

searchForm.addEventListener("submit", e => {
  e.preventDefault();
  handleSearch();
});

randomBtn.addEventListener("click", handleRandom);
clearViewBtn.addEventListener("click", () => {
  currentMode = "home";
  resultTitle.textContent = "开始搜索，或者随机推荐一部";
  updateSourceUI();
  renderCards([]);
});

sourceBtns.forEach(btn => {
  btn.addEventListener("click", async () => {
    dataSource = btn.dataset.source;
    localStorage.setItem("anime_source_v21", dataSource);
    updateSourceUI();
    resultTitle.textContent = "开始搜索，或者随机推荐一部";
    renderCards([]);

    if (dataSource === "local") {
      setLoading("正在准备本地库……");
      try {
        await loadLocalAnimeDB();
        resultTip.textContent = `当前数据源：本地库，共 ${localAnimeDB.length} 条`;
        renderCards([]);
      } catch (err) {
        console.error(err);
        setError("本地库加载失败，请确认 anime-db.json 在根目录。");
      }
    }
  });
});

resultList.addEventListener("click", e => {
  const btn = e.target.closest(".status-btn");
  if (!btn) return;
  setStatus(btn.dataset.id, btn.dataset.status);
});

filterBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    filterBtns.forEach(item => item.classList.remove("active"));
    btn.classList.add("active");
    showRecords(btn.dataset.filter);
  });
});

updateSourceUI();
renderCards([]);
