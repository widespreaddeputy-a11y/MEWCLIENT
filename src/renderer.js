const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

let config = {};
let allVersions = [];
let isLaunching = false;

$$('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.nav-item').forEach((b) => b.classList.remove('active'));
    $$('.page').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('page-' + btn.dataset.page).classList.add('active');
  });
});

$('#btn-min').onclick = () => window.mew.minimize();
$('#btn-max').onclick = () => window.mew.maximize();
$('#btn-close').onclick = () => window.mew.close();

function log(message, type = 'debug') {
  const el = $('#console');
  const line = document.createElement('div');
  line.className = 'log-line log-' + type;
  const time = new Date().toLocaleTimeString('ru-RU');
  line.textContent = `[${time}] ${message}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
  while (el.children.length > 800) el.removeChild(el.firstChild);
}

$('#btn-clear-log').onclick = () => { $('#console').innerHTML = ''; };

function renderVersions() {
  const grid = $('#versions-grid');
  const query = ($('#version-search').value || '').toLowerCase().trim();

  let list = allVersions;
  if (query) list = list.filter((v) => v.id.toLowerCase().includes(query));

  if (!list.length) {
    grid.innerHTML = '<div class="empty">Ничего не найдено</div>';
    return;
  }

  grid.innerHTML = list.map((v) => `
    <div class="version-card ${v.id === config.version ? 'selected' : ''}" data-id="${v.id}">
      <span class="v-badge">Release</span>
      <div class="v-id">${v.id}</div>
      <div class="v-meta">${new Date(v.releaseTime).toLocaleDateString('ru-RU')}</div>
    </div>
  `).join('');

  grid.querySelectorAll('.version-card').forEach((card) => {
    card.onclick = () => selectVersion(card.dataset.id);
  });
}

function selectVersion(id) {
  config.version = id;
  $('#home-version').value = id;
  $('#set-version').value = id;
  $('#side-version').textContent = id;
  renderVersions();
  log(`Выбрана версия: ${id}`, 'sys');
}

function fillVersionSelects() {
  const opts = allVersions.map((v) => `<option value="${v.id}">${v.id}</option>`).join('');
  $('#home-version').innerHTML = opts;
  $('#set-version').innerHTML = opts;
}

async function loadVersions() {
  const grid = $('#versions-grid');
  grid.innerHTML = '<div class="empty">Загрузка списка версий...</div>';
  log('Загружаю список версий Mojang...', 'sys');

  const res = await window.mew.getVersions();
  if (!res.ok) {
    grid.innerHTML = `<div class="empty">Не удалось загрузить версии: ${res.error}</div>`;
    log('Ошибка загрузки версий: ' + res.error, 'error');
    return;
  }

  allVersions = res.versions;
  log(`Загружено версий: ${allVersions.length} (от 1.8.9 до новых)`, 'sys');

  if (!allVersions.find((v) => v.id === config.version)) {
    const fallback = allVersions.find((v) => v.id === res.latest.release) || allVersions[0];
    if (fallback) config.version = fallback.id;
  }

  fillVersionSelects();
  $('#home-version').value = config.version;
  $('#set-version').value = config.version;
  $('#side-version').textContent = config.version;

  renderVersions();
}

$('#version-search').addEventListener('input', renderVersions);
$('#btn-refresh').onclick = () => loadVersions();

function updateAccountUI() {
  const nick = ($('#home-nick').value || 'Player').trim() || 'Player';
  $('#side-nick').textContent = nick;
  $('#avatar').textContent = nick.charAt(0).toUpperCase();
}

function fillSettings() {
  $('#home-nick').value = config.nickname;
  $('#set-nick').value = config.nickname;
  $('#set-ram').value = config.ram;
  $('#ram-val').textContent = config.ram + ' МБ';
  $('#set-java').value = config.javaPath || '';
  $('#set-w').value = config.width;
  $('#set-h').value = config.height;
  $('#set-fullscreen').checked = !!config.fullscreen;
  $('#set-dir').value = config.gameDir || '';
  updateAccountUI();
}

function collectConfig() {
  return {
    nickname: ($('#set-nick').value || '').trim() || 'Steve',
    version: $('#set-version').value || config.version,
    ram: Number($('#set-ram').value) || 4096,
    javaPath: ($('#set-java').value || '').trim(),
    gameDir: ($('#set-dir').value || '').trim(),
    width: Number($('#set-w').value) || 1280,
    height: Number($('#set-h').value) || 720,
    fullscreen: $('#set-fullscreen').checked
  };
}

$('#set-ram').addEventListener('input', (e) => {
  $('#ram-val').textContent = e.target.value + ' МБ';
});

$('#home-nick').addEventListener('input', updateAccountUI);
$('#set-nick').addEventListener('input', () => {
  $('#home-nick').value = $('#set-nick').value;
  updateAccountUI();
});
$('#home-nick').addEventListener('change', () => {
  $('#set-nick').value = $('#home-nick').value;
  updateAccountUI();
});

$('#home-version').addEventListener('change', (e) => {
  config.version = e.target.value;
  $('#set-version').value = e.target.value;
  $('#side-version').textContent = e.target.value;
  renderVersions();
});

$('#set-version').addEventListener('change', (e) => {
  config.version = e.target.value;
  $('#home-version').value = e.target.value;
  $('#side-version').textContent = e.target.value;
  renderVersions();
});

$('#btn-pick-java').onclick = async () => {
  const p = await window.mew.pickJava();
  if (p) $('#set-java').value = p;
};

$('#btn-detect-java').onclick = async () => {
  const res = await window.mew.detectJava();
  if (res.ok) { $('#set-java').value = res.path; log('Java найдена: ' + res.path, 'sys'); }
  else log('Java не найдена автоматически. Укажи путь вручную.', 'error');
};

$('#btn-pick-dir').onclick = async () => {
  const p = await window.mew.pickFolder();
  if (p) $('#set-dir').value = p;
};

$('#btn-open-dir').onclick = async () => {
  await window.mew.openFolder($('#set-dir').value);
};

$('#btn-save').onclick = async () => {
  const cfg = collectConfig();
  await window.mew.setConfig(cfg);
  config = { ...config, ...cfg };
  const st = $('#save-status');
  st.textContent = '✓ Сохранено';
  st.classList.add('show');
  setTimeout(() => st.classList.remove('show'), 2000);
  log('Настройки сохранены', 'sys');
};

$('#btn-play').onclick = async () => {
  if (isLaunching) return;
  const cfg = {
    ...collectConfig(),
    nickname: ($('#home-nick').value || '').trim() || 'Steve',
    version: $('#home-version').value || config.version
  };
  if (cfg.nickname.length < 3) { alert('Ник должен быть не короче 3 символов'); return; }

  isLaunching = true;
  $('#btn-play').disabled = true;
  $('.btn-play-text').textContent = 'ЗАПУСК...';
  $('#progress-box').classList.add('show');
  setProgress(0, 'Подготовка...');
  document.querySelector('.nav-item[data-page="console"]').click();

  const res = await window.mew.launch(cfg);
  if (!res.ok) {
    log('Ошибка запуска: ' + (res.error || 'неизвестно'), 'error');
    resetPlayButton();
  }
};

function setProgress(percent, label) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  $('#progress-fill').style.width = p + '%';
  $('#progress-percent').textContent = p + '%';
  if (label) $('#progress-label').textContent = label;
}

function resetPlayButton() {
  isLaunching = false;
  $('#btn-play').disabled = false;
  $('.btn-play-text').textContent = 'ИГРАТЬ';
  setTimeout(() => $('#progress-box').classList.remove('show'), 1500);
}

window.mew.onLog((d) => log(d.message, d.type || 'debug'));

window.mew.onProgress((d) => {
  if (!d.total) return;
  const percent = (d.task / d.total) * 100;
  const labels = {
    assets: 'Загрузка ресурсов',
    natives: 'Загрузка библиотек',
    classes: 'Загрузка библиотек',
    download: d.name ? `Скачивание: ${d.name}` : 'Скачивание'
  };
  setProgress(percent, labels[d.type] || 'Загрузка...');
});

window.mew.onClose((d) => {
  log(`Игра закрыта (код ${d.code})`, 'sys');
  resetPlayButton();
  setProgress(100, 'Готово!');
});

async function checkUpdates() {
  const res = await window.mew.checkUpdate();
  if (!res.ok) {
    log('Ошибка проверки обновлений: ' + res.error, 'debug');
    return;
  }
  if (!res.hasUpdate) {
    log(`Установлена последняя версия: ${res.current}`, 'sys');
    return;
  }
  log(`Доступна новая версия: ${res.latest} (у тебя ${res.current})`, 'sys');

  $('#update-current').textContent = res.current;
  $('#update-latest').textContent = res.latest;
  $('#update-modal').style.display = 'flex';
  $('#update-modal').dataset.url = res.releaseUrl;
}

$('#update-later').onclick = () => {
  $('#update-modal').style.display = 'none';
};

$('#update-download').onclick = () => {
  const url = $('#update-modal').dataset.url;
  if (url) window.mew.openExternal(url);
  $('#update-modal').style.display = 'none';
};

async function init() {
  log('MewClient Launcher запущен', 'sys');
  config = await window.mew.getConfig();
  const info = await window.mew.appInfo();
  log(`Версия лаунчера: ${info.version} | ОС: ${info.platform} (${info.arch})`, 'sys');
  fillSettings();
  await loadVersions();
  const detect = await window.mew.detectJava();
  if (detect.ok && !config.javaPath) log('Java обнаружена: ' + detect.path, 'sys');
  setTimeout(checkUpdates, 3000);
}

init();