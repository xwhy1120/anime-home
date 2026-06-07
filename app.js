const API_BASE = "https://api.bgm.tv";
const LOCAL_DB_URL = "./anime-db.json";

const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const randomBtn = document.getElementById("randomBtn");
const resultList = document.getElementById("resultList");
const resultTitle = document.getElementById("resultTitle");
const resultTip = document.getElementById("resultTip");
const filterBtns = document.querySelectorAll(".filter-btn");
const sourceBtns = document.querySelectorAll(".source-btn");
const clearBtn = document.getElementById("clearBtn");
const skipWatchedInput = document.getElementById("skipWatchedInput");
const cardSkeleton = document.getElementById("cardSkeleton");

const STATUS_LIST = ["想看", "在看", "看过", "弃了"];
const RECORD_KEY = "anime_records_v3";
const SOURCE_KEY = "anime_source_mode_v1";

let currentItems = [];
let currentMode = "home";
let activeController = null;
let sourceMode = localStorage.getItem(SOURCE_KEY) || "online";
let localAnimeDB = [];
let localDBLoaded = false;
let localDBLoading = null;

function getRecords() {
  return JSON.parse(localStorage.getItem(RECORD_KEY) || "{}");
}

function saveRecords(records) {
  localStorage.setItem(RECORD_KEY, JSON.stringify(records));
}

function getStatus(id) {
  return getRecords()[id]?.status || "未标记";
}

function setStatus(id, status) {
  const records = getRecords();
  const item = currentItems.find(anime => String(anime.id) === String(id)) || records[id];

  if (!item) return;

  if (getStatus(id) === status) {
    delete records[id];
  } else {
    records[id] = {
      ...item,
      status,
      updatedAt: Date.now()
    };
  }

  saveRecords(records);

  if (currentMode === "records") {
    const filter = document.querySelector(".filter-btn.active")?.dataset.filter || "全部";
    showRecords(filter);
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

  const image =
    item.images?.large ||
    item.images?.common ||
    item.images?.medium ||
    item.images?.small ||
    "";

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
  if (!item) return null;

  return {
    id: String(item.id || ""),
    title: item.title || item.name_cn || item.name || "未命名条目",
    subTitle: item.subTitle || item.name || "",
    image: item.image || item.images?.large || item.images?.common || item.images?.medium || "",
    summary: cleanText(item.summary || "暂无简介"),
    score: item.score || (item.rating?.score ? Number(item.rating.score).toFixed(1) : "暂无评分"),
    rank: item.rank || "暂无排名",
    date: item.date || "日期未知",
    url: item.url || (item.id ? `https://bgm.tv/subject/${item.id}` : "https://bgm.tv/"),
    source: item.source || "local"
  };
}

async function fetchWithTimeout(url, options = {}, timeout = 9000) {
  if (activeController) {
    activeController.abort();
  }

  const controller = new AbortController();
  activeController = controller;

  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "Accept": "application/json",
        ...(options.headers || {})
      }
    });

    clearTimeout(timer);
    return response;
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}

async function loadLocalAnimeDB() {
  if (localDBLoaded) return localAnimeDB;
  if (localDBLoading) return localDBLoading;

  localDBLoading = fetch(`${LOCAL_DB_URL}?v=${Date.now()}`)
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then(json => {
      localAnimeDB = Array.isArray(json) ? json.map(normalizeLocalItem).filter(Boolean) : [];
      localDBLoaded = true;
      return localAnimeDB;
    })
    .catch(error => {
      localAnimeDB = [];
      localDBLoaded = false;
      throw error;
    })
    .finally(() => {
      localDBLoading = null;
    });

  return localDBLoading;
}

function searchLocalAnime(keyword) {
  const key = keyword.trim().toLowerCase();
  if (!key) return [];

  return localAnimeDB
    .filter(item => {
      const text = [item.title, item.subTitle, item.summary, item.date, item.score, item.rank]
        .join(" ")
        .toLowerCase();
      return text.includes(key);
    })
    .slice(0, 40);
}

function randomLocalAnime() {
  if (!localAnimeDB.length) return [];

  let pool = localAnimeDB.filter(item => item.title && item.image);
  pool = filterRandomCandidates(pool);

  if (!pool.length) {
    pool = localAnimeDB.filter(item => item.title && item.image);
  }

  if (!pool.length) return [];

  return [pool[Math.floor(Math.random() * pool.length)]];
}

async function bangumiSearch(keyword) {
  const response = await fetchWithTimeout(`${API_BASE}/v0/search/subjects?limit=30&offset=0`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      keyword,
      sort: "match",
      filter: {
        type: [2]
      }
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const json = await response.json();
  return (json.data || []).map(normalizeSubject).filter(item => item.title);
}

async function bangumiRandom() {
  const maxOffset = 9000;
  const attempts = 6;
  let backup = [];

  for (let i = 0; i < attempts; i++) {
    const offset = Math.floor(Math.random() * maxOffset);
    const response = await fetchWithTimeout(
      `${API_BASE}/v0/subjects?type=2&sort=rank&limit=24&offset=${offset}`,
      { method: "GET" },
      9000
    );

    if (!response.ok) continue;

    const json = await response.json();
    const list = (json.data || []).map(normalizeSubject).filter(item => item.title && item.image);

    if (list.length) {
      backup = list;
      const filtered = filterRandomCandidates(list);
      const pool = filtered.length ? filtered : list;
      return [pool[Math.floor(Math.random() * pool.length)]];
    }
  }

  if (backup.length) {
    return [backup[Math.floor(Math.random() * backup.length)]];
  }

  return [];
}

function filterRandomCandidates(list) {
  if (!skipWatchedInput.checked) return list;

  return list.filter(item => {
    const status = getStatus(item.id);
    return status !== "看过" && status !== "弃了";
  });
}

function renderSkeleton(count = 6) {
  const html = Array.from({ length: count }, () => cardSkeleton.innerHTML).join("");
  resultList.innerHTML = html;
}

function renderCards(items) {
  currentItems = items;

  if (!items.length) {
    resultList.innerHTML = `<div class="empty">没有内容。</div>`;
    return;
  }

  resultList.innerHTML = items.map(item => {
    const status = getStatus(item.id);

    const imageHtml = item.image
      ? `<img class="cover" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" loading="lazy" onload="this.classList.add('loaded')" onerror="this.closest('.cover-wrap').classList.add('no-cover')">`
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

          <a class="open-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">打开详情</a>
        </div>
      </article>
    `;
  }).join("");
}

function setError(text) {
  resultList.innerHTML = `<div class="error">${escapeHtml(text)}</div>`;
}

function updateSourceUI() {
  sourceBtns.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.source === sourceMode);
  });

  if (currentMode === "home") {
    resultTip.textContent = sourceMode === "online"
      ? "输入番名搜索，或者随机邂逅一部。"
      : "输入番名搜索，或者从本地库随机一部。";
  }
}

async function setSourceMode(mode) {
  sourceMode = mode;
  localStorage.setItem(SOURCE_KEY, sourceMode);
  updateSourceUI();

  if (sourceMode === "local" && !localDBLoaded) {
    resultTitle.textContent = "正在加载本地库";
    resultTip.textContent = "稍等一下。";
    renderSkeleton(3);

    try {
      await loadLocalAnimeDB();
      resultTitle.textContent = "准备好了";
      resultTip.textContent = `本地库已加载 ${localAnimeDB.length} 条。`;
      resultList.innerHTML = "";
    } catch (error) {
      console.error(error);
      resultTitle.textContent = "本地库";
      setError("本地库加载失败。请确认 anime-db.json 已经放在网站根目录。");
    }
  }
}

async function handleSearch() {
  const keyword = searchInput.value.trim();

  if (!keyword) {
    setError("先输入番名。");
    return;
  }

  currentMode = "search";
  resultTitle.textContent = `搜索：${keyword}`;
  resultTip.textContent = sourceMode === "online" ? "正在寻找相关条目。" : "正在本地库中查找。";
  renderSkeleton(8);

  try {
    const list = sourceMode === "online"
      ? await bangumiSearch(keyword)
      : (await loadLocalAnimeDB(), searchLocalAnime(keyword));

    if (!list.length) {
      setError("没有搜到结果，换个名字试试。");
      return;
    }

    resultTip.textContent = `找到 ${list.length} 个结果。`;
    renderCards(list);
  } catch (error) {
    console.error(error);
    setError(sourceMode === "online" ? "连接超时或服务暂时不可用，稍后再试。" : "本地库加载失败。");
  }
}

async function handleRandom() {
  currentMode = "random";
  resultTitle.textContent = "随机推荐";
  resultTip.textContent = "正在抽取。";
  renderSkeleton(1);

  try {
    const list = sourceMode === "online"
      ? await bangumiRandom()
      : (await loadLocalAnimeDB(), randomLocalAnime());

    if (!list.length) {
      setError("这次没有抽到，重新点一次。");
      return;
    }

    resultTip.textContent = "抽到了这一部。";
    renderCards(list);
  } catch (error) {
    console.error(error);
    setError(sourceMode === "online" ? "连接超时或服务暂时不可用，稍后再试。" : "本地库加载失败。");
  }
}

function showRecords(filter) {
  currentMode = "records";

  const records = getRecords();
  let list = Object.values(records).sort((a, b) => b.updatedAt - a.updatedAt);

  if (filter !== "全部") {
    list = list.filter(item => item.status === filter);
  }

  resultTitle.textContent = filter === "全部" ? "我的记录" : `我的${filter}`;
  resultTip.textContent = list.length ? `共 ${list.length} 条。` : "还没有记录。";

  if (!list.length) {
    resultList.innerHTML = `<div class="empty">${filter === "全部" ? "你还没有标记任何番剧。" : `你还没有标记“${filter}”的番剧。`}</div>`;
    return;
  }

  renderCards(list);
}

function clearResults() {
  currentMode = "home";
  currentItems = [];
  resultTitle.textContent = "准备好了";
  resultTip.textContent = sourceMode === "online"
    ? "输入番名搜索，或者随机邂逅一部。"
    : "输入番名搜索，或者从本地库随机一部。";
  resultList.innerHTML = "";
}

searchBtn.addEventListener("click", handleSearch);

searchInput.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    handleSearch();
  }
});

randomBtn.addEventListener("click", handleRandom);

clearBtn.addEventListener("click", clearResults);

sourceBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    setSourceMode(btn.dataset.source);
  });
});

resultList.addEventListener("click", event => {
  const btn = event.target.closest(".status-btn");
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
clearResults();
