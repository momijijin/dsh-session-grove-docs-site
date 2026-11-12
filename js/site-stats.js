/**
 * 左侧栏统计：品牌区 GitHub 数据（stars / forks / latest tag）+ npm 下载卡片。
 *
 * 两类数据都由 tools/npm-stats.mjs 在构建前抓取并写入站点根目录的 site_stats.json；
 * 浏览器只读这份本地 JSON，不再实时请求 api.github.com
 * （未认证限流 60 次/小时/IP，会 403 导致三个数值空白）。
 *
 * 品牌区统计约定：
 *   有 github 且 stars / forks / tag 齐全 → 在 .brand-title 之后渲染三项；
 *   缺失任一字段 → 不渲染统计块（不留空壳）。
 *
 * npm 卡片状态约定：
 *   available: false            → 「npm 包尚未发布」
 *   stale: true                 → 照常显示缓存值，并在时间后标注 cached
 *   请求失败 / 数值缺失          → 「下载统计暂不可用」
 */
(function () {
  'use strict';

  // 站内资源的根路径：GitHub Pages 项目子路径部署时由主题运行时配置给出，
  // 例如 /dsh-session-grove-docs-site/；读不到时退回站点根 '/'。
  function siteRoot() {
    try {
      var el = document.getElementById('stellar-runtime-config');
      if (el) {
        var cfg = JSON.parse(el.textContent);
        if (cfg && typeof cfg.root === 'string' && cfg.root) return normalizeRoot(cfg.root);
      }
    } catch (error) {
      /* 运行时配置缺失或不是合法 JSON：退回站点根 */
    }
    return '/';
  }

  // 规范化 root：保证以单个 / 开头、以 / 结尾，缺斜杠或多斜杠都能正确拼接
  function normalizeRoot(root) {
    var value = String(root).trim();
    if (!value) return '/';
    if (value.charAt(0) !== '/') value = '/' + value;
    value = value.replace(/^\/+/, '/').replace(/\/+$/, '');
    return value + '/';
  }

  // 拼接站内资源地址；path 可以带或不带开头的 /
  function assetUrl(path) {
    return siteRoot() + String(path).replace(/^\/+/, '');
  }

  var GITHUB_URL = 'https://github.com/momijijin/dsh-session-grove';
  var NPM_URL = 'https://www.npmjs.com/package/dsh-session-grove';

  function isNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function formatNumber(value) {
    if (!isNumber(value)) return '—';
    try {
      return value.toLocaleString('zh-CN');
    } catch (error) {
      return String(value);
    }
  }

  function formatTime(iso) {
    if (typeof iso !== 'string' || iso.length === 0) return '';
    var date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    var pad = function (value) {
      return String(value).padStart(2, '0');
    };
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
      ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  // 品牌区统计：DOM 顺序固定为 stars → forks → tag。
  // css/custom.css 用 .brand-stat:last-child + order:-1 把最后一项 tag 提到第一行独占整行，
  // 所以 tag 必须始终是最后一个 .brand-stat。
  function renderBrandStats(github) {
    if (!github || typeof github !== 'object') return;
    if (!isNumber(github.stars) || !isNumber(github.forks)) return;
    if (typeof github.tag !== 'string' || github.tag.trim() === '') return;

    var header = document.querySelector('.site-region--leftbar .brand-header--regular') ||
      document.querySelector('.brand-header--regular');
    if (!header) return;

    var title = header.querySelector('.brand-title');
    if (!title || !title.parentNode) return;
    // 主题自带的 ghrepo 已关闭；这里再做一次去重，避免脚本被重复引入时出现两块
    if (header.querySelector('.brand-stats')) return;

    var block = document.createElement('div');
    block.className = 'brand-stats';

    [
      { value: formatNumber(github.stars), label: 'stars', href: GITHUB_URL + '/stargazers' },
      { value: formatNumber(github.forks), label: 'forks', href: GITHUB_URL + '/forks' },
      { value: github.tag, label: 'latest tag', href: GITHUB_URL + '/releases' }
    ].forEach(function (item) {
      var link = document.createElement('a');
      link.className = 'brand-stat ui-interactive';
      link.href = item.href;
      link.target = '_blank';
      link.rel = 'noopener';

      var value = document.createElement('span');
      value.className = 'brand-stat__value';
      value.textContent = item.value;

      var label = document.createElement('span');
      label.className = 'brand-stat__label';
      label.textContent = item.label;

      link.appendChild(value);
      link.appendChild(label);
      block.appendChild(link);
    });

    // 插到 .brand-title 之后；.brand-title 在 .brand-wrap 内，保持与主题原统计块同层
    title.parentNode.insertBefore(block, title.nextSibling);
  }

  var container = document.getElementById('npm-stats');

  function renderNpmStats(stats) {
    if (!container) return;

    if (stats && stats.available === false) {
      container.textContent = 'npm 包尚未发布';
      return;
    }
    if (!stats || !isNumber(stats.weekly) || !isNumber(stats.monthly) || !isNumber(stats.total)) {
      container.textContent = '下载统计暂不可用';
      return;
    }

    container.textContent = '';

    var tiles = document.createElement('div');
    tiles.className = 'site-stats__tiles';
    [
      ['week', stats.weekly],
      ['month', stats.monthly],
      ['total', stats.total]
    ].forEach(function (entry) {
      var tile = document.createElement('a');
      tile.className = 'brand-stat site-stats__tile';
      tile.href = NPM_URL;
      tile.target = '_blank';
      tile.rel = 'noopener';

      var value = document.createElement('span');
      value.className = 'brand-stat__value';
      value.textContent = formatNumber(entry[1]);

      var label = document.createElement('span');
      label.className = 'brand-stat__label';
      label.textContent = entry[0];

      tile.appendChild(value);
      tile.appendChild(label);
      tiles.appendChild(tile);
    });
    container.appendChild(tiles);

    var time = formatTime(stats.fetched_at);
    if (time) {
      var meta = document.createElement('p');
      meta.className = 'site-stats__meta';
      meta.textContent = 'updated ' + time + (stats.stale === true ? ' (cached)' : '');
      container.appendChild(meta);
    }
  }

  fetch(assetUrl('site_stats.json'), { cache: 'no-cache' })
    .then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    })
    .then(function (stats) {
      renderBrandStats(stats && stats.github);
      renderNpmStats(stats);
    })
    .catch(function () {
      if (container) container.textContent = '下载统计暂不可用';
    });
})();
