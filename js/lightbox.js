/**
 * 图片灯箱：本地 GLightbox 3.3.1（MIT）接管 `.md-text img`。
 *
 * 主题自带的灯箱集成已在 _config.stellar.yml 关闭（features.lightbox.enabled: false），
 * 这里自行加载本地资源，不依赖任何第三方 CDN（路径相对站点 root）：
 *   - vendor/glightbox/glightbox.min.js
 *   - vendor/glightbox/glightbox.min.css
 *
 * 懒加载兼容（关键）：主题把真实图片地址写在 data-src，src 先放 1×1 透明占位。
 * GLightbox 在初始化时就把每张图的地址缓存进了 slide 配置，若不处理，
 * 点开任意一张看到的都会是占位图，左右切换也会翻到占位图。
 * 因此：
 *   1. 初始化后立刻用 data-src 回填 GLightbox 缓存的地址；
 *   2. 点击时再兜一层：若 src 仍是 data: 占位，则拦下事件，
 *      按 data-src 单独打开一张原图，绝不打开 1×1 占位。
 *
 * 桌面缩放（本文件补充）：
 * GLightbox 自带 zoomable 的桌面单击缩放、draggable 的拖拽翻页会与这里的
 * 滚轮/双击缩放、缩放后拖拽平移抢同一张 img 的 transform，因此两个实例都
 * 关闭 zoomable / draggable，改由 pointer:fine 设备上的本文件逻辑接管。
 * 触屏双指缩放仍由 GLightbox 的 touchNavigation 负责（其 pinch 逻辑只受
 * touchNavigation 控制，与 zoomable / draggable 无关）。
 *
 * 事件绑定在 document 的捕获阶段（addEventListener(..., true)），而不是某个
 * slide 容器上：灯箱 open 时挂载 wheel / dblclick / mousedown，close 时卸载。
 * GLightbox 会按需创建、克隆、替换 slide 的 DOM，任何“打开那一刻抓到的容器
 * 引用”都可能在真实事件到来前就失效或还没插入文档，监听器于是挂在死节点上；
 * document 本身不随灯箱重建，捕获阶段又从根节点向下先于冒泡触达，因此不再
 * 依赖节点身份，也不会被中途的 stopPropagation 吞掉。事件到来时先用
 * `e.target.closest('.glightbox-container')` 判断归属，再从当前 slide 动态解析
 * <img>，绝不缓存图片 / 容器引用；transform 始终施加在解析出来的 <img> 上，
 * 坐标换算也用它的实时 getBoundingClientRect()。
 *
 * 任何一步失败都静默跳过，不影响页面其余功能。
 */
(function () {
  'use strict';

  var SELECTOR = '.md-text img';

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

  var ZOOM_MIN = 1;
  var ZOOM_MAX = 4;
  var ZOOM_DOUBLE_CLICK = 2.5;
  var POINTER_QUERY = '(pointer: fine)';
  // 灯箱最外层容器：document 捕获层用它判断事件是否归灯箱处理
  var CONTAINER_SELECTOR = '.glightbox-container';
  // 图片媒体层：GLightbox 3.3.1 里 .gslide-media 与 .gslide-image 是同一个节点
  var MEDIA_SELECTOR = '.gslide-media, .gslide-image';
  // 容器里这些元素上的事件仍归 GLightbox / 页面：按钮、灯箱标题、说明文字
  var UI_TARGET_SELECTOR = 'button, .gslide-title, .gslide-description';

  var domReady = document.readyState !== 'loading';
  var scriptReady = typeof window.GLightbox === 'function';
  var initialized = false;
  var singleInstance = null;

  // 桌面缩放的数值状态；当前图片 / 容器一律在事件发生时重新解析，不缓存引用。
  // renderedImg 只用于“换图时清掉旧节点上的 transform”，dragImg 只用于
  // 一次拖拽手势内的身份校验，二者都不参与事件路由。
  var zoomState = null;
  // document 捕获层是否已挂载：open 时挂、close 时拆，与 zoomState 同生共死
  var layerBound = false;

  function isDataUri(value) {
    return typeof value === 'string' && value.slice(0, 5).toLowerCase() === 'data:';
  }

  // 主题懒加载留下的占位：有 data-src（真实地址），但 src 还是 data: 占位图
  function isLazyPlaceholder(img) {
    return !!img.getAttribute('data-src') && isDataUri(img.currentSrc || img.src);
  }

  // 媒体容器里可能夹着标题 / 说明 / 按钮：这些子元素上的事件不接管，
  // 继续交给 GLightbox 与页面自身处理
  function isUiTarget(target) {
    if (!target || typeof target.closest !== 'function') return false;
    return !!target.closest(UI_TARGET_SELECTOR);
  }

  // 图片的真实地址；没有可用的真实地址时返回空串
  function realSource(img) {
    var dataSrc = img.getAttribute('data-src');
    if (dataSrc && !isDataUri(dataSrc)) return dataSrc;
    var current = img.currentSrc || img.src || '';
    if (isDataUri(current)) return dataSrc ? '' : current;
    return current;
  }

  // 灯箱说明文字取中文 alt
  function copyAltToTitle(images) {
    for (var i = 0; i < images.length; i += 1) {
      var alt = images[i].getAttribute('alt');
      if (alt !== null) images[i].setAttribute('data-title', alt);
    }
  }

  function ensureStylesheet() {
    if (document.querySelector('link[data-glightbox-css]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = assetUrl('vendor/glightbox/glightbox.min.css');
    link.setAttribute('data-glightbox-css', '');
    (document.head || document.documentElement).appendChild(link);
  }

  function loadScript(done) {
    if (typeof window.GLightbox === 'function') {
      done();
      return;
    }
    var script = document.createElement('script');
    script.src = assetUrl('vendor/glightbox/glightbox.min.js');
    script.async = true;
    script.addEventListener('load', done);
    script.addEventListener('error', function () {
      /* 本地资源缺失时静默降级，不阻塞页面 */
    });
    (document.head || document.documentElement).appendChild(script);
  }

  // 用 data-src 回填 GLightbox 初始化时缓存的地址，修掉懒加载占位
  function refreshSlides(lightbox) {
    var slides = lightbox.elements || [];
    for (var i = 0; i < slides.length; i += 1) {
      var slide = slides[i];
      var img = slide && slide.node;
      var config = slide && slide.slideConfig;
      if (!img || img.nodeName !== 'IMG' || !config) continue;
      var src = realSource(img);
      if (!src) continue;
      config.href = src;
      config.type = 'image';
    }
  }

  // 只在有精确指针（鼠标 / 触控板）的设备上绑定鼠标交互；
  // 触屏设备交给 GLightbox 原生双指缩放，避免两套手势叠加
  function hasFinePointer() {
    try {
      if (typeof window.matchMedia === 'function') {
        var query = window.matchMedia(POINTER_QUERY);
        if (query && typeof query.matches === 'boolean') return query.matches;
      }
      return !('ontouchstart' in window);
    } catch (error) {
      return false;
    }
  }

  function clampNumber(value, min, max) {
    var low = Math.min(min, max);
    var high = Math.max(min, max);
    if (value < low) return low;
    if (value > high) return high;
    return value;
  }

  function clearImageTransform(img) {
    if (!img || !img.style) return;
    try {
      img.style.transform = '';
      img.style.transformOrigin = '';
      img.style.cursor = '';
    } catch (error) {
      /* 静默降级 */
    }
  }

  // 图片的布局中心（transform-origin: center）：视觉中心 = 布局中心 + 平移量
  function zoomCenter(img, tx, ty) {
    var rect = img.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 - tx,
      y: rect.top + rect.height / 2 - ty
    };
  }

  // 平移的边界容器：slide 本身（.gslide），拿不到时退回图片的父元素
  function panBoundsOf(img) {
    var node = null;
    if (img && typeof img.closest === 'function') node = img.closest('.gslide');
    if (!node && img) node = img.parentNode;
    if (!node || typeof node.getBoundingClientRect !== 'function') return null;
    return node.getBoundingClientRect();
  }

  // 把候选平移量限制在容器内（图片中心不离开容器），返回修正后的值。
  // 注意必须传“候选值”：state 里的 tx/ty 与当前 getBoundingClientRect 是对应的，
  // 先写入状态再夹取会拿到旧矩形、算出错误的布局中心
  function clampZoomPan(state, img, tx, ty) {
    var next = { tx: tx, ty: ty };
    var box = panBoundsOf(img);
    if (!box) return next;
    var center = zoomCenter(img, state.tx, state.ty);
    next.tx = clampNumber(tx, box.left - center.x, box.right - center.x);
    next.ty = clampNumber(ty, box.top - center.y, box.bottom - center.y);
    return next;
  }

  function renderZoom(state, img) {
    if (!state || !img || !img.style) return;
    // 图片节点被换掉时，先清掉旧节点上的 transform，避免残留
    if (state.renderedImg && state.renderedImg !== img) {
      clearImageTransform(state.renderedImg);
      state.renderedImg = null;
    }
    if (state.scale <= ZOOM_MIN + 0.0001) {
      img.style.transform = '';
      img.style.cursor = '';
      if (state.renderedImg === img) state.renderedImg = null;
      return;
    }
    img.style.transformOrigin = 'center center';
    img.style.transform =
      'translate(' +
      Math.round(state.tx * 100) / 100 + 'px, ' +
      Math.round(state.ty * 100) / 100 + 'px) scale(' +
      Math.round(state.scale * 1000) / 1000 + ')';
    img.style.cursor = state.dragging ? 'grabbing' : 'grab';
    state.renderedImg = img;
  }

  // 以视口坐标 (x, y) 为不动点缩放到 nextScale
  function zoomAround(state, img, nextScale, x, y) {
    var target = clampNumber(nextScale, ZOOM_MIN, ZOOM_MAX);
    if (Math.abs(target - state.scale) < 0.0001) return;
    var center = zoomCenter(img, state.tx, state.ty);
    var ratio = target / state.scale;
    var nextTx = x - center.x - ratio * (x - center.x - state.tx);
    var nextTy = y - center.y - ratio * (y - center.y - state.ty);
    state.scale = target;
    if (state.scale <= ZOOM_MIN + 0.0001) {
      state.scale = ZOOM_MIN;
      state.tx = 0;
      state.ty = 0;
    } else {
      var bounded = clampZoomPan(state, img, nextTx, nextTy);
      state.tx = bounded.tx;
      state.ty = bounded.ty;
    }
    renderZoom(state, img);
  }

  // 事件 target 是否落在灯箱容器内；返回容器节点，非灯箱事件返回 null
  function lightboxContainerOf(target) {
    if (!target || typeof target.closest !== 'function') return null;
    return target.closest(CONTAINER_SELECTOR);
  }

  // 在事件发生时解析“当前图片”，不依赖任何打开时缓存的节点引用。
  // 先问 GLightbox 实例（slide 可能刚被重建），失败再退回实时 DOM 查询。
  function activeImageOf(lightbox, container) {
    var slide = null;
    try {
      if (lightbox && typeof lightbox.getActiveSlide === 'function') {
        slide = lightbox.getActiveSlide();
      }
    } catch (error) {
      slide = null;
    }
    if (slide && typeof slide.querySelector === 'function') {
      // getActiveSlide 属于另一个实例 / 已脱离当前容器时不猜
      if (container && typeof container.contains === 'function' && !container.contains(slide)) return null;
      var inside =
        slide.querySelector('.gslide-image img') ||
        slide.querySelector('.gslide-media img') ||
        slide.querySelector('img');
      if (inside && inside.nodeName === 'IMG') return inside;
      // slide 存在但还没渲染出图片：等下一次事件再解析
      return null;
    }
    var scope = container || document.querySelector(CONTAINER_SELECTOR);
    if (!scope || typeof scope.querySelector !== 'function') return null;
    var fallback =
      scope.querySelector('.gslide.current .gslide-image img') ||
      scope.querySelector('.gslide.current img') ||
      scope.querySelector('.gslide-image img') ||
      scope.querySelector('.gslide-media img');
    return fallback && fallback.nodeName === 'IMG' ? fallback : null;
  }

  // mousedown 必须落在当前图片的媒体区域内，才进入拖拽
  function isImageArea(target, img) {
    if (!target || !img) return false;
    if (target === img) return true;
    if (typeof target.closest !== 'function') return false;
    var media = target.closest(MEDIA_SELECTOR);
    if (!media) return false;
    if (media === img.parentNode) return true;
    return typeof media.contains === 'function' && media.contains(img);
  }

  function onDocumentWheel(event) {
    try {
      var state = zoomState;
      if (!state) return;
      var container = lightboxContainerOf(event.target);
      if (!container) return;
      if (isUiTarget(event.target)) return;
      var img = activeImageOf(state.lightbox, container);
      if (!img) return;
      // 捕获阶段先于页面滚动处理，{ passive: false } 保证这里能真正拦下默认滚动
      event.preventDefault();
      var delta = event.deltaY || 0;
      if (!delta) return;
      // 行 / 页滚动单位换算成像素，让不同设备的滚轮步进接近
      if (event.deltaMode === 1) delta *= 16;
      else if (event.deltaMode === 2) delta *= 100;
      var factor = clampNumber(Math.pow(1.0015, -delta), 0.5, 2);
      zoomAround(state, img, state.scale * factor, event.clientX, event.clientY);
    } catch (error) {
      /* 静默降级：缩放失败不影响灯箱开关 */
    }
  }

  function onDocumentDoubleClick(event) {
    try {
      var state = zoomState;
      if (!state) return;
      var container = lightboxContainerOf(event.target);
      if (!container) return;
      if (isUiTarget(event.target)) return;
      var img = activeImageOf(state.lightbox, container);
      if (!img) return;
      event.preventDefault();
      if (state.scale > ZOOM_MIN + 0.0001) {
        resetZoom(state, img);
        return;
      }
      zoomAround(state, img, ZOOM_DOUBLE_CLICK, event.clientX, event.clientY);
    } catch (error) {
      /* 静默降级 */
    }
  }

  function onDocumentMouseDown(event) {
    try {
      var state = zoomState;
      if (!state) return;
      if (event.button !== 0) return;
      var container = lightboxContainerOf(event.target);
      if (!container) return;
      if (isUiTarget(event.target)) return;
      if (state.scale <= ZOOM_MIN + 0.0001) return; // 未缩放时不接管拖拽
      var img = activeImageOf(state.lightbox, container);
      if (!img) return;
      if (!isImageArea(event.target, img)) return;
      event.preventDefault();
      state.dragging = true;
      state.dragImg = img;
      state.dragStartX = event.clientX;
      state.dragStartY = event.clientY;
      state.dragTx = state.tx;
      state.dragTy = state.ty;
      // 拖拽过程继续挂 document；关闭 / 切图 / 松手时统一清理
      document.addEventListener('mousemove', onDocumentMouseMove, true);
      document.addEventListener('mouseup', onDocumentMouseUp, true);
      renderZoom(state, img);
    } catch (error) {
      /* 静默降级 */
    }
  }

  function onDocumentMouseMove(event) {
    try {
      var state = zoomState;
      if (!state || !state.dragging) return;
      if (state.scale <= ZOOM_MIN + 0.0001) {
        // 拖拽过程中把缩放滚回 1：结束拖拽，避免在 1 倍下平移
        stopZoomDrag();
        return;
      }
      // 鼠标在窗口外松开时收不到 mouseup，用 buttons 兜底结束拖拽
      if (typeof event.buttons === 'number' && event.buttons === 0) {
        stopZoomDrag();
        return;
      }
      // 每次移动都重新解析当前图片；节点被换掉就不再继续这次拖拽
      var img = activeImageOf(state.lightbox, null);
      if (!img || img !== state.dragImg) {
        stopZoomDrag();
        return;
      }
      event.preventDefault();
      var bounded = clampZoomPan(
        state,
        img,
        state.dragTx + (event.clientX - state.dragStartX),
        state.dragTy + (event.clientY - state.dragStartY)
      );
      state.tx = bounded.tx;
      state.ty = bounded.ty;
      renderZoom(state, img);
    } catch (error) {
      /* 静默降级 */
    }
  }

  function onDocumentMouseUp() {
    try {
      stopZoomDrag();
    } catch (error) {
      /* 静默降级 */
    }
  }

  function detachDragListeners() {
    document.removeEventListener('mousemove', onDocumentMouseMove, true);
    document.removeEventListener('mouseup', onDocumentMouseUp, true);
  }

  function stopZoomDrag() {
    detachDragListeners();
    var state = zoomState;
    if (!state || !state.dragging) return;
    state.dragging = false;
    state.dragImg = null;
    // 松手后把光标从 grabbing 恢复成 grab
    if (state.renderedImg) renderZoom(state, state.renderedImg);
  }

  // 把当前缩放恢复到 1 倍；img 为空时清理上一次渲染过的节点
  function resetZoom(state, img) {
    if (!state) return;
    detachDragListeners();
    state.dragging = false;
    state.dragImg = null;
    state.scale = ZOOM_MIN;
    state.tx = 0;
    state.ty = 0;
    if (img) {
      renderZoom(state, img);
      return;
    }
    if (state.renderedImg) {
      renderZoom(state, state.renderedImg);
      return;
    }
    state.renderedImg = null;
  }

  // 灯箱打开时挂载 document 捕获层；触屏设备不挂，交给 GLightbox 的 pinch
  function activateZoomLayer(lightbox) {
    try {
      if (!lightbox) return;
      if (!hasFinePointer()) {
        // 触屏设备不挂鼠标层；若之前有残留的层（指针能力变化），一并拆掉
        deactivateZoomLayer();
        return;
      }
      if (layerBound && zoomState && zoomState.lightbox === lightbox) return;
      deactivateZoomLayer();
      layerBound = true;
      zoomState = {
        lightbox: lightbox,
        scale: ZOOM_MIN,
        tx: 0,
        ty: 0,
        dragging: false,
        dragImg: null,
        renderedImg: null,
        dragStartX: 0,
        dragStartY: 0,
        dragTx: 0,
        dragTy: 0
      };
      // 捕获阶段 + document：不依赖 slide 节点身份，灯箱重建 slide 也不会失效
      document.addEventListener('wheel', onDocumentWheel, { passive: false, capture: true });
      document.addEventListener('dblclick', onDocumentDoubleClick, true);
      document.addEventListener('mousedown', onDocumentMouseDown, true);
    } catch (error) {
      deactivateZoomLayer();
    }
  }

  // close 时拆除捕获层；owner 为空时强制清理，传实例时只清理该实例自己的状态，
  // 避免旧灯箱的延迟 close 事件把新灯箱的监听误拆掉
  function deactivateZoomLayer(lightbox) {
    if (lightbox && zoomState && zoomState.lightbox !== lightbox) return;
    layerBound = false;
    // 注册时 capture 为 true，移除时同样要按 capture 匹配
    document.removeEventListener('wheel', onDocumentWheel, true);
    document.removeEventListener('dblclick', onDocumentDoubleClick, true);
    document.removeEventListener('mousedown', onDocumentMouseDown, true);
    detachDragListeners();
    var state = zoomState;
    zoomState = null;
    if (!state) return;
    state.dragging = false;
    state.dragImg = null;
    var img = state.renderedImg;
    state.renderedImg = null;
    clearImageTransform(img);
  }

  // 切图前：结束拖拽并清掉旧图上的 transform，监听层保持挂载
  function resetLayerForSlide(lightbox) {
    var state = zoomState;
    if (!state) return;
    if (lightbox && state.lightbox !== lightbox) return;
    resetZoom(state, null);
  }

  // 切图后：重置缩放状态，并重新解析当前图片做 transform-origin 预处理。
  // GLightbox 在首次 open 的入场动画结束时也会补发一次 slide_changed，
  // 那不是真的切图：当前图片与已渲染的图片是同一个时保留缩放，否则会把
  // 用户在打开后、动画结束前做的缩放悄悄抹掉。
  function prepareCurrentSlide(lightbox) {
    var state = zoomState;
    if (!state) return;
    if (lightbox && state.lightbox !== lightbox) return;
    var img = activeImageOf(lightbox, null);
    if (!img || state.renderedImg !== img) {
      resetZoom(state, null);
    } else if (state.scale > ZOOM_MIN + 0.0001) {
      renderZoom(state, img);
    }
    if (!img || !img.style) return;
    img.style.transformOrigin = 'center center';
  }

  // 绑定 GLightbox 事件：open 挂捕获层，close 拆；切图只重置状态，
  // 不重新绑定任何节点，避免再出现“绑上了但真实鼠标不生效”
  function setupZoom(lightbox) {
    try {
      if (!lightbox || typeof lightbox.on !== 'function' || lightbox.__desktopZoomReady) return;
      lightbox.__desktopZoomReady = true;
      lightbox.on('open', function () {
        try {
          activateZoomLayer(lightbox);
        } catch (error) {
          /* 静默降级 */
        }
      });
      lightbox.on('slide_changed', function () {
        try {
          prepareCurrentSlide(lightbox);
        } catch (error) {
          /* 静默降级 */
        }
      });
      lightbox.on('slide_before_change', function () {
        try {
          resetLayerForSlide(lightbox);
        } catch (error) {
          /* 静默降级 */
        }
      });
      lightbox.on('close', function () {
        try {
          deactivateZoomLayer(lightbox);
        } catch (error) {
          /* 静默降级 */
        }
      });
    } catch (error) {
      /* 事件 API 不可用时静默降级为无缩放 */
    }
  }

  function openSingle(image) {
    var src = realSource(image);
    if (!src) return;
    try {
      if (singleInstance) {
        try {
          singleInstance.close();
        } catch (closeError) {
          /* 上一张已经关闭或销毁，忽略 */
        }
      }
      singleInstance = window.GLightbox({
        elements: [{
          href: src,
          type: 'image',
          title: image.getAttribute('data-title') || image.getAttribute('alt') || '',
          // 单图 elements 走 GLightbox 的对象配置分支，实例级 zoomable/draggable
          // 不会合并进去，必须在元素配置里关掉
          zoomable: false,
          draggable: false
        }],
        touchNavigation: true,
        loop: false,
        // 桌面缩放/平移由本文件接管，避免和 GLightbox 自带的鼠标缩放/拖拽抢 transform
        zoomable: false,
        draggable: false
      });
      if (singleInstance) {
        setupZoom(singleInstance);
        singleInstance.open();
      }
    } catch (error) {
      /* 静默降级 */
    }
  }

  function onDocumentClick(event) {
    var target = event.target;
    if (!target || target.nodeName !== 'IMG') return;
    if (!target.closest || !target.closest('.md-text')) return;
    if (!isLazyPlaceholder(target)) return;

    event.preventDefault();
    event.stopPropagation();
    openSingle(target);
  }

  function init(images) {
    copyAltToTitle(images);
    if (typeof window.GLightbox !== 'function') return;

    var lightbox;
    try {
      lightbox = window.GLightbox({
        selector: SELECTOR,
        touchNavigation: true,
        loop: true,
        // 桌面缩放/平移由本文件接管；touchNavigation 保留给触屏双指缩放
        zoomable: false,
        draggable: false
      });
    } catch (error) {
      return;
    }
    if (!lightbox) return;

    refreshSlides(lightbox);
    setupZoom(lightbox);
    document.addEventListener('click', onDocumentClick, true);
  }

  function maybeInit() {
    if (initialized || !domReady || !scriptReady) return;
    initialized = true;
    var images = document.querySelectorAll(SELECTOR);
    if (!images.length) return;
    try {
      init(images);
    } catch (error) {
      /* 静默降级 */
    }
  }

  // 资源立即并行加载，DOMContentLoaded 之后再初始化
  ensureStylesheet();
  loadScript(function () {
    scriptReady = true;
    maybeInit();
  });

  if (domReady) {
    maybeInit();
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      domReady = true;
      maybeInit();
    });
  }
})();
