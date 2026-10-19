(function () {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  let config = {}, allVersions = [], isLaunching = false;

  // Навигация
  $$('.nav-item').forEach(btn => {
    btn.onclick = () => {
      $$('.nav-item').forEach(b => b.classList.remove('active'));
      $$('.page').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const page = document.getElementById('page-' + btn.dataset.page);
      if (page) page.classList.add('active');
      
      // Авто-загрузка данных при переходе
      if (btn.dataset.page === 'mods') loadMods();
      if (btn.dataset.page === 'servers') renderServers();
      if (btn.dataset.page === 'screenshots') loadScreenshots();
    };
  });

  // Окно
  $('#btn-min').onclick = () => window.mew.minimize();
  $('#btn-max').onclick = () => window.mew.maximize();
  $('#btn-close').onclick = () => window.mew.close();

  function applyTheme(theme) { document.body.className = 'theme-' + theme; }

  function log(msg, type = 'debug') {
    const el = $('#console');
    if (!el) return;
    el.innerHTML += `<div>[${new Date().toLocaleTimeString()}] ${msg}</div>`;
    el.scrollTop = el.scrollHeight;
  }

  // Инициализация настроек и профилей
  function fillSettings() {
    $('#hero-nick').textContent = config.nickname;
    $('#side-nick').textContent = config.nickname;
    $('#set-ram').value = config.ram;
    $('#ram-val').textContent = config.ram + ' МБ';
    $('#set-java').value = config.javaPath;
    $('#set-dir').value = config.gameDir;
    $('#set-theme').value = config.theme;
    
    // Профили
    const hp = $('#home-profile');
    hp.innerHTML = config.profiles.map(p => `<option value="${p}">${p}</option>`).join('');
    hp.value = config.activeProfile;

    // Фон
    if (config.bgImage) {
      $('#bg-overlay').style.backgroundImage = `url('file://${config.bgImage.replace(/\\/g, '/')}')`;
    }
  }

  // Сбор конфига при сохранении
  async function saveSettings() {
    config.ram = Number($('#set-ram').value);
    config.javaPath = $('#set-java').value;
    config.gameDir = $('#set-dir').value;
    config.theme = $('#set-theme').value;
    await window.mew.setConfig(config);
    applyTheme(config.theme);
    alert('Настройки сохранены!');
  }
  $('#btn-save').onclick = saveSettings;

  // Профили
  $('#btn-new-profile').onclick = async () => {
    const name = prompt('Название новой сборки (латиницей, без пробелов):');
    if (name && !config.profiles.includes(name)) {
      config.profiles.push(name);
      config.activeProfile = name;
      await window.mew.setConfig(config);
      fillSettings();
      loadMods(); // Очищаем список модов под новый профиль
    }
  };

  $('#home-profile').onchange = async (e) => {
    config.activeProfile = e.target.value;
    await window.mew.setConfig(config);
    loadMods(); 
  };

  // Кнопки выбора путей
  $('#btn-pick-java').onclick = async () => { const p = await window.mew.pickJava(); if (p) $('#set-java').value = p; };
  $('#btn-pick-dir').onclick = async () => { const p = await window.mew.pickFolder(); if (p) $('#set-dir').value = p; };
  $('#btn-pick-bg').onclick = async () => { 
    const p = await window.mew.pickBgImage(); 
    if (p) { 
      config.bgImage = p; 
      await window.mew.setConfig(config);
      $('#bg-overlay').style.backgroundImage = `url('file://${p.replace(/\\/g, '/')}')`; 
    } 
  };
  $('#set-theme').onchange = (e) => applyTheme(e.target.value);
  $('#set-ram').oninput = (e) => $('#ram-val').textContent = e.target.value + ' МБ';

  // ==========================================
  // ЗАГРУЗКА МОДОВ (Drag & Drop)
  // ==========================================
  async function loadMods() {
    const list = $('#mods-list');
    const mods = await window.mew.modsList();
    if (!mods.length) {
      list.innerHTML = '<div style="color:var(--m-fg-subtle); text-align:center;">В этой сборке пока нет модов</div>';
      return;
    }
    list.innerHTML = mods.map(m => `
      <div class="mod-card">
        <div><b>${m.name}</b> <span style="color:var(--m-fg-subtle); font-size:12px;">(${m.size})</span></div>
        <button class="btn-ghost" onclick="window.mew.modsRemove('${m.name}').then(loadModsRender)">Удалить</button>
      </div>
    `).join('');
  }
  window.loadModsRender = loadMods; // Для вызова из HTML

  // Drag & Drop
  const dropZone = $('#drop-zone');
  dropZone.ondragover = (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--m-accent)'; };
  dropZone.ondragleave = (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--m-border-strong)'; };
  dropZone.ondrop = async (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--m-border-strong)';
    const files = Array.from(e.dataTransfer.files).map(f => f.path);
    if (files.length) {
      await window.mew.modsDrop(files);
      loadMods();
    }
  };
  $('#btn-mods-folder').onclick = () => window.mew.openFolder(config.gameDir || '');

  // ==========================================
  // МАГАЗИН MODRINTH
  // ==========================================
  $('#btn-store-find').onclick = async () => {
    const q = $('#store-search').value;
    if (!q) return;
    const grid = $('#store-grid');
    grid.innerHTML = '<div>Поиск...</div>';
    const res = await window.mew.searchMods(q);
    
    if (res.ok) {
      grid.innerHTML = res.hits.map(m => `
        <div class="version-card" style="display:flex; flex-direction:column; justify-content:space-between;">
          <div>
            <img src="${m.icon_url}" style="width:48px; height:48px; border-radius:8px; margin-bottom:10px;" />
            <h4>${m.title}</h4>
            <p style="font-size:11px; color:var(--m-fg-subtle); margin-bottom:10px;">${m.description.substring(0, 50)}...</p>
          </div>
          <button class="btn-primary" style="width:100%;" onclick="installMod('${m.project_id}')">Скачать</button>
        </div>
      `).join('');
    } else {
      grid.innerHTML = '<div>Ошибка: ' + res.error + '</div>';
    }
  };

  window.installMod = async (id) => {
    log('Скачивание мода...', 'info');
    const version = $('#home-version').value;
    const loader = $('#home-loader').value;
    const res = await window.mew.downloadMod(id, version, loader);
    if (res.ok) {
      alert('Мод успешно скачан в текущую сборку!');
      loadMods();
    } else {
      alert('Ошибка: ' + res.error);
    }
  };

  // ==========================================
  // СЕРВЕРА
  // ==========================================
  async function renderServers() {
    const list = $('#servers-list');
    list.innerHTML = '';
    for (const ip of config.servers) {
      const res = await window.mew.pingServer(ip);
      const color = res.online ? '#5EC64D' : '#ff5c5c';
      const status = res.online ? `${res.players} игроков` : 'Оффлайн';
      list.innerHTML += `
        <div class="mod-card">
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="width:10px; height:10px; border-radius:50%; background:${color}; box-shadow:0 0 8px ${color};"></div>
            <b>${ip}</b>
          </div>
          <div style="color:${color}">${status}</div>
        </div>
      `;
    }
  }

  $('#btn-add-server').onclick = async () => {
    const ip = $('#server-ip-input').value.trim();
    if (ip && !config.servers.includes(ip)) {
      config.servers.push(ip);
      await window.mew.setConfig(config);
      $('#server-ip-input').value = '';
      renderServers();
    }
  };

  // ==========================================
  // СКРИНШОТЫ
  // ==========================================
  async function loadScreenshots() {
    const grid = $('#screenshots-grid');
    const shots = await window.mew.getScreenshots();
    if (!shots.length) {
      grid.innerHTML = '<div>Скриншотов не найдено</div>';
      return;
    }
    grid.innerHTML = shots.map(s => `
      <div class="version-card" style="padding:0; overflow:hidden;">
        <img src="${s.path}" style="width:100%; height:120px; object-fit:cover; display:block;" />
      </div>
    `).join('');
  }
  $('#btn-refresh-shots').onclick = loadScreenshots;

  // ==========================================
  // ВЕРСИИ И ЗАПУСК
  // ==========================================
  async function loadVersions() {
    const res = await window.mew.getVersions();
    if (res.ok) {
      allVersions = res.versions;
      const opts = allVersions.map(v => `<option value="${v.id}">${v.id}</option>`).join('');
      $('#home-version').innerHTML = opts;
      $('#home-version').value = config.version;
    }
  }

  async function startLaunch() {
    if (isLaunching) return;
    isLaunching = true;
    $('#btn-play').disabled = true;
    $('.btn-play-text').textContent = 'ЗАПУСК...';
    
    // Перекидываем на консоль
    document.querySelector('[data-page="console"]').click();

    const launchCfg = {
      ...config,
      version: $('#home-version').value,
      loader: $('#home-loader').value
    };

    const res = await window.mew.launch(launchCfg);
    if (!res.ok) {
      log('Ошибка: ' + res.error, 'error');
      isLaunching = false;
      $('#btn-play').disabled = false;
      $('.btn-play-text').textContent = 'ИГРАТЬ';
    }
  }
  $('#btn-play').onclick = startLaunch;
  window.mew.onClose(() => {
    isLaunching = false;
    $('#btn-play').disabled = false;
    $('.btn-play-text').textContent = 'ИГРАТЬ';
  });
  window.mew.onLog(d => log(d.message, d.type));

  // ==========================================
  // СТАРТ
  // ==========================================
  async function init() {
    config = await window.mew.getConfig();
    applyTheme(config.theme);
    fillSettings();
    await loadVersions();
    log('MewClient Launcher успешно запущен!', 'sys');
  }
  init();
})();