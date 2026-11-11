/**
 * 左侧栏 npm 下载统计卡片。
 *
 * 数据由 tools/npm-stats.mjs 生成到站点根目录的 site_stats.json；这里只做拉取与渲染，
 * 不依赖任何第三方库。状态约定：
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

  // 品牌区第三个统计项默认渲染为 `tag`，链接指向仓库 /tags。
  // 这里把链接改到 GitHub Releases、文案改成 `latest tag`：
  // 链接每次都写（幂等），文案只在仍是默认值时改，避免覆盖主题的其他状态；失败静默。
  var RELEASES_URL = 'https://github.com/momijijin/dsh-session-grove/releases';
  try {
    var tagValue = document.getElementById('latest-tag-name');
    var tagLink = tagValue && tagValue.closest ? tagValue.closest('a') : null;
    if (!tagLink) {
      tagLink = document.querySelector('.brand-stats a[href*="/tags"]') ||
        document.querySelector('.brand-stats > .brand-stat:last-child');
    }
    if (tagLink) {
      tagLink.setAttribute('href', RELEASES_URL);
      var tagLabel = tagLink.querySelector('.brand-stat__label');
      if (tagLabel && tagLabel.textContent.trim() === 'tag') {
        tagLabel.textContent = 'latest tag';
      }
    }
  } catch (error) {
    // 标签与链接只是展示文案，取不到或浏览器不支持时忽略。
  }

  var NPM_URL = 'https://www.npmjs.com/package/dsh-session-grove';
  var container = document.getElementById('npm-stats');
  if (!container) return;

  function setMessage(text) {
    container.textContent = text;
  }

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

  function render(stats) {
    if (stats && stats.available === false) {
      setMessage('npm 包尚未发布');
      return;
    }
    if (!stats || !isNumber(stats.weekly) || !isNumber(stats.monthly) || !isNumber(stats.total)) {
      setMessage('下载统计暂不可用');
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
    .then(render)
    .catch(function () {
      setMessage('下载统计暂不可用');
    });
})();
