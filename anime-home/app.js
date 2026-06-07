const API_BASE = "https://api.bgm.tv";
async function fetchWithTimeout(url, options = {}, timeout = 8000) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, timeout);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal
    });

    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const randomBtn = document.getElementById("randomBtn");
const resultList = document.getElementById("resultList");
const resultTitle = document.getElementById("resultTitle");
const resultTip = document.getElementById("resultTip");
const filterBtns = document.querySelectorAll(".filter-btn");

let currentItems = [];
let currentMode = "home";

const STATUS_LIST = ["想看", "在看", "看过", "弃了"];

function getRecords() {
  return JSON.parse(localStorage.getItem("anime_records_v2") || "{}");
}

function saveRecords(records) {
  localStorage.setItem("anime_records_v2", JSON.stringify(records));
}

function getStatus(id) {
  const records = getRecords();
  return records[id]?.status || "未标记";
}

function setStatus(id, status) {
  const records = getRecords();
  const item = currentItems.find(anime => anime.id === id) || records[id];

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
    showRecords(document.querySelector(".filter-btn.active")?.dataset.filter || "全部");
  } else {
    renderCards(currentItems);
  }
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

  const score = item.rating?.score ? item.rating.score.toFixed(1) : "暂无评分";
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
    url: `https://bgm.tv/subject/${id}`
  };
}

function cleanText(text) {
  return String(text)
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

async function bangumiSearch(keyword) {
  const res = await fetchWithTimeout(`${API_BASE}/v0/search/subjects?limit=24&offset=0`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({
      keyword,
      sort: "match",
      filter: {
        type: [2]
      }
    })
  });

  if (!res.ok) {
    throw new Error(`搜索失败：${res.status}`);
  }

  const json = await res.json();
  return (json.data || []).map(normalizeSubject);
}

async function bangumiRandom() {
  const randomOffset = Math.floor(Math.random() * 3600);

  const res = await fetch(
    `${API_BASE}/v0/subjects?type=2&sort=rank&limit=24&offset=${randomOffset}`,
    {
      method: "GET",
      headers: {
        "Accept": "application/json"
      }
    }
  );

  if (!res.ok) {
    throw new Error(`随机失败：${res.status}`);
  }

  const json = await res.json();
  const list = (json.data || []).map(normalizeSubject);

  if (list.length === 0) {
    throw new Error("随机结果为空");
  }

  const pick = list[Math.floor(Math.random() * list.length)];
  return [pick];
}

function renderCards(items) {
  currentItems = items;

  if (!items.length) {
    resultList.innerHTML = `<div class="empty">没有内容。试试搜索番名，或者点随机推荐。</div>`;
    return;
  }

  resultList.innerHTML = items.map(item => {
    const status = getStatus(item.id);
    const imageHtml = item.image
      ? `<img class="cover" src="${item.image}" alt="${escapeHtml(item.title)}">`
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
              <button
                class="status-btn ${status === s ? "active" : ""}"
                data-id="${item.id}"
                data-status="${s}"
              >
                ${s}
              </button>
            `).join("")}
          </div>

          <a class="open-link" href="${item.url}" target="_blank">打开 Bangumi 页面</a>
        </div>
      </article>
    `;
  }).join("");
}

function setLoading(text) {
  resultList.innerHTML = `<div class="loading">${text}</div>`;
}

function setError(text) {
  resultList.innerHTML = `<div class="error">${text}</div>`;
}

async function handleSearch() {
  const keyword = searchInput.value.trim();

  if (!keyword) {
    setError("先输入番名。比如：孤独摇滚、药屋少女、葬送的芙莉莲。");
    return;
  }

  currentMode = "search";
  resultTitle.textContent = `搜索：${keyword}`;
  resultTip.textContent = "按 Bangumi 匹配度排序，中文名优先显示。";
  setLoading("正在搜索番剧……");

  try {
    const list = await bangumiSearch(keyword);
    renderCards(list);

    if (!list.length) {
      setError("没搜到结果。可以试试日文名、别名，或者少输入几个字。");
    }
  } catch (err) {
    console.error(err);
    setError("搜索失败。可能是网络问题，或者 Bangumi API 暂时访问不了。");
  }
}

async function handleRandom() {
  currentMode = "random";
  resultTitle.textContent = "随机推荐";
  resultTip.textContent = "这不是固定推荐池，而是从 Bangumi 动画条目里随机抽取。";
  setLoading("正在随机抽取番剧……");

  try {
    const list = await bangumiRandom();
    renderCards(list);
  } catch (err) {
    console.error(err);
    setError("随机失败。大概率是当前浏览器或网络访问不了 Bangumi API。请不要在微信/QQ里直接打开，点右上角选择“在浏览器打开”，用 Edge、Chrome、Safari 再试。");
  }重试
}

function showRecords(filter) {
  currentMode = "records";

  const records = getRecords();
  let list = Object.values(records).sort((a, b) => b.updatedAt - a.updatedAt);

  if (filter !== "全部") {
    list = list.filter(item => item.status === filter);
  }

  resultTitle.textContent = filter === "全部" ? "我的全部记录" : `我的${filter}`;
  resultTip.textContent = "这些记录保存在当前浏览器里，清理浏览器数据可能会丢。";

  currentItems = list;
  renderCards(list);

  if (!list.length) {
    setError(filter === "全部" ? "你还没有标记任何番剧。" : `你还没有标记“${filter}”的番剧。`);
  }
}

searchBtn.addEventListener("click", handleSearch);

searchInput.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    handleSearch();
  }
});

randomBtn.addEventListener("click", handleRandom);

resultList.addEventListener("click", e => {
  const btn = e.target.closest(".status-btn");
  if (!btn) return;

  const id = btn.dataset.id;
  const status = btn.dataset.status;

  setStatus(id, status);
});

filterBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    filterBtns.forEach(item => item.classList.remove("active"));
    btn.classList.add("active");
    showRecords(btn.dataset.filter);
  });
});

renderCards([]);