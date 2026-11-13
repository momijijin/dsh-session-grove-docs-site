/**
 * 左侧栏统计：品牌区 GitHub 胶囊（版本 / Stars / Forks）+ npm 下载卡片。
 *
 * 两类数据都由 tools/npm-stats.mjs 在构建前抓取并写入站点根目录的 site_stats.json；
 * 浏览器只读这份本地 JSON，不再实时请求 api.github.com
 * （未认证限流 60 次/小时/IP，会 403 导致三个数值空白）。
 *
 * 品牌区约定：
 *   有 github 且 stars / forks / tag 齐全 → 在 .brand-title 之后渲染一个居中胶囊；
 *   缺失任一字段 → 不渲染，不留空壳。胶囊视觉上是一个整体，
 *   内部仍保留 GitHub / 最新版本 / Stars / Forks 四个独立链接。
 *
 * npm 卡片状态约定：
 *   available: false            → 「npm 包尚未发布」
 *   stale: true                 → 照常显示缓存值，并在时间旁加「缓存」小标签
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
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var GITHUB_MARK = 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z';
  var STAR_MARK = 'M8 1.5l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.3l-3.8 2 .7-4.3-3.1-3 4.3-.6z';
  var FORK_MARK = 'M5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm0 2.122a2.25 2.25 0 1 0-1.5 0v.878A2.25 2.25 0 0 0 5.75 8.5h1.5v2.128a2.251 2.251 0 1 0 1.5 0V8.5h1.5a2.25 2.25 0 0 0 2.25-2.25v-.878a2.25 2.25 0 1 0-1.5 0v.878a.75.75 0 0 1-.75.75h-4.5A.75.75 0 0 1 5 6.25v-.878Z';
  var ARROW_PATH = 'M7 17 17 7M9 7h8v8';
  var CLOCK_PATH = 'M12 7v5l3 2';

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

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  // 完整时间：YYYY-MM-DD HH:MM，用作 title 提示
  function formatTime(iso) {
    if (typeof iso !== 'string' || iso.length === 0) return '';
    var date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
      ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  // 展示时间：MM-DD HH:MM，避免把完整日期塞进 232px 侧栏
  function formatShortTime(iso) {
    if (typeof iso !== 'string' || iso.length === 0) return '';
    var date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
      ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  // 两个 ISO 时间是否落在同一个 UTC 日；用于识别「最新版发布当天，npm 数据尚未回填」。
  function sameUtcDay(left, right) {
    var a = new Date(left);
    var b = new Date(right);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;
    return a.getUTCFullYear() === b.getUTCFullYear() &&
      a.getUTCMonth() === b.getUTCMonth() &&
      a.getUTCDate() === b.getUTCDate();
  }

  function svgPath(d, options) {
    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    if (options && options.stroke === true) {
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', String((options && options.strokeWidth) || 2));
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
    } else {
      path.setAttribute('fill', 'currentColor');
    }
    return path;
  }

  function svgCircle(cx, cy, r) {
    var circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', String(cx));
    circle.setAttribute('cy', String(cy));
    circle.setAttribute('r', String(r));
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', 'currentColor');
    circle.setAttribute('stroke-width', '2');
    return circle;
  }

  function svgIcon(viewBox, size, children) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', viewBox);
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    children.forEach(function (child) {
      svg.appendChild(child);
    });
    return svg;
  }

  function externalLink(href, label) {
    var link = document.createElement('a');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener';
    link.setAttribute('aria-label', label);
    return link;
  }

  function capsuleDivider() {
    var divider = document.createElement('span');
    divider.className = 'brand-capsule__divider';
    divider.setAttribute('aria-hidden', 'true');
    return divider;
  }

  function capsuleStat(path, label, value) {
    var link = externalLink(GITHUB_URL + '/' + path, label + ' ' + formatNumber(value));
    link.className = 'brand-capsule__stat ui-interactive';
    link.title = label + ': ' + formatNumber(value);
    link.appendChild(svgIcon('0 0 16 16', 10, [svgPath(path === 'stargazers' ? STAR_MARK : FORK_MARK)]));

    var number = document.createElement('b');
    number.textContent = formatNumber(value);
    link.appendChild(number);
    return link;
  }

  // 品牌区：一个居中胶囊，内部是 GitHub / 最新版本 / Stars / Forks 四个链接。
  function renderBrandStats(github) {
    if (!github || typeof github !== 'object') return;
    if (!isNumber(github.stars) || !isNumber(github.forks)) return;
    if (typeof github.tag !== 'string' || github.tag.trim() === '') return;

    var header = document.querySelector('.site-region--leftbar .brand-header--regular') ||
      document.querySelector('.brand-header--regular');
    if (!header) return;

    var title = header.querySelector('.brand-title');
    if (!title || !title.parentNode) return;
    // 主题自带 ghrepo 已关闭；脚本重复执行时也不再插入第二个胶囊
    if (header.querySelector('.brand-capsule')) return;

    var capsule = document.createElement('div');
    capsule.className = 'brand-capsule';

    var repo = externalLink(GITHUB_URL, '打开 GitHub 仓库');
    repo.className = 'brand-capsule__repo ui-interactive';
    repo.title = 'GitHub 仓库';
    repo.appendChild(svgIcon('0 0 16 16', 12, [svgPath(GITHUB_MARK)]));
    capsule.appendChild(repo);

    var version = externalLink(GITHUB_URL + '/releases', '最新版本 ' + github.tag);
    version.className = 'brand-capsule__version';
    version.title = '最新版本 ' + github.tag;
    version.textContent = github.tag;
    capsule.appendChild(version);

    capsule.appendChild(capsuleDivider());
    capsule.appendChild(capsuleStat('stargazers', 'Stars', github.stars));
    capsule.appendChild(capsuleDivider());
    capsule.appendChild(capsuleStat('forks', 'Forks', github.forks));

    title.parentNode.insertBefore(capsule, title.nextSibling);
  }

  var container = document.getElementById('npm-stats');
  var npmWidget = container && container.closest ? container.closest('widget') : null;

  // 卡片头部：npm 红色字标由 CSS ::before 补在「下载量」前；
  // 这里给头部补可读的语义标签，并追加右上角外链箭头。
  function decorateNpmWidget() {
    if (!npmWidget) return;
    npmWidget.classList.add('site-stats-widget');

    var header = npmWidget.querySelector('.widget-header');
    if (!header) return;

    var name = header.querySelector('.name');
    if (name) name.setAttribute('aria-label', 'npm 下载量');

    if (header.querySelector('.site-stats__link')) return;
    var link = externalLink(NPM_URL, '打开 npm 包页面');
    link.className = 'site-stats__link ui-interactive';
    link.title = '打开 npm 包页面';
    link.appendChild(svgIcon('0 0 24 24', 12, [svgPath(ARROW_PATH, { stroke: true })]));
    header.appendChild(link);
  }

  decorateNpmWidget();

  function npmMetaItem(label, value) {
    var item = document.createElement('div');
    item.className = 'site-stats__item';

    var labelNode = document.createElement('span');
    labelNode.className = 'site-stats__label';
    labelNode.textContent = label;

    var valueNode = document.createElement('span');
    valueNode.className = 'site-stats__val';
    valueNode.textContent = formatNumber(value);

    item.appendChild(labelNode);
    item.appendChild(valueNode);
    return item;
  }

  function renderNpmMessage(message) {
    if (!container) return;
    container.textContent = '';
    var text = document.createElement('p');
    text.className = 'site-stats__empty';
    text.textContent = message;
    container.appendChild(text);
  }

  function renderNpmStats(stats) {
    if (!container) return;

    if (stats && stats.available === false) {
      renderNpmMessage('npm 包尚未发布');
      return;
    }
    if (!stats || !isNumber(stats.weekly) || !isNumber(stats.monthly) || !isNumber(stats.total)) {
      renderNpmMessage('下载统计暂不可用');
      return;
    }

    container.textContent = '';

    var latest = stats.latest && typeof stats.latest === 'object' ? stats.latest : null;
    var latestValue = latest && isNumber(latest.downloads) ? latest.downloads : null;
    var latestVersion = latest && typeof latest.version === 'string' ? latest.version : '';
    var latestPending = latestValue === 0 && latestVersion && latest.publishedAt &&
      sameUtcDay(latest.publishedAt, stats.fetched_at);

    var primary = document.createElement('div');
    primary.className = 'site-stats__primary';
    primary.title = latestPending
      ? '最新版发布当天，npm 按日数据尚未回填'
      : latestValue === null
        ? 'npm 暂未提供最新版下载量'
        : '最新版 ' + latestVersion + ' 发布以来（npm 按日回填，发布当天可能为 0）';

    var number = document.createElement('span');
    number.className = 'site-stats__num';
    number.textContent = latestPending || latestValue === null ? '—' : formatNumber(latestValue);
    if (latestPending || latestValue === null) number.setAttribute('data-empty', 'true');

    var caption = document.createElement('span');
    caption.className = 'site-stats__cap';
    caption.textContent = '最新版发布以来';

    primary.appendChild(number);
    primary.appendChild(caption);

    if (latestPending) {
      var pending = document.createElement('span');
      pending.className = 'site-stats__pending';
      pending.textContent = '回填中';
      primary.appendChild(pending);
    }

    var secondary = document.createElement('div');
    secondary.className = 'site-stats__secondary';
    secondary.appendChild(npmMetaItem('本周', stats.weekly));
    secondary.appendChild(npmMetaItem('本月', stats.monthly));

    container.appendChild(primary);
    container.appendChild(secondary);

    var fullTime = formatTime(stats.fetched_at);
    var shortTime = formatShortTime(stats.fetched_at);
    var hasTotal = isNumber(stats.total);
    var meta = document.createElement('div');
    meta.className = 'site-stats__meta';
    var hasMeta = false;

    if (hasTotal) {
      var total = document.createElement('span');
      total.className = 'site-stats__total';
      total.textContent = '累计 ' + formatNumber(stats.total);
      meta.appendChild(total);
      hasMeta = true;
    }

    if (shortTime) {
      meta.title = '数据更新于 ' + fullTime;
      var right = document.createElement('span');
      right.className = 'site-stats__meta-right';

      var time = document.createElement('span');
      time.className = 'site-stats__time';
      time.appendChild(svgIcon('0 0 24 24', 11, [svgCircle(12, 12, 9), svgPath(CLOCK_PATH, { stroke: true })]));

      var timeText = document.createElement('span');
      timeText.textContent = '更新于 ' + shortTime;
      time.appendChild(timeText);
      right.appendChild(time);

      if (stats.stale === true || (latest && latest.stale === true)) {
        var stale = document.createElement('span');
        stale.className = 'site-stats__stale';
        stale.textContent = '缓存';
        right.appendChild(stale);
      }

      meta.appendChild(right);
      hasMeta = true;
    }

    if (hasMeta) {
      if (!hasTotal) meta.classList.add('site-stats__meta--end');
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
      renderNpmMessage('下载统计暂不可用');
    });
})();
